import type { Job, Queue } from "bullmq";
import { Queue as BullQueue, QueueEvents } from "bullmq";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import type { DramaAssemblePayload, DramaQCPayload } from "@repo/contracts";
import {
  DramaAssemblePayloadSchema,
  type DramaAssemblePayload as _DramaAssemblePayload,
} from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { contentJobs } from "@repo/db";
import {
  getDramaClipsByJob,
  insertReadyStockClip,
} from "@repo/db/repositories";
import { copyFile, stat as fsStat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { updateJobStatus } from "../../utils/update-job-status.js";
import { updateJobMetadata } from "../../utils/job-helpers.js";
import { generateKenBurnsSegment, selectMotionPreset } from "./ken-burns.js";
import { generateAssFile } from "./subtitles.js";
import type { WordTiming } from "./prompt-gen-utils.js";
import { createRedisConnection } from "@repo/queue";
import {
  assembleMusicBed,
  MUSIC_PROMPTS,
  type MusicTrack,
} from "../../utils/music-engine.js";
import { writeFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";
const FFPROBE_BIN = process.env["FFPROBE_PATH"] ?? "ffprobe";
const MEDIA_BASE =
  process.env["DRAMA_MEDIA_DIR"] ?? "/opt/content-forge/media/long-form-drama";
const CROSSFADE_SEC = Number(process.env["DRAMA_CROSSFADE_SEC"] ?? "0.4");
const EXEC_MAX_BUFFER = 64 * 1024 * 1024;

async function isPlayableMp4(path: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      FFPROBE_BIN,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path,
      ],
      { maxBuffer: EXEC_MAX_BUFFER },
    );
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0.1;
  } catch {
    return false;
  }
}

async function probeDurationSec(path: string): Promise<number> {
  const { stdout } = await execFileAsync(
    FFPROBE_BIN,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      path,
    ],
    { maxBuffer: EXEC_MAX_BUFFER },
  );
  return parseFloat(stdout.trim());
}
// Lazy env reads — ES modules evaluate module-level constants BEFORE
// dotenv runs in index.ts, so a top-level `process.env[...]` would freeze
// the offload as off forever even with the flag set.
function isEncodeOffloadEnabled(): boolean {
  return process.env["ENCODE_OFFLOAD_ENABLED"] === "true";
}
function encodeOffloadTimeoutMs(): number {
  return Number(process.env["ENCODE_OFFLOAD_TIMEOUT_MS"] ?? "1800000");
}
const ENCODE_OFFLOAD_QUEUE_NAME = "queue-encode-offload";

/**
 * Render one group of clips into a single mp4: normalize each input to
 * 1920×1080 yuv420p, then xfade them together using the same crossfade
 * geometry as the old single-chain approach. Output has no audio and no
 * subtitles (those are added once at the end across all groups).
 *
 * Groups render in parallel and each one only buffers GROUP_SIZE input
 * streams instead of the full clip count — that's the whole point.
 */
async function renderGroup(
  segPaths: string[],
  durations: number[],
  outputPath: string,
): Promise<void> {
  const inputArgs: string[] = [];
  for (const seg of segPaths) inputArgs.push("-i", seg);

  let filter = "";
  for (let i = 0; i < segPaths.length; i++) {
    filter +=
      `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,` +
      `pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,` +
      `setsar=1,format=yuv420p,fps=25[n${i}];`;
  }

  let lastLabel: string;
  if (segPaths.length === 1) {
    // Single-clip group: just rename the normalized output as the group
    // output, no xfade needed.
    filter = filter.replace("[n0];", "[gout];");
    lastLabel = "[gout]";
  } else {
    let prevLabel = "[n0]";
    let offset = durations[0]! - CROSSFADE_SEC;
    for (let i = 1; i < segPaths.length; i++) {
      const outLabel = i === segPaths.length - 1 ? "[gout]" : `[v${i}]`;
      filter += `${prevLabel}[n${i}]xfade=transition=fade:duration=${CROSSFADE_SEC}:offset=${offset.toFixed(3)}${outLabel};`;
      prevLabel = outLabel;
      if (i < segPaths.length - 1) offset += durations[i]! - CROSSFADE_SEC;
    }
    // Drop the trailing semicolon — last filter in the chain must not have
    // one or ffmpeg parses it as an extra (empty) filter and errors out.
    filter = filter.replace(/;$/, "");
    lastLabel = "[gout]";
  }

  await execFileAsync(
    FFMPEG_BIN,
    [
      ...inputArgs,
      "-filter_complex",
      filter,
      "-map",
      lastLabel,
      "-c:v",
      "libx264",
      "-crf",
      "20",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-an",
      "-y",
      outputPath,
    ],
    { maxBuffer: EXEC_MAX_BUFFER },
  );
}

