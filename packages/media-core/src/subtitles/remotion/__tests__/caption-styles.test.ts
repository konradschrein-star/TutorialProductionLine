import { describe, it, expect } from "vitest";
import type { RemotionSubtitleConfig } from "@repo/db";
import { defaultRemotionConfig } from "@repo/db";
import type { CaptionWord, CaptionPlan } from "../../types.js";
import {
  computeShadowLayers,
  computeWordStyle,
  computeWordVariance,
  computeContainerPosition,
  computeSafeMaxWidthPercent,
  computeBackgroundStyle,
  computeCanvasScale,
  pickActiveChunkIndex,
  SHADOW_LAYER_COUNT,
  DESIGN_HEIGHT,
} from "../caption-styles.js";

// Helper: count comma-separated layers in a text-shadow string.
function layerCount(shadow: string): number {
  if (shadow === "none" || shadow.trim() === "") return 0;
  // Split on commas that separate layers (rgba() has commas inside — split on
  // "), " boundaries instead).
  return shadow.split(/\)\s*,\s*/).length;
}

const baseConfig = (): RemotionSubtitleConfig =>
  structuredClone(defaultRemotionConfig);

const word = (over: Partial<CaptionWord> = {}): CaptionWord => ({
  word: "hello",
  raw: "hello",
  start: 0,
  end: 1,
  role: "normal",
  ...over,
});

// ---------------------------------------------------------------------------
// computeShadowLayers
// ---------------------------------------------------------------------------

describe("computeShadowLayers", () => {
  it("returns 'none' when strength is 0", () => {
    const cfg = baseConfig();
    expect(computeShadowLayers({ ...cfg.shadow, strength: 0, blur: 10 })).toBe(
      "none",
    );
  });

  it("returns 'none' when strength is negative", () => {
    const cfg = baseConfig();
    expect(computeShadowLayers({ ...cfg.shadow, strength: -1, blur: 10 })).toBe(
      "none",
    );
  });

  it("produces exactly SHADOW_LAYER_COUNT stacked layers when enabled", () => {
    const shadow = {
      color: "#000000",
      blur: 6,
      strength: 1,
      size: 4,
      offsetX: 2,
      offsetY: 2,
      curve: "linear" as const,
    };
    const result = computeShadowLayers(shadow);
    expect(layerCount(result)).toBe(SHADOW_LAYER_COUNT);
  });

  it("first (closest) layer opacity equals strength (dissipation=1)", () => {
    const shadow = {
      color: "#000000",
      blur: 6,
      strength: 0.8,
      size: 4,
      offsetX: 0,
      offsetY: 0,
      curve: "linear" as const,
    };
    const result = computeShadowLayers(shadow);
    // The first rgba alpha in the string should be the strength value.
    const firstAlpha = Number(/rgba\([^)]*,\s*([0-9.]+)\)/.exec(result)?.[1]);
    expect(firstAlpha).toBeCloseTo(0.8, 3);
  });

  it("different curves yield different far-layer opacities", () => {
    const base = {
      color: "#000000",
      blur: 6,
      strength: 1,
      size: 4,
      offsetX: 0,
      offsetY: 0,
    };
    const linear = computeShadowLayers({ ...base, curve: "linear" });
    const easeIn = computeShadowLayers({ ...base, curve: "easeIn" });
    const easeOut = computeShadowLayers({ ...base, curve: "easeOut" });
    const gaussian = computeShadowLayers({ ...base, curve: "gaussian" });
    // Grab the LAST alpha from each.
    const lastAlpha = (s: string) => {
      const all = [...s.matchAll(/rgba\([^)]*,\s*([0-9.]+)\)/g)];
      return Number(all[all.length - 1][1]);
    };
    const l = lastAlpha(linear);
    const ei = lastAlpha(easeIn);
    const eo = lastAlpha(easeOut);
    const g = lastAlpha(gaussian);
    // Linear far layer fully dissipated to 0.
    expect(l).toBeCloseTo(0, 5);
    // The curves are distinct from each other (not all identical).
    const set = new Set([l, ei, eo, g].map((n) => n.toFixed(4)));
    expect(set.size).toBeGreaterThan(1);
  });

  it("embeds the shadow color as rgba", () => {
    const result = computeShadowLayers({
      color: "#ff0000",
      blur: 4,
      strength: 1,
      size: 0,
      offsetX: 0,
      offsetY: 0,
      curve: "linear",
    });
    expect(result).toMatch(/rgba\(255,\s*0,\s*0/);
  });
});

