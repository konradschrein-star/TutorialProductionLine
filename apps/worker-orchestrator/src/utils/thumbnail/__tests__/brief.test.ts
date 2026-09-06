import { describe, it, expect } from "vitest";
import {
  compileThumbnailBrief,
  renderProgrammatic,
  deriveHeadline,
  GLOBAL_DOCTRINE,
  DEFAULT_PROMPT_BUDGET_CHARS,
  type FormatRuleLike,
} from "../brief.js";

const vsRule: FormatRuleLike = {
  format: "TECH_COMPARISON",
  display_name: "Tech Comparison",
  layout_archetype: "split_vs",
  composition: ["Split 50/50, divider tilted 5-10 degrees"],
  subject_scale_min: "0.350",
  subject_scale_max: "0.450",
  text_max_words: 0,
  composite_text: false,
  text_policy: null,
  subject_policy: "Challenger on the right",
  palette_policy: "Left blue / right red",
  emotion_register: "authentic",
  gaze_policy: "none",
  signature_element: "VS mark >=15% of frame",
  negatives: ["overlay headline text"],
  authoring_notes: null,
  rules_version: "v1",
};

describe("compileThumbnailBrief", () => {
  it("always includes the global doctrine (Layer 0)", () => {
    const brief = compileThumbnailBrief({
      format: "OTHER",
      channelId: null,
      title: "Some Title",
      headline: null,
      headlineSource: "none",
      topic: null,
      scriptExcerpt: null,
      rule: null,
      brand: null,
      archetypeLayoutInstructions: null,
      archetypeBasePrompt: null,
    });
    for (const d of GLOBAL_DOCTRINE) expect(brief.composition).toContain(d);
    expect(brief.provenance.some((p) => p.layer === 0)).toBe(true);
  });

  it("carries format rules and marks their provenance (Layer 1)", () => {
    const brief = compileThumbnailBrief({
      format: "TECH_COMPARISON",
      channelId: "c1",
      title: "iPhone vs Pixel",
      headline: null,
      headlineSource: "none",
      topic: "phone comparison",
      scriptExcerpt: null,
      rule: vsRule,
      brand: null,
      archetypeLayoutInstructions: null,
      archetypeBasePrompt: null,
    });
    expect(brief.layoutArchetype).toBe("split_vs");
    expect(brief.textPolicy.maxWords).toBe(0);
    expect(brief.negatives).toContain("overlay headline text");
    expect(brief.subjectScale).toEqual([0.35, 0.45]);
    expect(
      brief.provenance.some(
        (p) => p.layer === 1 && p.source.includes("TECH_COMPARISON"),
      ),
    ).toBe(true);
  });

  it("folds channel brand into palette + composition (Layer 2)", () => {
    const brief = compileThumbnailBrief({
      format: "OTHER",
      channelId: "c1",
      title: "T",
      headline: "Hook",
      headlineSource: "derived",
      topic: null,
      scriptExcerpt: null,
      rule: null,
      brand: {
        personaDescription: "A calm bearded host",
        extraNotes: "keep it minimal",
        primaryColor: "#ff0000",
        secondaryColor: null,
        logoSubject: null,
        featuresLogo: false,
      },
      archetypeLayoutInstructions: null,
      archetypeBasePrompt: null,
    });
    expect(brief.palette.primary).toBe("#ff0000");
    expect(brief.composition.some((c) => c.includes("calm bearded host"))).toBe(
      true,
    );
    expect(brief.provenance.some((p) => p.layer === 2)).toBe(true);
  });
});

