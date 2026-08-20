import { eq, sql } from "drizzle-orm";
import { db, systemSettings } from "../db";
import type { SettingsSectionId } from "@repo/contracts";

/**
 * Settings Repository
 *
 * Data access layer for the system_settings singleton table.
 * Each JSONB column represents one settings section.
 */

/**
 * Fetch the full singleton settings row.
 * Returns null if the table doesn't exist yet (pre-migration).
 */
export async function getSettings() {
  try {
    const rows = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.id, "singleton"))
      .limit(1);

    return rows[0] ?? null;
  } catch (error: unknown) {
    // Table may not exist yet if migration hasn't run
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('relation "system_settings" does not exist')) {
      console.warn(
        "[settings-repository] system_settings table does not exist yet. Run migration 0004.",
      );
      return null;
    }
    throw error;
  }
}

/**
 * Fetch a single settings section by column name.
 */
export async function getSection(
  sectionId: SettingsSectionId,
): Promise<unknown> {
  const row = await getSettings();
  if (!row) return null;

  const columnMap: Record<SettingsSectionId, keyof typeof row> = {
    storage: "storage",
    notifications: "notifications",
  };

  return row[columnMap[sectionId]] ?? null;
}

/**
 * Update a single settings section.
 * Auto-creates the singleton row if it doesn't exist yet.
 */
export async function updateSection(
  sectionId: SettingsSectionId,
  data: unknown,
  userId: string,
): Promise<void> {
  const columnMap: Record<SettingsSectionId, string> = {
    storage: "storage",
    notifications: "notifications",
  };

  const columnName = columnMap[sectionId];

  // Ensure the singleton row exists before updating
  await ensureSingletonExists();

  await db.execute(
    sql`UPDATE system_settings SET ${sql.identifier(columnName)} = ${JSON.stringify(data)}::jsonb, updated_at = now(), updated_by = ${userId} WHERE id = 'singleton'`,
  );
}

/**
 * Ensure the singleton row exists (safe to call multiple times).
 */
export async function ensureSingletonExists(): Promise<void> {
  await db.execute(
    sql`INSERT INTO system_settings (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING`,
  );
}
