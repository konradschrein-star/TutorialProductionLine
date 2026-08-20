import { callLLM } from "../llm-client.js";
import { assertGeminiFreeTierModel } from "@repo/config";

export interface GenerateScriptParams {
  provider: string; // LLMProviderId
  prompt: string;
  apiKey: string; // "" for claude_pool / gemini_pool (no per-user key)
  model?: string;
  timeoutMs?: number;
  maxTokens?: number; // LONG_FORM expansion calls raise this
}

function requireKey(apiKey: string, provider: string): string {
  if (!apiKey) throw new Error(`Missing API key for provider "${provider}"`);
  return apiKey;
}

/** Shape of the bits of an OpenAI-style choice we need to police. */
interface ChatChoice {
  message?: { content?: string };
  finish_reason?: string;
}
interface ChatUsage {
  completion_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

/**
 * Reject a response the provider cut off at the token ceiling.
 *
 * WHY THIS EXISTS (2026-07-30). VAs reported tutorial scripts that "cut, no
 * outro" on first generation but came out fine on regenerate. Root cause:
 * `deepseek-v4-pro` is a REASONING model, so `max_tokens` caps
 * `completion_tokens` INCLUDING its reasoning tokens — and that reasoning spend
 * swings wildly run to run (measured on the live API for one identical prompt:
 * 413 tokens on one call, 1671 on the next). Against the old 4096 ceiling the
 * answer got guillotined at whatever length it happened to reach, which is why
 * production held scripts ending "…Then you checked the confirmation and" at 990
 * words and others ending mid-word at 367.
 *
 * Nothing inspected `finish_reason`, so the fragment was returned as a normal
 * success, saved to script_text, sent to TTS and recorded — a silent-truncation
 * fallback of exactly the kind this codebase bans. Throwing instead lets the
 * BullMQ retry re-roll the generation (a fresh, usually shorter chain of
 * thought), which is the same thing the VAs were doing by hand.
 */
function assertNotTruncated(
  provider: string,
  finishReason: string | undefined,
  usage: ChatUsage | undefined,
  maxTokens: number | undefined,
  text: string,
): void {
  if (finishReason !== "length") return;
  const reasoning = usage?.completion_tokens_details?.reasoning_tokens;
  const detail = [
    `provider=${provider}`,
    maxTokens !== undefined ? `max_tokens=${maxTokens}` : null,
    usage?.completion_tokens !== undefined
      ? `completion_tokens=${usage.completion_tokens}`
      : null,
    reasoning !== undefined ? `reasoning_tokens=${reasoning}` : null,
    `chars_returned=${text.length}`,
  ]
    .filter(Boolean)
    .join(" ");
  throw new Error(
    `Script generation was TRUNCATED at the token ceiling (finish_reason=length). ` +
      `${detail}. The script ends mid-sentence and must not be recorded. ` +
      `Ends with: "...${text.trim().slice(-80)}". ` +
      `Retry re-rolls generation; if this repeats, raise maxTokens for this call.`,
  );
}

/**
 * Log WHICH credential source a provider used (per-user vs a worker env var) —
 * never the key itself. A credential fallback is legitimate, but it must be
 * observable (no-silent-fallback rule applied to key selection).
 */
function logKeySource(provider: string, source: string): void {
  console.log(
    JSON.stringify({
      level: "info",
      message: "llm key source",
      provider,
      key_source: source,
    }),
  );
}

const CLAUDE_POOL_URL =
  process.env["CLAUDE_POOL_URL"] ?? "http://127.0.0.1:8092";
const CLAUDE_POOL_API_KEY = process.env["CLAUDE_POOL_API_KEY"] ?? "";

/**
 * Global free Google AI Studio key on the worker. Doubles as:
 *   (a) the *default* key for the `google_gemini` provider when no
 *       per-user encrypted key has been saved in Tutorial Studio settings;
 *   (b) the automatic fallback when `claude_pool` errors out.
 * Leave unset to require a per-user key in settings.
 */
const GEMINI_FALLBACK_API_KEY = process.env["GEMINI_FALLBACK_API_KEY"] ?? "";
const GEMINI_FALLBACK_MODEL =
  process.env["GEMINI_FALLBACK_MODEL"] ?? "gemini-2.5-flash-lite";

const OLLAMA_URL = process.env["OLLAMA_URL"] ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env["OLLAMA_MODEL"] ?? "gemma3:4b";

/**
 * Free-form prompt → text via the self-hosted Claude Code pool (`/v1/run`).
 *
 * Unlike `callLLM(provider: "claude_pool")` (which uses `/v1/script` and
 * needs a registered SupportedFormat), this hits the general-purpose
 * runPrompt endpoint — perfect for tutorial scripts that don't fit any
 * long-form video format.
 */
async function callClaudePoolRun(p: GenerateScriptParams): Promise<string> {
  if (!CLAUDE_POOL_API_KEY) {
    throw new Error(
      "CLAUDE_POOL_API_KEY not configured on the worker — cannot use claude_pool",
    );
  }
  const timeoutMs = p.timeoutMs ?? 240_000;
  const res = await fetch(`${CLAUDE_POOL_URL}/v1/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": CLAUDE_POOL_API_KEY,
    },
    // consumer=tutorial → the pool statically assigns the tutorial account
    // (P1-6). No rotation: on rate-limit the pool 429/503s and this throws.
    body: JSON.stringify({
      prompt: p.prompt,
      timeout_ms: timeoutMs,
      consumer: "tutorial",
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
  if (res.status === 429) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    // Busy/rate-limited: fail VISIBLY so the caller's chain falls to the next
    // rung. We deliberately do NOT rotate to another account here (§1.3).
    throw new Error(
      `Claude pool busy/rate-limited (429): ${body.error ?? "at capacity"}`,
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

async function openaiChat(p: GenerateScriptParams): Promise<string> {
  const key = requireKey(p.apiKey, p.provider);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: p.model ?? "gpt-4o-mini",
      messages: [{ role: "user", content: p.prompt }],
      // maxTokens used to be accepted by the interface and then quietly dropped
      // on every path except deepseek. Honour it, and police the ceiling below.
      ...(p.maxTokens ? { max_tokens: p.maxTokens } : {}),
    }),
    signal: AbortSignal.timeout(p.timeoutMs ?? 120_000),
  });
  if (!res.ok)
    throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    choices: Array<ChatChoice>;
    usage?: ChatUsage;
  };
  const text = json.choices[0]?.message?.content ?? "";
  assertNotTruncated(
    "openai",
    json.choices[0]?.finish_reason,
    json.usage,
    p.maxTokens,
    text,
  );
  return text;
}

/**
 * Direct Google Gemini call via the public REST API. Each invocation is a
 * one-shot, stateless `generateContent` request — no chat session, no
 * context cache, no history. Each tutorial job pays exactly:
 *   input_tokens(prompt) + output_tokens(script)
 * once, and nothing else. Don't add Gemini context caching here unless we
 * have a concrete reason; on tutorial volumes it would only waste tokens.
 */
async function googleGemini(p: GenerateScriptParams): Promise<string> {
  // Prefer per-user decrypted key; fall back to the global free key set on
  // the worker via GEMINI_FALLBACK_API_KEY. This is what makes
  // google_gemini "just work" as the default provider without forcing
  // every admin to paste a key into the Settings UI.
  const key = p.apiKey || GEMINI_FALLBACK_API_KEY;
  if (!key) {
    throw new Error(
      "google_gemini: no API key — set GEMINI_FALLBACK_API_KEY on the worker, or save a per-user key in Tutorial Studio settings",
    );
  }
  logKeySource(
    "google_gemini",
    p.apiKey ? "per-user" : "env:GEMINI_FALLBACK_API_KEY",
  );
  const model = p.model ?? GEMINI_FALLBACK_MODEL;
  // §2.3: p.model is caller-supplied (a Tutorial Studio setting). Reject any
  // paid model (Pro/image/Veo) BEFORE issuing a billable call on the free key.
  assertGeminiFreeTierModel(model);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: p.prompt }] }],
        // Gemini silently ignored maxTokens before, so a caller asking for a
        // long script got the model's default output cap instead.
        ...(p.maxTokens
          ? { generationConfig: { maxOutputTokens: p.maxTokens } }
          : {}),
      }),
      signal: AbortSignal.timeout(p.timeoutMs ?? 120_000),
    },
  );
  if (!res.ok)
    throw new Error(`Google Gemini error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    usageMetadata?: { candidatesTokenCount?: number };
  };
  const text =
    json.candidates?.[0]?.content?.parts?.map((x) => x.text ?? "").join("") ??
    "";
  // Gemini spells the truncation stop "MAX_TOKENS"; normalise to the
  // OpenAI-style "length" the shared guard understands.
  assertNotTruncated(
    "google_gemini",
    json.candidates?.[0]?.finishReason === "MAX_TOKENS" ? "length" : undefined,
    { completion_tokens: json.usageMetadata?.candidatesTokenCount },
    p.maxTokens,
    text,
  );
  return text;
}

const OLLAMA_SYSTEM =
  "You output plain spoken text only. No stage directions, no music cues, no markdown, " +
  "no asterisks, no parentheses with instructions, no headings, no bullet points, no emojis. " +
  "Just the words that will be read aloud. Nothing else.";

async function callOllama(p: GenerateScriptParams): Promise<string> {
  const model = p.model ?? OLLAMA_MODEL;
  const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: OLLAMA_SYSTEM },
        { role: "user", content: p.prompt },
      ],
      stream: false,
    }),
    signal: AbortSignal.timeout(p.timeoutMs ?? 300_000),
  });
  if (!res.ok)
    throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error("Ollama returned empty response");
  return text;
}

