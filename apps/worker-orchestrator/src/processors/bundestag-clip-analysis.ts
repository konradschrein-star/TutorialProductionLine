import type { Job, Queue } from "bullmq";
import { eq } from "drizzle-orm";
import type { BundestagClipAnalysisPayload } from "@repo/contracts";
import { BundestagClipAnalysisPayloadSchema } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { contentJobs, bundestagClips } from "@repo/db";
import { probeMedia, runWhisper, ensureMediaDirectory } from "@repo/media-core";
import { detectSpeakers } from "@repo/media-core/speaker-detection";
import type { WordTimestamp } from "@repo/contracts";
import type { SpeakerSegment, PartyAffiliation } from "@repo/media-core";
import { stat } from "node:fs/promises";
import { QUEUE_NAMES } from "@repo/queue";

/**
 * Bundestag Clip Analysis Processor (Single-Stream Architecture)
 *
 * Processes queue-bundestag-clip-analysis jobs for single parliamentary session videos.
 *
 * Processing pipeline:
 * 1. Extract video metadata (resolution, fps, duration) using FFprobe
 * 2. Transcribe full video with Whisper (word-level timestamps)
 * 3. Run speaker detection to get party timeline (OCR-based)
 * 4. Segment video by correlating transcription with party timeline
 * 5. Create clip records for each speech segment (one per party speaking period)
 * 6. Insert clips into bundestag_clips table with party metadata
 * 7. Dispatch to bundestag-playbook-generation queue
 *
 * @param db - Drizzle client
 * @param queues - Queue instances for dispatch
 * @returns Processor function for bundestag clip analysis queue
 */
