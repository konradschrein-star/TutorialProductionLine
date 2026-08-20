/**
 * Gemini-pool client — canonical copy.
 *
 * Replaces the two divergent copies that used to live at
 *   apps/hub-web/src/lib/stock-library/gemini.ts
 *   apps/worker-orchestrator/src/utils/gemini-pool-client.ts
 * Both call sites should migrate to this one.
 *
 * Behaviour: prefer the self-hosted pool at GEMINI_POOL_URL; on transient
 * failure fall back to the direct Google API if GEMINI_DIRECT_API_KEY is
 * set. Setting GEMINI_PRIMARY=direct skips the pool entirely.
 */

import { assertGeminiFreeTierModel } from "@repo/config";

const POOL_TRANSIENT =
  /silently aborted|5\d\d|sessions_ready.*0|no ready session|econnreset|etimedout|socket hang up/i;

function poolBase(): string {
  return (
    process.env["GEMINI_POOL_URL"] ??
    "https://hub.schreinercontentsystems.com/gemini"
  );
}

function poolKey(): string {
  return process.env["GEMINI_POOL_API_KEY"] ?? "";
}

async function callPool(prompt: string): Promise<string> {
  const res = await fetch(`${poolBase()}/v1/chat`, {
    method: "POST",
    headers: {
      "X-Api-Key": poolKey(),
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
  const directKey = process.env["GEMINI_DIRECT_API_KEY"] ?? "";
  const directModel =
    process.env["GEMINI_DIRECT_MODEL"] ?? "gemini-3.1-flash-lite";
  if (!directKey) throw new Error("GEMINI_DIRECT_API_KEY not configured");
  assertGeminiFreeTierModel(directModel); // §2.3: never bill the free key
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${directModel}:generateContent?key=${directKey}`;
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
  const directKey = process.env["GEMINI_DIRECT_API_KEY"] ?? "";
  if (directKey && process.env["GEMINI_PRIMARY"] === "direct") {
    return callDirect(prompt);
  }
  try {
    return await callPool(prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!directKey) throw err;
    if (!POOL_TRANSIENT.test(msg)) throw err;
    return callDirect(prompt);
  }
}
