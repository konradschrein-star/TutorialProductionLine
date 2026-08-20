import type { Job, Queue } from "bullmq";
import { Queue as BullQueue, QueueEvents } from "bullmq";
import type {
  DramaTranscribePayload,
  DramaPromptGenPayload,
} from "@repo/contracts";
import { DramaTranscribePayloadSchema } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { runWhisper } from "@repo/media-core";
import { createRedisConnection } from "@repo/queue";
import { updateJobStatus } from "../../utils/update-job-status.js";
import { updateJobMetadata } from "../../utils/job-helpers.js";

// Read env LAZILY at processor-call time, not module-load time. ES modules
// evaluate imports before any non-import statements run, so a top-level
// `process.env[...]` constant captures the env BEFORE dotenv has populated
// it — masking the offload flag as off forever.
function isTranscribeOffloadEnabled(): boolean {
  return process.env["TRANSCRIBE_OFFLOAD_ENABLED"] === "true";
}
function transcribeOffloadTimeoutMs(): number {
  return Number(process.env["TRANSCRIBE_OFFLOAD_TIMEOUT_MS"] ?? "1800000");
}
const TRANSCRIBE_OFFLOAD_QUEUE_NAME = "queue-transcribe-offload";

interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

/**
 * Try to offload Whisper to the user's local CUDA worker. Returns the
 * word timestamps on success, or null on any error so the caller can
 * fall through to the VPS-side runWhisper.
 */
async function tryTranscribeOffload(
  audioPath: string,
  language: string,
  parentJobId: string,
): Promise<WordTimestamp[] | null> {
  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) return null;
  const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
  const eventsConn = createRedisConnection({ url: redisUrl, mode: "queue" });
  const queue = new BullQueue<{ audio_path: string; language: string }>(
    TRANSCRIBE_OFFLOAD_QUEUE_NAME,
    { connection: conn },
  );
  const events = new QueueEvents(TRANSCRIBE_OFFLOAD_QUEUE_NAME, {
    connection: eventsConn,
  });
  try {
    await events.waitUntilReady();

    // Skip if no local worker is connected — keeps the env flag safe to leave
    // ON permanently. VPS Whisper runs only when GPU worker isn't around.
    const workers = await queue.getWorkers();
    if (workers.length === 0) {
      console.log(
        JSON.stringify({
          level: "info",
          message:
            "Transcribe offload enabled but no GPU worker, using VPS Whisper",
          parent_job_id: parentJobId,
        }),
      );
      return null;
    }

    const job = await queue.add(
      "transcribe",
      { audio_path: audioPath, language },
      {
        jobId: `transcribe-${parentJobId}-${Date.now()}`,
        attempts: 1,
        removeOnComplete: 50,
        removeOnFail: 50,
      },
    );
    console.log(
      JSON.stringify({
        level: "info",
        message: "Transcribe offloaded to GPU worker",
        parent_job_id: parentJobId,
        transcribe_job_id: job.id,
      }),
    );
    const result = (await job.waitUntilFinished(
      events,
      transcribeOffloadTimeoutMs(),
    )) as { word_timestamps: WordTimestamp[] };
    return result.word_timestamps;
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "Transcribe offload failed, falling back to local Whisper",
        parent_job_id: parentJobId,
        error: String(err).slice(0, 300),
      }),
    );
    return null;
  } finally {
    await events.close().catch(() => {});
    await queue.close().catch(() => {});
    conn.disconnect();
    eventsConn.disconnect();
  }
}

/**
 * Long-Form Drama Transcribe Processor
 *
 * Runs Whisper on the TTS audio to get word-level timestamps (seconds),
 * converts them to ms, stores in job metadata, and dispatches to prompt-gen.
 */
export function createDramaTranscribeProcessor(
  db: DrizzleClient,
  queues: { dramaPromptGen: Queue<DramaPromptGenPayload> },
) {
  return async (job: Job<DramaTranscribePayload>) => {
    const { jobId, audioPath, script } = DramaTranscribePayloadSchema.parse(
      job.data,
    );

    console.log(
      JSON.stringify({
        level: "info",
        message: "Drama transcribe processor started",
        job_id: jobId,
        audio_path: audioPath,
      }),
    );

    try {
      // Try GPU offload first; fall back to VPS-side Whisper if the local
      // worker is offline or the offload errored.
      let wordTimestamps: WordTimestamp[] | null = null;
      if (isTranscribeOffloadEnabled()) {
        wordTimestamps = await tryTranscribeOffload(audioPath, "en", jobId);
      }
      if (!wordTimestamps) {
        // runWhisper returns WordTimestamp[] — { word, start, end } in seconds
        wordTimestamps = await runWhisper(audioPath, "en");
      }

      console.log(
        JSON.stringify({
          level: "info",
          message: "Whisper transcription complete",
          job_id: jobId,
          word_count: wordTimestamps.length,
        }),
      );

      // Convert to ms-based format for downstream prompt-gen and assembly
      const wordTimings = wordTimestamps.map((w) => ({
        word: w.word,
        start_ms: Math.round(w.start * 1000),
        end_ms: Math.round(w.end * 1000),
      }));

      await updateJobMetadata(db, jobId, {
        drama_word_timings: wordTimings,
        drama_script: script,
        drama_audio_path: audioPath,
      });

      await updateJobStatus(db, jobId, "DRAMA_PROMPT_GENERATING");

      await queues.dramaPromptGen.add(
        "drama-prompt-gen",
        { jobId },
        { jobId: `drama-prompt-gen-${jobId}`, attempts: 2 },
      );

      console.log(
        JSON.stringify({
          level: "info",
          message: "Drama transcribe processor complete",
          job_id: jobId,
          word_timings_count: wordTimings.length,
        }),
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      console.log(
        JSON.stringify({
          level: "error",
          message: "Drama transcribe processor failed",
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
