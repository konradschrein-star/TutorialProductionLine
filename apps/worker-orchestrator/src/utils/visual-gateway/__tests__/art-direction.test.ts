/**
 * The canonical art direction, and the prompt composer that applies it.
 *
 * These tests exist because of a named production complaint: generated imagery
 * for this format did not hold a consistent look. The cause was a per-request
 * prose description of the style. The guarantee these tests lock in is narrow
 * and specific:
 *
 *   - EVERY intent composes from the SAME style block (nothing per-intent
 *     restates the surface, palette, lighting or lens),
 *   - the hard negatives are present in EVERY prompt and come LAST,
 *   - an explicitly supplied prompt still wins verbatim,
 *   - a missing style plate degrades loudly to text-only rather than throwing.
 *
 * No network and no live API is touched. The filesystem is used only under a
 * per-test temp directory.
 */
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ART_DIRECTION_LENS,
  ART_DIRECTION_LIGHT,
  ART_DIRECTION_NEGATIVES,
  ART_DIRECTION_PALETTE,
  ART_DIRECTION_STYLE,
  ART_DIRECTION_SURFACE,
  ART_DIRECTION_VARIATIONS,
  BUSINESS_HUB_PALETTE,
  STYLE_GUIDE_MAX_BYTES,
  STYLE_GUIDE_PATH_ENV,
  STYLE_GUIDE_PROMPT,
  composeArtDirectedPrompt,
  loadStyleReference,
  styleGuidePath,
  variationFor,
} from "../art-direction.js";
import {
  composeGenerationPrompt,
  framingFor,
} from "../providers/generated.js";
import { VISUAL_INTENTS } from "../types.js";
import { makeRequest } from "./fixtures.js";

/**
 * Every image backend in the chain (veo_fleet, veoforge, vup) REJECTS a prompt
 * over 2000 characters — it does not truncate. See MAX_PROMPT_CHARS_BY_BACKEND
 * in `media-gateway/index.ts`. A prompt that overruns produces no image at all.
 */
const BACKEND_PROMPT_CEILING = 2000;

describe("ART_DIRECTION_STYLE — the one canonical block", () => {
  it("is exactly its four parts, in order", () => {
    expect(ART_DIRECTION_STYLE).toBe(
      [
        ART_DIRECTION_SURFACE,
        ART_DIRECTION_PALETTE,
        ART_DIRECTION_LIGHT,
        ART_DIRECTION_LENS,
      ].join(" "),
    );
  });

  it("names every ocean stop as an explicit hex value", () => {
    for (const hex of Object.values(BUSINESS_HUB_PALETTE)) {
      expect(ART_DIRECTION_STYLE).toContain(hex);
    }
  });

  it("forbids yellow and gold rather than merely omitting them", () => {
    expect(ART_DIRECTION_PALETTE).toMatch(/no yellow/i);
    expect(ART_DIRECTION_PALETTE).toMatch(/no gold/i);
    // The web product's gold. It must never reach a generated frame.
    expect(ART_DIRECTION_STYLE).not.toContain("#c9a24b");
  });

  it("bans the things the renderer owns", () => {
    for (const banned of [
      "text",
      "lettering",
      "logos",
      "watermarks",
      "people",
      "charts",
    ]) {
      expect(ART_DIRECTION_NEGATIVES.toLowerCase()).toContain(banned);
    }
  });
});

describe("composeArtDirectedPrompt", () => {
  it("orders the prompt subject → style → topic → framing → negatives", () => {
    const prompt = composeArtDirectedPrompt({
      subject: "a leather ledger",
      topic: "small business bookkeeping",
      framing: "Shot from directly above.",
    });

    const iSubject = prompt.indexOf("a leather ledger");
    const iStyle = prompt.indexOf(ART_DIRECTION_STYLE);
    const iTopic = prompt.indexOf("small business bookkeeping");
    const iFraming = prompt.indexOf("Shot from directly above.");
    const iNegatives = prompt.indexOf(ART_DIRECTION_NEGATIVES);

    expect(iSubject).toBe(0);
    expect(iStyle).toBeGreaterThan(iSubject);
    expect(iTopic).toBeGreaterThan(iStyle);
    expect(iFraming).toBeGreaterThan(iTopic);
    expect(iNegatives).toBeGreaterThan(iFraming);
    // Negatives are obeyed most reliably at the tail.
    expect(prompt.endsWith(ART_DIRECTION_NEGATIVES)).toBe(true);
  });

  it("omits an empty framing clause without leaving a double space", () => {
    const prompt = composeArtDirectedPrompt({
      subject: "a filing cabinet drawer",
      topic: "record keeping",
      framing: "",
    });
    expect(prompt).toContain(ART_DIRECTION_STYLE);
    expect(prompt).toContain(ART_DIRECTION_NEGATIVES);
    expect(prompt).not.toContain("  ");
  });

  it("throws on a blank subject rather than generating something arbitrary", () => {
    expect(() =>
      composeArtDirectedPrompt({ subject: "   ", topic: "t", framing: "" }),
    ).toThrow(/subject is empty/);
  });

  it("throws on a blank topic", () => {
    expect(() =>
      composeArtDirectedPrompt({ subject: "s", topic: "  ", framing: "" }),
    ).toThrow(/topic is empty/);
  });
});

