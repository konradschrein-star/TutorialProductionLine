import { describe, expect, it } from "vitest";

import { computeCacheKey } from "../../cache/segment-cache.js";
import {
  assertCopyTypography,
  buildTextPlateHtml,
  interpretMetrics,
  resolveTextBox,
  textPlateSpec,
  typeSizesForKind,
  type TextPlateScene,
} from "../text-plates.js";
import {
  DARK_PLATE_THEME,
  HEADLINE_MAX_CHARS,
  MIN_LEGIBLE_PX,
  PLATE_TYPE_SCALE,
  PlateError,
} from "../types.js";

const CANVAS = { aspect: "16:9", width: 1920, height: 1080 } as const;

function scene(overrides: Partial<TextPlateScene> = {}): TextPlateScene {
  return {
    id: "s07",
    beat: "dscr-explained",
    kind: "title",
    copy: { headline: "What lenders check first" },
    ...overrides,
  };
}

describe("typeSizesForKind", () => {
  it("gives a title card the hero size and a b-roll caption a smaller one", () => {
    expect(typeSizesForKind("title").headline).toBe(PLATE_TYPE_SCALE.hero);
    expect(typeSizesForKind("chapter").headline).toBe(PLATE_TYPE_SCALE.display);
    expect(typeSizesForKind("broll").headline).toBe(PLATE_TYPE_SCALE.subhead);
    expect(typeSizesForKind("presenter-solo").headline).toBe(
      PLATE_TYPE_SCALE.headline,
    );
  });

  it("keeps every slot of every kind above the legibility floor", () => {
    for (const kind of [
      "title",
      "chapter",
      "broll",
      "presenter-solo",
    ] as const) {
      const sizes = typeSizesForKind(kind);
      expect(
        Math.min(sizes.eyebrow, sizes.headline, sizes.body),
      ).toBeGreaterThanOrEqual(MIN_LEGIBLE_PX);
    }
  });
});

describe("resolveTextBox", () => {
  it("puts the copy on the side the presenter is NOT standing on", () => {
    const presenterLeft = resolveTextBox({
      kind: "presenter-solo",
      presenterSide: "left",
      width: 1920,
      height: 1080,
    });
    const presenterRight = resolveTextBox({
      kind: "presenter-solo",
      presenterSide: "right",
      width: 1920,
      height: 1080,
    });
    // Neither column crosses the centre line towards the figure.
    expect(presenterLeft.x).toBeGreaterThanOrEqual(1920 / 2);
    expect(presenterRight.x + presenterRight.width).toBeLessThanOrEqual(
      1920 / 2,
    );
    expect(presenterLeft.width).toBeCloseTo(presenterRight.width, 5);
  });

  it("gives the full column when there is no presenter or he is centred", () => {
    const none = resolveTextBox({ kind: "title", width: 1920, height: 1080 });
    const centre = resolveTextBox({
      kind: "title",
      presenterSide: "center",
      width: 1920,
      height: 1080,
    });
    expect(none).toEqual(centre);
    // 1920 minus twice the 96px safe margin.
    expect(none.width).toBeCloseTo(1728, 5);
    expect(none.x).toBeCloseTo(96, 5);
  });

  it("bands a b-roll caption low and a presenter-solo caption high", () => {
    const broll = resolveTextBox({ kind: "broll", width: 1920, height: 1080 });
    const solo = resolveTextBox({
      kind: "presenter-solo",
      width: 1920,
      height: 1080,
    });
    expect(broll.y).toBeGreaterThan(1080 / 2);
    expect(solo.y).toBeLessThan(1080 / 2);
    expect(broll.y + broll.height).toBeLessThanOrEqual(1080);
  });

  it("keeps every box inside the frame", () => {
    for (const kind of [
      "title",
      "chapter",
      "broll",
      "presenter-solo",
    ] as const) {
      for (const side of ["left", "right", "center", undefined] as const) {
        const box = resolveTextBox({
          kind,
          ...(side === undefined ? {} : { presenterSide: side }),
          width: 1920,
          height: 1080,
        });
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(1920);
        expect(box.y + box.height).toBeLessThanOrEqual(1080 + 0.001);
      }
    }
  });

  it("throws on a canvas that cannot be a plate at all", () => {
    expect(() =>
      resolveTextBox({ kind: "title", width: 0, height: 1080 }),
    ).toThrow(PlateError);
    expect(() =>
      resolveTextBox({ kind: "title", width: 1921, height: 1080 }),
    ).toThrow(PlateError);
  });

  it("still yields a box inside the frame on a small canvas", () => {
    const box = resolveTextBox({ kind: "title", width: 640, height: 360 });
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThanOrEqual(640);
    expect(box.y + box.height).toBeLessThanOrEqual(360.001);
  });
});

describe("assertCopyTypography", () => {
  it("accepts copy inside the budget", () => {
    expect(assertCopyTypography(scene())).toEqual(typeSizesForKind("title"));
  });

  it("throws on a headline over the 68-character budget", () => {
    const long = "x".repeat(HEADLINE_MAX_CHARS + 1);
    expect(() =>
      assertCopyTypography(scene({ copy: { headline: long } })),
    ).toThrow(PlateError);
    expect(() =>
      assertCopyTypography(scene({ copy: { headline: long } })),
    ).toThrow(/68-character budget/);
  });

  it("accepts a headline exactly at the budget", () => {
    const exact = "y".repeat(HEADLINE_MAX_CHARS);
    expect(() =>
      assertCopyTypography(scene({ copy: { headline: exact } })),
    ).not.toThrow();
  });

  it("throws when a plate was asked for with no copy at all", () => {
    expect(() => assertCopyTypography(scene({ copy: {} }))).toThrow(PlateError);
    expect(() =>
      assertCopyTypography(scene({ copy: { headline: "   " } })),
    ).toThrow(/carries no eyebrow, headline or body/);
  });
});

