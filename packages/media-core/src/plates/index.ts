/**
 * BUSINESS_PLAN_HUB — plate baking.
 *
 * `bakePlates()` is the stage that was missing: it produces
 * `metadata.business_hub.assets`, the object
 * `apps/worker-render/src/workflows/business-hub.ts` refuses to start without
 * (it throws at :736 — "metadata.business_hub.assets is missing. It must carry
 * { groundPlates, watermarkPngPath, textPlates, presenter }"). The asset stage
 * (`processors/business-hub/pipeline.ts`) calls this and writes
 * {@link BakePlatesResult.plates} into that key.
 *
 * ## What it produces, and why each one exists
 *
 * | plate      | keyed by         | why FFmpeg cannot do it            |
 * | ---------- | ---------------- | ---------------------------------- |
 * | ground     | ground-theme slug| CSS gradients: a 400px major grid + a vignette |
 * | copy       | scene id         | wrapping, letter-spacing, font fallback |
 * | watermark  | (one per video)  | vector art; ffmpeg here has no SVG decoder |
 * | head mark  | (one per video)  | same, and it is themed by CSS variables |
 *
 * Every one goes through the content-addressed store in `../cache/`
 * (`computeCacheKey` + the atomic `SegmentCache`), so the ground plate of the
 * whole catalogue is a single file and a headline that repeats across the keyword
 * matrix is rasterised once, ever.
 *
 * ## Fail-closed
 *
 * A plate that cannot be produced throws, naming the scene and the reason. There
 * is no placeholder path, no zero-byte PNG, no "?? default" theme, and no
 * silently-shrunk headline. The one thing this module will NOT do is weaken the
 * render's check — it exists to satisfy it honestly.
 */

import { mkdir, stat } from "node:fs/promises";

import type { BusinessHubPlan, BusinessHubScene } from "@repo/contracts";

import {
  createSegmentCache,
  type SegmentCache,
} from "../cache/segment-cache.js";
import { bakeGroundPlate, type BakedPlate } from "./ground-plates.js";
import { resolveChromiumExecutable } from "./rasterize.js";
import {
  bakeTextPlate,
  type TextPlateCopy,
  type TextPlatePresenterSide,
  type TextPlateScene,
  type TextPlateSceneKind,
} from "./text-plates.js";
import {
  PLATE_LOG_PREFIX,
  PlateError,
  assertAspectMatchesCanvas,
  assertCanvasSize,
  isGroundThemeSlug,
  themeForGround,
  type GroundThemeSlug,
  type PlateSet,
  type PresenterPlateAssets,
  type TextPlateBox,
} from "./types.js";
import {
  bakeHeadMarkPlate,
  bakeWatermarkPlate,
  resolveWatermarkSvgPath,
} from "./watermark.js";

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports (directory-local barrel; the package barrel is owned by task R4)
// ─────────────────────────────────────────────────────────────────────────────

export {
  PLATE_LOG_PREFIX,
  PLATE_SPEC_VERSION,
  PLATE_PALETTE,
  PLATE_TYPE_SCALE,
  PLATE_LINE_HEIGHT,
  PLATE_LETTER_SPACING,
  PLATE_FONT_FAMILY,
  PLATE_GRID_1080,
  PLATE_SAFE_MARGIN_PX,
  PLATE_WATERMARK_1080,
  MIN_LEGIBLE_PX,
  HEADLINE_MAX_CHARS,
  GROUND_THEME_SLUGS,
  DARK_PLATE_THEME,
  LIGHT_PLATE_THEME,
  PlateError,
  assertAspectMatchesCanvas,
  assertCanvasSize,
  assertLegible,
  assertNotYellow,
  assertPlatePaletteIsOcean,
  getPlateTheme,
  isGroundThemeSlug,
  scaleFor1080,
  themeForGround,
} from "./types.js";
export type {
  GroundThemeSlug,
  PlateSet,
  PlateTheme,
  PlateThemeColors,
  PlateThemeName,
  PresenterPlateAssets,
  TextPlateBox,
} from "./types.js";

