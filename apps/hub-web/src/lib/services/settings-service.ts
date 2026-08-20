import type { z } from "zod";
import type { SettingsSectionId } from "@repo/contracts";
import { getSchemaForSection } from "@repo/contracts";

/**
 * Settings Resolution Service
 *
 * Merges DB values onto env/hardcoded defaults.
 * NULL DB column → schema defaults (which may reflect env vars).
 */

/**
 * Resolve a settings section: parse DB value through Zod schema,
 * filling in defaults for any missing fields.
 * If dbValue is null, returns all defaults from the schema.
 */
export function resolveSection<T>(dbValue: unknown, schema: z.ZodType<T>): T {
  return schema.parse(dbValue ?? {});
}

/**
 * Resolve a section by its ID using the registry.
 */
export function resolveSectionById(
  sectionId: SettingsSectionId,
  dbValue: unknown,
): unknown {
  const schema = getSchemaForSection(sectionId);
  return resolveSection(dbValue, schema);
}

// NOTE: resolveAIKeys / maskAIKeys were DELETED with the ai_services store
// (§2.1 / §3.3). Credentials now live in the ONE secrets area (encrypted_secrets)
// and are read via @repo/db getSecretPresence. See the Settings Credentials card.

/**
 * Mask a sensitive string for display. Shows last 4 characters.
 * Returns empty string if the value is empty/undefined.
 */
export function maskSensitiveValue(value: string | undefined): string {
  if (!value || value.length === 0) return "";
  if (value.length <= 4) return "••••";
  return "••••••••" + value.slice(-4);
}
