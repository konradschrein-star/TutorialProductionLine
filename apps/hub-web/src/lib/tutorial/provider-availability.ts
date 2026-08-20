import "server-only";
import { db } from "@/lib/db";
import { getSecretPresences } from "@repo/db";
import { TUTORIAL_PROVIDERS, type ProviderMeta } from "@repo/contracts";

/**
 * Which script/TTS engines can actually run right now.
 *
 * ## Why this exists
 *
 * The Create form decided "needs API key" from a `keyMasks` prop that
 * page.tsx passes as a hard-coded `[]`. So the answer was the same every time
 * — every provider with a `secretProvider` and no `envFallback` was labelled
 * unusable — and it was wrong in both directions:
 *
 *   - ElevenLabs and AI33 have working keys in the worker's environment and
 *     were shown as unusable.
 *   - Nothing ever became usable, because nothing writes `keyMasks`.
 *
 * A VA reading that list sees eight voice engines, seven of them apparently
 * broken. This resolves each provider's credential the same way the worker
 * does — `encrypted_secrets` first, then the environment variable — so the
 * form can offer what works and say nothing about what does not.
 *
 * ## Keeping it honest
 *
 * `SECRET_PROVIDER_ENV_NAMES` mirrors the map of the same name in
 * apps/worker-orchestrator/src/processors/tutorial/generate.ts. If a provider
 * gains a key slot there, add it here or the form will hide an engine that
 * works. Presence only — the value is never read here, and a present-but-dead
 * key still looks available (that is what the health badge is for).
 */

/** secretProvider slot → the env-var name(s) that can hold its key. */
const SECRET_PROVIDER_ENV_NAMES: Record<string, string[]> = {
  ai33: ["AI33_API_KEY", "AI33_API_KEY_2"],
  fish_audio: ["FISH_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  minimax_tts: ["MINIMAX_API_KEY"],
  inworld: ["INWORLD_API_KEY"],
  inworld_tts: ["INWORLD_API_KEY"],
  elevenlabs: ["ELEVENLABS_API_KEY"],
  // NOT `GEMINI_API_KEY`. The worker reads the SCRIPT key from
  // `GEMINI_FALLBACK_API_KEY` (llm-registry.ts `googleGemini`), and
  // `GEMINI_API_KEY` is set on this box while `GEMINI_FALLBACK_API_KEY` is
  // not — so mapping to the wrong name offered "Google Gemini" as a working
  // script engine and every job picking it died at the script stage with
  // "google_gemini: no API key". Exactly the class of lie this module exists
  // to stop, which is why the names are checked against the worker and not
  // guessed from the provider id.
  google: ["GEMINI_FALLBACK_API_KEY"],
  google_gemini: ["GEMINI_FALLBACK_API_KEY"],
  google_tts: ["GOOGLE_TTS_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  qwen: ["QWEN_API_KEY"],
};

function envNamesForSlot(slot: string): string[] {
  return SECRET_PROVIDER_ENV_NAMES[slot] ?? [`${slot.toUpperCase()}_API_KEY`];
}

export interface TutorialProviderAvailability {
  /** Provider id → true when a credential for it resolves. */
  llm: Record<string, boolean>;
  tts: Record<string, boolean>;
}

export async function getTutorialProviderAvailability(): Promise<TutorialProviderAvailability> {
  const all = [...TUTORIAL_PROVIDERS.llm, ...TUTORIAL_PROVIDERS.tts];
  const names = new Set<string>();
  for (const p of all) {
    if (p.secretProvider) {
      for (const n of envNamesForSlot(p.secretProvider)) names.add(n);
    }
  }

  let presences: Map<string, { source: string }>;
  try {
    presences = await getSecretPresences(db, [...names]);
  } catch {
    // If the probe itself fails, claim nothing rather than guessing. Every
    // keyed provider reads as unavailable, Fish/DeepSeek (env-fallback) still
    // work, and the form degrades to the engines that need no credential.
    presences = new Map();
  }

  const usable = (p: ProviderMeta): boolean => {
    // Coming-soon providers throw in the worker's factory by design.
    if (p.comingSoon) return false;
    // No credential slot at all (pooled/local engines) → runs on env config.
    if (p.secretProvider === null) return true;
    return envNamesForSlot(p.secretProvider).some(
      (n) => (presences.get(n)?.source ?? "none") !== "none",
    );
  };

  return {
    llm: Object.fromEntries(
      TUTORIAL_PROVIDERS.llm.map((p) => [p.id, usable(p)]),
    ),
    tts: Object.fromEntries(
      TUTORIAL_PROVIDERS.tts.map((p) => [p.id, usable(p)]),
    ),
  };
}
