import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  findPresetCharacterByName,
  createDramaCharacter,
  setCharacterThumbnailUrl,
  type DramaCharacter,
} from "@repo/db/repositories";
import { callGeminiPool } from "../../utils/gemini-pool-client.js";
import {
  requestImage,
  downloadMedia,
} from "../../utils/media-gateway/index.js";

const CHARACTERS_DIR =
  process.env["DRAMA_CHARACTERS_DIR"] ??
  "/opt/content-forge/media/drama-characters";

/**
 * Ensure a preset character exists for the given name, autonomously
 * generating a description + portrait if missing.
 *
 * - Looks up by case-insensitive name first.
 * - If absent, calls Gemini for a face/build description grounded in the
 *   surrounding script context (so the character matches the story).
 * - Generates a studio portrait via Nano Banana (plain background, neutral
 *   pose) so the URL can be reused as a reference image in any future scene.
 * - Inserts into drama_characters with is_preset=true so it's reusable
 *   across stories.
 *
 * Returns the persisted DramaCharacter (existing or newly created).
 */
export async function ensureDramaCharacter(
  name: string,
  scriptContext: string,
): Promise<DramaCharacter> {
  const existing = await findPresetCharacterByName(name);
  if (existing) {
    if (existing.thumbnail_url) return existing;
    // Preset row exists but never got a portrait — fill it in.
    const url = await generatePortrait(existing.id, name, existing.description);
    await setCharacterThumbnailUrl(existing.id, url);
    return { ...existing, thumbnail_url: url };
  }

  const description = await generateDescription(name, scriptContext);
  const character = await createDramaCharacter({
    name,
    description,
    isPreset: true,
  });
  const url = await generatePortrait(character.id, name, description);
  await setCharacterThumbnailUrl(character.id, url);

  console.log(
    JSON.stringify({
      level: "info",
      message: "Autonomous character preset created",
      character_id: character.id,
      name,
      thumbnail_url: url,
    }),
  );

  return { ...character, thumbnail_url: url };
}

async function generateDescription(
  name: string,
  scriptContext: string,
): Promise<string> {
  const prompt = `You are casting a character named "${name}" for a dramatic story.
Read the script below and write a concise PHYSICAL description of this character
based on what the script implies — focus on FACE, BUILD, ETHNICITY, AGE, HAIR,
and DISTINGUISHING FEATURES. Do NOT describe wardrobe (clothing changes per scene).
If the script doesn't constrain a feature, pick something believable that fits the
implied setting/era.

SCRIPT (excerpt or full):
${scriptContext.slice(0, 6000)}

Output ONLY the description as a single paragraph, ~60–100 words. No preamble,
no bullet points, no quotes.`;
  const raw = await callGeminiPool(prompt);
  return raw.trim().replace(/^["']|["']$/g, "");
}

async function generatePortrait(
  characterId: string,
  name: string,
  description: string,
): Promise<string> {
  await mkdir(CHARACTERS_DIR, { recursive: true });
  const destPath = join(CHARACTERS_DIR, `${characterId}.jpg`);
  const portraitPrompt = `Studio character portrait of ${name}. ${description}
Plain dark gray background, professional photo studio lighting, frontal pose,
neutral expression, direct eye contact with camera, head and shoulders framing,
sharp focus, ultra-photorealistic, 4K RAW, prestige drama TV cinematography.
No text, no watermarks.`;
  const imageRef = await requestImage(portraitPrompt, {
    format: "LONG_FORM_DRAMA",
    context: `drama:character:${characterId}`,
  });
  await downloadMedia(imageRef, destPath);
  return destPath;
}
