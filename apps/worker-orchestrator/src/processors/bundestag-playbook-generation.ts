import type { Job, Queue } from "bullmq";
import { eq } from "drizzle-orm";
import type { BundestagPlaybookGenerationPayload } from "@repo/contracts";
import { BundestagPlaybookGenerationPayloadSchema } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { contentJobs, bundestagClips, bundestagPlaybooks } from "@repo/db";
import type { BundestagPlaybookSegment } from "@repo/db";
import { QUEUE_NAMES } from "@repo/queue";
import { type PartyName } from "@repo/media-core";

/**
 * Bundestag Playbook Generation Processor (Party-Segmented Architecture)
 *
 * Processes queue-bundestag-playbook-generation jobs - generates party-aware
 * editing plans from segmented clips.
 *
 * **Architecture:** Single live stream → Party segmentation → Format variants
 *
 * Flow:
 * 1. Fetch all clips from bundestag_clips table (created by Task 3)
 * 2. Group clips by party affiliation (SPD, CDU, AFD, GRUENE, FDP, LINKE)
 * 3. For each party, create editing plans:
 *    - Long-form: Full speeches (YouTube 16:9)
 *    - Short-form: Key moments (YouTube Shorts/TikTok/Instagram 9:16)
 * 4. Apply party-specific overlay configs (from Task 4)
 * 5. Store playbook in job metadata
 * 6. Dispatch to bundestag-render queue
 *
 * **Simple Heuristics (No LLM needed for MVP):**
 * - Long-form: Include ALL clips for party, no trimming
 * - Short-form: First 60 seconds of each clip OR clips with quality score > 7
 *
 * @param db - Drizzle client
 * @param queues - Queue instances for dispatch
 * @returns Processor function for bundestag playbook generation queue
 */
