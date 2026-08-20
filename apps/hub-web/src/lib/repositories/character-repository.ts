import { eq, and, desc, inArray, or, isNull } from "drizzle-orm";
import { db, characters, assets, characterStateTypes } from "../db";
import type { Character } from "@repo/db";

export type { Character };

export interface CreateCharacterInput {
  name: string;
  description: string;
  channel_id?: string | null;
  archetype_id?: string | null;
  reference_sheet_asset_id?: string | null;
  tags?: string[];
  is_active?: boolean;
}

export interface CharacterWithStates extends Character {
  states: Array<{
    id: string;
    name: string;
    description: string | null;
    asset_id: string | null;
    asset_status: string | null;
    asset_file_path: string | null;
  }>;
  completeness: { present: number; total: number };
}

export async function listCharacters(filter?: {
  channel_id?: string;
  archetype_id?: string;
  active_only?: boolean;
  ids?: string[]; // NEW: Filter by specific IDs
}): Promise<Character[]> {
  const conditions = [];

  // NEW: Filter by IDs (takes precedence over other filters)
  if (filter?.ids && filter.ids.length > 0) {
    conditions.push(inArray(characters.id, filter.ids));
  }

  // Include universal characters (channel_id = null) when filtering by channel
  if (filter?.channel_id) {
    conditions.push(
      or(
        eq(characters.channel_id, filter.channel_id),
        isNull(characters.channel_id),
      ),
    );
  }
  if (filter?.archetype_id)
    conditions.push(eq(characters.archetype_id, filter.archetype_id));
  if (filter?.active_only) conditions.push(eq(characters.is_active, true));

  const query = db.select().from(characters);
  if (conditions.length > 0) {
    return query.where(and(...conditions)).orderBy(desc(characters.created_at));
  }
  return query.orderBy(desc(characters.created_at));
}

export async function getCharacterById(id: string): Promise<Character | null> {
  const rows = await db
    .select()
    .from(characters)
    .where(eq(characters.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Get a character with all its state assets and completeness info.
 * Shows which of the 12 canonical states have generated assets.
 */
export async function getCharacterWithStates(
  characterId: string,
): Promise<CharacterWithStates | null> {
  const character = await getCharacterById(characterId);
  if (!character) return null;

  const [stateAssets, allStateTypes] = await Promise.all([
    db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.character_id, characterId),
          eq(assets.asset_type, "character_state"),
        ),
      ),
    db.select().from(characterStateTypes).orderBy(characterStateTypes.name),
  ]);

  // Build a map: state_name → asset (by extracting '#state:{name}' from tags).
  // First resolution wins — if an asset somehow carries multiple #state: tags (malformed data),
  // only the first tag is used and a warning is logged. Earlier assets in the result set also
  // take precedence so that stale duplicates never silently overwrite a previously mapped state.
  const stateMap = new Map<string, (typeof stateAssets)[0]>();
  for (const asset of stateAssets) {
    const stateTags = (asset.tags ?? []).filter((t) => /^#state:.+$/.test(t));
    if (stateTags.length > 1) {
      console.warn(
        `[character-repository] Asset ${asset.id} has multiple #state: tags — using first only`,
      );
    }
    const firstStateTag = stateTags[0];
    if (firstStateTag) {
      const match = firstStateTag.match(/^#state:(.+)$/);
      if (match && !stateMap.has(match[1]!)) {
        // Don't overwrite — first resolution wins for this state name
        stateMap.set(match[1]!, asset);
      }
    }
  }

  const states = allStateTypes.map((st) => {
    const asset = stateMap.get(st.name);
    return {
      id: st.id,
      name: st.name,
      description: st.description,
      asset_id: asset?.id ?? null,
      asset_status: asset?.status ?? null,
      asset_file_path: asset?.file_path ?? null,
    };
  });

  return {
    ...character,
    states,
    completeness: {
      present: states.filter((s) => s.asset_id !== null).length,
      total: allStateTypes.length,
    },
  };
}

/**
 * DEPRECATED (migration 0061) — use `character-library-repository`.
 *
 * These two accepted `channel_id`, which is now a DERIVED column maintained by
 * a database trigger from `character_channels`. A caller passing it here would
 * believe it had bound a channel and would be silently wrong: the trigger
 * overwrites whatever is written. Nothing imports them any more; they throw
 * rather than sit here waiting to be picked up again.
 *
 * Create: `createCharacter` in character-library-repository.
 * Bind:   PUT /api/characters/[id]/channels.
 */
export async function createCharacter(
  _data: CreateCharacterInput,
): Promise<never> {
  throw new Error(
    "createCharacter moved to character-library-repository (migration 0061). " +
      "channel_id is derived from character_channels by a DB trigger and cannot " +
      "be set on the character row.",
  );
}

export async function updateCharacter(
  _id: string,
  _patch: Partial<CreateCharacterInput>,
): Promise<never> {
  throw new Error(
    "updateCharacter moved to character-library-repository (migration 0061). " +
      "channel_id is derived from character_channels by a DB trigger.",
  );
}
