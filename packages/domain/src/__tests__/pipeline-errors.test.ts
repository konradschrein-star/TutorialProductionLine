import { describe, it, expect } from "vitest";
import {
  PipelineErrorCode,
  isRetryableCode,
  MediaValidationError,
  ExternalServiceError,
  AssetNotFoundError,
  RenderError,
  PipelineError,
} from "../errors/pipeline-errors.js";

describe("PipelineErrorCode", () => {
  it("contains all expected media validation codes", () => {
    expect(PipelineErrorCode.INVALID_ASPECT_RATIO).toBe("INVALID_ASPECT_RATIO");
    expect(PipelineErrorCode.INVALID_RESOLUTION).toBe("INVALID_RESOLUTION");
    expect(PipelineErrorCode.INVALID_FILE_TYPE).toBe("INVALID_FILE_TYPE");
    expect(PipelineErrorCode.INVALID_CODEC).toBe("INVALID_CODEC");
    expect(PipelineErrorCode.INVALID_DURATION).toBe("INVALID_DURATION");
    expect(PipelineErrorCode.CORRUPT_FILE).toBe("CORRUPT_FILE");
    expect(PipelineErrorCode.ZERO_SIZE_ASSET).toBe("ZERO_SIZE_ASSET");
    expect(PipelineErrorCode.OVERSIZED_ASSET).toBe("OVERSIZED_ASSET");
  });

  it("contains all expected external service codes", () => {
    expect(PipelineErrorCode.EXTERNAL_API_TIMEOUT).toBe("EXTERNAL_API_TIMEOUT");
    expect(PipelineErrorCode.EXTERNAL_API_RATE_LIMITED).toBe("EXTERNAL_API_RATE_LIMITED");
    expect(PipelineErrorCode.EXTERNAL_API_AUTH_FAILED).toBe("EXTERNAL_API_AUTH_FAILED");
    expect(PipelineErrorCode.EXTERNAL_API_SERVER_ERROR).toBe("EXTERNAL_API_SERVER_ERROR");
    expect(PipelineErrorCode.EXTERNAL_API_BAD_RESPONSE).toBe("EXTERNAL_API_BAD_RESPONSE");
  });
});

describe("isRetryableCode", () => {
  it("returns true for retryable codes", () => {
    expect(isRetryableCode(PipelineErrorCode.EXTERNAL_API_TIMEOUT)).toBe(true);
    expect(isRetryableCode(PipelineErrorCode.EXTERNAL_API_RATE_LIMITED)).toBe(true);
    expect(isRetryableCode(PipelineErrorCode.EXTERNAL_API_SERVER_ERROR)).toBe(true);
    expect(isRetryableCode(PipelineErrorCode.ASSET_DOWNLOAD_FAILED)).toBe(true);
    expect(isRetryableCode(PipelineErrorCode.ASSET_UPLOAD_FAILED)).toBe(true);
  });

  it("returns false for non-retryable codes", () => {
    expect(isRetryableCode(PipelineErrorCode.INVALID_ASPECT_RATIO)).toBe(false);
    expect(isRetryableCode(PipelineErrorCode.CORRUPT_FILE)).toBe(false);
    expect(isRetryableCode(PipelineErrorCode.FFMPEG_BINARY_NOT_FOUND)).toBe(false);
    expect(isRetryableCode(PipelineErrorCode.UNKNOWN)).toBe(false);
  });
});

describe("MediaValidationError", () => {
  it("constructs with required fields", () => {
    const err = new MediaValidationError(
      PipelineErrorCode.INVALID_ASPECT_RATIO,
      "Wrong aspect ratio"
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PipelineError);
    expect(err).toBeInstanceOf(MediaValidationError);
    expect(err.code).toBe(PipelineErrorCode.INVALID_ASPECT_RATIO);
    expect(err.message).toBe("Wrong aspect ratio");
    expect(err.name).toBe("MediaValidationError");
  });

  it("constructs with optional fields", () => {
    const err = new MediaValidationError(
      PipelineErrorCode.INVALID_RESOLUTION,
      "Resolution mismatch",
      {
        assetKey: "ch1/vid1/thumbnail.png",
        expected: "1920x1080",
        actual: "640x480",
      }
    );
    expect(err.assetKey).toBe("ch1/vid1/thumbnail.png");
    expect(err.expected).toBe("1920x1080");
    expect(err.actual).toBe("640x480");
  });

  it("serializes to JSON with all fields", () => {
    const err = new MediaValidationError(
      PipelineErrorCode.INVALID_ASPECT_RATIO,
      "Bad ratio",
      {
        assetKey: "key/path",
        expected: "16:9",
        actual: "4:3",
      }
    );
    const json = err.toJSON();
    expect(json).toEqual({
      name: "MediaValidationError",
      code: PipelineErrorCode.INVALID_ASPECT_RATIO,
      message: "Bad ratio",
      assetKey: "key/path",
      expected: "16:9",
      actual: "4:3",
    });
  });

  it("serializes to JSON without optional fields", () => {
    const err = new MediaValidationError(
      PipelineErrorCode.CORRUPT_FILE,
      "File is corrupt"
    );
    const json = err.toJSON();
    expect(json).toEqual({
      name: "MediaValidationError",
      code: PipelineErrorCode.CORRUPT_FILE,
      message: "File is corrupt",
    });
  });
});

