/**
 * LLM router — the single entry point for text generation.
 *
 * Two APIs:
 *
 *   requestLLMText(prompt, options)  — tier-based routing with explicit
 *     fallback ladders. Preferred for new code.
 *   callLLM(prompt, options)         — legacy provider-name API kept for
 *     existing call sites; same providers underneath.
 *
 * Tiers (Konrad's routing decisions, 2026-07):
 *   premium  → claude_pool (Claude Code CLI on VPS, OAuth — best quality,
 *              long-form scripts) → deepseek → ollama
 *   standard → deepseek (cheap/fast/decent) → ollama
 *   local    → lmstudio (LM Studio, Gemma/Qwen) → ollama
 *   prompt   → fastgen prompt endpoint (until the plan expires early July
 *              2026) → deepseek → ollama
 *
 * Pin a single provider with options.provider — pinned calls do NOT fall
 * back (production paths that must fail loudly, e.g. clip-forge detection).
 *
 * NOTE: the tutorial LLM registry (utils/tutorial/llm-registry.ts) stays
 * separate — it resolves per-VA encrypted API keys per job. The AI OS
 * "scriptwriter" workers integration will slot in as another premium
 * provider once the AI OS side exposes it.
 *
 * Providers/env:
 *   claude_pool: CLAUDE_POOL_URL (default :8092), CLAUDE_POOL_API_KEY.
 *     /v1/script for supported formats, /v1/run for free-form prompts.
 *     Active 06:00–18:00 UTC by default (503 outside hours).
 *   deepseek: DEEPSEEK_API_KEY, api.deepseek.com, model deepseek-chat.
 *   lmstudio: LMSTUDIO_URL (default :1234), LMSTUDIO_MODEL — OpenAI-compatible.
 *   ollama: OLLAMA_URL (default :11434), OLLAMA_MODEL (default gemma3:4b).
 *   fastgen: FASTGEN_API_KEY — POST /api/v4/prompt/generate.
 *   gemini_pool: GEMINI_POOL_URL (default :8090), GEMINI_POOL_API_KEY.
 *   anthropic: ANTHROPIC_API_KEY, claude-sonnet-4-6 (streamed).
 */

import { generatePromptText } from "./fastgen-client.js";
import { createContextLogger } from "@repo/logger";

const logger = createContextLogger("llm-router");

const CLAUDE_POOL_URL =
  process.env["CLAUDE_POOL_URL"] ?? "http://127.0.0.1:8092";
const CLAUDE_POOL_API_KEY = process.env["CLAUDE_POOL_API_KEY"] ?? "";

/** Formats handled by claude-pool /v1/script. Must match SupportedFormat in apps/claude-pool/src/types.ts. */
const CLAUDE_POOL_SUPPORTED_FORMATS = new Set([
  "CASUALLY_EXPLAINED",
  "EXPLAINER",
  "VIDEO_ESSAY",
  // Registered in apps/claude-pool/src/writers/index.ts as businessPlanHubWriter.
  // Without this entry the call falls through to the generic /v1/run endpoint and
  // the writer's SOP + validate() + --resume self-correction never run.
  "BUSINESS_PLAN_HUB",
]);

export type LLMProvider =
  | "claude_pool"
  | "deepseek"
  | "lmstudio"
  | "ollama"
  | "fastgen"
  | "gemini_pool"
  | "gemini_direct"
  | "anthropic";

export type LLMTier = "premium" | "standard" | "local" | "prompt";

/**
 * DEFAULT REQUEST TIMEOUT.
 *
 * Was 120s, which is a known-broken value here: `deepseek-v4-pro` is a
 * REASONING model and a real ~1,500-word script measures ~138s (see the
 * measurement comment at processors/ai-generation.ts:695). A 120s timeout once
 * failed 100% of tutorial jobs. That was fixed by having the tutorial path pass
 * `timeoutMs: 300_000` explicitly — but the DEFAULT was left at 120s, so every
 * caller that did not know to override it inherited the broken value. The
 * RANKING path did exactly that and failed in production on 2026-08-03 with
 * "deepseek: The operation was aborted due to timeout".
 *
 * A default should be safe for the model actually behind it. Callers that want
 * a short leash (clip-selection uses 60s) still pass their own.
 */
const DEFAULT_TIMEOUT_MS = 240_000;

