/**
 * YouTube thumbnail output contract.
 *
 * Two bugs this closes:
 *
 *  1. The output was ALWAYS written as `.jpg` regardless of what the provider
 *     actually returned. veo_fleet/VUP hand back PNG for some archetypes, so
 *     the on-disk extension lied about the bytes and anything keying off the
 *     extension (uploader MIME sniffing, the Studio preview) read a PNG as a
 *     JPEG.
 *
 *  2. Nothing ever checked the image was actually usable as a YouTube
 *     thumbnail. `thumbnails.resolution` is recorded but never transmitted —
 *     `ImageRequestOptions` has no `resolution` field — so the requested "1k"
 *     is advisory at best and the provider is free to return anything.
 *
 * Per the codebase's NO SYNTHETIC FALLBACKS rule this module never resizes,
 * re-encodes or "fixes" an out-of-spec image: it throws with the measured
 * numbers so the failure is legible on the thumbnail row.
 */

/** YouTube's documented minimum thumbnail resolution. */
export const MIN_WIDTH = 1280;
export const MIN_HEIGHT = 720;
/**
 * The EXACT size every stored thumbnail must end up at.
 *
 * Identical to the minimum by coincidence, not by definition: the minimum is
 * what a provider must at least hand us, the target is what we must at least
 * store. The backends emit 1376x768 (aspect 1.7917 — not 16:9), so the gap
 * between the two is closed by `normaliseYouTubeThumbnail`, which center-crops
 * to true 16:9 BEFORE scaling. Scaling 1376x768 straight to 1280x720 would
 * squash the host's face ~0.8% horizontally on every single video.
 */
export const TARGET_WIDTH = 1280;
export const TARGET_HEIGHT = 720;
/** YouTube's hard upload ceiling for a thumbnail image. */
export const MAX_BYTES = 2 * 1024 * 1024;

export type ThumbnailImageFormat = "jpg" | "png" | "webp";

export interface SniffedImage {
  format: ThumbnailImageFormat;
  /** Filename extension to write — always matches the real bytes. */
  extension: ThumbnailImageFormat;
  width: number;
  height: number;
  byteLength: number;
}

/**
 * Read format + pixel dimensions straight out of the file header.
 *
 * Deliberately dependency-free: worker-orchestrator does not carry sharp (only
 * hub-web does), and pulling a native image dep into the worker to read two
 * integers out of a header is not worth the build surface.
 *
 * Throws when the bytes are not a format we can measure — an unmeasurable
 * image cannot be contract-checked, and silently accepting it would defeat the
 * whole point of this module.
 */
export function sniffImage(buf: Buffer): SniffedImage {
  const byteLength = buf.byteLength;

  // ── PNG: 8-byte signature, then IHDR with width/height as BE uint32 ──────
  if (
    byteLength >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return {
      format: "png",
      extension: "png",
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
      byteLength,
    };
  }

  // ── WebP: "RIFF" .... "WEBP" <fourcc> ───────────────────────────────────
  if (
    byteLength >= 30 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    const fourcc = buf.toString("ascii", 12, 16);
    if (fourcc === "VP8 ") {
      // Lossy: 3-byte frame tag, 3-byte sync code, then 14-bit w/h.
      return {
        format: "webp",
        extension: "webp",
        width: buf.readUInt16LE(26) & 0x3fff,
        height: buf.readUInt16LE(28) & 0x3fff,
        byteLength,
      };
    }
    if (fourcc === "VP8L") {
      // Lossless: 1-byte signature (0x2f) then 14+14 bits of (dimension - 1).
      const bits = buf.readUInt32LE(21);
      return {
        format: "webp",
        extension: "webp",
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
        byteLength,
      };
    }
    if (fourcc === "VP8X") {
      // Extended: 24-bit LE (canvas dimension - 1).
      const w = buf[24]! | (buf[25]! << 8) | (buf[26]! << 16);
      const h = buf[27]! | (buf[28]! << 8) | (buf[29]! << 16);
      return {
        format: "webp",
        extension: "webp",
        width: w + 1,
        height: h + 1,
        byteLength,
      };
    }
  }

  // ── JPEG: walk the segment chain to the SOFn frame header ───────────────
  if (byteLength >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < byteLength) {
      if (buf[offset] !== 0xff) {
        offset += 1; // resync past fill bytes / entropy data
        continue;
      }
      const marker = buf[offset + 1]!;
      // Standalone markers carry no length payload.
      if (
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        offset += 2;
        continue;
      }
      const segLength = buf.readUInt16BE(offset + 2);
      // SOF0..SOF15, excluding DHT (c4), JPG (c8) and DAC (cc).
      const isSOF =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isSOF) {
        return {
          format: "jpg",
          extension: "jpg",
          height: buf.readUInt16BE(offset + 5),
          width: buf.readUInt16BE(offset + 7),
          byteLength,
        };
      }
      if (segLength < 2) break; // malformed — stop rather than loop forever
      offset += 2 + segLength;
    }
  }

  const head = buf.subarray(0, 16).toString("hex");
  throw new Error(
    `Generated thumbnail is not a measurable image (${byteLength} bytes, ` +
      `header ${head}). Expected JPEG, PNG or WebP. Refusing to store bytes ` +
      `whose dimensions cannot be verified against YouTube's ` +
      `${MIN_WIDTH}x${MIN_HEIGHT} minimum.`,
  );
}

