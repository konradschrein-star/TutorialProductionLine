import type { Job, Queue } from "bullmq";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DramaTTSPayload, DramaTranscribePayload } from "@repo/contracts";
import { DramaTTSPayloadSchema } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { requestTTS } from "../../utils/tts-gateway.js";
import { crossfadeStitchAndMaster } from "../../utils/ffmpeg-tts-splicing.js";
import { updateJobStatus } from "../../utils/update-job-status.js";

const MEDIA_BASE =
  process.env["DRAMA_MEDIA_DIR"] ?? "/opt/content-forge/media/long-form-drama";
// Smaller chunks finish faster on AI33's ElevenLabs leg, which has been
// returning >6 min processing on 2.5 k char chunks. 1500 chars puts each
// chunk well inside the poll window so we don't time out (and waste the
// credits AI33 charges on submit, not on pickup).
const CHUNK_SIZE = 1500;

/**
 * Split script text into chunks of at most CHUNK_SIZE characters,
 * breaking at sentence boundaries (period/exclamation/question + space).
 */
function chunkScript(script: string): string[] {
  if (script.length <= CHUNK_SIZE) return [script];
  const chunks: string[] = [];
  let remaining = script;
  while (remaining.length > CHUNK_SIZE) {
    const window = remaining.slice(0, CHUNK_SIZE);
    const lastBreak = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? "),
    );
    if (lastBreak > 0) {
      chunks.push(remaining.slice(0, lastBreak + 2).trim());
      remaining = remaining.slice(lastBreak + 2);
    } else {
      chunks.push(window.trim());
      remaining = remaining.slice(CHUNK_SIZE);
    }
  }
  if (remaining.trim().length > 0) chunks.push(remaining.trim());
  return chunks;
}

/**
 * Long-Form Drama TTS Processor
 *
 * Generates TTS audio for the full script via AI33 ElevenLabs V3 in chunks,
 * concatenates them with ffmpeg, applies loudnorm to -14 LUFS,
 * and dispatches to the transcribe queue.
 */
export function createDramaTTSProcessor(
  db: DrizzleClient,
  queues: { dramaTranscribe: Queue<DramaTranscribePayload> },
  _elevenLabsApiKey: string,
) {
  return async (job: Job<DramaTTSPayload>) => {
    const { jobId, config } = DramaTTSPayloadSchema.parse(job.data);
    const { script, voiceId, ttsSpeed } = config;

    console.log(
      JSON.stringify({
        level: "info",
        message: "Drama TTS processor started",
        job_id: jobId,
        script_length: script.length,
        voice_id: voiceId,
      }),
    );

    try {
      const outputDir = join(MEDIA_BASE, jobId);
      await mkdir(outputDir, { recursive: true });

      const chunks = chunkScript(script);
      const tmpBase = join(tmpdir(), `drama-tts-${jobId}-${Date.now()}`);
      const chunkPaths: string[] = [];
      const audioPath = join(outputDir, "tts.mp3");

      console.log(
        JSON.stringify({
          level: "info",
          message: "TTS script chunked",
          job_id: jobId,
          chunk_count: chunks.length,
        }),
      );

      try {
        for (let i = 0; i < chunks.length; i++) {
          console.log(
            JSON.stringify({
              level: "info",
              message: "Generating TTS chunk",
              job_id: jobId,
              chunk_index: i,
              chunk_length: chunks[i]!.length,
            }),
          );
          const audioBuffer = await requestTTS(chunks[i]!, voiceId, {
            format: "LONG_FORM_DRAMA",
            speed: ttsSpeed,
          });
          const chunkPath = `${tmpBase}-chunk-${i}.mp3`;
          await writeFile(chunkPath, audioBuffer);
          chunkPaths.push(chunkPath);
        }

        // Single ffmpeg pass: crossfade chunk boundaries on decoded PCM,
        // loudnorm to -14 LUFS, layer -60 dB analog floor. Replaces the
        // old raw concat-demuxer + separate loudnorm step, which produced
        // audible MP3-frame clicks at chunk seams.
        await crossfadeStitchAndMaster(chunkPaths, audioPath, {
          loudnormTp: -2,
        });
      } finally {
        for (const p of chunkPaths) {
          await unlink(p).catch(() => {});
        }
      }

      console.log(
        JSON.stringify({
          level: "info",
          message: "Drama TTS audio saved",
          job_id: jobId,
          audio_path: audioPath,
        }),
      );

      await updateJobStatus(db, jobId, "DRAMA_TRANSCRIBING");

      await queues.dramaTranscribe.add(
        "drama-transcribe",
        { jobId, audioPath, script },
        { jobId: `drama-transcribe-${jobId}`, attempts: 2 },
      );

      console.log(
        JSON.stringify({
          level: "info",
          message: "Drama TTS processor complete",
          job_id: jobId,
        }),
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      console.log(
        JSON.stringify({
          level: "error",
          message: "Drama TTS processor failed",
          job_id: jobId,
          error: errorMessage,
        }),
      );

      try {
        await updateJobStatus(db, jobId, "FAILED_DRAMA_PIPELINE", errorMessage);
      } catch {
        // no-op
      }
      throw err;
    }
  };
}