describe("renderProgrammatic", () => {
  it("emits a text-free instruction when maxWords is 0", () => {
    const brief = compileThumbnailBrief({
      format: "TECH_COMPARISON",
      channelId: null,
      title: "iPhone vs Pixel",
      headline: null,
      headlineSource: "none",
      topic: "phone comparison",
      scriptExcerpt: null,
      rule: vsRule,
      brand: null,
      archetypeLayoutInstructions: null,
      archetypeBasePrompt: null,
    });
    const prompt = renderProgrammatic(brief);
    expect(prompt).toContain("No overlay text");
    expect(prompt).toContain("split_vs");
    expect(prompt).toContain("AVOID:");
  });

  it("injects the headline but tells the model not to repeat the title", () => {
    const brief = compileThumbnailBrief({
      format: "OTHER",
      channelId: null,
      title: "How I Built a $2M Faceless Channel",
      headline: "The Silent Money Machine",
      headlineSource: "derived",
      topic: null,
      scriptExcerpt: null,
      rule: null,
      brand: null,
      archetypeLayoutInstructions: null,
      archetypeBasePrompt: null,
    });
    const prompt = renderProgrammatic(brief);
    expect(prompt).toContain("The Silent Money Machine");
    expect(prompt).toContain("Do not repeat the video title");
  });

  it("locks localized tutorial copy to two lines and its explicit language", () => {
    const brief = compileThumbnailBrief({
      format: "TUTORIAL_STUDIO",
      channelId: "channel-de",
      language: "de",
      title: "Notion richtig einrichten",
      headline: "NOTION RICHTIG\nIN 2 MINUTEN",
      headlineSource: "operator",
      topic: null,
      scriptExcerpt: null,
      rule: null,
      brand: null,
      archetypeLayoutInstructions: null,
      archetypeBasePrompt: null,
    });
    const prompt = renderProgrammatic(brief);
    expect(prompt).toContain(
      'exactly two lines: LINE 1 "NOTION RICHTIG"; LINE 2 "IN 2 MINUTEN"',
    );
    expect(prompt).toContain("language de");
    expect(prompt).toContain("Do not merge, translate, or repeat either line");
  });
  it("fits the 2000-char backend ceiling with a full brief + persona, keeping the load-bearing directives", () => {
    // The regression this pins: veo_fleet/veoforge/vup REJECT prompts over
    // 2000 chars, and production died on exactly that ("prompt exceeds 2000
    // char limit (2095)"). The persona directives make the prompt longer, so
    // the renderer must budget rather than overflow.
    const brief = compileThumbnailBrief({
      format: "TECH_COMPARISON",
      channelId: "c1",
      title: "The best CRM for small agencies in 2026",
      headline: "Nobody Expected This",
      headlineSource: "derived",
      topic: "CRM shootout",
      scriptExcerpt: null,
      rule: vsRule,
      brand: {
        personaDescription:
          "A calm bearded host in his late thirties, dark hair, navy jacket, warm studio lighting",
        personaImageAttached: true,
        extraNotes:
          "Always keep the channel wordmark bottom-left and never use pure black backgrounds",
        primaryColor: "#ff0044",
        secondaryColor: "#00d4ff",
        logoSubject: null,
        featuresLogo: false,
      },
      archetypeLayoutInstructions:
        "Two products facing each other with a lightning bolt between them",
      archetypeBasePrompt:
        "Glossy studio product photography, dramatic rim light",
    });

    const unbudgeted = renderProgrammatic(brief);
    expect(unbudgeted.length).toBeGreaterThan(DEFAULT_PROMPT_BUDGET_CHARS);

    const budgeted = renderProgrammatic(brief, {
      maxChars: DEFAULT_PROMPT_BUDGET_CHARS,
    });
    expect(budgeted.length).toBeLessThanOrEqual(DEFAULT_PROMPT_BUDGET_CHARS);
    // What survives a squeeze is what makes the image CORRECT, not the
    // generic doctrine.
    expect(budgeted).toContain("TWO reference images");
    expect(budgeted).toContain("Replace the character in the first reference");
    expect(budgeted).toContain("CRM shootout");
    expect(budgeted).toContain("take ONLY the person from it");
  });

  it("names both references when a persona image is attached", () => {
    const brief = compileThumbnailBrief({
      format: "OTHER",
      channelId: "c1",
      title: "Docker in 5 minutes",
      headline: "Ship It Faster",
      headlineSource: "derived",
      topic: null,
      scriptExcerpt: null,
      rule: null,
      brand: {
        personaDescription: "A calm bearded host",
        personaImageAttached: true,
        extraNotes: null,
        primaryColor: null,
        secondaryColor: null,
        logoSubject: null,
        featuresLogo: false,
      },
      archetypeLayoutInstructions: null,
      archetypeBasePrompt: null,
    });
    expect(brief.personaImageAttached).toBe(true);
    const prompt = renderProgrammatic(brief);
    // The model must be told which image is which; an unaddressed second
    // reference is treated as decoration and the host silently vanishes.
    expect(prompt).toContain("TWO reference images");
    expect(prompt).toContain("FIRST reference image");
    expect(prompt).toContain("SECOND reference image");
    expect(prompt).toContain("Match their pose and position");
    expect(prompt).toContain("take ONLY the person from it");
  });

  it("keeps the single-reference wording when no persona image is attached", () => {
    const brief = compileThumbnailBrief({
      format: "OTHER",
      channelId: "c1",
      title: "Docker in 5 minutes",
      headline: "Ship It Faster",
      headlineSource: "derived",
      topic: null,
      scriptExcerpt: null,
      rule: null,
      brand: {
        personaDescription: "A calm bearded host",
        extraNotes: null,
        primaryColor: null,
        secondaryColor: null,
        logoSubject: null,
        featuresLogo: false,
      },
      archetypeLayoutInstructions: null,
      archetypeBasePrompt: null,
    });
    expect(brief.personaImageAttached).toBe(false);
    const prompt = renderProgrammatic(brief);
    expect(prompt).not.toContain("TWO reference images");
    expect(prompt).toContain(
      "Create a YouTube thumbnail matching the reference image",
    );
  });
});

