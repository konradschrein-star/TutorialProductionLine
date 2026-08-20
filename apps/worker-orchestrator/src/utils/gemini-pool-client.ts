/**
 * Gemini client with fallback chain.
 *
 * 1. Primary: self-hosted Gemini pool (cookie-rotated accounts) at
 *    POST {POOL_BASE}/v1/chat { prompt } → { text, account }
 *
 * 2. Fallback A: fast-gen.ai OpenAI-compatible chat completions
 *    POST https://api.fast-gen.ai/v1/chat/completions (google/gemini-2.5-flash)
 *    Activated when pool fails with a transient error and MEDIA_GEN_API_KEY is set.
 *
 * 3. Fallback B: Google AI Studio direct API (GEMINI_DIRECT_API_KEY).
 *    Only used if fast-gen.ai is also unavailable.
 */

import { assertGeminiFreeTierModel } from "@repo/config";

const POOL_BASE =
  process.env["GEMINI_POOL_URL"] ??
  "https://hub.schreinercontentsystems.com/gemini";
const POOL_KEY = process.env["GEMINI_POOL_API_KEY"] ?? "";

const FASTGEN_API_KEY = process.env["MEDIA_GEN_API_KEY"] ?? "";
const FASTGEN_MODEL =
  process.env["FASTGEN_LLM_MODEL"] ?? "google/gemini-2.5-flash";
const FASTGEN_BASE =
  process.env["MEDIA_GEN_API_URL"] ?? "https://api.fast-gen.ai";

const DIRECT_API_KEY = process.env["GEMINI_DIRECT_API_KEY"] ?? "";
const DIRECT_MODEL =
  process.env["GEMINI_DIRECT_MODEL"] ?? "gemini-3.1-flash-lite";

const POOL_TRANSIENT =
  /silently aborted|5\d\d|429|rate limit|cooling down|sessions_ready.*0|no ready session|econnreset|etimedout|socket hang up|1096/i;

async function callPool(prompt: string): Promise<string> {
  const res = await fetch(`${POOL_BASE}/v1/chat`, {
    method: "POST",
    headers: {
      "X-Api-Key": POOL_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini pool error (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { text: string; account: string };
  console.log(
    JSON.stringify({
      level: "info",
      message: "Gemini pool response received",
      account: data.account,
      response_length: data.text.length,
    }),
  );
  return data.text;
}

async function callFastgen(prompt: string): Promise<string> {
  if (!FASTGEN_API_KEY) {
    throw new Error("MEDIA_GEN_API_KEY not configured");
  }
  const res = await fetch(`${FASTGEN_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "X-API-Key": FASTGEN_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: FASTGEN_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 16_000,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fast-gen.ai error (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) {
    throw new Error(
      `fast-gen.ai returned empty text: ${JSON.stringify(data).slice(0, 300)}`,
    );
  }
  console.log(
    JSON.stringify({
      level: "info",
      message: "fast-gen.ai response received",
      model: FASTGEN_MODEL,
      response_length: text.length,
    }),
  );
  return text;
}

async function callDirect(prompt: string): Promise<string> {
  if (!DIRECT_API_KEY) {
    throw new Error("GEMINI_DIRECT_API_KEY not configured");
  }
  assertGeminiFreeTierModel(DIRECT_MODEL); // §2.3: never bill the free key
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DIRECT_MODEL}:generateContent?key=${DIRECT_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 16_000, temperature: 0.7 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Gemini direct API error (${res.status}): ${body.slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) {
    throw new Error(
      `Gemini direct API returned empty text: ${JSON.stringify(data).slice(0, 300)}`,
    );
  }
  console.log(
    JSON.stringify({
      level: "info",
      message: "Gemini direct API response received",
      model: DIRECT_MODEL,
      response_length: text.length,
    }),
  );
  return text;
}

async function callWithFastgenFallback(
  primary: () => Promise<string>,
  label: string,
  prompt: string,
): Promise<string> {
  try {
    return await primary();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (FASTGEN_API_KEY) {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: `${label} failed, falling back to fast-gen.ai`,
          error: msg.slice(0, 200),
        }),
      );
      return callFastgen(prompt);
    }
    throw err;
  }
}

export async function callGeminiPool(prompt: string): Promise<string> {
  // Explicit overrides
  if (process.env["GEMINI_PRIMARY"] === "fastgen") return callFastgen(prompt);

  if (DIRECT_API_KEY && process.env["GEMINI_PRIMARY"] === "direct") {
    return callWithFastgenFallback(
      () => callDirect(prompt),
      "Gemini direct API",
      prompt,
    );
  }

  // Default: pool → fast-gen.ai → direct
  try {
    return await callPool(prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!POOL_TRANSIENT.test(msg)) throw err;
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "Gemini pool transient failure, trying fast-gen.ai",
        error: msg.slice(0, 200),
      }),
    );
  }

  if (FASTGEN_API_KEY) {
    try {
      return await callFastgen(prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "fast-gen.ai failed, trying direct API",
          error: msg.slice(0, 200),
        }),
      );
    }
  }

  if (DIRECT_API_KEY) return callDirect(prompt);

  throw new Error(
    "All LLM providers failed: pool (transient), fast-gen.ai (unavailable or not configured), direct API (no key)",
  );
}

// LLM-agnostic aliases — both route to the Gemini pool for now.
// When we hook up a better model for scripts, swap callHighQualityLLM's impl here.
export const callHighQualityLLM = callGeminiPool;
export const callLowQualityLLM = callGeminiPool;
