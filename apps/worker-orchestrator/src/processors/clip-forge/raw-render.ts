import type { Job, Queue } from "bullmq";
import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { artifactPresent } from "./artifact-fs.js";
import {
  ClipForgeRawRenderPayloadSchema,
  type ClipForgeRawRenderPayload,
} from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { and, cfRawClips, cfSources, eq, ne } from "@repo/db";
import { getConfig } from "@repo/config";
import {
  autoGenerateVariants,
  autoGenerateVariantsV2,
} from "./variant-templates.js";

/**
 * Bump this when the renderer's output shape changes (aspect, codec, layout).
 * The idempotency guard refuses to short-circuit a clip whose stored output
 * was rendered under a different version, so legacy artifacts get rebuilt on
 * the next job pickup instead of sticking forever.
 *   v1: 16:9 → 9:16 reframe with Gaussian blur bars (pre-2026-06-21)
 *   v2: source-native trim, no reframe (current)
 */
const RAW_RENDER_VERSION = 2;
const MIN_OUTPUT_BYTES = 1024; // 1 KB — anything smaller can only be corrupt.

/**
 * Clip Forge — Raw Render (frame-accurate trim, source-native aspect).
 *
 * Cuts the source on second-precise word boundaries and writes the segment in
 * the source's native resolution + aspect. No reframe, no blur bars, no
 * captions, no detection markers — just the raw segment. The 16:9 → 9:16
 * reframe, hitbox-aware layout selection, subtitle/caption burn-in all live
 * downstream in finishing-render. One raw clip → many finishing variants.
 *
 * Output: `${LOCAL_MEDIA_ROOT}/cf/{persona_id}/{source_id}/clips/{raw_clip_id}.mp4`.
 */
