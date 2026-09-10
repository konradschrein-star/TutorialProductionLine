/**
 * Pure, deterministic QA for 1280x720 procedural tutorial thumbnails.
 *
 * The caller supplies renderer measurements (including measured glyph widths
 * and optional raster analysis). This module performs no DB, DOM, image, or
 * network I/O, so the same report can gate browser layouts and worker retries.
 */

export const PROCEDURAL_QA_LOCALES = ["en", "de", "fr", "it", "sv"] as const;
export type ProceduralQaLocale = string;

export const PROCEDURAL_QA_CANVAS = { width: 1280, height: 720 } as const;
export const PROCEDURAL_QA_LIMITS = {
  safeMarginPx: 36,
  hostBleedFraction: 0.16,
  durationBadge: { x: 980, y: 600, width: 300, height: 120 },
  maximumHeadlineWords: 4,
  maximumHeadlineBlocks: 4,
  minimumMobileFontPx: 11.5,
  minimumGlyphUtilization: 0.5,
  maximumGlyphUtilization: 0.94,
  pillCenterTolerancePx: 8,
  minimumPrimaryFocalAreaFraction: 0.08,
  maximumPrimaryFocalAreaFraction: 0.58,
  minimumHostFocalAreaFraction: 0.025,
} as const;

export interface ProceduralRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ProceduralLayerKind =
  | "background"
  | "headline"
  | "host"
  | "logo"
  | "ui"
  | "arrow"
  | "pill"
  | "decorative";

export interface LogoRasterMetrics {
  width: number;
  height: number;
  /** Fraction of pixels whose alpha is effectively opaque. */
  opaquePixelRatio: number;
  /** Fraction of edge samples matching the dominant edge colour. */
  uniformEdgeRatio: number;
  /** Bounds of pixels that differ materially from the dominant edge colour. */
  contentBounds: ProceduralRect;
}

export interface ProceduralQaLayer {
  id: string;
  kind: ProceduralLayerKind;
  rect: ProceduralRect;
  text?: string;
  fontSizePx?: number;
  /** Canvas-measured glyph ink/advance width at fontSizePx. */
  glyphWidthPx?: number;
  glyphHeightPx?: number;
  /** Painted glyph bounds, when different from the headline layout box. */
  glyphRect?: ProceduralRect;
  /** A headline's pill layer. */
  containerId?: string;
  /** Face or other meaningful host feature, in canvas coordinates. */
  focalRect?: ProceduralRect;
  isPrimaryFocal?: boolean;
  /** Set on either an arrow or a visibly pointing host. */
  pointerTargetId?: string;
  /** Hosts may intentionally crop against the canvas edge. */
  allowEdgeBleed?: boolean;
  logoRaster?: LogoRasterMetrics;
}

export interface ProceduralQaComposition {
  locale: ProceduralQaLocale;
  width: number;
  height: number;
  layers: readonly ProceduralQaLayer[];
}

export type ProceduralQaIssueCode =
  | "invalid_canvas"
  | "invalid_geometry"
  | "edge_overflow"
  | "unsafe_margin"
  | "duration_badge_overlap"
  | "headline_block_count"
  | "headline_word_limit"
  | "headline_wrap"
  | "missing_glyph_metrics"
  | "mobile_font_too_small"
  | "glyph_underutilized"
  | "glyph_overflow"
  | "pill_missing"
  | "pill_off_center"
  | "protected_overlap"
  | "missing_primary_focal"
  | "multiple_primary_focals"
  | "invalid_primary_focal_kind"
  | "focal_area_too_small"
  | "focal_area_too_large"
  | "host_focal_missing"
  | "host_focal_outside_host"
  | "host_focal_too_small"
  | "duplicate_pointer"
  | "logo_opaque_letterbox"
  | "invalid_logo_metrics"
  | "cross_locale_drift"
  | "missing_locale";

export interface ProceduralQaIssue {
  code: ProceduralQaIssueCode;
  severity: "error" | "warning";
  message: string;
  elementIds: string[];
  metric?: number;
  limit?: number;
}

