/**
 * Gemini Vision Labeling
 *
 * Calls the self-hosted Gemini pool's /v1/analyze endpoint with frames
 * extracted from a clip. Returns structured visual metadata or a rejection.
 *
 * Returns null if Gemini is unavailable or all frames fail.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContextLogger } from "@repo/logger";
import {
  buildClipAnalysisPrompt,
  type ClipAnalysisInput,
  type ClipAnalysisResult,
} from "./clip-library-gemini-prompt.js";

const execFileAsync = promisify(execFile);
const logger = createContextLogger("gemini-vision");

const GEMINI_POOL_URL =
  process.env["GEMINI_POOL_URL"] ?? "http://127.0.0.1:8090";
const GEMINI_POOL_API_KEY = process.env["GEMINI_POOL_API_KEY"] ?? "";

export type GeminiLabelResult =
  | { status: "labeled"; labels: GeminiClipLabels }
  | { status: "rejected"; reason: string; detail: string }
  | null;

export interface GeminiClipLabels {
  description: string;
  shot_scale: string;
  dominant_mood: string;
  motion_level: string;
  camera_movement: string;
  lighting_style: string;
  color_temperature: string;
  face_count: number;
  has_text_overlay: boolean;
  dialogue_present: boolean;
  clip_type: string;
  narrative_type: string;
  source_episode: string;
  scene_context: string;
  tags_characters: string[];
  tags_mood: string[];
  tags_location: string[];
  tags_action: string[];
  tags_custom: string[];
  keywords: string[];
  confidence: number;
}

// Shot scale values that map from the new prompt to the DB enum
const SHOT_SCALE_MAP: Record<string, string> = {
  extreme_close_up: "extreme_close",
  close_up: "close",
  medium_close_up: "medium",
  medium: "medium",
  medium_wide: "medium",
  wide: "wide",
  extreme_wide: "extreme_wide",
  // legacy values (kept for backwards compat)
  extreme_close: "extreme_close",
  close: "close",
  over_shoulder: "over_shoulder",
  pov: "pov",
  aerial: "aerial",
};

// Maps Gemini `media_type` field → DB clip_type enum (source material, not narrative function)
function mediaTypeToClipType(mediaType: string): string {
  switch (mediaType) {
    case "live_action":
      return "footage_movie";
    case "animation_3d":
    case "animation_2d":
    case "animation_cgi":
    case "stop_motion":
      return "footage_animation";
    case "mixed_media":
      return "footage_movie";
    case "ai_generated":
      return "ai_generated";
    case "text_on_screen":
      return "text_on_screen";
    default:
      return "footage_movie";
  }
}

// motion_level from new prompt → DB values
const MOTION_LEVEL_MAP: Record<string, string> = {
  static: "static",
  low: "slow",
  medium: "medium",
  high: "fast",
  very_high: "chaotic",
};

async function extractFrame(
  sourcePath: string,
  timeSec: number,
  outputPath: string,
): Promise<void> {
  await execFileAsync(
    "ffmpeg",
    [
      "-ss",
      timeSec.toFixed(3),
      "-i",
      sourcePath,
      "-frames:v",
      "1",
      "-q:v",
      "4",
      "-y",
      outputPath,
    ],
    { timeout: 30_000 },
  );
}

// Max video chunk uploaded to Gemini per clip. Gemini's File API accepts
// much more, but ~30 s is enough temporal context for any single labeled
// clip and keeps payload small. If the clip is shorter, we upload the whole
// thing.
const MAX_GEMINI_VIDEO_MS = 30_000;

/**
 * Trim the clip's video chunk into a temp MP4 for Gemini upload. Re-encodes
 * with libx264 ultrafast (not stream-copy) so the trimmed file starts on a
 * keyframe — stream-copy with non-keyframe-aligned `-ss` leaves visible
 * freeze frames at the head, which would mislead Gemini's first-second read.
 *
 * Tolerates source files at unusual fps / codec — anything ffmpeg can decode.
 */