/**
 * `ollama` sat at the end of every ladder as the universal fallback, but it is
 * NOT RUNNING on the VPS (`systemctl is-active ollama` -> inactive, no models
 * pulled). A permanently-dead fallback is worse than none: it makes the ladder
 * look redundant while the real behaviour is a single point of failure, and it
 * turns one clear error into "all providers failed".
 *
 * `gemini_direct` is a live, verified fallback (Google API key present and
 * tested end to end). It is placed BEFORE ollama everywhere rather than
 * replacing it, so a future working local model still gets its turn.
 */
const TIER_LADDERS: Record<LLMTier, LLMProvider[]> = {
  premium: ["claude_pool", "deepseek", "gemini_direct", "ollama"],
  standard: ["deepseek", "gemini_direct", "ollama"],
  local: ["lmstudio", "gemini_direct", "ollama"],
  prompt: ["fastgen", "deepseek", "gemini_direct", "ollama"],
};

export interface LLMTextOptions {
  /** Routing tier. Default "standard". Ignored when `provider` is set. */
  tier?: LLMTier;
  /** Pin one provider — NO fallback ladder; failures throw. */
  provider?: LLMProvider;
  /** System prompt (chat-style providers; prepended for prompt-only ones). */
  system?: string;
  /** Request strict JSON output where the provider supports it. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** claude_pool /v1/script format selection (premium tier). */
  scriptFormat?: string;
  /** Log tag. */
  context?: string;
}

/**
 * Tier-routed text generation. Walks the tier's provider ladder, skipping
 * unconfigured providers, and throws an aggregated error when every rung
 * fails. Pinned providers fail loudly with no fallback.
 */
export async function requestLLMText(
  prompt: string,
  options: LLMTextOptions = {},
): Promise<string> {
  if (options.provider) {
    return dispatch(options.provider, prompt, options);
  }
  const tier = options.tier ?? "standard";
  const errors: Array<{ provider: LLMProvider; error: string }> = [];
  for (const provider of TIER_LADDERS[tier]) {
    if (!providerConfigured(provider)) {
      errors.push({ provider, error: "not configured" });
      continue;
    }
    try {
      return await dispatch(provider, prompt, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ provider, error: message.slice(0, 300) });
      logger.warn(
        {
          tier,
          provider,
          context: options.context,
          error: message.slice(0, 300),
        },
        "LLM provider failed, trying next rung",
      );
    }
  }
  throw new Error(
    `All LLM providers failed for tier "${tier}":\n${errors
      .map((e) => `  - ${e.provider}: ${e.error}`)
      .join("\n")}`,
  );
}

function providerConfigured(provider: LLMProvider): boolean {
  switch (provider) {
    case "claude_pool":
      return Boolean(CLAUDE_POOL_API_KEY);
    case "deepseek":
      return Boolean(process.env["DEEPSEEK_API_KEY"]);
    case "fastgen":
      return Boolean(
        process.env["FASTGEN_API_KEY"] ?? process.env["MEDIA_GEN_API_KEY"],
      );
    case "gemini_pool":
      return Boolean(process.env["GEMINI_POOL_API_KEY"]);
    case "gemini_direct":
      return Boolean(
        process.env["GEMINI_DIRECT_API_KEY"] ?? process.env["GEMINI_API_KEY"],
      );
    case "anthropic":
      return Boolean(process.env["ANTHROPIC_API_KEY"]);
    case "lmstudio":
    case "ollama":
      return true; // local servers — reachable-or-not is decided by the call
  }
}

function dispatch(
  provider: LLMProvider,
  prompt: string,
  options: LLMTextOptions,
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  switch (provider) {
    case "claude_pool":
      return callClaudePoolRouted(prompt, options);
    case "deepseek":
      return callDeepSeek(prompt, options);
    case "lmstudio":
      return callLmStudio(prompt, options);
    case "ollama":
      return callOllama(
        withSystem(prompt, options.system),
        timeoutMs,
        options.json,
      );
    case "gemini_pool":
      return callGeminiPool(withSystem(prompt, options.system), timeoutMs);
    case "gemini_direct":
      return callGeminiDirect(
        withSystem(prompt, options.system),
        timeoutMs,
        options,
      );
    case "anthropic":
      return callAnthropic(withSystem(prompt, options.system), options);
    case "fastgen":
      return generatePromptText(withSystem(prompt, options.system)).then(
        (r) => r.text,
      );
  }
}

/** Prompt-only providers get the system text prepended. */
function withSystem(prompt: string, system: string | undefined): string {
  return system ? `${system}\n\n${prompt}` : prompt;
}

// ─── Legacy API (existing call sites) ───────────────────────────────────────

