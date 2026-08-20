import type { Job, Queue } from "bullmq";
import { eq, and, isNull, sql } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import {
  contentJobs,
  contentTemplates,
  assets,
  formatStyleLibraries,
  formatStyleLibraryAssets,
  narrators,
  createSystemEvent,
  clipLibraryConfigs,
  getChannelVoice,
} from "@repo/db";
import { updateJobStatus } from "../utils/update-job-status.js";
import { assemblePerVideoAssets } from "../utils/per-video-assets.js";
import { runAutoImageQc } from "../utils/image-qc.js";
import { join } from "node:path";
import {
  getPacingConfig,
  getPacingZone,
  buildErrorDetail,
  type PacingConfig,
} from "@repo/contracts";
import type { SentenceImage } from "@repo/contracts";
import { loadConfig } from "@repo/config";
import { generateASSFile } from "@repo/media-core";
import { ai33TTSCircuitBreaker } from "../utils/ai33-circuit-breaker.js";
import { splitIntoClauses } from "../utils/clause-splitter.js";

interface AssetCollectionPayload {
  job_id: string;
}

// ---------------------------------------------------------------------------
// Seeded PRNG helpers for reproducible late-body grouping
// ---------------------------------------------------------------------------

/** Mulberry32 — fast, seeded PRNG. Returns values in [0, 1). */
function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable numeric hash of a string. */
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Assign group_index to sentence images for late-body pacing.
 *
 * Hook and early_body zones: every sentence gets its own group
 * (group_index === position in array).
 *
 * Late body: sentences are randomly grouped (2-4 per group based on PacingConfig).
 * Groups never span layout boundaries — each layout stretch gets independent grouping.
 *
 * Returns a new array — does not mutate input.
 */
function assignGroups(
  sentenceImages: SentenceImage[],
  zone: "hook" | "early_body" | "late_body",
  config: PacingConfig,
  rng: () => number,
): SentenceImage[] {
  // PERMANENT: Always assign 1 image per sentence (1:1 mapping, no grouping).
  //
  // Rationale (2026-05-10):
  // - User feedback: sentence grouping "doesn't make sense for the current use case"
  // - Visual quality: Every sentence gets a unique image → better retention
  // - Render compatibility: Ken Burns seed = scene_index * 1000 + group_index
  //   → 1:1 mapping ensures unique animations per sentence
  // - API cost: Not a concern (AI33 handles 40-50 images/video easily)
  //
  // Technical details:
  // - computeSentenceImageTimings() (packages/domain/src/pacing.ts:359) groups
  //   consecutive sentences with the same group_index into one image segment
  // - With 1:1 mapping, each sentence becomes its own segment → max visual variety
  // - Original late_body grouping (2-4 sentences per image) was designed to reduce
  //   API costs, but user testing showed it hurt engagement
  //
  // DO NOT re-enable grouping without user research validating the value.
  return sentenceImages.map((img, i) => ({ ...img, group_index: i }));

  /* ORIGINAL GROUPING LOGIC (archived for reference, DO NOT re-enable):
  if (zone !== "late_body") {
    return sentenceImages.map((img, i) => ({ ...img, group_index: i }));
  }

  const result: SentenceImage[] = [];
  let groupIdx = 0;
  let i = 0;

  while (i < sentenceImages.length) {
    // Find consecutive sentences with same layout_type
    const currentLayout = sentenceImages[i]!.layout_type;
    let layoutStretchEnd = i + 1;
    while (
      layoutStretchEnd < sentenceImages.length &&
      sentenceImages[layoutStretchEnd]!.layout_type === currentLayout
    ) {
      layoutStretchEnd++;
    }

    // Apply grouping within this layout stretch
    while (i < layoutStretchEnd) {
      const remaining = layoutStretchEnd - i;
      const min = config.late_body_sentences_per_image_min;
      const max = config.late_body_sentences_per_image_max;
      const groupSize = Math.min(remaining, Math.max(1, Math.floor(rng() * (max - min + 1)) + min));
      for (let j = 0; j < groupSize; j++) {
        result.push({ ...sentenceImages[i + j]!, group_index: groupIdx });
      }
      groupIdx++;
      i += groupSize;
    }
  }

  return result;
  */
}

/**
 * Split sentence_images at clause boundaries for hook zone scenes.
 * Each clause (comma/semicolon/em-dash separated) gets its own image slot
 * using the same prompt as its parent sentence — generates visually distinct
 * images for rapid sub-sentence switching.
 */
function splitIntoClauseSentenceImages(
  sentenceImages: SentenceImage[],
): SentenceImage[] {
  const result: SentenceImage[] = [];
  for (const si of sentenceImages) {
    // Only split on meaningful clause boundaries (semicolons, em-dashes)
    // NOT commas - they're too granular and create micro-clauses
    const clauses = si.sentence_text
      .split(/\s*;\s*|\s+—\s+/) // Semicolon or em-dash only
      .map((s) => s.trim())
      .filter((s) => s.length > 15); // Minimum 15 chars (avoid micro-clauses)

    // Only split if we get 2-4 meaningful clauses (avoid over-splitting)
    if (clauses.length >= 2 && clauses.length <= 4) {
      for (const clause of clauses) {
        result.push({
          ...si,
          sentence_text: clause,
          group_index: null,
          r2_key: null,
        } as SentenceImage);
      }
    } else {
      result.push(si);
    }
  }
  return result;
}

/**
 * Persist an updated assembly manifest back to the database.
 *
 * Uses a SELECT FOR UPDATE row lock inside a transaction to prevent lost-update
 * races when multiple asset-collection invocations for the same job run concurrently
 * (e.g. two image completions arrive in rapid succession and both re-trigger this
 * processor before either has committed its group-assignment write).
 *
 * The caller computes the manifest from the row it already read, so the lock here
 * is a defence-in-depth measure: it serialises concurrent writes at the DB level
 * and guarantees the caller's computed manifest is written atomically.  If a
 * contending transaction is already holding the lock, this call blocks until that
 * transaction commits, then overwrites with the caller's version (which is safe
 * because group assignments are deterministic — the same input always produces the
 * same output, so the "last write wins" is idempotent for grouping).
 */
async function persistManifest(
  db: DrizzleClient,
  jobId: string,
  manifest: unknown,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Acquire a row-level lock AND read the current manifest atomically.
    // This serialises against the concurrent image-completion handler in
    // ai-generation.ts, which writes sentence_images[*].r2_key in its own
    // locked transaction.
    const [locked] = await tx
      .select({
        id: contentJobs.id,
        assembly_manifest: contentJobs.assembly_manifest,
      })
      .from(contentJobs)
      .where(eq(contentJobs.id, jobId))
      .for("update")
      .limit(1);

    if (!locked) {
      throw new Error(`persistManifest: job ${jobId} not found`);
    }

    // BUG FIX (scene 0 r2_key null): the in-memory `manifest` passed in here was
    // read at the start of the asset-collection invocation, OUTSIDE this lock.
    // While this invocation runs Pass 2 (dispatch), fast images — especially
    // scene 0, which has the highest dispatch priority — complete and write their
    // r2_key directly into the DB manifest. Blindly writing our stale copy back
    // would clobber those r2_keys to null. Merge any r2_key / enriched prompt the
    // DB has for a given sentence image that our in-memory copy is still missing.
    const incoming = manifest as any;
    const current = locked.assembly_manifest as any;
    if (
      incoming?.scenes &&
      Array.isArray(incoming.scenes) &&
      current?.scenes &&
      Array.isArray(current.scenes)
    ) {
      const currentScenesByIndex = new Map<number, any>();
      for (const s of current.scenes) {
        if (s && typeof s.scene_index === "number") {
          currentScenesByIndex.set(s.scene_index, s);
        }
      }
      for (const scene of incoming.scenes) {
        const dbScene = currentScenesByIndex.get(scene?.scene_index);
        if (!dbScene) continue;
        const incomingImgs: any[] = scene?.sentence_images ?? [];
        const dbImgs: any[] = dbScene?.sentence_images ?? [];
        for (let i = 0; i < incomingImgs.length; i++) {
          const dbImg = dbImgs[i];
          if (!dbImg) continue;
          // Preserve r2_key written by a concurrent image-completion handler.
          if (!incomingImgs[i].r2_key && dbImg.r2_key) {
            incomingImgs[i].r2_key = dbImg.r2_key;
          }
          // Preserve enriched prompt likewise.
          if (
            !incomingImgs[i].enriched_image_prompt &&
            dbImg.enriched_image_prompt
          ) {
            incomingImgs[i].enriched_image_prompt = dbImg.enriched_image_prompt;
          }
        }
      }
    }

    await tx
      .update(contentJobs)
      .set({ assembly_manifest: incoming as any, updated_at: new Date() })
      .where(eq(contentJobs.id, jobId));
  });
}

// ---------------------------------------------------------------------------

/**
 * Asset Collection Processor
 *
 * Template-driven coordinator that checks what automated assets are still needed
 * and dispatches generation jobs for each missing asset in parallel.
 *
 * This processor is re-invoked every time an individual asset completes
 * (scene image). It acts as a convergence check.
 *
 * Template pipeline_config flags (stored in template.metadata.pipeline_config):
 *
 *   needs_scene_analysis: boolean
 *     If true, check that assembly_manifest is populated before proceeding.
 *     If not, dispatch to queue-scene-analysis and wait.
 *
 *   no_tts: boolean
 *     If true, skip TTS generation. Used when pre-recorded footage IS the
 *     audio source (e.g. avatar-driven formats).
 *
 *   awaiting_va_after_automated: boolean
 *     If true, after all automated assets are collected, transition to
 *     AWAITING_PRODUCTION_VA instead of QMS_VALIDATING. The VA must then upload
 *     footage, which triggers the QMS dispatch directly.
 *
 * Asset collection flow for avatar-footage formats (no_tts):
 *   1. Check needs_scene_analysis → dispatch scene-analysis if no assembly_manifest
 *   2. Dispatch image gen for each sentence image without an r2_key
 *   3. If still waiting on any → return (re-invoked when assets complete)
 *   4. All automated assets done → AWAITING_PRODUCTION_VA
 *
 * Asset collection flow for legacy formats (TTS-based):
 *   1. Dispatch audio/tts if missing
 *   2. All collected → QMS_VALIDATING
 */
