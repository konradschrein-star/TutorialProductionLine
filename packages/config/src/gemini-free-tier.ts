/**
 * Gemini free-tier guard (Decision §2.3).
 *
 * The Gemini key on this project is a FREE-TIER key, issued specifically so
 * Konrad cannot be billed. Google's free tier covers only Flash / Flash-Lite
 * text + Flash TTS. It NEVER covers Pro, image generation (Nano Banana / Nano
 * Banana Pro), Veo, or Lyria — those bill money and must go through VUP / forge
 * / the media-gateway instead.
 *
 * This module OWNS the key: `geminiFreeTierKey(model)` is the only sanctioned
 * way to obtain it, and it asserts the model is free-tier-eligible BEFORE
 * returning anything. A disallowed model throws — it never returns a key.
 *
 * Two independent gates so a future free-tier "Pro" cannot slip through:
 *   1. an explicit allow-list of known-free model ids, AND
 *   2. a deny-regex for anything Pro / image / veo / lyria.
 * A model must pass BOTH.
 */

export const GEMINI_FREE_TIER_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-flash-preview-tts",
  "text-embedding-004",
] as const;

export type GeminiFreeTierModel = (typeof GEMINI_FREE_TIER_MODELS)[number];

// Anything matching this is billed and must NEVER hit the free-tier key, even if
// it were ever (mistakenly) added to the allow-list above.
const GEMINI_DENY_REGEX = /(pro|image|veo|lyria|imagen|nano-banana)/i;

const ALLOWED = new Set<string>(GEMINI_FREE_TIER_MODELS);

/**
 * Throws unless `model` is a free-tier-eligible Gemini model. Never bills.
 */
export function assertGeminiFreeTierModel(model: string): void {
  const m = (model ?? "").trim();
  if (!m) {
    throw new Error(
      "[gemini-free-tier] no model supplied. Only free-tier models are permitted: " +
        GEMINI_FREE_TIER_MODELS.join(", "),
    );
  }
  if (GEMINI_DENY_REGEX.test(m)) {
    throw new Error(
      `[gemini-free-tier] model '${m}' is a PAID Gemini capability (Pro/image/Veo/Lyria). ` +
        `§2.3 forbids billing this key. Route image/video through the media-gateway (VUP/forge) instead.`,
    );
  }
  if (!ALLOWED.has(m)) {
    throw new Error(
      `[gemini-free-tier] model '${m}' is not on the free-tier allow-list. ` +
        `Permitted: ${GEMINI_FREE_TIER_MODELS.join(", ")}. §2.3: never call a paid Gemini model on this key.`,
    );
  }
}

/** True iff `model` may be called on the free-tier key (no throw). */
export function isGeminiFreeTierModel(model: string): boolean {
  try {
    assertGeminiFreeTierModel(model);
    return true;
  } catch {
    return false;
  }
}

/**
 * The ONLY sanctioned way to obtain the Gemini key. Asserts the model is
 * free-tier-eligible first, then returns the key. Throws (never returns a key)
 * for a disallowed model or when the key is unset.
 *
 * Reads GEMINI_DIRECT_API_KEY first (the direct-call key), then GEMINI_API_KEY.
 * This is the single sanctioned reader of those env vars — lint + a source test
 * forbid reading them anywhere else.
 */
export function geminiFreeTierKey(model: string): string {
  assertGeminiFreeTierModel(model);
  const key =
    process.env["GEMINI_DIRECT_API_KEY"] || process.env["GEMINI_API_KEY"] || "";
  if (!key) {
    throw new Error(
      "[gemini-free-tier] GEMINI key is not set (GEMINI_DIRECT_API_KEY / GEMINI_API_KEY).",
    );
  }
  return key;
}
