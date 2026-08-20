import type { Job, Queue } from "bullmq";
import { spawn } from "node:child_process";
import { mkdir, rename, stat, copyFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { ReactorDownloadPayload } from "@repo/contracts";
import { ReactorDownloadPayloadSchema } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { contentJobs, eq } from "@repo/db";
import { getConfig } from "@repo/config";
import { updateJobStatus } from "../../utils/update-job-status.js";

/**
 * Download a YouTube video via yt-dlp and store it as the reference source.
 */
export function createReactorDownloadProcessor(
  db: DrizzleClient,
  queues: { reactorTranscribe: Queue },
) {
  return async (job: Job<ReactorDownloadPayload>) => {
    const { job_id } = ReactorDownloadPayloadSchema.parse(job.data);

    console.log(
      JSON.stringify({
        level: "info",
        message: "Reactor download processor started",
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

      const metadata = (contentJob.metadata ?? {}) as Record<string, unknown>;
      const youtubeUrl = metadata["youtube_url"] as string | undefined;
      const localSourcePath = metadata["local_source_path"] as
        | string
        | undefined;
      if (!youtubeUrl && !localSourcePath)
        throw new Error(
          `Job ${job_id} has no youtube_url or local_source_path in metadata`,
        );

      const config = getConfig();
      const outputDir = join(
        config.LOCAL_MEDIA_ROOT,
        contentJob.channel_id,
        job_id,
      );
      await mkdir(outputDir, { recursive: true });

      const tmpPath = join(outputDir, "source_tmp.mp4");
      const finalPath = join(outputDir, "source.mp4");

      if (localSourcePath) {
        // Local-file path: skip yt-dlp entirely. Used for smoke tests and
        // when the source already lives on disk (no YouTube anti-bot).
        await access(localSourcePath);
        await copyFile(localSourcePath, tmpPath);
      } else {
        await ytDlpDownload(youtubeUrl as string, tmpPath);
      }
      await rename(tmpPath, finalPath);

      const { size: sizeBytes } = await stat(finalPath);

      const manifest = (contentJob.r2_asset_manifest ?? []) as Array<{
        key: string;
        type: string;
        size_bytes: number;
      }>;

      const updatedManifest = [
        ...manifest,
        {
          key: join(contentJob.channel_id, job_id, "source.mp4"),
          type: "video/reference-source",
          size_bytes: sizeBytes,
        },
      ];

      await db
        .update(contentJobs)
        .set({ r2_asset_manifest: updatedManifest })
        .where(eq(contentJobs.id, job_id));

      await updateJobStatus(db, job_id, "REACTOR_TRANSCRIBING");
      await queues.reactorTranscribe.add("reactor-transcribe", { job_id });

      console.log(
        JSON.stringify({
          level: "info",
          message: "Reactor download complete",
          job_id,
          size_mb: (sizeBytes / 1024 / 1024).toFixed(1),
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        JSON.stringify({
          level: "error",
          message: "Reactor download failed",
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

function ytDlpDownload(url: string, outputPath: string): Promise<void> {
  const bin = process.env["YTDLP_PATH"] ?? "yt-dlp";
  const nodePath = process.env["NODE_PATH"] ?? "/usr/bin/node";
  const cookiesPath = process.env["YTDLP_COOKIES_PATH"];
  const args = [
    "--js-runtimes",
    `node:${nodePath}`,
    "--format",
    "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
    "--merge-output-format",
    "mp4",
    "--no-playlist",
    "--output",
    outputPath,
  ];
  if (cookiesPath) {
    args.push("--cookies", cookiesPath);
  }
  args.push(url);

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stderr = "";

    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      console.log(`[yt-dlp] ${d.toString().trim()}`);
    });
    proc.stdout.on("data", (d: Buffer) => {
      console.log(`[yt-dlp] ${d.toString().trim()}`);
    });

    proc.on("error", (e) =>
      reject(new Error(`yt-dlp not found: ${e.message}`)),
    );
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(-500)}`));
      } else {
        resolve();
      }
    });
  });
}