// OpenAI-compatible endpoints (Minimax + Qwen/DashScope both expose /chat/completions)
async function openAICompatible(
  p: GenerateScriptParams,
  baseUrl: string,
  defaultModel: string,
): Promise<string> {
  const key = requireKey(p.apiKey, p.provider);
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: p.model ?? defaultModel,
      messages: [{ role: "user", content: p.prompt }],
      ...(p.maxTokens ? { max_tokens: p.maxTokens } : {}),
    }),
    signal: AbortSignal.timeout(p.timeoutMs ?? 120_000),
  });
  if (!res.ok)
    throw new Error(`${p.provider} error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    choices: Array<ChatChoice>;
    usage?: ChatUsage;
  };
  const text = json.choices[0]?.message?.content ?? "";
  assertNotTruncated(
    p.provider,
    json.choices[0]?.finish_reason,
    json.usage,
    p.maxTokens,
    text,
  );
  return text;
}

// SECURITY: the previous default here was a hard-coded DeepSeek API key
// literal committed to source. It is in git history and MUST be rotated (see
// execution report / Secrets agent). The key now comes ONLY from the env var;
// absence throws rather than silently using a compromised literal.
const DEEPSEEK_FALLBACK_API_KEY = process.env["DEEPSEEK_API_KEY"] ?? "";

/**
 * DeepSeek chat completion (OpenAI-compatible /chat/completions).
 * Falls back to the worker env key (DEEPSEEK_API_KEY) when no per-user key
 * is saved in Tutorial Studio settings, so it works out of the box.
 */
async function deepseekChat(p: GenerateScriptParams): Promise<string> {
  const key = p.apiKey || DEEPSEEK_FALLBACK_API_KEY;
  if (!key)
    throw new Error(
      "deepseek: no API key — set DEEPSEEK_API_KEY on the worker or save a per-user key",
    );
  logKeySource("deepseek", p.apiKey ? "per-user" : "env:DEEPSEEK_API_KEY");
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: p.model ?? "deepseek-v4-flash",
      messages: [{ role: "user", content: p.prompt }],
      ...(p.maxTokens ? { max_tokens: p.maxTokens } : {}),
    }),
    // 120_000 was below the floor for this model and failed EVERY script.
    // `deepseek-v4-pro` is a reasoning model: a real ~1,500-word tutorial
    // script measured 137.8s wall-clock (4,564 completion tokens, 1,156 of
    // them reasoning) against the live API. So the call could not finish
    // inside the old 120s budget — both attempts aborted at exactly 120s and
    // every job landed in FAILED_SCRIPT with "The operation was aborted due
    // to timeout". Reasoning spend is not stable (measured 413 vs 1671 on the
    // same prompt — see generate.ts), so this needs real headroom over the
    // observed 138s, not a few seconds. 300s matches the longest-running
    // provider path in this file.
    signal: AbortSignal.timeout(p.timeoutMs ?? 300_000),
  });
  if (!res.ok)
    throw new Error(`deepseek error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    choices: Array<ChatChoice>;
    usage?: ChatUsage;
  };
  const text = json.choices[0]?.message?.content ?? "";
  assertNotTruncated(
    "deepseek",
    json.choices[0]?.finish_reason,
    json.usage,
    p.maxTokens,
    text,
  );
  return text;
}