async function extractClipChunk(
  sourcePath: string,
  startMs: number,
  endMs: number,
  outputPath: string,
): Promise<void> {
  const startSec = Math.max(0, startMs / 1000);
  const durationMs = Math.min(endMs - startMs, MAX_GEMINI_VIDEO_MS);
  const durationSec = durationMs / 1000;
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      startSec.toFixed(3),
      "-i",
      sourcePath,
      "-t",
      durationSec.toFixed(3),
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-an", // strip audio — Gemini analyzes video; transcript is a separate sidecar pass
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { timeout: 90_000 },
  );
}

/**
 * Upload a video chunk (mp4) to the pool's /v1/analyze endpoint.
 *
 * Returns:
 *   { ok: text }     — pool processed video and returned analysis text
 *   { unsupported }  — pool returned 415/422; caller should fall back to frames
 *   null             — transport failure or non-recoverable pool error
 */
async function callGeminiAnalyzeVideo(
  videoPath: string,
  prompt: string,
): Promise<{ ok: string } | { unsupported: true } | null> {
  try {
    const formData = new FormData();
    formData.append("prompt", prompt);
    const { readFile } = await import("node:fs/promises");
    const videoBytes = await readFile(videoPath);
    const blob = new Blob([videoBytes], { type: "video/mp4" });
    formData.append("file", blob, "clip.mp4");

    const response = await fetch(`${GEMINI_POOL_URL}/v1/analyze`, {
      method: "POST",
      headers: { "x-api-key": GEMINI_POOL_API_KEY },
      body: formData,
      // Larger window — video file goes through Gemini File API which is slower.
      signal: AbortSignal.timeout(180_000),
    });

    if (response.status === 415 || response.status === 422) {
      return { unsupported: true };
    }
    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "Gemini video analysis call failed",
      );
      return null;
    }

    const data = (await response.json()) as { text: string };
    return { ok: data.text };
  } catch (err) {
    logger.warn({ error: String(err) }, "Gemini video analysis call threw");
    return null;
  }
}

async function callGeminiAnalyze(
  framePath: string,
  prompt: string,
): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append("prompt", prompt);

    // Read frame as blob
    const { readFile } = await import("node:fs/promises");
    const frameBytes = await readFile(framePath);
    const blob = new Blob([frameBytes], { type: "image/jpeg" });
    formData.append("file", blob, "frame.jpg");

    const response = await fetch(`${GEMINI_POOL_URL}/v1/analyze`, {
      method: "POST",
      headers: { "x-api-key": GEMINI_POOL_API_KEY },
      body: formData,
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, "Gemini vision call failed");
      return null;
    }

    const data = (await response.json()) as { text: string; account?: string };
    return data.text;
  } catch (err) {
    logger.warn({ error: String(err) }, "Gemini vision call threw");
    return null;
  }
}

type ParseResult =
  | { kind: "labeled"; labels: GeminiClipLabels }
  | { kind: "rejected"; reason: string; detail: string }
  | null;