export {
  buildPlateHtml,
  buildRasteriseArgs,
  chromiumCandidates,
  createChromiumSvgRasteriser,
  escapeHtml,
  isHeadlessShell,
  parsePlateMetrics,
  probePngHeader,
  rasterisePlate,
  rasteriseSvg,
  readSvgFile,
  remotionPlatformToken,
  resolveChromiumExecutable,
  METRICS_ELEMENT_ID,
} from "./rasterize.js";
export type {
  ChromiumCandidate,
  ChromiumSearchContext,
  PlateHtmlParams,
  PlateMetrics,
  PngHeader,
  RasterisePlateParams,
  RasterisePlateResult,
  RasteriseSvgParams,
  RasteriseArgsParams,
  ResolveChromiumOptions,
} from "./rasterize.js";

export {
  bakeGroundPlate,
  buildGroundPlateHtml,
  groundPlateSpec,
} from "./ground-plates.js";
export type {
  BakeGroundPlateParams,
  BakedPlate,
  GroundPlateSpec,
} from "./ground-plates.js";

export {
  assertCopyTypography,
  bakeTextPlate,
  buildTextPlateHtml,
  interpretMetrics,
  resolveTextBox,
  textPlateSpec,
  typeSizesForKind,
} from "./text-plates.js";
export type {
  BakeTextPlateParams,
  BakedTextPlate,
  TextPlateCopy,
  TextPlateLayoutBox,
  TextPlatePresenterSide,
  TextPlateScene,
  TextPlateSceneKind,
  TextPlateSpec,
  TextPlateTypeSizes,
} from "./text-plates.js";

export {
  bakeHeadMarkPlate,
  bakeWatermarkPlate,
  parseSvgIntrinsicSize,
  presenterAssetCandidates,
  resolvePresenterAssetRoot,
  resolveWatermarkSvgPath,
  watermarkPlateSize,
  HEAD_MARK_RELATIVE,
  PRESENTER_ASSETS_RELATIVE,
  WATERMARK_RELATIVE,
} from "./watermark.js";
export type {
  BakeHeadMarkPlateParams,
  BakeWatermarkPlateParams,
  MarkPlateSize,
  SvgIntrinsicSize,
  WatermarkPlateSpec,
} from "./watermark.js";

// ─────────────────────────────────────────────────────────────────────────────
// Presenter input
// ─────────────────────────────────────────────────────────────────────────────

/** Where the head-mark bitmap comes from. */
export type HeadMarkInput =
  | {
      kind: "png";
      /** An already-rasterised RGBA head mark (the Presenter Studio exports one). */
      path: string;
    }
  | {
      kind: "svg";
      /** `media/style-assets/presenter/mark/head-mark.svg`. */
      path: string;
      /**
       * Width in output pixels to bake at. Must be the LARGEST head any scene
       * draws: the compositor scales the mark down with narration loudness and
       * scaling a bitmap up reads soft. No default — the number depends on the
       * presenter placement, which this module does not own.
       */
      widthPx: number;
    };

/**
 * The presenter library, as the asset stage resolved it off disk.
 *
 * `poses` is passed straight through to the render envelope: this module never
 * inspects a pose's `head_anchor`. Every entry in `poses.json` today carries
 * `"anchor_status": "needs-calibration"`, the Presenter Studio (task U1) writes
 * the real anchors, and inventing one here is explicitly forbidden by the build
 * brief §6.
 */
