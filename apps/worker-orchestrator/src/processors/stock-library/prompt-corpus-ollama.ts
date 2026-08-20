import { STOCK_STYLE_TAIL } from "./prompts.js";

export interface GeneratedStockPrompt {
  prompt: string;
  vibe_tag: string;
}

const OLLAMA_URL = process.env["OLLAMA_URL"] ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env["OLLAMA_MODEL"] ?? "gemma3:4b";

/**
 * A richer, more varied meta-prompt than the Gemini version.
 * Covers 12 character archetypes × 8 settings × 10 emotional states
 * so the library isn't dominated by apartment-couple scenes alone.
 */
const META_PROMPT = (count: number): string =>
  `You are generating short visual scene descriptions for a text-to-video AI model (VEO). \
These clips will be assembled into long-form Black drama YouTube videos narrated in third person. \
The primary characters are Black Americans in their 20s–50s in contemporary urban/suburban settings.

Output a JSON array of EXACTLY ${count} objects, each shaped:
{"vibe_tag":"short_snake_case_label","prompt":"full scene description ending with the style tail"}

STRICT DISTRIBUTION — spread evenly across ALL categories below (do not cluster):

CHARACTER ARCHETYPES (vary every prompt):
- professional_man: Black man 30–40, clean-cut or low fade, business casual / scrubs / uniform
- working_class_man: Black man 25–45, work boots or sneakers, construction gear / delivery uniform / security vest / chef coat
- struggling_man: Black man 28–40, worn casual clothes, visibly stressed or tired
- rising_man: Black man 30–42, newly sharp — fresh fit, watch, confidence not yet settled
- professional_woman: Black woman 28–38, natural hair or weave, business wear or scrubs
- domestic_woman: Black woman 28–45, home clothes, kids' things nearby, tiredness in posture
- independent_woman: Black woman 24–36, stylish casual, phone or keys in hand, purposeful walk
- older_parent: Black man or woman 55–70, reading glasses or work-worn hands, dignity in stillness
- teen: Black teen 15–19, hoodie or school uniform, body language ranges from carefree to defiant
- couple_calm: Black man + Black woman, 30s, sitting or standing close, low tension
- couple_conflict: Black man + Black woman, 30s, physical distance, averting eyes or facing off
- group_scene: 3–6 Black family members or friends — dinner, church pew, porch, living room

SETTINGS (rotate, never repeat same setting twice in a row):
interior_apartment, interior_kitchen, interior_bedroom, interior_church,
exterior_city_street, exterior_parking_lot, exterior_suburban_porch,
interior_car_parked, interior_car_moving, interior_barbershop_or_salon,
interior_office_or_cubicle, exterior_park_or_basketball_court

EMOTIONAL REGISTERS (cover all of them — this is the most important axis):
grief_crying, rage_shouting, quiet_devastation, determination_resolve,
guilty_shame, suspicious_watching, tender_joy, awkward_silence,
shock_disbelief, resigned_exhaustion, defiant_pride, anxious_waiting

ACTION EXAMPLES — use VARIED actions, not just "staring at phone":
- Crying silently into hands on a kitchen floor
- Slamming a folder onto a desk and walking out
- Pressing forehead to a cold car window in a parking garage
- Counting small bills on a kitchen counter late at night
- Locking a front door and sliding down it to the floor
- Standing in a church aisle looking at an empty pew
- Watching a woman walk away down a hallway without turning back
- Sitting across a table from someone whose eyes don't meet theirs
- Checking a baby monitor in a dark hallway at 2 AM
- Folding laundry alone in a laundromat
- Laughing loudly at something on a phone while a partner ignores them
- Handing over car keys to someone with a stiff jaw
- Hugging a child tightly in a hospital corridor
- Pacing a small room, pulling at a collar
- Staring at a positive pregnancy test in a fluorescent bathroom

PER-PROMPT REQUIREMENTS:
1. Specify subject's age range, build, skin tone, hair style, and clothing — always ORDINARY everyday wear.
2. Specify location precisely (modest apartment, mid-range office building, etc.) and time of day / lighting.
3. Describe the action in one present-tense sentence.
4. Keep it plausibly contemporary and ordinary — no period costumes, no fantasy.
5. End EVERY prompt with this exact tail (copy verbatim): ${STOCK_STYLE_TAIL}

Output ONLY the raw JSON array. No markdown, no prose, no code fences.`;

export async function generatePromptBatch(
  batchSize: number,
): Promise<GeneratedStockPrompt[]> {
  if (batchSize < 1 || batchSize > 200) {
    throw new Error(`batchSize ${batchSize} out of range [1, 200]`);
  }

  const body = JSON.stringify({
    model: OLLAMA_MODEL,
    messages: [
      {
        role: "user",
        content: META_PROMPT(batchSize),
      },
    ],
    stream: false,
    options: {
      temperature: 0.85,
      num_predict: 16384,
    },
  });

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(300_000), // 5 min — small models can be slow on large batches
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    message?: { content?: string };
    error?: string;
  };

  if (data.error) throw new Error(`Ollama error: ${data.error}`);
  const raw = data.message?.content ?? "";

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error(
      `Ollama did not return a JSON array. First 300 chars: ${raw.slice(0, 300)}`,
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
