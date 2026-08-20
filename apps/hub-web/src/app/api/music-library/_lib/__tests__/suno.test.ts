import { describe, it, expect, vi } from "vitest";
import {
  classifyAi33Failure,
  usableClips,
  parseSunoTags,
  submitSunoTask,
  pollSunoTask,
  SunoGenerationError,
  type SunoClip,
} from "../suno";

/** Minimal Response stand-in for the fetch injection points. */
function res(
  status: number,
  body: unknown,
  { text }: { text?: string } = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => text ?? JSON.stringify(body),
  } as Response;
}

describe("classifyAi33Failure", () => {
  it("classifies 429 as a retryable rate limit", () => {
    const e = classifyAi33Failure(429, "Too Many Requests");
    expect(e.code).toBe("rate_limited");
    expect(e.retryable).toBe(true);
    expect(e.status).toBe(429);
  });

  it("classifies 503 as retryable server_busy", () => {
    const e = classifyAi33Failure(503, '{"code":"server_busy"}');
    expect(e.code).toBe("server_busy");
    expect(e.retryable).toBe(true);
  });

  it("classifies a server_busy body even on an odd status", () => {
    expect(classifyAi33Failure(500, '{"code":"server_busy"}').code).toBe(
      "server_busy",
    );
  });

  it("distinguishes an invalid key from exhausted credits on 401", () => {
    expect(classifyAi33Failure(401, "Invalid API key").code).toBe("auth");
    expect(
      classifyAi33Failure(401, "insufficient credits for this operation").code,
    ).toBe("no_credits");
  });

  it("marks auth and credit failures as not retryable", () => {
    expect(classifyAi33Failure(401, "Invalid API key").retryable).toBe(false);
    expect(classifyAi33Failure(401, "insufficient credits").retryable).toBe(
      false,
    );
  });

  it("treats 5xx as retryable unknown and 4xx as terminal unknown", () => {
    expect(classifyAi33Failure(500, "boom").retryable).toBe(true);
    expect(classifyAi33Failure(500, "boom").code).toBe("unknown");
    expect(classifyAi33Failure(400, "bad request").retryable).toBe(false);
  });

  it("includes the upstream body so the operator can see the real reason", () => {
    expect(classifyAi33Failure(429, "queue full: 12/10").message).toContain(
      "12/10",
    );
  });
});

describe("usableClips", () => {
  it("keeps only clips with a downloadable url and preserves order", () => {
    const clips: SunoClip[] = [
      { id: "a", audio_url: "https://x/a.mp3" },
      { id: "b" },
      { id: "c", audio_url: "" },
      { id: "d", audio_url: "https://x/d.mp3" },
    ];
    expect(usableClips(clips).map((c) => c.id)).toEqual(["a", "d"]);
  });

  it("returns empty for an empty input", () => {
    expect(usableClips([])).toEqual([]);
  });
});