export interface PresenterPlateInput {
  /** `poses.json`, parsed. */
  poses: unknown[];
  /** Directory holding `<slug>.png` per pose. */
  posePngDir: string;
  headMark: HeadMarkInput;
  placement: {
    targetCollarPx: number;
    bottomAnchor: number;
    sideInset: number;
    mirror?: boolean;
  };
  headLiftPx?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// bakePlates
// ─────────────────────────────────────────────────────────────────────────────

/** Inputs to {@link bakePlates}. */
export interface BakePlatesParams {
  /** The validated scene plan. Scene ids key the copy plates. */
  plan: BusinessHubPlan;
  /**
   * The video's ground theme — the mat the watermark and the head mark are
   * coloured for, and a plate that is always baked even if no scene names it.
   * Per-scene grounds still come from each scene's own `grade`.
   */
  theme: GroundThemeSlug;
  /** Aspect token, e.g. `"16:9"`. Must agree with `width`/`height`. */
  aspect: string;
  width: number;
  height: number;
  /**
   * Scratch directory for this job. The temporary HTML documents and the staged
   * PNGs live here; the plates THEMSELVES are committed to the content-addressed
   * store and the returned paths point there, so they survive this directory
   * being cleaned up.
   */
  outDir: string;
  /** The presenter library, or `null`/omitted when the plan places no presenter. */
  poses?: PresenterPlateInput | null;
  /** Override the store (tests pass one rooted in a temp dir). */
  cache?: SegmentCache;
  /** Override the watermark SVG location. Resolved from the media tree otherwise. */
  watermarkSvgPath?: string;
  /** Override Chromium. Resolved once per call otherwise. */
  chromiumExecutablePath?: string;
}

/** What {@link bakePlates} produced. */
export interface BakePlatesResult {
  /**
   * Write this verbatim to `metadata.business_hub.assets`. It is exactly the
   * shape `parseBusinessHubEnvelope` validates.
   */
  plates: PlateSet;
  /**
   * Per scene id, the box the copy was laid out into and the box it filled.
   * Not part of the render envelope — it is for the compositor's collision
   * checks and for QC, and it is MEASURED by the browser, never estimated.
   */
  textPlateBoxes: Record<string, TextPlateBox>;
  /** Plates served from the store. */
  cacheHits: number;
  /** Plates rasterised in this call. */
  cacheMisses: number;
  /** The Chromium every plate was rasterised with, for the job log. */
  chromiumExecutablePath: string;
}

/** Scene kinds that get a copy plate. `mg` draws its own type inside Remotion. */
const TEXT_PLATE_KINDS: readonly TextPlateSceneKind[] = [
  "broll",
  "title",
  "chapter",
  "presenter-solo",
];

/**
 * Bake every still this video's FFmpeg spine needs.
 *
 * Order of work: ground plates (one per mat in play), then the watermark, then
 * one copy plate per non-`mg` scene that carries text, then the presenter's head
 * mark. Everything is content-addressed, so a re-run after a failure re-does only
 * what is actually missing.
 *
 * @returns The render's `assets` object, the measured copy boxes, and cache
 *   telemetry.
 * @throws {PlateError} If the canvas, aspect or theme is invalid; if a scene that
 *   needs a ground names a theme that is not a known ground slug; if a scene's
 *   copy overflows its box or breaks the typographic contract; if the watermark
 *   asset is missing; if the plan places a presenter but no presenter library was
 *   supplied; or if any rasterisation fails. Nothing is defaulted past missing
 *   data — that is the whole contract of this stage.
 */
export async function bakePlates(
  params: BakePlatesParams,
): Promise<BakePlatesResult> {
  assertCanvasSize(params.width, params.height, "bakePlates");
  assertAspectMatchesCanvas(
    params.aspect,
    params.width,
    params.height,
    "bakePlates",
  );
  themeForGround(params.theme, "bakePlates job theme");

  if (params.plan.scenes.length === 0) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} bakePlates: the plan has no scenes, so there is nothing to bake ` +
        `and the render would have nothing to composite.`,
    );
  }

  await mkdir(params.outDir, { recursive: true });

  const cache = params.cache ?? createSegmentCache({ mediaExtension: "png" });
  const chromiumExecutablePath = resolveChromiumExecutable(
    params.chromiumExecutablePath === undefined
      ? {}
      : { executablePath: params.chromiumExecutablePath },
  );

  let cacheHits = 0;
  let cacheMisses = 0;
  const count = (plate: BakedPlate): BakedPlate => {
    if (plate.hit) cacheHits += 1;
    else cacheMisses += 1;
    return plate;
  };

  // ── Ground plates ─────────────────────────────────────────────────────────
  const groundPlates: Record<string, string> = {};
  for (const themeSlug of groundThemesInPlay(params.plan, params.theme)) {
    const plate = count(
      await bakeGroundPlate({
        theme: themeSlug,
        aspect: params.aspect,
        width: params.width,
        height: params.height,
        cache,
        workDir: params.outDir,
        executablePath: chromiumExecutablePath,
      }),
    );
    groundPlates[themeSlug] = plate.path;
  }

  // ── Watermark ─────────────────────────────────────────────────────────────
  const svgPath = params.watermarkSvgPath ?? resolveWatermarkSvgPath();
  const watermark = count(
    await bakeWatermarkPlate({
      theme: params.theme,
      frameHeight: params.height,
      cache,
      workDir: params.outDir,
      svgPath,
      executablePath: chromiumExecutablePath,
    }),
  );

  // ── Copy plates ───────────────────────────────────────────────────────────
  const textPlates: Record<string, string> = {};
  const textPlateBoxes: Record<string, TextPlateBox> = {};
  for (const scene of params.plan.scenes) {
    const plateScene = toTextPlateScene(scene);
    if (plateScene === null) continue;
    const baked = await bakeTextPlate({
      scene: plateScene,
      theme: copyPlateTheme(scene, plateScene),
      aspect: params.aspect,
      width: params.width,
      height: params.height,
      cache,
      workDir: params.outDir,
      executablePath: chromiumExecutablePath,
    });
    count(baked);
    textPlates[scene.id] = baked.path;
    textPlateBoxes[scene.id] = baked.box;
  }

  // ── Presenter ─────────────────────────────────────────────────────────────
  const presenter = await resolvePresenterAssets({
    plan: params.plan,
    input: params.poses ?? null,
    theme: params.theme,
    cache,
    workDir: params.outDir,
    executablePath: chromiumExecutablePath,
    count,
  });

  return {
    plates: {
      groundPlates,
      watermarkPngPath: watermark.path,
      textPlates,
      presenter,
    },
    textPlateBoxes,
    cacheHits,
    cacheMisses,
    chromiumExecutablePath,
  };
}

/**
 * Every mat this video needs a plate for: the job's own theme plus the ground of
 * each scene the render will actually look a plate up for.
 *
 * `broll` grounds are footage and `mg` grounds are drawn inside the island, so
 * neither contributes — mirroring `renderScene`'s `switch` on `scene.kind`
 * (business-hub.ts:1592-1618) rather than guessing.
 *
 * @throws {PlateError} If such a scene carries no ground theme, or one that is
 *   not a known slug.
 */
function groundThemesInPlay(
  plan: BusinessHubPlan,
  jobTheme: GroundThemeSlug,
): GroundThemeSlug[] {
  const themes = new Set<GroundThemeSlug>([jobTheme]);
  for (const scene of plan.scenes) {
    switch (scene.kind) {
      case "title":
      case "chapter":
      case "presenter-solo": {
        const grade = scene.grade;
        themeForGround(
          grade,
          `scene "${scene.id}" (${scene.beat}) ground plate`,
        );
        if (isGroundThemeSlug(grade)) themes.add(grade);
        break;
      }
      case "broll":
      case "mg":
        break;
      default: {
        const exhaustive: never = scene;
        throw new PlateError(
          `${PLATE_LOG_PREFIX} unhandled scene kind: ${JSON.stringify(exhaustive)}`,
        );
      }
    }
  }
  return [...themes];
}

/**
 * The scene facts a copy plate is a function of, or `null` when the scene needs
 * no plate (`mg` scenes typeset themselves; a scene with no copy has nothing to
 * typeset).
 *
 * Mirrors the render's own test, `scene.kind !== "mg" && sceneHasText(scene)`
 * (business-hub.ts:1659), so this module produces a plate for exactly the scenes
 * the render will look one up for — no more, and never one fewer.
 */
function toTextPlateScene(scene: BusinessHubScene): TextPlateScene | null {
  if (scene.kind === "mg") return null;

  const copy: TextPlateCopy = {
    ...(scene.text.eyebrow === undefined
      ? {}
      : { eyebrow: scene.text.eyebrow }),
    ...(scene.text.headline === undefined
      ? {}
      : { headline: scene.text.headline }),
    ...(scene.text.body === undefined ? {} : { body: scene.text.body }),
  };
  if (Object.keys(copy).length === 0) return null;

  const kind: TextPlateSceneKind = scene.kind;
  if (!TEXT_PLATE_KINDS.includes(kind)) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} scene "${scene.id}" (${scene.beat}) has kind "${kind}", which has ` +
        `no copy-plate layout.`,
    );
  }

  const side = scene.presenter?.side;
  return {
    id: scene.id,
    beat: scene.beat,
    kind,
    copy,
    ...(side === undefined
      ? {}
      : { presenterSide: side satisfies TextPlatePresenterSide }),
  };
}