/**
 * Escape an absolute path so it survives inside a filter_complex string.
 * The subtitles= argument is single-quoted, so we have to escape:
 *   - backslashes  (Windows path separators)
 *   - single quotes  (shouldn't appear but defensive)
 *   - the colon after the drive letter / in URLs
 *   - the comma (filter argument separator)
 *   - the open bracket (would be parsed as a stream label)
 * The replace order matters: backslash first, then everything else.
 */
function escapeFilterPath(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/'/g, "'\\''")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

interface EncodeOffloadJobData {
  source_files: string[];
  filter_complex: string;
  output_args: string[];
  vps_output_path: string;
}

/**
 * Push the final ffmpeg encode to the user's local NVENC worker via the
 * encode-offload BullMQ queue. Falls back to local libx264 on timeout or
 * any error so a missing worker never wedges the pipeline.
 *
 * Returns true if the offloaded encode produced the file; false if we
 * should fall back to local ffmpeg.
 */
async function tryEncodeOffload(
  jobData: EncodeOffloadJobData,
  parentJobId: string,
): Promise<boolean> {
  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) {
    console.warn("Encode offload enabled but REDIS_URL not set, skipping");
    return false;
  }
  const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
  const eventsConn = createRedisConnection({ url: redisUrl, mode: "queue" });
  const queue = new BullQueue<EncodeOffloadJobData>(ENCODE_OFFLOAD_QUEUE_NAME, {
    connection: conn,
  });
  const events = new QueueEvents(ENCODE_OFFLOAD_QUEUE_NAME, {
    connection: eventsConn,
  });
  try {
    await events.waitUntilReady();

    // Skip offload if no local worker is actually listening — avoids parking
    // the encode in a queue nobody reads. Lets the env flag stay ON
    // permanently and have the system auto-route based on what's available.
    const workers = await queue.getWorkers();
    if (workers.length === 0) {
      console.log(
        JSON.stringify({
          level: "info",
          message:
            "Encode offload enabled but no GPU worker connected, using local ffmpeg",
          parent_job_id: parentJobId,
        }),
      );
      return false;
    }

    const job = await queue.add("encode", jobData, {
      jobId: `encode-${parentJobId}-${Date.now()}`,
      attempts: 1,
      removeOnComplete: 50,
      removeOnFail: 50,
    });
    console.log(
      JSON.stringify({
        level: "info",
        message: "Encode offloaded to GPU worker",
        parent_job_id: parentJobId,
        encode_job_id: job.id,
        vps_output_path: jobData.vps_output_path,
        timeout_ms: encodeOffloadTimeoutMs(),
        active_workers: workers.length,
      }),
    );
    await job.waitUntilFinished(events, encodeOffloadTimeoutMs());
    console.log(
      JSON.stringify({
        level: "info",
        message: "Encode offload returned",
        parent_job_id: parentJobId,
        encode_job_id: job.id,
      }),
    );
    return true;
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "Encode offload failed, falling back to local ffmpeg",
        parent_job_id: parentJobId,
        error: String(err).slice(0, 300),
      }),
    );
    return false;
  } finally {
    await events.close().catch(() => {});
    await queue.close().catch(() => {});
    conn.disconnect();
    eventsConn.disconnect();
  }
}

