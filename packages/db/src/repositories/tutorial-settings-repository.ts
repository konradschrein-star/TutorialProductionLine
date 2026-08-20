import { eq } from "drizzle-orm";
import { tutorialSettings } from "../schema/tutorial-settings.js";
import type { DrizzleClient } from "../client.js";

export type TutorialSettingsRow = typeof tutorialSettings.$inferSelect;

export async function getTutorialSettings(
  db: DrizzleClient,
): Promise<TutorialSettingsRow> {
  const [row] = await db
    .select()
    .from(tutorialSettings)
    .where(eq(tutorialSettings.id, 1))
    .limit(1);
  if (row) return row;
  const [created] = await db
    .insert(tutorialSettings)
    .values({ id: 1 })
    .returning();
  return created!;
}

export async function updateTutorialSettings(
  db: DrizzleClient,
  data: Partial<Omit<TutorialSettingsRow, "id">>,
): Promise<TutorialSettingsRow> {
  await getTutorialSettings(db); // ensure the singleton row exists
  const [row] = await db
    .update(tutorialSettings)
    .set({ ...data, updated_at: new Date() })
    .where(eq(tutorialSettings.id, 1))
    .returning();
  return row!;
}
