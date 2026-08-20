import { eq, and, or, desc, isNull, isNotNull, sql } from "drizzle-orm";
import {
  db,
  thumbnailArchetypes,
  channelThumbnailArchetypes,
  channelPersonas,
  channelThumbnailProfiles,
  thumbnails,
} from "../db";
import { DEFAULT_CHANNEL_ARCHETYPE_TIER } from "@repo/db";
import type {
  ThumbnailArchetype,
  NewThumbnailArchetype,
  ChannelPersona,
  ChannelThumbnailProfile,
  NewChannelThumbnailProfile,
  Thumbnail,
  ChannelArchetypeTier,
} from "@repo/db";

export type {
  ThumbnailArchetype,
  ChannelPersona,
  ChannelThumbnailProfile,
  Thumbnail,
};

/** "all" = every archetype; "global" = channel_id IS NULL; a uuid = that
 *  channel's own archetypes PLUS all global ones. */
export type ArchetypeScope = "all" | "global" | (string & {});

/**
 * List thumbnail archetypes. Archetypes are GLOBAL by default (channel_id
 * NULL); a channel scope therefore returns global + channel-owned, never
 * channel-owned alone.
 *
 * Ordered by explicit sort_order, then name (numeric-aware so "Tutorial #2"
 * sorts before "Tutorial #10").
 */