function parseGeminiResponse(raw: string): ParseResult {
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  for (const candidate of [stripped, raw]) {
    const objMatch = candidate.match(/\{[\s\S]*\}/);
    if (!objMatch) continue;
    try {
      const parsed = JSON.parse(objMatch[0]) as ClipAnalysisResult &
        Record<string, unknown>;

      if (parsed["accepted"] === false) {
        return {
          kind: "rejected",
          reason: String(parsed["rejection_reason"] ?? "other"),
          detail: String(parsed["rejection_detail"] ?? ""),
        };
      }

      // Map new prompt field names to GeminiClipLabels
      const rawShotScale = String(parsed["shot_scale"] ?? "medium");
      const mappedShotScale = SHOT_SCALE_MAP[rawShotScale] ?? "medium";

      const rawMotionLevel = String(parsed["motion_level"] ?? "medium");
      const mappedMotionLevel = MOTION_LEVEL_MAP[rawMotionLevel] ?? "medium";

      // `clip_type` from Gemini = narrative function (action/dialogue/establishing/…) → narrative_type
      // `media_type` from Gemini = source material type (live_action/animation_*) → DB clip_type
      const narrativeClipType = String(parsed["clip_type"] ?? "");
      const rawMediaType = String(parsed["media_type"] ?? "live_action");
      const dbClipType = mediaTypeToClipType(rawMediaType);

      // camera_movement: new prompt has "tracking" which maps to "dolly"
      const rawCameraMovement = String(parsed["camera_movement"] ?? "static");
      const mappedCameraMovement =
        rawCameraMovement === "tracking" ? "dolly" : rawCameraMovement;

      // lighting: new prompt uses "natural"/"dark"/"neon", DB uses "bright"/"dark"/"moody" etc.
      const lightingMap: Record<string, string> = {
        natural: "bright",
        studio: "high_key",
        high_key: "high_key",
        low_key: "low_key",
        dark: "dark",
        neon: "moody",
        mixed: "moody",
      };
      const mappedLighting =
        lightingMap[String(parsed["lighting_style"] ?? "natural")] ?? "bright";

      // color_temperature: new prompt has "desaturated"/"mixed", DB has "high_contrast"
      const colorTempMap: Record<string, string> = {
        warm: "warm",
        neutral: "neutral",
        cool: "cool",
        desaturated: "desaturated",
        mixed: "neutral",
      };
      const mappedColorTemp =
        colorTempMap[String(parsed["color_temperature"] ?? "neutral")] ??
        "neutral";

      // Merge tags_objects and tags_themes into tags_custom
      const tagsObjects = Array.isArray(parsed["tags_objects"])
        ? (parsed["tags_objects"] as string[]).map(String)
        : [];
      const tagsThemes = Array.isArray(parsed["tags_themes"])
        ? (parsed["tags_themes"] as string[]).map(String)
        : [];

      return {
        kind: "labeled",
        labels: {
          description: String(
            parsed["ai_description"] ?? parsed["description"] ?? "",
          ),
          shot_scale: mappedShotScale,
          dominant_mood: String(parsed["dominant_mood"] ?? ""),
          motion_level: mappedMotionLevel,
          camera_movement: mappedCameraMovement,
          lighting_style: mappedLighting,
          color_temperature: mappedColorTemp,
          face_count:
            typeof parsed["face_count"] === "number" ? parsed["face_count"] : 0,
          has_text_overlay:
            Boolean(parsed["has_burned_subtitles"]) ||
            Boolean(parsed["has_text_overlay"]),
          dialogue_present:
            Boolean(parsed["has_dialogue"]) ||
            Boolean(parsed["dialogue_present"]),
          clip_type: dbClipType,
          narrative_type: narrativeClipType || "unknown",
          source_episode: String(parsed["source_episode"] ?? ""),
          scene_context: String(parsed["scene_context"] ?? ""),
          tags_characters: Array.isArray(parsed["tags_characters"])
            ? (parsed["tags_characters"] as string[]).map(String)
            : [],
          tags_mood: Array.isArray(parsed["tags_mood"])
            ? (parsed["tags_mood"] as string[]).map(String)
            : [],
          tags_location: Array.isArray(parsed["tags_location"])
            ? (parsed["tags_location"] as string[]).map(String)
            : [],
          tags_action: Array.isArray(parsed["tags_action"])
            ? (parsed["tags_action"] as string[]).map(String)
            : [],
          tags_custom: [
            ...(Array.isArray(parsed["tags_custom"])
              ? (parsed["tags_custom"] as string[]).map(String)
              : []),
            ...tagsObjects,
            ...tagsThemes,
          ],
          keywords: Array.isArray(parsed["keywords"])
            ? (parsed["keywords"] as string[]).map(String)
            : [],
          confidence:
            typeof parsed["confidence"] === "number"
              ? parsed["confidence"]
              : 0.5,
        },
      };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Check if the Gemini pool is available for vision calls.
 */
export async function isGeminiVisionAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${GEMINI_POOL_URL}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { sessions_ready?: number };
    return (data.sessions_ready ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Label a still image using Gemini vision. Mirrors labelClipWithGemini
 * but skips the frame extraction loop entirely — the image IS the frame.
 * Useful for the parallel image-library ingest path (Pexels / uploads /
 * scraped photos) where there's no temporal extent to sample from.
 */
export async function labelImageWithGemini(params: {
  image_id: string;
  image_path: string;
  tag_vocabulary: Record<string, string[]>;
  source_metadata?: Partial<ClipAnalysisInput>;
}): Promise<GeminiLabelResult> {
  const { image_id, image_path, tag_vocabulary, source_metadata } = params;
  void tag_vocabulary; // currently consumed by the prompt; kept for parity

  const analysisInput: ClipAnalysisInput = {
    source_title: source_metadata?.source_title ?? "Unknown",
    source_franchise: source_metadata?.source_franchise,
    source_type: source_metadata?.source_type ?? "image",
    source_year: source_metadata?.source_year,
    source_episode: source_metadata?.source_episode,
    clip_duration_seconds: 0, // explicit signal "this is a still"
    library_context: source_metadata?.library_context,
    prev_clip_context: source_metadata?.prev_clip_context,
  };

  const prompt = buildClipAnalysisPrompt(analysisInput);
  const rawText = await callGeminiAnalyze(image_path, prompt);
  if (!rawText) {
    logger.warn({ image_id }, "Gemini image analysis returned null");
    return null;
  }
  const parsed = parseGeminiResponse(rawText);
  if (!parsed) return null;
  if (parsed.kind === "rejected") {
    return {
      status: "rejected",
      reason: parsed.reason,
      detail: parsed.detail,
    };
  }
  return { status: "labeled", labels: parsed.labels };
}

/**
 * Label a clip using Gemini vision via the self-hosted pool.
 *
 * Extracts up to 3 frames at evenly-spaced positions within the clip,
 * analyzes each with Gemini, and returns merged labels or a rejection.
 *
 * Returns null if Gemini is unavailable or all frames error.
 * Returns { status: "rejected" } if the clip is a credits/watermark/junk frame.
 */
export async function labelClipWithGemini(params: {
  clip_id: string;
  source_video_path: string;
  start_ms: number;
  end_ms: number;
  tag_vocabulary: Record<string, string[]>;
  source_metadata?: Partial<ClipAnalysisInput>;
}): Promise<GeminiLabelResult> {
  const {
    clip_id,
    source_video_path,
    start_ms,
    end_ms,
    tag_vocabulary,
    source_metadata,
  } = params;
  const durationMs = end_ms - start_ms;

  const analysisInput: ClipAnalysisInput = {
    source_title: source_metadata?.source_title ?? "Unknown",
    source_franchise: source_metadata?.source_franchise,
    source_type: source_metadata?.source_type ?? "film",
    source_year: source_metadata?.source_year,
    source_episode: source_metadata?.source_episode,
    clip_duration_seconds: durationMs / 1000,
    library_context: source_metadata?.library_context,
  };

  const prompt = buildClipAnalysisPrompt(analysisInput);

  const results: Array<ParseResult> = [];
  let videoUploadSucceeded = false;

  // ── Path 1 (preferred): upload the actual video chunk ──────────────────
  // Up to 30 s of the clip, re-encoded with libx264 ultrafast so Gemini
  // gets keyframe-aligned start. The pool must accept video/mp4 at
  // /v1/analyze — until that's wired, the call returns { unsupported: true }
  // and we fall through to the frame-based path.
  const tmpVideoPath = join(tmpdir(), `gemini-clip-${clip_id}.mp4`);
  try {
    await extractClipChunk(source_video_path, start_ms, end_ms, tmpVideoPath);
    const videoCall = await callGeminiAnalyzeVideo(tmpVideoPath, prompt);
    if (videoCall && "ok" in videoCall) {
      const parsed = parseGeminiResponse(videoCall.ok);
      if (parsed) {
        results.push(parsed);
        videoUploadSucceeded = true;
        logger.info(
          {
            clip_id,
            duration_ms: Math.min(durationMs, MAX_GEMINI_VIDEO_MS),
          },
          "Gemini video-upload path succeeded",
        );
      }
    } else if (videoCall && "unsupported" in videoCall) {
      logger.info(
        { clip_id },
        "Gemini pool returned unsupported for video — falling back to frames",
      );
    }
  } catch (err) {
    logger.warn(
      { clip_id, error: String(err) },
      "Video chunk extraction or upload failed — falling back to frames",
    );
  } finally {
    unlink(tmpVideoPath).catch(() => {});
  }

  // ── Path 2 (fallback): extract frames at 25%, 50%, 75% ─────────────────
  // Only runs when the video-upload path didn't produce a parseable result.
  if (!videoUploadSucceeded) {
    const frameOffsets = durationMs > 2000 ? [0.25, 0.5, 0.75] : [0.5];

    const tmpFrameDir = join(tmpdir(), `gemini-frames-${clip_id}`);
    await mkdir(tmpFrameDir, { recursive: true });

    for (let fi = 0; fi < frameOffsets.length; fi++) {
      const offset = frameOffsets[fi]!;
      const timeSec = (start_ms + durationMs * offset) / 1000;
      const framePath = join(tmpFrameDir, `frame_${fi}.jpg`);

      try {
        await extractFrame(source_video_path, timeSec, framePath);
        const rawText = await callGeminiAnalyze(framePath, prompt);
        if (rawText) {
          const parsed = parseGeminiResponse(rawText);
          if (parsed) results.push(parsed);
        }
      } catch (err) {
        logger.warn(
          { clip_id, frame: fi, error: String(err) },
          "Frame analysis failed",
        );
      } finally {
        unlink(framePath).catch(() => {});
      }
    }

    try {
      const { rmdir } = await import("node:fs/promises");
      await rmdir(tmpFrameDir);
    } catch {}
  }

  if (results.length === 0) return null;

  // If majority of frames (≥2/3 or all when only 1) say rejected, reject the clip
  const rejections = results.filter((r) => r?.kind === "rejected");
  const labeled = results.filter(
    (r): r is Extract<ParseResult, { kind: "labeled" }> =>
      r?.kind === "labeled",
  );

  if (rejections.length > labeled.length) {
    const topRejection = rejections[0] as Extract<
      ParseResult,
      { kind: "rejected" }
    >;
    logger.info(
      { clip_id, reason: topRejection.reason },
      "Gemini rejected clip",
    );
    return {
      status: "rejected",
      reason: topRejection.reason,
      detail: topRejection.detail,
    };
  }

  if (labeled.length === 0) return null;

  // Merge: use highest-confidence result as base, union array fields
  const best = labeled.reduce((a, b) =>
    a.labels.confidence >= b.labels.confidence ? a : b,
  );

  return {
    status: "labeled",
    labels: {
      ...best.labels,
      tags_characters: [
        ...new Set(labeled.flatMap((r) => r.labels.tags_characters)),
      ],
      tags_mood: [...new Set(labeled.flatMap((r) => r.labels.tags_mood))],
      tags_location: [
        ...new Set(labeled.flatMap((r) => r.labels.tags_location)),
      ],
      tags_action: [...new Set(labeled.flatMap((r) => r.labels.tags_action))],
      tags_custom: [...new Set(labeled.flatMap((r) => r.labels.tags_custom))],
      keywords: [...new Set(labeled.flatMap((r) => r.labels.keywords))],
      // narrative_type: use best frame's value (no union needed — it's a scalar)
      narrative_type: best.labels.narrative_type,
    },
  };
}
