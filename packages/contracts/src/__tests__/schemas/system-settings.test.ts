import { describe, it, expect } from "vitest";
import {
  StorageSettingsSchema,
  AlertsSettingsSchema,
  NotificationsSettingsSchema,
  UploaderSettingsSchema,
  SETTINGS_SECTION_IDS,
  getSchemaForSection,
  DEFAULT_MAX_UPLOAD_BYTES,
} from "../../schemas/system-settings.js";

describe("system-settings (reworked §3.3)", () => {
  it("exposes the three operator-configurable sections", () => {
    expect([...SETTINGS_SECTION_IDS].sort()).toEqual(
      ["notifications", "storage", "uploader"].sort(),
    );
  });

  it("Storage defaults to 50 GB in BYTES (not the old 500 MB)", () => {
    const s = StorageSettingsSchema.parse({});
    expect(s.maxUploadBytes).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    expect(s.maxUploadBytes).toBe(53_687_091_200);
    expect(s.retentionDays).toBe(90);
    expect(s.driveEnabled).toBe(false);
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

  it("Uploader defaults to a non-executing safe state", () => {
    const uploader = UploaderSettingsSchema.parse({});
    expect(uploader.enabled).toBe(false);
    expect(uploader.executionMode).toBe("dry_run");
    expect(uploader.requireManualRelease).toBe(true);
    expect(uploader.maxConcurrentUploads).toBe(1);
  });

  it("getSchemaForSection resolves every operator section", () => {
    expect(getSchemaForSection("storage")).toBe(StorageSettingsSchema);
    expect(getSchemaForSection("notifications")).toBe(AlertsSettingsSchema);
    expect(getSchemaForSection("uploader")).toBe(UploaderSettingsSchema);
  });
});
