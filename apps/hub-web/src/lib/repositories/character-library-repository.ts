/**
 * Hub-web binding for the Character Library.
 *
 * Thin `db`-bound wrappers over the repository in @repo/db so the UI and the
 * worker read the SAME queries. Duplicating the joins here is how the two ends
 * drift, and a drifted host resolution means the Studio shows one face and the
 * pipeline ships another.
 */
import { db } from "../db";
import {
  listCharacterLibrary as _listCharacterLibrary,
  getCharacterWithImages as _getCharacterWithImages,
  createCharacter as _createCharacter,
  updateCharacter as _updateCharacter,
  addCharacterImage as _addCharacterImage,
  setCharacterImageActive as _setCharacterImageActive,
  deleteCharacterImage as _deleteCharacterImage,
  setCharacterChannels as _setCharacterChannels,
  listCharacterImages as _listCharacterImages,
  resolveChannelHost as _resolveChannelHost,
} from "@repo/db/repositories";
import type { CharacterWithImages } from "@repo/db/repositories";
import { characterImages } from "@repo/db";
import { eq } from "drizzle-orm";

export type { CharacterWithImages };

export const listCharacterLibrary = () => _listCharacterLibrary(db);
export const getCharacterWithImages = (id: string) =>
  _getCharacterWithImages(db, id);
export const listCharacterImages = (id: string) => _listCharacterImages(db, id);
export const resolveChannelHost = (channelId: string) =>
  _resolveChannelHost(db, channelId);

export const createCharacter = (data: {
  name: string;
  description: string;
  role?: string;
  notes?: string | null;
}) => _createCharacter(db, data);

export const updateCharacter = (
  id: string,
  patch: {
    name?: string;
    description?: string;
    role?: string;
    notes?: string | null;
    is_active?: boolean;
  },
) => _updateCharacter(db, id, patch);

export const addCharacterImage = (data: {
  character_id: string;
  image_path: string;
  original_path?: string | null;
  pose?: string | null;
  expression?: string | null;
  source_filename?: string | null;
  width?: number | null;
  height?: number | null;
  byte_size?: number | null;
  sort_order?: number;
}) => _addCharacterImage(db, data);

export const setCharacterImageActive = (id: string, active: boolean) =>
  _setCharacterImageActive(db, id, active);
export const deleteCharacterImage = (id: string) =>
  _deleteCharacterImage(db, id);
export const setCharacterChannels = (
  characterId: string,
  bindings: Array<{ channel_id: string; role?: string; is_primary?: boolean }>,
) => _setCharacterChannels(db, characterId, bindings);

/** One image row — used by the file-serving route, which must not trust input. */
export async function getCharacterImageById(id: string) {
  const [row] = await db
    .select()
    .from(characterImages)
    .where(eq(characterImages.id, id))
    .limit(1);
  return row;
}
