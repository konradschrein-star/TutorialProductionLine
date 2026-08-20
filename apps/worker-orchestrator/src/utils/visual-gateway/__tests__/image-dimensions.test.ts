import { describe, it, expect } from "vitest";
import { measureImageDimensions } from "../image-dimensions.js";
import { gifBytes, jpegBytes, pngBytes, webpBytes } from "./fixtures.js";

describe("measureImageDimensions", () => {
  it("reads a PNG IHDR", () => {
    expect(measureImageDimensions(pngBytes(1920, 1080))).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("reads a JPEG SOF0 past an APP0 segment", () => {
    expect(measureImageDimensions(jpegBytes(2560, 1440))).toEqual({
      width: 2560,
      height: 1440,
    });
  });

  it("reads a GIF logical screen descriptor", () => {
    expect(measureImageDimensions(gifBytes(640, 480))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("reads a WebP VP8X canvas", () => {
    expect(measureImageDimensions(webpBytes(1280, 720))).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("throws on an unrecognised container rather than guessing a size", () => {
    expect(() =>
      measureImageDimensions(Buffer.from("not an image at all", "utf8")),
    ).toThrow(/cannot measure image dimensions/);
  });

  it("throws on a truncated PNG", () => {
    expect(() =>
      measureImageDimensions(pngBytes(800, 600).subarray(0, 12)),
    ).toThrow(/cannot measure image dimensions/);
  });

  it("throws when a header declares a zero dimension", () => {
    expect(() => measureImageDimensions(pngBytes(0, 600))).toThrow(
      /zero dimension/,
    );
  });
});
