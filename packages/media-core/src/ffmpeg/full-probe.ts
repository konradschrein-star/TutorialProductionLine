import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────────────────

export interface VideoStreamInfo {
  codec: string;
  width: number;
  height: number;
  fps: number;
  aspectRatio: string;
  pixelFormat: string;
}

export interface AudioStreamInfo {
  codec: string;
  sampleRate: number;
  channels: number;
}

export interface MediaProbeResult {
  durationSeconds: number;
  sizeBytes: number;
  formatName: string;
  video?: VideoStreamInfo;
  audio?: AudioStreamInfo;
}

// ── Internal helpers ───────────────────────────────────────────────

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

const COMMON_RATIOS: Array<{ name: string; decimal: number }> = [
  { name: "16:9", decimal: 16 / 9 },
  { name: "9:16", decimal: 9 / 16 },
  { name: "4:3", decimal: 4 / 3 },
  { name: "3:4", decimal: 3 / 4 },
  { name: "1:1", decimal: 1 },
];

const RATIO_TOLERANCE = 0.02;

function computeAspectRatio(width: number, height: number): string {
  const decimal = width / height;

  for (const ratio of COMMON_RATIOS) {
    if (Math.abs(decimal - ratio.decimal) <= RATIO_TOLERANCE) {
      return ratio.name;
    }
  }

  // Fall back to GCD simplification
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function parseFps(rFrameRate: unknown): number {
  if (typeof rFrameRate !== "string") return 30;

  const parts = rFrameRate.split("/");
  if (parts.length !== 2) return 30;

  const num = Number(parts[0]);
  const den = Number(parts[1]);

  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 30;

  return num / den;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Pure function: parse raw ffprobe JSON output into a structured MediaProbeResult.
 *
 * This is separated from the IO layer so it can be tested without
 * requiring an actual ffprobe binary.
 */
export function parseProbeOutput(
  raw: Record<string, unknown>,
): MediaProbeResult {
  const format = raw["format"] as Record<string, unknown> | undefined;

  const durationSeconds = parseFloat(String(format?.["duration"] ?? "0"));
  const sizeBytes = parseInt(String(format?.["size"] ?? "0"), 10);
  const formatName = String(format?.["format_name"] ?? "unknown");

  const streams = (raw["streams"] ?? []) as Array<Record<string, unknown>>;

  // Find first video stream
  const videoStream = streams.find((s) => s["codec_type"] === "video");
  let video: VideoStreamInfo | undefined;
  if (videoStream) {
    const width = Number(videoStream["width"]) || 0;
    const height = Number(videoStream["height"]) || 0;
    video = {
      codec: String(videoStream["codec_name"] ?? "unknown"),
      width,
      height,
      fps: parseFps(videoStream["r_frame_rate"]),
      aspectRatio:
        width > 0 && height > 0 ? computeAspectRatio(width, height) : "0:0",
      pixelFormat: String(videoStream["pix_fmt"] ?? "unknown"),
    };
  }

  // Find first audio stream
  const audioStream = streams.find((s) => s["codec_type"] === "audio");
  let audio: AudioStreamInfo | undefined;
  if (audioStream) {
    audio = {
      codec: String(audioStream["codec_name"] ?? "unknown"),
      sampleRate: parseInt(String(audioStream["sample_rate"] ?? "0"), 10),
      channels: Number(audioStream["channels"]) || 0,
    };
  }

  return { durationSeconds, sizeBytes, formatName, video, audio };
}

/**
 * Run ffprobe on a file and return structured metadata.
 *
 * Uses FFPROBE_PATH env var with fallback to "ffprobe" on PATH.
 */
export async function probeMedia(filePath: string): Promise<MediaProbeResult> {
  const ffprobeBin = process.env["FFPROBE_PATH"] ?? "ffprobe";

  const { stdout } = await execFileAsync(ffprobeBin, [
    "-v",
    "quiet",
    "-show_format",
    "-show_streams",
    "-print_format",
    "json",
    filePath,
  ]);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new Error(`ffprobe JSON parse failed for: ${filePath}`);
  }

  return parseProbeOutput(parsed);
}
