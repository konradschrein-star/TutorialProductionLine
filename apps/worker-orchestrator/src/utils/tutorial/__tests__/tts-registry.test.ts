import { describe, it, expect, vi, afterEach } from "vitest";
import { createTutorialTTSProvider } from "../tts-registry.js";

afterEach(() => vi.restoreAllMocks());

describe("tts-registry google_tts", () => {
  it("decodes Google audioContent base64 into a Buffer", async () => {
    const audio = Buffer.from("FAKEAUDIO").toString("base64");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ audioContent: audio }),
      }),
    );
    const provider = createTutorialTTSProvider("google_tts", "key-123", {
      voice: "en-US-Neural2-A",
    });
    const buf = await provider.generateChunk("hello world", "en-US-Neural2-A");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe("FAKEAUDIO");
  });

  it("throws for the coming-soon local provider", () => {
    expect(() => createTutorialTTSProvider("qwen3_local", "")).toThrow(
      /coming soon/i,
    );
  });
});

describe("tts-registry ai33_elevenlabs with settings", () => {
  it("calls AI33 V3 endpoint and returns audio buffer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("/v3/text-to-speech")) {
          return {
            ok: true,
            json: async () => ({ success: true, task_id: "t1" }),
          };
        }
        if (String(url).includes("/v1/task/")) {
          // V1 polling returns the task object directly at the root
          // (not wrapped in { data }) — see elevenlabs-client.ts.
          return {
            ok: true,
            json: async () => ({
              id: "t1",
              status: "done",
              metadata: { audio_url: "https://audio.example/f.mp3" },
            }),
          };
        }
        // audio download
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from("FAKEAUDIO").buffer,
        };
      }),
    );
    const provider = createTutorialTTSProvider("ai33_elevenlabs", "key-abc", {
      settings: { speed: 3.0 }, // above max, should clamp to 1.5 internally
    });
    const buf = await provider.generateChunk("hello", "elevenlabs_rachel");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalled();
  });
});
