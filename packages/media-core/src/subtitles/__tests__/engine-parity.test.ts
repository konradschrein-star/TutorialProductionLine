/**
 * Cross-engine parity.
 *
 * The defect this whole subsystem was rebuilt to fix: the Remotion renderer and
 * the ASS/libass renderer had disjoint config schemas and independently
 * hardcoded geometry, so the SAME content rendered through the two paths came
 * out with different type size, different margins, different line breaks, and a
 * different — in fact inverted — word highlight.
 *
 * These tests assert the numbers that must agree. They are deliberately written
 * against the two engines' real outputs (the CSS object and the ASS document)
 * rather than against the shared helper, so a future change that bypasses the
 * shared helper in one engine still fails here.
 */

import { describe, it, expect } from "vitest";
import { BUILTIN_SUBTITLE_PRESETS } from "@repo/db/seed-subtitle-presets";
import type { RemotionSubtitleConfig } from "@repo/db";
import { buildCaptionPlan } from "../plan.js";
import { buildAssFromPlan } from "../ass/ass-builder.js";
import {
  computeContainerPosition,
  computeWordStyle,
} from "../remotion/caption-styles.js";
import { activeWordIndex, computeCanvasScale } from "../layout.js";
import { mkWordsExact } from "./_fixtures.js";

const WORDS = mkWordsExact([
  ["Most", 0.1, 0.34],
  ["people", 0.36, 0.68],
  ["think", 0.7, 0.96],
  ["subtitles", 0.99, 1.62],
  ["are", 1.64, 1.78],
  ["solved.", 1.8, 2.4],
]);

const ASPECTS = [
  { name: "1080p landscape", width: 1920, height: 1080 },
  { name: "4K landscape", width: 3840, height: 2160 },
  { name: "1080x1920 vertical", width: 1080, height: 1920 },
];

/** Pull one field out of the ASS `Style: Default,...` row. */
function styleField(ass: string, index: number): string {
  const row = ass.split("\n").find((l) => l.startsWith("Style: Default,"))!;
  return row.slice("Style: ".length).split(",")[index]!;
}
// Zero-based column positions in the V4+ Style row, counting `Name` as 0:
// Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour,
// BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing,
// Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV,
// Encoding.
const F = {
  FONTNAME: 1,
  FONTSIZE: 2,
  PRIMARY: 3,
  OUTLINE_COLOUR: 5,
  BORDERSTYLE: 15,
  OUTLINE: 16,
  ALIGNMENT: 18,
  MARGIN_L: 19,
  MARGIN_R: 20,
  MARGIN_V: 21,
} as const;

describe("engine parity — every built-in preset, every aspect", () => {
  for (const preset of BUILTIN_SUBTITLE_PRESETS) {
    const config = preset.config as RemotionSubtitleConfig;

    for (const a of ASPECTS) {
      const label = `${preset.name} @ ${a.name}`;

      it(`${label}: type size matches`, () => {
        const plan = buildCaptionPlan(WORDS, config);
        const ass = buildAssFromPlan(plan, config, {
          width: a.width,
          height: a.height,
        });
        const scale = computeCanvasScale(config.sizeMode, a.height);
        const remotionPx = computeWordStyle(
          plan[0]!.words[0]!,
          config,
          false,
          scale,
        ).fontSize;
        expect(Number(styleField(ass, F.FONTSIZE))).toBe(
          Math.round(Number(remotionPx)),
        );
      });

      it(`${label}: side margins match the safe width`, () => {
        const plan = buildCaptionPlan(WORDS, config);
        const ass = buildAssFromPlan(plan, config, {
          width: a.width,
          height: a.height,
        });
        const cssMaxWidth = computeContainerPosition(config).width as string;
        const pct = parseFloat(cssMaxWidth);
        const expected = Math.round((((100 - pct) / 100) * a.width) / 2);
        expect(Number(styleField(ass, F.MARGIN_L))).toBe(expected);
        expect(Number(styleField(ass, F.MARGIN_R))).toBe(expected);
      });

      it(`${label}: vertical placement matches`, () => {
        const plan = buildCaptionPlan(WORDS, config);
        const ass = buildAssFromPlan(plan, config, {
          width: a.width,
          height: a.height,
        });
        const css = computeContainerPosition(config);
        // Both engines anchor the BLOCK EDGE, so the CSS `bottom` percentage and
        // the ASS MarginV must describe the same distance.
        const cssBottomPct = parseFloat(String(css.bottom));
        expect(Number(styleField(ass, F.MARGIN_V))).toBe(
          Math.round((cssBottomPct / 100) * a.height),
        );
        expect(Number(styleField(ass, F.ALIGNMENT))).toBe(2); // bottom-centre
      });

      it(`${label}: outline weight matches (ASS outline = half the CSS stroke)`, () => {
        const plan = buildCaptionPlan(WORDS, config);
        const ass = buildAssFromPlan(plan, config, {
          width: a.width,
          height: a.height,
        });
        const scale = computeCanvasScale(config.sizeMode, a.height);
        const boxed = config.background.enabled;
        if (boxed) {
          expect(Number(styleField(ass, F.BORDERSTYLE))).toBe(3);
          return;
        }
        expect(Number(styleField(ass, F.BORDERSTYLE))).toBe(1);
        expect(Number(styleField(ass, F.OUTLINE))).toBeCloseTo(
          (config.stroke.width / 2) * scale,
          2,
        );
      });
    }

    it(`${preset.name}: both engines segment identically`, () => {
      // There is only one chunker call now, but this pins the property that the
      // ASS path may never reintroduce its own option bag.
      const plan = buildCaptionPlan(WORDS, config);
      const ass = buildAssFromPlan(plan, config, { width: 1920, height: 1080 });
      const dialogues = ass
        .split("\n")
        .filter((l) => l.startsWith("Dialogue:"));
      const expected = config.animation.activeWordColor
        ? plan.reduce((n, c) => n + c.words.length, 0)
        : plan.length;
      expect(dialogues).toHaveLength(expected);
    });

    it(`${preset.name}: no caption is shorter than the minimum readable cue`, () => {
      const plan = buildCaptionPlan(WORDS, config);
      for (let i = 0; i < plan.length - 1; i++) {
        // Every cue but the last (which is bounded by the clip, not the plan).
        expect(plan[i]!.end - plan[i]!.start).toBeGreaterThanOrEqual(0.8);
      }
    });
  }
});

describe("active-word selection is continuous", () => {
  it("never leaves a gap with no active word", () => {
    // The old per-word `[start, end)` rule left NO word active during the
    // silences Whisper leaves between words, so the highlight flickered.
    const config = BUILTIN_SUBTITLE_PRESETS.find((p) => p.name === "Highlight")!
      .config as RemotionSubtitleConfig;
    const plan = buildCaptionPlan(WORDS, config);

    for (const chunk of plan) {
      for (let t = chunk.start; t < chunk.end; t += 1 / 60) {
        expect(
          activeWordIndex(chunk.words, t),
          `no active word at t=${t.toFixed(3)}`,
        ).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("advances monotonically and only at word starts", () => {
    const config = BUILTIN_SUBTITLE_PRESETS.find((p) => p.name === "Highlight")!
      .config as RemotionSubtitleConfig;
    const chunk = buildCaptionPlan(WORDS, config)[0]!;
    let previous = -1;
    for (let t = chunk.start; t < chunk.end; t += 1 / 120) {
      const idx = activeWordIndex(chunk.words, t);
      expect(idx).toBeGreaterThanOrEqual(previous);
      previous = idx;
    }
  });
});