/**
 * The theme a scene's COPY is drawn for.
 *
 * For a scene composited onto a ground plate this is the scene's own mat, so the
 * type has the polarity of the surface under it. For a `broll` scene it is
 * always the dark mat: the ground there is footage, not a mat, `scene.grade`
 * describes a mat the viewer never sees, and light type with a drop shadow is the
 * only treatment that survives arbitrary footage. That is a stated rendering
 * decision, not a fallback — nothing is being substituted for missing data.
 *
 * @throws {PlateError} If a ground-plate scene carries no usable ground theme.
 */
function copyPlateTheme(
  scene: BusinessHubScene,
  plateScene: TextPlateScene,
): GroundThemeSlug {
  if (plateScene.kind === "broll") return "ground-default";
  const grade = scene.grade;
  themeForGround(grade, `scene "${scene.id}" (${scene.beat}) copy plate`);
  if (!isGroundThemeSlug(grade)) {
    // Unreachable: themeForGround throws first. Kept so the narrowing is
    // explicit rather than a cast.
    throw new PlateError(
      `${PLATE_LOG_PREFIX} scene "${scene.id}" (${scene.beat}): ground theme ` +
        `${JSON.stringify(grade)} is not a known slug.`,
    );
  }
  return grade;
}

/**
 * Resolve the presenter half of the envelope.
 *
 * @returns The presenter assets, or `null` when the plan places no presenter and
 *   no library was supplied.
 * @throws {PlateError} If the plan places a presenter and no library was
 *   supplied (the render refuses such a job at business-hub.ts:1498, and failing
 *   here names every offending scene instead of the first), if the library is
 *   empty, if a pre-rasterised head mark does not exist on disk, or if the head
 *   mark cannot be baked.
 */