export function createBundestagPlaybookGenerationProcessor(
  db: DrizzleClient,
  queues: {
    bundestagRender?: Queue;
  },
) {
  return async (job: Job<BundestagPlaybookGenerationPayload>) => {
    const startTime = Date.now();
    console.log(
      JSON.stringify({
        level: "info",
        message: "Starting party-segmented playbook generation",
        job_id: job.data.job_id,
        timestamp: new Date().toISOString(),
      }),
    );

    // 1. Validate payload
    const parseResult = BundestagPlaybookGenerationPayloadSchema.safeParse(
      job.data,
    );
    if (!parseResult.success) {
      const error = `Invalid payload: ${parseResult.error.message}`;
      console.error(
        JSON.stringify({
          level: "error",
          message: error,
          job_id: job.data.job_id,
          validation_errors: parseResult.error.errors,
        }),
      );
      throw new Error(error);
    }

    const payload = parseResult.data;

    try {
      // 2. Fetch job from database
      const [jobRecord] = await db
        .select()
        .from(contentJobs)
        .where(eq(contentJobs.id, payload.job_id))
        .limit(1);

      if (!jobRecord) {
        throw new Error(`Job not found: ${payload.job_id}`);
      }

      // 3. Fetch all clips for this job
      const clips = await db
        .select()
        .from(bundestagClips)
        .where(eq(bundestagClips.job_id, payload.job_id));

      if (clips.length === 0) {
        throw new Error(`No clips found for job ${payload.job_id}`);
      }

      console.log(
        JSON.stringify({
          level: "info",
          message: "Clips fetched from database",
          job_id: payload.job_id,
          clip_count: clips.length,
        }),
      );

      // 4. Filter valid clips (must have party and duration)
      const validClips = clips.filter(
        (c) => c.party !== null && c.duration_seconds !== null,
      );

      if (validClips.length === 0) {
        throw new Error(
          "No valid clips with party affiliation and duration found",
        );
      }

      // 5. Group clips by party
      const clipsByParty = groupClipsByParty(validClips);

      console.log(
        JSON.stringify({
          level: "info",
          message: "Clips grouped by party",
          job_id: payload.job_id,
          party_breakdown: Object.fromEntries(
            Object.entries(clipsByParty).map(([party, partyClips]) => [
              party,
              partyClips.length,
            ]),
          ),
        }),
      );

      // 6. Generate editing plans for each party
      const allPlans: EditingPlan[] = [];

      for (const [party, partyClips] of Object.entries(clipsByParty)) {
        if (partyClips.length === 0) continue;

        // Create long-form plans (full speeches)
        const longFormPlan = createLongFormPlan(
          party as PartyName,
          partyClips,
          "youtube_long",
        );
        allPlans.push(longFormPlan);

        // Create short-form plans (key moments)
        const shortFormPlans = createShortFormPlans(
          party as PartyName,
          partyClips,
        );
        allPlans.push(...shortFormPlans);
      }

      console.log(
        JSON.stringify({
          level: "info",
          message: "Editing plans generated",
          job_id: payload.job_id,
          total_plans: allPlans.length,
          plans_by_format: countPlansByFormat(allPlans),
        }),
      );

      // 7. Create playbook object
      const playbook: Playbook = {
        plans: allPlans,
        generated_at: new Date().toISOString(),
        generation_method: "party-segmented-heuristic",
      };

      // 8. Store playbook in job metadata
      const updatedMetadata = {
        ...(jobRecord.metadata && typeof jobRecord.metadata === "object"
          ? jobRecord.metadata
          : {}),
        playbook: playbook,
      };

      await db
        .update(contentJobs)
        .set({
          status: "ROUTING_RENDER",
          metadata: updatedMetadata as any,
          updated_at: new Date(),
        })
        .where(eq(contentJobs.id, payload.job_id));

      console.log(
        JSON.stringify({
          level: "info",
          message: "Playbook stored in job metadata",
          job_id: payload.job_id,
          plan_count: allPlans.length,
        }),
      );

      // 8.5 Persist a flat single-timeline playbook to bundestag_playbooks.
      // This is what the FFmpeg render processor
      // (apps/worker-render/src/processors/bundestag-render-processor.ts)
      // actually reads (it queries bundestag_playbooks, not
      // contentJobs.metadata) — nothing wrote a row there before this fix,
      // so every render attempt failed with "No active playbook found for
      // job {job_id}". Single-stream architecture: every clip references the
      // same source video, so re-assemble the full session in chronological
      // order, matching the "full" 16:9 output_variant the render dispatch
      // below already declares.
      const renderSegments = buildRenderPlaybookSegments(validClips);
      const renderTotalDuration = renderSegments.reduce(
        (sum, seg) => sum + (seg.timestamp_end - seg.timestamp_start),
        0,
      );

      await db
        .insert(bundestagPlaybooks)
        .values({
          job_id: payload.job_id,
          version: 1,
          is_active: true,
          model: "heuristic-single-stream",
          editing_style: payload.editing_style,
          editing_plan: renderSegments,
          total_segments: renderSegments.length,
          total_duration_seconds: renderTotalDuration.toFixed(3),
        })
        .onConflictDoUpdate({
          target: [bundestagPlaybooks.job_id, bundestagPlaybooks.version],
          set: {
            editing_plan: renderSegments,
            total_segments: renderSegments.length,
            total_duration_seconds: renderTotalDuration.toFixed(3),
          },
        });

      console.log(
        JSON.stringify({
          level: "info",
          message: "Render playbook persisted to bundestag_playbooks",
          job_id: payload.job_id,
          segment_count: renderSegments.length,
          total_duration_seconds: renderTotalDuration,
        }),
      );

      // 9. Dispatch to bundestag-render queue
      if (queues.bundestagRender) {
        await queues.bundestagRender.add(
          "render-bundestag",
          {
            job_id: payload.job_id,
            output_variants: [
              {
                aspect_ratio: "16:9" as const,
                duration_type: "full" as const,
              },
            ],
            apply_effects: true,
          },
          {
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 10000,
            },
          },
        );

        console.log(
          JSON.stringify({
            level: "info",
            message: "Dispatched to render queue",
            job_id: payload.job_id,
            queue: QUEUE_NAMES.BUNDESTAG_RENDER,
          }),
        );
      } else {
        console.warn(
          JSON.stringify({
            level: "warn",
            message: "Render queue not available - skipping dispatch",
            job_id: payload.job_id,
          }),
        );
      }

      const duration = Date.now() - startTime;
      console.log(
        JSON.stringify({
          level: "info",
          message: "Party-segmented playbook generation completed",
          job_id: payload.job_id,
          plan_count: allPlans.length,
          duration_ms: duration,
          timestamp: new Date().toISOString(),
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Bundestag playbook generation failed",
          job_id: payload.job_id,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: new Date().toISOString(),
        }),
      );

      // Update job status to failed
      await db
        .update(contentJobs)
        .set({
          status: "FAILED_GENERAL",
          error_message: error instanceof Error ? error.message : String(error),
          updated_at: new Date(),
        })
        .where(eq(contentJobs.id, payload.job_id));

      throw error;
    }
  };
}

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Format identifier for output variants.
 */
