import { describe, it, expect } from "vitest";
import type { RemotionSubtitleConfig } from "@repo/db";
import {
  buildAssFromPlan,
  hexToAss,
  assAlignment,
  escapeAssText,
} from "../ass-builder.js";
import type { CaptionPlan, CaptionWord } from "../../types.js";
import { makeRemotionConfig } from "../../__tests__/_fixtures.js";
import {
  computeAssSideMargins,
  computeCanvasScale,
  cssStrokeToAssOutline,
} from "../../layout.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const word = (text: string, start: number, end: number): CaptionWord => ({
  word: text,
  raw: text,
  start,
  end,
  role: "normal",
});

const chunk = (words: CaptionWord[], end: number) => ({
  words,
  lines: [words],
  start: words[0]!.start,
  end,
});

/** A small two-chunk plan. */
const smallPlan: CaptionPlan = [
  chunk([word("Hello", 0, 0.5), word("world", 0.5, 1.0)], 1.0),
  chunk([word("captions", 1.0, 1.8), word("here", 1.8, 2.2)], 2.2),
];

/**
 * Both engines now consume the SAME canonical style. `activeWordColor: null`
 * keeps these baseline cases to one Dialogue per chunk.
 */
const baseConfig: RemotionSubtitleConfig = makeRemotionConfig({
  fontFamily: "Komika Axis",
  fontSize: 64,
  fontColor: "#FFFFFF",
  stroke: { color: "#000000", width: 10 },
  safeMarginPercent: 12,
  animation: {
    enabled: false,
    caption: "none",
    word: "none",
    variants: false,
    durationFrames: 0,
    activeWordScale: 1,
    activeWordColor: null,
  },
});

const opts = { width: 1920, height: 1080 };

// ─── hexToAss ──────────────────────────────────────────────────────────────

describe("hexToAss", () => {
  it("converts #RRGGBB to ASS &HAABBGGRR", () => {
    // #FF8800 -> BB=00, GG=88, RR=FF, opaque alpha 00
    expect(hexToAss("#FF8800")).toBe("&H000088FF");
  });

  it("accepts hex without a leading #", () => {
    expect(hexToAss("00FF00")).toBe("&H0000FF00");
  });

  it("expands 3-digit hex", () => {
    expect(hexToAss("#F80")).toBe("&H000088FF");
  });

  it("inverts CSS alpha into ASS alpha", () => {
    // CSS AA=FF (opaque) -> ASS 00; CSS AA=00 (transparent) -> ASS FF.
    expect(hexToAss("#000000FF")).toBe("&H00000000");
    expect(hexToAss("#00000000")).toBe("&HFF000000");
    // 0xB3 = 179 -> ASS alpha 255-179 = 76 = 0x4C
    expect(hexToAss("#000000B3")).toBe("&H4C000000");
  });

  it("THROWS on unparseable input instead of guessing a colour", () => {
    // Silently falling back to white turned a preset typo into an entire video
    // rendered in the wrong colour with no diagnostic anywhere.
    expect(() => hexToAss("not-a-color")).toThrow(/not a hex colour/);
  });
});

// ─── Pure helpers ──────────────────────────────────────────────────────────

describe("assAlignment", () => {
  it("maps anchor + alignment to the ASS numpad", () => {
    expect(assAlignment("bottom", "center")).toBe(2);
    expect(assAlignment("bottom", "left")).toBe(1);
    expect(assAlignment("bottom", "right")).toBe(3);
    expect(assAlignment("center", "center")).toBe(5);
    expect(assAlignment("top", "center")).toBe(8);
  });
});

describe("escapeAssText", () => {
  it("neutralises characters that would open an override block", () => {
    expect(escapeAssText("{\\an8}")).not.toContain("{");
    expect(escapeAssText("{\\an8}")).not.toContain("\\");
  });
});

// ─── buildAssFromPlan ──────────────────────────────────────────────────────

