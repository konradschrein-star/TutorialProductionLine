import { describe, expect, it, vi } from "vitest";
import { resolveConfiguredTutorialVoice, type ConfiguredVoiceRow } from "../configured-voice-default.js";
const id = "11111111-1111-4111-8111-111111111111";
const voice = "a".repeat(32), explicit = "b".repeat(32), channelVoice = "c".repeat(32);
function fixture(language = "en") {
  const row: ConfiguredVoiceRow = { id, provider: "Fish", voice_id: voice, language, is_active: true };
  return { row, input: { providerId: "fish_audio", jobProvider: "fish_audio", jobVoice: "settings-default", settingsDefaultVoice: "settings-default",
    language, channelVoice: null as { provider: string; voice_id: string; language: string } | null,
    env: { DEFAULT_VOICE_EN: id, DEFAULT_VOICE_DE: id }, findVoiceRow: vi.fn(async () => row as ConfiguredVoiceRow | null) } };
}
describe("configured tutorial voice default migration", () => {
  it.each(["en", "English", "de", "German", "de-DE", "Deutsch"])("resolves %s row UUID to provider voice bytes", async language => {
    const { input } = fixture(language.startsWith("en") || language === "English" ? "en" : "de");
    input.language = language;
    expect(await resolveConfiguredTutorialVoice(input)).toBe(voice);
    expect(input.findVoiceRow).toHaveBeenCalledWith(id);
  });
  it("preserves explicit valid job voice without consulting malformed defaults", async () => {
    const { input } = fixture(); input.jobVoice = explicit; input.env.DEFAULT_VOICE_EN = "invalid";
    expect(await resolveConfiguredTutorialVoice(input)).toBe(explicit); expect(input.findVoiceRow).not.toHaveBeenCalled();
  });
  it("preserves channel voice above env defaults and settings-default job value", async () => {
    const { input } = fixture(); input.channelVoice = { provider: "Fish", voice_id: channelVoice, language: "en" };
    expect(await resolveConfiguredTutorialVoice(input)).toBe(channelVoice); expect(input.findVoiceRow).not.toHaveBeenCalled();
  });
  it("explicit job wins over channel", async () => {
    const { input } = fixture(); input.jobVoice = explicit; input.channelVoice = { provider: "Fish", voice_id: channelVoice, language: "en" };
    expect(await resolveConfiguredTutorialVoice(input)).toBe(explicit);
  });
  it("does not mistake a settings-default Fish ID for an explicit override", async () => {
    const { input } = fixture(); input.jobVoice = explicit; input.settingsDefaultVoice = explicit;
    expect(await resolveConfiguredTutorialVoice(input)).toBe(voice);
  });
  it("keeps legacy English fallback when env default is absent", async () => {
    const { input } = fixture(); input.env.DEFAULT_VOICE_EN = "";
    expect(await resolveConfiguredTutorialVoice(input)).toBeNull();
  });
  it("never uses English default for missing German configuration", async () => {
    const { input } = fixture("de"); input.env.DEFAULT_VOICE_DE = "";
    await expect(resolveConfiguredTutorialVoice(input)).rejects.toThrow("Refusing an English fallback");
  });
  it("resolves an inherited-source translation through the German row instead of treating the source as explicit", async () => {
    const { input } = fixture("de"); input.jobVoice = ""; input.settingsDefaultVoice = "";
    expect(await resolveConfiguredTutorialVoice(input)).toBe(voice);
  });
  it("does not send the primary provider voice to a different fallback provider", async () => {
    const { input } = fixture("de"); input.jobVoice = explicit; input.providerId = "ai33_minimax";
    await expect(resolveConfiguredTutorialVoice(input)).rejects.toThrow("selected provider");
  });
  it.each(["inactive", "wrong-language", "wrong-provider", "invalid-voice", "banned-provider", "missing"])("fails closed for %s row", async problem => {
    const { input, row } = fixture();
    if (problem === "inactive") row.is_active = false;
    if (problem === "wrong-language") row.language = "de";
    if (problem === "wrong-provider") row.provider = "ElevenLabs";
    if (problem === "invalid-voice") row.voice_id = "not-fish";
    if (problem === "banned-provider") row.provider = "EDGE_TTS";
    if (problem === "missing") input.findVoiceRow.mockResolvedValue(null);
    await expect(resolveConfiguredTutorialVoice(input)).rejects.toThrow();
  });
  it("rejects raw provider voice IDs in DEFAULT_VOICE variables", async () => {
    const { input } = fixture(); input.env.DEFAULT_VOICE_EN = voice;
    await expect(resolveConfiguredTutorialVoice(input)).rejects.toThrow("row UUID"); expect(input.findVoiceRow).not.toHaveBeenCalled();
  });
  it("rejects wrong-language channel bindings rather than silently substituting", async () => {
    const { input } = fixture("de"); input.channelVoice = { provider: "Fish", voice_id: channelVoice, language: "en" };
    await expect(resolveConfiguredTutorialVoice(input)).rejects.toThrow("Channel voice language");
  });
  it("supports a matching explicitly selected ElevenLabs row without changing provider", async () => {
    const { input, row } = fixture(); input.providerId = input.jobProvider = "elevenlabs_official";
    row.provider = "ElevenLabs"; row.voice_id = "eleven-provider-voice";
    expect(await resolveConfiguredTutorialVoice(input)).toBe("eleven-provider-voice");
  });
  it("does not claim new fallback behavior for other locales", async () => {
    const { input } = fixture("fr"); expect(await resolveConfiguredTutorialVoice(input)).toBeNull();
    expect(input.findVoiceRow).not.toHaveBeenCalled();
  });
});