type OutputFormat = "youtube_long" | "youtube_shorts" | "tiktok" | "instagram";

/**
 * Clip segment within an editing plan.
 * References a clip from bundestag_clips table with optional trimming.
 */
interface PlanSegment {
  /** References bundestag_clips.clip_id */
  clip_id: string;
  /** Start time in seconds (within the clip) */
  start: number;
  /** End time in seconds (within the clip) */
  end: number;
  /** Overlay template to apply (references Task 4 party configs) */
  overlay: string;
}

/**
 * Editing plan for a single party+format combination.
 */
interface EditingPlan {
  /** Output format (determines aspect ratio and positioning) */
  format: OutputFormat;
  /** Party affiliation (SPD, CDU, AFD, GRUENE, FDP, LINKE, UNKNOWN) */
  party: PartyName;
  /** Clip segments to include in this plan */
  segments: PlanSegment[];
  /** Total duration of final video in seconds */
  total_duration: number;
  /** Overlay configuration (from Task 4) */
  overlay_config: {
    party: PartyName;
    include_logo: boolean;
    include_color_bar: boolean;
    include_party_name: boolean;
  };
}

/**
 * Complete playbook containing all editing plans.
 */
interface Playbook {
  /** Array of editing plans (one per party+format combination) */
  plans: EditingPlan[];
  /** ISO timestamp when playbook was generated */
  generated_at: string;
  /** Generation method identifier */
  generation_method: string;
}

/**
 * Simplified clip data for playbook generation.
 */
