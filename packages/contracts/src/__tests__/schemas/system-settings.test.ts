import { describe, it, expect } from "vitest";
import {
  StorageSettingsSchema,
  AlertsSettingsSchema,
  NotificationsSettingsSchema,
  SETTINGS_SECTION_IDS,
  getSchemaForSection,
  DEFAULT_MAX_UPLOAD_BYTES,
} from "../../schemas/system-settings.js";

describe("system-settings (reworked §3.3)", () => {
  it("only Storage + Alerts sections survive", () => {
    expect([...SETTINGS_SECTION_IDS].sort()).toEqual(
      ["notifications", "storage"].sort(),
    );
  });

  it("Storage defaults to 50 GB in BYTES (not the old 500 MB)", () => {
    const s = StorageSettingsSchema.parse({});
    expect(s.maxUploadBytes).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    expect(s.maxUploadBytes).toBe(53_687_091_200);
    expect(s.retentionDays).toBe(90);
  });

  it("Storage rejects a zero/negative upload size", () => {
    expect(StorageSettingsSchema.safeParse({ maxUploadBytes: 0 }).success).toBe(
      false,
    );
  });

  it("Alerts schema defaults are sane (Telegram, send-only)", () => {
    const a = AlertsSettingsSchema.parse({});
    expect(a.enabled).toBe(true);
    expect(a.minSeverity).toBe("warn");
    expect(a.categories.credentialExpiry).toBe(true);
  });

  it("NotificationsSettingsSchema aliases AlertsSettingsSchema", () => {
    expect(NotificationsSettingsSchema).toBe(AlertsSettingsSchema);
  });

  it("getSchemaForSection resolves both surviving ids", () => {
    expect(getSchemaForSection("storage")).toBe(StorageSettingsSchema);
    expect(getSchemaForSection("notifications")).toBe(AlertsSettingsSchema);
  });
});
