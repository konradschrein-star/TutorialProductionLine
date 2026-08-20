/**
 * Template Repository
 *
 * Data access layer for content_templates table.
 * Templates define format-specific configuration, prompts, and render settings.
 */

import { eq, and } from "drizzle-orm";
import { contentTemplates } from "../schema/content-templates.js";
import type { Transaction } from "./transaction.js";
import { getDbOrTx } from "./transaction.js";
import type { ContentFormat } from "@repo/contracts";

// Type for inserting a new template
export type NewTemplate = typeof contentTemplates.$inferInsert;

// Type for a complete template record
export type Template = typeof contentTemplates.$inferSelect;

// Type for updating a template
export type TemplateUpdate = Partial<Omit<Template, "id" | "created_at">>;

/**
 * Get template by ID
 *
 * @param id - Template ID
 * @param tx - Optional transaction
 * @returns Template or null if not found
 */
export async function getTemplateById(
  id: string,
  tx?: Transaction
): Promise<Template | null> {
  const db = getDbOrTx(tx);

  const [template] = await db
    .select()
    .from(contentTemplates)
    .where(eq(contentTemplates.id, id))
    .limit(1);

  return template || null;
}

/**
 * Get template by name
 *
 * @param name - Template name
 * @param tx - Optional transaction
 * @returns Template or null if not found
 */
export async function getTemplateByName(
  name: string,
  tx?: Transaction
): Promise<Template | null> {
  const db = getDbOrTx(tx);

  const [template] = await db
    .select()
    .from(contentTemplates)
    .where(eq(contentTemplates.name, name))
    .limit(1);

  return template || null;
}

/**
 * Get templates by format
 *
 * @param format - Content format
 * @param tx - Optional transaction
 * @returns Array of templates
 */
export async function getTemplatesByFormat(
  format: ContentFormat,
  tx?: Transaction
): Promise<Template[]> {
  const db = getDbOrTx(tx);

  return await db
    .select()
    .from(contentTemplates)
    .where(eq(contentTemplates.format, format));
}

/**
 * Get all active templates
 *
 * @param tx - Optional transaction
 * @returns Array of active templates
 */
export async function getActiveTemplates(
  tx?: Transaction
): Promise<Template[]> {
  const db = getDbOrTx(tx);

  return await db
    .select()
    .from(contentTemplates)
    .where(eq(contentTemplates.is_active, true));
}

/**
 * Create a new template
 *
 * @param data - Template data to insert
 * @param tx - Optional transaction
 * @returns Created template
 */
export async function createTemplate(
  data: NewTemplate,
  tx?: Transaction
): Promise<Template> {
  const db = getDbOrTx(tx);

  const [template] = await db
    .insert(contentTemplates)
    .values(data)
    .returning();

  if (!template) {
    throw new Error("Failed to create template");
  }

  return template;
}

/**
 * Update template by ID
 *
 * @param id - Template ID
 * @param data - Fields to update
 * @param tx - Optional transaction
 * @returns Updated template
 */
export async function updateTemplate(
  id: string,
  data: TemplateUpdate,
  tx?: Transaction
): Promise<Template> {
  const db = getDbOrTx(tx);

  const [template] = await db
    .update(contentTemplates)
    .set({
      ...data,
      updated_at: new Date(),
    })
    .where(eq(contentTemplates.id, id))
    .returning();

  if (!template) {
    throw new Error(`Template ${id} not found`);
  }

  return template;
}

/**
 * Delete template by ID
 *
 * @param id - Template ID
 * @param tx - Optional transaction
 */
export async function deleteTemplate(
  id: string,
  tx?: Transaction
): Promise<void> {
  const db = getDbOrTx(tx);

  await db.delete(contentTemplates).where(eq(contentTemplates.id, id));
}

/**
 * Toggle template active status
 *
 * @param id - Template ID
 * @param isActive - New active status
 * @param tx - Optional transaction
 * @returns Updated template
 */
export async function setTemplateActive(
  id: string,
  isActive: boolean,
  tx?: Transaction
): Promise<Template> {
  return await updateTemplate(
    id,
    { is_active: isActive },
    tx
  );
}
