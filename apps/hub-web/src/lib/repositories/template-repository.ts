import { eq, desc, sql } from "drizzle-orm";
import { db, contentTemplates } from "../db";

/**
 * Template Repository
 *
 * Data access layer for content template operations.
 * Templates define pipeline configuration, prompts, and render settings.
 */

export interface Template {
  id: string;
  name: string;
  description: string | null;
  format: string;
  pipeline_stages: string[];
  prompts: Record<string, any>;
  render_config: Record<string, any>;
  required_assets: string[];
  supports_character_tracking: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TemplateWithJobCount extends Template {
  job_count: number;
}

/**
 * List all templates with job counts
 *
 * @returns Array of templates with job counts
 */
export async function listTemplates(): Promise<TemplateWithJobCount[]> {
  const result = await db
    .select({
      template: contentTemplates,
      job_count: sql<number>`cast(count(cj.id) as integer)`,
    })
    .from(contentTemplates)
    .leftJoin(
      sql`content_jobs cj`,
      sql`${contentTemplates.id} = cj.template_id`,
    )
    .groupBy(contentTemplates.id)
    .orderBy(desc(contentTemplates.updated_at));

  return result.map((row) => ({
    ...row.template,
    job_count: row.job_count || 0,
  }));
}

/**
 * Get a single template by ID
 *
 * @param id - Template ID
 * @returns Template or null if not found
 */
export async function getTemplateById(id: string): Promise<Template | null> {
  const result = await db
    .select()
    .from(contentTemplates)
    .where(eq(contentTemplates.id, id))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

/**
 * Create a new template
 *
 * @param data - Template data
 * @returns Created template
 */
export async function createTemplate(data: {
  name: string;
  description?: string;
  format: string;
  pipeline_stages: string[];
  prompts: Record<string, any>;
  render_config: Record<string, any>;
  required_assets: string[];
}): Promise<Template> {
  const insertData: any = {
    name: data.name,
    description: data.description || null,
    format: data.format,
    pipeline_stages: data.pipeline_stages,
    prompts: data.prompts,
    render_config: data.render_config,
    required_assets: data.required_assets,
    is_active: true,
  };

  const result = await db
    .insert(contentTemplates)
    .values(insertData)
    .returning();

  return result[0];
}

/**
 * Update an existing template
 *
 * @param id - Template ID
 * @param data - Updated template data
 * @returns Updated template
 */
export async function updateTemplate(
  id: string,
  data: Partial<{
    name: string;
    description: string | null;
    format: string;
    pipeline_stages: string[];
    prompts: Record<string, any>;
    render_config: Record<string, any>;
    required_assets: string[];
    supports_character_tracking: boolean;
  }>,
): Promise<Template | null> {
  const updateData: any = {
    ...data,
    updated_at: new Date(),
  };

  const result = await db
    .update(contentTemplates)
    .set(updateData)
    .where(eq(contentTemplates.id, id))
    .returning();

  return result.length > 0 ? result[0] : null;
}

/**
 * Toggle template active status
 *
 * @param id - Template ID
 * @param is_active - New active status
 * @returns Updated template
 */
export async function toggleTemplateActive(
  id: string,
  is_active: boolean,
): Promise<Template | null> {
  const result = await db
    .update(contentTemplates)
    .set({
      is_active,
      updated_at: new Date(),
    })
    .where(eq(contentTemplates.id, id))
    .returning();

  return result.length > 0 ? result[0] : null;
}