describe("parseSunoTags", () => {
  it("returns empty for undefined", () => {
    expect(parseSunoTags(undefined)).toEqual([]);
  });

  it("keeps short single-word tags and lowercases them", () => {
    expect(parseSunoTags("Ambient, Soft, PIANO")).toEqual([
      "ambient",
      "soft",
      "piano",
    ]);
  });

  it("drops the long prose fragments Suno mixes into the tags field", () => {
    const real =
      "Ambient instrumental with soft felt piano and airy sustain beds, soft, ambient";
    expect(parseSunoTags(real)).toEqual(["soft", "ambient"]);
  });

  it("de-duplicates", () => {
    expect(parseSunoTags("soft, soft, Soft")).toEqual(["soft"]);
  });

  it("caps the number of tags", () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`).join(",");
    expect(parseSunoTags(many)).toHaveLength(12);
  });
});

describe("submitSunoTask", () => {
  it("returns the task id on success", async () => {
    const fetchImpl = vi.fn(async () =>
      res(200, { success: true, task_id: "task-1" }),
    ) as unknown as typeof fetch;

    await expect(
      submitSunoTask("k", { prompt: "calm piano", fetchImpl }),
    ).resolves.toBe("task-1");
  });

  it("sends the verified AI33 Suno payload shape", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return res(200, { success: true, task_id: "t" });
    }) as unknown as typeof fetch;

    await submitSunoTask("secret", {
      prompt: "lofi",
      instrumental: false,
      fetchImpl,
    });

    const [url, init] = calls[0]!;
    expect(url).toBe("https://api.ai33.pro/v1s/task/music-generation");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe(
      "secret",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      create_mode: "simple",
      gpt_description_prompt: "lofi",
      make_instrumental: false,
      major_model_version: "v4.5-all",
    });
  });

  it("throws a classified error on 429 rather than falling back", async () => {
    const fetchImpl = vi.fn(async () =>
      res(429, {}, { text: "rate limited" }),
    ) as unknown as typeof fetch;

    await expect(
      submitSunoTask("k", { prompt: "p", fetchImpl }),
    ).rejects.toMatchObject({ code: "rate_limited", retryable: true });
  });

  it("throws when the response has no task_id", async () => {
    const fetchImpl = vi.fn(async () =>
      res(200, { success: true }),
    ) as unknown as typeof fetch;

    await expect(
      submitSunoTask("k", { prompt: "p", fetchImpl }),
    ).rejects.toBeInstanceOf(SunoGenerationError);
  });
});

describe("pollSunoTask", () => {
  const noSleep = async () => {};

  it("returns both clips when the task completes", async () => {
    const fetchImpl = vi.fn(async () =>
      res(200, {
        status: "done",
        credit_cost: 3600,
        metadata: {
          suno_result: {
            clips: [
              { id: "c1", audio_url: "https://x/1.mp3", duration: 215.44 },
              { id: "c2", audio_url: "https://x/2.mp3", duration: 190.2 },
            ],
          },
        },
      }),
    ) as unknown as typeof fetch;

    const r = await pollSunoTask("k", "t", { fetchImpl, sleep: noSleep });
    expect(r.clips).toHaveLength(2);
    expect(r.creditCost).toBe(3600);
  });

  it("keeps polling while the task is still running", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      if (n < 3) return res(200, { status: "processing" });
      return res(200, {
        status: "done",
        metadata: {
          suno_result: { clips: [{ audio_url: "https://x/1.mp3" }] },
        },
      });
    }) as unknown as typeof fetch;

    const r = await pollSunoTask("k", "t", { fetchImpl, sleep: noSleep });
    expect(r.clips).toHaveLength(1);
    expect(n).toBe(3);
  });

  it("survives a transient 503 mid-poll — the task is already paid for", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      if (n === 1) return res(503, {}, { text: "server_busy" });
      return res(200, {
        status: "done",
        metadata: {
          suno_result: { clips: [{ audio_url: "https://x/1.mp3" }] },
        },
      });
    }) as unknown as typeof fetch;

    await expect(
      pollSunoTask("k", "t", { fetchImpl, sleep: noSleep }),
    ).resolves.toMatchObject({ status: "done" });
  });

  it("aborts immediately when auth breaks mid-poll", async () => {
    const fetchImpl = vi.fn(async () =>
      res(401, {}, { text: "Invalid API key" }),
    ) as unknown as typeof fetch;

    await expect(
      pollSunoTask("k", "t", { fetchImpl, sleep: noSleep }),
    ).rejects.toMatchObject({ code: "auth" });
  });

  it("throws on a terminal error status, never returning a fake track", async () => {
    const fetchImpl = vi.fn(async () =>
      res(200, { status: "error", error_message: "generation failed" }),
    ) as unknown as typeof fetch;

    await expect(
      pollSunoTask("k", "t", { fetchImpl, sleep: noSleep }),
    ).rejects.toThrow(/generation failed/);
  });

  it("throws no_audio when the task is done but produced nothing usable", async () => {
    const fetchImpl = vi.fn(async () =>
      res(200, { status: "done", metadata: { suno_result: { clips: [] } } }),
    ) as unknown as typeof fetch;

    await expect(
      pollSunoTask("k", "t", { fetchImpl, sleep: noSleep }),
    ).rejects.toMatchObject({ code: "no_audio" });
  });

  it("times out with a retryable error and points at the task id", async () => {
    const fetchImpl = vi.fn(async () =>
      res(200, { status: "processing" }),
    ) as unknown as typeof fetch;

    await expect(
      pollSunoTask("k", "task-9", {
        fetchImpl,
        sleep: noSleep,
        maxAttempts: 3,
        intervalMs: 1,
      }),
    ).rejects.toMatchObject({ code: "timeout", retryable: true });
  });
});