/**
 * ── The 2026-08-05 rejection ────────────────────────────────────────────────
 * The owner rejected 30 generated tutorial thumbnails. These tests pin the
 * invariants his eight complaints translate into, rendered against the ACTUAL
 * TUTORIAL_STUDIO row now in production (copied verbatim below — if the DB row
 * is edited and these strings are not, that is the signal to re-read both).
 */
const tutorialRule: FormatRuleLike = {
  format: "TUTORIAL_STUDIO",
  display_name: "Tutorial",
  layout_archetype: "white_headline_left_host_right",
  composition: [
    "Exactly three elements: the headline, the product logo, the host. Nothing else — no icons, no badges, no chips, no sparkles, no decorative shapes.",
    "The headline is the largest graphic element. If it does not fit, cut words, never shrink the type.",
    "If any software UI appears, it is ONE cropped panel large enough to read, never a full dense screenshot.",
  ],
  subject_scale_min: "0.300",
  subject_scale_max: "0.450",
  text_max_words: 4,
  composite_text: false,
  text_policy:
    "2-4 words, 3 ideal. Set it HUGE — the biggest element after the host. Near-black on white, or white on one brand-colour block.",
  subject_policy:
    "ONE person: the host, a real photograph, cut out in the right third, waist-up, facing camera, pointing at the headline or the logo. Never illustrated, never in a circle.",
  palette_policy:
    "Flat WHITE background: not cream, beige, off-white, tinted or gradient. Brand colour only on the logo, the type and one accent block. Near-black type. One red arrow allowed.",
  emotion_register: "authentic",
  gaze_policy: "direct",
  signature_element:
    "ONE official product logo at giant size — a fifth of the frame wide or more, accurately drawn, never cropped, and the only logo present.",
  negatives: [
    "cream, beige, off-white, tinted or gradient backgrounds",
    "any logo but the named product's",
    "the product name set as text beside its own logo",
    "a cartoon, comic or illustrated person — the host is a photograph",
    "decorative icons, badges, chips, ribbons or sparkles",
    "more than four words of text",
    "a circle, oval or bubble around the person",
    "a second person, face or hand",
    "busy backgrounds: dense screenshots, circuits, bokeh, particles",
    "small or cropped logos",
    "dark backgrounds",
    "orange outside an official logo",
  ],
  authoring_notes: null,
  rules_version: "v3-white",
};

