import { createHash } from "node:crypto";
import type { Job, Queue } from "bullmq";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import type { DrizzleClient } from "@repo/db";
import {
  contentJobs,
  clips,
  sourceVideos,
  clipLibraryConfigs,
  clipLibraries,
  jobEditLists,
  clipUsage,
  searchClips,
  chainForShot,
} from "@repo/db";
import {
  ClipSelectionPayloadSchema,
  FormatPlaybookSchema,
  SentenceTimingArraySchema,
  ClauseTimingArraySchema,
  ShotListSchema,
} from "@repo/contracts";
import type {
  ClipSelectionPayload,
  EditListEntry,
  ClipSegment,
} from "@repo/contracts";
import { createContextLogger } from "@repo/logger";
import { callLLM } from "../utils/llm-client.js";
import { embedText, checkSidecarHealth } from "./sidecar-client.js";
import { updateJobStatusAndDispatch } from "../utils/update-and-dispatch.js";

const logger = createContextLogger("clip-selection");

// ---------------------------------------------------------------------------
// JSON extraction helper
// ---------------------------------------------------------------------------

function extractJson(raw: string): string {
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  // Pass 1: direct parse of stripped text
  for (const candidate of [stripped, raw]) {
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {}
  }

  // Pass 2: find JSON array and validate
  const arrMatch = stripped.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      JSON.parse(arrMatch[0]);
      return arrMatch[0];
    } catch {}
  }

  // Pass 3: find JSON object and validate (do NOT return unvalidated)
  const objMatch = stripped.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      JSON.parse(objMatch[0]);
      return objMatch[0];
    } catch {}
  }

  throw new Error(
    `Cannot extract JSON from LLM response: ${raw.slice(0, 300)}`,
  );
}

// ---------------------------------------------------------------------------
// Multi-clip fill helpers
// ---------------------------------------------------------------------------

/** Shape of a clips DB row used by toSegment. */
interface ClipRow {
  id: string;
  start_ms: number;
  end_ms: number;
  cdn_url: string | null;
  storage_key: string | null;
  source_video_id: string;
}

function toSegment(
  clip: ClipRow,
  sourceVideoCdnUrl: string | null | undefined,
): ClipSegment {
  return {
    clip_id: clip.id,
    source_video_cdn_url: sourceVideoCdnUrl ?? undefined,
    source_video_storage_key: clip.storage_key ?? undefined,
    trim_start_ms: clip.start_ms,
    trim_end_ms: clip.end_ms,
  };
}

// No same clip may appear within this many milliseconds of timeline.
const CLIP_REUSE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build a ClipSegment[] that fills at least targetMs of playback time.
 * bestClip is segment[0]; additional alternates fill remaining time.
 * canUse / markUsed enforce the 5-minute reuse window cross-entry;
 * a local intraEntry set prevents the same clip appearing twice within
 * a single clause window.
 */