// ---------------------------------------------------------------------------
// computeWordVariance
// ---------------------------------------------------------------------------

describe("computeWordVariance", () => {
  it("returns zeros when disabled", () => {
    for (const i of [0, 1, 5, 42]) {
      expect(computeWordVariance(i, false)).toEqual({
        delayFrames: 0,
        scaleJitter: 0,
      });
    }
  });

  it("is deterministic: same index yields the same output", () => {
    const a = computeWordVariance(7, true);
    const b = computeWordVariance(7, true);
    expect(a).toEqual(b);
  });

  it("delayFrames stays within [0, 3]", () => {
    for (let i = 0; i < 200; i++) {
      const { delayFrames } = computeWordVariance(i, true);
      expect(delayFrames).toBeGreaterThanOrEqual(0);
      expect(delayFrames).toBeLessThanOrEqual(3);
      expect(Number.isInteger(delayFrames)).toBe(true);
    }
  });

  it("scaleJitter stays within [-0.05, 0.05]", () => {
    for (let i = 0; i < 200; i++) {
      const { scaleJitter } = computeWordVariance(i, true);
      expect(scaleJitter).toBeGreaterThanOrEqual(-0.05);
      expect(scaleJitter).toBeLessThanOrEqual(0.05);
    }
  });

  it("different indices produce differing variance (not constant)", () => {
    const delaySet = new Set<number>();
    const jitterSet = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const v = computeWordVariance(i, true);
      delaySet.add(v.delayFrames);
      jitterSet.add(v.scaleJitter.toFixed(4));
    }
    expect(delaySet.size).toBeGreaterThan(1);
    expect(jitterSet.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// computeWordStyle
// ---------------------------------------------------------------------------

describe("computeWordStyle", () => {
  it("normal word uses fontColor and base font family/weight/size", () => {
    const cfg = baseConfig();
    cfg.fontColor = "#FFFFFF";
    cfg.fontFamily = "Inter";
    cfg.fontWeight = 700;
    cfg.fontSize = 64;
    const style = computeWordStyle(word({ role: "normal" }), cfg, false);
    expect(style.color).toBe("#FFFFFF");
    expect(style.fontFamily).toBe("Inter");
    expect(style.fontWeight).toBe(700);
    expect(style.fontSize).toBe(64);
  });

  it("keyword word uses keywordColor", () => {
    const cfg = baseConfig();
    const style = computeWordStyle(
      word({ role: "keyword", keywordColor: "#FFD400" }),
      cfg,
      false,
    );
    expect(style.color).toBe("#FFD400");
  });

  it("keyword word falls back to first keyword color when keywordColor missing", () => {
    const cfg = baseConfig();
    cfg.keyword.colors = ["#123456", "#abcdef"];
    const style = computeWordStyle(word({ role: "keyword" }), cfg, false);
    expect(style.color).toBe("#123456");
  });

  it("keyword bold/italic applied", () => {
    const cfg = baseConfig();
    cfg.keyword.bold = true;
    cfg.keyword.italic = true;
    const style = computeWordStyle(
      word({ role: "keyword", keywordColor: "#fff" }),
      cfg,
      false,
    );
    expect(style.fontStyle).toBe("italic");
    expect(Number(style.fontWeight)).toBeGreaterThanOrEqual(700);
  });

  it("secondary word uses secondary font family + reduced size", () => {
    const cfg = baseConfig();
    cfg.fontSize = 100;
    cfg.secondaryFont = {
      fontId: null,
      fontFamily: "Arial",
      fontWeight: 400,
    };
    const style = computeWordStyle(word({ role: "secondary" }), cfg, false);
    expect(style.fontFamily).toBe("Arial");
    expect(style.fontWeight).toBe(400);
    expect(Number(style.fontSize)).toBeLessThan(100);
  });

  it("secondary word without secondaryFont falls back to base font", () => {
    const cfg = baseConfig();
    cfg.secondaryFont = null;
    cfg.fontFamily = "Inter";
    const style = computeWordStyle(word({ role: "secondary" }), cfg, false);
    expect(style.fontFamily).toBe("Inter");
  });

  it("applies -webkit-text-stroke and paintOrder when stroke width > 0", () => {
    const cfg = baseConfig();
    cfg.stroke = { color: "#000000", width: 8 };
    const style = computeWordStyle(word(), cfg, false) as Record<
      string,
      unknown
    >;
    expect(style.WebkitTextStroke).toBe("8px #000000");
    expect(style.paintOrder).toBe("stroke fill");
  });

  it("omits stroke when width is 0", () => {
    const cfg = baseConfig();
    cfg.stroke = { color: "#000000", width: 0 };
    const style = computeWordStyle(word(), cfg, false) as Record<
      string,
      unknown
    >;
    expect(style.WebkitTextStroke).toBeUndefined();
  });

  it("active word color override when activeWordColor set", () => {
    const cfg = baseConfig();
    cfg.fontColor = "#FFFFFF";
    cfg.animation.activeWordColor = "#FFE146";
    const inactive = computeWordStyle(word(), cfg, false);
    const active = computeWordStyle(word(), cfg, true);
    expect(inactive.color).toBe("#FFFFFF");
    expect(active.color).toBe("#FFE146");
  });

  it("active word without activeWordColor keeps its base color", () => {
    const cfg = baseConfig();
    cfg.fontColor = "#FFFFFF";
    cfg.animation.activeWordColor = null;
    const active = computeWordStyle(word(), cfg, true);
    expect(active.color).toBe("#FFFFFF");
  });
});

// ---------------------------------------------------------------------------
// computeContainerPosition
// ---------------------------------------------------------------------------

describe("computeContainerPosition", () => {
  it("is absolutely positioned", () => {
    const cfg = baseConfig();
    const style = computeContainerPosition(cfg);
    expect(style.position).toBe("absolute");
  });

  it("uses positionX for horizontal placement", () => {
    const cfg = baseConfig();
    cfg.positionX = 25;
    const style = computeContainerPosition(cfg);
    expect(style.left).toBe("25%");
  });

  it("center alignment translates -50% horizontally", () => {
    const cfg = baseConfig();
    cfg.alignment = "center";
    const style = computeContainerPosition(cfg);
    expect(String(style.transform)).toContain("-50%");
    expect(style.textAlign).toBe("center");
  });

  it("anchors on a block EDGE, never on the block centre", () => {
    // Centre-anchoring (the old `top: 85%; translateY(-50%)`) made a one-line
    // and a two-line caption sit at different heights, so captions visibly
    // jumped as the line count changed — and it could never line up with
    // libass, which anchors on an edge. Bottom presets must therefore use
    // `bottom`, with no vertical translate.
    const cfg = baseConfig();
    cfg.positionPreset = "bottom";
    cfg.safeMarginPercent = 10;
    const bottom = computeContainerPosition(cfg);
    expect(bottom.bottom).toBe("10%");
    expect(bottom.top).toBeUndefined();
    // Horizontal centring legitimately uses translateX(-50%); what must be
    // absent is any VERTICAL translate.
    expect(String(bottom.transform)).not.toContain("translateY");
    expect(String(bottom.transform)).toBe("translateX(-50%)");
  });

  it("sets an explicit WIDTH, not a max-width", () => {
    // The container is absolutely positioned with `left` set and `right` auto.
    // With width:auto it is shrink-to-fit, and CSS caps a shrink-to-fit box's
    // available space at (containing block width - left) — at the default
    // centred anchor that is HALF the frame. A `max-width: 82%` was therefore
    // never reachable and the caption wrapped at 50% of the frame, while libass
    // wrapped at the real 82%. The two engines then broke lines differently.
    const cfg = baseConfig();
    cfg.positionX = 50;
    cfg.alignment = "center";
    cfg.maxWidthPercent = 82;
    const style = computeContainerPosition(cfg);
    expect(style.width).toBe("82%");
    expect(style.maxWidth).toBeUndefined();
  });

  it("narrows the width for an off-centre anchor so it cannot leave the frame", () => {
    const cfg = baseConfig();
    cfg.positionX = 70;
    cfg.alignment = "center";
    cfg.maxWidthPercent = 82;
    // Centred on 70% leaves only 30% to the right, so 60% total.
    expect(computeContainerPosition(cfg).width).toBe("60%");
  });

  it("top preset anchors from the top edge", () => {
    const cfg = baseConfig();
    cfg.positionPreset = "top";
    cfg.safeMarginPercent = 10;
    const top = computeContainerPosition(cfg);
    expect(top.top).toBe("10%");
    expect(top.bottom).toBeUndefined();
  });

  it("custom preset places the block's bottom edge at positionY", () => {
    const cfg = baseConfig();
    cfg.positionPreset = "custom";
    cfg.positionY = 33;
    const style = computeContainerPosition(cfg);
    // positionY is measured from the TOP; both engines model this as a bottom
    // margin so there is one placement model, not two.
    expect(style.bottom).toBe("67%");
  });
});

// ---------------------------------------------------------------------------
// computeBackgroundStyle
// ---------------------------------------------------------------------------

describe("computeBackgroundStyle", () => {
  it("disabled background has zero padding and no color", () => {
    const cfg = baseConfig();
    cfg.background = {
      enabled: false,
      color: "#000000",
      radius: 8,
      paddingX: 12,
      paddingY: 8,
    };
    const style = computeBackgroundStyle(cfg.background);
    expect(style.padding).toBe(0);
    expect(style.backgroundColor).toBeUndefined();
  });

  it("enabled background applies color, radius, padding", () => {
    const cfg = baseConfig();
    cfg.background = {
      enabled: true,
      color: "#101010",
      radius: 16,
      paddingX: 20,
      paddingY: 10,
    };
    const style = computeBackgroundStyle(cfg.background);
    expect(style.backgroundColor).toBe("#101010");
    expect(style.borderRadius).toBe(16);
    expect(style.padding).toBe("10px 20px");
  });
});

// ---------------------------------------------------------------------------
// pickActiveChunkIndex
// ---------------------------------------------------------------------------

describe("pickActiveChunkIndex", () => {
  const plan: CaptionPlan = [
    { words: [], lines: [], start: 0, end: 1 },
    { words: [], lines: [], start: 1, end: 2 },
    { words: [], lines: [], start: 2, end: 3 },
  ];

  it("returns -1 before the first chunk", () => {
    expect(pickActiveChunkIndex(plan, -0.5)).toBe(-1);
  });

  it("returns 0 at the very start", () => {
    expect(pickActiveChunkIndex(plan, 0)).toBe(0);
  });

  it("returns the chunk containing the time", () => {
    expect(pickActiveChunkIndex(plan, 0.5)).toBe(0);
    expect(pickActiveChunkIndex(plan, 1.2)).toBe(1);
    expect(pickActiveChunkIndex(plan, 2.9)).toBe(2);
  });

  it("boundary time belongs to the later chunk (half-open)", () => {
    expect(pickActiveChunkIndex(plan, 1)).toBe(1);
    expect(pickActiveChunkIndex(plan, 2)).toBe(2);
  });

  it("last chunk end is inclusive", () => {
    expect(pickActiveChunkIndex(plan, 3)).toBe(2);
  });

  it("returns -1 after the last chunk", () => {
    expect(pickActiveChunkIndex(plan, 3.1)).toBe(-1);
  });

  it("returns -1 for an empty plan", () => {
    expect(pickActiveChunkIndex([], 1)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// computeCanvasScale — one preset must read the same at 16:9 and 9:16
// ---------------------------------------------------------------------------

describe("computeCanvasScale", () => {
  it("is 1 at the reference height", () => {
    const cfg = baseConfig();
    expect(computeCanvasScale(cfg, DESIGN_HEIGHT)).toBe(1);
  });

  it("scales up for a taller (9:16) canvas", () => {
    const cfg = baseConfig();
    expect(computeCanvasScale(cfg, 1920)).toBeCloseTo(1920 / 1080, 6);
  });

  it("keeps the caption at the same fraction of frame height across aspects", () => {
    const cfg = baseConfig();
    const landscape = (cfg.fontSize * computeCanvasScale(cfg, 1080)) / 1080;
    const portrait = (cfg.fontSize * computeCanvasScale(cfg, 1920)) / 1920;
    expect(portrait).toBeCloseTo(landscape, 6);
  });

  it("absolute mode never scales", () => {
    const cfg = baseConfig();
    cfg.sizeMode = "absolute";
    expect(computeCanvasScale(cfg, 1920)).toBe(1);
    expect(computeCanvasScale(cfg, 2160)).toBe(1);
  });

  it("degrades to 1 for a nonsense canvas height", () => {
    const cfg = baseConfig();
    expect(computeCanvasScale(cfg, 0)).toBe(1);
    expect(computeCanvasScale(cfg, Number.NaN)).toBe(1);
  });
});

describe("scale threading", () => {
  it("computeWordStyle scales font size and stroke", () => {
    const cfg = baseConfig();
    cfg.fontSize = 60;
    cfg.stroke = { color: "#000000", width: 8 };
    const style = computeWordStyle(word(), cfg, false, 2);
    expect(style.fontSize).toBe(120);
    expect(String((style as Record<string, unknown>).WebkitTextStroke)).toBe(
      "16px #000000",
    );
  });

  it("computeWordStyle defaults to no scaling", () => {
    const cfg = baseConfig();
    cfg.fontSize = 60;
    expect(computeWordStyle(word(), cfg, false).fontSize).toBe(60);
  });

  it("computeBackgroundStyle scales radius and padding", () => {
    const cfg = baseConfig();
    cfg.background = {
      enabled: true,
      color: "#000000",
      radius: 10,
      paddingX: 20,
      paddingY: 10,
    };
    const style = computeBackgroundStyle(cfg.background, 2);
    expect(style.borderRadius).toBe(20);
    expect(style.padding).toBe("20px 40px");
  });

  it("computeShadowLayers scales blur and offsets", () => {
    const cfg = baseConfig();
    cfg.shadow = {
      color: "#000000",
      blur: 5,
      strength: 1,
      size: 0,
      offsetX: 3,
      offsetY: 4,
      curve: "linear",
    };
    const layers = computeShadowLayers(cfg.shadow, 2);
    expect(layers).toContain("6px 8px 10px");
  });
});

// ---------------------------------------------------------------------------
// computeSafeMaxWidthPercent — captions must never run off the frame
// ---------------------------------------------------------------------------

describe("computeSafeMaxWidthPercent", () => {
  it("uses the configured ceiling when the anchor is centered", () => {
    expect(
      computeSafeMaxWidthPercent({
        positionX: 50,
        alignment: "center",
        maxWidthPercent: 86,
      }),
    ).toBe(86);
  });

  it("narrows a centered box anchored off-center", () => {
    // Anchored at 20% => only 40% of the frame can be used symmetrically.
    expect(
      computeSafeMaxWidthPercent({
        positionX: 20,
        alignment: "center",
        maxWidthPercent: 86,
      }),
    ).toBe(40);
  });

  it("left alignment is bounded by the space to the right of the anchor", () => {
    expect(
      computeSafeMaxWidthPercent({
        positionX: 70,
        alignment: "left",
        maxWidthPercent: 86,
      }),
    ).toBe(30);
  });

  it("right alignment is bounded by the space to the left of the anchor", () => {
    expect(
      computeSafeMaxWidthPercent({
        positionX: 30,
        alignment: "right",
        maxWidthPercent: 86,
      }),
    ).toBe(30);
  });

  it("never collapses to zero at a frame edge", () => {
    expect(
      computeSafeMaxWidthPercent({
        positionX: 0,
        alignment: "right",
        maxWidthPercent: 86,
      }),
    ).toBeGreaterThan(0);
  });

  it("is applied by computeContainerPosition", () => {
    const cfg = baseConfig();
    cfg.maxWidthPercent = 80;
    expect(computeContainerPosition(cfg).width).toBe("80%");
  });
});