export interface ProceduralLocaleQualityReport {
  locale: ProceduralQaLocale;
  score: number;
  passed: boolean;
  metrics: {
    headlineWords: number;
    headlineBlocks: number;
    minimumMobileFontPx: number | null;
    minimumGlyphUtilization: number | null;
    primaryFocalAreaFraction: number | null;
    maximumProtectedOverlap: number;
  };
  issues: ProceduralQaIssue[];
}

export interface ProceduralLayoutQualityReport {
  version: 1;
  decision: "accept" | "reject" | "retry";
  readyForWorker: boolean;
  score: number;
  minimumLocaleScore: number;
  localeReports: Record<string, ProceduralLocaleQualityReport | null>;
  issues: ProceduralQaIssue[];
  rejectionReasons: string[];
  retryInstructions: string[];
}

export interface ProceduralQaOptions {
  failurePolicy?: "reject" | "retry";
  /** Defaults to the original five-language pack, but installations may
   * configure one locale or twenty channels without changing the QA engine. */
  expectedLocales?:readonly string[];
}

const SCORE_PENALTY: Record<ProceduralQaIssueCode, number> = {
  invalid_canvas: 50,
  invalid_geometry: 35,
  edge_overflow: 22,
  unsafe_margin: 7,
  duration_badge_overlap: 25,
  headline_block_count: 35,
  headline_word_limit: 35,
  headline_wrap: 25,
  missing_glyph_metrics: 12,
  mobile_font_too_small: 22,
  glyph_underutilized: 8,
  glyph_overflow: 22,
  pill_missing: 15,
  pill_off_center: 12,
  protected_overlap: 20,
  missing_primary_focal: 20,
  multiple_primary_focals: 20,
  invalid_primary_focal_kind: 16,
  focal_area_too_small: 18,
  focal_area_too_large: 10,
  host_focal_missing: 14,
  host_focal_outside_host: 18,
  host_focal_too_small: 16,
  duplicate_pointer: 16,
  logo_opaque_letterbox: 18,
  invalid_logo_metrics: 12,
  cross_locale_drift: 4,
  missing_locale: 50,
};

const PROTECTED_OVERLAP_LIMITS: Partial<Record<`${ProceduralLayerKind}:${ProceduralLayerKind}`, number>> = {
  "headline:headline": 0.02,
  "headline:host": 0.1,
  "headline:logo": 0.03,
  "headline:ui": 0.05,
  "host:logo": 0.08,
  // A host intentionally bleeds over the non-action edge of a UI crop in the
  // reference style. More than 40% still means the interface is being buried.
  "host:ui": 0.4,
  "logo:ui": 0.12,
};

const SAFE_KINDS = new Set<ProceduralLayerKind>(["headline", "logo", "ui", "arrow", "pill"]);
const BADGE_PROTECTED_KINDS = new Set<ProceduralLayerKind>(["headline", "logo", "ui", "arrow", "pill"]);

function finiteRect(rect: ProceduralRect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}

function area(rect: ProceduralRect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function right(rect: ProceduralRect): number { return rect.x + rect.width; }
function bottom(rect: ProceduralRect): number { return rect.y + rect.height; }

function intersectionArea(a: ProceduralRect, b: ProceduralRect): number {
  return Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y));
}

function overlapFraction(a: ProceduralRect, b: ProceduralRect): number {
  const denominator = Math.min(area(a), area(b));
  return denominator > 0 ? intersectionArea(a, b) / denominator : 0;
}

