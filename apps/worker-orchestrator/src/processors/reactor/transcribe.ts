import type { Job, Queue } from "bullmq";
import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { ReactorTranscribePayload } from "@repo/contracts";
import { ReactorTranscribePayloadSchema } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { contentJobs, eq } from "@repo/db";
import { getConfig } from "@repo/config";
import { runWhisper } from "@repo/media-core";
import { updateJobStatus } from "../../utils/update-job-status.js";
import { updateJobMetadata } from "../../utils/job-helpers.js";

/**
 * Extract audio from the reference video and transcribe it via FasterWhisper.
 * Stores word-level timestamps as a JSON file and the path in job metadata.
 */
export function createReactorTranscribeProcessor(
  db: DrizzleClient,
  queues: { reactorScript: Queue },
) {
  return async (job: Job<ReactorTranscribePayload>) => {
    const { job_id } = ReactorTranscribePayloadSchema.parse(job.data);

    console.log(
      JSON.stringify({
        level: "info",
        message: "Reactor transcribe processor started",
        job_id,
      }),
    );

    try {
      const [contentJob] = await db
        .select()
        .from(contentJobs)
        .where(eq(contentJobs.id, job_id))
        .limit(1);

      if (!contentJob) throw new Error(`Job ${job_id} not found`);

      const config = getConfig();
      const manifest = contentJob.r2_asset_manifest as Array<{
        key: string;
        type: string;
      }>;
      const sourceAsset = manifest.find(
        (a) => a.type === "video/reference-source",
      );
      if (!sourceAsset)
        throw new Error(`No reference source video in manifest for ${job_id}`);

      const sourcePath = join(config.LOCAL_MEDIA_ROOT, sourceAsset.key);
      const outputDir = dirname(sourcePath);
      const audioPath = join(outputDir, "source_audio.wav");

      // Extract audio
      await extractAudio(sourcePath, audioPath);

      // Transcribe with word-level timestamps
      const language = contentJob.language ?? "de";
      const words = await runWhisper(audioPath, language);

      // Save transcript to disk (can be large for 40-min videos)
      const transcriptPath = join(outputDir, "transcript.json");
      await writeFile(transcriptPath, JSON.stringify({ words }), "utf-8");

      // Clean up raw audio
      await unlink(audioPath).catch(() => {});

      await updateJobMetadata(db, job_id, {
        reference_transcript_path: join(
          contentJob.channel_id,
          job_id,
          "transcript.json",
        ),
        reference_word_count: words.length,
      });

      await updateJobStatus(db, job_id, "REACTOR_SCRIPTING");
      await queues.reactorScript.add("reactor-script", { job_id });

      console.log(
        JSON.stringify({
          level: "info",
          message: "Reactor transcribe complete",
          job_id,
          word_count: words.length,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        JSON.stringify({
          level: "error",
          message: "Reactor transcribe failed",
          job_id,
          error: msg,
        }),
      );
      await updateJobStatus(db, job_id, "FAILED_REACTOR_PIPELINE", msg).catch(
        () => {},
      );
      throw err;
    }
  };
}

function extractAudio(videoPath: string, audioPath: string): Promise<void> {
  const ffmpeg = process.env["FFMPEG_PATH"] ?? "ffmpeg";
  const args = [
    "-i",
    videoPath,
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-y",
    audioPath,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", (e) => reject(new Error(`ffmpeg error: ${e.message}`)));
    proc.on("close", (code) => {
      if (code !== 0)
        reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
      else resolve();
    });
  });
}
