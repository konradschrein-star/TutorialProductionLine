/**
 * Hub-web copy of the Gemini-pool client. We don't import from
 * worker-orchestrator because that's a separate app, not a package.
 * The behaviour mirrors apps/worker-orchestrator/src/utils/gemini-pool-client.ts
 * — keep the two in sync if you change one.
 */

import { assertGeminiFreeTierModel } from "@repo/config";

const POOL_BASE =
  process.env["GEMINI_POOL_URL"] ??
  "https://hub.schreinercontentsystems.com/gemini";
const POOL_KEY = process.env["GEMINI_POOL_API_KEY"] ?? "";

const DIRECT_API_KEY = process.env["GEMINI_DIRECT_API_KEY"] ?? "";
const DIRECT_MODEL =
  process.env["GEMINI_DIRECT_MODEL"] ?? "gemini-3.1-flash-lite";

const POOL_TRANSIENT =
  /silently aborted|5\d\d|sessions_ready.*0|no ready session|econnreset|etimedout|socket hang up/i;

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
  return data.text;
}

async function callDirect(prompt: string): Promise<string> {
  if (!DIRECT_API_KEY) throw new Error("GEMINI_DIRECT_API_KEY not configured");
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
  if (!text) throw new Error("Gemini direct API returned empty text");
  return text;
}

export async function callGeminiPool(prompt: string): Promise<string> {
  if (DIRECT_API_KEY && process.env["GEMINI_PRIMARY"] === "direct") {
    return callDirect(prompt);
  }
  try {
    return await callPool(prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!DIRECT_API_KEY) throw err;
    if (!POOL_TRANSIENT.test(msg)) throw err;
    return callDirect(prompt);
  }
}