describe("ExternalServiceError", () => {
  it("constructs with retryable flag", () => {
    const err = new ExternalServiceError(
      PipelineErrorCode.EXTERNAL_API_TIMEOUT,
      "ElevenLabs",
      "Request timed out",
      { statusCode: 504, retryable: true }
    );
    expect(err).toBeInstanceOf(PipelineError);
    expect(err.code).toBe(PipelineErrorCode.EXTERNAL_API_TIMEOUT);
    expect(err.service).toBe("ElevenLabs");
    expect(err.statusCode).toBe(504);
    expect(err.retryable).toBe(true);
    expect(err.name).toBe("ExternalServiceError");
  });

  it("defaults retryable based on isRetryableCode", () => {
    const retryableErr = new ExternalServiceError(
      PipelineErrorCode.EXTERNAL_API_RATE_LIMITED,
      "HeyGen",
      "Rate limited"
    );
    expect(retryableErr.retryable).toBe(true);

    const nonRetryableErr = new ExternalServiceError(
      PipelineErrorCode.EXTERNAL_API_AUTH_FAILED,
      "HeyGen",
      "Auth failed"
    );
    expect(nonRetryableErr.retryable).toBe(false);
  });

  it("serializes to JSON with all fields", () => {
    const err = new ExternalServiceError(
      PipelineErrorCode.EXTERNAL_API_SERVER_ERROR,
      "ElevenLabs",
      "Internal server error",
      { statusCode: 500, retryable: true }
    );
    const json = err.toJSON();
    expect(json).toEqual({
      name: "ExternalServiceError",
      code: PipelineErrorCode.EXTERNAL_API_SERVER_ERROR,
      message: "Internal server error",
      service: "ElevenLabs",
      statusCode: 500,
      retryable: true,
    });
  });
});

describe("AssetNotFoundError", () => {
  it("constructs with asset type", () => {
    const err = new AssetNotFoundError(
      PipelineErrorCode.ASSET_MISSING_FROM_R2,
      "ch1/vid1/audio.mp3",
      "audio/tts",
      "Asset not found in R2"
    );
    expect(err).toBeInstanceOf(PipelineError);
    expect(err.code).toBe(PipelineErrorCode.ASSET_MISSING_FROM_R2);
    expect(err.assetKey).toBe("ch1/vid1/audio.mp3");
    expect(err.assetType).toBe("audio/tts");
    expect(err.name).toBe("AssetNotFoundError");
  });

  it("serializes to JSON with all fields", () => {
    const err = new AssetNotFoundError(
      PipelineErrorCode.ASSET_MISSING_FROM_R2,
      "ch1/vid1/thumb.png",
      "image/thumbnail",
      "Missing thumbnail"
    );
    const json = err.toJSON();
    expect(json).toEqual({
      name: "AssetNotFoundError",
      code: PipelineErrorCode.ASSET_MISSING_FROM_R2,
      message: "Missing thumbnail",
      assetKey: "ch1/vid1/thumb.png",
      assetType: "image/thumbnail",
    });
  });
});

describe("RenderError", () => {
  it("constructs with engine and exitCode", () => {
    const err = new RenderError(
      PipelineErrorCode.FFMPEG_PROCESS_FAILED,
      "FFMPEG",
      "FFmpeg exited with error",
      { exitCode: 1, stderr: "Error processing input" }
    );
    expect(err).toBeInstanceOf(PipelineError);
    expect(err.code).toBe(PipelineErrorCode.FFMPEG_PROCESS_FAILED);
    expect(err.engine).toBe("FFMPEG");
    expect(err.exitCode).toBe(1);
    expect(err.stderr).toBe("Error processing input");
    expect(err.name).toBe("RenderError");
  });

  it("constructs with REMOTION engine", () => {
    const err = new RenderError(
      PipelineErrorCode.REMOTION_RENDER_FAILED,
      "REMOTION",
      "Remotion render crashed"
    );
    expect(err.engine).toBe("REMOTION");
    expect(err.exitCode).toBeUndefined();
    expect(err.stderr).toBeUndefined();
  });

  it("truncates stderr to 2000 characters in toJSON", () => {
    const longStderr = "x".repeat(5000);
    const err = new RenderError(
      PipelineErrorCode.FFMPEG_PROCESS_FAILED,
      "FFMPEG",
      "FFmpeg failed",
      { exitCode: 1, stderr: longStderr }
    );
    const json = err.toJSON();
    expect(json.stderr).toHaveLength(2000);
    expect(json.stderr).toBe("x".repeat(2000));
  });

  it("does not truncate stderr under 2000 characters", () => {
    const shortStderr = "short error output";
    const err = new RenderError(
      PipelineErrorCode.FFMPEG_PROCESS_FAILED,
      "FFMPEG",
      "FFmpeg failed",
      { exitCode: 1, stderr: shortStderr }
    );
    const json = err.toJSON();
    expect(json.stderr).toBe(shortStderr);
  });

  it("serializes to JSON with all fields", () => {
    const err = new RenderError(
      PipelineErrorCode.REMOTION_BUNDLE_FAILED,
      "REMOTION",
      "Bundle failed",
      { exitCode: 2, stderr: "Module not found" }
    );
    const json = err.toJSON();
    expect(json).toEqual({
      name: "RenderError",
      code: PipelineErrorCode.REMOTION_BUNDLE_FAILED,
      message: "Bundle failed",
      engine: "REMOTION",
      exitCode: 2,
      stderr: "Module not found",
    });
  });
});
