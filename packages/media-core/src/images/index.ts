/**
 * Still-image normalisation — ONE implementation, shared by hub-web (uploads)
 * and worker-orchestrator (generation output + CLI ingest).
 *
 * Two jobs, deliberately kept together because they are two ends of the same
 * contract:
 *
 *  1. `normaliseYouTubeThumbnail` — the OUTPUT contract. YouTube wants exactly
 *     1280x720. Image backends here emit 1376x768, whose aspect is 1.7917, not
 *     16:9 (1.7778). A naive `scale=1280:720` therefore squashes faces by ~0.8%
 *     horizontally — small, but it is a face, and it is the same face on every
 *     video. So: CENTER-CROP to true 16:9 first, THEN scale.
 *
 *  2. `normaliseCharacterReference` — the INPUT contract for i2i reference
 *     images. References do NOT need to be 1280x720; they need to be a clean,
 *     high-detail picture of the person that fits inside the transport budget.
 *
 * Implemented with the ffmpeg CLI rather than sharp because ffmpeg is already a
 * hard dependency of every box this runs on, and sharp is only installed in
 * hub-web — duplicating the spec in two encoders is how the two ends drift.
 *
 * NO SYNTHETIC FALLBACKS: every failure throws with the measured numbers. This
 * module resizes on purpose (that is its entire job) but it never invents,
 * upscales past the source, or silently returns the unmodified input.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export { defringePersonaRgba } from "./persona-defringe.js";
export type { PersonaDefringeOptions } from "./persona-defringe.js";

const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";
const FFPROBE_BIN = process.env["FFPROBE_PATH"] ?? "ffprobe";

/** YouTube's canonical thumbnail size. Not a minimum here — an exact target. */
export const YOUTUBE_THUMBNAIL_WIDTH = 1280;
export const YOUTUBE_THUMBNAIL_HEIGHT = 720;
/** YouTube's hard upload ceiling. */
export const YOUTUBE_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Reference-image spec.
 *
 * 1280px on the long edge keeps the face at ~500px tall for a half-body shot —
 * far more than any i2i model resolves identity from — while keeping the
 * payload small. The byte ceiling is 900 kB because the veo_fleet transport
 * base64s every reference and VUP rejects references above 1 MB; 900 kB of JPEG
 * becomes 1.2 MB of base64, so the *source* budget is what has to stay under
 * the wire limit. 700 kB is the number that survives base64 with headroom.
 */
export const CHARACTER_REFERENCE_LONG_EDGE = 1280;
export const CHARACTER_REFERENCE_MAX_BYTES = 700 * 1024;

export interface ImageSize {
  width: number;
  height: number;
}

export interface NormalisedImage extends ImageSize {
  path: string;
  byteSize: number;
  /** The ffmpeg -q:v value that met the byte budget (2 = best). */
  quality: number;
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) =>
      reject(new Error(`${bin} failed to start: ${e.message}`)),
    );
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else
        reject(new Error(`${bin} exited ${code}: ${err.trim().slice(-500)}`));
    });
  });
}

/** Pixel dimensions of an image file, straight from ffprobe. */
export async function probeImageSize(path: string): Promise<ImageSize> {
  const out = await run(FFPROBE_BIN, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0:s=x",
    path,
  ]);
  const m = out.trim().match(/^(\d+)x(\d+)$/m);
  if (!m) {
    throw new Error(
      `ffprobe could not measure ${path} — got ${JSON.stringify(out.trim())}. ` +
        `Refusing to guess dimensions.`,
    );
  }
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** Even, because JPEG chroma subsampling wants even dimensions. */
function even(n: number): number {
  return n % 2 === 0 ? n : n - 1;
}

/**
 * Encode `filter` output at the best JPEG quality that fits `maxBytes`.
 *
 * The ladder exists so the byte ceiling is met by REDUCING QUALITY, never by
 * reducing dimensions — a 1280x720 thumbnail that got quietly downscaled to fit
 * would violate the very contract this function is enforcing.
 */
async function encodeWithinBudget(
  inputPath: string,
  outputPath: string,
  filter: string,
  maxBytes: number,
): Promise<{ byteSize: number; quality: number }> {
  const ladder = [2, 3, 4, 6, 8, 11, 15];
  let last = 0;
  for (const q of ladder) {
    await run(FFMPEG_BIN, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-vf",
      filter,
      "-frames:v",
      "1",
      "-q:v",
      String(q),
      "-pix_fmt",
      "yuvj420p",
      outputPath,
    ]);
    const { size } = await stat(outputPath);
    last = size;
    if (size <= maxBytes) return { byteSize: size, quality: q };
  }
  throw new Error(
    `Could not encode ${outputPath} under ${maxBytes} bytes — smallest attempt ` +
      `was ${last} bytes at JPEG q=${ladder[ladder.length - 1]}. Refusing to ` +
      `downscale below the required dimensions to hit the byte budget.`,
  );
}

/**
 * Center-crop to exactly 16:9 and scale to exactly 1280x720.
 *
 * Never upscales silently: a source below 1280x720 throws, because upscaling a
 * generated thumbnail is the synthetic fix that makes a bad backend look fine.
 */