function center(rect: ProceduralRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function addIssue(issues: ProceduralQaIssue[], issue: ProceduralQaIssue): void {
  issues.push(issue);
}

function orderedPair(a: ProceduralLayerKind, b: ProceduralLayerKind): `${ProceduralLayerKind}:${ProceduralLayerKind}` {
  const rank: ProceduralLayerKind[] = ["headline", "host", "logo", "ui", "arrow", "pill", "decorative", "background"];
  return rank.indexOf(a) <= rank.indexOf(b) ? `${a}:${b}` : `${b}:${a}`;
}

function scoreFor(issues: readonly ProceduralQaIssue[]): number {
  return Math.max(0, 100 - issues.reduce((sum, issue) => sum + SCORE_PENALTY[issue.code], 0));
}

function inspectLogo(layer: ProceduralQaLayer, issues: ProceduralQaIssue[]): void {
  const raster = layer.logoRaster;
  if (!raster) return;
  if (!finiteRect(raster.contentBounds) || !Number.isFinite(raster.width) || !Number.isFinite(raster.height)
    || raster.width <= 0 || raster.height <= 0 || raster.opaquePixelRatio < 0 || raster.opaquePixelRatio > 1
    || raster.uniformEdgeRatio < 0 || raster.uniformEdgeRatio > 1 || raster.contentBounds.x < 0
    || raster.contentBounds.y < 0 || right(raster.contentBounds) > raster.width
    || bottom(raster.contentBounds) > raster.height) {
    addIssue(issues, { code: "invalid_logo_metrics", severity: "error", message: "Logo raster measurements are invalid.", elementIds: [layer.id] });
    return;
  }
  const xUtilization = raster.contentBounds.width / raster.width;
  const yUtilization = raster.contentBounds.height / raster.height;
  if (raster.opaquePixelRatio >= 0.98 && raster.uniformEdgeRatio >= 0.8 && Math.min(xUtilization, yUtilization) < 0.74) {
    addIssue(issues, {
      code: "logo_opaque_letterbox",
      severity: "error",
      message: "Logo contains a mostly opaque, uniform letterbox around undersized artwork. Crop the source or use transparency.",
      elementIds: [layer.id],
      metric: Math.min(xUtilization, yUtilization),
      limit: 0.74,
    });
  }
}

export function inspectProceduralComposition(composition: ProceduralQaComposition): ProceduralLocaleQualityReport {
  const issues: ProceduralQaIssue[] = [];
  if (composition.width !== PROCEDURAL_QA_CANVAS.width || composition.height !== PROCEDURAL_QA_CANVAS.height) {
    addIssue(issues, { code: "invalid_canvas", severity: "error", message: "Procedural tutorial thumbnails must be measured at 1280x720.", elementIds: [], metric: composition.width * composition.height, limit: PROCEDURAL_QA_CANVAS.width * PROCEDURAL_QA_CANVAS.height });
  }
  const validLayers = composition.layers.filter((layer) => {
    if (finiteRect(layer.rect)) return true;
    addIssue(issues, { code: "invalid_geometry", severity: "error", message: `Layer ${layer.id} has invalid geometry.`, elementIds: [layer.id] });
    return false;
  });
  const safe = {
    x: PROCEDURAL_QA_LIMITS.safeMarginPx,
    y: PROCEDURAL_QA_LIMITS.safeMarginPx,
    width: composition.width - PROCEDURAL_QA_LIMITS.safeMarginPx * 2,
    height: composition.height - PROCEDURAL_QA_LIMITS.safeMarginPx * 2,
  };
  let maximumProtectedOverlap = 0;
  for (const layer of validLayers) {
    if (layer.kind !== "background") {
      const overflow = Math.max(0, -layer.rect.x, -layer.rect.y, right(layer.rect) - composition.width, bottom(layer.rect) - composition.height);
      const allowedBleed = layer.kind === "host" && layer.allowEdgeBleed
        ? Math.max(layer.rect.width, layer.rect.height) * PROCEDURAL_QA_LIMITS.hostBleedFraction
        : 0;
      if (overflow > allowedBleed) addIssue(issues, { code: "edge_overflow", severity: "error", message: `${layer.kind} layer extends ${Math.ceil(overflow)}px outside the canvas.`, elementIds: [layer.id], metric: overflow, limit: allowedBleed });
    }
    if (SAFE_KINDS.has(layer.kind) && (layer.rect.x < safe.x || layer.rect.y < safe.y || right(layer.rect) > right(safe) || bottom(layer.rect) > bottom(safe))) {
      addIssue(issues, { code: "unsafe_margin", severity: "warning", message: `${layer.kind} layer is inside the canvas but outside the ${PROCEDURAL_QA_LIMITS.safeMarginPx}px safe margin.`, elementIds: [layer.id], limit: PROCEDURAL_QA_LIMITS.safeMarginPx });
    }
    if (BADGE_PROTECTED_KINDS.has(layer.kind)) {
      const overlap = overlapFraction(layer.rect, PROCEDURAL_QA_LIMITS.durationBadge);
      maximumProtectedOverlap = Math.max(maximumProtectedOverlap, overlap);
      if (overlap > 0.01) addIssue(issues, { code: "duration_badge_overlap", severity: "error", message: `${layer.kind} layer overlaps the YouTube duration-badge exclusion zone.`, elementIds: [layer.id], metric: overlap, limit: 0.01 });
    }
    if (layer.kind === "logo") inspectLogo(layer, issues);
  }

  const headlines = validLayers.filter((layer) => layer.kind === "headline" && layer.text?.trim());
  const headlineWords = headlines.reduce((sum, layer) => sum + wordCount(layer.text ?? ""), 0);
  if (headlines.length < 1 || headlines.length > PROCEDURAL_QA_LIMITS.maximumHeadlineBlocks) addIssue(issues, { code: "headline_block_count", severity: "error", message: "Use one to four non-empty headline blocks.", elementIds: headlines.map((layer) => layer.id), metric: headlines.length, limit: PROCEDURAL_QA_LIMITS.maximumHeadlineBlocks });
  if (headlineWords > PROCEDURAL_QA_LIMITS.maximumHeadlineWords) addIssue(issues, { code: "headline_word_limit", severity: "error", message: "Headline copy exceeds four total words.", elementIds: headlines.map((layer) => layer.id), metric: headlineWords, limit: PROCEDURAL_QA_LIMITS.maximumHeadlineWords });
  const mobileFonts: number[] = [];
  const glyphUtilizations: number[] = [];
  for (const headline of headlines) {
    const paintedGlyphRect = headline.glyphRect ?? headline.rect;
    if (!finiteRect(paintedGlyphRect)) addIssue(issues, { code: "invalid_geometry", severity: "error", message: `Headline ${headline.id} has invalid glyph geometry.`, elementIds: [headline.id] });
    if (/\r|\n/.test(headline.text ?? "")) addIssue(issues, { code: "headline_wrap", severity: "error", message: "Each headline block must remain on one line.", elementIds: [headline.id] });
    if (!Number.isFinite(headline.fontSizePx) || !Number.isFinite(headline.glyphWidthPx)) {
      addIssue(issues, { code: "missing_glyph_metrics", severity: "error", message: "Headline font size and measured glyph width are required for deterministic QA.", elementIds: [headline.id] });
    } else {
      const mobileFont = headline.fontSizePx! * 168 / composition.width;
      const utilization = headline.glyphWidthPx! / headline.rect.width;
      mobileFonts.push(mobileFont);
      glyphUtilizations.push(utilization);
      if (mobileFont < PROCEDURAL_QA_LIMITS.minimumMobileFontPx) addIssue(issues, { code: "mobile_font_too_small", severity: "error", message: "Headline type becomes too small at a 168px-wide mobile preview.", elementIds: [headline.id], metric: mobileFont, limit: PROCEDURAL_QA_LIMITS.minimumMobileFontPx });
      if (utilization < PROCEDURAL_QA_LIMITS.minimumGlyphUtilization) addIssue(issues, { code: "glyph_underutilized", severity: "warning", message: "Headline glyphs underuse their box and will read smaller than necessary.", elementIds: [headline.id], metric: utilization, limit: PROCEDURAL_QA_LIMITS.minimumGlyphUtilization });
      if (utilization > PROCEDURAL_QA_LIMITS.maximumGlyphUtilization || (headline.glyphHeightPx !== undefined && headline.glyphHeightPx / headline.rect.height > 0.9)) addIssue(issues, { code: "glyph_overflow", severity: "error", message: "Headline glyphs leave insufficient room for stroke and export variance.", elementIds: [headline.id], metric: utilization, limit: PROCEDURAL_QA_LIMITS.maximumGlyphUtilization });
    }
    if (headline.containerId) {
      const pill = validLayers.find((layer) => layer.id === headline.containerId && layer.kind === "pill");
      if (!pill) addIssue(issues, { code: "pill_missing", severity: "error", message: "Headline references a missing pill container.", elementIds: [headline.id, headline.containerId] });
      else {
        const headlineCenter = center(paintedGlyphRect);
        const pillCenter = center(pill.rect);
        const centerDelta = Math.max(Math.abs(headlineCenter.x - pillCenter.x), Math.abs(headlineCenter.y - pillCenter.y));
        const leftPadding = paintedGlyphRect.x - pill.rect.x;
        const rightPadding = right(pill.rect) - right(paintedGlyphRect);
        const topPadding = paintedGlyphRect.y - pill.rect.y;
        const bottomPadding = bottom(pill.rect) - bottom(paintedGlyphRect);
        const paddingDelta = Math.max(Math.abs(leftPadding - rightPadding), Math.abs(topPadding - bottomPadding));
        if (leftPadding < 0 || rightPadding < 0 || topPadding < 0 || bottomPadding < 0 || centerDelta > PROCEDURAL_QA_LIMITS.pillCenterTolerancePx || paddingDelta > PROCEDURAL_QA_LIMITS.pillCenterTolerancePx * 2) {
          addIssue(issues, { code: "pill_off_center", severity: "error", message: "Headline is not centered within its pill to export tolerance.", elementIds: [headline.id, pill.id], metric: centerDelta, limit: PROCEDURAL_QA_LIMITS.pillCenterTolerancePx });
        }
      }
    }
  }

  for (let index = 0; index < validLayers.length; index++) {
    for (let otherIndex = index + 1; otherIndex < validLayers.length; otherIndex++) {
      const first = validLayers[index]!;
      const second = validLayers[otherIndex]!;
      const limit = PROTECTED_OVERLAP_LIMITS[orderedPair(first.kind, second.kind)];
      if (limit === undefined) continue;
      const firstRect=first.kind==='host'&&second.kind!=='ui'&&first.focalRect?first.focalRect:first.rect;
      const secondRect=second.kind==='host'&&first.kind!=='ui'&&second.focalRect?second.focalRect:second.rect;
      const overlap = overlapFraction(firstRect, secondRect);
      maximumProtectedOverlap = Math.max(maximumProtectedOverlap, overlap);
      if (overlap > limit) addIssue(issues, { code: "protected_overlap", severity: "error", message: `${first.kind} and ${second.kind} overlap beyond the ${Math.round(limit * 100)}% tolerance.`, elementIds: [first.id, second.id], metric: overlap, limit });
    }
  }

  const primaryFocals = validLayers.filter((layer) => layer.isPrimaryFocal);
  const primaryFocal = primaryFocals[0];
  let primaryFocalAreaFraction: number | null = null;
  if (!primaryFocal) addIssue(issues, { code: "missing_primary_focal", severity: "error", message: "Choose one primary focal layer.", elementIds: [] });
  else {
    if (primaryFocals.length > 1) addIssue(issues, { code: "multiple_primary_focals", severity: "error", message: "Choose exactly one primary focal layer.", elementIds: primaryFocals.map((layer) => layer.id), metric: primaryFocals.length, limit: 1 });
    if (!(["host", "logo", "ui"] as ProceduralLayerKind[]).includes(primaryFocal.kind)) addIssue(issues, { code: "invalid_primary_focal_kind", severity: "error", message: "Primary focal content must be a host, logo, or product UI layer.", elementIds: [primaryFocal.id] });
    primaryFocalAreaFraction = area(primaryFocal.rect) / (composition.width * composition.height);
    if (primaryFocalAreaFraction < PROCEDURAL_QA_LIMITS.minimumPrimaryFocalAreaFraction) addIssue(issues, { code: "focal_area_too_small", severity: "error", message: "Primary focal area is too small to identify at mobile size.", elementIds: [primaryFocal.id], metric: primaryFocalAreaFraction, limit: PROCEDURAL_QA_LIMITS.minimumPrimaryFocalAreaFraction });
    if (primaryFocalAreaFraction > PROCEDURAL_QA_LIMITS.maximumPrimaryFocalAreaFraction) addIssue(issues, { code: "focal_area_too_large", severity: "warning", message: "Primary focal area crowds the remaining composition.", elementIds: [primaryFocal.id], metric: primaryFocalAreaFraction, limit: PROCEDURAL_QA_LIMITS.maximumPrimaryFocalAreaFraction });
  }
  for (const host of validLayers.filter((layer) => layer.kind === "host")) {
    if (!host.focalRect || !finiteRect(host.focalRect)) addIssue(issues, { code: "host_focal_missing", severity: "error", message: "Host requires measured face/focal bounds.", elementIds: [host.id] });
    else {
      const focalFraction = area(host.focalRect) / (composition.width * composition.height);
      if (host.focalRect.x < host.rect.x || host.focalRect.y < host.rect.y || right(host.focalRect) > right(host.rect) || bottom(host.focalRect) > bottom(host.rect)) addIssue(issues, { code: "host_focal_outside_host", severity: "error", message: "Host face/focal bounds must stay within the host cutout.", elementIds: [host.id] });
      if (focalFraction < PROCEDURAL_QA_LIMITS.minimumHostFocalAreaFraction) addIssue(issues, { code: "host_focal_too_small", severity: "error", message: "Host face/focal feature is too small at mobile size.", elementIds: [host.id], metric: focalFraction, limit: PROCEDURAL_QA_LIMITS.minimumHostFocalAreaFraction });
      if (host.focalRect.x < safe.x || host.focalRect.y < safe.y || right(host.focalRect) > right(safe) || bottom(host.focalRect) > bottom(safe)) addIssue(issues, { code: "unsafe_margin", severity: "warning", message: "Host face/focal feature leaves the safe margin.", elementIds: [host.id], limit: PROCEDURAL_QA_LIMITS.safeMarginPx });
      const badgeOverlap = overlapFraction(host.focalRect, PROCEDURAL_QA_LIMITS.durationBadge);
      if (badgeOverlap > 0.01) addIssue(issues, { code: "duration_badge_overlap", severity: "error", message: "Host focal feature overlaps the duration badge.", elementIds: [host.id], metric: badgeOverlap, limit: 0.01 });
    }
  }

  const pointers = validLayers.filter((layer) => layer.kind === "arrow" || Boolean(layer.pointerTargetId));
  for (let index = 0; index < pointers.length; index++) {
    for (let otherIndex = index + 1; otherIndex < pointers.length; otherIndex++) {
      const first = pointers[index]!;
      const second = pointers[otherIndex]!;
      if (!first.pointerTargetId || !second.pointerTargetId || first.pointerTargetId === second.pointerTargetId) {
        addIssue(issues, { code: "duplicate_pointer", severity: "error", message: "Use one pointing cue per target; remove the duplicate hand or arrow.", elementIds: [first.id, second.id] });
      }
    }
  }

  return {
    locale: composition.locale,
    score: scoreFor(issues),
    passed: !issues.some((issue) => issue.severity === "error"),
    metrics: {
      headlineWords,
      headlineBlocks: headlines.length,
      minimumMobileFontPx: mobileFonts.length ? Math.min(...mobileFonts) : null,
      minimumGlyphUtilization: glyphUtilizations.length ? Math.min(...glyphUtilizations) : null,
      primaryFocalAreaFraction,
      maximumProtectedOverlap,
    },
    issues,
  };
}

function addCrossLocaleDrift(reports: Record<string, ProceduralLocaleQualityReport | null>, compositions: Map<string, ProceduralQaComposition>,expectedLocales:readonly string[]): void {
  const english = compositions.get("en");
  if (!english) return;
  for (const locale of expectedLocales.filter((item) => item !== "en")) {
    const composition = compositions.get(locale);
    const report = reports[locale];
    if (!composition || !report) continue;
    for (const englishLayer of english.layers.filter((layer) => ["host", "logo", "ui"].includes(layer.kind))) {
      const localized = composition.layers.find((layer) => layer.id === englishLayer.id && layer.kind === englishLayer.kind);
      if (!localized || !finiteRect(localized.rect) || !finiteRect(englishLayer.rect)) continue;
      const sourceCenter = center(englishLayer.rect);
      const targetCenter = center(localized.rect);
      const centerDrift = Math.hypot(targetCenter.x - sourceCenter.x, targetCenter.y - sourceCenter.y) / Math.hypot(PROCEDURAL_QA_CANVAS.width, PROCEDURAL_QA_CANVAS.height);
      const areaDrift = Math.abs(area(localized.rect) / area(englishLayer.rect) - 1);
      if (centerDrift > 0.04 || areaDrift > 0.2) {
        const areaIsDominant = areaDrift / 0.2 >= centerDrift / 0.04;
        report.issues.push({
          code: "cross_locale_drift",
          severity: "warning",
          message: `${englishLayer.kind} geometry drifts materially from the English master.`,
          elementIds: [englishLayer.id],
          metric: areaIsDominant ? areaDrift : centerDrift,
          limit: areaIsDominant ? 0.2 : 0.04,
        });
      }
    }
    report.score = scoreFor(report.issues);
  }
}

export function inspectProceduralThumbnailSet(
  compositions: readonly ProceduralQaComposition[],
  options: ProceduralQaOptions = {},
): ProceduralLayoutQualityReport {
  const expectedLocales=[...new Set((options.expectedLocales?.length?options.expectedLocales:PROCEDURAL_QA_LOCALES).map(locale=>locale.toLowerCase()))];
  const byLocale = new Map<string, ProceduralQaComposition>();
  for (const composition of compositions) {const locale=composition.locale.toLowerCase();if(!byLocale.has(locale))byLocale.set(locale,{...composition,locale});}
  const localeReports = Object.fromEntries(expectedLocales.map((locale) => [locale, byLocale.has(locale) ? inspectProceduralComposition(byLocale.get(locale)!) : null])) as Record<string, ProceduralLocaleQualityReport | null>;
  addCrossLocaleDrift(localeReports, byLocale,expectedLocales);
  const setIssues: ProceduralQaIssue[] = expectedLocales.filter((locale) => !byLocale.has(locale)).map((locale) => ({ code: "missing_locale", severity: "error", message: `Missing ${locale} procedural composition.`, elementIds: [] }));
  const localeIssues = expectedLocales.flatMap((locale) => localeReports[locale]?.issues ?? []);
  const allIssues = [...setIssues, ...localeIssues];
  const hasErrors = allIssues.some((issue) => issue.severity === "error");
  const scores = expectedLocales.map((locale) => localeReports[locale]?.score ?? 0);
  const decision = hasErrors ? (options.failurePolicy === "retry" ? "retry" : "reject") : "accept";
  const rejectionReasons = [...new Set(allIssues.filter((issue) => issue.severity === "error").map((issue) => issue.message))];
  return {
    version: 1,
    decision,
    readyForWorker: decision === "accept",
    score: Math.round(scores.reduce((sum, score) => sum + score, 0) / Math.max(1, expectedLocales.length)),
    minimumLocaleScore: Math.min(...scores),
    localeReports,
    issues: allIssues,
    rejectionReasons,
    retryInstructions: decision === "retry" ? rejectionReasons.map((reason) => `Repair and regenerate: ${reason}`) : [],
  };
}