describe("composeGenerationPrompt — every intent", () => {
  it("carries the canonical block and the negatives, for all intents", () => {
    for (const intent of VISUAL_INTENTS) {
      const prompt = composeGenerationPrompt(makeRequest({ intent }));
      expect(prompt, `intent ${intent} lost the style block`).toContain(
        ART_DIRECTION_STYLE,
      );
      expect(prompt, `intent ${intent} lost the negatives`).toContain(
        ART_DIRECTION_NEGATIVES,
      );
      expect(prompt.endsWith(ART_DIRECTION_NEGATIVES)).toBe(true);
    }
  });

  it("differs between intents ONLY by the framing clause", () => {
    for (const intent of VISUAL_INTENTS) {
      const prompt = composeGenerationPrompt(makeRequest({ intent }));
      const framing = framingFor(intent);
      const stripped =
        framing.length > 0 ? prompt.replace(` ${framing}`, "") : prompt;
      // Once the intent's own clause is removed, every intent is identical.
      expect(stripped).toBe(
        composeGenerationPrompt(makeRequest({ intent: "document" })),
      );
    }
  });

  it("fits inside the backend prompt ceiling for every intent", () => {
    for (const intent of VISUAL_INTENTS) {
      const prompt = composeGenerationPrompt(makeRequest({ intent }));
      expect(
        prompt.length,
        `intent ${intent} prompt is ${prompt.length} chars`,
      ).toBeLessThanOrEqual(BACKEND_PROMPT_CEILING);
    }
  });

  it("lets a supplied prompt win verbatim", () => {
    const supplied = "an entirely different picture, by explicit request";
    const prompt = composeGenerationPrompt(
      makeRequest({ intent: "prop-plate", generationPrompt: supplied }),
    );
    expect(prompt).toBe(supplied);
    expect(prompt).not.toContain(ART_DIRECTION_STYLE);
  });

  it("ignores a whitespace-only supplied prompt and composes instead", () => {
    const prompt = composeGenerationPrompt(
      makeRequest({ intent: "prop-plate", generationPrompt: "   " }),
    );
    expect(prompt).toContain(ART_DIRECTION_STYLE);
  });
});

describe("STYLE_GUIDE_PROMPT", () => {
  it("is built from the same canonical block it will anchor", () => {
    expect(STYLE_GUIDE_PROMPT).toContain(ART_DIRECTION_STYLE);
    expect(STYLE_GUIDE_PROMPT.endsWith(ART_DIRECTION_NEGATIVES)).toBe(true);
  });

  it("depicts the business-plan props, not an abstraction", () => {
    for (const prop of ["documents", "calculator", "pen", "coffee cup"]) {
      expect(STYLE_GUIDE_PROMPT.toLowerCase()).toContain(prop);
    }
  });

  it("fits inside the backend prompt ceiling", () => {
    expect(STYLE_GUIDE_PROMPT.length).toBeLessThanOrEqual(
      BACKEND_PROMPT_CEILING,
    );
  });
});

