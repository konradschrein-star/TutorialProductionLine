import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {}, users: {}, channels: {} }));
import { mayUploadOnChannel } from "../delivery-access";
const user = { id: "uploader", role: "UPLOADER_VA", is_active: true, default_tutorial_channel_id: "english" };
const channel = { id: "english", accepts_tutorials: true };
describe("manual uploader channel assignments", () => {
  it("supports legacy saved default only", () => { expect(mayUploadOnChannel(user, channel)).toBe(true); expect(mayUploadOnChannel(user, { ...channel, id: "german" })).toBe(false); });
  it("explicit empty assignment revokes default", () => { expect(mayUploadOnChannel(user, { ...channel, metadata: { tutorialUploaderIds: [] } })).toBe(false); });
  it("supports explicit language channel assignment", () => { expect(mayUploadOnChannel(user, { ...channel, id: "german", metadata: { tutorialUploaderIds: [user.id] } })).toBe(true); });
  it("fails closed for malformed assignment", () => { expect(mayUploadOnChannel(user, { ...channel, metadata: { tutorialUploaderIds: user.id } })).toBe(false); });
  it("inactive users cannot deliver", () => { expect(mayUploadOnChannel({ ...user, is_active: false }, channel)).toBe(false); });
  it("producer role does not gain colleagues work by saved channel", () => { expect(mayUploadOnChannel({ ...user, role: "TUTORIAL_VA" }, channel)).toBe(false); });
});
