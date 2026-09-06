/**
 * Thumbnail brief compiler — the substantive quality lever (DECISIONS §3.2.4).
 *
 * Konrad's requirement, verbatim: "it's not just cluttering together a
 * reference image with me saying 'make an iteration of that'. It really depends
 * on the video thumbnail it is for. Also it all depends on the channel and the
 * format."
 *
 * A compiled brief merges FOUR layers, most-specific wins, and the merged result
 * is persisted on the thumbnail row (`brief jsonb`) so any generation can be
 * explained after the fact:
 *
 *   Layer 0  GLOBAL DOCTRINE   — the nine gates of plan §A5.6 (code constant)
 *   Layer 1  FORMAT RULES      — thumbnail_format_rules, one row per format
 *   Layer 2  CHANNEL BRAND     — persona prose, palette, logo, extra notes
 *   Layer 3  VIDEO SPECIFICS   — title, derived headline, topic, archetype
 *
 * This module is PURE and synchronous (except deriveHeadline, which needs an
 * LLM). No DB, no network — unit-testable.
 */

import {
  brandingDirective,
  BRANDING_FROM_TOPIC_FALLBACK,
} from "./brand-hints.js";
import { condenseHeadline, headlineInstructions } from "./headline.js";

export const THUMBNAIL_RULES_VERSION = "v1";

/** Used when a format states no text policy of its own. Exported because the
 *  renderer tests against it: a format that HAS said how its type looks does
 *  not also get the generic treatment sentence. */
export const DEFAULT_TEXT_PLACEMENT = "one line, high-contrast";

/** Layer 0 — the global gates that always apply (plan §A5.6). */
export const GLOBAL_DOCTRINE: string[] = [
  "Keep load-bearing content out of the bottom-right duration-badge box (~300x120px at 1280x720) and the bottom 24px strip.",
  "Must remain identifiable when downscaled to 168x94 — the mobile suggested size.",
  "At most 3 core visual units; busier thumbnails underperform.",
  // NOTE (2026-08-05): this line used to read "push frame-average luminance out
  // of the 40-60% band" and nothing else. A model satisfies that by going very
  // dark, and it did — the owner's verdict on 30 tutorial thumbnails was "they
  // are way too dark on average". The gate (separate from YouTube chrome in
  // BOTH themes) is unchanged; what is added is that the DIRECTION is the
  // format's palette policy to choose, not the model's. Formats that want dark
  // (RANKING is "on dark", LONG_FORM_DRAMA is desaturated) still get it, and
  // TUTORIAL_STUDIO's rule now says bright.
  "Separate from the YouTube UI in both themes: commit to clearly BRIGHT or clearly DARK as the palette policy below directs — never a muddy 40-60% mid-grey average; never let YouTube-red be the dominant field; use at most 3 hues.",
  "Calibrate curiosity: domain, subject and stakes instantly legible; only the OUTCOME withheld (~70% legible / 30% withheld).",
  "Authentic, subtle expression by default — NEVER an exaggerated open-mouth shock face.",
  "If a face is the hook, gaze direct to camera; if a prop/text/reveal is the hook, the face looks AT it, vector pointing inward, never off-frame.",
];

/**
 * Structural type for a format rule row (matches @repo/db ThumbnailFormatRule
 * but kept local so this module stays DB-free and testable).
 */
export interface FormatRuleLike {
  format: string;
  display_name: string;
  layout_archetype: string | null;
  composition: string[];
  subject_scale_min: string | number | null;
  subject_scale_max: string | number | null;
  text_max_words: number;
  composite_text: boolean;
  text_policy: string | null;
  subject_policy: string | null;
  palette_policy: string | null;
  emotion_register: string;
  gaze_policy: string;
  signature_element: string | null;
  negatives: string[];
  authoring_notes: string | null;
  rules_version: string;
}

export interface ChannelBrandLike {
  personaDescription: string | null;
  /**
   * True when `channel_personas.image_path` is being attached as the SECOND
   * i2i reference for this generation. Prose alone cannot hold a face; the
   * reference image can, and the prompt has to point at it explicitly or the
   * model treats it as decoration.
   */
  personaImageAttached?: boolean;
  extraNotes: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  logoSubject: string | null;
  featuresLogo: boolean;
}

