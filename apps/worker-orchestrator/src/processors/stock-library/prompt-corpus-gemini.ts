import { callGeminiPool } from "../../utils/gemini-pool-client.js";
import { STOCK_STYLE_TAIL } from "./prompts.js";

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
- 30% solo character scenes. Of those: 60% Black man (mid-30s, athletic build, varied face/hair), 40% Black woman (early-to-mid-30s, varied build/hair). Single subject doing something everyday but emotionally loaded: looking out a window, sitting in a parked car, staring at a phone, sitting at the edge of a bed, drinking water late at night, leaning on a kitchen counter.
- 40% two-person scenes. Black man + Black woman couple. Mix of: talking calmly, sitting in silence, eating, arguing, embracing, ignoring each other, in bed turned away from each other, on opposite ends of a couch. Vary action across the batch.
- 15% three-person scenes. THREE-PERSON SCENES MUST DEPICT AN ARGUMENT OR CONFRONTATION — never friendly. Examples: a Black couple confronted by a parent / friend / suspected other partner; two Black men squaring up while a Black woman tries to step between them; a Black woman and Black man having a tense conversation while a Black teenager listens from a doorway.
- 10% multi-person scenes (4-6 people). Black extended family at a dinner table, a church congregation, a backyard barbecue, a courtroom with family present. Mix of charged and calm moods.
- 5% B-roll / no people. Apartment exterior at dusk, kitchen counter still life (keys, mail, mug), child's drawing on a fridge, a hallway of a small apartment building, a parked car at night with the engine off.

PER-PROMPT REQUIREMENTS:
- State the subject's age range, build, skin tone, hair, and what they're wearing IN ORDINARY CLOTHES (t-shirt, jeans, work clothes, scrubs, suit, etc.) — NEVER costume, NEVER stylised.
- State the location (modest American apartment, small kitchen, parked sedan, suburban porch, etc.) and time of day / lighting (morning, dusk, overhead fluorescent, lamp light).
- State the action in present tense, one sentence.
- The location, lighting, and clothing MUST be plausibly contemporary and ordinary — these clips need to plausibly intercut with any drama narration.
- The prompt MUST end with this exact tail (copy verbatim, on its own line, single space-separated):
${STOCK_STYLE_TAIL}

Output only the JSON array. No prose around it. No markdown fences. No commentary.`;

/**
 * Call Gemini once and parse out a batch of prompts. The pool is
 * already retried + load-balanced; this layer just enforces the JSON
 * shape and filters out malformed entries.
 */
export async function generatePromptBatch(
  batchSize: number,
): Promise<GeneratedStockPrompt[]> {
  if (batchSize < 1 || batchSize > 200) {
    throw new Error(`batchSize ${batchSize} out of range [1, 200]`);
  }
  const raw = await callGeminiPool(META_PROMPT(batchSize));
  // The model occasionally wraps the JSON in ```json fences despite
  // instructions; strip both styles.
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error(
      `Gemini did not return a JSON array. First 300 chars: ${raw.slice(0, 300)}`,
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
    if (trimmed.length < 60) continue; // suspiciously short
    // Make sure the style tail is present — Gemini occasionally drops it.
    const prompt = trimmed.includes(STOCK_STYLE_TAIL.slice(0, 40))
      ? trimmed
      : `${trimmed} ${STOCK_STYLE_TAIL}`;
    const vibe_tag = it.vibe_tag.trim().slice(0, 64);
    out.push({ prompt, vibe_tag });
  }
  return out;
}
