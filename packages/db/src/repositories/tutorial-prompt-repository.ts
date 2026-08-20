import { eq, desc } from "drizzle-orm";
import { tutorialPromptPresets } from "../schema/tutorial-prompt-presets.js";
import type { DrizzleClient } from "../client.js";

export type TutorialPromptPreset = typeof tutorialPromptPresets.$inferSelect;
export type NewTutorialPromptPreset = typeof tutorialPromptPresets.$inferInsert;

export async function listPromptPresets(
  db: DrizzleClient,
  category?: TutorialPromptPreset["category"],
): Promise<TutorialPromptPreset[]> {
  if (category) {
    return db
      .select()
      .from(tutorialPromptPresets)
      .where(eq(tutorialPromptPresets.category, category))
      .orderBy(desc(tutorialPromptPresets.is_default));
  }
  return db
    .select()
    .from(tutorialPromptPresets)
    .orderBy(desc(tutorialPromptPresets.is_default));
}

export async function createPromptPreset(
  db: DrizzleClient,
  data: NewTutorialPromptPreset,
): Promise<TutorialPromptPreset> {
  const [row] = await db.insert(tutorialPromptPresets).values(data).returning();
  if (!row) throw new Error("Failed to create prompt preset");
  return row;
}

export async function updatePromptPreset(
  db: DrizzleClient,
  id: string,
  data: Partial<Omit<TutorialPromptPreset, "id" | "created_at">>,
): Promise<TutorialPromptPreset> {
  const [row] = await db
    .update(tutorialPromptPresets)
    .set({ ...data, updated_at: new Date() })
    .where(eq(tutorialPromptPresets.id, id))
    .returning();
  if (!row) throw new Error(`Preset ${id} not found`);
  return row;
}

export async function getPromptPresetById(
  db: DrizzleClient,
  id: string,
): Promise<TutorialPromptPreset | undefined> {
  const [row] = await db
    .select()
    .from(tutorialPromptPresets)
    .where(eq(tutorialPromptPresets.id, id))
    .limit(1);
  return row;
}