async function fillDuration(
  targetMs: number,
  bestClip: ClipRow,
  alternates: Array<{ clip_id: string }>,
  db: DrizzleClient,
  canUse: (clipId: string) => boolean,
  markUsed: (clipId: string) => void,
  selectedEmbeddings: number[][],
  queryEmbedding: number[],
): Promise<ClipSegment[]> {
  const [bestSrc] = await db
    .select({ cdn_url: sourceVideos.cdn_url })
    .from(sourceVideos)
    .where(eq(sourceVideos.id, bestClip.source_video_id))
    .limit(1);

  const seedDuration = bestClip.end_ms - bestClip.start_ms;

  // Seed already covers the slot — no chaining needed.
  if (seedDuration >= targetMs) {
    selectedEmbeddings.push(queryEmbedding);
    return [toSegment(bestClip, bestSrc?.cdn_url)];
  }

  // Use chainForShot: it picks continuous (rebuild the over-segmented scene
  // via prev/next pointers in the same source) or thematic (cross-source
  // montage with strict clip_type / motion / lighting compatibility) based
  // on whether the seed's adjacent clip is a continuation.
  const pool = alternates
    .filter((a) => a.clip_id !== bestClip.id && canUse(a.clip_id))
    .map((a) => a.clip_id);
  const chain = await chainForShot(db, bestClip.id, targetMs, pool);

  if (chain.clips.length <= 1) {
    // Chain helper returned only the seed (no adjacency + no compatible
    // alternates). Fall back to the legacy fill: pick any usable alternate
    // regardless of compatibility so we don't blow the duration budget.
    const segments: ClipSegment[] = [toSegment(bestClip, bestSrc?.cdn_url)];
    let filled = seedDuration;
    const intraEntry = new Set<string>([bestClip.id]);
    for (const alt of alternates) {
      if (filled >= targetMs) break;
      if (intraEntry.has(alt.clip_id)) continue;
      const [altRow] = await db
        .select()
        .from(clips)
        .where(eq(clips.id, alt.clip_id))
        .limit(1);
      if (!altRow) continue;
      const [altSrc] = await db
        .select({ cdn_url: sourceVideos.cdn_url })
        .from(sourceVideos)
        .where(eq(sourceVideos.id, altRow.source_video_id))
        .limit(1);
      segments.push(toSegment(altRow, altSrc?.cdn_url));
      intraEntry.add(alt.clip_id);
      markUsed(alt.clip_id);
      filled += altRow.end_ms - altRow.start_ms;
    }
    selectedEmbeddings.push(queryEmbedding);
    return segments;
  }

  // Build segments from the chain result. Source CDN URLs are fetched in a
  // single round-trip via the distinct set of source_video_ids.
  const sourceIds = [...new Set(chain.clips.map((c) => c.source_video_id))];
  const srcRows = await db
    .select({ id: sourceVideos.id, cdn_url: sourceVideos.cdn_url })
    .from(sourceVideos)
    .where(sql`id = ANY(${sourceIds}::uuid[])`);
  const cdnById = new Map(srcRows.map((r) => [r.id, r.cdn_url]));

  // chain.clips[0] is the seed; need storage_key for the segment, which the
  // chain row doesn't carry. Reuse bestClip for the seed; load the rest.
  const segments: ClipSegment[] = [toSegment(bestClip, bestSrc?.cdn_url)];
  const intraEntry = new Set<string>([bestClip.id]);
  for (let i = 1; i < chain.clips.length; i++) {
    const c = chain.clips[i]!;
    if (intraEntry.has(c.id)) continue;
    const [row] = await db
      .select()
      .from(clips)
      .where(eq(clips.id, c.id))
      .limit(1);
    if (!row) continue;
    segments.push(toSegment(row, cdnById.get(row.source_video_id) ?? null));
    intraEntry.add(c.id);
    markUsed(c.id);
  }

  selectedEmbeddings.push(queryEmbedding);
  return segments;
}

// ---------------------------------------------------------------------------
// Processor factory
// ---------------------------------------------------------------------------

/**
 * Clip Selection Processor
 *
 * Two-phase clip selection for a content job:
 *
 * Phase 1: Single LLM call (Claude Opus) produces a shot list — one entry per
 *   sentence, each with assigned tags from the library vocabulary and optional
 *   shot scale / duration preferences.
 *
 * Phase 2: For each sentence, embeds the sentence text, runs hybrid RRF search
 *   (dense + sparse + text), applies MMR diversity re-ranking, and picks the
 *   best clip not yet used. Falls back to a B-roll prompt entry when no clip
 *   matches.
 *
 * Saves a job_edit_lists row and clip_usage rows on completion, then dispatches
 * the job to AWAITING_CLIP_REVIEW or QMS_VALIDATING based on hitl_clip_review.
 *
 * @param db     - Drizzle client
 * @param queues - { qmsValidation: Queue } for direct-to-QMS path
 */
