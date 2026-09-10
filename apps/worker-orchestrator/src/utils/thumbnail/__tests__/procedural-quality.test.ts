import { describe, expect, it } from "vitest";
import {
  PROCEDURAL_QA_LOCALES,
  inspectProceduralComposition,
  inspectProceduralThumbnailSet,
  type ProceduralQaComposition,
  type ProceduralQaLayer,
  type ProceduralQaLocale,
} from "../procedural-quality.js";

const baseLayers = (): ProceduralQaLayer[] => [
  { id: "background", kind: "background", rect: { x: 0, y: 0, width: 1280, height: 720 } },
  { id: "host", kind: "host", rect: { x: 820, y: 60, width: 390, height: 620 }, focalRect: { x: 930, y: 120, width: 190, height: 190 }, isPrimaryFocal: true },
  { id: "headline-1", kind: "headline", rect: { x: 70, y: 90, width: 560, height: 120 }, text: "DELETE PHOTO", fontSizePx: 112, glyphWidthPx: 500, glyphHeightPx: 82 },
  { id: "headline-2", kind: "headline", rect: { x: 70, y: 230, width: 560, height: 120 }, text: "IN GOOGLE", fontSizePx: 112, glyphWidthPx: 510, glyphHeightPx: 82 },
  { id: "logo", kind: "logo", rect: { x: 110, y: 420, width: 190, height: 190 } },
  { id: "arrow", kind: "arrow", rect: { x: 410, y: 420, width: 150, height: 110 }, pointerTargetId: "logo" },
];

function composition(locale: ProceduralQaLocale = "en", layers = baseLayers()): ProceduralQaComposition {
  return { locale, width: 1280, height: 720, layers };
}

function issues(input: ProceduralQaComposition): string[] {
  return inspectProceduralComposition(input).issues.map((issue) => issue.code);
}

