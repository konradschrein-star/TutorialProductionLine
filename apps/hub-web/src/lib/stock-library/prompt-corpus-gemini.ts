import { callGeminiPool } from "./gemini";

export const STOCK_STYLE_TAIL =
  "Realistic reality-TV docudrama recreation. Natural skin tones. Normal contemporary clothing. Eye-level lens. No text, no subtitles, no watermarks, no captions. One shot, no cuts, static camera.";

export interface GeneratedStockPrompt {
  prompt: string;
  vibe_tag: string;
}

const META_PROMPT = (
  count: number,
): string => `You are generating short visual scene descriptions to feed into a text-to-video (VEO) model. These clips will live in a generic stock library for a YouTube channel that publishes long-form Black-couple / Black-family drama stories. The channel's PRIMARY POINT-OF-VIEW CHARACTER is always a Black man in his 30s.

Output a JSON array of EXACTLY ${count} objects. Each object has:
{
  "vibe_tag": "short_snake_case_label_for_grouping",
  "prompt": "the full VEO scene description, one paragraph, ending with the realism+style tail below"
}

DISTRIBUTION RULES (target counts assume ${count} total):
- 30% solo character scenes. Of those: 60% Black man (mid-30s, athletic build, varied face/hair), 40% Black woman (early-to-mid-30s, varied build/hair). Single subject doing something everyday but emotionally loaded.
- 40% two-person scenes. Black man + Black woman couple. Mix of: talking calmly, sitting in silence, eating, arguing, embracing, ignoring each other, in bed turned away from each other, on opposite ends of a couch.
- 15% three-person scenes. THREE-PERSON SCENES MUST DEPICT AN ARGUMENT OR CONFRONTATION — never friendly.
- 10% multi-person scenes (4-6 people). Black extended family at a dinner table, a church congregation, a backyard barbecue, a courtroom with family present.
- 5% B-roll / no people. Apartment exterior at dusk, kitchen counter still life (keys, mail, mug), child's drawing on a fridge, a hallway of a small apartment building, a parked car at night with the engine off.

PER-PROMPT REQUIREMENTS:
- State the subject's age range, build, skin tone, hair, and what they're wearing IN ORDINARY CLOTHES.
- State the location (modest American apartment, parked sedan, suburban porch, etc.) and lighting.
- State the action in present tense, one sentence.
- End with this exact tail on its own:
${STOCK_STYLE_TAIL}

Output only the JSON array. No prose. No markdown fences.`;

export async function generatePromptBatch(
  batchSize: number,
  characterBlockOverride?: string,
): Promise<GeneratedStockPrompt[]> {
  if (batchSize < 1 || batchSize > 200) {
    throw new Error(`batchSize ${batchSize} out of range [1, 200]`);
  }
  // If the library provides a custom character block, inject it
  // into the meta-prompt so future libraries can run other formats
  // (e.g. Latino-family drama, college-life drama) without code
  // changes.
  const base = META_PROMPT(batchSize);
  const prompt =
    characterBlockOverride && characterBlockOverride.trim()
      ? base.replace(
          /Black-couple \/ Black-family drama stories\..*?Black man in his 30s\./s,
          `${characterBlockOverride.trim()} (Use these characters/setting for all prompts.)`,
        )
      : base;
  const raw = await callGeminiPool(prompt);
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error(
      `Gemini did not return a JSON array. First 300: ${raw.slice(0, 300)}`,
    );
  }
  const items = JSON.parse(match[0]) as Array<{
    vibe_tag?: unknown;
    prompt?: unknown;
  }>;
  const out: GeneratedStockPrompt[] = [];
  for (const it of items) {
    if (typeof it?.prompt !== "string" || typeof it?.vibe_tag !== "string") {
      continue;
    }
    const trimmed = it.prompt.trim();
    if (trimmed.length < 60) continue;
    const prompt = trimmed.includes(STOCK_STYLE_TAIL.slice(0, 40))
      ? trimmed
      : `${trimmed} ${STOCK_STYLE_TAIL}`;
    out.push({ prompt, vibe_tag: it.vibe_tag.trim().slice(0, 64) });
  }
  return out;
}