export function createAssetCollectionProcessor(
  db: DrizzleClient,
  queues: {
    aiGeneration: Queue;
    assetCollection: Queue;
    sceneAnalysis?: Queue;
    qmsValidation?: Queue;
    clipSelection?: Queue;
  },
) {
  const config = loadConfig();

  console.log(
    JSON.stringify({
      level: "info",
      message: "Asset collection processor factory called",
      timestamp: new Date().toISOString(),
    }),
  );

  // Route to CLIP_SELECTION when a clip library config exists for this format/channel,
  // otherwise fall through to QMS_VALIDATING. Called at both auto-QC pass and
  // fully-automated dispatch points to keep the branching DRY.
  async function dispatchPostAssets(
    jobId: string,
    format: string,
    channelId: string | null,
  ): Promise<void> {
    // Look up clip library config. When the job has a channel, prefer a
    // channel-specific config but fall back to the global config (channel_id IS
    // NULL) so that a single shared config works for all channels.
    let clipConfig: typeof clipLibraryConfigs.$inferSelect | undefined;

    if (channelId) {
      const [channelSpecific] = await db
        .select()
        .from(clipLibraryConfigs)
        .where(
          and(
            eq(clipLibraryConfigs.format, format as any),
            eq(clipLibraryConfigs.clip_selection_enabled, true),
            eq(clipLibraryConfigs.channel_id, channelId),
          ),
        )
        .limit(1);
      clipConfig = channelSpecific;
    }

    if (!clipConfig) {
      const [globalConfig] = await db
        .select()
        .from(clipLibraryConfigs)
        .where(
          and(
            eq(clipLibraryConfigs.format, format as any),
            eq(clipLibraryConfigs.clip_selection_enabled, true),
            isNull(clipLibraryConfigs.channel_id),
          ),
        )
        .limit(1);
      clipConfig = globalConfig;
    }

    if (clipConfig) {
      // Store clip_config_id in job metadata so dispatch-next can read it
      await db
        .update(contentJobs)
        .set({
          metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ clip_config_id: clipConfig.id })}::jsonb`,
        })
        .where(eq(contentJobs.id, jobId));

      await updateJobStatus(db, jobId, "CLIP_SELECTION");

      if (queues.clipSelection) {
        await queues.clipSelection.add(
          "select-clips",
          { job_id: jobId, config_id: clipConfig.id },
          { jobId: `clip-selection-${jobId}`, removeOnComplete: true },
        );
      }

      console.log(
        JSON.stringify({
          level: "info",
          message: "Clip selection enabled — routed to CLIP_SELECTION",
          job_id: jobId,
          clip_config_id: clipConfig.id,
        }),
      );
    } else {
      await updateJobStatus(db, jobId, "QMS_VALIDATING");
      if (queues.qmsValidation) {
        await queues.qmsValidation.add("validate-pre-render", {
          job_id: jobId,
          validation_stage: "pre-render" as const,
        });
      }

      console.log(
        JSON.stringify({
          level: "info",
          message: "No clip config — routed to QMS_VALIDATING",
          job_id: jobId,
        }),
      );
    }
  }

  return async (job: Job<AssetCollectionPayload>) => {
    console.log(
      JSON.stringify({
        level: "info",
        message: "!!! PROCESSOR FUNCTION CALLED !!!",
        timestamp: new Date().toISOString(),
        has_job: !!job,
        has_data: !!job?.data,
        bullmq_job_id: job?.id,
      }),
    );

    const jobId = job.data.job_id;

    console.log(
      JSON.stringify({
        level: "info",
        message: "Asset collection processor ENTRY POINT",
        job_id: jobId,
        bullmq_job_id: job.id,
        timestamp: new Date().toISOString(),
      }),
    );

    try {
      console.log(
        JSON.stringify({
          level: "info",
          message: "Asset collection processor invoked",
          job_id: jobId,
        }),
      );

      // 1. Fetch job + template
      const [contentJob] = await db
        .select()
        .from(contentJobs)
        .where(eq(contentJobs.id, jobId))
        .limit(1);

      if (!contentJob) throw new Error(`Job ${jobId} not found`);

      const [template] = await db
        .select()
        .from(contentTemplates)
        .where(eq(contentTemplates.id, contentJob.template_id))
        .limit(1);

      if (!template)
        throw new Error(`Template ${contentJob.template_id} not found`);

      // BUSINESS_PLAN_HUB: the whole asset stage lives in its own processor —
      // TTS (Fish), Whisper sentence anchoring, the RMS envelope, visual
      // sourcing through the visual gateway, finance figures and the scene
      // plan. It ends by transitioning to QMS_VALIDATING itself, so this branch
      // returns and never reaches the generic pipeline_config path below.
      //
      // Deliberately NOT routed through dispatchPostAssets: that helper diverts
      // to CLIP_SELECTION when a clip_library_configs row exists for the format,
      // and this format has no clip-library step (O5 handoff §1).
      if (template.format === "BUSINESS_PLAN_HUB") {
        console.log(
          JSON.stringify({
            level: "info",
            message:
              "BUSINESS_PLAN_HUB format: running business-hub asset stage",
            job_id: jobId,
          }),
        );
        const { runBusinessHubAssetStage } =
          await import("./business-hub/pipeline.js");
        const result = await runBusinessHubAssetStage({
          db,
          jobId,
          job: contentJob,
          template,
          queues,
        });
        console.log(
          JSON.stringify({
            level: "info",
            message: "BUSINESS_PLAN_HUB asset stage complete",
            job_id: jobId,
            scene_count: result.sceneCount,
            sourced_visuals: result.sourcedVisuals,
            needs_review_visuals: result.needsReviewVisuals,
            dispatched_to: result.dispatchedTo,
          }),
        );
        return;
      }

      // RANKING: gather real product footage per item via the footage gateway
      // (yt-dlp + Pexels), write URLs into job metadata, then advance. User
      // requirement: real marketing footage dominates over motion graphics.
      if (template.format === "RANKING") {
        console.log(
          JSON.stringify({
            level: "info",
            message: "RANKING format: collecting per-item footage",
            job_id: jobId,
          }),
        );
        const { collectRankingFootage } =
          await import("./ranking/ranking-footage-collection.js");
        const updatedRanking = await collectRankingFootage({
          db,
          jobId,
          metadata: contentJob.metadata,
        });

        // Narration: RANKING has no dedicated TTS state, so generate audio
        // inline here (like drama) from the clean script ai-generation stored,
        // then persist metadata.ranking.audioUrl for the render worker.
        const jobLanguage = contentJob.language ?? "en";
        const cfg = loadConfig();
        const channelId = contentJob.channel_id;
        if (!channelId) {
          throw new Error(`RANKING job ${jobId}: missing channel_id`);
        }
        /**
         * ── The channel's own voice, like every other format ──────────────────
         * Verbatim: "in the ranking format I would use the voice we use for the
         * other two channels too from fish audio."
         *
         * This resolution used to be `metadata.voice_id ?? DEFAULT_VOICE_EN`,
         * and NO RANKING job has ever carried a metadata.voice_id — all four on
         * production read "(none)". So every ranking video ever made was
         * narrated by DEFAULT_VOICE_EN (Fish — Alok), while the very channels
         * those jobs belong to had a different Fish voice bound to them and the
         * tutorial pipeline was honouring it. The binding was not missing; it
         * was simply never read here.
         *
         * Order matches tutorial/generate.ts: an explicit per-job voice wins, the
         * channel binding comes next, the env default is the last resort.
         */
        const channelVoice = await getChannelVoice(db, channelId);
        const voiceId =
          (contentJob.metadata as { voice_id?: string } | null)?.voice_id ??
          channelVoice?.id ??
          (jobLanguage === "de" ? cfg.DEFAULT_VOICE_DE : cfg.DEFAULT_VOICE_EN);
        if (!voiceId) {
          throw new Error(
            `RANKING job ${jobId}: no TTS voice (checked metadata.voice_id, the channel binding, and DEFAULT_VOICE_${jobLanguage.toUpperCase()})`,
          );
        }
        console.log(
          JSON.stringify({
            level: "info",
            message: "RANKING narration voice resolved",
            job_id: jobId,
            channel_id: channelId,
            voice_id: voiceId,
            source: (contentJob.metadata as { voice_id?: string } | null)
              ?.voice_id
              ? "job"
              : channelVoice
                ? `channel:${channelVoice.name}`
                : "env_default",
          }),
        );
        if (!contentJob.script || contentJob.script.trim().length < 10) {
          throw new Error(
            `RANKING job ${jobId}: script missing/too short for narration`,
          );
        }
        const { generateRankingNarration } =
          await import("./ranking/ranking-tts.js");
        const { audioPath, wordTimestamps } = await generateRankingNarration({
          db,
          jobId,
          channelId,
          script: contentJob.script,
          voiceId,
          language: jobLanguage,
        });

        // Narration anchoring: locate each item's first mention in the Whisper
        // word stream and persist per-item [narrationStartMs, narrationEndMs].
        // The render + B-roll studio anchor each item's shots to its real spoken
        // span (B-roll fills the middle) instead of a fixed offset.
        const { computeItemNarrationSegments } =
          await import("./ranking/narration-anchoring.js");
        const anchoring = computeItemNarrationSegments({
          jobId,
          items: updatedRanking.items,
          placements: updatedRanking.rankingPlan?.placements ?? [],
          wordTimestamps,
        });
        // The anchored window is only knowable HERE — footage collection ran
        // before Whisper, so it could only seed each block's default B-roll fill
        // with the fixed 4000ms constant. A narration-anchored block is 44-58
        // SECONDS, and every B-Roll Studio control is sum-preserving, so a block
        // that arrives 5-13x too short can never satisfy the approve gate and no
        // VA can fix it by hand. Re-seed through the same helper now that the
        // real window exists. Only untouched seeds are rewritten; a VA-shaped
        // selection is left exactly as it is.
        const { reseedDefaultBrollSelections } =
          await import("./ranking/broll-default-selection.js");
        const anchoredItems = reseedDefaultBrollSelections(anchoring.items);

        const baseMeta =
          contentJob.metadata &&
          typeof contentJob.metadata === "object" &&
          !Array.isArray(contentJob.metadata)
            ? (contentJob.metadata as Record<string, unknown>)
            : {};
        await db
          .update(contentJobs)
          .set({
            metadata: {
              ...baseMeta,
              ranking: {
                ...updatedRanking,
                items: anchoredItems,
                audioUrl: `file://${audioPath}`,
                wordTimestamps,
              },
            } as any,
            updated_at: new Date(),
          })
          .where(eq(contentJobs.id, jobId));

        // Anchoring is ALL-OR-NOTHING downstream (`allItemsAnchored`): if even
        // one item is unlocated, the composition reverts the WHOLE job to the
        // fixed ~8.5s-per-item cadence while the narration runs ~40s per item.
        // That renders "successfully" and is completely desynced — the silent
        // fallback this codebase forbids. Fail here, cheaply, with the item
        // names an operator can actually act on.
        //
        // Thrown AFTER the metadata write on purpose: the narration mp3, the
        // word timestamps and whatever segments we DID resolve are all
        // persisted first, so a retry costs no TTS and an operator can inspect
        // exactly which item failed to match.
        if (!anchoring.anchored) {
          throw new Error(
            `RANKING job ${jobId}: narration anchoring incomplete — ` +
              `${updatedRanking.items.length - anchoring.unmatched.length}/${updatedRanking.items.length} ` +
              `items located in the narration. Unlocated: ${anchoring.unmatched.join(", ") || "(none reported)"}. ` +
              `The render switches to anchored timing all-or-nothing, so shipping ` +
              `this job would fall back to a fixed ~8.5s-per-item cadence against ` +
              `~40s of actual narration per item — it would render and be unusable. ` +
              `Fix: open this job in the Ranking tab, correct the unlocated item ` +
              `name(s) to match what the narrator actually says, then press Retry. ` +
              `Narration audio is already saved at ${audioPath} and will not be ` +
              `regenerated.`,
          );
        }

        // Gate on review mode. RANKING defaults to asset_quality_loop: the job
        // pauses at AWAITING_VA_REVIEW so a VA picks/trims B-roll per block in
        // the selection studio. full_auto skips straight to QMS with the
        // first-fetched candidates.
        const rankingJobMode =
          (updatedRanking as { jobMode?: string }).jobMode ??
          "asset_quality_loop";
        if (rankingJobMode === "asset_quality_loop") {
          await updateJobStatus(db, jobId, "AWAITING_VA_REVIEW");
        } else {
          await dispatchPostAssets(
            jobId,
            template.format,
            contentJob.channel_id,
          );
        }
        return;
      }

      // Merge pipeline_config from template and job (job overrides template)
      // Support both 'pipeline_config' and 'production_config' for backwards compatibility
      const templatePipelineConfig =
        (template.metadata as any)?.pipeline_config ??
        (template.metadata as any)?.production_config ??
        {};
      const jobPipelineConfig =
        (contentJob.metadata as any)?.pipeline_config ??
        (contentJob.metadata as any)?.production_config ??
        {};
      const pipelineConfig = {
        ...templatePipelineConfig,
        ...jobPipelineConfig,
      };

      const needsSceneAnalysis: boolean =
        pipelineConfig.needs_scene_analysis === true;
      const noTTS: boolean = pipelineConfig.no_tts === true;
      const awaitVAAfterAutomated: boolean =
        pipelineConfig.awaiting_va_after_automated === true;
      // Job inherits archetype_id from template at creation time
      const archetypeId: string | undefined =
        contentJob.archetype_id ?? undefined;

      // ── Style-guide validation gate ───────────────────────────────────────────
      // TEMPORARILY DISABLED FOR TESTING - Re-enable when style guides are uploaded
      // If this template has a linked archetype, require an approved style_guide
      // asset before any image generation can proceed. A missing style guide means
      // every generated image will have inconsistent style — fail fast with a
      // clear operator message.
      /*
      if (archetypeId) {
        const styleGuide = await db
          .select({ id: assets.id })
          .from(assets)
          .where(
            and(
              eq(assets.archetype_id, archetypeId),
              eq(assets.asset_type, "style_guide"),
              eq(assets.status, "approved"),
            )
          )
          .limit(1)
          .then((rows) => rows[0] ?? null);

        if (!styleGuide) {
          const msg = `Archetype ${archetypeId} has no approved style_guide asset — upload one in the Style Library before generating images`;
          console.error(JSON.stringify({ level: "error", message: msg, job_id: jobId, archetype_id: archetypeId }));

          // Emit system event for real-time operator notification via SSE
          await createSystemEvent({
            event_type: "style_guide.validation_failed",
            job_id: jobId,
            payload: {
              archetype_id: archetypeId,
              error: msg,
              severity: "critical",
              action_required: "Upload approved style_guide asset to archetype in Style Library",
            },
          });

          await updateJobStatus(
            db,
            jobId,
            "FAILED_QMS",
            msg,
            buildErrorDetail({
              code: "STYLE_GUIDE_MISSING",
              message: msg,
              category: "media_validation",
              retryable: false,
              context: { archetype_id: archetypeId, job_id: jobId },
            })
          );
          return;
        }
      }
      */

      // ── Per-video reference folder assembly ───────────────────────────────────
      // Assemble the per-video reference folder once (guard: metadata.per_video_assets already set).
      // This folder holds the resolved style guide, character, and background images
      // and is used by ai-generation.ts to pass reference images to AI33.
      const existingPerVideoAssets = (contentJob.metadata as any)
        ?.per_video_assets;
      if (!existingPerVideoAssets && archetypeId) {
        const localMediaRoot =
          process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";
        const refDir = join(localMediaRoot, jobId, "ref");
        try {
          const perVideoAssets = await assemblePerVideoAssets(
            db,
            {
              ...(contentJob.channel_id
                ? { channel_id: contentJob.channel_id }
                : {}),
              ...(archetypeId ? { archetype_id: archetypeId } : {}),
              ...(contentJob.format ? { format: contentJob.format } : {}),
            },
            refDir,
          );
          // Persist the map into job metadata using JSONB merge to avoid race conditions
          const perVideoAssetsJson = JSON.stringify(perVideoAssets);

          console.log(
            JSON.stringify({
              level: "debug",
              message: "About to update job metadata with per_video_assets",
              job_id: jobId,
              per_video_assets_json_length: perVideoAssetsJson.length,
              per_video_assets_preview: perVideoAssetsJson.slice(0, 200),
            }),
          );

          // Use execute() with raw SQL to bypass Drizzle's parameter handling
          // Escape backslashes first, then single quotes for PostgreSQL
          const escapedJson = perVideoAssetsJson
            .replace(/\\/g, "\\\\")
            .replace(/'/g, "''");
          await db.execute(
            sql.raw(`
            UPDATE content_jobs
            SET
              metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('per_video_assets', '${escapedJson}'::jsonb),
              updated_at = NOW()
            WHERE id = '${jobId}'
          `),
          );

          console.log(
            JSON.stringify({
              level: "debug",
              message: "Database update completed (awaited)",
            }),
          );

          // VERIFICATION: Immediately read back to confirm write succeeded
          const [verifyJob] = await db
            .select()
            .from(contentJobs)
            .where(eq(contentJobs.id, jobId))
            .limit(1);
          const verifyMeta = verifyJob?.metadata as any;
          console.log(
            JSON.stringify({
              level: "debug",
              message: "VERIFICATION READ after update",
              job_id: jobId,
              has_per_video_assets: !!verifyMeta?.per_video_assets,
              metadata_keys: verifyMeta ? Object.keys(verifyMeta) : [],
            }),
          );

          console.log(
            JSON.stringify({
              level: "info",
              message: "per_video_assets saved to job metadata",
              job_id: jobId,
              ref_dir: refDir,
              asset_types: Object.keys(perVideoAssets),
              style_guide_count: perVideoAssets.style_guide ? 1 : 0,
              character_count: perVideoAssets.characters?.length ?? 0,
              background_count: perVideoAssets.backgrounds?.length ?? 0,
              layout_reference_count: perVideoAssets.layout_reference ? 1 : 0,
            }),
          );

          // CRITICAL: Small delay to ensure database write is committed and propagated
          // before scene analysis dispatches image generation jobs. Without this, image
          // generation jobs fetch the job record before per_video_assets appears in metadata.
          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (err) {
          // Non-fatal — log and continue without reference images (generation proceeds, just less consistent)
          console.error(
            JSON.stringify({
              level: "error",
              message:
                "Per-video asset assembly failed — proceeding without reference images",
              job_id: jobId,
              error: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            }),
          );
        }
      }

      // ── State Recovery for Failed Jobs ───────────────────────────────────────
      // If job is in a failed state but all assets are actually complete, recover
      // automatically instead of requiring manual intervention. This handles cases
      // where external service failures (Minimax down, API errors) put the job in
      // FAILED_GENERAL but the underlying assets were already collected successfully.
      const currentMetadata =
        (contentJob.metadata as Record<string, unknown>) ?? {};
      const isFailed =
        contentJob.status === "FAILED_GENERAL" ||
        contentJob.status === "FAILED_QMS" ||
        contentJob.status === "TECH_FOOTAGE_FAILED"; // graceful degradation: footage failed, fall through to asset collection

      if (isFailed) {
        console.log(
          JSON.stringify({
            level: "info",
            message:
              "Job in failed state — checking if assets are complete for auto-recovery",
            job_id: jobId,
            current_status: contentJob.status,
          }),
        );

        // Check if all required assets are actually present
        const assemblyManifest = contentJob.assembly_manifest as any;
        const r2Manifest = Array.isArray(contentJob.r2_asset_manifest)
          ? (contentJob.r2_asset_manifest as any[])
          : [];
        const hasTTS = r2Manifest.some((a: any) => a.type === "audio/tts");

        let allAssetsComplete = true;
        const missingAssets: string[] = [];

        // Check TTS (if required)
        if (!noTTS && !hasTTS && !contentJob.narration_source_path) {
          allAssetsComplete = false;
          missingAssets.push("TTS audio");
        }

        // Check sentence images (if scene analysis was required)
        if (needsSceneAnalysis && assemblyManifest?.scenes) {
          const totalScenes = (assemblyManifest.scenes as any[]).length;
          for (const scene of assemblyManifest.scenes as any[]) {
            const sceneZone = getPacingZone(
              scene.scene_index as number,
              totalScenes,
              getPacingConfig(template.render_config),
            );
            if (
              scene.visual_type === "AVATAR_ON_CAMERA" &&
              sceneZone !== "hook"
            )
              continue;

            const sentenceImages: any[] | undefined = scene.sentence_images;
            if (!sentenceImages?.length) continue;

            // Check group heads for r2_key (skip AVATAR_FULLSCREEN)
            // Also check for generation_status === 'failed' to detect hard failures
            const seenGroups = new Set<number>();
            for (const img of sentenceImages) {
              const gIdx = img.group_index ?? 0;
              if (!seenGroups.has(gIdx)) {
                seenGroups.add(gIdx);

                // Check if this image failed generation (marked by ai-generation processor)
                // Only treat as failed if r2_key is also missing (retry may have succeeded)
                if (img.generation_status === "failed" && !img.r2_key) {
                  allAssetsComplete = false;
                  const prompt = img.image_prompt?.slice(0, 50) ?? "no prompt";
                  missingAssets.push(
                    `Scene ${scene.scene_index}, image ${gIdx} FAILED: ${prompt}...`,
                  );
                }
                // Check if r2_key is missing (still pending)
                else if (
                  img.layout_type !== "AVATAR_FULLSCREEN" &&
                  !img.r2_key
                ) {
                  allAssetsComplete = false;
                  const prompt = img.image_prompt?.slice(0, 50) ?? "no prompt";
                  missingAssets.push(
                    `Scene ${scene.scene_index}, image ${gIdx}: ${prompt}...`,
                  );
                }
              }
            }
          }
        }

        if (allAssetsComplete) {
          // EXPLICIT AUTO-RECOVERY: Job failed but assets are now complete
          // Log as WARNING so operators are notified of automatic recovery
          console.warn(
            JSON.stringify({
              level: "warn",
              message:
                "AUTO-RECOVERY: Job in failed state but all assets now complete — automatically recovering",
              job_id: jobId,
              previous_status: contentJob.status,
              previous_error: contentJob.error_message,
              recovery_action: "Resetting to ASSET_COLLECTION",
              operator_action: "Monitor job for repeated failures",
            }),
          );

          // Keep error history instead of clearing it
          const recoveryMessage = `Auto-recovered from ${contentJob.status}: ${contentJob.error_message || "unknown error"}`;

          // Reset to ASSET_COLLECTION to allow pipeline progression
          await db
            .update(contentJobs)
            .set({
              status: "ASSET_COLLECTION",
              error_message: recoveryMessage,
              error_detail: null,
              metadata: sql`COALESCE(metadata, '{}'::jsonb) || '{"convergence_check_count": 0}'::jsonb`,
              status_updated_at: new Date(),
              updated_at: new Date(),
            })
            .where(eq(contentJobs.id, jobId));

          console.warn(
            JSON.stringify({
              level: "warn",
              message:
                "AUTO-RECOVERY: Job recovered — continuing pipeline (monitor for issues)",
              job_id: jobId,
              recovery_note: recoveryMessage,
            }),
          );

          // Re-fetch job with updated status to continue normal flow
          const [recoveredJob] = await db
            .select()
            .from(contentJobs)
            .where(eq(contentJobs.id, jobId))
            .limit(1);

          if (recoveredJob) {
            Object.assign(contentJob, recoveredJob);
          }
        } else {
          // Assets still missing: reset to ASSET_COLLECTION and fall through to dispatch them.
          // Returning early here would leave the job permanently stuck — images would never
          // be dispatched because asset-collection only dispatches in non-failed status.
          console.warn(
            JSON.stringify({
              level: "warn",
              message:
                "Job in failed state with incomplete assets — resetting to ASSET_COLLECTION to dispatch missing items",
              job_id: jobId,
              missing_assets: missingAssets,
            }),
          );

          const recoveryMessage = `Auto-recovered from ${contentJob.status} (assets incomplete, will re-dispatch): ${contentJob.error_message || "unknown error"}`;
          await db
            .update(contentJobs)
            .set({
              status: "ASSET_COLLECTION",
              error_message: recoveryMessage,
              error_detail: null,
              metadata: sql`COALESCE(metadata, '{}'::jsonb) || '{"convergence_check_count": 0}'::jsonb`,
              status_updated_at: new Date(),
              updated_at: new Date(),
            })
            .where(eq(contentJobs.id, jobId));

          const [recoveredJob] = await db
            .select()
            .from(contentJobs)
            .where(eq(contentJobs.id, jobId))
            .limit(1);

          if (recoveredJob) {
            Object.assign(contentJob, recoveredJob);
          }
        }
      }

      // ── Convergence Timeout Protection ───────────────────────────────────────
      // Track how many times this processor has been re-invoked waiting for asset
      // convergence. If assets never complete (API failures, stuck jobs), timeout
      // after 150 re-checks to prevent infinite waiting.
      //
      // With 25-50 images per job and each completion triggering a check, we need
      // a high enough limit to allow all parallel generations to complete.
      // Individual images can take up to 10 minutes (AI33 MAX_POLL_ATTEMPTS = 120 × 5s).
      const convergenceCount =
        ((currentMetadata.convergence_check_count as number) ?? 0) + 1;

      await db
        .update(contentJobs)
        .set({
          metadata: sql`COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('convergence_check_count', ${convergenceCount}::int)`,
          updated_at: new Date(),
        })
        .where(eq(contentJobs.id, jobId));

      if (convergenceCount > 150) {
        // Gather diagnostic information about what assets are still missing
        const assemblyManifest = contentJob.assembly_manifest as any;
        const missingAssets: string[] = [];

        if (assemblyManifest?.scenes) {
          for (const scene of assemblyManifest.scenes as any[]) {
            const sentenceImages: any[] = scene.sentence_images ?? [];
            for (let i = 0; i < sentenceImages.length; i++) {
              const si = sentenceImages[i];
              // Check for hard failures first (only if r2_key also missing)
              if (si.generation_status === "failed" && !si.r2_key) {
                const prompt = si.image_prompt?.slice(0, 50) ?? "no prompt";
                missingAssets.push(
                  `Scene ${scene.scene_index}, image ${i} FAILED: ${prompt}...`,
                );
              }
              // Then check for missing r2_keys
              else if (!si.r2_key && si.layout_type !== "AVATAR_FULLSCREEN") {
                const prompt = si.image_prompt?.slice(0, 50) ?? "no prompt";
                missingAssets.push(
                  `Scene ${scene.scene_index}, image ${i}: ${prompt}...`,
                );
              }
            }
          }
        }

        const r2Manifest = Array.isArray(contentJob.r2_asset_manifest)
          ? (contentJob.r2_asset_manifest as any[])
          : [];
        const hasTTS = r2Manifest.some((a: any) => a.type === "audio/tts");

        if (!noTTS && !hasTTS && !contentJob.narration_source_path)
          missingAssets.push("TTS audio");

        await updateJobStatus(
          db,
          jobId,
          "FAILED_GENERAL",
          `Asset collection timeout after ${convergenceCount} attempts — ${missingAssets.length} assets never completed`,
          buildErrorDetail({
            code: "CONVERGENCE_TIMEOUT",
            message:
              "Asset collection stuck — some assets never completed after 150 re-checks",
            category: "asset_management",
            retryable: false,
            context: {
              convergence_attempts: convergenceCount,
              missing_count: missingAssets.length,
              missing_assets: missingAssets.slice(0, 10), // First 10 for diagnostics
            },
          }),
        );

        console.error(
          JSON.stringify({
            level: "error",
            message: "Asset collection convergence timeout",
            job_id: jobId,
            attempts: convergenceCount,
            missing_assets: missingAssets,
          }),
        );

        return;
      }

      // ── Style Collection Metadata Assembly ───────────────────────────────────
      // Assemble style collection reference metadata once (guard: metadata.style_refs_metadata not set).
      // This provides Claude with available style references to select from per scene.
      // ── Format Style Library Metadata Assembly (New System) ──────────────────
      // Check for new format_style_library_id first, prioritize over legacy style_collection_id
      const formatStyleLibraryId = (contentJob.metadata as any)
        ?.format_style_library_id;
      const existingStyleRefs = (contentJob.metadata as any)
        ?.style_refs_metadata;

      if (formatStyleLibraryId && !existingStyleRefs) {
        try {
          const [library] = await db
            .select()
            .from(formatStyleLibraries)
            .where(eq(formatStyleLibraries.id, formatStyleLibraryId))
            .limit(1);

          if (library) {
            const libraryAssets = await db
              .select({
                asset_id: formatStyleLibraryAssets.asset_id,
                ref_type: formatStyleLibraryAssets.ref_type,
                display_order: formatStyleLibraryAssets.display_order,
                file_path: assets.file_path,
                file_name: assets.file_name,
                description: assets.description,
              })
              .from(formatStyleLibraryAssets)
              .innerJoin(
                assets,
                eq(formatStyleLibraryAssets.asset_id, assets.id),
              )
              .where(
                eq(formatStyleLibraryAssets.library_id, formatStyleLibraryId),
              )
              .orderBy(formatStyleLibraryAssets.display_order);

            const currentMeta =
              (contentJob.metadata as Record<string, unknown>) ?? {};
            await db
              .update(contentJobs)
              .set({
                metadata: {
                  ...currentMeta,
                  style_text_guidelines: library.text_guidelines ?? null,
                  style_refs_metadata: libraryAssets.map((a) => ({
                    asset_id: a.asset_id,
                    file_path: a.file_path ?? "",
                    file_name: a.file_name ?? "",
                    ref_type: a.ref_type,
                    description: a.description ?? "",
                  })),
                } as any,
                updated_at: new Date(),
              })
              .where(eq(contentJobs.id, jobId));

            console.log(
              JSON.stringify({
                level: "info",
                message: "Format style library metadata assembled",
                job_id: jobId,
                library_id: formatStyleLibraryId,
                ref_count: libraryAssets.length,
              }),
            );
          }
        } catch (err) {
          console.error(
            JSON.stringify({
              level: "warn",
              message:
                "Format style library metadata assembly failed — proceeding without style refs",
              job_id: jobId,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }

      // ── Narrator Poses Metadata Assembly ──────────────────────────────────────
      // Assemble narrator pose metadata once (guard: metadata.narrator_poses_metadata not set).
      // This provides Claude with available narrator poses to select from per scene.
      const narratorId = (contentJob.metadata as any)?.narrator_id;
      const existingNarratorPoses = (contentJob.metadata as any)
        ?.narrator_poses_metadata;
      if (narratorId && !existingNarratorPoses) {
        try {
          // Fetch narrator
          const [narrator] = await db
            .select()
            .from(narrators)
            .where(eq(narrators.id, narratorId))
            .limit(1);

          if (narrator) {
            // Fetch narrator pose assets (tagged with #narrator:{id})
            const narratorTag = `#narrator:${narratorId}`;
            const poseAssets = await db
              .select({
                id: assets.id,
                file_path: assets.file_path,
                file_name: assets.file_name,
                tags: assets.tags,
              })
              .from(assets)
              .where(
                and(
                  eq(assets.asset_type, "narrator_pose"),
                  sql`${assets.tags} @> ARRAY[${narratorTag}]::text[]`,
                ),
              );

            // Extract pose names from tags
            const posesMetadata = poseAssets.map((p) => {
              const poseTag = p.tags?.find((t) => t.startsWith("#pose:"));
              const poseName = poseTag
                ? poseTag.replace("#pose:", "")
                : "unknown";
              return {
                asset_id: p.id,
                file_path: p.file_path || "",
                file_name: p.file_name || "",
                pose_name: poseName,
              };
            });

            // Store in job metadata for Claude to reference
            const currentMeta =
              (contentJob.metadata as Record<string, unknown>) ?? {};
            await db
              .update(contentJobs)
              .set({
                metadata: {
                  ...currentMeta,
                  narrator_poses_metadata: posesMetadata,
                } as any,
                updated_at: new Date(),
              })
              .where(eq(contentJobs.id, jobId));

            console.log(
              JSON.stringify({
                level: "info",
                message: "Narrator poses metadata assembled",
                job_id: jobId,
                narrator_id: narratorId,
                pose_count: posesMetadata.length,
              }),
            );
          }
        } catch (err) {
          console.error(
            JSON.stringify({
              level: "warn",
              message:
                "Narrator poses metadata assembly failed — proceeding without narrator",
              job_id: jobId,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }

      console.log(
        JSON.stringify({
          level: "debug",
          message: "ASSET_COLLECTION_DEBUG",
          job_id: jobId,
          needsSceneAnalysis,
          noTTS,
          awaitVAAfterAutomated,
          has_script: !!contentJob.script,
          pipeline_config: pipelineConfig,
        }),
      );

      // ── VIDEO_ESSAY / clip-selection-only fast-path ───────────────────────────
      // VIDEO_ESSAY jobs use real video clips instead of AI-generated images.
      // They still need TTS audio, but skip image generation entirely.
      // Check for a clip library config with clip_selection_enabled: true and,
      // if found, skip the rest of asset collection and dispatch to CLIP_SELECTION.
      //
      // We also normalise r2_asset_manifest here: the column defaults to {} (an empty
      // object) but every consumer expects a JSON array.  Any existing {} value is
      // treated as an empty manifest so the pipeline can continue safely.
      const jobFormat = (contentJob as any).format;

      if (jobFormat === "VIDEO_ESSAY") {
        // Normalise r2_asset_manifest in the DB if it is not yet an array.
        if (!Array.isArray(contentJob.r2_asset_manifest)) {
          await db
            .update(contentJobs)
            .set({
              r2_asset_manifest: sql`'[]'::jsonb`,
              updated_at: new Date(),
            })
            .where(eq(contentJobs.id, jobId));
          console.log(
            JSON.stringify({
              level: "info",
              message:
                "VIDEO_ESSAY: normalised r2_asset_manifest from object to array",
              job_id: jobId,
            }),
          );
        }

        // Check TTS — VIDEO_ESSAY may need narration audio (unless no_tts=true).
        const veManifest: Array<{ key: string; type: string }> = Array.isArray(
          contentJob.r2_asset_manifest,
        )
          ? (contentJob.r2_asset_manifest as any[])
          : [];
        const hasTTSForVE = veManifest.some((a) => a.type === "audio/tts");

        // Fall through to TTS dispatch ONLY when TTS is genuinely required but not
        // yet present. When no_tts=true the template doesn't need audio at all —
        // route straight to CLIP_SELECTION in that case.
        if (!hasTTSForVE && !contentJob.narration_source_path && !noTTS) {
          // TTS not yet available — let the normal TTS dispatch path below handle it.
          // Fall through so the existing TTS dispatch logic runs.
          console.log(
            JSON.stringify({
              level: "info",
              message: "VIDEO_ESSAY: TTS not yet ready, will dispatch TTS",
              job_id: jobId,
            }),
          );
        } else {
          // TTS ready, narration_source_path provided, OR no_tts=true — skip image
          // gen entirely and route directly to CLIP_SELECTION.
          console.log(
            JSON.stringify({
              level: "info",
              message:
                "VIDEO_ESSAY: TTS ready — skipping image generation, routing to CLIP_SELECTION",
              job_id: jobId,
              has_tts: hasTTSForVE,
              has_narration_source: !!contentJob.narration_source_path,
            }),
          );

          // Compute clause_timings and sentence_timings from word_timestamps before
          // dispatching to CLIP_SELECTION. clip-selection requires one of these to
          // assign clips to time windows — without them it cannot proceed.
          // This block must run here because the VIDEO_ESSAY path returns early,
          // before the clause_timings computation that runs later in the function.
          const veManifestFull = (contentJob.assembly_manifest as any) ?? {};
          if (
            veManifestFull.word_timestamps?.length &&
            contentJob.script &&
            !veManifestFull.clause_timings
          ) {
            const clauseTimings = splitIntoClauses(
              contentJob.script,
              veManifestFull.word_timestamps,
            );
            veManifestFull.clause_timings = clauseTimings;

            // Derive sentence_timings from clause_timings by grouping clauses by
            // sentence_index and taking min(start_ms) / max(end_ms) per sentence.
            type SentenceTiming = {
              sentence_index: number;
              text: string;
              start_ms: number;
              end_ms: number;
            };
            const sentenceMap = new Map<number, SentenceTiming>();
            for (const clause of clauseTimings) {
              const existing = sentenceMap.get(clause.sentence_index);
              if (!existing) {
                sentenceMap.set(clause.sentence_index, {
                  sentence_index: clause.sentence_index,
                  text: clause.text,
                  start_ms: clause.start_ms,
                  end_ms: clause.end_ms,
                });
              } else {
                existing.text = existing.text + " " + clause.text;
                existing.start_ms = Math.min(
                  existing.start_ms,
                  clause.start_ms,
                );
                existing.end_ms = Math.max(existing.end_ms, clause.end_ms);
              }
            }
            veManifestFull.sentence_timings = Array.from(
              sentenceMap.values(),
            ).sort((a, b) => a.sentence_index - b.sentence_index);

            await persistManifest(db, jobId, veManifestFull);
            console.log(
              JSON.stringify({
                level: "info",
                message:
                  "VIDEO_ESSAY: clause and sentence timings computed and stored",
                job_id: jobId,
                clause_count: clauseTimings.length,
                sentence_count: sentenceMap.size,
              }),
            );
          }

          await dispatchPostAssets(
            jobId,
            contentJob.format,
            contentJob.channel_id ?? null,
          );
          return;
        }
      }

      // ── Comparison format: auto-fetch product hero images ──────────────────
      // TECH_COMPARISON auto-fetches hero images via Pexels (+ DDG fallback).
      // No longer pauses for manual VA upload — images are fetched automatically.
      if (jobFormat === "TECH_COMPARISON") {
        const { fetchComparisonHeroImages } =
          await import("../utils/comparison-image-fetcher.js");
        const comparisonMeta = (contentJob.metadata as any)?.comparison ?? {};
        const products: Array<{
          slot: string;
          name: string;
          hero_asset_key?: string | null;
        }> = comparisonMeta.products ?? [];

        const missingHeroImages = products.filter((p) => !p.hero_asset_key);

        if (missingHeroImages.length > 0) {
          const pexelsApiKey = config.PEXELS_API_KEY ?? "";
          if (!pexelsApiKey) {
            console.warn(
              JSON.stringify({
                level: "warn",
                message:
                  "PEXELS_API_KEY not set — skipping hero image auto-fetch for TECH_COMPARISON",
                job_id: jobId,
              }),
            );
          } else {
            const jobMediaDir = join(
              config.LOCAL_MEDIA_ROOT,
              contentJob.channel_id,
              jobId,
            );
            const heroMap = await fetchComparisonHeroImages(
              products,
              jobMediaDir,
              pexelsApiKey,
            );

            // Write fetched paths back into metadata
            const updatedProducts = products.map((p) => ({
              ...p,
              hero_asset_key: heroMap.get(p.slot) ?? p.hero_asset_key ?? null,
            }));

            const updatedMetadata = {
              ...(contentJob.metadata as any),
              comparison: { ...comparisonMeta, products: updatedProducts },
            };

            await db
              .update(contentJobs)
              .set({ metadata: updatedMetadata })
              .where(eq(contentJobs.id, jobId));

            console.log(
              JSON.stringify({
                level: "info",
                message: "Comparison hero images auto-fetched",
                job_id: jobId,
                fetched: [...heroMap.entries()].map(
                  ([slot, path]) => `${slot}: ${path}`,
                ),
              }),
            );
          }
        } else {
          console.log(
            JSON.stringify({
              level: "info",
              message: "Comparison format product hero images already present",
              job_id: jobId,
              products: products.map(
                (p) => `${p.slot}: ${p.name} (${p.hero_asset_key})`,
              ),
            }),
          );
        }
      }

      const assemblyManifest = contentJob.assembly_manifest as any;
      const r2Manifest: Array<{
        key: string;
        type: string;
        size_bytes: number;
        scene_index?: number;
      }> = Array.isArray(contentJob.r2_asset_manifest)
        ? (contentJob.r2_asset_manifest as any[])
        : [];

      // 2. Scene analysis gate — must run before image generation can be dispatched
      if (
        needsSceneAnalysis &&
        (!assemblyManifest || !assemblyManifest.scenes?.length)
      ) {
        if (!queues.sceneAnalysis) {
          throw new Error(
            "scene-analysis queue not provided but template requires it",
          );
        }
        if (!contentJob.script) {
          throw new Error(
            `Job ${jobId} has no script — cannot run scene analysis`,
          );
        }

        console.log(
          JSON.stringify({
            level: "info",
            message: "Dispatching scene analysis",
            job_id: jobId,
          }),
        );

        await queues.sceneAnalysis.add("analyze-scenes", {
          job_id: jobId,
          template_id: contentJob.template_id,
          script: contentJob.script,
        });

        return; // Wait for scene-analysis to complete and re-trigger us
      }

      // 3. Track what still needs dispatching
      const dispatching: Promise<any>[] = [];
      let stillWaiting = false;

      // --- TTS (only for formats that need it, and only when no narration source is provided) ---
      if (!noTTS && !contentJob.narration_source_path) {
        const hasTTS = r2Manifest.some((a) => a.type === "audio/tts");
        if (!hasTTS) {
          if (!contentJob.script)
            throw new Error(`Job ${jobId} has no script for TTS`);

          // Check if TTS job already exists in queue to prevent duplicates
          // BullMQ can create retry jobs with timestamp suffixes (e.g., tts-{id}-{timestamp}),
          // so we check both the original job ID and its state before dispatching.
          const ttsJobId = `tts-${jobId}`;
          const existingTTSJob = await queues.aiGeneration.getJob(ttsJobId);

          if (existingTTSJob) {
            const jobState = await existingTTSJob.getState();

            // If job is failed, remove it and dispatch a fresh one
            // (BullMQ retries create new jobs with timestamp suffixes which we can't track)
            if (jobState === "failed") {
              const ttsCircuitOpen = ai33TTSCircuitBreaker.isOpen();
              const retryDelayMs = ttsCircuitOpen
                ? ai33TTSCircuitBreaker.getDelayMs()
                : 0;

              console.log(
                JSON.stringify({
                  level: "info",
                  message: ttsCircuitOpen
                    ? `TTS job failed — AI33 TTS circuit open, retrying in ${Math.round(retryDelayMs / 1000)}s`
                    : "TTS job failed — removing and dispatching fresh attempt",
                  job_id: jobId,
                  tts_job_id: ttsJobId,
                  tts_job_state: jobState,
                  failed_reason: existingTTSJob.failedReason,
                  circuit_open: ttsCircuitOpen,
                  retry_delay_ms: retryDelayMs,
                }),
              );

              await existingTTSJob.remove();

              // Dispatch fresh TTS job (delayed if circuit is open)
              const config = loadConfig();
              const jobLanguage = contentJob.language ?? "en";

              // Voice selection priority:
              // 1. Job metadata (user-selected via UI)
              // 2. Environment variable fallback (backward compatibility)
              const voiceId =
                (contentJob.metadata as any)?.voice_id ??
                (jobLanguage === "de"
                  ? (config.DEFAULT_VOICE_DE ??
                    (() => {
                      throw new Error(
                        "DEFAULT_VOICE_DE is not configured but job language is 'de'",
                      );
                    })())
                  : config.DEFAULT_VOICE_EN);

              dispatching.push(
                queues.aiGeneration.add(
                  "generate-tts",
                  {
                    job_id: jobId,
                    generation_type: "tts" as const,
                    voice_id: voiceId,
                    text: contentJob.script,
                    language: jobLanguage,
                  },
                  { jobId: ttsJobId, delay: retryDelayMs },
                ),
              );
              stillWaiting = true;
            } else if (
              jobState === "active" ||
              jobState === "waiting" ||
              jobState === "delayed"
            ) {
              // Job is in progress — wait for it
              console.log(
                JSON.stringify({
                  level: "info",
                  message:
                    "TTS job already in progress, waiting for completion",
                  job_id: jobId,
                  tts_job_state: jobState,
                }),
              );
              stillWaiting = true;
            } else {
              // Job is completed or in unknown state — allow convergence to proceed
              console.log(
                JSON.stringify({
                  level: "info",
                  message: "TTS job finished",
                  job_id: jobId,
                  tts_job_state: jobState,
                }),
              );
            }
          } else {
            // No existing job — dispatch new one
            const config = loadConfig();
            const jobLanguage = contentJob.language ?? "en";

            // Voice selection priority:
            // 1. Job metadata (user-selected via UI)
            // 2. Environment variable fallback (backward compatibility)
            const voiceId =
              (contentJob.metadata as any)?.voice_id ??
              (jobLanguage === "de"
                ? (config.DEFAULT_VOICE_DE ??
                  (() => {
                    throw new Error(
                      "DEFAULT_VOICE_DE is not configured but job language is 'de'",
                    );
                  })())
                : config.DEFAULT_VOICE_EN);

            console.log(
              JSON.stringify({
                level: "info",
                message: "Dispatching TTS generation",
                job_id: jobId,
                language: jobLanguage,
                voice_id: voiceId,
              }),
            );

            dispatching.push(
              queues.aiGeneration.add(
                "generate-tts",
                {
                  job_id: jobId,
                  generation_type: "tts" as const,
                  voice_id: voiceId,
                  text: contentJob.script,
                  language: jobLanguage,
                },
                { jobId: ttsJobId },
              ),
            );
            stillWaiting = true;
          }
        }
      } else if (!noTTS && contentJob.narration_source_path) {
        console.log(
          JSON.stringify({
            level: "info",
            message: "Narration source provided — skipping TTS generation",
            job_id: jobId,
            narration_source_path: contentJob.narration_source_path,
          }),
        );
      }

      // Whisper-on-narration: runs whenever a pre-recorded narration source
      // is set, INCLUDING for no_tts templates.
      // Without word_timestamps + duration_frames the V3 renderer bails
      // with "Scene 0 has no duration_frames". Sits outside the TTS branch
      // because no_tts templates short-circuit both arms above.
      if (contentJob.narration_source_path) {
        const currentAssemblyManifest =
          (contentJob.assembly_manifest as Record<string, unknown>) ?? {};
        const haveWordTimestamps =
          Array.isArray(currentAssemblyManifest["word_timestamps"]) &&
          (currentAssemblyManifest["word_timestamps"] as any[]).length > 0;
        if (!haveWordTimestamps) {
          try {
            const { spawn: spawnFf } = await import("node:child_process");
            const { join: joinPath, dirname: dirnamePath } =
              await import("node:path");
            const { runWhisper: runWhisperOnNarration } =
              await import("@repo/media-core");
            const audioPath = joinPath(
              dirnamePath(contentJob.narration_source_path),
              `${jobId}_narration_audio.wav`,
            );
            await new Promise<void>((resolve, reject) => {
              // @ts-ignore — ChildProcess type mismatch
              const ff = spawnFf("ffmpeg", [
                "-i",
                contentJob.narration_source_path as string,
                "-vn",
                "-acodec",
                "pcm_s16le",
                "-ar",
                "16000",
                "-ac",
                "1",
                "-y",
                audioPath,
              ]);
              let stderr = "";
              ff.stderr?.on("data", (d) => {
                stderr += d.toString();
              });
              ff.on("close", (code: number | null) => {
                code === 0
                  ? resolve()
                  : reject(
                      new Error(
                        `ffmpeg narration extract ${code}: ${stderr.slice(-200)}`,
                      ),
                    );
              });
            });
            const narrationWords = await runWhisperOnNarration(audioPath);
            const lastWord = narrationWords[narrationWords.length - 1] as
              | ((typeof narrationWords)[number] & { end_time?: number })
              | undefined;
            const durationSeconds =
              (lastWord?.end_time as number | undefined) ??
              (lastWord as { end?: number } | undefined)?.end ??
              0;
            const fps = (template.render_config as any)?.settings?.fps ?? 30;
            const durationFrames = Math.max(
              1,
              Math.round((durationSeconds as number) * fps),
            );
            await db
              .update(contentJobs)
              .set({
                duration_frames: durationFrames,
                assembly_manifest: {
                  ...currentAssemblyManifest,
                  word_timestamps: narrationWords,
                },
              })
              .where(eq(contentJobs.id, jobId));
            console.log(
              JSON.stringify({
                level: "info",
                message:
                  "Narration source Whisper complete — word_timestamps + duration_frames persisted",
                job_id: jobId,
                word_count: narrationWords.length,
                duration_frames: durationFrames,
              }),
            );
          } catch (err) {
            console.error(
              JSON.stringify({
                level: "error",
                message:
                  "Narration source Whisper failed — downstream render will fail",
                job_id: jobId,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
            throw err;
          }
        }
      }

      // Flush TTS dispatches before processing scenes (they are independent)
      if (dispatching.length > 0) {
        await Promise.all(dispatching);
      }

      // --- Sentence-level image dispatch ---
      if (assemblyManifest?.scenes?.length) {
        const pacingConfig = getPacingConfig(template.render_config);
        const totalScenes = (assemblyManifest.scenes as any[]).length;
        // For short videos (≤8 scenes, roughly sub-4-min): skip late_body grouping — 1 image per sentence throughout.
        const isShortVideo = totalScenes <= 8;
        let manifestModified = false;

        // Pass 1: assign groups to all scenes (no dispatch yet)
        for (const scene of assemblyManifest.scenes as any[]) {
          const zone = getPacingZone(
            scene.scene_index as number,
            totalScenes,
            pacingConfig,
          );

          // Hook zone exception: generate sentence_images even for AVATAR_ON_CAMERA scenes.
          // V2 composition plan may assign AVATAR_SPLIT to the intro scene, which needs images
          // in its image panel. Auto-generate from paragraph sentences if none exist.
          if (scene.visual_type === "AVATAR_ON_CAMERA" && zone === "hook") {
            if (
              (!scene.sentence_images || scene.sentence_images.length === 0) &&
              scene.paragraph
            ) {
              const sentences = (scene.paragraph as string)
                .split(/(?<=[.!?])\s+/)
                .map((s: string) => s.trim())
                .filter((s: string) => s.length > 8);
              if (sentences.length > 0) {
                scene.sentence_images = sentences.map((text: string) => ({
                  sentence_text: text,
                  image_prompt: text,
                  enriched_image_prompt: null,
                  is_key_fact: false,
                  key_fact_text: null,
                  group_index: null,
                  r2_key: null,
                }));
                manifestModified = true;
              }
            }
          } else if (scene.visual_type === "AVATAR_ON_CAMERA") {
            continue; // non-hook AVATAR_ON_CAMERA: no images needed
          }

          let sentenceImages: SentenceImage[] | undefined =
            scene.sentence_images;
          if (!sentenceImages || sentenceImages.length === 0) continue;

          // Hook zone: split into clause-level images before grouping
          if (zone === "hook" && pacingConfig.hook_use_subsentences) {
            const clauseSplit = splitIntoClauseSentenceImages(sentenceImages);
            if (clauseSplit.length > sentenceImages.length) {
              scene.sentence_images = clauseSplit;
              sentenceImages = clauseSplit;
              manifestModified = true;
            }
          }

          const needsGrouping = sentenceImages.some(
            (img) => img.group_index == null,
          );
          if (needsGrouping) {
            // For short videos, never use late_body grouping — keep 1 image per sentence everywhere
            const effectiveZone =
              isShortVideo && zone === "late_body" ? "early_body" : zone;
            const rng = mulberry32(hashCode(jobId + String(scene.scene_index)));
            const grouped = assignGroups(
              sentenceImages,
              effectiveZone,
              pacingConfig,
              rng,
            );
            for (let i = 0; i < grouped.length; i++) {
              (sentenceImages[i] as SentenceImage).group_index =
                grouped[i]!.group_index;
            }
            scene.sentence_images = sentenceImages; // ensure mutation is on the manifest object
            manifestModified = true;
          }
        }

        // Persist group assignments before dispatching any jobs
        if (manifestModified) {
          await persistManifest(db, jobId, assemblyManifest);
        }

        // Pass 2: dispatch image generation jobs (group assignments now durable)
        for (const scene of assemblyManifest.scenes as any[]) {
          const sceneZone = getPacingZone(
            scene.scene_index as number,
            totalScenes,
            pacingConfig,
          );
          // Skip AVATAR_ON_CAMERA except hook zone (which got images auto-generated in Pass 1)
          if (scene.visual_type === "AVATAR_ON_CAMERA" && sceneZone !== "hook")
            continue;
          const sceneImages: SentenceImage[] | undefined =
            scene.sentence_images;
          if (!sceneImages || sceneImages.length === 0) continue;

          // Dispatch one image generation job per unique group head
          // (first sentence in each group — lowest img_index sharing a group_index)
          const dispatchedGroups = new Set<number>();
          for (let imgIdx = 0; imgIdx < sceneImages.length; imgIdx++) {
            const sentImg = sceneImages[imgIdx]!;
            const groupIdx = sentImg.group_index ?? imgIdx;

            if (dispatchedGroups.has(groupIdx)) continue; // subsequent sentences in group — skip
            dispatchedGroups.add(groupIdx);

            if (sentImg.r2_key) continue; // already generated

            // Skip image generation for AVATAR_FULLSCREEN (narrator only, no B-roll needed)
            if (sentImg.layout_type === "AVATAR_FULLSCREEN") {
              console.log(
                JSON.stringify({
                  level: "info",
                  message:
                    "Skipping image generation for AVATAR_FULLSCREEN layout",
                  job_id: jobId,
                  scene_index: scene.scene_index,
                  img_index: imgIdx,
                  layout_type: sentImg.layout_type,
                }),
              );
              continue;
            }

            if (!sentImg.image_prompt) {
              console.log(
                JSON.stringify({
                  level: "warn",
                  message: "Sentence image missing prompt, skipping",
                  job_id: jobId,
                  scene_index: scene.scene_index,
                  img_index: imgIdx,
                }),
              );
              continue;
            }

            console.log(
              JSON.stringify({
                level: "info",
                message: "Dispatching sentence image generation",
                job_id: jobId,
                scene_index: scene.scene_index,
                img_index: imgIdx,
                group_index: groupIdx,
              }),
            );

            const effectiveEnrichedPrompt: string | null =
              sentImg.enriched_image_prompt ?? null;

            // Stagger dispatch by 200ms per image to avoid overwhelming rate limits.
            // For a 41-image job: dispatches spread over 8.2 seconds instead of <1 second.
            // Combined with worker concurrency:5 and exponential backoff, this prevents
            // the "tight loop → 8 concurrent → all 429 → all retry instantly" cascade.
            const dispatchDelayMs = 200;
            const sceneIndex = scene.scene_index as number;

            await queues.aiGeneration.add(
              `generate-scene-image-${scene.scene_index}_${imgIdx}`,
              {
                job_id: jobId,
                generation_type: "sentence_image" as const,
                scene_index: scene.scene_index as number,
                img_index: imgIdx,
                group_index: groupIdx,
                image_prompt: sentImg.image_prompt,
                enriched_image_prompt: effectiveEnrichedPrompt,
                aspect_ratio: "16:9",
              },
              {
                jobId: `${jobId}-scene-${scene.scene_index}-img-${imgIdx}`,
                delay: (sceneIndex * 10 + imgIdx) * dispatchDelayMs,
                priority: sceneIndex, // Scene 0 highest priority
                removeOnComplete: true,
                removeOnFail: true,
              },
            );

            stillWaiting = true;
          }
        }

        if (stillWaiting) {
          console.log(
            JSON.stringify({
              level: "info",
              message: "Assets still in progress, waiting for completions",
              job_id: jobId,
            }),
          );
          return; // Will be re-triggered when each asset completes
        }

        // --- Convergence check: all sentence image group heads must have r2_key ---
        // CRITICAL: Always check image completion, regardless of needs_scene_analysis flag.
        // BUG FIX: Previously checked needsSceneAnalysis && scenes, which skipped convergence
        // for formats with needsSceneAnalysis=false (e.g., CASUALLY_EXPLAINED), causing jobs
        // to advance to QMS before images finished generating → stuck in ASSET_COLLECTION.
        //
        // IMPORTANT: Re-read manifest from DB so the convergence check sees all r2_keys
        // written by concurrent image-completion handlers, not just the stale in-memory copy
        // that may have been loaded before those writes occurred.
        if (assemblyManifest?.scenes) {
          const [freshJobForCheck] = await db
            .select({ assembly_manifest: contentJobs.assembly_manifest })
            .from(contentJobs)
            .where(eq(contentJobs.id, jobId))
            .limit(1);
          // Use fresh manifest for all downstream work too (pacing, visual_asset_key)
          if (freshJobForCheck?.assembly_manifest) {
            Object.assign(assemblyManifest, freshJobForCheck.assembly_manifest);
            assemblyManifest.scenes = (
              freshJobForCheck.assembly_manifest as any
            ).scenes;
          }
          const manifestForCheck = assemblyManifest;
          const allComplete = (manifestForCheck.scenes as any[]).every(
            (scene) => {
              const sz = getPacingZone(
                scene.scene_index as number,
                totalScenes,
                pacingConfig,
              );
              if (scene.visual_type === "AVATAR_ON_CAMERA" && sz !== "hook")
                return true;
              const sentenceImages: SentenceImage[] | undefined =
                scene.sentence_images;
              if (!sentenceImages?.length) return true;

              // Only group heads (first sentence with a given group_index) need r2_key
              // EXCEPT: AVATAR_FULLSCREEN sentences don't need images (narrator only)
              const seenGroups = new Set<number>();
              for (const img of sentenceImages) {
                const gIdx = img.group_index ?? 0;
                if (!seenGroups.has(gIdx)) {
                  seenGroups.add(gIdx);
                  // Skip r2_key check for AVATAR_FULLSCREEN (no image needed)
                  if (img.layout_type !== "AVATAR_FULLSCREEN" && !img.r2_key) {
                    return false; // group head missing image
                  }
                }
              }
              return true;
            },
          );

          if (!allComplete) {
            console.log(
              JSON.stringify({
                level: "info",
                message:
                  "Images still pending — not all group heads have r2_key",
                job_id: jobId,
              }),
            );
            return; // Wait for more image completions to re-trigger us
          }
        }
      } else if (stillWaiting) {
        // No scenes but TTS still dispatching
        console.log(
          JSON.stringify({
            level: "info",
            message: "Assets still in progress, waiting for completions",
            job_id: jobId,
          }),
        );
        return;
      }

      // ── Populate scene.visual_asset_key from first sentence_image ──────────────
      // V3 FFmpeg renderer expects visual_asset_key at scene level, but V2 pipelines
      // store images in sentence_images[]. Copy the first image's r2_key to scene-level
      // visual_asset_key for render compatibility.
      if (assemblyManifest?.scenes) {
        let visualKeysPopulated = 0;
        for (const scene of assemblyManifest.scenes as any[]) {
          const sentenceImages: SentenceImage[] | undefined =
            scene.sentence_images;
          if (!sentenceImages?.length) continue;

          // Find first sentence image with r2_key (first group head)
          const firstImage = sentenceImages.find(
            (img) => img.r2_key && img.layout_type !== "AVATAR_FULLSCREEN",
          );
          if (firstImage?.r2_key && !scene.visual_asset_key) {
            scene.visual_asset_key = firstImage.r2_key;
            visualKeysPopulated++;
          }
        }

        if (visualKeysPopulated > 0) {
          console.log(
            JSON.stringify({
              level: "info",
              message:
                "Populated scene-level visual_asset_key from sentence_images",
              job_id: jobId,
              scenes_updated: visualKeysPopulated,
            }),
          );
          // Persist the updated manifest
          await persistManifest(db, jobId, assemblyManifest);
        }
      }

      // All automated assets collected — advance pipeline
      console.log(
        JSON.stringify({
          level: "info",
          message: "All automated assets collected",
          job_id: jobId,
          r2_asset_count: r2Manifest.length,
        }),
      );

      // ── Compute scene pacing if word-aligned TTS exists ──────────────────────
      if (
        assemblyManifest?.word_timestamps &&
        assemblyManifest.scenes &&
        contentJob.duration_frames
      ) {
        const { computeWordAlignedPacing } = await import("@repo/domain");
        const fps = (template.render_config as any)?.settings?.fps ?? 30;
        const totalFrames = contentJob.duration_frames;

        const sceneTimings = computeWordAlignedPacing(
          assemblyManifest.scenes,
          assemblyManifest.word_timestamps,
          totalFrames,
          fps,
        );

        // Apply timings to scenes
        for (let i = 0; i < assemblyManifest.scenes.length; i++) {
          assemblyManifest.scenes[i].start_frame = sceneTimings[i].start_frame;
          assemblyManifest.scenes[i].end_frame = sceneTimings[i].end_frame;
          assemblyManifest.scenes[i].duration_frames =
            sceneTimings[i].duration_frames;
        }

        // Persist updated manifest with scene timings
        await persistManifest(db, jobId, assemblyManifest);

        console.log(
          JSON.stringify({
            level: "info",
            message: "Scene pacing computed (word-aligned)",
            job_id: jobId,
            scene_count: sceneTimings.length,
            total_frames: totalFrames,
            total_seconds: (totalFrames / fps).toFixed(2),
          }),
        );
      } else if (
        assemblyManifest?.scenes &&
        contentJob.duration_frames &&
        assemblyManifest.scenes.length > 0 &&
        assemblyManifest.scenes[0]?.start_time !== undefined &&
        assemblyManifest.scenes[0]?.end_time !== undefined
      ) {
        // ── Sentence-based timing (for formats without word_timestamps) ────────
        // For sentence-based formats, Whisper provides segment-level timestamps
        // (start_time, end_time per scene). We compute frame timings using
        // next sentence's start as current sentence's end (naturally includes gaps).
        const fps = (template.render_config as any)?.settings?.fps ?? 30;
        const totalFrames = contentJob.duration_frames;

        for (let i = 0; i < assemblyManifest.scenes.length; i++) {
          const scene = assemblyManifest.scenes[i];
          const nextScene =
            i + 1 < assemblyManifest.scenes.length
              ? assemblyManifest.scenes[i + 1]
              : null;

          // Start frame from scene's start_time
          const startFrame = Math.round(scene.start_time * fps);

          // End frame is the START of the next scene (includes gap naturally)
          // For last scene, use total duration
          const endFrame = nextScene
            ? Math.round(nextScene.start_time * fps)
            : totalFrames;

          scene.start_frame = startFrame;
          scene.end_frame = endFrame;
          scene.duration_frames = endFrame - startFrame;
        }

        // Persist updated manifest with scene timings
        await persistManifest(db, jobId, assemblyManifest);

        console.log(
          JSON.stringify({
            level: "info",
            message: "Scene pacing computed (sentence-based, gap-inclusive)",
            job_id: jobId,
            scene_count: assemblyManifest.scenes.length,
            total_frames: totalFrames,
            total_seconds: (totalFrames / fps).toFixed(2),
            timing_method: "next_sentence_start_as_end",
          }),
        );
      }

      // ── Compute clause timings from word timestamps ───────────────────────────
      // Runs whenever word_timestamps are available and clause_timings have not yet
      // been stored. Splits the script at comma/conjunction boundaries, aligns each
      // clause to Whisper word timings, and persists the result in assembly_manifest
      // for downstream consumers (clip-selection agent, caption renderer, etc.).
      if (
        assemblyManifest?.word_timestamps?.length &&
        contentJob.script &&
        !assemblyManifest.clause_timings
      ) {
        try {
          const clauseTimings = splitIntoClauses(
            contentJob.script,
            assemblyManifest.word_timestamps,
          );

          assemblyManifest.clause_timings = clauseTimings;
          await persistManifest(db, jobId, assemblyManifest);

          console.log(
            JSON.stringify({
              level: "info",
              message: "Clause timings computed and stored",
              job_id: jobId,
              clause_count: clauseTimings.length,
            }),
          );
        } catch (clauseErr) {
          // Non-fatal — clause timings are an enhancement; don't block the pipeline
          console.error(
            JSON.stringify({
              level: "error",
              message:
                "Clause timing computation failed — proceeding without it",
              job_id: jobId,
              error:
                clauseErr instanceof Error
                  ? clauseErr.message
                  : String(clauseErr),
            }),
          );
        }
      }

      // ── Generate ASS subtitle file if TTS exists ──────────────────────────────
      const hasTTSAudio = r2Manifest.some((a) => a.type === "audio/tts");
      const hasSubtitles = r2Manifest.some((a) => a.type === "subtitle/ass");

      // Subtitles are opt-in for every FFmpeg-rendered format. Default = off.
      // Set metadata.subtitle_config.enabled = true on the job to enable.
      const subtitleConfig = (contentJob.metadata as any)?.subtitle_config as
        | { enabled?: boolean }
        | undefined;
      const subtitlesEnabled = subtitleConfig?.enabled === true;
      if (
        subtitlesEnabled &&
        hasTTSAudio &&
        !hasSubtitles &&
        assemblyManifest?.word_timestamps
      ) {
        console.log(
          JSON.stringify({
            level: "info",
            message: "Generating ASS subtitle file from TTS word timestamps",
            job_id: jobId,
            word_count: assemblyManifest.word_timestamps.length,
          }),
        );

        try {
          // Prepare output path for ASS file
          const config = loadConfig();
          const assFileName = `${jobId}_subtitles.ass`;
          const localAssDir = join(
            config.LOCAL_MEDIA_ROOT,
            contentJob.channel_id,
            jobId,
          );
          const localAssPath = join(localAssDir, assFileName);

          const fs = await import("fs").then((m) => m.promises);
          await fs.mkdir(localAssDir, { recursive: true });

          // Generate ASS file (writes to outputPath directly)
          await generateASSFile(
            assemblyManifest.word_timestamps.map((w: any) => ({
              word: w.word,
              start: w.start,
              end: w.end,
            })),
            localAssPath,
            {
              width: (template as any).render_config?.settings?.width ?? 1920,
              height: (template as any).render_config?.settings?.height ?? 1080,
              fontSize: 72,
              windowSize: 6,
            },
          );

          // Add to r2_asset_manifest
          const assStat = await fs.stat(localAssPath);
          const newAsset = {
            key: `${contentJob.channel_id}/${jobId}/${assFileName}`,
            type: "subtitle/ass" as const,
            size_bytes: assStat.size,
            path: localAssPath,
          };

          await db
            .update(contentJobs)
            .set({
              // COALESCE + jsonb type-check ensures we concat onto an array even when
              // the column was initialised to {} (the column default) instead of [].
              r2_asset_manifest: sql`COALESCE(CASE WHEN jsonb_typeof(r2_asset_manifest) = 'array' THEN r2_asset_manifest ELSE '[]'::jsonb END, '[]'::jsonb) || ${JSON.stringify([newAsset])}::jsonb`,
            })
            .where(eq(contentJobs.id, jobId));

          console.log(
            JSON.stringify({
              level: "info",
              message: "ASS subtitle file generated successfully",
              job_id: jobId,
              file_path: localAssPath,
              size_bytes: assStat.size,
            }),
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error(
            JSON.stringify({
              level: "error",
              message: "Failed to generate ASS subtitle file",
              job_id: jobId,
              error: errorMessage,
            }),
          );
          // Don't fail the job - subtitle generation is not critical
          // The render worker can handle missing subtitles
        }
      }

      const hasVAFootage = r2Manifest.some(
        (a) => a.type === "video/raw-va-footage",
      );
      const renderConfig = (template as any).render_config ?? {};
      const qcImageReviewRequired = !!renderConfig.qc_image_review_required;
      const skipImageQc = !!(contentJob as any).skip_image_qc;

      if (awaitVAAfterAutomated && !hasVAFootage) {
        // VA must upload HeyGen footage — Hub action will dispatch next when done
        await updateJobStatus(db, jobId, "AWAITING_PRODUCTION_VA");
      } else if (qcImageReviewRequired && !skipImageQc) {
        // Run automated image QC before deciding whether to route to human review.
        // Checks file sizes against minimum thresholds — catches blank/failed images
        // returned silently by the generation API without human involvement.
        const brollImages = r2Manifest
          .filter((a) => a.type === "image/broll")
          .map((a) => ({ key: a.key, size_bytes: a.size_bytes }));

        const qcResult = runAutoImageQc(brollImages, {
          minSizeBytes: renderConfig.qc_min_image_size_bytes ?? undefined,
          tolerancePct:
            renderConfig.qc_misgeneration_tolerance_pct ?? undefined,
        });

        console.log(
          JSON.stringify({
            level: "info",
            message: "Auto image QC result",
            job_id: jobId,
            total: qcResult.total,
            passed: qcResult.passedCount,
            failed: qcResult.failedCount,
            auto_approved: qcResult.autoApproved,
            failed_keys: qcResult.failedKeys,
          }),
        );

        if (qcResult.autoApproved) {
          // All images within tolerance — skip human QC gate; route via clip
          // selection if enabled for this format/channel, else straight to QMS
          await dispatchPostAssets(
            jobId,
            contentJob.format,
            contentJob.channel_id ?? null,
          );
        } else {
          // Too many blank/failed images — pause for VA to review and regen
          console.log(
            JSON.stringify({
              level: "warn",
              message: "Auto image QC failed — routing to human review",
              job_id: jobId,
              failed_count: qcResult.failedCount,
              total: qcResult.total,
            }),
          );
          await updateJobStatus(db, jobId, "AWAITING_IMAGE_QC");
        }
      } else {
        // Fully automated — route via clip selection if enabled, else QMS
        await dispatchPostAssets(
          jobId,
          contentJob.format,
          contentJob.channel_id ?? null,
        );
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        JSON.stringify({
          level: "error",
          message: "Asset collection processor failed",
          job_id: jobId,
          error: errorMessage,
        }),
      );
      await updateJobStatus(
        db,
        jobId,
        "FAILED_GENERAL",
        errorMessage,
        buildErrorDetail({
          code: "ASSET_COLLECTION_FAILED",
          message: errorMessage,
          category: "asset_management",
          retryable: true,
          context: { job_id: jobId },
        }),
      );
      throw err;
    }
  };
}
