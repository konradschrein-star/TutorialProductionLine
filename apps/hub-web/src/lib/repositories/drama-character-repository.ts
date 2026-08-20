import { eq } from "drizzle-orm";
import { db, dramaCharacters } from "../db";

export interface DramaCharacter {
  id: string;
  name: string;
  description: string;
  is_preset: boolean;
  thumbnail_url: string | null;
}

export async function listPresetDramaCharacters(): Promise<DramaCharacter[]> {
  return db
    .select({
      id: dramaCharacters.id,
      name: dramaCharacters.name,
      description: dramaCharacters.description,
      is_preset: dramaCharacters.is_preset,
      thumbnail_url: dramaCharacters.thumbnail_url,
    })
    .from(dramaCharacters)
    .where(eq(dramaCharacters.is_preset, true))
    .orderBy(dramaCharacters.name);
}