export function createCfRawRenderProcessor(
  db: DrizzleClient,
  queues: { cfFinishingRender: Queue },
) {
  return async (job: Job<ClipForgeRawRenderPayload>) => {
    const { raw_clip_id } = ClipForgeRawRenderPayloadSchema.parse(job.data);

    const [clip] = await db
      .select()
      .from(cfRawClips)
      .where(eq(cfRawClips.id, raw_clip_id))
      .limit(1);
    if (!clip) throw new Error(`cf_raw_clips row not found: ${raw_clip_id}`);
    if (clip.cancel_requested) {
      await db
        .update(cfRawClips)
        .set({ status: "cancelled" })
        .where(eq(cfRawClips.id, raw_clip_id));
      return;
    }
    // Idempotent only if (a) the stored output was rendered under the current
    // version — legacy v1 16:9-blur outputs must be rebuilt under v2 — AND
    // (b) the file is STILL ON DISK. Trusting the row alone is what left the
    // whole clip pool permanently un-rebuildable after the media wipe: 61
    // clips sat at `ready` with keys pointing at deleted files, and this guard
    // returned early every single time. The filesystem is the authority.
    const storedVersion = readRenderVersion(clip.reframe_recipe);
    if (
      clip.status === "ready" &&
      clip.raw_mp4_key &&
      storedVersion === RAW_RENDER_VERSION &&
      (await artifactPresent(clip.raw_mp4_key))
    ) {
      return;
    }

    const [source] = await db
      .select()
      .from(cfSources)
      .where(eq(cfSources.id, clip.source_id))
      .limit(1);
    if (!source) throw new Error(`source row not found: ${clip.source_id}`);

    // Conditional transition: only claim the job if nobody else has already
    // flipped this row to `rendering` between our SELECT and now. Without
    // this, two overlapping workers can both spawn ffmpeg into the same
    // outPath and race on `-y` overwrites, producing a corrupt MP4.
    const claimed = await db
      .update(cfRawClips)
      .set({ status: "rendering" })
      .where(
        and(eq(cfRawClips.id, raw_clip_id), ne(cfRawClips.status, "rendering")),
      )
      .returning({ id: cfRawClips.id });
    if (claimed.length === 0) {
      console.log(
        JSON.stringify({
          level: "info",
          msg: "[cf-raw-render] another worker already rendering, skipping",
          raw_clip_id,
        }),
      );
      return;
    }

    const cfg = getConfig();
    const sourcePath = join(
      cfg.LOCAL_MEDIA_ROOT,
      "cf",
      source.persona_id,
      source.id,
      "source.mp4",
    );
    const relKey = join(
      "cf",
      source.persona_id,
      source.id,
      "clips",
      `${raw_clip_id}.mp4`,
    );
    const outPath = join(cfg.LOCAL_MEDIA_ROOT, relKey);
    await mkdir(dirname(outPath), { recursive: true });

    try {
      await ffmpegTrimNative({
        input: sourcePath,
        start: clip.start_sec,
        end: clip.end_sec,
        output: outPath,
      });
      // ffmpeg can exit 0 having written a truncated/empty file on flaky
      // disk or container OOM — verify before declaring the clip ready, or
      // the idempotency guard above will pin a corrupt artifact forever.
      const { size } = await stat(outPath);
      if (size < MIN_OUTPUT_BYTES) {
        throw new Error(
          `ffmpeg produced suspect output (${size} bytes < ${MIN_OUTPUT_BYTES}); refusing to mark ready`,
        );
      }

      const recipe = withRenderVersion(clip.reframe_recipe, RAW_RENDER_VERSION);
      await db
        .update(cfRawClips)
        .set({ status: "ready", raw_mp4_key: relKey, reframe_recipe: recipe })
        .where(eq(cfRawClips.id, raw_clip_id));

      console.log(
        JSON.stringify({
          level: "info",
          msg: "[cf-raw-render] complete",
          raw_clip_id,
          duration_sec: clip.end_sec - clip.start_sec,
          size_mb: (size / 1024 / 1024).toFixed(1),
          key: relKey,
        }),
      );

      // Procedurally generate finishing variants for this clip based on the
      // source's detection. Prefer the V2 hitbox/layout decider; fall back
      // to the legacy V1 templates when the source has no V2 detection yet
      // (older sources, or detect-v2 hasn't run for some reason). Failure-
      // tolerant: a variant-gen miss never fails the raw-render job — the
      // raw clip stays 'ready' and the user can manually create variants
      // from the inspector.
      try {
        let result = await autoGenerateVariantsV2(
          db,
          raw_clip_id,
          queues.cfFinishingRender,
        );
        if (result.skipped && result.reason?.startsWith("no V2 detection")) {
          result = await autoGenerateVariants(
            db,
            raw_clip_id,
            queues.cfFinishingRender,
          );
        }
        console.log(
          JSON.stringify({
            level: "info",
            msg: "[cf-raw-render] auto-variants",
            raw_clip_id,
            generated: result.generated,
            skipped: result.skipped,
            reason: result.reason,
          }),
        );
      } catch (e) {
        console.warn(
          JSON.stringify({
            level: "warn",
            msg: "[cf-raw-render] auto-variant generation failed (continuing — clip is ready)",
            raw_clip_id,
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db
        .update(cfRawClips)
        .set({ status: "rejected" })
        .where(eq(cfRawClips.id, raw_clip_id))
        .catch(() => {});
      console.error(
        JSON.stringify({
          level: "error",
          msg: "[cf-raw-render] failed",
          raw_clip_id,
          error: msg,
        }),
      );
      throw err;
    }
  };
}

interface TrimArgs {
  input: string;
  start: number;
  end: number;
  output: string;
}

/**
 * Source-native trim. No reframe, no blur, no scaling.
 *
 * Re-encodes (vs `-c copy`) because `-ss` before `-i` with stream-copy aligns
 * to the nearest preceding keyframe — which can be several seconds off on
 * VOD encodes and would drift our word-anchored boundaries. CRF 20 + faststart
 * keeps the output small and seekable for browser preview.
 */
function readRenderVersion(recipe: unknown): number | null {
  if (!recipe || typeof recipe !== "object") return null;
  const v = (recipe as Record<string, unknown>)["render_version"];
  return typeof v === "number" ? v : null;
}

function withRenderVersion(
  recipe: unknown,
  version: number,
): Record<string, unknown> {
  const base =
    recipe && typeof recipe === "object"
      ? (recipe as Record<string, unknown>)
      : {};
  return { ...base, render_version: version };
}

function ffmpegTrimNative(args: TrimArgs): Promise<void> {
  const bin = process.env["FFMPEG_PATH"] ?? "ffmpeg";
  const duration = args.end - args.start;
  const ff = spawn(bin, [
    "-y",
    "-ss",
    args.start.toFixed(3),
    "-t",
    duration.toFixed(3),
    "-i",
    args.input,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    args.output,
  ]);

  return new Promise((resolve, reject) => {
    let stderr = "";
    ff.stderr.on("data", (d) => (stderr += d.toString()));
    ff.on("error", (e) => reject(new Error(`ffmpeg not found: ${e.message}`)));
    ff.on("close", (code) => {
      if (code !== 0)
        reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`));
      else resolve();
    });
  });
}
