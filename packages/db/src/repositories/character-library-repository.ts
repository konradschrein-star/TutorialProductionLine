/**
 * Character Library repository — the SINGLE source of truth for "who is the
 * human that appears on this channel".
 *
 * Replaces the `channel_personas` table (migration 0061), which held one image
 * per channel and could silently disagree with `characters`. `channel_personas`
 * is now a read-only VIEW over exactly the data this module reads.
 *
 * The load-bearing function is `resolveChannelHost`: it returns the channel's
 * host character together with ALL of its images, in a stable order, so the
 * caller can cycle deterministically.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import type { DrizzleClient } from "../client.js";
import {
  characters,
  characterImages,
  characterChannels,
} from "../schema/characters.js";
import type {
  Character,
  CharacterImage,
  NewCharacter,
  NewCharacterImage,
} from "../schema/characters.js";

export interface ChannelHost {
  character: Character;
  /** Ordered by (sort_order, created_at, id) — the cycle order. NEVER empty. */
  images: CharacterImage[];
}

export interface CharacterWithImages extends Character {
  images: CharacterImage[];
  channel_ids: string[];
}

/**
 * Fetch a character's active images in the canonical cycle order.
 *
 * The ORDER IS PART OF THE CONTRACT: the deterministic picker indexes into this
 * array, so a wobbly sort would mean the same job silently resolves to a
 * different face on a re-run.
 */
export async function listCharacterImages(
  db: DrizzleClient,
  characterId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<CharacterImage[]> {
  const where =
    opts.activeOnly === false
      ? eq(characterImages.character_id, characterId)
      : and(
          eq(characterImages.character_id, characterId),
          eq(characterImages.is_active, true),
        );
  return db
    .select()
    .from(characterImages)
    .where(where)
    .orderBy(
      asc(characterImages.sort_order),
      asc(characterImages.created_at),
      asc(characterImages.id),
    );
}

/**
 * The channel's on-camera host, with every image it can be rendered as.
 *
 * Returns undefined when the channel has no host bound — the caller must treat
 * that as "no persona", NOT as an excuse to invent one. Returns undefined when
 * the host exists but has zero usable images too: a host with no reference image
 * cannot be put on a thumbnail, and pretending otherwise is the synthetic
 * fallback this codebase forbids.
 */
export async function resolveChannelHost(
  db: DrizzleClient,
  channelId: string,
): Promise<ChannelHost | undefined> {
  const [row] = await db
    .select({ character: characters })
    .from(characterChannels)
    .innerJoin(characters, eq(characters.id, characterChannels.character_id))
    .where(
      and(
        eq(characterChannels.channel_id, channelId),
        eq(characterChannels.role, "host"),
        eq(characterChannels.is_primary, true),
        eq(characters.is_active, true),
      ),
    )
    .limit(1);
  if (!row) return undefined;

  const images = await listCharacterImages(db, row.character.id);
  if (images.length === 0) return undefined;
  return { character: row.character, images };
}

/** Every character bound to a channel in any role (Library UI, pickers). */
export async function listCharactersForChannel(
  db: DrizzleClient,
  channelId: string,
): Promise<Character[]> {
  const rows = await db
    .select({ character: characters })
    .from(characterChannels)
    .innerJoin(characters, eq(characters.id, characterChannels.character_id))
    .where(eq(characterChannels.channel_id, channelId))
    .orderBy(asc(characters.name));
  return rows.map((r) => r.character);
}

/** Full library listing with images and channel bindings, for the UI. */
export async function listCharacterLibrary(
  db: DrizzleClient,
): Promise<CharacterWithImages[]> {
  const rows = await db.select().from(characters).orderBy(asc(characters.name));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [imgs, links] = await Promise.all([
    db
      .select()
      .from(characterImages)
      .where(inArray(characterImages.character_id, ids))
      .orderBy(
        asc(characterImages.sort_order),
        asc(characterImages.created_at),
        asc(characterImages.id),
      ),
    db
      .select()
      .from(characterChannels)
      .where(inArray(characterChannels.character_id, ids)),
  ]);

  return rows.map((c) => ({
    ...c,
    images: imgs.filter((i) => i.character_id === c.id),
    channel_ids: links
      .filter((l) => l.character_id === c.id)
      .map((l) => l.channel_id),
  }));
}

export async function getCharacterWithImages(
  db: DrizzleClient,
  id: string,
): Promise<CharacterWithImages | undefined> {
  const [c] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, id))
    .limit(1);
  if (!c) return undefined;
  const [images, links] = await Promise.all([
    listCharacterImages(db, id, { activeOnly: false }),
    db
      .select()
      .from(characterChannels)
      .where(eq(characterChannels.character_id, id)),
  ]);
  return { ...c, images, channel_ids: links.map((l) => l.channel_id) };
}

export async function createCharacter(
  db: DrizzleClient,
  data: NewCharacter,
): Promise<Character> {
  // channel_id is DERIVED (trigger-maintained from character_channels); strip it
  // so callers cannot believe they set it here.
  const { channel_id: _ignored, ...rest } = data;
  const [row] = await db.insert(characters).values(rest).returning();
  if (!row) throw new Error("Failed to create character");
  return row;
}

export async function updateCharacter(
  db: DrizzleClient,
  id: string,
  patch: Partial<Omit<NewCharacter, "channel_id">>,
): Promise<Character | undefined> {
  const [row] = await db
    .update(characters)
    .set({ ...patch, updated_at: new Date() })
    .where(eq(characters.id, id))
    .returning();
  return row;
}

export async function addCharacterImage(
  db: DrizzleClient,
  data: NewCharacterImage,
): Promise<CharacterImage> {
  const [row] = await db
    .insert(characterImages)
    .values(data)
    .onConflictDoUpdate({
      target: [characterImages.character_id, characterImages.image_path],
      set: { ...data, updated_at: new Date() },
    })
    .returning();
  if (!row) throw new Error("Failed to add character image");
  return row;
}

export async function setCharacterImageActive(
  db: DrizzleClient,
  imageId: string,
  isActive: boolean,
): Promise<void> {
  await db
    .update(characterImages)
    .set({ is_active: isActive, updated_at: new Date() })
    .where(eq(characterImages.id, imageId));
}

export async function deleteCharacterImage(
  db: DrizzleClient,
  imageId: string,
): Promise<void> {
  await db.delete(characterImages).where(eq(characterImages.id, imageId));
}

/**
 * Replace a character's channel bindings.
 *
 * Written as delete-then-insert inside one statement pair because partial
 * uniqueness ("one primary host per channel") is enforced in the database: a
 * conflicting assignment must fail the whole call rather than half-apply.
 */
export async function setCharacterChannels(
  db: DrizzleClient,
  characterId: string,
  bindings: Array<{
    channel_id: string;
    role?: string;
    is_primary?: boolean;
  }>,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Serialize replacement of this identity, including the empty-binding case.
    await tx.select({ id: characters.id }).from(characters)
      .where(eq(characters.id, characterId)).for("update");
    const existing = await tx.select().from(characterChannels)
      .where(eq(characterChannels.character_id, characterId));
    const values = bindings.map((b) => {
      const previous = existing.find((e) => e.channel_id === b.channel_id);
      return { character_id: characterId, channel_id: b.channel_id,
        role: b.role ?? previous?.role ?? "host",
        is_primary: b.is_primary ?? previous?.is_primary ?? true };
    });
    await tx.delete(characterChannels).where(eq(characterChannels.character_id, characterId));
    if (values.length) await tx.insert(characterChannels).values(values);
  });
}
