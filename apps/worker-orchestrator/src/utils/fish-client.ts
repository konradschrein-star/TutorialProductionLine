/**
 * Fish Audio TTS client (https://fish.audio).
 *
 * Shared by the tutorial TTS registry (createTutorialTTSProvider, where Fish is
 * the default voice engine) and the global TTS gateway (where Fish is one of
 * the selectable engines). Calls POST /v1/tts with the free `s2.1-pro-free`
 * model (Fish's S2.1 Pro, currently offered with no usage cap) and returns the
 * raw audio bytes (mp3 by default).
 *
 * The voice is selected by `reference_id` (a 32-hex Fish model id). Pass an
 * empty `voiceId` to use the account's default voice.
 */

export interface FishTTSOptions {
  /** Playback speed 0.5–2.0 (1 = normal). Clamped to range. */
  speed?: number;
  /** Volume adjustment in dB (0 = no change). */
  volumeDb?: number;
  /** Output format. Default mp3. */
  format?: "mp3" | "wav" | "pcm" | "opus";
  /** TTS model. Default s2.1-pro-free (Fish's free S2.1 Pro tier). */
  model?: string;
}

const FISH_API_BASE = process.env["FISH_API_BASE"] ?? "https://api.fish.audio";

export async function generateFishTTS(
  apiKey: string,
  voiceId: string,
  text: string,
  options: FishTTSOptions = {},
): Promise<Buffer> {
  const key = apiKey || process.env["FISH_API_KEY"] || "";
  if (!key) {
    throw new Error(
      "Fish Audio: no API key (set FISH_API_KEY or save a fish_audio secret)",
    );
  }
  const model =
    options.model ?? process.env["FISH_TTS_MODEL"] ?? "s2.1-pro-free";

  const prosody: Record<string, unknown> = { normalize_loudness: true };
  if (options.speed !== undefined) {
    prosody.speed = Math.min(2, Math.max(0.5, options.speed));
  }
  if (options.volumeDb !== undefined) {
    prosody.volume = options.volumeDb;
  }

  const body: Record<string, unknown> = {
    text,
    format: options.format ?? "mp3",
    mp3_bitrate: 128,
    prosody,
  };
  // reference_id selects the voice model; omit for the account default voice.
  if (voiceId) body.reference_id = voiceId;

  const res = await fetch(`${FISH_API_BASE}/v1/tts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      model,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(
      `Fish Audio TTS error ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}
