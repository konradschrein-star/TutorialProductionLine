/**
 * Which voice controls each TTS provider actually honours.
 *
 * Mirrors `createTutorialTTSProvider` in
 * apps/worker-orchestrator/src/utils/tutorial/tts-registry.ts — a control that
 * is not in the returned set is dropped on the floor by the worker, so showing
 * it is an invitation to spend a minute tuning something that has no effect.
 *
 * Lives here rather than inside create.tsx because Settings offers the SAME
 * sliders as job-level defaults and had them all switched on unconditionally:
 * a "Stability (ElevenLabs)" and "Pitch" control on a studio whose only working
 * engine is Fish Audio, which honours speed and nothing else.
 *
 * Unknown provider → show everything (safe default: better a knob that does
 * nothing than a hidden one that would have worked).
 */
export function voiceControlsFor(ttsProviderId: string): Set<string> {
  switch (ttsProviderId) {
    case "fish_audio":
      return new Set(["speed"]);
    case "elevenlabs_official":
      return new Set(["model", "stability", "similarity"]);
    case "ai33_elevenlabs":
      return new Set(["speed", "stability", "similarity"]);
    case "ai33_minimax":
      return new Set(["speed"]);
    case "google_tts":
      return new Set(["speed", "pitch", "volume"]);
    case "minimax_official":
      return new Set(["model", "speed", "pitch", "volume", "language"]);
    case "inworld_tts":
      return new Set(["speed"]);
    default:
      return new Set([
        "model",
        "speed",
        "stability",
        "similarity",
        "pitch",
        "volume",
        "language",
      ]);
  }
}
