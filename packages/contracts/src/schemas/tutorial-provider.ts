import { z } from "zod";

export const LLMProviderId = z.enum([
  "deepseek", // the real default — DeepSeek V4 (Pro/Flash)
  "claude_pool", // kept for back-compat: existing jobs + worker reroute → deepseek
  "gemini_pool",
  "google_gemini",
  "minimax_llm",
  "openai",
  "qwen_hosted",
  "qwen_local", // coming soon
  "ollama",
]);
export type LLMProviderId = z.infer<typeof LLMProviderId>;

export const TTSProviderId = z.enum([
  "ai33_elevenlabs",
  "ai33_minimax",
  "google_tts",
  "elevenlabs_official",
  "minimax_official",
  "inworld_tts",
  "fish_audio",
  "qwen3_local", // coming soon
]);
export type TTSProviderId = z.infer<typeof TTSProviderId>;

export interface ProviderModel {
  value: string;
  label: string;
  isDefault?: boolean;
}

export interface ProviderMeta {
  id: string;
  label: string;
  /** maps to encrypted_secrets.provider key; null if no key needed (e.g. gemini_pool uses env) */
  secretProvider: string | null;
  /**
   * True when the worker has a built-in env key (e.g. DEEPSEEK_API_KEY / FISH_API_KEY /
   * gemini pool env), so the provider works out of the box even with no per-user secret saved.
   * The Create UI uses this + the saved key masks to decide what to gray out as "needs API key".
   */
  envFallback?: boolean;
  /** Selectable sub-models for this provider (e.g. DeepSeek V4 Pro / Flash). */
  models?: ProviderModel[];
  unreliable?: boolean;
  comingSoon?: boolean;
  isDefault?: boolean;
  mostStable?: boolean;
}

export const TUTORIAL_PROVIDERS: {
  llm: ProviderMeta[];
  tts: ProviderMeta[];
} = {
  llm: [
    {
      // The actual script engine. Claude's pool sub expired 2026-06-29, so the
      // worker has been running DeepSeek all along — this now says so honestly.
      id: "deepseek",
      label: "DeepSeek V4 (recommended)",
      secretProvider: "deepseek",
      envFallback: true,
      isDefault: true,
      models: [
        {
          value: "deepseek-v4-flash",
          label: "DeepSeek V4 Flash (faster, cheaper)",
          isDefault: true,
        },
        {
          value: "deepseek-v4-pro",
          label: "DeepSeek V4 Pro (best quality)",
        },
      ],
    },
    {
      id: "google_gemini",
      label: "Google Gemini (fast, cheap)",
      secretProvider: "google_gemini",
    },
    {
      id: "gemini_pool",
      label: "Gemini Pool (free, can be unreliable)",
      secretProvider: null,
      envFallback: true,
      unreliable: true,
    },
    { id: "minimax_llm", label: "Minimax", secretProvider: "minimax" },
    { id: "openai", label: "OpenAI", secretProvider: "openai" },
    { id: "qwen_hosted", label: "Qwen 3 (hosted)", secretProvider: "qwen" },
    {
      id: "ollama",
      label: "Gemma 3 4B (local fallback only)",
      secretProvider: null,
      envFallback: true,
      unreliable: true,
    },
    {
      id: "qwen_local",
      label: "Qwen 3 (local)",
      secretProvider: null,
      comingSoon: true,
    },
  ],
  tts: [
    {
      id: "fish_audio",
      label: "Fish Audio (S2-Pro) — new standard",
      // Worker falls back to FISH_API_KEY (env on worker-orchestrator) when no
      // per-user encrypted key is saved, so this "just works" out of the box.
      secretProvider: "fish_audio",
      envFallback: true,
      mostStable: true,
      isDefault: true,
    },
    {
      id: "ai33_minimax",
      label: "Minimax (via AI33)",
      secretProvider: "ai33",
    },
    {
      id: "ai33_elevenlabs",
      label: "ElevenLabs / Kokoro (via AI33)",
      secretProvider: "ai33",
      unreliable: true,
    },
    {
      id: "google_tts",
      label: "Google Text-to-Speech",
      secretProvider: "google_tts",
    },
    {
      id: "elevenlabs_official",
      label: "ElevenLabs (official)",
      secretProvider: "elevenlabs",
    },
    {
      id: "minimax_official",
      label: "Minimax (official)",
      secretProvider: "minimax_tts",
    },
    {
      id: "inworld_tts",
      label: "Inworld TTS",
      secretProvider: "inworld_tts",
    },
    {
      id: "qwen3_local",
      label: "Qwen 3 (local)",
      secretProvider: null,
      comingSoon: true,
    },
  ],
};
