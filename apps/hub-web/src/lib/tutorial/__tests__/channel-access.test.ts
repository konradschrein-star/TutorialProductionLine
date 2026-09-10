import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {}, users: {}, channels: {} }));
import { mayProduceOnChannel } from "../channel-access";
const user = { id: "va", role: "TUTORIAL_VA", is_active: true, default_tutorial_channel_id: "en" };
const channel = { id: "en", accepts_tutorials: true, is_primary: true };
describe("production channel access", () => {
  it("preserves a migrated saved channel, never any other channel", () => {
    expect(mayProduceOnChannel(user, channel)).toBe(true);
    expect(mayProduceOnChannel(user, { ...channel, id: "other" })).toBe(false);
  });
  it("explicit assignments supersede saved choice and fail closed", () => {
    for (const value of [[], null, "va", ["other"]]) expect(mayProduceOnChannel(user, { ...channel, metadata: { tutorialProducerIds: value } })).toBe(false);
    expect(mayProduceOnChannel(user, { ...channel, id: "other", metadata: { tutorialProducerIds: ["va"] } })).toBe(true);
  });
  it("rejects inactive accounts, nonproducers, secondary and disabled channels", () => {
    expect(mayProduceOnChannel({ ...user, is_active: false }, channel)).toBe(false);
    expect(mayProduceOnChannel({ ...user, role: "VIEWER" }, channel)).toBe(false);
    expect(mayProduceOnChannel(user, { ...channel, is_primary: false })).toBe(false);
    expect(mayProduceOnChannel({ ...user, role: "ADMIN" }, { ...channel, accepts_tutorials: false })).toBe(false);
  });
});