export interface LLMCallOptions {
  maxTokens?: number;
  timeoutMs?: number;
  /** Override env LLM_PROVIDER for this call. */
  provider?: "fastgen" | "gemini_pool" | "anthropic" | "claude_pool" | "ollama";
  /** Content format — used by claude_pool provider for format-specific system prompt selection. */
  scriptFormat?: string;
}

/**
 * Legacy provider-name API. Provider from options or env LLM_PROVIDER
 * (default fastgen). claude_pool falls back to ollama on unsupported
 * format or 503 (preserved behavior).
 */
export async function callLLM(
  prompt: string,
  options: LLMCallOptions = {},
): Promise<string> {
  const { timeoutMs = 120_000 } = options;
  const provider = options.provider ?? process.env["LLM_PROVIDER"] ?? "fastgen";

  if (provider === "claude_pool") {
    return callClaudePoolScript(prompt, options);
  }
  if (provider === "gemini_pool") {
    return callGeminiPool(prompt, timeoutMs);
  }
  if (provider === "anthropic") {
    return callAnthropic(prompt, options);
  }
  if (provider === "ollama") {
    return callOllama(prompt, timeoutMs);
  }

  // fastgen (default)
  logger.info({ prompt_length: prompt.length }, "Calling fast-gen LLM");
  const { text } = await generatePromptText(prompt);
  logger.info(
    { response_length: text.length },
    "fast-gen LLM response received",
  );
  return text;
}

// ─── Providers ──────────────────────────────────────────────────────────────

async function callDeepSeek(
  prompt: string,
  options: LLMTextOptions,
): Promise<string> {
  const apiKey = process.env["DEEPSEEK_API_KEY"];
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not configured");

  const messages: Array<{ role: string; content: string }> = [];
  if (options.system)
    messages.push({ role: "system", content: options.system });
  messages.push({ role: "user", content: prompt });

  logger.info(
    {
      prompt_length: prompt.length,
      json: options.json ?? false,
      context: options.context,
    },
    "Calling DeepSeek",
  );

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
      ...(options.temperature != null
        ? { temperature: options.temperature }
        : {}),
      ...(options.maxTokens != null ? { max_tokens: options.maxTokens } : {}),
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`DeepSeek HTTP ${res.status}: ${body.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{
      message?: { content?: string };
      finish_reason?: string;
    }>;
    usage?: {
      completion_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("DeepSeek returned empty content");

  // Refuse output the provider guillotined at the token ceiling.
  //
  // `deepseek-v4-pro` is a REASONING model, so `max_tokens` caps
  // completion_tokens INCLUDING its chain of thought, and that spend swings
  // run to run on an identical prompt. When it runs long the answer is cut
  // wherever it happened to reach. Nothing here inspected `finish_reason`, so
  // a fragment came back as a normal success and was returned to the caller —
  // for RANKING that meant a half-written narration going to Fish Audio and
  // being rendered. That is the silent-truncation fallback this codebase bans.
  //
  // The tutorial path already guards this (utils/tutorial/llm-registry.ts
  // assertNotTruncated, added after VAs reported scripts that "cut, no outro");
  // this is the same guard on the shared client every other format uses.
  // Throwing lets the BullMQ retry re-roll generation with a fresh, usually
  // shorter chain of thought — which is exactly what the VAs were doing by hand.
  const finishReason = data.choices?.[0]?.finish_reason;
  if (finishReason === "length") {
    const reasoning = data.usage?.completion_tokens_details?.reasoning_tokens;
    throw new Error(
      `DeepSeek output was TRUNCATED at the token ceiling (finish_reason=length). ` +
        `max_tokens=${options.maxTokens ?? "unset"} ` +
        `completion_tokens=${data.usage?.completion_tokens ?? "?"} ` +
        `reasoning_tokens=${reasoning ?? "?"} chars_returned=${text.length}. ` +
        `The text ends mid-thought and must not be used. Ends with: ` +
        `"...${text.trim().slice(-80)}". A retry re-rolls generation; if it ` +
        `keeps happening, raise maxTokens for this call site.`,
    );
  }

  logger.info(
    {
      response_length: text.length,
      completion_tokens: data.usage?.completion_tokens,
      reasoning_tokens: data.usage?.completion_tokens_details?.reasoning_tokens,
    },
    "DeepSeek response received",
  );
  return text;
}

async function callLmStudio(
  prompt: string,
  options: LLMTextOptions,
): Promise<string> {
  const baseUrl = process.env["LMSTUDIO_URL"] ?? "http://127.0.0.1:1234";
  const model = process.env["LMSTUDIO_MODEL"] ?? "local-model";

  const messages: Array<{ role: string; content: string }> = [];
  if (options.system)
    messages.push({ role: "system", content: options.system });
  messages.push({ role: "user", content: prompt });

  logger.info(
    { url: `${baseUrl}/v1/chat/completions`, model, context: options.context },
    "Calling LM Studio",
  );

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
      ...(options.temperature != null
        ? { temperature: options.temperature }
        : {}),
      ...(options.maxTokens != null ? { max_tokens: options.maxTokens } : {}),
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LM Studio HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("LM Studio returned empty content");
  return text;
}

/**
 * claude_pool for the router: /v1/script when the format is supported,
 * /v1/run for free-form prompts. Throws on 503 (offline hours) so the
 * ladder advances — no silent ollama swap like the legacy path.
 */
async function callClaudePoolRouted(
  prompt: string,
  options: LLMTextOptions,
): Promise<string> {
  if (!CLAUDE_POOL_API_KEY) {
    throw new Error("CLAUDE_POOL_API_KEY not configured");
  }
  const timeoutMs = options.timeoutMs ?? 240_000;

  if (
    options.scriptFormat &&
    CLAUDE_POOL_SUPPORTED_FORMATS.has(options.scriptFormat)
  ) {
    return claudePoolScriptRequest(prompt, options.scriptFormat, timeoutMs);
  }

  logger.info(
    { url: `${CLAUDE_POOL_URL}/v1/run`, context: options.context },
    "Calling Claude pool (run)",
  );
  const res = await fetch(`${CLAUDE_POOL_URL}/v1/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": CLAUDE_POOL_API_KEY,
    },
    body: JSON.stringify({
      prompt: withSystem(prompt, options.system),
      timeout_ms: timeoutMs,
    }),
    signal: AbortSignal.timeout(timeoutMs + 5_000),
  });
  if (res.status === 503) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      next_active_at?: string;
    };
    throw new Error(
      `Claude pool offline${body.next_active_at ? ` until ${body.next_active_at}` : ""}: ${body.error ?? "service unavailable"}`,
    );
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude pool error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { text?: string };
  if (!data.text || data.text.trim().length === 0) {
    throw new Error("Claude pool returned empty text");
  }
  return data.text;
}

