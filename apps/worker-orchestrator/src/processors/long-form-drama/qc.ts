import type { Job } from "bullmq";
import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DramaQCPayload } from "@repo/contracts";
import { DramaQCPayloadSchema } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { updateJobStatus } from "../../utils/update-job-status.js";
import { updateJobMetadata } from "../../utils/job-helpers.js";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";
const FFPROBE_BIN = process.env["FFPROBE_PATH"] ?? "ffprobe";

async function checkBlackFrames(videoPath: string): Promise<void> {
  const { stderr } = await execFileAsync(FFMPEG_BIN, [
    "-i",
    videoPath,
    "-vf",
    "blackdetect=d=0.5:pix_th=0.1",
    "-an",
    "-f",
    "null",
    "-",
  ]);
  const blackMatches = stderr.match(/black_start/g) ?? [];
  if (blackMatches.length > 0) {
    throw new Error(
      `QC FAIL: ${blackMatches.length} black frame segment(s) detected`,
    );
  }
}

async function checkLUFS(audioPath: string): Promise<void> {
  const { stderr } = await execFileAsync(FFMPEG_BIN, [
    "-i",
    audioPath,
    "-af",
    "loudnorm=I=-14:TP=-2:LRA=11:print_format=json",
    "-f",
    "null",
    "-",
  ]);
  const match = stderr.match(/"input_i"\s*:\s*"(-?[\d.]+)"/);
  if (match) {
    const measuredLUFS = parseFloat(match[1]!);
    if (Math.abs(measuredLUFS - -14) > 3) {
      throw new Error(
        `QC FAIL: Audio LUFS is ${measuredLUFS.toFixed(1)}, expected -14 ±3`,
      );
    }
  }
}

async function checkSceneDistribution(videoPath: string): Promise<void> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("scenedetect", [
      "-i",
      videoPath,
      "detect-adaptive",
      "list-scenes",
      "--output",
      "-",
    ]));
  } catch {
    // scenedetect not available — skip this check
    console.log(
      JSON.stringify({
        level: "warn",
        message:
          "pyscenedetect not available, skipping scene distribution check",
      }),
    );
    return;
  }

  const lines = stdout.split("\n").filter((l) => /^\d+,/.test(l));
  const sceneTimes = lines
    .map((l) => parseFloat(l.split(",")[3] ?? "0"))
    .filter((t) => !isNaN(t));

  if (sceneTimes.length < 2) return;

  const { stdout: probeOut } = await execFileAsync(FFPROBE_BIN, [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    videoPath,
  ]);
  const probeData = JSON.parse(probeOut) as { format: { duration: string } };
  const totalDuration = parseFloat(probeData.format.duration);

  const tenPctMark = totalDuration * 0.1;
  const bodyScenes = sceneTimes.filter((t) => t >= tenPctMark);
  if (bodyScenes.length < 2) return;

  const intervals: number[] = [];
  for (let i = 1; i < bodyScenes.length; i++) {
    intervals.push(bodyScenes[i]! - bodyScenes[i - 1]!);
  }

  const medianInterval = [...intervals].sort((a, b) => a - b)[
    Math.floor(intervals.length / 2)
  ]!;
  const maxInterval = Math.max(...intervals);

  if (maxInterval > medianInterval * 3) {
    throw new Error(
      `QC FAIL: Scene distribution uneven — longest body interval ${maxInterval.toFixed(0)}s vs median ${medianInterval.toFixed(0)}s (ratio ${(maxInterval / medianInterval).toFixed(1)}×, max allowed 3×)`,
    );
  }
}

const VEO_OUTPUT_DIR =
  process.env["VEO_OUTPUT_LAB_DIR"] ?? "/opt/veo-output-lab";
const PUBLIC_BASE_URL =
  process.env["PUBLIC_MEDIA_BASE_URL"] ??
  "https://hub.schreinercontentsystems.com/veo-lab-files";

async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync(FFPROBE_BIN, [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    videoPath,
  ]);
  const data = JSON.parse(stdout) as { format: { duration: string } };
  return parseFloat(data.format.duration);
}

async function generatePreviewClip(
  videoPath: string,
  jobId: string,
): Promise<string> {
  const duration = await getVideoDuration(videoPath);
  const clipDur = 10;
  const starts = [
    2,
    Math.max(2, Math.floor(duration / 2) - 5),
    Math.max(2, Math.floor(duration) - 12),
  ];

  const tmpDir = "/tmp";
  const segPaths: string[] = [];

  for (let i = 0; i < starts.length; i++) {
    const seg = join(tmpDir, `preview-seg-${jobId}-${i}.mp4`);
    await execFileAsync(FFMPEG_BIN, [
      "-y",
      "-ss",
      String(starts[i]),
      "-i",
      videoPath,
      "-t",
      String(clipDur),
      "-c",
      "copy",
      seg,
    ]);
    segPaths.push(seg);
  }

  const concatList = join(tmpDir, `preview-concat-${jobId}.txt`);
  await writeFile(concatList, segPaths.map((p) => `file '${p}'`).join("\n"));

  const previewPath = join(VEO_OUTPUT_DIR, `preview-${jobId}.mp4`);
  await execFileAsync(FFMPEG_BIN, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatList,
    "-c",
    "copy",
    previewPath,
  ]);

  // Cleanup temp files
  await Promise.all([
    ...segPaths.map((p) => unlink(p).catch(() => {})),
    unlink(concatList).catch(() => {}),
  ]);

  return `${PUBLIC_BASE_URL}/preview-${jobId}.mp4`;
}

export function createDramaQCProcessor(db: DrizzleClient) {
  return async (job: Job<DramaQCPayload>) => {
    const { jobId, outputPath, audioPath } = DramaQCPayloadSchema.parse(
      job.data,
    );

    try {
      await checkBlackFrames(outputPath);
      await checkLUFS(audioPath);
      await checkSceneDistribution(outputPath);

      // Extract start/middle/end 10s preview for human QC review
      let previewUrl: string | null = null;
      try {
        previewUrl = await generatePreviewClip(outputPath, jobId);
        await updateJobMetadata(db, jobId, { drama_preview_url: previewUrl });
        console.log(
          JSON.stringify({
            level: "info",
            message: "Drama QC preview generated",
            job_id: jobId,
            preview_url: previewUrl,
          }),
        );
      } catch (previewErr) {
        console.log(
          JSON.stringify({
            level: "warn",
            message: "Drama QC preview generation failed (non-fatal)",
            job_id: jobId,
            error: String(previewErr),
          }),
        );
      }

      await updateJobStatus(db, jobId, "AWAITING_QC");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        JSON.stringify({
          level: "warn",
          message: "Drama QC failed",
          job_id: jobId,
          reason: msg,
        }),
      );
      await updateJobStatus(db, jobId, "DRAMA_QC_FAILED", msg).catch(() => {});
      throw err;
    }
  };
}