/** The real host description on the three tutorial channels, and the real
 *  endorsed archetype's prose — so the budget maths under test is the
 *  production one, not a toy. */
const HOST =
  "Latino man in his mid-to-late 40s: short dark wavy hair, clean-shaven, warm open smile, brown eyes, medium build, wearing a beige/taupe quarter-zip knit sweater over a white collared shirt against a plain white studio background.";
const SEARCH_INTENT_LAYOUT =
  "Canvas 16:9, clean flat white background — never a dark or textured tech background, and never a screen inset. LEFT TWO-THIRDS: headline stacked on three lines, maximum two words per line, very large heavy condensed sans, all caps. Line 1 dark navy (verb, e.g. LEARN). Line 2 bright blue (product name). Line 3 dark navy (product name continued). The product logo sits INLINE inside the text block, immediately left of the final line, baseline-aligned with it — it must read as part of the lockup, not as a floating sticker.";

function tutorialBrief(over: { logoSubject?: string | null } = {}) {
  return compileThumbnailBrief({
    format: "TUTORIAL_STUDIO",
    channelId: "3906701a-61ce-4022-91e6-1268d27ef2d7",
    title: "Learn Google Slides Beginners Tutorial",
    headline: "Learn Google Slides Fast",
    headlineSource: "derived",
    topic: "Google Slides beginners walkthrough",
    scriptExcerpt: null,
    rule: tutorialRule,
    brand: {
      personaDescription: HOST,
      personaImageAttached: true,
      extraNotes: null,
      primaryColor: null,
      secondaryColor: null,
      logoSubject:
        over.logoSubject === undefined ? "Google Slides" : over.logoSubject,
      featuresLogo: true,
    },
    archetypeLayoutInstructions: SEARCH_INTENT_LAYOUT,
    archetypeBasePrompt:
      "Recreate this exact thumbnail layout and palette for a new topic. Keep the flat white background with no screen inset, no device, no gradient and no background texture.",
  });
}