export async function normaliseYouTubeThumbnail(
  inputPath: string,
  outputPath: string,
  opts: { maxBytes?: number } = {},
): Promise<NormalisedImage> {
  const src = await probeImageSize(inputPath);
  if (
    src.width < YOUTUBE_THUMBNAIL_WIDTH ||
    src.height < YOUTUBE_THUMBNAIL_HEIGHT
  ) {
    throw new Error(
      `Source image is ${src.width}x${src.height}, below the ` +
        `${YOUTUBE_THUMBNAIL_WIDTH}x${YOUTUBE_THUMBNAIL_HEIGHT} target. ` +
        `Refusing to upscale — request a larger image from the backend.`,
    );
  }

  // Largest centred 16:9 region. Computed here rather than in an ffmpeg
  // expression so the numbers are visible in logs and in tests.
  const cropW = even(
    Math.min(
      src.width,
      Math.round(
        (src.height * YOUTUBE_THUMBNAIL_WIDTH) / YOUTUBE_THUMBNAIL_HEIGHT,
      ),
    ),
  );
  const cropH = even(
    Math.min(
      src.height,
      Math.round(
        (src.width * YOUTUBE_THUMBNAIL_HEIGHT) / YOUTUBE_THUMBNAIL_WIDTH,
      ),
    ),
  );
  const x = Math.floor((src.width - cropW) / 2);
  const y = Math.floor((src.height - cropH) / 2);
  const filter =
    `crop=${cropW}:${cropH}:${x}:${y},` +
    `scale=${YOUTUBE_THUMBNAIL_WIDTH}:${YOUTUBE_THUMBNAIL_HEIGHT}:flags=lanczos`;

  const { byteSize, quality } = await encodeWithinBudget(
    inputPath,
    outputPath,
    filter,
    opts.maxBytes ?? YOUTUBE_THUMBNAIL_MAX_BYTES,
  );

  // Trust nothing: re-measure the file we actually wrote.
  const got = await probeImageSize(outputPath);
  if (
    got.width !== YOUTUBE_THUMBNAIL_WIDTH ||
    got.height !== YOUTUBE_THUMBNAIL_HEIGHT
  ) {
    throw new Error(
      `Normalisation produced ${got.width}x${got.height}, expected ` +
        `${YOUTUBE_THUMBNAIL_WIDTH}x${YOUTUBE_THUMBNAIL_HEIGHT} ` +
        `(source ${src.width}x${src.height}, crop ${cropW}x${cropH}+${x}+${y}).`,
    );
  }
  return { path: outputPath, ...got, byteSize, quality };
}

/** Buffer-in / buffer-out wrapper for callers that never touch the disk. */
export async function normaliseYouTubeThumbnailBuffer(
  bytes: Buffer,
  sourceExtension: string,
): Promise<{ buffer: Buffer } & Omit<NormalisedImage, "path">> {
  const dir = await mkdtemp(join(tmpdir(), "cf-thumb-"));
  try {
    const inPath = join(dir, `in.${sourceExtension.replace(/^\./, "")}`);
    const outPath = join(dir, "out.jpg");
    await writeFile(inPath, bytes);
    const result = await normaliseYouTubeThumbnail(inPath, outPath);
    const buffer = await readFile(outPath);
    return {
      buffer,
      width: result.width,
      height: result.height,
      byteSize: result.byteSize,
      quality: result.quality,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Prepare an uploaded character photo for use as an i2i reference.
 *
 * Deliberately does NOT crop to the face: the host-preservation prompt asks the
 * model to keep "face, hair, skin tone and build", so the reference has to show
 * the build. Aspect ratio is preserved for the same reason — a stretched
 * reference teaches the model a stretched person.
 */
export async function normaliseCharacterReference(
  inputPath: string,
  outputPath: string,
  opts: { longEdge?: number; maxBytes?: number } = {},
): Promise<NormalisedImage> {
  const src = await probeImageSize(inputPath);
  const longEdge = opts.longEdge ?? CHARACTER_REFERENCE_LONG_EDGE;
  const scaleFactor = Math.min(1, longEdge / Math.max(src.width, src.height));
  const targetW = even(Math.round(src.width * scaleFactor));
  const targetH = even(Math.round(src.height * scaleFactor));
  const filter = `scale=${targetW}:${targetH}:flags=lanczos`;

  const { byteSize, quality } = await encodeWithinBudget(
    inputPath,
    outputPath,
    filter,
    opts.maxBytes ?? CHARACTER_REFERENCE_MAX_BYTES,
  );
  const got = await probeImageSize(outputPath);
  return { path: outputPath, ...got, byteSize, quality };
}

/**
 * Parse the pose/expression a generator encoded in a filename, e.g.
 *   "Man_pointing_with_smirk_202608032001.jpeg"  -> pose 'pointing', expr 'smirk'
 *   "Bald_bearded_man_surprised_face_...jpeg"    -> expr 'surprised'
 *
 * This metadata is the difference between "cycle through random photos" and
 * "pick the pointing shot because the format rule says gaze=at_subject". Losing
 * it at ingest means regenerating the character to get it back.
 */
const POSE_WORDS = [
  "pointing",
  "point",
  "arms_crossed",
  "crossed",
  "thumbs_up",
  "shrug",
  "leaning",
  "standing",
  "sitting",
  "wearing",
] as const;
const EXPRESSION_WORDS = [
  "smiling",
  "smile",
  "smirk",
  "sarcastic",
  "surprised",
  "shocked",
  "serious",
  "confused",
  "laughing",
  "neutral",
  "warmly",
  "thinking",
  "angry",
] as const;

export function parsePoseFromFilename(filename: string): {
  pose: string | null;
  expression: string | null;
} {
  const stem = filename
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/_?\d{8,}$/g, "")
    .toLowerCase();
  const pose = POSE_WORDS.find((w) => stem.includes(w)) ?? null;
  const expression = EXPRESSION_WORDS.find((w) => stem.includes(w)) ?? null;
  return {
    pose: pose ? normaliseWord(pose) : null,
    expression: expression ? normaliseWord(expression) : null,
  };
}

function normaliseWord(w: string): string {
  const canon: Record<string, string> = {
    point: "pointing",
    crossed: "arms_crossed",
    smile: "smiling",
    warmly: "smiling",
    shocked: "surprised",
  };
  return canon[w] ?? w;
}
