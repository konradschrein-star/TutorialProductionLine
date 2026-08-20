#!/usr/bin/env tsx
/**
 * Seed: Thumbnail Format Rules — per-format thumbnail design doctrine.
 *
 * This is the QUALITY LEVER (DECISIONS §3.2.4). One row per format string,
 * encoding the layout archetype, subject scale, text policy, palette, emotion +
 * gaze policy, signature element and hard negatives from the research in the
 * plan §A5.5. `compileThumbnailBrief()` in the worker merges these with the
 * global doctrine, channel brand and video specifics.
 *
 * IMPORTANT (plan §A5.5, §H): the per-genre grammar is the THINNEST-evidenced
 * part of the literature — practitioner convention, not a coded dataset. Every
 * row therefore carries an `evidence_note` saying so, so the operator can
 * overrule it via the Design Rules editor instead of inheriting cargo cult.
 *
 * Idempotent on `format`. Re-running updates every row's directives.
 *
 * Usage:
 *   pnpm --filter @repo/db seed:thumbnail-format-rules
 *   tsx packages/db/src/seed-thumbnail-format-rules.ts
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../../.env") });

import { loadConfig } from "@repo/config";
import { createDrizzleClient } from "./client.js";
import { upsertThumbnailFormatRule } from "./repositories/thumbnail-repository.js";
import type { NewThumbnailFormatRule } from "./schema/thumbnails.js";

const EV =
  "Practitioner convention (plan §A5.5) — thinnest-evidenced part of the " +
  "research, tune against real output. Global gates (§A5.6) are better sourced.";

/**
 * The seed corpus. Formats not listed fall back to the OTHER row at runtime.
 * subject_scale is a fraction of the frame.
 */