describe("TUTORIAL_STUDIO prompt invariants (owner review 2026-08-05)", () => {
  const prompt = renderProgrammatic(tutorialBrief(), {
    maxChars: DEFAULT_PROMPT_BUDGET_CHARS,
  });

  it("fits the backend ceiling", () => {
    expect(prompt.length).toBeLessThanOrEqual(DEFAULT_PROMPT_BUDGET_CHARS);
  });

  it("keeps the load-bearing reference/persona directives", () => {
    expect(prompt).toContain("TWO reference images");
    expect(prompt).toContain("Replace the character in the first reference");
    expect(prompt).toContain("take ONLY the person from it");
    expect(prompt).toContain("Google Slides beginners walkthrough");
  });

  it("demands exactly one person, in the singular", () => {
    expect(prompt).toContain("EXACTLY ONE PERSON");
    expect(prompt).toMatch(/No second person/);
    // No plural licence anywhere: the old wording was "replace ANY character".
    expect(prompt).not.toMatch(/any character/i);
  });

  it("never asks for a circle or an orange accent", () => {
    // "circle"/"orange" may only ever appear inside a PROHIBITION. Strip the
    // known prohibitions and nothing may remain — that is what catches a
    // future rule that quietly reintroduces either as a positive instruction.
    const prohibitions = [
      "a circle, oval or bubble around the person",
      "Never illustrated, never in a circle.",
      "orange outside an official logo",
    ];
    let residue = prompt;
    for (const p of prohibitions) residue = residue.split(p).join("");
    expect(residue).not.toMatch(/circul|oval|bubble/i);
    expect(residue).not.toMatch(/orange/i);
  });

  it("states the owner's three loudest rejections on EVERY generation", () => {
    // These three are the required AVOID core. They used to sit in the
    // droppable tier and, once the branding and palette lines grew on
    // 2026-08-06, the whole AVOID line stopped fitting and shipped absent —
    // silently. Whatever else the budget eats, these survive.
    expect(prompt).toContain("AVOID:");
    expect(prompt).toContain("cream, beige, off-white, tinted or gradient");
    expect(prompt).toContain("any logo but the named product's");
    expect(prompt).toContain(
      "the product name set as text beside its own logo",
    );
  });

  it("asks for a flat white field, sourced from the palette not the reference", () => {
    // "Why the fuck is the background this washed-out AI yellow? We do not want
    // that." / "Clear white background is better in my opinion."
    expect(prompt).toContain("NOT from the reference image");
    expect(prompt).toContain("Flat WHITE background");
    expect(prompt).not.toContain("reference image's lighting");
    // The v2 rule offered "a pale tint of the product's brand colour" as a
    // legal background. That clause IS the washed-out yellow.
    expect(prompt).not.toMatch(/pale tint/i);
  });

  it("does not let the endorsed archetype re-impose a cream field", () => {
    // Search-Intent #1's own prose opened "warm off-white / cream flat
    // background — never pure white", and it is a REQUIRED lead directive, so
    // it out-argued the palette on the channel that cycles it at weight 10.
    // Migration 0071 rewrites that sentence in the DB; this asserts the fixture
    // and the prompt agree that white won.
    expect(prompt).not.toMatch(/never pure white/i);
  });

  it("makes the product logo big and names the brand colour", () => {
    expect(prompt).toContain("Brand it as Google Slides");
    expect(prompt).toContain("a fifth of the frame wide");
    expect(prompt).toContain("Google Slides yellow");
    // features_logo=true upgrades placement to the headline lockup.
    expect(prompt).toContain("inline in the headline lockup");
  });

  it("still says something about branding when no product was supplied", () => {
    const p = renderProgrammatic(tutorialBrief({ logoSubject: null }), {
      maxChars: DEFAULT_PROMPT_BUDGET_CHARS,
    });
    expect(p).toContain("If the topic names a specific software product");
    // …but never invents a brand name.
    expect(p).not.toContain("Brand this thumbnail as");
  });

  it("keeps the archetype's own template description instead of dropping it whole", () => {
    // The regression: the endorsed Blink Blueprint archetype carries ~1200
    // chars of layout prose. As one atom it never fit, so prod thumbnail
    // 2e3b6544 was generated without a single word of it. Sentence atoms mean
    // the most important opening sentence always survives.
    expect(prompt).toContain("clean flat white background");
    expect(prompt).toContain("never a screen inset");
  });
});

describe("deriveHeadline", () => {
  it("returns null when the format allows zero text", async () => {
    const r = await deriveHeadline({
      title: "iPhone vs Pixel",
      operatorHeadline: null,
      maxWords: 0,
      textPolicy: null,
      format: "TECH_COMPARISON",
    });
    expect(r.headline).toBeNull();
    expect(r.source).toBe("none");
  });

  it("condenses an operator headline to meaningful thumbnail words", async () => {
    const r = await deriveHeadline({
      title: "T",
      operatorHeadline: "My Words",
      maxWords: 5,
      textPolicy: null,
      format: "OTHER",
      llm: async () => "SHOULD NOT BE USED",
    });
    expect(r.headline).toBe("Words");
    expect(r.source).toBe("operator");
  });

  it("falls back to a trimmed title (RECORDED, not silent) when no LLM", async () => {
    const r = await deriveHeadline({
      title: "This Is A Very Long Video Title That Cannot Fit",
      operatorHeadline: null,
      maxWords: 3,
      textPolicy: null,
      format: "OTHER",
    });
    expect(r.source).toBe("title_fallback");
    expect(r.headline!.split(" ")).toHaveLength(3);
  });

  it("derives a complementary headline from the LLM", async () => {
    const r = await deriveHeadline({
      title: "How To Learn Python Fast",
      operatorHeadline: null,
      maxWords: 4,
      textPolicy: "punchy",
      format: "TUTORIAL_STUDIO",
      llm: async () => "Zero To Hero",
    });
    expect(r.headline).toBe("Zero To Hero");
    expect(r.source).toBe("derived");
  });
});
