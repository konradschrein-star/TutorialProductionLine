import { callGeminiPool } from "../../utils/gemini-pool-client.js";
import { STOCK_STYLE_TAIL } from "./prompts.js";

export interface GeneratedStockPrompt {
  prompt: string;
  vibe_tag: string;
}

/**
 * Wider variety than the original corpus — covers more character archetypes,
 * locations, and emotional registers so the semantic matcher has richer
 * footage to pull from across the full dramatic arc of a story.
 */
const META_PROMPT = (count: number): string =>
  `You are generating short visual scene descriptions to feed into a text-to-video AI model (VEO). \
These clips will be assembled into long-form Black drama YouTube videos. \
The channel publishes stories about Black Americans in contemporary urban/suburban settings.

Output a JSON array of EXACTLY ${count} objects. Each object:
{"vibe_tag":"short_snake_case_label","prompt":"full VEO scene description ending with the style tail"}

STRICT DISTRIBUTION — must spread across ALL categories. Do NOT cluster in any one area:

CHARACTER ARCHETYPES — rotate across all:
- professional_man: Black man 30–42, doctor / lawyer / engineer / teacher / coach — business casual or uniform
- working_class_man: Black man 25–45, construction gear / delivery uniform / security vest / chef coat / scrubs
- struggling_man: Black man 28–40, worn casual clothes, stress in posture
- rising_man: Black man 30–42, newly money — fresh outfit, watch, confidence still finding itself
- professional_woman: Black woman 28–38, natural hair or styled weave, scrubs / blazer / teacher clothes
- domestic_woman: Black woman 28–45, home clothes, tiredness in posture, kids visible or implied
- independent_woman: Black woman 24–36, stylish casual, purposeful energy, keys or phone in hand
- older_parent: Black parent 55–72, reading glasses, work-worn hands, dignified stillness
- teenage_kid: Black teen 14–19, hoodie or school uniform, ranging from carefree to defiant
- couple_calm: Black man + Black woman, 30s, close physical proximity, low tension
- couple_conflict: Black man + Black woman, 30s, distance — averted eyes or facing off
- group_family: 3–6 Black family members — dinner table / church pew / porch / living room

SETTINGS — rotate through all twelve:
modest_apartment_interior, small_kitchen, bedroom_night, church_interior,
city_street_exterior, parking_lot_exterior, suburban_porch, car_interior_parked,
car_interior_moving, barbershop_or_salon_interior, office_cubicle_interior,
park_or_basketball_court_exterior

EMOTIONAL REGISTERS — every register MUST appear multiple times:
grief_crying, rage_shouting, quiet_devastation, determination_resolve,
guilty_shame, suspicious_watching, tender_joy, awkward_silence,
shock_disbelief, resigned_exhaustion, defiant_pride, anxious_waiting

ACTION VARIETY — never use "staring at phone" as the ONLY action. Use diverse actions:
- Sliding down a closed front door to the floor
- Counting crumpled bills on a kitchen counter at midnight
- Pressing forehead against a cold car window in a dark garage
- Folding laundry alone in a laundromat, jaw tight
- Standing in a church aisle staring at an empty pew
- Watching someone walk away down a hallway without turning back
- Handing over car keys with a stiff jaw and no eye contact
- Hugging a child tightly in a hospital corridor
- Pacing a small room, pulling at a collar, unable to sit
- Laughing loudly at a phone while a partner ignores them across a couch
- Crying silently into hands on a kitchen floor
- Slamming a folder onto a desk and walking out
- Sitting at the edge of a bed in the dark before dawn, still dressed
- Checking a baby monitor in a dark hallway at 2 AM
- Receiving or handing over a positive pregnancy test in a bathroom
- Leaning on the hood of a car in a parking lot at dusk, arms crossed
- Walking through a front door and stopping dead at what they see
- Ironing a shirt in silence, eyes somewhere else entirely

PER-PROMPT REQUIREMENTS:
1. Age range, build, skin tone, hair style, and ORDINARY everyday clothing — never costume.
2. Precise location and time of day / lighting condition.
3. One present-tense action sentence.
4. Contemporary, plausible, ordinary — nothing stylized or period-set.
5. End EVERY prompt with this exact line (copy verbatim): ${STOCK_STYLE_TAIL}

Output ONLY the raw JSON array. No markdown fences, no prose, no commentary.`;

export async function generatePromptBatch(
  batchSize: number,
): Promise<GeneratedStockPrompt[]> {
  if (batchSize < 1 || batchSize > 200) {
    throw new Error(`batchSize ${batchSize} out of range [1, 200]`);
  }
  const raw = await callGeminiPool(META_PROMPT(batchSize));
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
    if (typeof it?.prompt !== "string" || typeof it?.vibe_tag !== "string")
      continue;
    const trimmed = it.prompt.trim();
    if (trimmed.length < 60) continue;
    const prompt = trimmed.includes(STOCK_STYLE_TAIL.slice(0, 40))
      ? trimmed
      : `${trimmed} ${STOCK_STYLE_TAIL}`;
    const vibe_tag = it.vibe_tag.trim().slice(0, 64);
    out.push({ prompt, vibe_tag });
  }
  return out;
}