export function createClipSelectionProcessor(
  db: DrizzleClient,
  queues: { qmsValidation: Queue },
) {
  return async (job: Job<ClipSelectionPayload>): Promise<void> => {
    // ── Validate payload ───────────────────────────────────────────────────
    const parseResult = ClipSelectionPayloadSchema.safeParse(job.data);
    if (!parseResult.success) {
      const errorMessage = `Invalid clip-selection payload: ${parseResult.error.message}`;
      logger.error(
        { bullmq_job_id: job.id, errors: parseResult.error.errors },
        errorMessage,
      );
      throw new Error(errorMessage);
    }

    const { job_id, config_id } = parseResult.data;

    logger.info(
      { job_id, config_id, bullmq_job_id: job.id },
      "clip-selection processor invoked",
    );

    // ── Load config (playbook) ─────────────────────────────────────────────
    const [config] = await db
      .select()
      .from(clipLibraryConfigs)
      .where(eq(clipLibraryConfigs.id, config_id))
      .limit(1);

    if (!config) {
      throw new Error(`clip_library_config not found: ${config_id}`);
    }

    const playbook = FormatPlaybookSchema.parse(config.playbook);

    // ── Load clip library ──────────────────────────────────────────────────
    const [library] = await db
      .select()
      .from(clipLibraries)
      .where(eq(clipLibraries.id, config.clip_library_id))
      .limit(1);

    if (!library) {
      throw new Error(`clip_library not found: ${config.clip_library_id}`);
    }

    const tagVocabulary = library.tag_vocabulary as Record<string, string[]>;

    // ── Load job ───────────────────────────────────────────────────────────
    const [jobRow] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, job_id))
      .limit(1);

    if (!jobRow) {
      throw new Error(`content_job not found: ${job_id}`);
    }

    const manifest =
      (jobRow.assembly_manifest as Record<string, unknown>) ?? {};

    // ── Resolve clause timings (preferred) or fall back to sentence timings ──
    // clause_timings are sub-sentence linguistic units produced by TTS alignment.
    // When present they give finer temporal granularity for clip selection.
    // sentence_timings are used as a fallback for formats without clause splits.
    const rawClauseTimings = ClauseTimingArraySchema.safeParse(
      manifest["clause_timings"] ?? [],
    );
    const rawSentenceTimings = SentenceTimingArraySchema.parse(
      manifest["sentence_timings"] ?? [],
    );

    // Normalise to a common shape: { index, text, start_ms, end_ms }
    type TimingUnit = {
      index: number;
      sentence_index: number;
      text: string;
      start_ms: number;
      end_ms: number;
    };

    let timingUnits: TimingUnit[];
    let timingSource: "clause_timings" | "sentence_timings" | "synthetic";

    if (rawClauseTimings.success && rawClauseTimings.data.length > 0) {
      timingUnits = rawClauseTimings.data.map((c) => ({
        index: c.clause_index,
        sentence_index: c.sentence_index,
        text: c.text,
        start_ms: c.start_ms,
        end_ms: c.end_ms,
      }));
      timingSource = "clause_timings";
      logger.info(
        { job_id, clause_count: timingUnits.length },
        "Loaded clause timings — building shot list per clause",
      );
    } else if (rawSentenceTimings.length > 0) {
      timingUnits = rawSentenceTimings.map((s) => ({
        index: s.sentence_index,
        sentence_index: s.sentence_index,
        text: s.text,
        start_ms: s.start_ms,
        end_ms: s.end_ms,
      }));
      timingSource = "sentence_timings";
      logger.info(
        { job_id, sentence_count: timingUnits.length },
        "No clause timings — falling back to sentence timings",
      );
    } else {
      throw new Error(
        `job ${job_id}: assembly_manifest has no clause_timings or sentence_timings. ` +
          `TTS must complete before clip selection — sentence timings are derived from TTS alignment and define clip time windows. ` +
          `Check that the job's template does not have no_tts=true, and that TTS completed successfully before CLIP_SELECTION was dispatched.`,
      );
    }

    logger.info(
      { job_id, timing_source: timingSource, unit_count: timingUnits.length },
      "Timing units resolved",
    );

    // ── Snap clause boundaries to word boundaries ──────────────────────────
    // Clause timings from TTS alignment can fall mid-word. Snapping every
    // boundary to the nearest word start ensures clip cuts never happen inside
    // a spoken word.
    const rawWordTimestamps = manifest["word_timestamps"] as Array<{
      word: string;
      start: number;
      end: number;
    }> | null;
    if (rawWordTimestamps && rawWordTimestamps.length > 0) {
      // word_timestamps store time in seconds; clause timings are in ms
      const wordStartsMs = rawWordTimestamps.map((w) =>
        Math.round(w.start * 1000),
      );

      const snapToWordBoundary = (timeMs: number): number => {
        let nearest = wordStartsMs[0]!;
        let minDist = Math.abs(timeMs - nearest);
        for (const wt of wordStartsMs) {
          const dist = Math.abs(timeMs - wt);
          if (dist < minDist) {
            minDist = dist;
            nearest = wt;
          }
        }
        return nearest;
      };

      timingUnits = timingUnits.map((unit) => ({
        ...unit,
        start_ms: snapToWordBoundary(unit.start_ms),
        end_ms: snapToWordBoundary(unit.end_ms),
      }));

      logger.info(
        { job_id, word_count: wordStartsMs.length },
        "Clause boundaries snapped to word boundaries",
      );
    }

    // Keep sentence timings for totalDurationMs calculation below
    const sentenceTimings =
      rawSentenceTimings.length > 0
        ? rawSentenceTimings
        : timingUnits.map((u) => ({
            sentence_index: u.sentence_index,
            text: u.text,
            start_ms: u.start_ms,
            end_ms: u.end_ms,
          }));

    // ── Phase 1: Shot list ─────────────────────────────────────────────────
    // Fast health check (5s timeout) — avoids blocking for 5 minutes when
    // the sidecar is alive but CPU-saturated by TransNetV2 scene detection.
    const { audioFace: sidecarAvailable } = await checkSidecarHealth();
    if (!sidecarAvailable) {
      throw new Error(
        `[clip-selection] Embedding sidecar unavailable. Cannot select clips without semantic search. Ensure audio-face-sidecar is running.`,
      );
    }

    const SHOT_LIST_BATCH_SIZE = 50;
    const MAX_CLAUSE_TEXT_LENGTH = 200;

    const vocabSummary = Object.entries(tagVocabulary)
      .map(([group, values]) => `${group}: ${values.join(", ")}`)
      .join("\n");
    const videoTitle = jobRow.title ?? jobRow.initial_topic ?? "untitled";
    const format = jobRow.format ?? "content";

    const buildBatchPrompt = (batch: typeof timingUnits) => {
      const clauses = batch
        .map((u, i) => `${i}: "${u.text.slice(0, MAX_CLAUSE_TEXT_LENGTH)}"`)
        .join("\n");
      return `You are a video editor selecting clips from the "${library.name}" clip library for a ${format} video titled "${videoTitle}".

Tag vocabulary for "${library.name}":
${vocabSummary}

Format rules: ${playbook.system_prompt_addendum}
Preferred shot scales: ${playbook.preferred_shot_scales.join(", ")}
Avoid audio classes: ${playbook.avoid_audio_classes.join(", ")}
Character continuity: ${playbook.character_continuity}

Assign tags to each clause. Only use tags from the vocabulary above.

Script clauses (${batch.length} total):
${clauses}

Respond with ONLY a JSON array — one entry per clause, in order:
[{"sentence_index":0,"sentence_text":"...","assigned_tags":{"characters":[],"mood":[],"location":[],"action":[],"custom":[]},"shot_scale_preference":"any","audio_class_preference":"any","notes":""}]`;
    };

    // Split into batches so each prompt stays small enough for the LLM to respond quickly
    const batches: (typeof timingUnits)[] = [];
    for (let i = 0; i < timingUnits.length; i += SHOT_LIST_BATCH_SIZE) {
      batches.push(timingUnits.slice(i, i + SHOT_LIST_BATCH_SIZE));
    }

    logger.info(
      {
        job_id,
        total_units: timingUnits.length,
        batch_count: batches.length,
        batch_size: SHOT_LIST_BATCH_SIZE,
      },
      "Generating shot list in batches",
    );

    const allShotEntries: z.infer<typeof ShotListSchema> = [];

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx]!;
      const prompt = buildBatchPrompt(batch);

      logger.info(
        {
          job_id,
          batch: batchIdx + 1,
          of: batches.length,
          clauses: batch.length,
          prompt_length: prompt.length,
        },
        "Calling LLM for shot list batch",
      );

      const makeFallbackEntries = (b: typeof batch) =>
        b.map((u, i) => ({
          sentence_index: i,
          sentence_text: u.text.slice(0, MAX_CLAUSE_TEXT_LENGTH),
          assigned_tags: {
            characters: [] as string[],
            mood: [] as string[],
            location: [] as string[],
            action: [] as string[],
            custom: [] as string[],
          },
          shot_scale_preference: "any" as const,
          audio_class_preference: "any" as const,
        }));

      let batchShots: z.infer<typeof ShotListSchema>;
      try {
        const rawText = await callLLM(prompt, {
          maxTokens: 4_000,
          timeoutMs: 60_000,
        });

        logger.info(
          { job_id, batch: batchIdx + 1, raw_length: rawText.length },
          "Shot list batch response received",
        );

        batchShots = ShotListSchema.parse(JSON.parse(extractJson(rawText)));

        if (batchShots.length !== batch.length) {
          logger.warn(
            {
              job_id,
              batch: batchIdx + 1,
              expected: batch.length,
              got: batchShots.length,
            },
            "Shot list batch length mismatch — padding with empty entries",
          );
          while (batchShots.length < batch.length) {
            const u = batch[batchShots.length]!;
            batchShots.push({
              sentence_index: batchShots.length,
              sentence_text: u.text.slice(0, MAX_CLAUSE_TEXT_LENGTH),
              assigned_tags: {
                characters: [],
                mood: [],
                location: [],
                action: [],
                custom: [],
              },
              shot_scale_preference: "any",
              audio_class_preference: "any",
            });
          }
        }
      } catch (llmErr) {
        logger.warn(
          { job_id, batch: batchIdx + 1, error: String(llmErr) },
          "LLM shot list generation failed — using fallback empty entries (embedding search still runs)",
        );
        batchShots = makeFallbackEntries(batch);
      }

      allShotEntries.push(...batchShots);
    }

    const shotList: z.infer<typeof ShotListSchema> = allShotEntries;

    logger.info({ job_id, shot_count: shotList.length }, "Shot list ready");

    // ── Phase 2: Clip retrieval + multi-clip fill ──────────────────────────
    //
    // Reuse policy: the same clip may not appear within CLIP_REUSE_WINDOW_MS of
    // timeline time (5 minutes). Clips are always found — we fall back through
    // three tiers rather than ever rendering a black frame:
    //   Tier 1: Primary search (all constraints: audio class, shot scale, duration)
    //   Tier 2: Relaxed search (embedding only, no audio/character/scale filters)
    //   Tier 3: Any approved clip from the library (least-recently-used)

    // clip_id → last used timeline position (ms). Allows reuse after 5 min.
    const clipLastUsedMs = new Map<string, number>();

    const canUse = (clipId: string, currentMs: number): boolean => {
      const last = clipLastUsedMs.get(clipId);
      return last === undefined || currentMs - last >= CLIP_REUSE_WINDOW_MS;
    };

    const markUsed = (clipId: string, currentMs: number): void => {
      clipLastUsedMs.set(clipId, currentMs);
    };

    const selectedEmbeddings: number[][] = [];
    const editListEntries: EditListEntry[] = [];

    for (let i = 0; i < shotList.length; i++) {
      const shot = shotList[i]!;
      const unit = timingUnits[i]!;

      const embedding = await embedText(shot.sentence_text);
      if (embedding.dense.length === 0) {
        throw new Error(
          `[clip-selection] embedText returned empty dense vector for clause ${i}. Sidecar unavailable.`,
        );
      }

      const shotScalePref =
        shot.shot_scale_preference !== "any"
          ? [shot.shot_scale_preference]
          : playbook.preferred_shot_scales;

      // ── Tier 1: primary search ─────────────────────────────────────────
      let searchResults = await searchClips(db, {
        library_id: config.clip_library_id,
        query_dense: embedding.dense,
        query_sparse: embedding.sparse,
        query_text: shot.sentence_text,
        limit: 20,
        shot_scale_preference: shotScalePref,
        avoid_audio_classes: playbook.avoid_audio_classes,
        character_filter: shot.assigned_tags.characters,
        min_duration_ms: shot.duration_min_ms ?? playbook.min_clip_duration_ms,
        max_duration_ms: shot.duration_max_ms ?? playbook.max_clip_duration_ms,
        already_selected_embeddings: selectedEmbeddings,
        mmr_lambda: 0.7,
      });

      let bestResult =
        searchResults.find((r) => canUse(r.clip_id, unit.start_ms)) ?? null;

      // ── Tier 2: relaxed search (drop audio/scale/duration constraints) ─
      if (!bestResult) {
        logger.info(
          { job_id, clause: i, reason: "no usable primary result" },
          "Falling back to relaxed clip search",
        );
        const relaxedResults = await searchClips(db, {
          library_id: config.clip_library_id,
          query_dense: embedding.dense,
          query_sparse: embedding.sparse,
          query_text: shot.sentence_text,
          limit: 30,
          shot_scale_preference: [],
          avoid_audio_classes: [],
          character_filter: [],
          min_duration_ms: 500,
          max_duration_ms: 600_000,
          already_selected_embeddings: selectedEmbeddings,
          mmr_lambda: 0.5,
        });
        bestResult =
          relaxedResults.find((r) => canUse(r.clip_id, unit.start_ms)) ??
          relaxedResults[0] ??
          null;
        if (bestResult) searchResults = relaxedResults;
      }

      // ── Tier 3: any least-recently-used approved clip ──────────────────
      if (!bestResult) {
        logger.warn(
          { job_id, clause: i },
          "Relaxed search also empty — picking least-recently-used clip from library",
        );
        const [lruClip] = await db
          .select({
            id: clips.id,
            start_ms: clips.start_ms,
            end_ms: clips.end_ms,
            cdn_url: clips.cdn_url,
            storage_key: clips.storage_key,
            source_video_id: clips.source_video_id,
          })
          .from(clips)
          .where(
            and(
              eq(clips.library_id, config.clip_library_id),
              eq(clips.review_status, "approved"),
            ),
          )
          .orderBy(sql`last_used_at ASC NULLS FIRST`)
          .limit(1);

        if (!lruClip) {
          throw new Error(
            `[clip-selection] Clip library ${config.clip_library_id} has no approved clips. Cannot build edit list.`,
          );
        }

        const [lruSrc] = await db
          .select({ cdn_url: sourceVideos.cdn_url })
          .from(sourceVideos)
          .where(eq(sourceVideos.id, lruClip.source_video_id))
          .limit(1);

        markUsed(lruClip.id, unit.start_ms);
        editListEntries.push({
          id: crypto.randomUUID(),
          sentence_index: unit.sentence_index,
          sentence_text: unit.text,
          clips: [toSegment(lruClip, lruSrc?.cdn_url)],
          start_ms: unit.start_ms,
          end_ms: unit.end_ms,
          playback_rate: 1.0,
          is_fallback: false,
          match_score: 0,
          match_reason: "lru-fallback",
        });
        continue;
      }

      const [bestClipRow] = await db
        .select()
        .from(clips)
        .where(eq(clips.id, bestResult.clip_id))
        .limit(1);

      if (!bestClipRow) {
        logger.warn(
          { job_id, clause: i, clip_id: bestResult.clip_id },
          "Best clip vanished from DB — skipping to next",
        );
        continue;
      }

      markUsed(bestResult.clip_id, unit.start_ms);

      const alternates = searchResults.filter(
        (r) => r.clip_id !== bestResult!.clip_id,
      );

      const clauseMs = unit.end_ms - unit.start_ms;
      const clipsForEntry = await fillDuration(
        clauseMs,
        bestClipRow,
        alternates,
        db,
        (clipId) => canUse(clipId, unit.start_ms),
        (clipId) => markUsed(clipId, unit.start_ms),
        selectedEmbeddings,
        embedding.dense,
      );

      editListEntries.push({
        id: crypto.randomUUID(),
        sentence_index: unit.sentence_index,
        sentence_text: unit.text,
        clips: clipsForEntry,
        start_ms: unit.start_ms,
        end_ms: unit.end_ms,
        playback_rate: 1.0,
        is_fallback: false,
        match_score: Math.min(bestResult.rrf_score, 1),
        match_reason: bestResult.match_reason,
      });
    }

    logger.info(
      {
        job_id,
        total_entries: editListEntries.length,
        fallback_count: editListEntries.filter((e) => e.is_fallback).length,
        unique_clips: new Set(
          editListEntries.flatMap((e) => (e.clips ?? []).map((s) => s.clip_id)),
        ).size,
        multi_clip_entries: editListEntries.filter(
          (e) => (e.clips?.length ?? 0) > 1,
        ).length,
      },
      "Edit list assembled",
    );

    // ── Save edit list ─────────────────────────────────────────────────────

    const scriptHash = createHash("sha256")
      .update(jobRow.script ?? "")
      .digest("hex");

    const fallbackCount = editListEntries.filter((e) => e.is_fallback).length;
    const uniqueClips = new Set(
      editListEntries.flatMap((e) => (e.clips ?? []).map((s) => s.clip_id)),
    ).size;
    const totalDurationMs = sentenceTimings.reduce(
      (sum, s) => sum + (s.end_ms - s.start_ms),
      0,
    );

    const editListStatus = config.hitl_clip_review
      ? "needs_review"
      : "approved";

    await db.insert(jobEditLists).values({
      job_id,
      version: 1,
      status: editListStatus,
      entries: editListEntries as any,
      source_script_hash: scriptHash,
      total_clips: editListEntries.length,
      unique_clips: uniqueClips,
      total_duration_ms: totalDurationMs,
      ai_fallback_count: fallbackCount,
    });

    logger.info(
      { job_id, status: editListStatus },
      "Edit list saved to job_edit_lists",
    );

    // ── Record clip usage analytics ────────────────────────────────────────

    const [savedEditList] = await db
      .select({ id: jobEditLists.id })
      .from(jobEditLists)
      .where(and(eq(jobEditLists.job_id, job_id), eq(jobEditLists.version, 1)))
      .limit(1);

    if (savedEditList) {
      // Flatten all ClipSegment clip_ids from the clips[] array for usage tracking.
      // Each segment in a multi-clip entry is counted once at the entry's sentence_index.
      const usageRows = editListEntries.flatMap((e) =>
        (e.clips ?? []).map((seg) => ({
          clip_id: seg.clip_id,
          job_id,
          edit_list_id: savedEditList.id,
          sentence_index: e.sentence_index,
        })),
      );

      if (usageRows.length > 0) {
        await db.insert(clipUsage).values(usageRows);
      }
    }

    // Increment times_used counter for each distinct clip (across all segments)
    const usedIds = [
      ...new Set(
        editListEntries.flatMap((e) => (e.clips ?? []).map((s) => s.clip_id)),
      ),
    ];

    for (const clipId of usedIds) {
      await db.execute(sql`
        UPDATE clips
        SET times_used = times_used + 1, last_used_at = NOW()
        WHERE id = ${clipId}
      `);
    }

    logger.info(
      { job_id, clips_incremented: usedIds.length },
      "Clip usage analytics recorded",
    );

    // ── Dispatch next step ─────────────────────────────────────────────────

    if (config.hitl_clip_review) {
      // Human reviews edit list before rendering
      await updateJobStatusAndDispatch(
        db,
        job_id,
        "AWAITING_CLIP_REVIEW",
        queues,
        "Clip selection complete — awaiting human review",
      );
      logger.info({ job_id }, "Job advanced to AWAITING_CLIP_REVIEW");
    } else {
      // Auto-approved — go straight to QMS
      await updateJobStatusAndDispatch(
        db,
        job_id,
        "QMS_VALIDATING",
        queues,
        "Clip selection complete — auto-approved",
      );
      logger.info({ job_id }, "Job advanced to QMS_VALIDATING");
    }
  };
}
