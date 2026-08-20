import { z } from "zod";

/**
 * System Settings Schemas
 *
 * Reworked (§3.3): only two sections survive as stored settings — Storage and
 * Alerts. DELETED: General, Pipeline, AI Services, Rendering, Channels, Security
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

// ─── Section Registry ───────────────────────────────────────────────────────

export const SETTINGS_SECTION_IDS = ["storage", "notifications"] as const;

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
    default: {
      const _exhaustive: never = sectionId;
      throw new Error(`Unknown settings section: ${_exhaustive}`);
    }
  }
}
