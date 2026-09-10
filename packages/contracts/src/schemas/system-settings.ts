import { z } from "zod";

/**
 * System Settings Schemas
 *
 * Operator-editable sections are Storage, Alerts, and Uploader. DELETED:
 * General, Pipeline, AI Services, Rendering, Channels, Security
 * (per-format or dedicated-page concerns, or "nothing to set"). Credentials moved
 * to the ONE secrets area (encrypted_secrets); theme is a cookie, not a setting.
 */

// ─── Storage ────────────────────────────────────────────────────────────────
// Bytes, not megabytes. Default 50 GB (a 500 MB cap was "idiotic" — long videos
// exceed 10 GB). Stored as a JSON number (safe below 2^53 ≈ 9 PB).

export const DEFAULT_MAX_UPLOAD_BYTES = 53_687_091_200; // 50 GiB

export const StorageSettingsSchema = z.object({
  retentionDays: z.number().int().min(1).max(3650).default(90),
  maxUploadBytes: z
    .number()
    .int()
    .min(1)
    .max(1_099_511_627_776) // 1 TiB ceiling
    .default(DEFAULT_MAX_UPLOAD_BYTES),
  driveEnabled: z.boolean().default(false),
  driveRootFolderName: z.string().min(1).max(120).default("Content Forge"),
  driveTutorialsFolderName: z.string().min(1).max(120).default("_Tutorials"),
  driveRequestsPerSecond: z.number().int().min(1).max(20).default(4),
  driveBatchSize: z.number().int().min(1).max(50).default(5),
  driveScanIntervalMinutes: z.number().int().min(1).max(1440).default(5),
  driveLookbackDays: z.number().int().min(0).max(3650).default(14),
  driveMaxAttempts: z.number().int().min(1).max(20).default(5),
  driveDailyBudgetGb: z.number().int().min(1).max(740).default(500),
});

export type StorageSettings = z.infer<typeof StorageSettingsSchema>;

// ─── Alerts (Telegram) ────────────────────────────────────────────────────────
// Replaces the meaningless webhook form. The bot TOKEN lives in the secrets area
// (TELEGRAM_BOT_TOKEN), never here. Send-only; independent of AI-OS fleet_state.

export const AlertsSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  chatId: z.string().min(1).optional(),
  quietHours: z.object({ start: z.string(), end: z.string() }).optional(),
  categories: z
    .object({
      providerDown: z.boolean().default(true),
      credentialExpiry: z.boolean().default(true), // Fish Audio 2026-08-01
      jobFailed: z.boolean().default(true),
      queueStalled: z.boolean().default(true),
      diskPressure: z.boolean().default(true),
    })
    .default({}),
  minSeverity: z.enum(["info", "warn", "error"]).default("warn"),
});

export type AlertsSettings = z.infer<typeof AlertsSettingsSchema>;

// Back-compat alias: the DB column is still `notifications`.
export const NotificationsSettingsSchema = AlertsSettingsSchema;
export type NotificationsSettings = AlertsSettings;

// ── Distribution uploader ───────────────────────────────────────────────────
// Non-secret operator controls for the separate YouTube uploader. Authentication
// material remains in encrypted_secrets; this object is safe to return to the UI.

export const UploaderSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  executionMode: z.enum(["dry_run", "live"]).default("dry_run"),
  transport: z
    .enum(["custom_uploader", "youtube_data_api", "browser_assisted"])
    .default("custom_uploader"),
  dashboardApiUrl: z
    .string()
    .url()
    .default("http://127.0.0.1:8744/uploader-ops/api/v1/jobs"),
  operationsUrl: z.string().min(1).default("/uploader-ops/"),
  callbackPublicUrl: z.string().url().optional(),
  defaultVisibility: z
    .enum(["private", "unlisted", "scheduled"])
    .default("unlisted"),
  timezone: z.string().min(1).max(100).default("Europe/Berlin"),
  scheduleLeadMinutes: z.number().int().min(15).max(43_200).default(120),
  maxConcurrentUploads: z.number().int().min(1).max(3).default(1),
  minMinutesBetweenStarts: z.number().int().min(1).max(1_440).default(10),
  maxUploadsPerDay: z.number().int().min(1).max(100).default(20),
  retryMaxAttempts: z.number().int().min(1).max(10).default(3),
  requireManualRelease: z.boolean().default(true),
});

export type UploaderSettings = z.infer<typeof UploaderSettingsSchema>;

// ─── Section Registry ───────────────────────────────────────────────────────

export const SETTINGS_SECTION_IDS = [
  "storage",
  "notifications",
  "uploader",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export const SETTINGS_SECTIONS: ReadonlyArray<{
  id: SettingsSectionId;
  label: string;
  description: string;
  implemented: boolean;
}> = [
  {
    id: "storage",
    label: "Storage",
    description: "Asset retention and max upload size (enforced)",
    implemented: true,
  },
  {
    id: "notifications",
    label: "Alerts",
    description: "Telegram alerts when something breaks",
    implemented: true,
  },
  {
    id: "uploader",
    label: "Uploader",
    description: "Safe distribution defaults, scheduling and connection",
    implemented: true,
  },
];

/**
 * Get the Zod schema for a given section ID.
 */
export function getSchemaForSection(
  sectionId: SettingsSectionId,
): z.ZodTypeAny {
  switch (sectionId) {
    case "storage":
      return StorageSettingsSchema;
    case "notifications":
      return AlertsSettingsSchema;
    case "uploader":
      return UploaderSettingsSchema;
    default: {
      const _exhaustive: never = sectionId;
      throw new Error(`Unknown settings section: ${_exhaustive}`);
    }
  }
}
