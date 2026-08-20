#!/usr/bin/env tsx
/**
 * Seed: RANKING Template
 *
 * Phase 1 — single-pass script prompt: the LLM emits a JSON block with
 * tier placements + reveal order, followed by the narration script.
 * The ranking-analysis processor parses both out.
 *
 * Phase 2 will split this into multi-pass: research → rank (commit + vector
 * DB continuity check) → script → playbook.
 *
 * Usage:
 *   pnpm --filter @repo/db seed:ranking
 *   OR
 *   tsx packages/db/src/seed-ranking-template.ts
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { contentTemplates } from "./schema/content-templates.js";
import { eq } from "drizzle-orm";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "../../../.env");
config({ path: envPath });

import { loadConfig, getConfig } from "@repo/config";

async function seedTemplate() {
  console.log("[seed-ranking] Loading config...");
  try {
    loadConfig();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  const { DATABASE_URL } = getConfig();
  const sql = postgres(DATABASE_URL);
  const db = drizzle(sql);

  const templateName = "Ranking Default";

  const [existing] = await db
    .select({ id: contentTemplates.id })
    .from(contentTemplates)
    .where(eq(contentTemplates.name, templateName))
    .limit(1);

  const templateData = {
    name: templateName,
    description:
      "Tier-list ranking videos. Single opinionated host narrates items into a 5-tier board (Instant Buy → Hard Pass). Operator gives a freeform brief (a list, a description, or a pasted script) and DeepSeek decides + ranks the items — or specify exact items yourself. Real Fish Audio TTS, real Remotion render, VA B-roll selection studio.",
    format: "RANKING" as const,

    pipeline_stages: [
      "SCRIPTING",
      "ASSET_COLLECTION",
      "QMS_VALIDATING",
      "ROUTING_RENDER",
      "RENDERING_REMOTION",
      "AWAITING_UPLOADER",
    ],

    prompts: {
      script: `You are writing the spoken narration for a tier-list ranking video, plus the data the render needs to build the board.

WHAT THE VIEWER ACTUALLY SEES: real footage of each thing being ranked (product clips, stock footage, photos) and a tier board that fills in one slot at a time as you talk. There is no host on screen, no face, no second speaker, no interview, no screen recording. Your words are the entire audio track, read start to finish by a single text-to-speech voice, exactly as you write them.

VOICE: first person, opinionated but fair. You have actually used or studied these things and you commit to your takes. You concede a real strength in something you ranked low, and you name a real flaw in the thing you ranked first. You are talking to one person, not to an audience. Write the narration in this language: \${language}.

---- INPUT ----

Topic: \${topic}

Brief from the operator. This is your primary source. It may be a rough list, a description, or an already-written narration:
\${brief}

Items to rank:
\${itemsList}

Operator context (angle, constraints, opinions to honour):
\${context}

The tier board, best first. These are the exact labels the viewer sees on screen:
\${tierList}

If the brief is ALREADY a complete narration, keep its wording and voice rather than rewriting it from scratch, but still infer the items, tiers and order, emit the JSON block, and repair any place where it breaks the ONE-MENTION RULE or the spoken-word rules below.

---- THE ONE-MENTION RULE (breaking this breaks the video) ----

Say each item's name exactly ONCE in the whole narration, spelled exactly as it appears in the JSON "items" array, as the first thing in that item's own passage.

Never say any item's name anywhere else. Not in the opening. Not when teasing what is coming. Not when comparing one item against another. Not in the closing.

To refer back to something you already covered, describe it instead of naming it. Say "the one I put at the bottom of the board", or "the pick before this one", or "the cheap one", and never the name itself.

Why this is absolute: the pipeline finds each item in the finished audio by listening for its name, and uses that timestamp to decide when that item's footage appears on screen. A second mention drags the footage to the wrong moment, and the job is rejected before it ever renders. One name, one place.

---- STRUCTURE ----

Write these in order, as continuous prose, separated by blank lines and nothing else.

1. THE OPENING. Two or three sentences. Stake a claim or open a curiosity gap about this specific ranking, and tell the viewer what they get out of watching. Use "you". No item names. Never open with "welcome", "today", "in this video", "let's take a look", or any variation of those.

2. THE CRITERION. Two or three sentences, and this passage is not optional. Say plainly what you ranked these on, and say what you refused to let count. A ranking with no stated standard is just an opinion in a list. A stated standard is the thing that lets a viewer agree with you or argue with you, and arguing is what drives comments. Be concrete about the standard. No item names here.

THE OPENING AND THE CRITERION TOGETHER MUST NOT EXCEED 90 SPOKEN WORDS. This is a hard limit, not a target. The render anchors every shot to when you actually say each item's name, so the first item's name is the moment the board starts filling and the video starts being a tier list. A production script took 57 seconds to get there and the finished video was one static screen for the whole of it. Get to the first item inside roughly 35 seconds.

3. THE ITEMS, worst first, climbing to best. One passage each, 120 to 180 spoken words. Every passage does four things, in this order: name it once, deliver your verdict and say which tier it lands in out loud, give ONE concrete non-obvious reason a real person would care about, and admit one honest counterpoint. End each passage with a line that pulls the viewer forward without naming what is next. Stakes escalate as you climb: the passages near the top must carry more conviction and more consequence than the ones at the bottom.

4. THE NUDGE. Exactly one sentence, placed immediately before the best item, asking for a subscribe. No item names. Make it specific to this ranking rather than generic.

5. THE WINNER. Its own passage, the longest and the most certain one you write. Say why it clears the bar the criterion set, not merely that it is good.

6. THE PAYOFF. Two or three sentences. Close on an opinion that reframes the criterion now that the viewer has seen the whole board. Do not recap. Do not list. Do not name anything.

---- LENGTH ----

The total spoken word count sets the video's length, so hit it.

- 5 items or fewer: 900 to 1100 words
- 6 to 8 items: 1100 to 1500 words
- 9 to 12 items: 1500 to 2000 words
- 13 or more items: roughly 110 words per item, plus 200 words for the opening, criterion and payoff

---- TIER RULES ----

Place every item on the board, and be willing to use the bottom of it. At least one item must land in one of the two worst tiers. If everything is great, there is no ranking. The tier you say out loud inside a passage must be the same tier you assign that item in the JSON.

"revealOrder" is the order you discuss the items in the narration, starting at 0. It must run worst to best: revealOrder 0 is the item you rank lowest, and the highest revealOrder is your number one. The order of the passages and the revealOrder values must match exactly.

---- SPOKEN-WORD RULES (a voice engine reads this text literally) ----

Write only words a person says out loud.

- No markdown anywhere: no asterisks, no underscores, no hash marks, no backticks, no bullet points, no numbered lists.
- No labels of any kind. Never write "Number five", "Item 3", "Tier: Skip", "Hook", "Intro", "Outro", "Winner", or any name followed by a colon.
- No stage directions, no [pause], no (beat), no timestamps, no sound cues, no speaker names, no emoji.
- Write numbers, money and symbols the way they are spoken: "about two hundred dollars", not "\$200"; "ninety percent", not "90%"; "twenty twenty six", not "2026".
- If an item's real name contains a model code or an unpronounceable string, write the "name" field in the JSON the way it should be SAID out loud, and put the raw spelling in "pronunciation".

---- ANTI-SLOP (hard bans) ----

- Never use em dashes. Use periods, commas, or "but".
- No staccato triples like "Fast. Cheap. Reliable." Vary the rhythm: mix short punchy lines with longer flowing ones, and never write three short sentences in a row.
- At most two or three colons in the entire script, and never after a setup phrase like "Here's the thing" or "The bottom line".
- Never start a take with "Most people" or "Most buyers".
- At most ONE "it's not X, it's Y" construction in the entire script.
- Never invent precise-sounding numbers you cannot support (47 percent, 73 percent, "in 37 days"). Use real plausible figures, or none.
- NEVER STATE A PRICE for a specific item. Not "around fifty dollars", not "a two-hundred-and-fifty-dollar headphone", not a range, not "about half the price of the winner". You have no price source, prices move, and a confidently wrong price is the single easiest thing for a viewer to catch you on — it draws correction comments and costs the channel its authority on everything else it said. A real script did exactly this: it called a roughly one-hundred-dollar pair of headphones "around fifty dollars".
  The budget belongs to the CRITERION, not to the items. "Everything here is under three hundred" is fine and useful. "This one is fifty dollars" is not. If value matters to a verdict, say it in relative terms you can actually defend from the brief — "the cheapest thing on this board", "you pay a real premium for it" — never a figure.
- Ban the hype vocabulary: powerful, game-changing, revolutionary, unlock, elevate, seamless. Replace each with a concrete outcome, or delete it.
- No guru voice: "the truth nobody tells you", "let that sink in", "here's what they don't want you to know".
- Connect beats with "but" and "therefore", not "and then".

---- OUTPUT ----

Emit exactly two things and nothing else: ONE fenced JSON block, then the narration.

\`\`\`json
{
  "items": [
    { "id": "item-1", "name": "<the name exactly as you say it out loud>", "pronunciation": "<optional, only when the raw spelling differs>" }
  ],
  "placements": [
    { "itemId": "item-1", "tierIndex": <index from the tier board above>, "revealOrder": <0 = worst, ascending to the best> }
  ],
  "targetRuntimeSeconds": <your total word count divided by 2.5, rounded>
}
\`\`\`

The "items" array is REQUIRED. If the operator gave an explicit item list above, echo those exact ids and names. If not, you choose the items from the brief (5 to 12 unless the brief implies a specific count), give each a stable id "item-1", "item-2", and so on in the order you discuss them, and make sure every "itemId" in "placements" matches an id you listed in "items".

Then, immediately after the closing fence, write the narration as continuous spoken prose. Do not emit a second fenced block anywhere in your reply. No preamble before the JSON, no commentary after the narration.`,
    },

    render_config: {
      engine: "REMOTION" as const,
      // Explicit workflow. `render-processor.ts` hard-overrides RANKING to
      // "ranking-composition" regardless, but naming it here makes the routing
      // legible AND makes the compatibility guard live: with the workflow set,
      // render-processor runs validateRendererCompatibility(), which now has a
      // RANKING entry in packages/domain/src/renderer-compatibility.ts. Leaving
      // it unset is what kept that missing entry latent instead of loud.
      workflow: "ranking-composition",
      composition_id: "RankingComposition",
      settings: {
        fps: 30,
        width: 1920,
        height: 1080,
      },
      captions_enabled: false,
    },

    required_assets: [],

    metadata: {
      pipeline_config: {
        needs_scene_analysis: false,
        no_tts: false,
        tts_engine: "fish",
        // DeepSeek writes the ranking script: cheap, fast, no daytime-only
        // availability window (claude_pool is 06:00–18:00 UTC — would strand
        // night-shift VAs). Falls back to ollama via the LLM router ladder.
        script_provider: "deepseek",
        ranking: {
          needs_ranking_analysis: true,
        },
      },
    },

    is_active: true,
  };

  if (existing) {
    await db
      .update(contentTemplates)
      .set({ ...templateData, updated_at: new Date() })
      .where(eq(contentTemplates.id, existing.id));
    console.log(`[seed-ranking] Updated template: ${existing.id}`);
  } else {
    const [inserted] = await db
      .insert(contentTemplates)
      .values(templateData)
      .returning({ id: contentTemplates.id });
    console.log(`[seed-ranking] Inserted template: ${inserted.id}`);
  }

  console.log("[seed-ranking] Done.");
  await sql.end();
  process.exit(0);
}

seedTemplate().catch((err) => {
  console.error("[seed-ranking] Fatal:", err);
  process.exit(1);
});
