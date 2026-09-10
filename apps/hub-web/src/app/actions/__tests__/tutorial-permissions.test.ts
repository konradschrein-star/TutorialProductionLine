import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {}, tutorialPromptPresets: {} }));
vi.mock("@repo/db", () => ({ createPromptPreset: vi.fn(), updatePromptPreset: vi.fn(), updateTutorialSettings: mocks.settings }));
import { updateTutorialSettingsAction } from "../tutorial";
describe("shared workflow configuration", () => {
  it("does not let a producer change global voice or retention settings", async () => {
    mocks.session.mockResolvedValue({ userId: "va", role: "TUTORIAL_VA" });
    expect(await updateTutorialSettingsAction({ default_tts_voice: "changed", retention_hours: 1 })).toMatchObject({ success: false });
    expect(mocks.settings).not.toHaveBeenCalled();
  });
  it("allows admin configuration", async () => {
    mocks.session.mockResolvedValue({ userId: "admin", role: "ADMIN" });
    expect(await updateTutorialSettingsAction({ default_playback_speed: 1.2 })).toEqual({ success: true });
    expect(mocks.settings).toHaveBeenCalledWith({}, expect.objectContaining({ default_playback_speed: "1.2" }));
  });
});
