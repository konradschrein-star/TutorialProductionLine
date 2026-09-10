/** Migration-compatible EN/DE defaults are tts_voices ROW UUIDs, never raw
 * provider voice IDs. Explicit job and active channel choices stay first.
 * No provider invocation, fallback-provider change or environment mutation. */
export interface ConfiguredVoiceRow {
  id: string; provider: string; voice_id: string; language: string; is_active: boolean;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fish = /^[a-f0-9]{32}$/i;
function provider(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ({ fish: "fish_audio", fishaudio: "fish_audio", elevenlabs: "elevenlabs_official",
    eleven_labs: "elevenlabs_official", minimax: "minimax_official", inworld: "inworld_tts",
    ai33: "ai33_elevenlabs", google: "google_tts", openai: "openai_tts" } as Record<string, string>)[normalized] ?? normalized;
}
function language(value?: string | null) {
  const input = (value || "en").trim().toLowerCase();
  return ({ english: "en", german: "de", deutsch: "de" } as Record<string, string>)[input] ?? input.split(/[-_]/)[0]!;
}
function validVoice(providerId: string, value: string) {
  return providerId === "fish_audio" ? fish.test(value) : !!value.trim() && !uuid.test(value);
}
export async function resolveConfiguredTutorialVoice(options: {
  providerId: string; jobProvider: string; jobVoice: string; settingsDefaultVoice: string;
  language?: string | null;
  channelVoice: { provider: string; voice_id: string; language: string } | null;
  env: Record<string, string | undefined>;
  findVoiceRow(id: string): Promise<ConfiguredVoiceRow | null>;
}): Promise<string | null> {
  const code = language(options.language);
  // Narrow parity change only: other languages keep their separate resolver.
  if (code !== "en" && code !== "de") return null;
  const selectedProvider = provider(options.providerId);
  const jobVoice = options.jobVoice.trim();
  if (provider(options.jobProvider) === selectedProvider && jobVoice !== options.settingsDefaultVoice.trim()
    && validVoice(selectedProvider, jobVoice)) return jobVoice;
  const channel = options.channelVoice;
  if (channel && provider(channel.provider) === selectedProvider && validVoice(selectedProvider, channel.voice_id)) {
    if (language(channel.language) !== code) throw new Error("Channel voice language differs from the tutorial. Fix the voice binding before retrying.");
    return channel.voice_id;
  }
  const name = code === "de" ? "DEFAULT_VOICE_DE" : "DEFAULT_VOICE_EN";
  const rowId = options.env[name]?.trim();
  if (!rowId) {
    if (code === "de") throw new Error("No German voice binding or DEFAULT_VOICE_DE row is configured. Refusing an English fallback.");
    return null; // Existing English fallback remains unchanged when unconfigured.
  }
  if (!uuid.test(rowId)) throw new Error(`${name} must identify a tts_voices row UUID, not a provider voice ID.`);
  const row = await options.findVoiceRow(rowId);
  if (!row || row.id.toLowerCase() !== rowId.toLowerCase() || !row.is_active) throw new Error(`${name} must reference an existing active voice row.`);
  if (language(row.language) !== code) throw new Error(`${name} voice row has the wrong language; no voice was substituted.`);
  if (provider(row.provider) !== selectedProvider || !validVoice(selectedProvider, row.voice_id)) {
    throw new Error(`${name} voice row does not match the selected provider or has an invalid voice ID; no provider was substituted.`);
  }
  return row.voice_id;
}