/**
 * Google Gemini via the direct Generative Language API.
 *
 * Added 2026-08-03 as a WORKING fallback. The ladders previously ended in
 * `ollama`, which is inactive on the VPS — so "all providers failed" was the
 * only possible outcome once the primary hiccuped. Konrad confirmed the Google
 * API keys are available for this use.
 *
 * NOTE this reverses an earlier "Gemini API key phased out" decision. It is
 * deliberate and scoped: Gemini is a FALLBACK rung here, not the primary. The
 * primary script provider remains DeepSeek.
 *
 * Throws with the real status and body on failure — no silent degradation to
 * another provider. The ladder in `generateText` decides what happens next.
 */
async function callGeminiDirect(
  prompt: string,
  timeoutMs: number,
  options: LLMTextOptions,
): Promise<string> {
  const apiKey =
    process.env["GEMINI_DIRECT_API_KEY"] ?? process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    throw new Error("gemini_direct: no API key (GEMINI_DIRECT_API_KEY)");
  }
  const model = process.env["GEMINI_DIRECT_MODEL"] ?? "gemini-2.5-flash";

  logger.info({ model }, "Calling Gemini (direct)");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          ...(options.temperature != null
            ? { temperature: options.temperature }
            : {}),
          ...(options.maxTokens != null
            ? { maxOutputTokens: options.maxTokens }
            : {}),
          ...(options.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };

  const candidate = data.candidates?.[0];

  // Gemma models on this endpoint (gemma-4-31b-it, gemma-4-26b-a4b-it) return
  // their REASONING as its own part before the answer — verified 2026-08-03,
  // where part[0] was "The user wants me to reply with..." and part[1] was the
  // actual reply. Joining every part would splice the model's private thinking
  // into a script that goes straight to TTS. Gemini 2.x/3.x instead keep
  // thinking out of `parts` (they emit a `thoughtSignature`), so a single part
  // is the normal case and this only bites on Gemma.
  //
  // Taking the last non-empty part is correct for both shapes.
  const parts = (candidate?.content?.parts ?? [])
    .map((p) => (p.text ?? "").trim())
    .filter((t) => t.length > 0);
  const text = parts.length > 0 ? parts[parts.length - 1] : undefined;

  // A truncated script is worse than a failed one — it looks like success and
  // ships a half-written video. Surface it so the ladder moves on.
  if (candidate?.finishReason === "MAX_TOKENS") {
    throw new Error(
      `Gemini hit MAX_TOKENS (model ${model}) — output truncated, refusing to return a partial script`,
    );
  }
  if (!text) {
    throw new Error(
      `Gemini returned no text (finishReason: ${candidate?.finishReason ?? "unknown"})`,
    );
  }
  return text;
}