export async function listArchetypes(
  opts: { scope?: ArchetypeScope; activeOnly?: boolean } = {},
): Promise<ThumbnailArchetype[]> {
  const filters = [];
  if (opts.activeOnly) filters.push(eq(thumbnailArchetypes.is_active, true));
  if (opts.scope === "global") {
    filters.push(isNull(thumbnailArchetypes.channel_id));
  } else if (opts.scope && opts.scope !== "all") {
    filters.push(
      or(
        isNull(thumbnailArchetypes.channel_id),
        eq(thumbnailArchetypes.channel_id, opts.scope),
      )!,
    );
  }

  const base = db.select().from(thumbnailArchetypes);
  const rows = await (filters.length ? base.where(and(...filters)) : base);
  return rows.sort(
    (a, b) =>
      a.sort_order - b.sort_order ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}

/**
 * Delete an archetype. Generated thumbnails referencing it survive with
 * archetype_id = NULL (FK is ON DELETE SET NULL).
 */
export async function deleteArchetype(id: string): Promise<boolean> {
  const rows = await db
    .delete(thumbnailArchetypes)
    .where(eq(thumbnailArchetypes.id, id))
    .returning({ id: thumbnailArchetypes.id });
  return rows.length > 0;
}

/**
 * Get a single thumbnail archetype by ID.
 */
export async function getArchetype(
  id: string,
): Promise<ThumbnailArchetype | undefined> {
  const [row] = await db
    .select()
    .from(thumbnailArchetypes)
    .where(eq(thumbnailArchetypes.id, id))
    .limit(1);

  return row;
}

/**
 * Create a new thumbnail archetype.
 */
export async function createArchetype(
  data: NewThumbnailArchetype,
): Promise<ThumbnailArchetype> {
  const [row] = await db.insert(thumbnailArchetypes).values(data).returning();

  if (!row) throw new Error("Failed to create thumbnail archetype");

  return row;
}

/**
 * Update a thumbnail archetype's fields.
 * Returns null if no archetype with the given ID exists.
 */
export async function updateArchetype(
  id: string,
  patch: Partial<
    Pick<
      ThumbnailArchetype,
      | "name"
      | "channel_id"
      | "description"
      | "reference_image_path"
      | "extra_reference_paths"
      | "layout_instructions"
      | "base_prompt"
      | "features_logo"
      | "category"
      | "formats"
      | "aspect_ratio"
      | "resolution"
      | "sort_order"
      | "is_active"
    >
  >,
): Promise<ThumbnailArchetype | null> {
  const [updated] = await db
    .update(thumbnailArchetypes)
    .set({ ...patch, updated_at: new Date() })
    .where(eq(thumbnailArchetypes.id, id))
    .returning();

  return updated ?? null;
}

/**
 * List the archetype IDs linked to a channel.
 */
export async function getChannelArchetypeIds(
  channelId: string,
): Promise<string[]> {
  const rows = await db
    .select({ archetype_id: channelThumbnailArchetypes.archetype_id })
    .from(channelThumbnailArchetypes)
    .where(eq(channelThumbnailArchetypes.channel_id, channelId));

  return rows.map((row) => row.archetype_id);
}

/**
 * Replace the archetypes a channel cycles through IN ONE TIER (default 'base').
 *
 * Scoped to the tier on purpose (migration 0068). Deleting every row for the
 * channel — which is what this used to do — would make saving the base cycle
 * from the Studio silently wipe the channel's 'advanced'/'beginner' sets and
 * its primary template, none of which that screen shows.
 *
 * The array ORDER is the cycle order, and `is_primary` survives the rewrite for
 * any archetype that stays in the set.
 */
export async function setChannelArchetypes(
  channelId: string,
  archetypeIds: string[],
  tier: ChannelArchetypeTier = DEFAULT_CHANNEL_ARCHETYPE_TIER,
): Promise<void> {
  const existing = await db
    .select({
      archetype_id: channelThumbnailArchetypes.archetype_id,
      is_primary: channelThumbnailArchetypes.is_primary,
    })
    .from(channelThumbnailArchetypes)
    .where(
      and(
        eq(channelThumbnailArchetypes.channel_id, channelId),
        eq(channelThumbnailArchetypes.tier, tier),
      ),
    );
  const wasPrimary = new Set(
    existing.filter((r) => r.is_primary).map((r) => r.archetype_id),
  );

  await db
    .delete(channelThumbnailArchetypes)
    .where(
      and(
        eq(channelThumbnailArchetypes.channel_id, channelId),
        eq(channelThumbnailArchetypes.tier, tier),
      ),
    );

  if (archetypeIds.length > 0) {
    await db.insert(channelThumbnailArchetypes).values(
      archetypeIds.map((archetype_id, i) => ({
        channel_id: channelId,
        archetype_id,
        tier,
        is_primary: wasPrimary.has(archetype_id),
        sort_order: i,
      })),
    );
  }
}

/**
 * Get a channel's persona (host/mascot), if configured.
 */
export async function getChannelPersona(
  channelId: string,
): Promise<ChannelPersona | undefined> {
  const [row] = await db
    .select()
    .from(channelPersonas)
    .where(eq(channelPersonas.channel_id, channelId))
    .limit(1);

  return row;
}

/**
 * REMOVED (migration 0061) — `channel_personas` is a read-only VIEW over the
 * character library. A channel's host is a character with MANY images; edit it
 * at /characters (POST /api/characters, PUT /api/characters/[id]/channels).
 */
export async function upsertChannelPersona(): Promise<never> {
  throw new Error(
    "channel_personas is a read-only view (migration 0061). Manage the " +
      "channel's host in the Character Library at /characters.",
  );
}

/**
 * Get a channel's thumbnail branding profile, if configured.
 */
export async function getChannelProfile(
  channelId: string,
): Promise<ChannelThumbnailProfile | undefined> {
  const [row] = await db
    .select()
    .from(channelThumbnailProfiles)
    .where(eq(channelThumbnailProfiles.channel_id, channelId))
    .limit(1);

  return row;
}

/**
 * Create or update a channel's thumbnail branding profile.
 */
export async function upsertChannelProfile(
  data: NewChannelThumbnailProfile,
): Promise<ChannelThumbnailProfile> {
  const [row] = await db
    .insert(channelThumbnailProfiles)
    .values(data)
    .onConflictDoUpdate({
      target: channelThumbnailProfiles.channel_id,
      set: { ...data, updated_at: new Date() },
    })
    .returning();

  if (!row) throw new Error("Failed to upsert channel thumbnail profile");

  return row;
}

/**
 * Get a single generated thumbnail by ID.
 */
export async function getThumbnail(id: string): Promise<Thumbnail | undefined> {
  const [row] = await db
    .select()
    .from(thumbnails)
    .where(eq(thumbnails.id, id))
    .limit(1);
  return row;
}

/**
 * List generated thumbnails for a subject, newest first.
 */
export async function listThumbnailsForSubject(
  subjectKind: "content_job" | "tutorial_job" | "studio" | "test",
  subjectId: string,
): Promise<Thumbnail[]> {
  return db
    .select()
    .from(thumbnails)
    .where(
      and(
        eq(thumbnails.subject_kind, subjectKind),
        eq(thumbnails.subject_id, subjectId),
      ),
    )
    .orderBy(desc(thumbnails.created_at));
}

// ── Library ────────────────────────────────────────────────────────────────

export interface ThumbnailLibraryFilter {
  scope?: ArchetypeScope;
  archetypeId?: string;
  /** Only rows with a rendered file — what the reference picker needs. */
  completedOnly?: boolean;
  pinnedOnly?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Newest-first listing of generated thumbnails. Backs both the Studio history
 * view and the "reuse an existing thumbnail as a reference" picker — the
 * operator's explicit ask ("more easily use other thumbnails as references").
 */
export async function listThumbnailLibrary(
  filter: ThumbnailLibraryFilter = {},
): Promise<Thumbnail[]> {
  const filters = [];
  if (filter.scope === "global") {
    filters.push(isNull(thumbnails.channel_id));
  } else if (filter.scope && filter.scope !== "all") {
    filters.push(eq(thumbnails.channel_id, filter.scope));
  }
  if (filter.archetypeId) {
    filters.push(eq(thumbnails.archetype_id, filter.archetypeId));
  }
  if (filter.completedOnly) {
    filters.push(eq(thumbnails.status, "completed"));
    filters.push(isNotNull(thumbnails.output_path));
  }
  if (filter.pinnedOnly) filters.push(eq(thumbnails.is_pinned, true));

  const base = db.select().from(thumbnails);
  const scoped = filters.length ? base.where(and(...filters)) : base;
  return scoped
    .orderBy(desc(thumbnails.created_at))
    .limit(Math.min(filter.limit ?? 60, 200))
    .offset(filter.offset ?? 0);
}

export async function countThumbnails(
  filter: Pick<ThumbnailLibraryFilter, "scope" | "completedOnly"> = {},
): Promise<number> {
  const filters = [];
  if (filter.scope === "global") {
    filters.push(isNull(thumbnails.channel_id));
  } else if (filter.scope && filter.scope !== "all") {
    filters.push(eq(thumbnails.channel_id, filter.scope));
  }
  if (filter.completedOnly) {
    filters.push(eq(thumbnails.status, "completed"));
    filters.push(isNotNull(thumbnails.output_path));
  }
  const base = db.select({ n: sql<number>`count(*)::int` }).from(thumbnails);
  const rows = await (filters.length ? base.where(and(...filters)) : base);
  return rows[0]?.n ?? 0;
}

export async function setThumbnailPinned(
  id: string,
  pinned: boolean,
): Promise<Thumbnail | null> {
  const [row] = await db
    .update(thumbnails)
    .set({ is_pinned: pinned, updated_at: new Date() })
    .where(eq(thumbnails.id, id))
    .returning();
  return row ?? null;
}

export async function deleteThumbnail(id: string): Promise<boolean> {
  const rows = await db
    .delete(thumbnails)
    .where(eq(thumbnails.id, id))
    .returning({ id: thumbnails.id });
  return rows.length > 0;
}