describe("textPlateSpec", () => {
  it("hashes the copy, not the scene id — repeated headlines share one plate", () => {
    const a = computeCacheKey(
      textPlateSpec({
        scene: scene({ id: "s01" }),
        theme: "ground-default",
        ...CANVAS,
      }),
    );
    const b = computeCacheKey(
      textPlateSpec({
        scene: scene({ id: "s42" }),
        theme: "ground-default",
        ...CANVAS,
      }),
    );
    expect(a).toBe(b);
  });

  it("separates different copy, mats, kinds and presenter sides", () => {
    const base = textPlateSpec({
      scene: scene(),
      theme: "ground-default",
      ...CANVAS,
    });
    const keys = new Set(
      [
        base,
        textPlateSpec({
          scene: scene({ copy: { headline: "Something else" } }),
          theme: "ground-default",
          ...CANVAS,
        }),
        textPlateSpec({ scene: scene(), theme: "ground-inverse", ...CANVAS }),
        textPlateSpec({
          scene: scene({ kind: "chapter" }),
          theme: "ground-default",
          ...CANVAS,
        }),
        textPlateSpec({
          scene: scene({ presenterSide: "left" }),
          theme: "ground-default",
          ...CANVAS,
        }),
      ].map(computeCacheKey),
    );
    expect(keys.size).toBe(5);
  });

  it("records absent slots as null, so an absent body is not the empty string", () => {
    const spec = textPlateSpec({
      scene: scene({ copy: { headline: "H" } }),
      theme: "ground-default",
      ...CANVAS,
    });
    expect(spec.copy).toEqual({ eyebrow: null, headline: "H", body: null });
  });
});

describe("buildTextPlateHtml", () => {
  it("escapes model-written copy instead of injecting it as markup", () => {
    const html = buildTextPlateHtml({
      scene: scene({ copy: { headline: "5 < 7 & <script>alert(1)</script>" } }),
      theme: "ground-default",
      width: 1920,
      height: 1080,
    });
    expect(html).toContain("5 &lt; 7 &amp;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("draws copy in the mat's own text tokens", () => {
    const html = buildTextPlateHtml({
      scene: scene({
        copy: { eyebrow: "CHAPTER 2", headline: "H", body: "B" },
      }),
      theme: "ground-default",
      width: 1920,
      height: 1080,
    });
    expect(html).toContain(`color: ${DARK_PLATE_THEME.colors.textPrimary}`);
    expect(html).toContain(`color: ${DARK_PLATE_THEME.colors.textSecondary}`);
    expect(html).toContain(`color: ${DARK_PLATE_THEME.colors.textMuted}`);
    expect(html).toContain(DARK_PLATE_THEME.colors.copyShadow);
  });

  it("emits only the slots the scene actually carries", () => {
    const html = buildTextPlateHtml({
      scene: scene({ copy: { headline: "H" } }),
      theme: "ground-default",
      width: 1920,
      height: 1080,
    });
    expect(html).toContain('class="bh-headline"');
    expect(html).not.toContain('class="bh-eyebrow"');
    expect(html).not.toContain('class="bh-body"');
  });

  it("measures the laid-out block so the fit is decided on real numbers", () => {
    const html = buildTextPlateHtml({
      scene: scene(),
      theme: "ground-default",
      width: 1920,
      height: 1080,
    });
    expect(html).toContain("usedWidth");
    expect(html).toContain("usedHeight");
    expect(html).toContain("getBoundingClientRect");
  });
});

describe("interpretMetrics", () => {
  const box = { x: 96, y: 280, width: 1728, height: 518 };

  it("reports the measured usage when the copy fits", () => {
    expect(
      interpretMetrics(
        { usedWidth: 1200.2, usedHeight: 300.7 },
        box,
        "scene s01",
      ),
    ).toEqual({
      x: 96,
      y: 280,
      width: 1728,
      height: 518,
      usedWidth: 1201,
      usedHeight: 301,
    });
  });

  it("tolerates sub-pixel overshoot of an exactly-fitting block", () => {
    expect(() =>
      interpretMetrics(
        { usedWidth: 1728.2, usedHeight: 518.3 },
        box,
        "scene s01",
      ),
    ).not.toThrow();
  });

  it("THROWS on vertical overflow instead of clipping the copy", () => {
    expect(() =>
      interpretMetrics({ usedWidth: 1000, usedHeight: 900 }, box, "scene s01"),
    ).toThrow(PlateError);
    expect(() =>
      interpretMetrics({ usedWidth: 1000, usedHeight: 900 }, box, "scene s01"),
    ).toThrow(/does not fit its box/);
  });

  it("THROWS on horizontal overflow (an unbreakable long token)", () => {
    expect(() =>
      interpretMetrics({ usedWidth: 2400, usedHeight: 100 }, box, "scene s01"),
    ).toThrow(/does not fit its box/);
  });

  it("names the scene and both rectangles in the diagnostic", () => {
    try {
      interpretMetrics(
        { usedWidth: 1000, usedHeight: 900 },
        box,
        "scene s07 (dscr)",
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain("scene s07 (dscr)");
      expect(message).toContain("900.0");
      expect(message).toContain("518.0");
    }
  });

  it("refuses a plate whose layout was never measured", () => {
    expect(() => interpretMetrics(null, box, "scene s01")).toThrow(
      /no layout measurements/,
    );
    expect(() =>
      interpretMetrics({ usedWidth: "wide" }, box, "scene s01"),
    ).toThrow(PlateError);
  });
});
