import { eq, desc } from 'drizzle-orm';
import { db, archetypes } from '../db';
import type { Archetype, NewArchetype } from '@repo/db';

export type { Archetype };

export interface CreateArchetypeInput {
  name: string;
  description?: string | null;
  style_prefix?: string | null;
  style_suffix?: string | null;
  image_style?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown> | null;
  is_active?: boolean;
}

export async function listArchetypes(activeOnly = false): Promise<Archetype[]> {
  const query = db.select().from(archetypes);
  if (activeOnly) {
    return query.where(eq(archetypes.is_active, true)).orderBy(desc(archetypes.created_at));
  }
  return query.orderBy(desc(archetypes.created_at));
}

export async function getArchetypeById(id: string): Promise<Archetype | null> {
  const rows = await db.select().from(archetypes).where(eq(archetypes.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getArchetypeByName(name: string): Promise<Archetype | null> {
  const rows = await db.select().from(archetypes).where(eq(archetypes.name, name)).limit(1);
  return rows[0] ?? null;
}

export async function createArchetype(data: CreateArchetypeInput): Promise<Archetype> {
  const rows = await db.insert(archetypes).values(data as NewArchetype).returning();
  return rows[0]!;
}

export async function updateArchetype(
  id: string,
  patch: Partial<CreateArchetypeInput>
): Promise<Archetype | null> {
  const rows = await db
    .update(archetypes)
    .set({ ...patch, updated_at: new Date() })
    .where(eq(archetypes.id, id))
    .returning();
  return rows[0] ?? null;
}