describe("procedural composition constraints", () => {
  it("accepts a balanced 1280x720 reference layout", () => {
    const report = inspectProceduralComposition(composition());
    expect(report.passed).toBe(true);
    expect(report.score).toBe(100);
    expect(report.metrics).toMatchObject({ headlineWords: 4, headlineBlocks: 2 });
  });

  it("requires exact delivery dimensions", () => {
    expect(issues({ ...composition(), width: 800, height: 450 })).toContain("invalid_canvas");
  });

  it("rejects invalid and overflowing geometry while allowing bounded host bleed", () => {
    expect(issues(composition("en", [{ id: "bad", kind: "logo", rect: { x: 0, y: 0, width: -1, height: 20 }, isPrimaryFocal: true }]))).toContain("invalid_geometry");
    expect(issues(composition("en", baseLayers().map((layer) => layer.id === "logo" ? { ...layer, rect: { ...layer.rect, x: -20 } } : layer)))).toContain("edge_overflow");
    const bled = baseLayers().map((layer) => layer.id === "host" ? { ...layer, allowEdgeBleed: true, rect: { ...layer.rect, x: -20 } } : layer);
    expect(issues(composition("en", bled))).not.toContain("edge_overflow");
  });

  it("warns about safe-margin violations separately from canvas overflow", () => {
    const report = inspectProceduralComposition(composition("en", baseLayers().map((layer) => layer.id === "logo" ? { ...layer, rect: { ...layer.rect, x: 12 } } : layer)));
    expect(report.issues).toContainEqual(expect.objectContaining({ code: "unsafe_margin", severity: "warning" }));
    expect(report.passed).toBe(true);
  });

  it("protects the duration badge from headlines, logos, UI and host focal bounds", () => {
    const movedLogo = baseLayers().map((layer) => layer.id === "logo" ? { ...layer, rect: { x: 1050, y: 620, width: 180, height: 80 } } : layer);
    expect(issues(composition("en", movedLogo))).toContain("duration_badge_overlap");
    const movedFace = baseLayers().map((layer) => layer.id === "host" ? { ...layer, focalRect: { x: 1030, y: 610, width: 160, height: 90 } } : layer);
    expect(issues(composition("en", movedFace))).toContain("duration_badge_overlap");
  });

  it("allows one to four independently fitted blocks but never more than four words or embedded wraps", () => {
    const one = baseLayers().filter((layer) => layer.id !== "headline-2").map((layer) => layer.id === "headline-1" ? { ...layer, text: "FIX GOOGLE DRIVE NOW" } : layer);
    expect(issues(composition("en", one))).not.toContain("headline_block_count");
    const four=[...baseLayers(),{id:'headline-3',kind:'headline' as const,rect:{x:650,y:90,width:100,height:80},text:'NOW',fontSizePx:72,glyphWidthPx:70,glyphHeightPx:56},{id:'headline-4',kind:'headline' as const,rect:{x:650,y:190,width:100,height:80},text:'FAST',fontSizePx:72,glyphWidthPx:74,glyphHeightPx:56}];
    expect(issues(composition('en',four))).not.toContain('headline_block_count');
    expect(issues(composition('en',[...four,{id:'headline-5',kind:'headline',rect:{x:650,y:290,width:100,height:80},text:'FIVE',fontSizePx:72,glyphWidthPx:74,glyphHeightPx:56}]))).toContain('headline_block_count');
    const five = baseLayers().map((layer) => layer.id === "headline-2" ? { ...layer, text: "IN GOOGLE NOW" } : layer);
    expect(issues(composition("en", five))).toContain("headline_word_limit");
    const wrapped = baseLayers().map((layer) => layer.id === "headline-1" ? { ...layer, text: "DELETE\nPHOTO" } : layer);
    expect(issues(composition("en", wrapped))).toContain("headline_wrap");
    expect(issues(composition("en", baseLayers().filter((layer) => layer.kind !== "headline")))).toContain("headline_block_count");
  });

  it("measures mobile font size and glyph utilization", () => {
    const missing = baseLayers().map((layer) => layer.id === "headline-1" ? { ...layer, glyphWidthPx: undefined } : layer);
    expect(issues(composition("en", missing))).toContain("missing_glyph_metrics");
    const small = baseLayers().map((layer) => layer.id === "headline-1" ? { ...layer, fontSizePx: 70 } : layer);
    expect(issues(composition("en", small))).toContain("mobile_font_too_small");
    const sparse = baseLayers().map((layer) => layer.id === "headline-1" ? { ...layer, glyphWidthPx: 200 } : layer);
    expect(issues(composition("en", sparse))).toContain("glyph_underutilized");
    const crowded = baseLayers().map((layer) => layer.id === "headline-1" ? { ...layer, glyphWidthPx: 550 } : layer);
    expect(issues(composition("en", crowded))).toContain("glyph_overflow");
  });

  it("checks pill containment and centering to an eight-pixel tolerance", () => {
    const centered = [
      ...baseLayers().map((layer) => layer.id === "headline-1" ? { ...layer, rect: { x: 110, y: 110, width: 480, height: 80 }, containerId: "pill" } : layer),
      { id: "pill", kind: "pill" as const, rect: { x: 70, y: 90, width: 560, height: 120 } },
    ];
    expect(issues(composition("en", centered))).not.toContain("pill_off_center");
    const shifted = centered.map((layer) => layer.id === "headline-1" ? { ...layer, rect: { ...layer.rect, x: 150 } } : layer);
    expect(issues(composition("en", shifted))).toContain("pill_off_center");
    expect(issues(composition("en", centered.filter((layer) => layer.id !== "pill")))).toContain("pill_missing");
  });

  it("rejects protected semantic overlaps using the smaller layer area", () => {
    const overlapping = baseLayers().map((layer) => layer.id === "logo" ? { ...layer, rect: { x: 500, y: 120, width: 180, height: 180 } } : layer);
    const report = inspectProceduralComposition(composition("en", overlapping));
    expect(report.issues).toContainEqual(expect.objectContaining({ code: "protected_overlap", elementIds: ["headline-1", "logo"] }));
    expect(report.metrics.maximumProtectedOverlap).toBeGreaterThan(0.03);
  });

  it("requires a substantial primary focal layer and measured host focal bounds", () => {
    expect(issues(composition("en", baseLayers().map((layer) => ({ ...layer, isPrimaryFocal: false }))))).toContain("missing_primary_focal");
    const multiple = baseLayers().map((layer) => layer.id === "logo" ? { ...layer, isPrimaryFocal: true } : layer);
    expect(issues(composition("en", multiple))).toContain("multiple_primary_focals");
    const headlineFocal = baseLayers().map((layer) => ({ ...layer, isPrimaryFocal: layer.id === "headline-1" }));
    expect(issues(composition("en", headlineFocal))).toContain("invalid_primary_focal_kind");
    const tiny = baseLayers().map((layer) => layer.id === "host" ? { ...layer, rect: { x: 850, y: 80, width: 100, height: 100 }, focalRect: { x: 870, y: 100, width: 40, height: 40 } } : layer);
    expect(issues(composition("en", tiny))).toEqual(expect.arrayContaining(["focal_area_too_small", "host_focal_too_small"]));
    const missingFace = baseLayers().map((layer) => layer.id === "host" ? { ...layer, focalRect: undefined } : layer);
    expect(issues(composition("en", missingFace))).toContain("host_focal_missing");
    const detachedFace = baseLayers().map((layer) => layer.id === "host" ? { ...layer, focalRect: { x: 100, y: 100, width: 190, height: 190 } } : layer);
    expect(issues(composition("en", detachedFace))).toContain("host_focal_outside_host");
  });

  it("rejects duplicate arrows or a pointing host plus arrow aimed at the same target", () => {
    const duplicateArrow = [...baseLayers(), { id: "arrow-2", kind: "arrow" as const, rect: { x: 600, y: 430, width: 100, height: 100 }, pointerTargetId: "logo" }];
    expect(issues(composition("en", duplicateArrow))).toContain("duplicate_pointer");
    const pointingHost = baseLayers().map((layer) => layer.id === "host" ? { ...layer, pointerTargetId: "logo" } : layer);
    expect(issues(composition("en", pointingHost))).toContain("duplicate_pointer");
  });

  it("detects opaque letterboxing while permitting transparent or tightly cropped logos", () => {
    const raster = { width: 1000, height: 500, opaquePixelRatio: 1, uniformEdgeRatio: 0.95, contentBounds: { x: 300, y: 100, width: 400, height: 300 } };
    const letterboxed = baseLayers().map((layer) => layer.id === "logo" ? { ...layer, logoRaster: raster } : layer);
    expect(issues(composition("en", letterboxed))).toContain("logo_opaque_letterbox");
    const transparent = baseLayers().map((layer) => layer.id === "logo" ? { ...layer, logoRaster: { ...raster, opaquePixelRatio: 0.3 } } : layer);
    expect(issues(composition("en", transparent))).not.toContain("logo_opaque_letterbox");
    const invalid = baseLayers().map((layer) => layer.id === "logo" ? { ...layer, logoRaster: { ...raster, opaquePixelRatio: 2 } } : layer);
    expect(issues(composition("en", invalid))).toContain("invalid_logo_metrics");
    const outOfBounds = baseLayers().map((layer) => layer.id === "logo" ? { ...layer, logoRaster: { ...raster, contentBounds: { x: -1, y: 10, width: 400, height: 300 } } } : layer);
    expect(issues(composition("en", outOfBounds))).toContain("invalid_logo_metrics");
  });
});