export async function generateScript(p: GenerateScriptParams): Promise<string> {
  switch (p.provider) {
    case "deepseek":
      return deepseekChat(p);
    case "claude_pool":
      // UN-BYPASSED 2026-07-28 (P1-1). The stale kill-switch that hard-rerouted
      // this to DeepSeek was the exact silent-fallback pattern the project
      // bans. The pool is headless Claude Code over OAuth (P1-0 gate confirms
      // it generates). callClaudePoolRun throws a real diagnostic naming the
      // pool + HTTP status on 429/503/5xx/empty — do NOT wrap it in a
      // swallowing try/catch. If the pool is down the caller's chain falls to
      // the next rung VISIBLY.
      return callClaudePoolRun(p);
    case "gemini_pool":
      return callLLM(p.prompt, {
        provider: "gemini_pool",
        timeoutMs: p.timeoutMs,
      });
    case "google_gemini":
      return googleGemini(p);
    case "openai":
      return openaiChat(p);
    case "minimax_llm":
      return openAICompatible(p, "https://api.minimax.io/v1", "abab6.5s-chat");
    case "qwen_hosted":
      return openAICompatible(
        p,
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        "qwen-plus",
      );
    case "ollama":
      return callOllama(p);
    case "qwen_local":
      throw new Error("qwen_local is coming soon");
    default:
      throw new Error(`Unknown LLM provider: ${p.provider}`);
  }
}