export function createBundestagClipAnalysisProcessor(
  db: DrizzleClient,
  queues: {
    bundestagPlaybookGeneration?: Queue;
  },
) {
  return async (job: Job<BundestagClipAnalysisPayload>) => {
    const startTime = Date.now();
    console.log(
      JSON.stringify({
        level: "info",
        message: "Starting bundestag single-stream clip analysis",
        job_id: job.data.job_id,
        video_file_path: job.data.video_file_path,
        timestamp: new Date().toISOString(),
      }),
    );

    // 1. Validate payload
    const parseResult = BundestagClipAnalysisPayloadSchema.safeParse(job.data);
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
      // 2. Ensure media directory exists for this job
      await ensureMediaDirectory("bundestag", payload.job_id);

      // 3. Check if video file exists
      try {
        await stat(payload.video_file_path);
      } catch (error) {
        throw new Error(
          `Video file not found: ${payload.video_file_path}. Error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // 4. Extract video metadata using FFprobe
      console.log(
        JSON.stringify({
          level: "info",
          message: "Extracting video metadata",
          job_id: payload.job_id,
          video_file_path: payload.video_file_path,
        }),
      );

      const metadata = await probeMedia(payload.video_file_path);
      const fileStat = await stat(payload.video_file_path);
      const fileSize = fileStat.size;

      console.log(
        JSON.stringify({
          level: "info",
          message: "Video metadata extracted",
          job_id: payload.job_id,
          resolution: metadata.video
            ? `${metadata.video.width}x${metadata.video.height}`
            : "no_video",
          duration_seconds: metadata.durationSeconds,
          fps: metadata.video?.fps,
          has_audio: !!metadata.audio,
          file_size_mb: (fileSize / (1024 * 1024)).toFixed(2),
        }),
      );

      // 5. Run Whisper transcription on full video
      console.log(
        JSON.stringify({
          level: "info",
          message:
            "Starting Whisper transcription (this may take several minutes)",
          job_id: payload.job_id,
          video_duration_seconds: metadata.durationSeconds,
        }),
      );

      const transcriptionStartTime = Date.now();
      let words: WordTimestamp[];

      try {
        words = await runWhisper(payload.video_file_path);
      } catch (error) {
        throw new Error(
          `Whisper transcription failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const transcriptionDuration = Date.now() - transcriptionStartTime;
      const transcriptText = words.map((w) => w.word).join(" ");

      console.log(
        JSON.stringify({
          level: "info",
          message: "Whisper transcription completed",
          job_id: payload.job_id,
          word_count: words.length,
          transcript_length: transcriptText.length,
          duration_ms: transcriptionDuration,
          processing_ratio: (
            transcriptionDuration /
            1000 /
            metadata.durationSeconds
          ).toFixed(2),
        }),
      );

      // 6. Run speaker detection to get party timeline
      console.log(
        JSON.stringify({
          level: "info",
          message:
            "Starting speaker detection (OCR-based party identification)",
          job_id: payload.job_id,
        }),
      );

      const speakerDetectionStartTime = Date.now();
      let speakerTimeline: SpeakerSegment[];

      // Hard timeout — Tesseract.js can hang on first-use language pack
      // download, and the OCR-batch loop can be 10+ min on long videos.
      // Without a timeout the BullMQ stall detector restarts the job
      // forever. If detection times out we fall back to a single-speaker
      // stub so the rest of the pipeline can finish (clips still get
      // segmented by Whisper word timing).
      const SPEAKER_DETECTION_TIMEOUT_MS = Number(
        process.env["BUNDESTAG_SPEAKER_TIMEOUT_MS"] ?? 120_000,
      );
      try {
        const speakerDetectionResult = await Promise.race([
          detectSpeakers({
            videoFilePath: payload.video_file_path,
            frameIntervalSeconds: 5,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `Speaker detection timeout (${SPEAKER_DETECTION_TIMEOUT_MS}ms)`,
                  ),
                ),
              SPEAKER_DETECTION_TIMEOUT_MS,
            ),
          ),
        ]);
        speakerTimeline = speakerDetectionResult.speaker_timeline;
      } catch (error) {
        console.warn(
          JSON.stringify({
            level: "warn",
            message:
              "Speaker detection failed/timed out — falling back to single-speaker stub",
            job_id: payload.job_id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        speakerTimeline = [
          {
            speaker: "UNKNOWN",
            party: "UNKNOWN" as PartyAffiliation,
            start_time: 0,
            end_time: metadata.durationSeconds,
            confidence: 0,
          },
        ];
      }

      const speakerDetectionDuration = Date.now() - speakerDetectionStartTime;

      console.log(
        JSON.stringify({
          level: "info",
          message: "Speaker detection completed",
          job_id: payload.job_id,
          segment_count: speakerTimeline.length,
          duration_ms: speakerDetectionDuration,
          party_distribution: getPartyDistribution(speakerTimeline),
        }),
      );

      // 7. Segment video by party timeline and create clips
      console.log(
        JSON.stringify({
          level: "info",
          message: "Creating clip segments from party timeline",
          job_id: payload.job_id,
        }),
      );

      const clips = await createClipSegments(
        payload.job_id,
        payload.video_file_path,
        words,
        speakerTimeline,
        metadata,
        fileSize,
      );

      console.log(
        JSON.stringify({
          level: "info",
          message: "Clip segments created",
          job_id: payload.job_id,
          clip_count: clips.length,
          total_duration: clips.reduce((sum, c) => sum + c.duration_seconds, 0),
        }),
      );

      // 8. Insert all clips into bundestag_clips table (atomic transaction)
      console.log(
        JSON.stringify({
          level: "info",
          message: "Inserting clips into database",
          job_id: payload.job_id,
        }),
      );

      await db.transaction(async (tx) => {
        for (const clip of clips) {
          await tx.insert(bundestagClips).values({
            job_id: payload.job_id,
            clip_id: clip.clip_id,
            local_path: payload.video_file_path,

            // Single-stream architecture fields
            start_offset: clip.start_offset.toString(),
            end_offset: clip.end_offset.toString(),
            party: clip.party,
            speaker_name: clip.speaker_name,

            // Video metadata
            duration_seconds: clip.duration_seconds.toString(),
            resolution: metadata.video
              ? `${metadata.video.width}x${metadata.video.height}`
              : null,
            width: metadata.video?.width ?? null,
            height: metadata.video?.height ?? null,
            fps: metadata.video?.fps.toString() ?? null,
            codec: metadata.video?.codec ?? null,
            pixel_format: null, // Not available in probeMedia result
            bitrate_kbps: null, // Not available in probeMedia result
            file_size_bytes: fileSize,
            has_audio: !!metadata.audio,
            sample_rate: metadata.audio?.sampleRate ?? null,

            // Camera angle (single stream = overview)
            camera_angle: "overview", // Mark as overview/wide shot (not multi-cam)

            // Synchronization (not applicable for single-stream)
            sync_offset_ms: 0,
            sync_confidence: null,
            sync_method: null,
            is_reference_clip: false, // All clips reference the same source

            // Transcription
            transcript_text: clip.transcript_text,
            transcript_words: clip.transcript_words as Array<{
              word: string;
              start: number;
              end: number;
            }>,
            transcript_language: "de", // Bundestag is German
            transcription_completed_at: new Date(),

            // Transcription quality (simplified for single-stream)
            transcription_quality_grade: assessSegmentQuality(
              clip.transcript_words.length,
            ),
            transcription_confidence: "0.85", // Baseline for Whisper
            transcription_flags: [],

            // Normalization (not done in Phase 5)
            normalization_required: false,
            normalization_completed: false,
            normalized_path: null,

            // Speaker detection confidence
            detected_speaker_name: clip.speaker_name,
            speaker_confidence: clip.speaker_confidence,
          });

          console.log(
            JSON.stringify({
              level: "info",
              message: "Clip inserted into database",
              job_id: payload.job_id,
              clip_id: clip.clip_id,
              party: clip.party,
              duration: clip.duration_seconds,
              word_count: clip.transcript_words.length,
            }),
          );
        }
      });

      // 9. Update job status in content_jobs
      await db
        .update(contentJobs)
        .set({
          status: "ASSET_COLLECTION", // Temporary status for MVP
          updated_at: new Date(),
        })
        .where(eq(contentJobs.id, payload.job_id));

      console.log(
        JSON.stringify({
          level: "info",
          message: "Job status updated",
          job_id: payload.job_id,
          new_status: "ASSET_COLLECTION",
        }),
      );

      // 10. Dispatch to bundestag-playbook-generation queue
      if (queues.bundestagPlaybookGeneration) {
        await queues.bundestagPlaybookGeneration.add(
          "generate-playbook",
          {
            job_id: payload.job_id,
            use_local_llm: true,
            editing_style: "dynamic" as const,
          },
          {
            attempts: 1,
            backoff: {
              type: "exponential",
              delay: 5000,
            },
          },
        );

        console.log(
          JSON.stringify({
            level: "info",
            message: "Dispatched to playbook generation queue",
            job_id: payload.job_id,
            queue: QUEUE_NAMES.BUNDESTAG_PLAYBOOK_GENERATION,
          }),
        );
      } else {
        console.warn(
          JSON.stringify({
            level: "warn",
            message:
              "Playbook generation queue not available - skipping dispatch",
            job_id: payload.job_id,
          }),
        );
      }

      const duration = Date.now() - startTime;
      console.log(
        JSON.stringify({
          level: "info",
          message: "Bundestag single-stream clip analysis completed",
          job_id: payload.job_id,
          clip_count: clips.length,
          duration_ms: duration,
          duration_minutes: (duration / 60000).toFixed(2),
          timestamp: new Date().toISOString(),
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Bundestag clip analysis failed",
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

/**
 * Create Clip Segments from Party Timeline
 *
 * Correlates Whisper transcription with speaker detection timeline to create
 * clip segments. Each segment represents a continuous speech by one party.
 *
 * @param job_id - Job ID for clip naming
 * @param videoFilePath - Original video file path
 * @param words - Word timestamps from Whisper
 * @param speakerTimeline - Party timeline from speaker detection
 * @param metadata - Video metadata
 * @param fileSize - Video file size
 * @returns Array of clip segments
 */
async function createClipSegments(
  job_id: string,
  videoFilePath: string,
  words: WordTimestamp[],
  speakerTimeline: SpeakerSegment[],
  metadata: Awaited<ReturnType<typeof probeMedia>>,
  fileSize: number,
): Promise<
  Array<{
    clip_id: string;
    start_offset: number;
    end_offset: number;
    duration_seconds: number;
    party: string;
    speaker_name: string;
    speaker_confidence: string;
    transcript_text: string;
    transcript_words: WordTimestamp[];
  }>
> {
  const clips: Array<{
    clip_id: string;
    start_offset: number;
    end_offset: number;
    duration_seconds: number;
    party: string;
    speaker_name: string;
    speaker_confidence: string;
    transcript_text: string;
    transcript_words: WordTimestamp[];
  }> = [];

  // Validate minimum clip duration (skip clips shorter than 10 seconds)
  const MIN_CLIP_DURATION_SECONDS = 10;

  for (let i = 0; i < speakerTimeline.length; i++) {
    const segment = speakerTimeline[i];
    const duration = segment.end_time - segment.start_time;

    // Skip clips that are too short (likely false positives or transitions)
    if (duration < MIN_CLIP_DURATION_SECONDS) {
      console.log(
        JSON.stringify({
          level: "debug",
          message: "Skipping short clip segment",
          segment_index: i,
          party: segment.party,
          duration_seconds: duration,
          threshold: MIN_CLIP_DURATION_SECONDS,
        }),
      );
      continue;
    }

    // Find words that fall within this time segment
    const segmentWords = words.filter(
      (w) => w.start >= segment.start_time && w.end <= segment.end_time,
    );

    // Build transcript text for this segment
    const transcript = segmentWords.map((w) => w.word).join(" ");

    // Generate unique clip ID
    const clip_id = `clip_${String(i + 1).padStart(4, "0")}_${segment.party}`;

    clips.push({
      clip_id,
      start_offset: segment.start_time,
      end_offset: segment.end_time,
      duration_seconds: duration,
      party: segment.party,
      speaker_name: segment.speaker, // "Unknown" for now
      speaker_confidence: segment.confidence.toFixed(3),
      transcript_text: transcript,
      transcript_words: segmentWords,
    });
  }

  return clips;
}

/**
 * Get Party Distribution Statistics
 *
 * Calculates speaking time distribution across parties for logging.
 *
 * @param timeline - Speaker timeline
 * @returns Party distribution object
 */
function getPartyDistribution(
  timeline: SpeakerSegment[],
): Record<string, number> {
  const distribution: Record<string, number> = {};

  for (const segment of timeline) {
    const duration = segment.end_time - segment.start_time;
    distribution[segment.party] = (distribution[segment.party] || 0) + duration;
  }

  // Round to 2 decimal places
  for (const party in distribution) {
    distribution[party] = Math.round(distribution[party] * 100) / 100;
  }

  return distribution;
}

/**
 * Assess Segment Quality
 *
 * Simple quality assessment based on word count.
 * More sophisticated quality checks can be added later.
 *
 * @param wordCount - Number of words in segment
 * @returns Quality grade
 */
function assessSegmentQuality(
  wordCount: number,
): "excellent" | "good" | "acceptable" | "poor" | "failed" {
  if (wordCount >= 100) {
    return "excellent";
  } else if (wordCount >= 50) {
    return "good";
  } else if (wordCount >= 20) {
    return "acceptable";
  } else if (wordCount >= 5) {
    return "poor";
  } else {
    return "failed";
  }
}
