import type { Job, Queue } from "bullmq";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rename } from "node:fs/promises";
import type {
  TutorialSplicePayload,
  TutorialStitchPayload,
  ThumbnailPayload,
} from "@repo/contracts";
import { TutorialSplicePayloadSchema } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import {
  getTutorialJobById,
  updateTutorialJob,
  listTutorialJobsByParent,
} from "@repo/db";
import {
  probeMedia,
  probeMediaDimensions,
  muxTtsOntoRecording,
  detectLeadingSilence,
  detectTtsOffsetByAudioMatch,
} from "@repo/media-core";
import { deriveLogoSubject } from "@repo/domain";
import { firstNSentences } from "../../utils/thumbnail/prompt-builder.js";
import { isFinalAttempt } from "../../utils/tutorial/attempts.js";
import {
  buildNewVideoTreatmentArgs,
  ctaForLanguage,
} from "../../utils/tutorial/new-video-treatment.js";
import { buildLikeSubscribeOutroArgs } from "../../utils/tutorial/like-subscribe-outro.js";

const execFileAsync = promisify(execFile);

const LOCAL_MEDIA_ROOT =
  process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";

/**
 * Tutorial Splice Processor
 *
 * Muxes the TTS audio onto the screen recording. The audio is always the
 * master clock (output length = TTS length); the video is fit to it two ways:
 *   1. Probe recording duration + TTS duration; detect the lead-in offset
 *   2. English original → fitMode "trim": natural 1× speed, cut the overhang
 *      (freeze last frame if the recording is shorter than the narration)
 *   3. Translation → fitMode "stretch": time-scale the reused footage to the
 *      localized audio (factor = audioDuration / effectiveRecording)
 *   4. FFmpeg mux — drops original mic audio, maps the clean 1× TTS track
 *   5. Save final_path and mark COMPLETED
 */