describe("style reference resolution", () => {
  let dir: string;
  const savedMediaRoot = process.env["LOCAL_MEDIA_ROOT"];
  const savedOverride = process.env[STYLE_GUIDE_PATH_ENV];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bph-style-"));
    process.env["LOCAL_MEDIA_ROOT"] = dir;
    delete process.env[STYLE_GUIDE_PATH_ENV];
  });

  afterEach(async () => {
    if (savedMediaRoot === undefined) delete process.env["LOCAL_MEDIA_ROOT"];
    else process.env["LOCAL_MEDIA_ROOT"] = savedMediaRoot;
    if (savedOverride === undefined) delete process.env[STYLE_GUIDE_PATH_ENV];
    else process.env[STYLE_GUIDE_PATH_ENV] = savedOverride;
    await rm(dir, { recursive: true, force: true });
  });

  it("defaults to the well-known path under LOCAL_MEDIA_ROOT", () => {
    expect(styleGuidePath()).toBe(
      join(dir, "style-assets", "business-hub", "style-guide.png"),
    );
  });

  it("is overridable by env", () => {
    const custom = join(dir, "elsewhere", "plate.png");
    process.env[STYLE_GUIDE_PATH_ENV] = custom;
    expect(styleGuidePath()).toBe(custom);
  });

  it("returns no reference — and does not throw — when the plate is absent", async () => {
    await expect(loadStyleReference()).resolves.toEqual([]);
  });

  it("returns a data URI when the plate exists", async () => {
    const path = styleGuidePath();
    await mkdir(join(dir, "style-assets", "business-hub"), { recursive: true });
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await writeFile(path, bytes);

    const refs = await loadStyleReference();
    expect(refs).toHaveLength(1);
    expect(refs[0]).toBe(`data:image/png;base64,${bytes.toString("base64")}`);
  });

  it("drops a plate the backend would reject for size, instead of failing the render", async () => {
    const path = styleGuidePath();
    await mkdir(join(dir, "style-assets", "business-hub"), { recursive: true });
    await writeFile(path, Buffer.alloc(STYLE_GUIDE_MAX_BYTES + 1));

    await expect(loadStyleReference()).resolves.toEqual([]);
  });

  it("refuses an extension it cannot label with a mime type", async () => {
    const custom = join(dir, "plate.tiff");
    process.env[STYLE_GUIDE_PATH_ENV] = custom;
    await writeFile(custom, Buffer.from([0x49, 0x49]));

    await expect(loadStyleReference()).resolves.toEqual([]);
  });
});

/**
 * Per-beat variation — the fix for "the same plate repeats ten times in a row"
 * (Konrad on the 2026-08-16 v2 render).
 *
 * The guarantee has two halves and they pull in opposite directions, which is
 * why both are locked in here: consecutive beats must ask for VISIBLY DIFFERENT
 * pictures, and the style block that keeps the catalogue coherent must not move
 * a single character while they do.
 */
describe("variationFor / per-beat staging", () => {
  it("gives consecutive beats different staging", () => {
    const run = [0, 1, 2, 3, 4, 5].map((i) => variationFor(i));
    expect(new Set(run).size).toBe(run.length);
  });

  it("is deterministic, so a re-render is the same video", () => {
    expect(variationFor(3)).toBe(variationFor(3));
    expect(variationFor(3)).toBe(variationFor(3 + ART_DIRECTION_VARIATIONS.length));
  });

  it("rejects a fractional or negative index instead of moduloing into a surprise", () => {
    expect(() => variationFor(-1)).toThrow(/non-negative integer/);
    expect(() => variationFor(1.5)).toThrow(/non-negative integer/);
  });

  it("varies only camera and staging — never the canonical style block", () => {
    for (let i = 0; i < ART_DIRECTION_VARIATIONS.length; i++) {
      const clause = ART_DIRECTION_VARIATIONS[i]!;
      // Style drift is the failure this whole file exists to prevent. A
      // variation that restated surface, palette, light or lens would reopen it.
      for (const styleWord of [
        "matte",
        "palette",
        "#0",
        "light",
        "50mm",
        "grain",
      ]) {
        expect(
          clause.toLowerCase().includes(styleWord.toLowerCase()),
          `variation ${i} restates the style ("${styleWord}")`,
        ).toBe(false);
      }
    }
  });
});

describe("composeGenerationPrompt — variationIndex", () => {
  it("changes the prompt per beat while the style block stays byte-identical", () => {
    const prompts = [0, 1, 2, 3].map((variationIndex) =>
      composeGenerationPrompt(makeRequest({ intent: "broll", variationIndex })),
    );
    expect(new Set(prompts).size).toBe(prompts.length);
    for (const prompt of prompts) {
      expect(prompt).toContain(ART_DIRECTION_STYLE);
      expect(prompt.endsWith(ART_DIRECTION_NEGATIVES)).toBe(true);
    }
  });

  it("still fits inside the backend prompt ceiling with a variation attached", () => {
    for (const intent of VISUAL_INTENTS) {
      for (let i = 0; i < ART_DIRECTION_VARIATIONS.length; i++) {
        const prompt = composeGenerationPrompt(
          makeRequest({ intent, variationIndex: i }),
        );
        expect(
          prompt.length,
          `${intent}/variation ${i} is ${prompt.length} chars`,
        ).toBeLessThanOrEqual(BACKEND_PROMPT_CEILING);
      }
    }
  });

  it("composes the same prompt as before when no index is given", () => {
    expect(composeGenerationPrompt(makeRequest({ intent: "broll" }))).not.toContain(
      ART_DIRECTION_VARIATIONS[0]!,
    );
  });

  it("is ignored when the caller supplied the whole prompt", () => {
    const supplied = "an entirely different picture, by explicit request";
    expect(
      composeGenerationPrompt(
        makeRequest({ generationPrompt: supplied, variationIndex: 2 }),
      ),
    ).toBe(supplied);
  });
});