describe("five-locale layout scoring", () => {
  const set = () => PROCEDURAL_QA_LOCALES.map((locale) => composition(locale));

  it("accepts and scores a complete English/German/French/Italian/Swedish set", () => {
    const report = inspectProceduralThumbnailSet(set());
    expect(report.decision).toBe("accept");
    expect(report.readyForWorker).toBe(true);
    expect(report.score).toBe(100);
    expect(Object.values(report.localeReports).every(Boolean)).toBe(true);
  });

  it("fails closed when one configured locale is absent", () => {
    const report = inspectProceduralThumbnailSet(set().filter((item) => item.locale !== "sv"));
    expect(report.decision).toBe("reject");
    expect(report.localeReports.sv).toBeNull();
    expect(report.issues).toContainEqual(expect.objectContaining({ code: "missing_locale" }));
    expect(report.minimumLocaleScore).toBe(0);
  });

  it("returns explicit retry guidance for generated bad layouts", () => {
    const bad = set().map((item) => item.locale === "de" ? { ...item, layers: item.layers.map((layer) => layer.id === "headline-1" ? { ...layer, text: "DAS IST VIEL ZU LANG" } : layer) } : item);
    const report = inspectProceduralThumbnailSet(bad, { failurePolicy: "retry" });
    expect(report.decision).toBe("retry");
    expect(report.readyForWorker).toBe(false);
    expect(report.rejectionReasons).toContain("Headline copy exceeds four total words.");
    expect(report.retryInstructions[0]).toMatch(/^Repair and regenerate:/);
    expect(report.localeReports.de?.score).toBeLessThan(report.localeReports.en!.score);
    expect(report.issues).toContainEqual(expect.objectContaining({ code: "headline_word_limit" }));
  });

  it("scores cross-locale host/logo/UI drift without rejecting an otherwise valid localized layout", () => {
    const drifted = set().map((item) => item.locale === "fr" ? { ...item, layers: item.layers.map((layer) => layer.id === "logo" ? { ...layer, rect: { ...layer.rect, x: 500 } } : layer) } : item);
    const report = inspectProceduralThumbnailSet(drifted);
    expect(report.localeReports.fr?.issues).toContainEqual(expect.objectContaining({ code: "cross_locale_drift", severity: "warning" }));
    expect(report.localeReports.fr!.score).toBeLessThan(100);
    expect(report.decision).toBe("accept");
  });

  it("supports arbitrary configured locales and averages only the requested set", () => {
    const polish = inspectProceduralThumbnailSet([{ ...composition("en"), locale: "pl" }], { expectedLocales: ["pl"] });
    expect(polish.decision).toBe("accept");
    expect(polish.score).toBe(100);
    const missing = inspectProceduralThumbnailSet([composition("en")], { expectedLocales: ["en", "pl"] });
    expect(missing.score).toBe(50);
    expect(missing.localeReports.pl).toBeNull();
  });
});