export function createTutorialSpliceProcessor(
  db: DrizzleClient,
  queues: {
    tutorialStitch: Queue<TutorialStitchPayload>;
    thumbnail: Queue<ThumbnailPayload>;
  },
) {
  return async (job: Job<TutorialSplicePayload>) => {
    const { jobId } = TutorialSplicePayloadSchema.parse(job.data);

    console.log(
      JSON.stringify({
        level: "info",
        message: "Tutorial splice processor started",
        job_id: jobId,
      }),
    );

    const tutorialJob = await getTutorialJobById(db, jobId);
    if (!tutorialJob) {
      throw new Error(`Tutorial job ${jobId} not found`);
    }

    try {
      await updateTutorialJob(db, jobId, {
        status: "SPLICING",
        progress: 90,
      });

      const recordingPath = tutorialJob.recording_path;
      const ttsAudioPath = tutorialJob.audio_path;

      if (!recordingPath) {
        throw new Error(`Tutorial job ${jobId} has no recording_path`);
      }
      if (!ttsAudioPath) {
        throw new Error(`Tutorial job ${jobId} has no audio_path`);
      }

      // Probe both files + detect TTS start offset in the OBS recording.
      //
      // Primary: audio cross-correlation. The OBS recording captures the TTS
      // playing through the computer speakers, so the TTS waveform is present
      // in the recording's audio track at exactly the moment it started.
      // Cross-correlation finds that moment without relying on silence
      // thresholds or keyframe snapping. Returns 0 if the recording has no
      // significant audio (OBS desktop audio not enabled).
      //
      // Fallback: silence detection (scanSeconds: 8 to cap lead-in at one
      // countdown worth of time).
      const [recordingProbe, ttsProbe] = await Promise.all([
        probeMedia(recordingPath),
        probeMedia(ttsAudioPath),
      ]);

      let leadInSeconds = await detectTtsOffsetByAudioMatch(
        recordingPath,
        ttsAudioPath,
      );

      if (leadInSeconds === 0) {
        // Audio track was silent — OBS may not have desktop audio enabled.
        // Fall back to leading-silence scan.
        leadInSeconds = await detectLeadingSilence(recordingPath, {
          scanSeconds: 8,
        });
      }

      console.log(
        JSON.stringify({
          level: "info",
          message: "Tutorial splice: lead-in detection complete",
          job_id: jobId,
          lead_in_method: leadInSeconds > 0 ? "audio_match" : "silence_detect",
          lead_in_seconds: leadInSeconds,
        }),
      );

      const recordingDurationS = recordingProbe.durationSeconds;
      const ttsDurationS = ttsProbe.durationSeconds;
      const effectiveRecordingS = recordingDurationS - leadInSeconds;

      if (recordingDurationS <= 0) {
        throw new Error(
          `Recording duration is zero or negative for job ${jobId}`,
        );
      }
      if (effectiveRecordingS <= 0.5) {
        throw new Error(
          `Recording is too short after trimming ${leadInSeconds.toFixed(2)}s of leading silence (effective ${effectiveRecordingS.toFixed(2)}s) for job ${jobId}`,
        );
      }
      if (ttsDurationS <= 0) {
        throw new Error(`TTS duration is zero or negative for job ${jobId}`);
      }

      // The audio is always the master clock — the output is exactly the TTS
      // length either way — but HOW the video is fit to it differs by kind
      // (owner model, 2026-08-24):
      //
      //   • English original (no source_job_id): natural 1× speed. Sync the
      //     start off the audio (lead-in already trimmed above) and CUT the
      //     overhanging tail. The recorded cursor moves at real speed and are
      //     never sped up/slowed to force a fit. If the recording ends before
      //     the narration, freeze the last frame so the audio isn't truncated.
      //
      //   • Translation (source_job_id set): the reused English footage is a
      //     fixed length while the localized audio is not, so there's no
      //     natural tail to trust — time-scale (stretch) the video to the
      //     localized audio so it always runs exactly that long.
      const isTranslation = Boolean(tutorialJob.source_job_id);
      // factor > 1 slows the video; factor < 1 speeds it up. Only used in the
      // translation (stretch) path; English runs at 1× (fitMode "trim").
      const factor = isTranslation ? ttsDurationS / effectiveRecordingS : 1;
      const fitMode: "stretch" | "trim" = isTranslation ? "stretch" : "trim";
      const padTailSeconds = isTranslation
        ? 0
        : Math.max(0, ttsDurationS - effectiveRecordingS);

      console.log(
        JSON.stringify({
          level: "info",
          message: "Tutorial splice: computed fit plan",
          job_id: jobId,
          kind: isTranslation ? "translation" : "english_original",
          fit_mode: fitMode,
          recording_duration_s: recordingDurationS,
          lead_in_silence_s: leadInSeconds,
          effective_recording_s: effectiveRecordingS,
          tts_duration_s: ttsDurationS,
          factor,
          pad_tail_s: padTailSeconds,
        }),
      );

      const outputDir = join(LOCAL_MEDIA_ROOT, "tutorial", jobId);
      const outputPath = join(outputDir, "final.mp4");

      await muxTtsOntoRecording({
        recordingPath,
        ttsAudioPath,
        outputPath,
        factor,
        fitMode,
        padTailSeconds,
        inputOffsetSeconds: leadInSeconds,
        // Splice is the final 90% → 100% of overall job progress. Map the
        // ffmpeg-reported mux progress (0-100% of the mux itself) onto
        // that range so the studio progress bar moves smoothly while
        // splicing.
        outputDurationSeconds: ttsDurationS,
        onProgress: async (muxPercent) => {
          const overall = 90 + Math.min(9, Math.floor(muxPercent / 11));
          await updateTutorialJob(db, jobId, { progress: overall }).catch(
            () => {},
          );
        },
      });

      // "New video" treatment — TRANSLATED children only (source_job_id set),
      // never the English original. Composites the tutorial onto an animated
      // color-coded background with a rounded framed border, +2% stretch,
      // saturation, pixel-shift and a language CTA at ~70% so each language
      // version is a distinct video (avoids cross-channel duplicate detection).
      if (tutorialJob.source_job_id) {
        const treatedPath = join(outputDir, "final.treated.mp4");
        const argv = buildNewVideoTreatmentArgs(outputPath, treatedPath, {
          seed: jobId,
          ctaText: ctaForLanguage(tutorialJob.language ?? "en"),
          durationSec: ttsDurationS,
        });
        console.log(
          JSON.stringify({
            level: "info",
            message: "Tutorial splice: applying new-video treatment",
            job_id: jobId,
            language: tutorialJob.language,
          }),
        );
        // execFileAsync (not raw spawn().on) to match the ffmpeg calls in
        // generate.ts and stay clear of the @types/node ChildProcess.on typing
        // issue. Rejects on non-zero exit; the large maxBuffer covers ffmpeg's
        // verbose stderr on a full-video pass.
        await execFileAsync(argv[0]!, argv.slice(1), {
          maxBuffer: 64 * 1024 * 1024,
        });
        await rename(treatedPath, outputPath); // overwrite final.mp4 in place
      }

      // ── Like & Subscribe outro ──────────────────────────────────────────
      // Append a short animated end card to EVERY finished video (owner
      // directive). Best-effort: a finished tutorial is worth far more than a
      // missing end card, so a font/ffmpeg edge case logs a warning and leaves
      // the video as-is rather than failing the job. Skipped for SIX_MIN_STITCH
      // CHILD segments (parent_job_id set) — those are intermediate and get the
      // outro once, on the stitched parent, in the stitch processor.
      if (!tutorialJob.parent_job_id) {
        try {
          const dims = await probeMediaDimensions(outputPath);
          const outroPath = join(outputDir, "final.outro.mp4");
          const argv = buildLikeSubscribeOutroArgs(outputPath, outroPath, {
            width: dims.width,
            height: dims.height,
            seed: jobId,
            lang: tutorialJob.language ?? "en",
          });
          await execFileAsync(argv[0]!, argv.slice(1), {
            maxBuffer: 64 * 1024 * 1024,
          });
          await rename(outroPath, outputPath); // overwrite final.mp4 in place
          console.log(
            JSON.stringify({
              level: "info",
              message: "Tutorial splice: appended like/subscribe outro",
              job_id: jobId,
              language: tutorialJob.language ?? "en",
            }),
          );
        } catch (outroErr) {
          console.error(
            JSON.stringify({
              level: "warn",
              message: "Like/subscribe outro failed (non-fatal) — shipping video without it",
              job_id: jobId,
              error:
                outroErr instanceof Error ? outroErr.message : String(outroErr),
            }),
          );
        }
      }
      // ── End like & subscribe outro ──────────────────────────────────────

      await updateTutorialJob(db, jobId, {
        final_path: outputPath,
        recording_duration_s: String(recordingDurationS),
        status: "COMPLETED",
        completed_at: new Date(),
        progress: 100,
      });

      console.log(
        JSON.stringify({
          level: "info",
          message: "Tutorial splice processor complete",
          job_id: jobId,
          output_path: outputPath,
        }),
      );

      // ── Auto thumbnail (non-blocking) ───────────────────────────────────
      // Only for user-facing videos: single-segment jobs (no parent). Child
      // segments of a SIX_MIN_STITCH job are intermediate — the parent gets
      // its thumbnail from the stitch processor instead.
      //
      // A job with no channel STILL gets a thumbnail from the format + global
      // rules (DECISIONS §3.2.8 — full automation); channel branding is an
      // enhancement, not a precondition. The old `tutorialJob.channel_id &&`
      // guard silently skipped 95% of tutorials (1,793 of 1,878 completed
      // top-level jobs have no channel) with no log, no row, no trace. This
      // mirrors the same fix already made for content jobs in
      // worker-render/src/utils/enqueue-thumbnail.ts (plan A2.6).
      // Skip translated children (source_job_id set): no thumbnails for the
      // localized versions for now — thumbnails are produced on the English
      // original only (owner directive 2026-08-23).
      if (!tutorialJob.parent_job_id && !tutorialJob.source_job_id) {
        try {
          const excerpt = firstNSentences(tutorialJob.script_text ?? "", 5);
          // The SOFTWARE this tutorial is about. Without it the brief compiler
          // has no product to brand and the thumbnail never names the tool —
          // zero of 112 tutorial briefs carried one before this. Null when the
          // title does not identify a product; the field is then omitted and
          // the existing title-derived fallback applies unchanged.
          const logoSubject = deriveLogoSubject(tutorialJob.title);
          await queues.thumbnail.add(
            "thumbnail",
            {
              subjectKind: "tutorial_job",
              subjectId: jobId,
              format: "TUTORIAL_STUDIO",
              channelId: tutorialJob.channel_id,
              title: tutorialJob.title,
              topic: tutorialJob.title,
              scriptExcerpt: excerpt,
              ...(logoSubject !== null ? { logoSubject } : {}),
              language: "en",
            },
            { jobId: `thumbnail-${jobId}`, attempts: 2 },
          );
        } catch (thumbErr) {
          console.error(
            JSON.stringify({
              level: "warn",
              message: "Failed to enqueue tutorial thumbnail (non-fatal)",
              job_id: jobId,
              error:
                thumbErr instanceof Error ? thumbErr.message : String(thumbErr),
            }),
          );
        }
      }
      // ── End auto thumbnail ──────────────────────────────────────────────

      // ── SIX_MIN_STITCH sibling check ────────────────────────────────────
      // If this is a child segment, check whether all siblings are COMPLETED.
      // If they are, enqueue the stitch job for the parent (idempotent jobId).
      if (tutorialJob.parent_job_id) {
        const siblings = await listTutorialJobsByParent(
          db,
          tutorialJob.parent_job_id,
        );
        const allDone =
          siblings.length > 0 &&
          siblings.every((s) => s.status === "COMPLETED");
        if (allDone) {
          await queues.tutorialStitch.add(
            "tutorial-stitch",
            { parentJobId: tutorialJob.parent_job_id },
            {
              jobId: `tutorial-stitch-${tutorialJob.parent_job_id}`,
              attempts: 2,
            },
          );
          console.log(
            JSON.stringify({
              level: "info",
              message: "Tutorial stitch enqueued — all segments COMPLETED",
              parent_job_id: tutorialJob.parent_job_id,
              segment_count: siblings.length,
            }),
          );
        }
      }
      // ── End SIX_MIN_STITCH sibling check ────────────────────────────────
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Only persist FAILED_SPLICE when BullMQ has no retry left. Writing it
      // on every attempt made the studio flash a red "Splice failed" card with
      // an error message that vanished seconds later when the retry succeeded
      // — the VA-reported "error message that disappeared".
      const finalAttempt = isFinalAttempt(job);

      console.error(
        JSON.stringify({
          level: finalAttempt ? "error" : "warn",
          message: finalAttempt
            ? "Tutorial splice processor failed"
            : "Tutorial splice attempt failed — retrying",
          job_id: jobId,
          attempt: (job.attemptsMade ?? 0) + 1,
          max_attempts: job.opts?.attempts ?? 1,
          error: errorMessage,
        }),
      );

      if (finalAttempt) {
        try {
          await updateTutorialJob(db, jobId, {
            status: "FAILED_SPLICE",
            error_stage: "splice",
            error_message: errorMessage,
          });
        } catch {
          // no-op
        }
      }
      throw err;
    }
  };
}