interface ClipData {
  clip_id: string;
  party: string;
  duration_seconds: string;
  transcription_quality_grade: string | null;
  start_offset: string | null;
  end_offset: string | null;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Build the single flat timeline the FFmpeg render processor expects
 * (BundestagPlaybookSegment[], stored as bundestag_playbooks.editing_plan).
 *
 * Single-stream architecture: every clip's local_path is the same source
 * video, so this just re-assembles the full session in chronological order
 * (start_offset ascending) — the natural "full" 16:9 rendering of a single
 * parliamentary session recording.
 *
 * @param clips - Valid clips fetched from bundestag_clips (must have party + duration)
 * @returns Ordered segments ready to persist to bundestag_playbooks
 */
function buildRenderPlaybookSegments(
  clips: Array<{
    clip_id: string;
    start_offset: string | null;
    end_offset: string | null;
    duration_seconds: string | null;
    party: string | null;
    transcript_text: string | null;
  }>,
): BundestagPlaybookSegment[] {
  const sorted = [...clips].sort(
    (a, b) =>
      parseFloat(a.start_offset ?? "0") - parseFloat(b.start_offset ?? "0"),
  );

  let cursor = 0;
  return sorted.map((clip, i) => {
    const clipStart = parseFloat(clip.start_offset ?? "0");
    const clipEnd = parseFloat(
      clip.end_offset ?? clip.duration_seconds ?? "0",
    );
    const duration = Math.max(0, clipEnd - clipStart);

    const segment: BundestagPlaybookSegment = {
      sequence_number: i,
      timestamp_start: cursor,
      timestamp_end: cursor + duration,
      primary_clip_id: clip.clip_id,
      clip_start_offset: clipStart,
      clip_end_offset: clipEnd,
      audio_clip_id: clip.clip_id,
      subtitle_text: clip.transcript_text ?? "",
      subtitle_style: "normal",
      cut_reason: `Party segment: ${clip.party ?? "UNKNOWN"}`,
      transition: "cut",
    };

    cursor += duration;
    return segment;
  });
}

/**
 * Group clips by party affiliation.
 *
 * @param clips - Array of clips from bundestag_clips table
 * @returns Map of party name to array of clips
 */
function groupClipsByParty(
  clips: Array<{
    clip_id: string;
    party: string | null;
    duration_seconds: string | null;
    transcription_quality_grade: string | null;
    start_offset: string | null;
    end_offset: string | null;
  }>,
): Record<string, ClipData[]> {
  const grouped: Record<string, ClipData[]> = {};

  for (const clip of clips) {
    const party = clip.party ?? "UNKNOWN";

    if (!grouped[party]) {
      grouped[party] = [];
    }

    grouped[party].push({
      clip_id: clip.clip_id,
      party: party,
      duration_seconds: clip.duration_seconds!,
      transcription_quality_grade: clip.transcription_quality_grade,
      start_offset: clip.start_offset,
      end_offset: clip.end_offset,
    });
  }

  return grouped;
}

/**
 * Create long-form editing plan (full speeches).
 *
 * Includes ALL clips for the party with no trimming.
 * Suitable for YouTube (16:9) full-length videos.
 *
 * @param party - Party affiliation
 * @param clips - Array of clips for this party
 * @param format - Output format (default: "youtube_long")
 * @returns Long-form editing plan
 */
function createLongFormPlan(
  party: PartyName,
  clips: ClipData[],
  format: "youtube_long" = "youtube_long",
): EditingPlan {
  const segments: PlanSegment[] = clips.map((clip) => ({
    clip_id: clip.clip_id,
    start: 0,
    end: parseFloat(clip.duration_seconds),
    overlay: `${party.toLowerCase()}_standard`,
  }));

  const totalDuration = segments.reduce(
    (sum, seg) => sum + (seg.end - seg.start),
    0,
  );

  return {
    format,
    party,
    segments,
    total_duration: totalDuration,
    overlay_config: {
      party,
      include_logo: true,
      include_color_bar: true,
      include_party_name: true,
    },
  };
}

/**
 * Create short-form editing plans (key moments).
 *
 * Extracts first 60 seconds of each clip OR uses quality score to select best clips.
 * Generates plans for YouTube Shorts, TikTok, and Instagram (all 9:16).
 *
 * **Heuristics:**
 * - If clip has quality grade "excellent" or "good", include first 60s
 * - If clip is shorter than 60s, include entire clip
 * - Skip clips shorter than 10s (too short for meaningful content)
 *
 * @param party - Party affiliation
 * @param clips - Array of clips for this party
 * @returns Array of short-form editing plans (one per format)
 */
function createShortFormPlans(
  party: PartyName,
  clips: ClipData[],
): EditingPlan[] {
  const SHORT_FORM_DURATION = 60; // seconds
  const MIN_CLIP_DURATION = 10; // seconds

  // Filter clips for short-form content
  const suitableClips = clips.filter((clip) => {
    const duration = parseFloat(clip.duration_seconds);

    // Skip very short clips
    if (duration < MIN_CLIP_DURATION) return false;

    // Prioritize high-quality clips if quality grade is available
    if (clip.transcription_quality_grade) {
      return (
        clip.transcription_quality_grade === "excellent" ||
        clip.transcription_quality_grade === "good"
      );
    }

    // Include all clips if quality grade not available
    return true;
  });

  // Create segments (first 60s or full clip if shorter)
  const segments: PlanSegment[] = suitableClips.map((clip) => {
    const clipDuration = parseFloat(clip.duration_seconds);
    const trimmedEnd = Math.min(clipDuration, SHORT_FORM_DURATION);

    return {
      clip_id: clip.clip_id,
      start: 0,
      end: trimmedEnd,
      overlay: `${party.toLowerCase()}_vertical`, // Vertical-optimized overlay
    };
  });

  const totalDuration = segments.reduce(
    (sum, seg) => sum + (seg.end - seg.start),
    0,
  );

  // Generate plans for each short-form format
  const formats: Array<"youtube_shorts" | "tiktok" | "instagram"> = [
    "youtube_shorts",
    "tiktok",
    "instagram",
  ];

  return formats.map((format) => ({
    format,
    party,
    segments,
    total_duration: totalDuration,
    overlay_config: {
      party,
      include_logo: true,
      include_color_bar: true,
      include_party_name: true,
    },
  }));
}

/**
 * Count plans by format for logging.
 *
 * @param plans - Array of editing plans
 * @returns Object with format counts
 */
function countPlansByFormat(plans: EditingPlan[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const plan of plans) {
    counts[plan.format] = (counts[plan.format] || 0) + 1;
  }

  return counts;
}