/**
 * Enforce the YouTube thumbnail contract on generated bytes.
 *
 * Throws (never repairs) on a violation — an upscale would be exactly the kind
 * of synthetic fallback that produces unuploadable output while every status
 * column reads green.
 */
export function assertYouTubeThumbnail(
  buf: Buffer,
  context: {
    thumbnailId: string;
    provider: string;
    aspectRatio: string;
    resolution: string;
  },
): SniffedImage {
  const image = sniffImage(buf);

  if (image.width < MIN_WIDTH || image.height < MIN_HEIGHT) {
    throw new Error(
      `Generated thumbnail is ${image.width}x${image.height}, below YouTube's ` +
        `${MIN_WIDTH}x${MIN_HEIGHT} minimum (provider=${context.provider}, ` +
        `requested aspect=${context.aspectRatio}, resolution=${context.resolution}, ` +
        `format=${image.format}, thumbnail=${context.thumbnailId}). Refusing to ` +
        `upscale — request a larger resolution from the backend instead. NOTE: ` +
        `\`resolution\` is currently NOT transmitted to the gateway ` +
        `(ImageRequestOptions has no resolution field), so the backend's default ` +
        `output size is what you actually get.`,
    );
  }

  if (image.byteLength > MAX_BYTES) {
    throw new Error(
      `Generated thumbnail is ${image.byteLength} bytes ` +
        `(${(image.byteLength / 1024 / 1024).toFixed(2)} MB), over YouTube's ` +
        `2 MB limit (provider=${context.provider}, ${image.width}x${image.height} ` +
        `${image.format}, thumbnail=${context.thumbnailId}). Refusing to ` +
        `re-compress silently — a recompressed thumbnail is not the image that ` +
        `was reviewed.`,
    );
  }

  return image;
}

/**
 * Final gate on the bytes that are actually written to disk.
 *
 * Runs AFTER `normaliseYouTubeThumbnail`. The two asserts have different jobs
 * and both must stay: `assertYouTubeThumbnail` refuses to accept an
 * under-resolution image FROM a provider (no upscaling, ever), this one refuses
 * to STORE anything that is not exactly the YouTube size. Between them,
 * normalisation may only ever crop and downscale.
 */
export function assertExactYouTubeThumbnail(
  buf: Buffer,
  context: { thumbnailId: string; stage: string },
): SniffedImage {
  const image = sniffImage(buf);
  if (image.width !== TARGET_WIDTH || image.height !== TARGET_HEIGHT) {
    throw new Error(
      `Normalised thumbnail is ${image.width}x${image.height}, expected exactly ` +
        `${TARGET_WIDTH}x${TARGET_HEIGHT} (stage=${context.stage}, ` +
        `thumbnail=${context.thumbnailId}). The normalisation step did not do ` +
        `what it claims; refusing to store an off-spec thumbnail.`,
    );
  }
  if (image.byteLength > MAX_BYTES) {
    throw new Error(
      `Normalised thumbnail is ${image.byteLength} bytes, over YouTube's 2 MB ` +
        `limit (stage=${context.stage}, thumbnail=${context.thumbnailId}).`,
    );
  }
  return image;
}