describe("buildAssFromPlan", () => {
  it("produces a full ASS document with header sections", () => {
    const ass = buildAssFromPlan(smallPlan, baseConfig, opts);
    expect(ass).toMatch(/^\[Script Info\]/);
    expect(ass).toContain("[V4+ Styles]");
    expect(ass).toContain("[Events]");
  });

  it("declares ScaledBorderAndShadow so outlines survive 4K", () => {
    // Without this libass does not scale the border with the render resolution,
    // so a preset tuned at 1080p grows hairline outlines at 2160p.
    expect(buildAssFromPlan(smallPlan, baseConfig, opts)).toContain(
      "ScaledBorderAndShadow: yes",
    );
  });

  it("maps config → Style row (font, size, resolution, margin)", () => {
    const ass = buildAssFromPlan(smallPlan, baseConfig, opts);
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toContain("PlayResY: 1080");
    expect(ass).toContain("Style: Default,Komika Axis,64,");
    // safeMarginPercent 12 of 1080 = 130, in the MarginV slot.
    expect(ass).toContain(",130,1");
  });

  it("halves the CSS stroke width to get the ASS outline", () => {
    // CSS -webkit-text-stroke is CENTRED (half of it is painted over by the
    // fill); ASS Outline is drawn entirely outside the glyph. A stroke of 10
    // must therefore become an outline of 5 for the two engines to match.
    const ass = buildAssFromPlan(smallPlan, baseConfig, opts);
    expect(cssStrokeToAssOutline(10)).toBe(5);
    expect(ass).toMatch(/,1,5,\d+,2,/);
  });

  it("derives MarginL/MarginR from maxWidthPercent", () => {
    const cfg = makeRemotionConfig({ ...baseConfig, maxWidthPercent: 80 });
    const ass = buildAssFromPlan(smallPlan, cfg, opts);
    // 20% of 1920 shared between the two sides = 192 each.
    const { marginL, marginR } = computeAssSideMargins(
      { positionX: 50, alignment: "center", maxWidthPercent: 80 },
      1920,
    );
    expect(marginL).toBe(192);
    expect(marginR).toBe(192);
    expect(ass).toContain(`,${marginL},${marginR},`);
  });

  it("scales the font with canvas height (canvasRelative)", () => {
    const ass4k = buildAssFromPlan(smallPlan, baseConfig, {
      width: 3840,
      height: 2160,
    });
    // 64 design px at 2160 tall = 128 real px, i.e. the same 5.9% of height.
    expect(computeCanvasScale("canvasRelative", 2160)).toBe(2);
    expect(ass4k).toContain("Style: Default,Komika Axis,128,");
  });

  it("emits exactly one Dialogue per chunk when there is no word highlight", () => {
    const ass = buildAssFromPlan(smallPlan, baseConfig, opts);
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues).toHaveLength(2);
  });

  it("emits one Dialogue per word when a highlight colour is set", () => {
    const cfg = makeRemotionConfig({
      ...baseConfig,
      animation: { ...baseConfig.animation, activeWordColor: "#FFE000" },
    });
    const ass = buildAssFromPlan(smallPlan, cfg, opts);
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    // 2 words per chunk x 2 chunks.
    expect(dialogues).toHaveLength(4);
    // The highlight colour appears as an inline \c override, NOT as the ASS
    // SecondaryColour: \k karaoke colours words that have NOT been spoken yet,
    // which renders the highlight backwards.
    expect(ass).toContain("\\c&H00E0FF&");
    expect(ass).not.toContain("\\k");
  });

  it("keeps the highlight on through the gap between words", () => {
    // "Hello" ends at 0.4 but "world" does not start until 0.7. The highlight
    // must stay on "Hello" for that whole 300ms, otherwise it blinks off.
    const gappy: CaptionPlan = [
      chunk([word("Hello", 0, 0.4), word("world", 0.7, 1.0)], 1.0),
    ];
    const cfg = makeRemotionConfig({
      ...baseConfig,
      animation: { ...baseConfig.animation, activeWordColor: "#FFE000" },
    });
    const dialogues = buildAssFromPlan(gappy, cfg, opts)
      .split("\n")
      .filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues).toHaveLength(2);
    // First event runs 0:00:00.00 -> 0:00:00.70, i.e. up to the NEXT word's
    // start, not to its own word's end (0.40).
    expect(dialogues[0]).toContain("0:00:00.00,0:00:00.70");
    expect(dialogues[1]).toContain("0:00:00.70,0:00:01.00");
  });

  it("skips zero-duration chunks", () => {
    const plan: CaptionPlan = [chunk([word("skip", 1.0, 1.0)], 1.0)];
    expect(buildAssFromPlan(plan, baseConfig, opts)).not.toContain("Dialogue:");
  });

  it("renders explicit line breaks from the plan so both engines break alike", () => {
    const twoLine: CaptionPlan = [
      {
        words: [word("a", 0, 0.5), word("b", 0.5, 1)],
        lines: [[word("a", 0, 0.5)], [word("b", 0.5, 1)]],
        start: 0,
        end: 1,
      },
    ];
    expect(buildAssFromPlan(twoLine, baseConfig, opts)).toContain("a\\Nb");
  });

  it("switches to a box (BorderStyle 3) when a caption background is enabled", () => {
    const boxed = makeRemotionConfig({
      ...baseConfig,
      background: {
        enabled: true,
        color: "#000000B3",
        radius: 6,
        paddingX: 20,
        paddingY: 10,
      },
    });
    const ass = buildAssFromPlan(smallPlan, boxed, opts);
    expect(ass).toMatch(/,3,10,0,/); // BorderStyle 3, Outline=paddingY, Shadow 0
    expect(ass).toContain("&H4C000000"); // the plate colour, alpha-inverted
  });

  it("emits a \\fad only for the fade caption animation", () => {
    const faded = makeRemotionConfig({
      ...baseConfig,
      animation: {
        ...baseConfig.animation,
        enabled: true,
        caption: "fade",
        durationFrames: 3,
      },
    });
    // 3 frames at the 30fps reference = 100ms.
    expect(buildAssFromPlan(smallPlan, faded, opts)).toContain("\\fad(100,0)");
    expect(buildAssFromPlan(smallPlan, baseConfig, opts)).not.toContain(
      "\\fad",
    );
  });

  it("formats timing in H:MM:SS.cc centiseconds", () => {
    const plan: CaptionPlan = [chunk([word("t", 65.5, 67.25)], 67.25)];
    const ass = buildAssFromPlan(plan, baseConfig, opts);
    expect(ass).toContain("0:01:05.50");
    expect(ass).toContain("0:01:07.25");
  });

  it("matches a snapshot for a small plan", () => {
    expect(buildAssFromPlan(smallPlan, baseConfig, opts)).toMatchSnapshot();
  });

  it("defaults the Style Fontname to config.fontFamily", () => {
    expect(buildAssFromPlan(smallPlan, baseConfig, opts)).toContain(
      "Style: Default,Komika Axis,",
    );
  });

  it("overrides the Style Fontname with opts.fontName (real embedded family)", () => {
    const ass = buildAssFromPlan(smallPlan, baseConfig, {
      ...opts,
      fontName: "Arimo",
    });
    expect(ass).toContain("Style: Default,Arimo,");
    expect(ass).not.toContain("Style: Default,Komika Axis,");
  });
});