const RULES: NewThumbnailFormatRule[] = [
  {
    format: "EXPLAINER",
    display_name: "Explainer",
    layout_archetype: "centred_object",
    subject_scale_min: "0.500",
    subject_scale_max: "0.600",
    text_max_words: 4,
    composite_text: false,
    text_policy: "The QUESTION, 2-4 words, or none. Never the full title.",
    subject_policy:
      "One counterintuitive phenomenon, centred, heavy negative space. " +
      "Negative space is a credibility signal — density reads as low-trust.",
    palette_policy: "Cool base + one warm accent, low saturation, <=3 hues.",
    emotion_register: "authentic",
    gaze_policy: "direct",
    signature_element:
      "A single counterintuitive object; face optional and small.",
    negatives: [
      "shocked open-mouth face",
      "cluttered background",
      "more than 3 visual units",
      "ALL-CAPS wall of text",
    ],
    evidence_note: EV,
  },
  {
    format: "TUTORIAL_STUDIO",
    display_name: "Tutorial",
    layout_archetype: "screen_inset",
    subject_scale_min: "0.600",
    subject_scale_max: "0.700",
    text_max_words: 5,
    composite_text: false,
    text_policy:
      "Outcome phrase, white or yellow on dark. Withhold the METHOD.",
    subject_policy:
      "Screen capture ~65% left, circular host inset upper-right. A centred " +
      "face competes with the screen; a cornered face merely identifies. Show " +
      "a recognisable software UI or framework logo, not generic code.",
    palette_policy: "Tech blues/greys + orange accent.",
    emotion_register: "authentic",
    gaze_policy: "at_subject",
    signature_element:
      "Recognisable software UI or framework logo; arrows are genre-native here.",
    negatives: [
      "generic code editor with unreadable code",
      "centred face over the screen",
      "revealing the final result/answer",
    ],
    evidence_note: EV,
  },
  {
    format: "POLITICAL_COMMENTARY",
    display_name: "Political Commentary",
    layout_archetype: "two_party_opposition",
    subject_scale_min: "0.300",
    subject_scale_max: "0.400",
    text_max_words: 4,
    composite_text: false,
    text_policy: "A quoted fragment only.",
    subject_policy:
      "Host one third, subject one third, jagged divider. Host reactive; " +
      "subject three-quarter profile. Max 1-2 annotations. Degraded source " +
      "imagery is a credibility marker — polish reads as fabrication.",
    palette_policy: "Red urgency on one side, cool on the subject side.",
    emotion_register: "authentic",
    gaze_policy: "at_subject",
    signature_element: "Two-party opposition with a jagged divider.",
    negatives: [
      "shocked open-mouth face",
      "more than 2 annotations",
      "over-polished stock look",
    ],
    evidence_note: EV,
  },
  {
    format: "POLITICAL_COMMENTARY_REACTOR",
    display_name: "Commentary Reactor",
    layout_archetype: "two_party_opposition",
    subject_scale_min: "0.300",
    subject_scale_max: "0.400",
    text_max_words: 4,
    composite_text: false,
    text_policy: "A quoted fragment only.",
    subject_policy:
      "Host reacts to a subject; jagged divider; degraded source imagery reads " +
      "as authentic, polish reads as fabrication.",
    palette_policy: "Red urgency + cool subject side.",
    emotion_register: "authentic",
    gaze_policy: "at_subject",
    signature_element: "Reactive host vs subject, jagged divider.",
    negatives: ["shocked open-mouth face", "more than 2 annotations"],
    evidence_note: EV,
  },
  {
    format: "TECH_COMPARISON",
    display_name: "Tech Comparison (Versus)",
    layout_archetype: "split_vs",
    subject_scale_min: "0.350",
    subject_scale_max: "0.450",
    text_max_words: 0, // VS layouts: a headline competes — zero is correct.
    composite_text: false,
    text_policy: "NONE. The VS mark and the two products carry it.",
    subject_policy:
      "Split 50/50, divider tilted 5-10 degrees, products equal (~40% each), " +
      "challenger on the RIGHT, identical lighting both sides.",
    palette_policy: "Left blue cast / right red cast.",
    emotion_register: "authentic",
    gaze_policy: "none",
    signature_element:
      "VS mark >=15% of frame height; challenger on the right.",
    negatives: [
      "overlay headline text",
      "unequal product sizing",
      "different lighting per side",
    ],
    evidence_note: EV,
  },
  {
    format: "LONG_FORM_DRAMA",
    display_name: "Long-form Drama / Documentary",
    layout_archetype: "small_subject_large_environment",
    subject_scale_min: "0.150",
    subject_scale_max: "0.250",
    text_max_words: 3,
    composite_text: false,
    text_policy: "A date, a number, or a proper noun.",
    subject_policy:
      "Single SMALL subject in a large environment — scale asymmetry is the " +
      "signature. Profile, obscured, or backlit. Cinematic close-up, emotional " +
      "tension. Serif or condensed-serif title treatment, not blocky sans. " +
      "Vignette.",
    palette_policy: "Desaturated + one saturated accent.",
    emotion_register: "authentic",
    gaze_policy: "at_subject",
    signature_element: "Scale asymmetry; cinematic vignette.",
    negatives: [
      "blocky sans headline",
      "bright flat lighting",
      "subject filling the frame",
    ],
    evidence_note: EV,
  },
  {
    format: "RANKING",
    display_name: "Ranking (Tier List)",
    layout_archetype: "tier_rows",
    subject_scale_min: null,
    subject_scale_max: null,
    text_max_words: 0, // title above the tiers only; not overlay text on cards
    composite_text: false,
    text_policy: "Title above the tiers only; no per-card overlay text.",
    subject_policy:
      "3-4 stacked rows of SQUARE cards, 3-5 per row, uniform. Item " +
      "recognisability outranks item importance — this genre monetises " +
      "DISAGREEMENT; an unrecognisable item in S generates no reaction.",
    palette_policy:
      "Locked TierMaker palette S red / A orange / B yellow / C green / " +
      "D blue / F grey, on dark.",
    emotion_register: "authentic",
    gaze_policy: "none",
    signature_element: "Square uniform cards in coloured tier rows.",
    negatives: [
      "unrecognisable items in the top tier",
      "non-uniform card sizing",
      "overlay text on cards",
    ],
    evidence_note: EV,
  },
  {
    format: "CASUALLY_EXPLAINED",
    display_name: "Casually Explained",
    layout_archetype: "minimalist_line_art",
    subject_scale_min: "0.400",
    subject_scale_max: "0.600",
    text_max_words: 4,
    composite_text: false,
    text_policy:
      "The topic in the deadpan register, few words. Humour format, not a " +
      "listicle — minimalist line art, no gloss.",
    subject_policy:
      "Minimalist line-art subject, deadpan, no face, no gloss, flat colours. " +
      "Gestalt over per-element legibility.",
    palette_policy: "2 hues + accent, flat, high contrast.",
    emotion_register: "authentic",
    gaze_policy: "none",
    signature_element: "Deadpan minimalist line art.",
    negatives: [
      "photorealistic render",
      "premium glossy 3D look",
      "shocked face",
      "busy background",
    ],
    authoring_notes:
      "This is a HUMOUR format, provisionally mapped from 'listicle' — the " +
      "line-art deadpan grammar matters more than the count. Confirm mapping.",
    evidence_note: EV + " Format-genre mapping is provisional (plan §I.12).",
  },
  {
    format: "VIDEO_ESSAY",
    display_name: "Video Essay / Faceless",
    layout_archetype: "single_hero_object",
    subject_scale_min: "0.400",
    subject_scale_max: "0.600",
    text_max_words: 5,
    composite_text: false,
    text_policy: "<=5 words, one line.",
    subject_policy:
      "Single hero object, generous negative space. 31% of breakouts had NO " +
      "face — faceless must buy attention with silhouette legibility and " +
      "implied action or aftermath, never a static product shot.",
    palette_policy: "2-3 brand colours, high contrast.",
    emotion_register: "authentic",
    gaze_policy: "none",
    signature_element: "Implied action or aftermath, strong silhouette.",
    negatives: [
      "static product shot",
      "cluttered composition",
      "low-contrast subject",
    ],
    evidence_note: EV,
  },
  {
    format: "OTHER",
    display_name: "Default (any format)",
    layout_archetype: "centred_object",
    subject_scale_min: "0.330",
    subject_scale_max: "0.500",
    text_max_words: 5,
    composite_text: false,
    text_policy:
      "<=5 words target, zero is legal (28% of breakouts had no text). " +
      "Complement the title, never duplicate it.",
    subject_policy:
      "One clear focal subject, face OR high contrast (not both required). " +
      "Face ~1/4 to 1/3 of frame when present. Rule of thirds.",
    palette_policy:
      "<=3 hues; push frame-average luminance out of 40-60% so it separates " +
      "from both light and dark YouTube chrome; red never the dominant field.",
    emotion_register: "authentic",
    gaze_policy: "direct",
    signature_element: "Clear single subject, calibrated curiosity gap.",
    negatives: [
      "shocked open-mouth face",
      "more than 3 visual units",
      "load-bearing content in the bottom-right duration-badge box",
      "mid-grey dominant field",
    ],
    evidence_note:
      "Global gates from plan §A5.6 (better-sourced than the per-genre table).",
  },
];

async function seed(): Promise<void> {
  const tag = "[seed-thumbnail-format-rules]";
  try {
    loadConfig();
  } catch {
    // config validation is best-effort here; DATABASE_URL is what matters
  }
  const dbUrl = process.env["DATABASE_URL"];
  if (!dbUrl) throw new Error(`${tag} DATABASE_URL is not set`);
  const db = createDrizzleClient(dbUrl);

  let n = 0;
  for (const rule of RULES) {
    await upsertThumbnailFormatRule(db, rule);
    n++;
    console.log(`${tag} upserted ${rule.format}`);
  }
  console.log(`${tag} done — ${n} format rules`);
}

seed().then(
  () => process.exit(0),
  (err) => {
    console.error("[seed-thumbnail-format-rules] FAILED", err);
    process.exit(1);
  },
);
