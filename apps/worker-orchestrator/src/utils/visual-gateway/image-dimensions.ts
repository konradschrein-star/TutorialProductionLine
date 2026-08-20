/**
 * Pixel dimensions read straight out of an image file header.
 *
 * Why not ffprobe: the gateway must be able to reject an undersized candidate
 * BEFORE it is written into the shared library, it runs once per visual across
 * a catalogue of hundreds of videos, and spawning a process per candidate to
 * read four integers out of the first 32 bytes is waste. It also keeps the
 * gateway unit-testable with byte fixtures and no binaries on PATH.
 *
 * PNG, JPEG, GIF and WebP only. Anything else THROWS — a fail-closed measure,
 * because "assume it is big enough" is how a 320px thumbnail ends up upscaled
 * into a 1080p frame.
 */

export interface PixelDimensions {
  width: number;
  height: number;
}

/**
 * Read `{ width, height }` from image bytes.
 *
 * @throws Error when the buffer is truncated, the container is not one of
 *         PNG/JPEG/GIF/WebP, or the header declares a zero dimension.
 */
export function measureImageDimensions(bytes: Buffer): PixelDimensions {
  const dims =
    tryPng(bytes) ?? tryGif(bytes) ?? tryWebp(bytes) ?? tryJpeg(bytes);

  if (!dims) {
    throw new Error(
      `visual-gateway: cannot measure image dimensions — unrecognised or ` +
        `truncated container (${bytes.length} bytes, first 12 bytes ` +
        `${bytes.subarray(0, 12).toString("hex")}). Supported: PNG, JPEG, ` +
        `GIF, WebP.`,
    );
  }
  if (dims.width <= 0 || dims.height <= 0) {
    throw new Error(
      `visual-gateway: image header declares a zero dimension ` +
        `(${dims.width}x${dims.height}) — refusing to treat it as valid.`,
    );
  }
  return dims;
}

/** PNG: 8-byte signature, then IHDR with width/height as big-endian uint32. */
function tryPng(b: Buffer): PixelDimensions | null {
  if (b.length < 24) return null;
  const signature = "89504e470d0a1a0a";
  if (b.subarray(0, 8).toString("hex") !== signature) return null;
  if (b.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** GIF: `GIF87a`/`GIF89a`, then logical screen size as little-endian uint16. */
function tryGif(b: Buffer): PixelDimensions | null {
  if (b.length < 10) return null;
  const magic = b.subarray(0, 6).toString("ascii");
  if (magic !== "GIF87a" && magic !== "GIF89a") return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

/** WebP: RIFF container with a VP8 (lossy), VP8L (lossless) or VP8X chunk. */
function tryWebp(b: Buffer): PixelDimensions | null {
  if (b.length < 30) return null;
  if (b.subarray(0, 4).toString("ascii") !== "RIFF") return null;
  if (b.subarray(8, 12).toString("ascii") !== "WEBP") return null;

  const chunk = b.subarray(12, 16).toString("ascii");

  if (chunk === "VP8X") {
    // 4 bytes flags/reserved, then canvas width-1 and height-1 as 24-bit LE.
    const width = b.readUIntLE(24, 3) + 1;
    const height = b.readUIntLE(27, 3) + 1;
    return { width, height };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null; // lossless signature byte
    const bits = b.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === "VP8 ") {
    // 3-byte frame tag, then the 3-byte start code 9d 01 2a.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return {
      width: b.readUInt16LE(26) & 0x3fff,
      height: b.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

/**
 * JPEG: walk the marker segments to the first Start-Of-Frame, which carries
 * height then width as big-endian uint16. DHT/DQT/APPn segments are skipped by
 * their declared length; SOF4 (DHT), SOF8 (JPG), SOFC (DAC) are not frame
 * headers and are excluded.
 */
function tryJpeg(b: Buffer): PixelDimensions | null {
  if (b.length < 4) return null;
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 3 < b.length) {
    if (b[offset] !== 0xff) {
      offset += 1; // resynchronise on fill bytes / padding
      continue;
    }
    const marker = b[offset + 1]!;
    // Standalone markers with no payload.
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / start of scan
    if (offset + 3 >= b.length) return null;
    const length = b.readUInt16BE(offset + 2);
    if (length < 2) return null;

    const isFrameHeader =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;

    if (isFrameHeader) {
      if (offset + 9 > b.length) return null;
      return {
        width: b.readUInt16BE(offset + 7),
        height: b.readUInt16BE(offset + 5),
      };
    }
    offset += 2 + length;
  }
  return null;
}