export interface CompileBriefInput {
  format: string;
  channelId: string | null;
  title: string;
  headline: string | null; // already derived (deriveHeadline) — NULL is legal
  headlineSource: "operator" | "derived" | "title_fallback" | "none";
  topic: string | null;
  scriptExcerpt: string | null;
  rule: FormatRuleLike | null; // the format's row, or null (falls back to OTHER/global)
  brand: ChannelBrandLike | null;
  archetypeLayoutInstructions: string | null;
  archetypeBasePrompt: string | null;
}

export interface BriefProvenance {
  layer: 0 | 1 | 2 | 3;
  source: string;
  directive: string;
}

export interface ThumbnailBrief {
  rulesVersion: string;
  format: string;
  channelId: string | null;
  headline: string | null;
  headlineSource: "operator" | "derived" | "title_fallback" | "none";
  subject: string;
  subjectScale: [number, number] | null;
  layoutArchetype: string;
  emotion: string;
  gaze: string;
  palette: { primary?: string; secondary?: string; guidance: string };
  composition: string[];
  textPolicy: { maxWords: number; placement: string; treatment: string };
  compositeText: boolean;
  negatives: string[];
  /**
   * Set when a persona reference image is attached as reference #2. Drives the
   * character-replacement directive in renderProgrammatic.
   */
  personaImageAttached: boolean;
  personaDescription: string | null;
  /**
   * The product-branding directive (Layer 2), or null when the caller supplied
   * no `logoSubject`. Kept as its own field rather than buried in
   * `composition[]` because it is REQUIRED output: "I don't see really any
   * proper branding of the software that's being talked about anywhere" was one
   * of the eight rejections, and a droppable directive is how it got lost.
   */
  branding: string | null;
  /**
   * The archetype's own layout/style prose, split into sentences.
   *
   * WHY SPLIT: these are the most specific instructions in the whole brief
   * (Layer 3 — they describe the exact template the operator curated), and the
   * endorsed Blink Blueprint archetype carries ~1200 characters of them. As one
   * atom they never fit the 2000-char backend ceiling, so the budget dropped
   * them WHOLE and the generated thumbnail ignored the template it was supposed
   * to reproduce (verified on prod thumbnail 2e3b6544: not one word of the
   * cream/navy Search-Intent layout reached the model). Sentence-sized atoms
   * mean the budget truncates the tail instead of deleting the design.
   */
  archetypeGuidance: string[];
  provenance: BriefProvenance[];
}

/**
 * Sentence-split for archetype prose. Deliberately dumb — the input is
 * hand-written English, not prose to be parsed — and any sentence still longer
 * than `maxLen` is hard-cut so one runaway clause cannot eat the whole budget.
 */
function splitDirectives(text: string, maxLen = 260): string[] {
  const out: string[] = [];
  for (const raw of text.split(/(?<=[.!?])\s+/)) {
    const part = raw.trim();
    if (!part) continue;
    const prev = out[out.length - 1];
    // "…the verb, e.g. LEARN" must not become two directives. Abbreviations and
    // stubs are glued back onto the sentence they belong to.
    if (
      prev &&
      (/\b(e\.g|i\.e|etc|vs|approx|no|fig)\.$/i.test(prev) || part.length < 25)
    ) {
      out[out.length - 1] = `${prev} ${part}`;
      continue;
    }
    out.push(part);
  }
  return out.map((s) => (s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s));
}