async function resolvePresenterAssets(args: {
  plan: BusinessHubPlan;
  input: PresenterPlateInput | null;
  theme: GroundThemeSlug;
  cache: SegmentCache;
  workDir: string;
  executablePath: string;
  count: (plate: BakedPlate) => BakedPlate;
}): Promise<PresenterPlateAssets | null> {
  const posed = args.plan.scenes.filter(
    (scene) => scene.presenter !== undefined,
  );

  if (args.input === null) {
    if (posed.length === 0) return null;
    throw new PlateError(
      `${PLATE_LOG_PREFIX} the plan places a presenter in ${posed.length} scene(s) ` +
        `(${posed.map((s) => `"${s.id}"`).join(", ")}) but bakePlates was given no presenter ` +
        `library. Pass { poses, posePngDir, headMark, placement } or the render will throw ` +
        `when it reaches the first of them — those scenes are not rendered without him.`,
    );
  }

  if (args.input.poses.length === 0) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} the presenter library is empty. It must be the parsed contents ` +
        `of media/style-assets/presenter/poses/poses.json.`,
    );
  }

  const headMark = args.input.headMark;
  let headMarkPngPath: string;
  switch (headMark.kind) {
    case "png": {
      const info = await statOrNull(headMark.path);
      if (info === null || !info.isFile()) {
        throw new PlateError(
          `${PLATE_LOG_PREFIX} the pre-rasterised head mark does not exist at ` +
            `${headMark.path}. Export it from the Presenter Studio, or pass ` +
            `{ kind: "svg", path, widthPx } and it will be baked here.`,
        );
      }
      headMarkPngPath = headMark.path;
      break;
    }
    case "svg": {
      const baked = args.count(
        await bakeHeadMarkPlate({
          theme: args.theme,
          widthPx: headMark.widthPx,
          cache: args.cache,
          workDir: args.workDir,
          svgPath: headMark.path,
          executablePath: args.executablePath,
        }),
      );
      headMarkPngPath = baked.path;
      break;
    }
    default: {
      const exhaustive: never = headMark;
      throw new PlateError(
        `${PLATE_LOG_PREFIX} unhandled head-mark source: ${JSON.stringify(exhaustive)}`,
      );
    }
  }

  return {
    poses: args.input.poses,
    posePngDir: args.input.posePngDir,
    headMarkPngPath,
    placement: {
      targetCollarPx: args.input.placement.targetCollarPx,
      bottomAnchor: args.input.placement.bottomAnchor,
      sideInset: args.input.placement.sideInset,
      ...(args.input.placement.mirror === undefined
        ? {}
        : { mirror: args.input.placement.mirror }),
    },
    ...(args.input.headLiftPx === undefined
      ? {}
      : { headLiftPx: args.input.headLiftPx }),
  };
}

async function statOrNull(
  path: string,
): Promise<{ isFile: () => boolean } | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}