async function claudePoolScriptRequest(
  topic: string,
  format: string,
  timeoutMs: number,
): Promise<string> {
  logger.info(
    { url: `${CLAUDE_POOL_URL}/v1/script`, format },
    "Calling Claude pool (script)",
  );
  const response = await fetch(`${CLAUDE_POOL_URL}/v1/script`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CLAUDE_POOL_API_KEY,
    },
    body: JSON.stringify({ format, topic, target_minutes: 10 }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 503) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      next_active_at?: string;
    };
    throw new Error(
      `Claude pool offline${body.next_active_at ? ` until ${body.next_active_at}` : ""}: ${body.error ?? "service unavailable"}`,
    );
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Claude pool error ${response.status}: ${body.slice(0, 300)}`,
    );
  }
  const data = (await response.json()) as { text: string; word_count: number };
  logger.info({ word_count: data.word_count }, "Claude pool response received");
  return data.text;
}

/** Legacy claude_pool path: /v1/script with silent ollama fallback. */
async function callClaudePoolScript(
  prompt: string,
  options: LLMCallOptions,
): Promise<string> {
  const { timeoutMs = 180_000, scriptFormat } = options;

  if (!CLAUDE_POOL_API_KEY) {
    throw new Error("CLAUDE_POOL_API_KEY not configured");
  }

  if (!scriptFormat || !CLAUDE_POOL_SUPPORTED_FORMATS.has(scriptFormat)) {
    logger.warn(
      { scriptFormat },
      "claude_pool: unsupported or missing format, falling back to ollama",
    );
    return callOllama(prompt, timeoutMs);
  }

  try {
    return await claudePoolScriptRequest(prompt, scriptFormat, timeoutMs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Claude pool offline")) {
      logger.warn(
        { error: message },
        "claude_pool offline, falling back to ollama",
      );
      return callOllama(prompt, timeoutMs);
    }
    throw err;
  }
}

async function callGeminiPool(
  prompt: string,
  timeoutMs: number,
): Promise<string> {
  const geminiPoolUrl =
    process.env["GEMINI_POOL_URL"] ?? "http://127.0.0.1:8090";
  const geminiPoolApiKey = process.env["GEMINI_POOL_API_KEY"] ?? "";

  logger.info(
    { url: `${geminiPoolUrl}/v1/chat`, prompt_length: prompt.length },
    "Calling Gemini pool",
  );

  const response = await fetch(`${geminiPoolUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": geminiPoolApiKey,
    },
    body: JSON.stringify({ prompt }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Gemini pool error ${response.status}: ${body.slice(0, 300)}`,
    );
  }

  const data = (await response.json()) as { text: string; account: string };
  logger.info(
    { account: data.account, response_length: data.text.length },
    "Gemini pool response received",
  );
  return data.text;
}

async function callAnthropic(
  prompt: string,
  options: { maxTokens?: number },
): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });
  const maxTokens = options.maxTokens ?? 8_000;

  logger.info(
    { prompt_length: prompt.length, max_tokens: maxTokens },
    "Calling Anthropic",
  );

  let text = "";
  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });

  for await (const chunk of stream) {
    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "text_delta"
    ) {
      text += chunk.delta.text;
    }
  }

  logger.info({ response_length: text.length }, "Anthropic response received");
  return text;
}

async function callOllama(
  prompt: string,
  timeoutMs: number,
  json?: boolean,
): Promise<string> {
  const ollamaUrl = process.env["OLLAMA_URL"] ?? "http://localhost:11434";
  const ollamaModel = process.env["OLLAMA_MODEL"] ?? "gemma3:4b";

  logger.info(
    {
      url: `${ollamaUrl}/api/generate`,
      model: ollamaModel,
      prompt_length: prompt.length,
    },
    "Calling Ollama",
  );

  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      prompt,
      stream: false,
      ...(json ? { format: "json" } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama error ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as { response: string };
  logger.info(
    { response_length: data.response.length },
    "Ollama response received",
  );
  return data.response;
}
