/**
 * Per-image aesthetic signals: pHash + palette + basic metadata.
 *
 * Mirrors the algorithms in audio-face-sidecar/routers/scenes.py (_dhash,
 * _palette_hex) but in TypeScript driving ffmpeg directly — images don't
 * need the TransNetV2 scene-detection apparatus, just a single decoded
 * frame.
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

// ── ffprobe → width/height/format/bytes ────────────────────────────────────
export interface ImageMetadata {
  width: number;
  height: number;
  format: string; // 'jpg' | 'png' | 'webp' | 'gif' | …
  bytes: number;
}

export async function probeImage(imagePath: string): Promise<ImageMetadata> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      "-select_streams",
      "v:0",
      "-show_format",
      imagePath,
    ],
    { timeout: 15_000 },
  );

  const parsed = JSON.parse(stdout) as {
    streams?: Array<{
      width?: number;
      height?: number;
      codec_name?: string;
    }>;
    format?: { size?: string };
  };
  const stream = parsed.streams?.[0];
  if (!stream) {
    throw new Error(`ffprobe found no image stream in ${imagePath}`);
  }
  return {
    width: stream.width ?? 0,
    height: stream.height ?? 0,
    format: codecToFormat(stream.codec_name ?? ""),
    bytes: parsed.format?.size ? parseInt(parsed.format.size, 10) : 0,
  };
}

function codecToFormat(codec: string): string {
  // ffmpeg reports image codecs as 'mjpeg','png','webp','gif',… — normalise.
  if (codec === "mjpeg") return "jpg";
  return codec || "unknown";
}

// ── pHash via raw grayscale buffer ─────────────────────────────────────────

/**
 * 64-bit dHash of a single image. Same algorithm as the sidecar's _dhash:
 * downscale to 9×8 grayscale, horizontal gradient signs per row, packed
 * into a 64-bit signed int (fits PostgreSQL BIGINT).
 *
 * Hamming distance ≤ 5 means visually identical (after compression /
 * re-encode), useful for cross-source dedup.
 */
export async function dhashImage(imagePath: string): Promise<bigint> {
  // ffmpeg: scale to 9x8, grayscale, raw bytes. 72 bytes total.
  const { stdout } = await execFileAsync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      imagePath,
      "-vf",
      "scale=9:8,format=gray",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "-frames:v",
      "1",
      "-",
    ],
    {
      timeout: 15_000,
      encoding: "buffer",
      maxBuffer: 4096,
    },
  );

  const buf = Buffer.from(stdout);
  if (buf.length < 72) {
    throw new Error(
      `dhashImage: expected ≥72 grayscale bytes, got ${buf.length}`,
    );
  }
  // 8 rows × 9 cols. Bit per cell = (cell[c+1] > cell[c]).
  let hashU = 0n;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = buf[row * 9 + col]!;
      const right = buf[row * 9 + col + 1]!;
      hashU = (hashU << 1n) | (right > left ? 1n : 0n);
    }
  }
  // Convert unsigned 64-bit → signed for BIGINT compatibility.
  return hashU >= 1n << 63n ? hashU - (1n << 64n) : hashU;
}

// ── Palette extraction (top-3 dominant colors) ─────────────────────────────

/**
 * Top-N dominant colors as #rrggbb. Uses ffmpeg's palettegen filter to
 * quantise the image to N colors, then reads the resulting PNG's PLTE
 * chunk. More accurate than histogram bucketing on natural images.
 */
export async function paletteImage(
  imagePath: string,
  n = 3,
): Promise<string[]> {
  const tmp = join(tmpdir(), `palette-${randomUUID()}.png`);
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-i",
        imagePath,
        "-vf",
        `palettegen=max_colors=${n}:reserve_transparent=0`,
        tmp,
      ],
      { timeout: 15_000 },
    );

    // ffmpeg palettegen output is a 16x16 PNG where each row/col is a
    // distinct color. Decode by reading raw RGB pixels via ffmpeg again.
    const { stdout } = await execFileAsync(
      "ffmpeg",
      ["-v", "error", "-i", tmp, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
      { timeout: 10_000, encoding: "buffer", maxBuffer: 1 << 20 },
    );

    const buf = Buffer.from(stdout);
    const out: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i + 2 < buf.length && out.length < n; i += 3) {
      const hex = `#${buf[i]!.toString(16).padStart(2, "0")}${buf[i + 1]!.toString(16).padStart(2, "0")}${buf[i + 2]!.toString(16).padStart(2, "0")}`;
      if (!seen.has(hex)) {
        seen.add(hex);
        out.push(hex);
      }
    }
    return out;
  } finally {
    unlink(tmp).catch(() => {});
  }
}

// ── Bulk-download helper (used by image-ingest) ────────────────────────────

/**
 * Download a URL to disk. Throws on non-2xx. Image files are bounded in
 * size (Pexels `large2x` is typically <5 MB) so a single in-memory buffer
 * is fine; if we ever ingest gigabyte source images we'd switch to a
 * streamed write.
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  timeoutMs = 60_000,
): Promise<{ bytes: number }> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Download failed ${response.status} for ${url}`);
  }
  const ab = await response.arrayBuffer();
  const buf = Buffer.from(ab);
  await mkdir(join(destPath, ".."), { recursive: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(destPath, buf);
  return { bytes: buf.byteLength };
}

// silence the unused import (spawn) — kept around for future streaming alternatives
void spawn;
