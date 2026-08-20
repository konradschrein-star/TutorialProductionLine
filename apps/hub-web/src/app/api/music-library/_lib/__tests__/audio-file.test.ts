import { describe, it, expect } from "vitest";
import {
  extensionOf,
  isAcceptedAudioExtension,
  contentTypeForExtension,
  storageFilename,
  validateUpload,
  interpretAudioProbe,
  MAX_AUDIO_BYTES,
  type RawProbe,
} from "../audio-file";

describe("extensionOf", () => {
  it("lowercases the extension", () => {
    expect(extensionOf("Track.MP3")).toBe("mp3");
  });

  it("returns null when there is no extension", () => {
    expect(extensionOf("trackname")).toBeNull();
  });

  it("returns null for a dotfile with no extension", () => {
    expect(extensionOf(".gitignore")).toBeNull();
  });

  it("returns null for a trailing dot", () => {
    expect(extensionOf("track.")).toBeNull();
  });

  it("uses the last extension for multi-dot names", () => {
    expect(extensionOf("my.song.final.flac")).toBe("flac");
  });

  it("strips directory components so traversal cannot smuggle an extension", () => {
    expect(extensionOf("../../etc/passwd")).toBeNull();
    expect(extensionOf("..\\..\\windows\\system.ini")).toBe("ini");
  });
});

describe("isAcceptedAudioExtension", () => {
  it("accepts the documented formats", () => {
    for (const ext of ["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus"]) {
      expect(isAcceptedAudioExtension(ext)).toBe(true);
    }
  });

  it("rejects video and arbitrary formats", () => {
    for (const ext of ["mp4", "mov", "exe", "txt", "webm"]) {
      expect(isAcceptedAudioExtension(ext)).toBe(false);
    }
  });

  it("rejects null", () => {
    expect(isAcceptedAudioExtension(null)).toBe(false);
  });
});

describe("contentTypeForExtension", () => {
  it("maps known audio extensions", () => {
    expect(contentTypeForExtension("mp3")).toBe("audio/mpeg");
    expect(contentTypeForExtension("wav")).toBe("audio/wav");
    expect(contentTypeForExtension("m4a")).toBe("audio/mp4");
    expect(contentTypeForExtension("opus")).toBe("audio/ogg");
  });

  it("falls back to a generic type rather than lying about the format", () => {
    expect(contentTypeForExtension("mp4")).toBe("application/octet-stream");
    expect(contentTypeForExtension(null)).toBe("application/octet-stream");
  });
});

describe("storageFilename", () => {
  it("derives the on-disk name from the id, never from user input", () => {
    expect(storageFilename("abc-123", "mp3")).toBe("abc-123.mp3");
  });
});

describe("validateUpload", () => {
  it("accepts a normal mp3", () => {
    const r = validateUpload({ filename: "chill.mp3", sizeBytes: 4_000_000 });
    expect(r).toEqual({ ok: true, extension: "mp3" });
  });

  it("rejects an empty file", () => {
    const r = validateUpload({ filename: "a.mp3", sizeBytes: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty/i);
  });

  it("rejects a file over the size limit", () => {
    const r = validateUpload({
      filename: "a.wav",
      sizeBytes: MAX_AUDIO_BYTES + 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/limit/i);
  });

  it("accepts exactly the size limit", () => {
    const r = validateUpload({ filename: "a.wav", sizeBytes: MAX_AUDIO_BYTES });
    expect(r.ok).toBe(true);
  });

  it("rejects a video file", () => {
    const r = validateUpload({ filename: "clip.mp4", sizeBytes: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unsupported audio format "mp4"/i);
  });

  it("rejects a file with no extension", () => {
    const r = validateUpload({ filename: "noext", sizeBytes: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/"none"/);
  });
});

describe("interpretAudioProbe", () => {
  const audioOnly: RawProbe = {
    streams: [
      {
        codec_type: "audio",
        codec_name: "mp3",
        sample_rate: "44100",
        channels: 2,
      },
    ],
    format: { duration: "215.44", format_name: "mp3", bit_rate: "192000" },
  };

  it("extracts duration and stream facts", () => {
    const r = interpretAudioProbe(audioOnly);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.audio.durationSeconds).toBe(215); // rounded for the integer column
    expect(r.audio.codec).toBe("mp3");
    expect(r.audio.sampleRate).toBe(44100);
    expect(r.audio.channels).toBe(2);
    expect(r.audio.bitRate).toBe(192000);
  });

  it("rounds duration to the nearest second", () => {
    const r = interpretAudioProbe({
      ...audioOnly,
      format: { duration: 59.6 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.audio.durationSeconds).toBe(60);
  });

  it("rejects a file with no audio stream (filename lied)", () => {
    const r = interpretAudioProbe({
      streams: [{ codec_type: "video", codec_name: "h264" }],
      format: { duration: "10" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no audio stream/i);
  });

  it("rejects a real video file even when it has an audio track", () => {
    const r = interpretAudioProbe({
      streams: [
        { codec_type: "video", codec_name: "h264" },
        { codec_type: "audio", codec_name: "aac" },
      ],
      format: { duration: "10" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/video stream/i);
  });

  it("allows embedded cover art, which ffprobe reports as a video stream", () => {
    const r = interpretAudioProbe({
      streams: [
        { codec_type: "audio", codec_name: "mp3", channels: 2 },
        { codec_type: "video", codec_name: "mjpeg" },
      ],
      format: { duration: "180" },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a zero duration rather than storing 0", () => {
    const r = interpretAudioProbe({
      streams: [{ codec_type: "audio", codec_name: "mp3" }],
      format: { duration: "0" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/duration/i);
  });

  it("rejects a missing duration rather than defaulting it", () => {
    const r = interpretAudioProbe({
      streams: [{ codec_type: "audio", codec_name: "mp3" }],
      format: {},
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-numeric duration", () => {
    const r = interpretAudioProbe({
      streams: [{ codec_type: "audio", codec_name: "mp3" }],
      format: { duration: "N/A" },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects null probe output", () => {
    expect(interpretAudioProbe(null).ok).toBe(false);
  });

  it("rejects a probe with no streams at all", () => {
    const r = interpretAudioProbe({ format: { duration: "100" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no audio stream/i);
  });
});