export function createDramaAssembleProcessor(
  db: DrizzleClient,
  queues: { dramaQC: Queue<DramaQCPayload> },
) {
  return async (job: Job<DramaAssemblePayload>) => {
    const { jobId, audioPath, renderMode } = DramaAssemblePayloadSchema.parse(
      job.data,
    );

    try {
      const [jobRow] = await db
        .select({ metadata: contentJobs.metadata })
        .from(contentJobs)
        .where(eq(contentJobs.id, jobId))
        .limit(1);
      if (!jobRow) throw new Error(`Job ${jobId} not found`);

      const meta = jobRow.metadata as Record<string, unknown>;
      const wordTimings = meta["drama_word_timings"] as WordTiming[];

      const outputDir = join(MEDIA_BASE, jobId);
      const segmentsDir = join(outputDir, "segments");
      await mkdir(segmentsDir, { recursive: true });

      const rawClips = await getDramaClipsByJob(jobId);

      // Dedupe by clip_index — prompt-gen reruns can leave duplicate
      // rows pointing at the same video_path. Newest row wins.
      const byIndex = new Map<number, (typeof rawClips)[number]>();
      for (const c of [...rawClips].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      )) {
        byIndex.set(c.clip_index, c);
      }
      const clips = [...byIndex.values()].sort(
        (a, b) => a.clip_index - b.clip_index,
      );

      const segmentPaths: string[] = [];
      const validClipsList: typeof clips = [];

      if (
        renderMode === "SLOW_VIDEO" ||
        renderMode === "DIRECT_T2V" ||
        renderMode === "STOCK_CHAIN_FULL" ||
        renderMode === "STOCK_CHAIN_HOOKED"
      ) {
        // Both modes stitch pre-rendered clip videos: SLOW_VIDEO from
        // VEO i2v, DIRECT_T2V from VEO text-to-video. Validate each
        // MP4 with ffprobe — a corrupt clip (e.g. ffmpeg killed
        // mid-encode by maxBuffer overflow) would otherwise truncate
        // its xfade group and cascade silence/cuts downstream.
        const candidate = clips.filter(
          (c) => c.video_status === "done" && c.video_path,
        );
        for (const c of candidate) {
          if (await isPlayableMp4(c.video_path!)) {
            validClipsList.push(c);
          } else {
            console.warn(
              JSON.stringify({
                level: "warn",
                message: "Skipping unplayable clip MP4",
                job_id: jobId,
                clip_index: c.clip_index,
                video_path: c.video_path,
              }),
            );
          }
        }
        if (validClipsList.length === 0)
          throw new Error(`No valid video clips to assemble (${renderMode})`);

        for (const clip of validClipsList) {
          segmentPaths.push(clip.video_path!);
        }
      } else {
        // KEN_BURNS: generate animated stills
        const kbClips = clips.filter(
          (c) => c.image_path && c.image_status === "done",
        );
        if (kbClips.length === 0)
          throw new Error("No valid image clips to assemble");
        validClipsList.push(...kbClips);

        for (let i = 0; i < kbClips.length; i++) {
          const clip = kbClips[i]!;
          const durationMs = clip.end_ms - clip.start_ms;
          const durationSec = Math.max(durationMs / 1000, 1);
          const segPath = join(
            segmentsDir,
            `seg-${String(i).padStart(3, "0")}.mp4`,
          );
          const preset = selectMotionPreset(i, i === 0);

          console.log(
            JSON.stringify({
              level: "info",
              message: "Generating Ken Burns segment",
              clip_index: i,
              duration_sec: durationSec,
              preset,
            }),
          );

          await generateKenBurnsSegment(
            clip.image_path!,
            segPath,
            durationSec,
            preset,
          );
          segmentPaths.push(segPath);
        }
      }

      const validClips = validClipsList;

      // For VEO-rendered clips the actual file duration is the source of
      // truth — the planner asks for X seconds, but the renderer outputs
      // whatever VEO returned (≤ X). Using probed duration prevents the
      // xfade chain from trying to overlap past the clip's real end.
      const durations =
        renderMode === "SLOW_VIDEO" ||
        renderMode === "DIRECT_T2V" ||
        renderMode === "STOCK_CHAIN_FULL" ||
        renderMode === "STOCK_CHAIN_HOOKED"
          ? await Promise.all(
              segmentPaths.map(async (p) =>
                Math.max(await probeDurationSec(p), 1),
              ),
            )
          : validClips.map((c) => Math.max((c.end_ms - c.start_ms) / 1000, 1));

      // Split the clip list into groups so the xfade chain stays small.
      // For a 25-clip drama the old single-chain ffmpeg buffered 25 streams
      // simultaneously and the encode peaked at ~5 GB resident; scaling
      // beyond ~50 clips choked. Splitting into groups of 9 means at most
      // 9 streams are alive per ffmpeg call, the groups render in parallel,
      // and we just concat them at the end. Concat is stream-copy, no
      // re-encode, near-instant.
      const GROUP_SIZE = 9;
      const numGroups = Math.ceil(segmentPaths.length / GROUP_SIZE);

      const groupPaths = await Promise.all(
        Array.from({ length: numGroups }, async (_, g) => {
          const start = g * GROUP_SIZE;
          const end = Math.min(start + GROUP_SIZE, segmentPaths.length);
          const groupSegs = segmentPaths.slice(start, end);
          const groupDurs = durations.slice(start, end);
          const groupPath = join(segmentsDir, `group-${g}.mp4`);
          await renderGroup(groupSegs, groupDurs, groupPath);
          return groupPath;
        }),
      );

      // Generate subtitle ASS file
      const assPath = join(outputDir, "subtitles.ass");
      await generateAssFile(wordTimings, assPath);
      const escapedAssPath = escapeFilterPath(assPath);

      // ── Background music bed ──────────────────────────────────
      // Read the job's music config snapshot (saved at create time
      // into metadata.music). Mode is "generate" | "library".
      // When disabled, the bed step is skipped entirely.
      const audioDurSec = await probeDurationSec(audioPath);
      const musicMeta = (jobRow.metadata as Record<string, unknown> | null)?.[
        "music"
      ] as
        | {
            enabled?: boolean;
            mode?: "generate" | "library";
            volume_db?: number;
          }
        | undefined;
      const musicEnabled = musicMeta?.enabled === true;
      const musicMode: "generate" | "library" =
        musicMeta?.mode === "library" ? "library" : "generate";
      const musicVolumeDb =
        typeof musicMeta?.volume_db === "number" ? musicMeta.volume_db : -28;

      let bedPath: string | null = null;
      let usedMusicTracks: MusicTrack[] = [];
      if (musicEnabled) {
        const ai33Key = process.env["AI33_API_KEY"] ?? "";
        if (!ai33Key) {
          console.warn(
            JSON.stringify({
              level: "warn",
              event: "music_engine_no_key",
              job_id: jobId,
              message:
                "music_enabled=true but AI33_API_KEY missing; skipping music",
            }),
          );
        } else {
          try {
            const musicDir = join(outputDir, "music");
            const { tracks } = await assembleMusicBed(db, {
              jobId,
              format: "LONG_FORM_DRAMA",
              targetSec: audioDurSec,
              mode: musicMode,
              prompt: MUSIC_PROMPTS["LONG_FORM_DRAMA"]!,
              title: "Long Form Drama bed",
              ai33Key,
              ai33KeyBackup: process.env["AI33_API_KEY_BACKUP"] ?? undefined,
              outputDir: musicDir,
            });
            usedMusicTracks = tracks;
            // Stitch the bed: concat-demuxer copies each mp3 end-to-end
            // into a single bed.mp3. Re-encoding the bed isn't needed —
            // the final amix pass will resample to the video's rate.
            const listPath = join(outputDir, "music-list.txt");
            await writeFile(
              listPath,
              tracks.map((t) => `file '${t.file_path}'`).join("\n"),
            );
            const bedFile = join(outputDir, "bed.mp3");
            await execFileAsync(
              FFMPEG_BIN,
              [
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                listPath,
                "-c",
                "copy",
                bedFile,
              ],
              { maxBuffer: EXEC_MAX_BUFFER },
            );
            bedPath = bedFile;
          } catch (err) {
            console.warn(
              JSON.stringify({
                level: "warn",
                event: "music_engine_failed",
                job_id: jobId,
                error: err instanceof Error ? err.message : String(err),
                message: "music bed generation failed; muting bed",
              }),
            );
          }
        }
      }

      // Final filter_complex: concat groups (via concat FILTER, not the
      // demuxer — so the GPU offload's source_files + filter_complex
      // contract still applies cleanly), burn subtitles, loudnorm audio.
      // When a music bed is present, mix it in at the requested dB.
      const audioInputCount = bedPath ? 2 : 1;
      let filterComplex = "";
      for (let g = 0; g < numGroups; g++) {
        filterComplex += `[${g}:v]`;
      }
      filterComplex += `concat=n=${numGroups}:v=1:a=0[catv];`;
      filterComplex += `[catv]subtitles='${escapedAssPath}':force_style='FontName=Montserrat,WrapStyle=2',format=yuv420p[vout];`;
      if (bedPath) {
        // TTS path → loudnorm to broadcast target, slightly hotter so
        // the narration sits clearly on top of the bed.
        filterComplex += `[${numGroups}:a]loudnorm=I=-14:TP=-2:LRA=11[tts];`;
        // Music bed: drop to musicVolumeDb (negative dB lowers gain).
        // The aloop guards against any micro-shortfall between the bed
        // and the TTS — total music duration ≥ TTS by construction, but
        // ffprobe rounding can leave a fraction of a second uncovered.
        filterComplex += `[${numGroups + 1}:a]volume=${musicVolumeDb}dB,aloop=loop=-1:size=2147483647[music];`;
        filterComplex += `[tts][music]amix=inputs=2:duration=first:dropout_transition=3[aout]`;
      } else {
        filterComplex += `[${numGroups}:a]loudnorm=I=-14:TP=-2:LRA=11[aout]`;
      }

      const sourceFiles = [
        ...groupPaths,
        audioPath,
        ...(bedPath ? [bedPath] : []),
      ];
      const outputPath = join(outputDir, "output.mp4");
      void audioInputCount;
      void usedMusicTracks;

      // Output args: everything AFTER `-filter_complex <spec>` and before the
      // output path. Same shape whether we run locally or offload.
      const outputArgs = [
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-c:v",
        "libx264",
        "-crf",
        "22",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        "-t",
        audioDurSec.toFixed(3),
      ];

      let offloaded = false;
      if (isEncodeOffloadEnabled()) {
        offloaded = await tryEncodeOffload(
          {
            source_files: sourceFiles,
            filter_complex: filterComplex,
            output_args: outputArgs,
            vps_output_path: outputPath,
          },
          jobId,
        );
      }

      if (!offloaded) {
        const inputArgs: string[] = [];
        for (const f of sourceFiles) inputArgs.push("-i", f);
        await execFileAsync(
          FFMPEG_BIN,
          [
            ...inputArgs,
            "-filter_complex",
            filterComplex,
            ...outputArgs,
            "-y",
            outputPath,
          ],
          { maxBuffer: EXEC_MAX_BUFFER },
        );
      }

      console.log(
        JSON.stringify({
          level: "info",
          message: "Assembly complete",
          job_id: jobId,
          output_path: outputPath,
        }),
      );

      // ── Hook clip writeback ────────────────────────────────────
      // STOCK_CHAIN_HOOKED jobs render fresh hook clips via VEO t2v.
      // Those are good library candidates — copy them into the stock
      // library so future jobs can pull them as body content. Each
      // gets origin='hook_writeback' so we can tell them apart later.
      let writebackCount = 0;
      const writebackLibraryId =
        (jobRow.metadata as Record<string, unknown> | null)?.[
          "clip_library_id"
        ] ?? null;
      if (renderMode === "STOCK_CHAIN_HOOKED" && writebackLibraryId) {
        try {
          const allClips = await getDramaClipsByJob(jobId);
          // Hook clips are the ones rendered fresh — section_type='hook'
          // AND video_path set AND status=done. Anything else (failed
          // hook clips, library-backed body slots) is skipped.
          const hookClips = allClips.filter(
            (c) =>
              c.section_type === "hook" &&
              !!c.video_path &&
              c.video_status === "done",
          );
          const stockLibDir =
            process.env["STOCK_LIBRARY_DIR"] ??
            "/opt/content-forge/media/stock-library";
          await mkdir(stockLibDir, { recursive: true });
          for (const c of hookClips) {
            try {
              const newId = randomUUID();
              const dest = join(stockLibDir, `${newId}.mp4`);
              await copyFile(c.video_path!, dest);
              const s = await fsStat(dest);
              if (s.size < 50_000) {
                // Probably a corrupt clip; skip rather than poison the library.
                continue;
              }
              const dur = await probeDurationSec(dest);
              await insertReadyStockClip({
                video_path: dest,
                duration_sec: dur,
                prompt: c.image_prompt ?? "(hook clip — no prompt recorded)",
                vibe_tag: "hook_writeback",
                origin: "hook_writeback",
                veo_job_id: c.veo_job_id ?? null,
              });
              writebackCount++;
            } catch (err) {
              console.warn(
                JSON.stringify({
                  level: "warn",
                  event: "hook_writeback_clip_failed",
                  job_id: jobId,
                  drama_clip_id: c.id,
                  error: err instanceof Error ? err.message : String(err),
                }),
              );
            }
          }
          // The freshly inserted rows don't carry the library FK yet
          // because insertReadyStockClip predates the column. Tag them
          // in bulk so they show up under this channel's library.
          if (writebackCount > 0) {
            const { stockClips } = await import("@repo/db");
            const { and, eq, isNull } = await import("drizzle-orm");
            await db
              .update(stockClips)
              .set({ clip_library_id: writebackLibraryId as string })
              .where(
                and(
                  isNull(stockClips.clip_library_id),
                  eq(stockClips.origin, "hook_writeback"),
                ),
              );
          }
          console.log(
            JSON.stringify({
              level: "info",
              event: "hook_writeback_complete",
              job_id: jobId,
              count: writebackCount,
              library_id: writebackLibraryId,
            }),
          );
        } catch (err) {
          // Don't fail the whole job if writeback is messed up.
          console.warn(
            JSON.stringify({
              level: "warn",
              event: "hook_writeback_failed",
              job_id: jobId,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }

      await updateJobMetadata(db, jobId, {
        drama_output_path: outputPath,
        drama_music_bed: bedPath
          ? {
              path: bedPath,
              mode: musicMode,
              volume_db: musicVolumeDb,
              tracks: usedMusicTracks.map((t) => ({
                file_path: t.file_path,
                duration_seconds: t.duration_seconds,
                library_id: t.library_id ?? null,
              })),
            }
          : null,
        drama_hook_writeback: { count: writebackCount },
      });
      await updateJobStatus(db, jobId, "DRAMA_QC");
      await queues.dramaQC.add(
        "drama-qc",
        { jobId, outputPath, audioPath },
        { jobId: `drama-qc-${jobId}`, attempts: 1 },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateJobStatus(db, jobId, "FAILED_DRAMA_PIPELINE", msg).catch(
        () => {},
      );
      throw err;
    }
  };
}
