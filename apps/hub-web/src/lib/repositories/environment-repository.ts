import { eq, and, desc, inArray } from 'drizzle-orm';
import { db, environments } from '../db';
import type { Environment, NewEnvironment } from '@repo/db';

export type { Environment };

export interface CreateEnvironmentInput {
  name: string;
  description: string;
  archetype_id?: string | null;
  channel_id?: string | null;
  background_asset_id: string;
  prop_asset_ids?: string[];
  spatial_hints?: {
    character_x_percent?: number;
    character_scale?: number;
    safe_zone_right_percent?: number;
  } | null;
  tags?: string[];
}

export async function listEnvironments(filter?: {
  archetype_id?: string;
  channel_id?: string;
  ids?: string[]; // NEW: Filter by specific IDs
}): Promise<Environment[]> {
  const conditions = [];

  // NEW: Filter by IDs (takes precedence over other filters)
  if (filter?.ids && filter.ids.length > 0) {
    conditions.push(inArray(environments.id, filter.ids));
  }

  if (filter?.archetype_id) conditions.push(eq(environments.archetype_id, filter.archetype_id));
  if (filter?.channel_id) conditions.push(eq(environments.channel_id, filter.channel_id));

  const query = db.select().from(environments);
  if (conditions.length > 0) {
    return query.where(and(...conditions)).orderBy(desc(environments.created_at));
  }
  return query.orderBy(desc(environments.created_at));
}

export async function getEnvironmentById(id: string): Promise<Environment | null> {
  const rows = await db.select().from(environments).where(eq(environments.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createEnvironment(data: CreateEnvironmentInput): Promise<Environment> {
  const rows = await db.insert(environments).values(data as NewEnvironment).returning();
  return rows[0]!;
}

export async function updateEnvironment(
  id: string,
  patch: Partial<CreateEnvironmentInput>
): Promise<Environment | null> {
  const rows = await db
    .update(environments)
    .set({ ...patch, updated_at: new Date() })
    .where(eq(environments.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteEnvironment(id: string): Promise<void> {
  await db.delete(environments).where(eq(environments.id, id));
}
