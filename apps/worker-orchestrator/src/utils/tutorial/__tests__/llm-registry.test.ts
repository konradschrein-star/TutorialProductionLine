import { describe, it, expect, vi, afterEach } from "vitest";
import { generateScript } from "../llm-registry.js";

afterEach(() => vi.restoreAllMocks());

describe("llm-registry openai", () => {
  it("posts to OpenAI and returns the message content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "SCRIPT" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await generateScript({
      provider: "openai",
      prompt: "write a tutorial script",
      apiKey: "sk-x",
      model: "gpt-4o",
    });
    expect(out).toBe("SCRIPT");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("api.openai.com");
    expect(JSON.parse((init as { body: string }).body).model).toBe("gpt-4o");
  });

  it("throws when a non-pool provider has no key", async () => {
    await expect(
      generateScript({
        provider: "openai",
        prompt: "x",
        apiKey: "",
        model: "gpt-4o",
      }),
    ).rejects.toThrow(/api key/i);
  });

  it("throws for the coming-soon local provider", async () => {
    await expect(
      generateScript({ provider: "qwen_local", prompt: "x", apiKey: "" }),
    ).rejects.toThrow(/coming soon/i);
  });
});

/**
 * Truncation guard.
 *
 * deepseek-v4-pro is a REASONING model: `max_tokens` caps `completion_tokens`,
 * which INCLUDES the (highly variable) reasoning tokens. Measured on the live
 * API for one identical prompt: 413 reasoning tokens on one call, 1671 on the
 * next. With the old 4096 ceiling that overflowed at unpredictable points and
 * the answer was cut off MID-SENTENCE — and because nothing inspected
 * `finish_reason`, the fragment was silently saved as script_text and recorded.
 * Production had scripts ending on "…Then you checked the confirmation and".
 *
 * A truncated script must fail LOUDLY so BullMQ's retry re-rolls it (which is
 * what the VAs were doing by hand when they hit "regenerate").
 */
describe("llm-registry truncation guard", () => {
  function stubChat(opts: {
    content: string;
    finish_reason: string;
    usage?: unknown;
  }) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { content: opts.content },
            finish_reason: opts.finish_reason,
          },
        ],
        usage: opts.usage,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("throws when deepseek stops because it hit the token ceiling", async () => {
    stubChat({
      content: "Then you checked the confirmation and",
      finish_reason: "length",
      usage: { completion_tokens_details: { reasoning_tokens: 2400 } },
    });

    await expect(
      generateScript({
        provider: "deepseek",
        prompt: "write a tutorial script",
        apiKey: "sk-x",
        maxTokens: 16384,
      }),
    ).rejects.toThrow(/truncat/i);
  });

  it("names the token budget and reasoning spend in the error", async () => {
    stubChat({
      content: "cut off here",
      finish_reason: "length",
      usage: { completion_tokens_details: { reasoning_tokens: 2400 } },
    });

    // The diagnostic must be actionable: which provider, what ceiling, and how
    // much of it the reasoning phase ate.
    await expect(
      generateScript({
        provider: "deepseek",
        prompt: "x",
        apiKey: "sk-x",
        maxTokens: 16384,
      }),
    ).rejects.toThrow(/16384[\s\S]*2400|2400[\s\S]*16384/);
  });

  it("passes maxTokens through to deepseek as max_tokens", async () => {
    const fetchMock = stubChat({ content: "SCRIPT", finish_reason: "stop" });

    await generateScript({
      provider: "deepseek",
      prompt: "x",
      apiKey: "sk-x",
      maxTokens: 16384,
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as { body: string }).body,
    ) as { max_tokens?: number };
    expect(body.max_tokens).toBe(16384);
  });

  it("returns the script normally when generation completed", async () => {
    stubChat({ content: "A full script.", finish_reason: "stop" });
    await expect(
      generateScript({ provider: "deepseek", prompt: "x", apiKey: "sk-x" }),
    ).resolves.toBe("A full script.");
  });

  it("throws when the OpenAI-compatible path is truncated too", async () => {
    stubChat({ content: "half a scr", finish_reason: "length" });
    await expect(
      generateScript({
        provider: "minimax_llm",
        prompt: "x",
        apiKey: "sk-x",
        maxTokens: 8192,
      }),
    ).rejects.toThrow(/truncat/i);
  });

  it("honours maxTokens on the gemini path and rejects MAX_TOKENS stops", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: { parts: [{ text: "cut off" }] },
            finishReason: "MAX_TOKENS",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateScript({
        provider: "google_gemini",
        prompt: "x",
        apiKey: "k",
        model: "gemini-2.5-flash",
        maxTokens: 16384,
      }),
    ).rejects.toThrow(/truncat/i);

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as { body: string }).body,
    ) as { generationConfig?: { maxOutputTokens?: number } };
    expect(body.generationConfig?.maxOutputTokens).toBe(16384);
  });
});