function toScale(v: string | number | null): number | null {
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compile the four layers into a structured brief. Deterministic and pure.
 * `provenance[]` records which layer contributed each directive so the Studio
 * can show "this came from the TECH_COMPARISON format rule" and Konrad can
 * change the rule instead of re-typing instructions.
 */
export function compileThumbnailBrief(
  input: CompileBriefInput,
): ThumbnailBrief {
  const provenance: BriefProvenance[] = [];
  const rule = input.rule;
  const brand = input.brand;

  // ── Layer 0: global doctrine ──────────────────────────────────────────────
  const composition: string[] = [];
  for (const d of GLOBAL_DOCTRINE) {
    composition.push(d);
    provenance.push({ layer: 0, source: "global_doctrine", directive: d });
  }

  // ── Layer 1: format rules ─────────────────────────────────────────────────
  const layoutArchetype = rule?.layout_archetype ?? "centred_object";
  let emotion = rule?.emotion_register ?? "authentic";
  let gaze = rule?.gaze_policy ?? "direct";
  const maxWords = Math.min(rule?.text_max_words ?? 3, 3);
  const compositeText = rule?.composite_text ?? false;
  const scaleMin = toScale(rule?.subject_scale_min ?? null);
  const scaleMax = toScale(rule?.subject_scale_max ?? null);
  const negatives: string[] = [];

  if (rule) {
    for (const c of rule.composition) {
      composition.push(c);
      provenance.push({
        layer: 1,
        source: `format:${rule.format}`,
        directive: c,
      });
    }
    if (rule.subject_policy) {
      composition.push(`Subject: ${rule.subject_policy}`);
      provenance.push({
        layer: 1,
        source: `format:${rule.format}`,
        directive: rule.subject_policy,
      });
    }
    if (rule.signature_element) {
      composition.push(`Signature: ${rule.signature_element}`);
      provenance.push({
        layer: 1,
        source: `format:${rule.format}`,
        directive: rule.signature_element,
      });
    }
    for (const n of rule.negatives) {
      negatives.push(n);
      provenance.push({
        layer: 1,
        source: `format:${rule.format}:negative`,
        directive: n,
      });
    }
  }

  // ── Layer 2: channel brand ────────────────────────────────────────────────
  const palette: ThumbnailBrief["palette"] = {
    guidance: rule?.palette_policy ?? "At most 3 hues, high contrast.",
  };
  if (rule?.palette_policy) {
    provenance.push({
      layer: 1,
      source: `format:${rule.format}`,
      directive: rule.palette_policy,
    });
  }
  if (brand) {
    if (brand.primaryColor) palette.primary = brand.primaryColor;
    if (brand.secondaryColor) palette.secondary = brand.secondaryColor;
    if (brand.primaryColor || brand.secondaryColor) {
      const g = `Honour the channel palette${
        brand.primaryColor ? ` primary ${brand.primaryColor}` : ""
      }${brand.secondaryColor ? ` secondary ${brand.secondaryColor}` : ""}.`;
      palette.guidance = `${palette.guidance} ${g}`;
      provenance.push({ layer: 2, source: "channel_brand", directive: g });
    }
    if (brand.personaDescription) {
      composition.push(`Host/persona: ${brand.personaDescription}`);
      provenance.push({
        layer: 2,
        source: "channel_persona",
        directive: brand.personaDescription,
      });
    }
    if (brand.personaImageAttached) {
      provenance.push({
        layer: 2,
        source: "channel_persona_image",
        directive:
          "Persona reference image attached as reference #2 (host's face).",
      });
    }
    if (brand.extraNotes) {
      composition.push(`Channel notes: ${brand.extraNotes}`);
      provenance.push({
        layer: 2,
        source: "channel_brand",
        directive: brand.extraNotes,
      });
    }
  }

  /**
   * ── Product branding ──────────────────────────────────────────────────────
   * `logoSubject` reached this function since the brief compiler was written
   * and was then DROPPED ON THE FLOOR: nothing read it, so no rendered prompt
   * ever mentioned the product. (The old `buildProgrammaticPrompt` did emit a
   * logo line; the brief path that replaced it did not.) That is the whole of
   * "I don't see really any proper branding of the software".
   *
   * The archetype's `features_logo` flag now controls PROMINENCE (inline in the
   * headline lockup) rather than whether branding happens at all — only 1 of
   * the 10 curated archetypes sets it, and the owner wants the product legible
   * on every tutorial thumbnail, not on one in ten.
   */
  let branding: string | null = null;
  if (brand?.logoSubject?.trim()) {
    branding = brandingDirective(brand.logoSubject, brand.featuresLogo);
    if (branding) {
      provenance.push({
        layer: 2,
        source: "logo_subject",
        directive: branding,
      });
    }
  }

  // ── Layer 3: video specifics ──────────────────────────────────────────────
  const subject = input.topic?.trim() || input.title.trim();
  provenance.push({
    layer: 3,
    source: "video",
    directive: `Topic: ${subject}`,
  });
  /**
   * Archetype prose no longer joins `composition[]` as two giant atoms — see
   * the note on `archetypeGuidance`. It is split into sentences and rendered
   * FIRST among the optional directives, so a squeeze costs the tail of the
   * template description rather than all of it.
   */
  const archetypeGuidance: string[] = [];
  if (input.archetypeLayoutInstructions?.trim()) {
    archetypeGuidance.push(
      ...splitDirectives(input.archetypeLayoutInstructions.trim()),
    );
    provenance.push({
      layer: 3,
      source: "archetype",
      directive: input.archetypeLayoutInstructions,
    });
  }
  if (input.archetypeBasePrompt?.trim()) {
    archetypeGuidance.push(
      ...splitDirectives(input.archetypeBasePrompt.trim()),
    );
    provenance.push({
      layer: 3,
      source: "archetype",
      directive: input.archetypeBasePrompt,
    });
  }

  return {
    rulesVersion: rule?.rules_version ?? THUMBNAIL_RULES_VERSION,
    format: input.format,
    channelId: input.channelId,
    headline: input.headline,
    headlineSource: input.headlineSource,
    subject,
    subjectScale:
      scaleMin !== null && scaleMax !== null ? [scaleMin, scaleMax] : null,
    layoutArchetype,
    emotion,
    gaze,
    palette,
    composition,
    textPolicy: {
      maxWords,
      placement: rule?.text_policy ?? DEFAULT_TEXT_PLACEMENT,
      treatment: compositeText
        ? "generate text-free; headline composited afterwards"
        : "render the headline in-image, blocky sans, thick stroke or filled plate",
    },
    compositeText,
    negatives,
    personaImageAttached: brand?.personaImageAttached === true,
    personaDescription: brand?.personaDescription ?? null,
    branding,
    archetypeGuidance,
    provenance,
  };
}

/**
 * Deterministic prompt renderer — replaces buildProgrammaticPrompt. Keeps the
 * reference-matching preamble (what makes i2i work) and appends the compiled
 * doctrine. When `compositeText` is true the headline is NOT sent to the model:
 * it generates a text-free image with reserved negative space and the
 * compositor burns the type in afterwards (plan §A5.2, B7).
 */
/**
 * Hard prompt ceiling of every backend that can serve a REFERENCED image
 * request: veo_fleet, veoforge and vup all reject above 2000 characters. The
 * engine used to slice at 5000, so a fully-compiled brief was submitted and
 * bounced at the transport — two of the most recent production failures read
 * literally "VEO Fleet: prompt exceeds 2000 char limit (2095)". Adding the
 * persona directives makes that certain rather than likely, so the renderer
 * now budgets instead of overflowing.
 */
export const DEFAULT_PROMPT_BUDGET_CHARS = 2000;

export interface RenderProgrammaticOptions {
  /** Character ceiling. Optional directives are dropped to fit; the
   *  reference/topic/headline/persona directives never are. */
  maxChars?: number;
}

export function renderProgrammatic(
  brief: ThumbnailBrief,
  opts: RenderProgrammaticOptions = {},
): string {
  const budget = Math.max(200, opts.maxChars ?? 5000);
  /**
   * Two tiers. `required` is what makes the generation correct at all: which
   * reference is which, the topic, the headline, and the persona instructions.
   * `optional` is doctrine and styling advice — valuable, but a thumbnail
   * missing "at most 3 hues" is a worse thumbnail, whereas a thumbnail missing
   * "the second image is the host" is the WRONG thumbnail.
   *
   * Optional directives are dropped LAST-FIRST, and the Layer-0 global doctrine
   * (generic best practice, ~900 chars of the fat) is deliberately ordered last
   * so channel-, format- and archetype-specific guidance survives longest.
   */
  const lines: string[] = [];
  if (brief.personaImageAttached) {
    // TWO references are attached, and an unaddressed second image is treated
    // as decoration by every i2i model we route to — so the prompt names each
    // one and states its job. Wording adapted from the operator's own
    // thumbnail tool (20260224 Thumbnail Creator, lib/payload-engine.ts), which
    // is the version known to produce the right host.
    lines.push(
      "You are given TWO reference images. The FIRST reference image is the STYLE reference: match its visual style, layout and composition, at high contrast. The SECOND reference image is the CHANNEL HOST — the ONE person who must appear in this thumbnail.",
    );
    lines.push(
      "Replace the character in the first reference image with the person from the second reference image. Match their pose and position. Keep their face, hair, skin tone and build exactly as in the host reference — this is a specific real person, not an interpretation.",
    );
  } else {
    lines.push(
      "Create a YouTube thumbnail matching the reference image's visual style, layout and composition, at high contrast.",
    );
  }

  /**
   * ── Exactly one person ────────────────────────────────────────────────────
   * Verbatim: "In a thumbnail there should only be one person so when making
   * the prompt write in singular."
   *
   * The old wording was plural-friendly at every turn — "replace ANY character",
   * "the real person who must appear" — and image models happily read that as a
   * licence to add a colleague, a second pointing hand, or a face on the screen.
   * This line is REQUIRED (never budget-dropped) and is emitted whenever a host
   * is involved at all, with or without a reference photo: the no-photo path was
   * the one with no singular instruction anywhere.
   *
   * It is deliberately conditional on there being a persona rather than global —
   * TECH_COMPARISON and LONG_FORM_DRAMA legitimately frame two subjects, and a
   * format with no host must not inherit a rule written for hosted formats. A
   * hostless format that still wants this states it in its own rule negatives.
   */
  if (brief.personaImageAttached || brief.personaDescription) {
    lines.push(
      "EXACTLY ONE PERSON is in the finished image — the host, alone. No second person, no extra face anywhere in the frame, no extra hands.",
    );
  }
  lines.push(
    `Completely disregard and replace the ${
      brief.personaImageAttached ? "first " : ""
    }reference thumbnail's original topic. New topic: "${brief.subject}".`,
  );

  if (brief.headline && brief.textPolicy.maxWords > 0 && !brief.compositeText) {
    // A format that stated its own text policy has already described its
    // typography; appending the generic treatment sentence as well says the
    // same thing twice and costs ~70 characters of a 2000-char budget that the
    // AVOID list needs more.
    const typography =
      brief.textPolicy.placement === DEFAULT_TEXT_PLACEMENT
        ? `${brief.textPolicy.placement}, ${brief.textPolicy.treatment}`
        : brief.textPolicy.placement;
    lines.push(
      `Replace ONLY the main text with "${brief.headline}" (${typography}). Do not repeat the video title verbatim.`,
    );
  } else if (brief.compositeText) {
    lines.push(
      "Generate the image TEXT-FREE, leaving clean reserved negative space where a headline will be composited afterwards.",
    );
  } else {
    lines.push(
      "No overlay text — the composition carries the message (zero text is correct for this format).",
    );
  }

  if (brief.personaImageAttached) {
    lines.push(
      "Do NOT copy the second reference image's background, framing, text or styling — take ONLY the person from it.",
    );
  }
  /**
   * Lighting used to be slaved to the reference image ("Match the reference
   * image's lighting"). Nine of the ten curated tutorial archetypes are dark
   * images, so that instruction re-imposed darkness on every generation no
   * matter what the palette said — and the palette line itself sat in the
   * droppable tier, where the 2000-char budget usually deleted it. Both halves
   * of "they are way too dark on average" live in that sentence. Palette is now
   * REQUIRED and it, not the reference, decides the lighting.
   */
  /**
   * The trailing "Match the reference image's composition and visual energy"
   * was cut on 2026-08-06: the opening line of the prompt already says to match
   * the style reference's layout and composition, so those 82 characters bought
   * nothing — and they were 82 characters the archetype's own template
   * description needed. "at high contrast" moved up to the opening line, which
   * is the only part of the sentence that was not already stated.
   */
  lines.push(
    `Lighting and colour come from this palette, NOT from the reference image: ${brief.palette.guidance}`,
  );

  /**
   * Product branding is REQUIRED, not advice. "The logos are way too small and
   * from afar I really can't see ... what software the tutorial is about" is a
   * click lost before the design is even judged, so this line outranks every
   * piece of doctrine below it. When no product was supplied we still say the
   * general thing — without naming a brand we were not given.
   */
  lines.push(brief.branding ?? BRANDING_FROM_TOPIC_FALLBACK);

  /**
   * The archetype's OPENING sentence is required too. Its first sentence is
   * always the one that says what kind of image this is ("Canvas 16:9, warm
   * off-white / cream flat background — never … a screen inset"), and whether
   * it survived used to depend on how long the video's title happened to be.
   * A template that only applies to short titles is not a template.
   */
  const [leadGuidance, ...restGuidance] = brief.archetypeGuidance;
  if (leadGuidance) lines.push(leadGuidance);

  /**
   * ── The AVOID core is REQUIRED ────────────────────────────────────────────
   * It used to live entirely in the droppable tier, sized from whatever the
   * required lines left over. That worked until the required lines grew — after
   * the 2026-08-06 branding and palette rewrites the leftover was under the
   * floor, so `take()` refused the line and the prompt shipped with NO avoid
   * list at all. Silently: the renderer had no way to say "I dropped your
   * rejections".
   *
   * These items are not style advice. Each one is a thumbnail the owner looked
   * at and rejected, so the first few now outrank the archetype's tail. The
   * remainder stays elastic below.
   */
  const AVOID_CORE_ITEMS = 3;
  const coreNegatives = brief.negatives.slice(0, AVOID_CORE_ITEMS);
  if (coreNegatives.length) {
    lines.push(`AVOID: ${coreNegatives.join("; ")}.`);
  }

  /**
   * ── Optional, dropped last-first when the budget bites ────────────────────
   *
   * ORDER IS THE POLICY. Most specific first, generic doctrine last:
   *   1. the hard negatives — circles, crowds, orange, dark fields. These are
   *      the owner's literal rejections, so the line is ELASTIC (items drop
   *      from the tail) rather than all-or-nothing: an AVOID list that does not
   *      fit is exactly how "no circular inset" failed to reach the model.
   *   2. the archetype's own template description (Layer 3) — the thing the
   *      reference image is FOR. This used to sit second-to-last and be dropped
   *      whole; see `archetypeGuidance`. It is sentence-sized now, so it fills
   *      whatever space is left instead of needing all ~1200 chars at once.
   *   3. format/channel composition prose.
   *   4. scale / archetype name / emotion — cheap labels, easy to lose.
   *   5. Layer-0 global doctrine, which every format shares and is the most
   *      replaceable ~900 characters in the brief.
   */
  const requiredLength = lines.join("\n").length;
  const optional: string[] = [];
  const restNegatives = brief.negatives.slice(AVOID_CORE_ITEMS);
  if (restNegatives.length) {
    // The tail of the list, elastic. Bounded so a long negatives array cannot
    // starve the archetype description; the DB order is most-important-first,
    // so what gets cut here is what matters least.
    const room = Math.max(120, Math.floor((budget - requiredLength) * 0.4));
    const kept: string[] = [];
    for (const n of restNegatives) {
      const next = [...kept, n];
      if (`Also avoid: ${next.join("; ")}.`.length > room && kept.length >= 1) {
        break;
      }
      kept.push(n);
    }
    optional.push(`Also avoid: ${kept.join("; ")}.`);
  }
  const doctrine = new Set<string>(GLOBAL_DOCTRINE);
  optional.push(...brief.composition.filter((c) => !doctrine.has(c)));
  if (brief.subjectScale) {
    optional.push(
      `Subject occupies roughly ${Math.round(brief.subjectScale[0] * 100)}-${Math.round(
        brief.subjectScale[1] * 100,
      )}% of the frame.`,
    );
  }
  optional.push(`Layout archetype: ${brief.layoutArchetype}.`);
  optional.push(`Emotion register: ${brief.emotion}. Gaze: ${brief.gaze}.`);
  optional.push(...brief.composition.filter((c) => doctrine.has(c)));

  let length = requiredLength;
  const take = (line: string): boolean => {
    if (length + 1 + line.length > budget) return false;
    lines.push(line);
    length += 1 + line.length;
    return true;
  };

  // The remaining negatives first — sized to fit above.
  for (const line of optional.splice(0, restNegatives.length ? 1 : 0)) {
    take(line);
  }
  /**
   * Archetype prose is emitted IN ORDER and stops at the first sentence that
   * does not fit. A greedy fill would print sentence 3 of a layout description
   * without sentence 2 — a template read out of order is a different template.
   */
  for (const line of restGuidance) {
    if (!take(line)) break;
  }
  // Everything else is independent advice, so greedy packing is fine.
  for (const line of optional) take(line);

  return lines.join("\n").trim().slice(0, budget);
}

/**
 * What the budget cut, so a squeeze is reportable instead of silent.
 *
 * At 2000 characters, with two reference images and a face-fidelity block to
 * pay for, a 1200-character archetype description does not fit and never has —
 * the reference IMAGE is what carries the template, and the endorsed
 * Search-Intent thumbnails were generated with its prose absent. That is an
 * acceptable trade, but it must be an OBSERVED one: this codebase's recurring
 * failure is not dropping things, it is dropping them where nobody can see.
 */
export function promptOmissions(
  brief: ThumbnailBrief,
  prompt: string,
): { archetypeSentencesDropped: number; negativesDropped: number } {
  return {
    archetypeSentencesDropped: brief.archetypeGuidance.filter(
      (g) => !prompt.includes(g),
    ).length,
    negativesDropped: brief.negatives.filter((n) => !prompt.includes(n)).length,
  };
}

export interface DeriveHeadlineResult {
  headline: string | null;
  source: "operator" | "derived" | "title_fallback" | "none";
}

/**
 * Reduce a video title to a thumbnail headline that COMPLEMENTS it (same
 * promise, different words), per DECISIONS §3.2.4 and plan §B3. Order:
 *   1. text_max_words === 0  -> null (legal and often correct — §A5.2)
 *   2. operator typed a headline -> preserve its intent, enforce the word cap
 *   3. else LLM: <= maxWords words carrying the curiosity gap, NOT the title
 *   4. LLM unavailable -> title_fallback (RECORDED + surfaced, never silent)
 *
 * `llm` is injected so this is unit-testable; pass the real requestLLMText
 * wrapper in production.
 *
 * Every non-empty path now runs through `condenseHeadline`. Asking a model for
 * three words and printing whatever it returns is how "Sage Accounting Painless
 * Month Ends" reached a thumbnail; the mechanical pass is what makes the ceiling
 * real. Operator text keeps priority, but it cannot bypass the layout's hard
 * maximum (three words for tutorial thumbnails).
 */
export async function deriveHeadline(args: {
  title: string;
  operatorHeadline: string | null;
  maxWords: number;
  textPolicy: string | null;
  format: string;
  /** The product whose logo shares the frame; its name is stripped from the
   *  headline unless the phrase collapses without it. */
  logoSubject?: string | null;
  llm?: (prompt: string) => Promise<string>;
}): Promise<DeriveHeadlineResult> {
  if (args.maxWords <= 0) return { headline: null, source: "none" };
  const condense = (text: string): string =>
    condenseHeadline(text, {
      maxWords: args.maxWords,
      logoSubject: args.logoSubject ?? null,
    });
  const op = args.operatorHeadline?.trim();
  if (op) return { headline: condense(op), source: "operator" };
  // The fallback is a CONDENSED title, not the first N words of it. Still
  // recorded as `title_fallback` so the UI keeps badging it (standing rule §0)
  // — the label describes where the words came from, not how good they are.
  const fallback = (): DeriveHeadlineResult => ({
    headline: condense(args.title) || trimWords(args.title, args.maxWords),
    source: "title_fallback",
  });

  if (!args.llm) return fallback();
  try {
    const raw = await args.llm(
      headlineInstructions({
        title: args.title,
        maxWords: args.maxWords,
        logoSubject: args.logoSubject ?? null,
        textPolicy: args.textPolicy,
      }),
    );
    const cleaned = condense(raw.split("\n").find((l) => l.trim()) ?? raw);
    if (!cleaned) return fallback();
    return { headline: cleaned, source: "derived" };
  } catch {
    return fallback();
  }
}

function trimWords(text: string, maxWords: number): string {
  return text.trim().split(/\s+/).slice(0, maxWords).join(" ");
}
