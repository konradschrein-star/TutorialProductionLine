/**
 * BUSINESS_PLAN_HUB — asset-stage pipeline processor.
 *
 * This is the ASSET_COLLECTION-stage work for the format, invoked as a format
 * branch from `asset-collection.ts` (the same shape RANKING uses: branch, do
 * everything inline, transition, `return`).
 *
 * Order of work — each step's output is the next step's input:
 *
 *   1. script          generate if absent (./script.ts, O4), persist it
 *   2. narration       Fish Audio through the TTS GATEWAY (never a provider)
 *   3. transcript      Whisper word timings (@repo/media-core runWhisper)
 *   4. envelope        per-frame RMS for the presenter head pump (R3)
 *   5. figures         every on-screen number, from @repo/finance-kit (F1)
 *   6. plan            the scene plan (./planner.ts, O1)
 *   7. timings         Whisper-anchored scene boundaries (@repo/domain)
 *   8. visuals         every non-mg asset via the visual gateway (O3)
 *   9. validate        the hard render gate (./validate.ts, O2)
 *  10. timelines       the derived axis of every `timeline-walk` scene
 *  11. plates          ground/copy/watermark/head-mark stills (@repo/media-core
 *                      bakePlates) — this is `metadata.business_hub.assets`
 *  12. persist         plan + envelope + audio + timings + assets + timelines
 *  13. transition      QMS_VALIDATING via updateJobStatusAndDispatch
 *
 * **This stage is long-running.** TTS, Whisper and visual sourcing all run
 * inline; a 15-minute video takes 15+ minutes here. The asset-collection worker
 * must therefore hold its BullMQ lock for the whole pass —
 * `assetCollectionWorkerOptions.lockDuration` is 1_800_000 (30 min) with a
 * 10 min renew window in `packages/queue/src/options/worker-options.ts`, which
 * is what RANKING needed for exactly this reason. Verified 2026-08-15.
 *
 * **Fail closed, everywhere.** Every missing input throws naming the job id and
 * the field. Nothing is estimated, defaulted past absent pipeline data, or
 * substituted with a placeholder. There is NO human review state in this
 * format: this stage never transitions to AWAITING_VA_REVIEW (design §8 rule 7).
 *
 * Re-entrancy: the narration mp3 and the Whisper transcript are persisted the
 * moment they exist and are keyed by a hash of the script, so a retry after a
 * later step fails does not re-pay for TTS.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Queue } from "bullmq";
import { eq } from "drizzle-orm";

import { getConfig } from "@repo/config";
import {
  AmortizationScheduleSchema,
  BreakEvenResultSchema,
  BusinessHubFamilySchema,
  BusinessHubPlanSchema,
  ChartSeriesSchema,
  DscrResultSchema,
  Eb5JobsResultSchema,
  PoseManifestSchema,
  ProjectionSchema,
  SbaFeeResultSchema,
} from "@repo/contracts";
import type {
  AmortizationRow,
  AmortizationSchedule,
  BreakEvenResult,
  BusinessHubFamily,
  BusinessHubPlan,
  BusinessHubScene,
  ChartSeries,
  DscrResult,
  Eb5JobsResult,
  PoseManifest,
  Projection,
  ProjectionYear,
  SbaFeeResult,
  SentenceImage,
  VisualRef,
  WordTimestamp,
} from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { contentJobs, contentTemplates, getChannelVoice } from "@repo/db";
import { getTTSVoiceByDatabaseId } from "@repo/db/repositories";
import { computeSentenceImageTimingsWithOnsets } from "@repo/domain";
import { createContextLogger } from "@repo/logger";
import {
  bakePlates,
  computeRmsEnvelope,
  detectSilencePeriods,
  isGroundThemeSlug,
  probeMediaDuration,
  requireCalibratedPose,
  resolvePresenterLayout,
  runWhisper,
  DEFAULT_HEAD_SCALE_RANGE,
} from "@repo/media-core";
import type {
  BakePlatesParams,
  BakePlatesResult,
  GroundThemeSlug,
  PlateSet,
  PresenterPlacement,
  PresenterPlateInput,
} from "@repo/media-core";

import { crossfadeStitchAndMaster } from "../../utils/ffmpeg-tts-splicing.js";
import { requestTTS } from "../../utils/tts-gateway.js";
import { updateJobStatusAndDispatch } from "../../utils/update-and-dispatch.js";
import {
  preflightEssentialVisualProviders,
  requestVisual,
} from "../../utils/visual-gateway/index.js";
import type {
  VisualOrientation,
  VisualResult,
} from "../../utils/visual-gateway/index.js";
import { narrationTextFor, planBusinessHub } from "./planner.js";
import type { FinanceFigure, FinanceFigureSet } from "./planner.js";
import { generateBusinessHubScript, toPlannableScript } from "./script.js";
import {
  createNodeRepoSourceProbe,
  validateBusinessHubPlan,
} from "./validate.js";
import type { SceneTiming } from "./validate.js";

const logger = createContextLogger("business-hub-pipeline");

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/** Which step of the stage failed. Stable strings — safe to alert on. */
export type BusinessHubStage =
  | "config"
  | "script"
  | "tts"
  | "whisper"
  | "envelope"
  | "finance"
  | "plan"
  | "timing"
  | "visuals"
  | "timelines"
  | "plates"
  | "validate"
  | "persist"
  | "transition";

/**
 * A hard failure inside the asset stage. Always names the job and the stage, so
 * an operator can locate it without reading the worker log from the top.
 */
export class BusinessHubPipelineError extends Error {
  constructor(
    readonly stage: BusinessHubStage,
    readonly jobId: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`BUSINESS_PLAN_HUB job ${jobId} [${stage}]: ${message}`);
    this.name = "BusinessHubPipelineError";
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

const fail = (
  stage: BusinessHubStage,
  jobId: string,
  message: string,
  cause?: unknown,
): never => {
  throw new BusinessHubPipelineError(stage, jobId, message, { cause });
};

// ─────────────────────────────────────────────────────────────────────────────
// Small typed helpers (no `any`, no silent coercion)
// ─────────────────────────────────────────────────────────────────────────────

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function readString(source: JsonRecord, key: string): string | undefined {
  const value = source[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function readFiniteNumber(source: JsonRecord, key: string): number | undefined {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function readBoolean(source: JsonRecord, key: string): boolean | undefined {
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
}

/** sha256 of a UTF-8 string, hex. Used to key re-entrant TTS/Whisper reuse. */
function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    const info = await stat(candidate);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Repo root
// ─────────────────────────────────────────────────────────────────────────────

const REPO_MARKER = "pnpm-workspace.yaml";

/**
 * Absolute monorepo root. `repo` citations and `poses.json` resolve against it.
 *
 * `CONTENT_FORGE_REPO_ROOT` wins when set; otherwise this walks up from the
 * compiled module until it finds `pnpm-workspace.yaml`.
 *
 * @throws {BusinessHubPipelineError} when no root can be established. Guessing
 * one would silently turn every repo citation into "file not found" at the
 * render gate instead of naming the real problem here.
 */
async function resolveRepoRoot(jobId: string): Promise<string> {
  const override = process.env["CONTENT_FORGE_REPO_ROOT"]?.trim();
  if (override !== undefined && override.length > 0) {
    if (await fileExists(path.join(override, REPO_MARKER))) return override;
    return fail(
      "config",
      jobId,
      `CONTENT_FORGE_REPO_ROOT is set to "${override}" but ${REPO_MARKER} is not there. ` +
        `Repo-relative citations and media/style-assets/presenter/poses/poses.json ` +
        `both resolve against this path, so a wrong value fails every scene at the render gate.`,
    );
  }

  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 12; depth++) {
    if (await fileExists(path.join(dir, REPO_MARKER))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fail(
    "config",
    jobId,
    `could not locate the monorepo root: no ${REPO_MARKER} found walking up from ` +
      `${path.dirname(fileURLToPath(import.meta.url))}. Set CONTENT_FORGE_REPO_ROOT ` +
      `on this worker.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage configuration, read from the job + template (never invented)
// ─────────────────────────────────────────────────────────────────────────────

/** Runtime target when neither the job nor the template states one (design §2). */
export const BUSINESS_HUB_DEFAULT_TARGET_SECONDS = 900;

/** One finance figure the script may cite as `[fig: <id>]`. */
interface FigureSpec {
  readonly id: string;
  readonly kind: string;
  readonly inputs: JsonRecord;
  /** `series` only: the figure id this series is derived from. */
  readonly from: string | undefined;
  /** `series` only: which metric/column to plot. */
  readonly metric: string | undefined;
}

interface StageConfig {
  readonly topic: string;
  readonly family: BusinessHubFamily;
  readonly targetSeconds: number;
  readonly aspect: string;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly language: string;
  readonly channelId: string;
  readonly voiceIdOverride: string | undefined;
  readonly brollMotion: boolean;
  /**
   * Every Nth connective beat is sourced as FOOTAGE from a stock provider; every
   * other one is a generated prop plate.
   *
   * Why this exists (2026-08-16): `sourceSceneVisuals` asks for intent `broll`,
   * whose default provider order is pexels-first, and `preferMotion` hoists
   * pexels ahead of anything an explicit order puts before it
   * (`policy.ts::providerOrderFor`). So EVERY visual in this format resolved to
   * stock — while the stage's own pre-flight (step 0.5) treats a generation
   * backend as ESSENTIAL precisely because "if no generation backend can serve,
   * every visual would fall through to sourced stock and the pipeline would
   * report success on a video that is not this format at all". The pre-flight
   * guarded the failure mode; the routing then produced it anyway. The format's
   * identity is its generated prop-plate look (design §3.2), so generation is
   * now the default and stock is the stated exception.
   *
   * `undefined` means no beat is stock — every connective visual is generated.
   * The value is AUTHORED per job, never derived: how much of a video is stock
   * footage is a creative-direction call.
   */
  readonly brollPexelsEvery: number | undefined;
  /**
   * Design §3.4 subformat variant, from the create form's presenter selector
   * (`presenterMode`) or the template's `presenter_mode`. `"suit"` places the
   * photographic torso; `"none"` produces the same script and the same scene
   * plan with no figure in any scene.
   */
  readonly presenterMode: BusinessHubPresenterMode;
  /**
   * Authored presenter geometry. `undefined` is legal here and only fails if
   * the finished plan actually places the presenter (see
   * {@link resolvePresenterPlateInput}).
   */
  readonly presenterPlacement: BusinessHubPresenterPlacement | undefined;
  readonly figureSpecs: readonly FigureSpec[];
  readonly scriptContext: string | undefined;
  /**
   * Image backend + model, from the create form's two-level image control
   * (`metadata.business_hub.image_backend` / `image_model` /
   * `image_resolution`).
   *
   * All three are `undefined` when the job predates the control or the operator
   * left it on Auto. They are NOT defaulted here: the `generated` visual
   * provider owns the fallback order (job → `gpt-image-2`), and duplicating it
   * would give two places to disagree about which model drew a frame — the one
   * thing an A/B between models must never be unsure of.
   */
  readonly imageBackend: string | undefined;
  readonly imageModel: string | undefined;
  readonly imageResolution: string | undefined;
}

/**
 * The presenter subformats (design §3.4).
 *
 * `"ai-png"` is offered by the create form but is NOT implemented: nothing in
 * this repo produces a generated presenter plate, so a job asking for it is
 * rejected at config read rather than quietly rendered as `"suit"` — the whole
 * point of the variant is to compare retention on identical content, and
 * silently serving the wrong variant would poison that comparison.
 */
export const BUSINESS_HUB_PRESENTER_MODES = ["suit", "none", "ai-png"] as const;
export type BusinessHubPresenterMode =
  (typeof BUSINESS_HUB_PRESENTER_MODES)[number];

type ContentJobRow = typeof contentJobs.$inferSelect;
type ContentTemplateRow = typeof contentTemplates.$inferSelect;

/** Greatest common divisor, for turning 1920x1080 into "16:9". */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function readStageConfig(
  jobId: string,
  job: ContentJobRow,
  template: ContentTemplateRow,
): StageConfig {
  const jobMeta = asRecord(job.metadata);
  const hub = asRecord(jobMeta["business_hub"]);

  const familyRaw = readString(hub, "family");
  if (familyRaw === undefined) {
    return fail(
      "config",
      jobId,
      `metadata.business_hub.family is missing. It selects the video family and ` +
        `shapes the outline; one of ${BusinessHubFamilySchema.options.join(", ")}.`,
    );
  }
  const family = BusinessHubFamilySchema.safeParse(familyRaw);
  if (!family.success) {
    return fail(
      "config",
      jobId,
      `metadata.business_hub.family is "${familyRaw}", which is not a known family ` +
        `(${BusinessHubFamilySchema.options.join(", ")}).`,
    );
  }

  const topic =
    readString(hub, "topic") ??
    (typeof job.initial_topic === "string" &&
    job.initial_topic.trim().length > 0
      ? job.initial_topic.trim()
      : undefined) ??
    (job.title.trim().length > 0 ? job.title.trim() : undefined);
  if (topic === undefined) {
    return fail(
      "config",
      jobId,
      `no topic: metadata.business_hub.topic, initial_topic and title are all empty. ` +
        `The topic is the long-tail query the video answers and every prompt is built from it.`,
    );
  }

  // Render geometry comes from the template's render_config.settings — the same
  // place the render workflow reads it. Frame maths depends on all three, so a
  // missing one fails here rather than producing a silently wrong timeline.
  const renderConfig = asRecord(template.render_config);
  const settings = asRecord(renderConfig["settings"]);
  const fps = readFiniteNumber(settings, "fps");
  const width = readFiniteNumber(settings, "width");
  const height = readFiniteNumber(settings, "height");
  if (fps === undefined || fps <= 0) {
    return fail(
      "config",
      jobId,
      `template ${template.id} render_config.settings.fps is missing or not positive. ` +
        `Every scene boundary and the presenter envelope are computed in frames.`,
    );
  }
  if (
    width === undefined ||
    width <= 0 ||
    height === undefined ||
    height <= 0
  ) {
    return fail(
      "config",
      jobId,
      `template ${template.id} render_config.settings.width/height are missing or not ` +
        `positive. They are the minimum acceptable source width for sourced visuals; ` +
        `without them a 480px stock thumbnail would be upscaled into a 1080p frame.`,
    );
  }

  const divisor = gcd(Math.round(width), Math.round(height));
  const aspect =
    readString(hub, "aspect") ??
    (typeof job.aspect_ratio === "string" && job.aspect_ratio.trim().length > 0
      ? job.aspect_ratio.trim()
      : `${Math.round(width) / divisor}:${Math.round(height) / divisor}`);

  const targetSeconds =
    readFiniteNumber(hub, "target_seconds") ??
    (typeof job.target_duration_seconds === "number" &&
    job.target_duration_seconds > 0
      ? job.target_duration_seconds
      : BUSINESS_HUB_DEFAULT_TARGET_SECONDS);
  if (targetSeconds <= 0) {
    return fail(
      "config",
      jobId,
      `target runtime resolved to ${targetSeconds}s. It must be positive.`,
    );
  }

  if (job.channel_id === null) {
    return fail(
      "config",
      jobId,
      `channel_id is null. The narration voice is bound to the channel, and the media ` +
        `directory is keyed by it.`,
    );
  }

  return {
    topic,
    family: family.data,
    targetSeconds,
    aspect,
    fps,
    width,
    height,
    language: job.language,
    channelId: job.channel_id,
    voiceIdOverride:
      readString(hub, "voice_id") ?? readString(jobMeta, "voice_id"),
    // Design §3.2: `broll-defocus` is blurred FOOTAGE. Motion is the format's
    // intent, so it is the default; an operator can pin stills per job.
    brollMotion: readBoolean(hub, "broll_motion") ?? true,
    brollPexelsEvery: readBrollPexelsEvery(jobId, hub),
    presenterMode: readPresenterMode(jobId, hub, template),
    presenterPlacement: readPresenterPlacement(jobId, hub, template),
    figureSpecs: readFigureSpecs(jobId, hub),
    scriptContext: readString(hub, "context"),
    // Read, never defaulted — see the StageConfig field docs. `image_backend`
    // is absent on Auto, which is the mode that keeps the gateway's failover.
    imageBackend: readString(hub, "image_backend"),
    imageModel: readString(hub, "image_model"),
    imageResolution: readString(hub, "image_resolution"),
  };
}

/**
 * Read `metadata.business_hub.broll_pexels_every`.
 *
 * Absent is legal and means "no stock footage at all" — see
 * {@link StageConfig.brollPexelsEvery}.
 *
 * @throws {BusinessHubPipelineError} when it is present but is not a positive
 * integer. A fractional or zero cadence has no meaning here and rounding one
 * would silently change how much of the video is stock.
 */
function readBrollPexelsEvery(
  jobId: string,
  hub: JsonRecord,
): number | undefined {
  const raw =
    readFiniteNumber(hub, "broll_pexels_every") ??
    readFiniteNumber(hub, "brollPexelsEvery");
  if (raw === undefined) return undefined;
  if (!Number.isInteger(raw) || raw < 1) {
    return fail(
      "config",
      jobId,
      `metadata.business_hub.broll_pexels_every is ${raw}; it must be a positive ` +
        `integer. It is a cadence — "every Nth connective beat is stock footage, the ` +
        `rest are generated prop plates" — so 1 makes every beat stock and omitting it ` +
        `makes none of them stock. It is never rounded.`,
    );
  }
  return raw;
}

/**
 * Resolve the presenter subformat.
 *
 * Order: the job's own `metadata.business_hub` (the create form writes
 * `presenterMode`; `presenter_mode` is accepted too because the template and
 * the seed use snake_case), then the template's
 * `metadata.pipeline_config.business_hub.presenter_mode`, then `"suit"` — the
 * reference look, and the value the seed template already carries.
 *
 * @throws {BusinessHubPipelineError} on an unknown mode, and on `"ai-png"`,
 * which nothing produces yet.
 */
function readPresenterMode(
  jobId: string,
  hub: JsonRecord,
  template: ContentTemplateRow,
): BusinessHubPresenterMode {
  const templateHub = asRecord(
    asRecord(asRecord(template.metadata)["pipeline_config"])["business_hub"],
  );
  const raw =
    readString(hub, "presenterMode") ??
    readString(hub, "presenter_mode") ??
    readString(templateHub, "presenter_mode") ??
    "suit";

  if (!(BUSINESS_HUB_PRESENTER_MODES as readonly string[]).includes(raw)) {
    return fail(
      "config",
      jobId,
      `metadata.business_hub.presenterMode is "${raw}", which is not one of ` +
        `${BUSINESS_HUB_PRESENTER_MODES.join(", ")}.`,
    );
  }
  const mode = raw as BusinessHubPresenterMode;

  if (mode === "ai-png") {
    return fail(
      "config",
      jobId,
      `presenterMode "ai-png" is not implemented: nothing in this repo generates the ` +
        `presenter plate it needs. It is rejected rather than rendered as "suit" — the ` +
        `variant exists to compare retention on identical content, and silently ` +
        `substituting a different presenter would make that comparison meaningless. ` +
        `Choose "suit" or "none".`,
    );
  }
  return mode;
}

/**
 * Where the presenter sits in frame and how large he reads, for this video.
 *
 * These are the knobs `parsePresenterAssets` (business-hub.ts:428) calls out as
 * having "no defensible default": `targetCollarPx` is the apparent-size
 * normalisation that stops the figure teleporting between poses, and the two
 * anchors decide where in frame he stands. Nothing in the repo derives them, so
 * they are AUTHORED — read here, never invented.
 */
export interface BusinessHubPresenterPlacement {
  readonly targetCollarPx: number;
  readonly bottomAnchor: number;
  readonly sideInset: number;
  readonly mirror: boolean | undefined;
  readonly headLiftPx: number | undefined;
}

/** The keys a placement may be authored under, snake_case first. */
const PLACEMENT_FIELDS = {
  targetCollarPx: ["target_collar_px", "targetCollarPx"],
  bottomAnchor: ["bottom_anchor", "bottomAnchor"],
  sideInset: ["side_inset", "sideInset"],
  headLiftPx: ["head_lift_px", "headLiftPx"],
} as const;

/** The exact JSON an operator has to add when a plan places the presenter. */
const PLACEMENT_EXAMPLE =
  `"presenter_placement": { "target_collar_px": 150, "bottom_anchor": 1, ` +
  `"side_inset": 0.06, "mirror": false, "head_lift_px": 0 }`;

function readPlacementNumber(
  source: JsonRecord,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = readFiniteNumber(source, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Read `metadata.business_hub.presenter_placement`, falling back to the
 * template's `metadata.pipeline_config.business_hub.presenter_placement`.
 *
 * Absent is legal and returns `undefined`: a plan that places no presenter
 * (`presenter_mode: "none"`, or a manifest with no calibrated pose) needs none.
 * The asset stage throws only when the PLAN actually places him — see
 * {@link resolvePresenterPlateInput}.
 *
 * @throws {BusinessHubPipelineError} when the value is present but is not an
 * object, or is missing/non-finite in any of the three required numbers. A
 * half-authored placement would render the figure somewhere nobody chose.
 */
function readPresenterPlacement(
  jobId: string,
  hub: JsonRecord,
  template: ContentTemplateRow,
): BusinessHubPresenterPlacement | undefined {
  const templateHub = asRecord(
    asRecord(asRecord(template.metadata)["pipeline_config"])["business_hub"],
  );
  const raw =
    hub["presenter_placement"] ??
    hub["presenterPlacement"] ??
    templateHub["presenter_placement"] ??
    templateHub["presenterPlacement"];
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) {
    return fail(
      "config",
      jobId,
      `metadata.business_hub.presenter_placement must be an object, got ` +
        `${Array.isArray(raw) ? "an array" : typeof raw}. Expected ${PLACEMENT_EXAMPLE}.`,
    );
  }

  const targetCollarPx = readPlacementNumber(
    raw,
    PLACEMENT_FIELDS.targetCollarPx,
  );
  const bottomAnchor = readPlacementNumber(raw, PLACEMENT_FIELDS.bottomAnchor);
  const sideInset = readPlacementNumber(raw, PLACEMENT_FIELDS.sideInset);
  const headLiftPx = readPlacementNumber(raw, PLACEMENT_FIELDS.headLiftPx);

  if (targetCollarPx === undefined || targetCollarPx <= 0) {
    return fail(
      "config",
      jobId,
      `presenter_placement.target_collar_px is ${JSON.stringify(raw["target_collar_px"])}; ` +
        `a positive number of output pixels is required. It is the apparent-size knob: ` +
        `every pose is scaled so its collar subtends this many pixels, which is what stops ` +
        `the presenter teleporting between shots.`,
    );
  }
  if (bottomAnchor === undefined) {
    return fail(
      "config",
      jobId,
      `presenter_placement.bottom_anchor is missing or not finite. It is the fraction of ` +
        `frame height the figure's feet sit at (1 = flush with the bottom edge).`,
    );
  }
  if (sideInset === undefined) {
    return fail(
      "config",
      jobId,
      `presenter_placement.side_inset is missing or not finite. It is the fraction of ` +
        `frame width inset from the edge the figure stands against.`,
    );
  }
  if (headLiftPx !== undefined && headLiftPx < 0) {
    return fail(
      "config",
      jobId,
      `presenter_placement.head_lift_px is ${headLiftPx}; the head only travels upward, ` +
        `so it must be >= 0.`,
    );
  }

  return {
    targetCollarPx,
    bottomAnchor,
    sideInset,
    mirror: readBoolean(raw, "mirror"),
    headLiftPx,
  };
}

/**
 * Parse `metadata.business_hub.figures` into figure specs.
 *
 * Shape (an object keyed by the id the script cites in `[fig: id]`):
 *
 * ```jsonc
 * "figures": {
 *   "dscr":  { "kind": "dscr",  "inputs": { "netOperatingIncome": 120000, ... } },
 *   "curve": { "kind": "series", "from": "loan", "metric": "balance" }
 * }
 * ```
 *
 * Absent or empty is legal — a video with no figure beats needs no figures. The
 * planner throws `MISSING_FIGURE` if the script cites one that is not here, so
 * an omission can never become an invented number.
 */
function readFigureSpecs(
  jobId: string,
  hub: JsonRecord,
): readonly FigureSpec[] {
  const raw = hub["figures"];
  if (raw === undefined || raw === null) return [];
  if (!isRecord(raw)) {
    return fail(
      "config",
      jobId,
      `metadata.business_hub.figures must be an object keyed by figure id, got ` +
        `${Array.isArray(raw) ? "an array" : typeof raw}.`,
    );
  }

  const specs: FigureSpec[] = [];
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      return fail(
        "config",
        jobId,
        `metadata.business_hub.figures["${id}"] must be an object with { kind, inputs }.`,
      );
    }
    const kind = readString(value, "kind");
    if (kind === undefined) {
      return fail(
        "config",
        jobId,
        `metadata.business_hub.figures["${id}"].kind is missing.`,
      );
    }
    specs.push({
      id,
      kind,
      inputs: asRecord(value["inputs"]),
      from: readString(value, "from"),
      metric: readString(value, "metric"),
    });
  }
  return specs;
}

// ─────────────────────────────────────────────────────────────────────────────
// finance-kit port
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The subset of `@repo/finance-kit` this stage calls.
 *
 * It is a PORT rather than a static import for one reason: `@repo/finance-kit`
 * is not (yet) a declared dependency of `apps/worker-orchestrator`, and
 * `package.json` / `tsconfig.json` are not this task's to edit (build brief §5,
 * task INT). The default implementation resolves the real package at runtime and
 * throws a diagnostic naming the exact edit if it is not wired — it never
 * degrades to computing anything itself.
 *
 * Inputs are passed through untouched: finance-kit validates them and throws
 * `FinanceInputError` / `FinanceModelError` on anything it cannot compute.
 * Results are re-parsed against the `@repo/contracts` finance schemas here, so a
 * mis-shaped module fails at this boundary rather than inside a chart.
 */
export interface BusinessHubFinanceKit {
  amortizationSchedule(input: JsonRecord): unknown;
  dscr(input: JsonRecord): unknown;
  breakEven(input: JsonRecord): unknown;
  projection(input: JsonRecord): unknown;
  sbaGuarantee(input: JsonRecord): unknown;
  eb5Jobs(input: JsonRecord): unknown;
  amortizationBalanceSeries(rows: readonly AmortizationRow[]): unknown;
  amortizationCumulativeInterestSeries(
    rows: readonly AmortizationRow[],
  ): unknown;
  projectionSeries(years: readonly ProjectionYear[], metric: string): unknown;
}

const FINANCE_KIT_FUNCTIONS = [
  "amortizationSchedule",
  "dscr",
  "breakEven",
  "projection",
  "sbaGuarantee",
  "eb5Jobs",
  "amortizationBalanceSeries",
  "amortizationCumulativeInterestSeries",
  "projectionSeries",
] as const;

/**
 * Typed as `string` on purpose: a string-literal specifier would make
 * TypeScript resolve the module at compile time, and the package is not on this
 * app's dependency list yet (see {@link BusinessHubFinanceKit}).
 */
const FINANCE_KIT_MODULE: string = "@repo/finance-kit";

/**
 * Load `@repo/finance-kit`.
 *
 * @throws {BusinessHubPipelineError} when the package cannot be resolved or is
 * missing an expected calculator.
 */
export async function loadFinanceKit(
  jobId: string,
): Promise<BusinessHubFinanceKit> {
  let mod: unknown;
  try {
    mod = (await import(FINANCE_KIT_MODULE)) as unknown;
  } catch (err) {
    return fail(
      "finance",
      jobId,
      `cannot resolve "@repo/finance-kit". Every on-screen number in this format ` +
        `comes from it, so there is nothing to fall back to. Fix: add ` +
        `"@repo/finance-kit": "workspace:*" to apps/worker-orchestrator/package.json ` +
        `and { "path": "../../packages/finance-kit" } to its tsconfig references ` +
        `(build brief §5 — owner INT), then run pnpm install.`,
      err,
    );
  }

  if (!isRecord(mod)) {
    return fail(
      "finance",
      jobId,
      `"@repo/finance-kit" resolved to ${typeof mod}, not a module namespace.`,
    );
  }
  const missing = FINANCE_KIT_FUNCTIONS.filter(
    (name) => typeof mod[name] !== "function",
  );
  if (missing.length > 0) {
    return fail(
      "finance",
      jobId,
      `"@repo/finance-kit" is missing expected export(s): ${missing.join(", ")}. ` +
        `The package's public API changed; this stage must be updated rather than ` +
        `routed around.`,
    );
  }
  // Every member was just checked to be a function.
  return mod as unknown as BusinessHubFinanceKit;
}

/**
 * Compute every figure the job declared, keyed by the id a script beat cites.
 *
 * Two passes: direct calculators first, then `series` figures, which are derived
 * from an already-computed figure rather than authored.
 *
 * @throws {BusinessHubPipelineError} on an unknown figure kind, a series whose
 * source figure is missing or of the wrong kind, or a result the contracts
 * schema rejects. Never returns a figure it could not compute.
 */
export async function computeBusinessHubFigures(
  jobId: string,
  specs: readonly FigureSpec[],
  kit: BusinessHubFinanceKit,
): Promise<FinanceFigureSet> {
  if (specs.length === 0) return {};

  const figures: Record<string, FinanceFigure> = {};
  const seriesSpecs: FigureSpec[] = [];

  for (const spec of specs) {
    switch (spec.kind) {
      case "amortization":
        figures[spec.id] = {
          kind: "amortization",
          value: parseFigure(
            jobId,
            spec,
            AmortizationScheduleSchema,
            kit.amortizationSchedule(spec.inputs),
          ),
        };
        break;
      case "dscr":
        figures[spec.id] = {
          kind: "dscr",
          value: parseFigure(
            jobId,
            spec,
            DscrResultSchema,
            kit.dscr(spec.inputs),
          ),
        };
        break;
      case "break-even":
        figures[spec.id] = {
          kind: "break-even",
          value: parseFigure(
            jobId,
            spec,
            BreakEvenResultSchema,
            kit.breakEven(spec.inputs),
          ),
        };
        break;
      case "projection":
        figures[spec.id] = {
          kind: "projection",
          value: parseFigure(
            jobId,
            spec,
            ProjectionSchema,
            kit.projection(spec.inputs),
          ),
        };
        break;
      case "sba-fees":
        figures[spec.id] = {
          kind: "sba-fees",
          value: parseFigure(
            jobId,
            spec,
            SbaFeeResultSchema,
            kit.sbaGuarantee(spec.inputs),
          ),
        };
        break;
      case "eb5-jobs":
        figures[spec.id] = {
          kind: "eb5-jobs",
          value: parseFigure(
            jobId,
            spec,
            Eb5JobsResultSchema,
            kit.eb5Jobs(spec.inputs),
          ),
        };
        break;
      case "series":
        seriesSpecs.push(spec);
        break;
      default:
        return fail(
          "finance",
          jobId,
          `metadata.business_hub.figures["${spec.id}"].kind is "${spec.kind}", which is ` +
            `not a finance-kit figure kind. Known kinds: amortization, dscr, break-even, ` +
            `projection, sba-fees, eb5-jobs, series.`,
        );
    }
  }

  for (const spec of seriesSpecs) {
    figures[spec.id] = {
      kind: "series",
      value: computeSeriesFigure(jobId, spec, figures, kit),
    };
  }

  return figures;
}

/** Minimal shape of the zod schemas used above — avoids importing zod types. */
interface FigureParser<T> {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { message: string } };
}

function parseFigure<T>(
  jobId: string,
  spec: FigureSpec,
  schema: FigureParser<T>,
  computed: unknown,
): T {
  const parsed = schema.safeParse(computed);
  if (!parsed.success) {
    return fail(
      "finance",
      jobId,
      `figure "${spec.id}" (${spec.kind}) was computed but does not match its ` +
        `@repo/contracts schema: ${parsed.error.message}. A figure that fails its own ` +
        `contract would render a blank or wrong chart, so it is rejected here.`,
    );
  }
  return parsed.data;
}

const PROJECTION_METRICS = [
  "revenue",
  "cogs",
  "grossProfit",
  "operatingExpenses",
  "ebitda",
  "netIncome",
] as const;

/**
 * Derive a `series` figure from an already-computed one.
 *
 * @throws {BusinessHubPipelineError} when `from`/`metric` are missing, the
 * source figure does not exist, or the metric does not apply to the source kind.
 */
function computeSeriesFigure(
  jobId: string,
  spec: FigureSpec,
  figures: Readonly<Record<string, FinanceFigure>>,
  kit: BusinessHubFinanceKit,
): ChartSeries {
  if (spec.from === undefined) {
    return fail(
      "finance",
      jobId,
      `figure "${spec.id}" is a series but names no source figure. Add ` +
        `"from": "<figure id>" — a series is derived from a computed figure, never authored.`,
    );
  }
  const source = figures[spec.from];
  if (source === undefined) {
    return fail(
      "finance",
      jobId,
      `series "${spec.id}" derives from "${spec.from}", which is not a computed figure. ` +
        `Declare it in metadata.business_hub.figures (a series may not reference another series).`,
    );
  }
  if (spec.metric === undefined) {
    return fail(
      "finance",
      jobId,
      `series "${spec.id}" names no metric. For an amortization source use "balance" or ` +
        `"cumulativeInterest"; for a projection use one of ${PROJECTION_METRICS.join(", ")}.`,
    );
  }

  if (source.kind === "amortization") {
    const schedule: AmortizationSchedule = source.value;
    if (spec.metric === "balance") {
      return parseFigure(
        jobId,
        spec,
        ChartSeriesSchema,
        kit.amortizationBalanceSeries(schedule.rows),
      );
    }
    if (spec.metric === "cumulativeInterest") {
      return parseFigure(
        jobId,
        spec,
        ChartSeriesSchema,
        kit.amortizationCumulativeInterestSeries(schedule.rows),
      );
    }
    return fail(
      "finance",
      jobId,
      `series "${spec.id}" asks for metric "${spec.metric}" from an amortization ` +
        `schedule; only "balance" and "cumulativeInterest" exist.`,
    );
  }

  if (source.kind === "projection") {
    const projection: Projection = source.value;
    const metric = PROJECTION_METRICS.find((m) => m === spec.metric);
    if (metric === undefined) {
      return fail(
        "finance",
        jobId,
        `series "${spec.id}" asks for projection metric "${spec.metric}"; known metrics ` +
          `are ${PROJECTION_METRICS.join(", ")}.`,
      );
    }
    return parseFigure(
      jobId,
      spec,
      ChartSeriesSchema,
      kit.projectionSeries(projection.years, metric),
    );
  }

  return fail(
    "finance",
    jobId,
    `series "${spec.id}" derives from figure "${spec.from}" of kind "${source.kind}", ` +
      `which has no series form. Only amortization and projection figures produce series.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Script
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The scene planner (O1) compiles one paragraph per beat and requires leading
 * directives — exactly one `[hook]` and one `[close]`, plus `[fig:]`,
 * `[chapter:]`, `[source:]` and friends. Checking for them BEFORE narration is
 * generated turns "planner throws after 15 minutes of TTS" into "planner
 * contract violated, nothing spent".
 *
 * This is a cheap pre-flight, not a second parser: `planBusinessHub` remains
 * authoritative on the grammar.
 *
 * @throws {BusinessHubPipelineError} when the script carries no directives.
 */
export function assertScriptIsPlannable(jobId: string, script: string): void {
  const hasHook = /^\s*\[hook\]/im.test(script);
  const hasClose = /^\s*\[close\]/im.test(script);
  if (hasHook && hasClose) return;

  return void fail(
    "script",
    jobId,
    `the script does not carry the planner's beat directives ` +
      `(${hasHook ? "" : "no [hook] paragraph"}${!hasHook && !hasClose ? ", " : ""}` +
      `${hasClose ? "" : "no [close] paragraph"}). ` +
      `planner.ts compiles one scene per directive-led paragraph and requires exactly ` +
      `one [hook] and one [close]. A script GENERATED by this stage is annotated by ` +
      `toPlannableScript (script.ts) before it is persisted, so this fires only for a ` +
      `script that was written onto content_jobs.script by hand or by another tool. ` +
      `Annotate it: one paragraph per beat, "[hook]" on the first, "[close]" on the ` +
      `last, "[chapter: <title>]" to open a section, and "[fig: <id>]" on any beat that ` +
      `should render a motion graphic.`,
  );
}

/**
 * Return the job's script, generating one first when the column is empty.
 *
 * The generated script is persisted immediately so a later failure never costs a
 * second generation.
 *
 * @throws {BusinessHubPipelineError} when generation fails or produces nothing.
 */
async function ensureScript(
  db: DrizzleClient,
  jobId: string,
  job: ContentJobRow,
  config: StageConfig,
): Promise<string> {
  const existing = typeof job.script === "string" ? job.script.trim() : "";
  if (existing.length > 0) {
    logger.info(
      { jobId, chars: existing.length },
      "using the job's existing script",
    );
    return existing;
  }

  logger.info(
    { jobId, topic: config.topic, family: config.family },
    "generating BUSINESS_PLAN_HUB script",
  );

  let generated: string;
  try {
    const result = await generateBusinessHubScript({
      topic: config.topic,
      family: config.family,
      targetMinutes: config.targetSeconds / 60,
      ...(config.scriptContext === undefined
        ? {}
        : { context: config.scriptContext }),
      title: job.title,
    });
    // The generator returns tag-stripped prose; the planner compiles
    // directive-led paragraphs. Annotate here, from structure the generator
    // already produced (chapter boundaries and resolved citations) — nothing is
    // invented, and this is what closes the O4/O1 contract gap that made the
    // format unrunnable without a hand-authored script.
    generated = toPlannableScript(result).trim();
    logger.info(
      {
        jobId,
        words: result.wordCount,
        chapters: result.chapters.length,
        sources: result.sources.length,
      },
      "script generated and annotated for the scene planner",
    );
  } catch (err) {
    return fail(
      "script",
      jobId,
      `script generation failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  if (generated.length === 0) {
    return fail("script", jobId, "script generation returned an empty script");
  }

  await db
    .update(contentJobs)
    .set({ script: generated, updated_at: new Date() })
    .where(eq(contentJobs.id, jobId));

  return generated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Narration (TTS gateway → Fish Audio)
// ─────────────────────────────────────────────────────────────────────────────

/** Max characters per TTS request. Matches RANKING/drama tuning. */
const TTS_CHUNK_CHARS = 1500;

/** Split narration into <= {@link TTS_CHUNK_CHARS} chunks on sentence ends. */
export function chunkNarration(script: string): string[] {
  const trimmed = script.trim();
  if (trimmed.length <= TTS_CHUNK_CHARS) return [trimmed];

  const chunks: string[] = [];
  let remaining = trimmed;
  while (remaining.length > TTS_CHUNK_CHARS) {
    const window = remaining.slice(0, TTS_CHUNK_CHARS);
    const lastBreak = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? "),
    );
    if (lastBreak > 0) {
      chunks.push(remaining.slice(0, lastBreak + 2).trim());
      remaining = remaining.slice(lastBreak + 2);
    } else {
      chunks.push(window.trim());
      remaining = remaining.slice(TTS_CHUNK_CHARS);
    }
  }
  if (remaining.trim().length > 0) chunks.push(remaining.trim());
  return chunks;
}

interface ResolvedVoice {
  /** `tts_voices.id` (UUID). */
  readonly rowId: string;
  /** Provider-side voice reference handed to Fish. */
  readonly voiceId: string;
  readonly name: string;
  readonly speed: number | undefined;
  readonly source: "job" | "channel" | "env-default";
}

/**
 * Resolve the narration voice: an explicit per-job voice, then the channel
 * binding, then the language default — the same order the tutorial channels and
 * RANKING use, because design §9 says this format shares their single voice.
 *
 * @throws {BusinessHubPipelineError} when no voice resolves, when the row is
 * missing, or when the bound voice is not a Fish voice. The TTS gateway would
 * quietly drop a non-Fish reference and narrate in the Fish account default —
 * a different voice than the brand's, with nothing in the logs to say so.
 */
async function resolveVoice(
  db: DrizzleClient,
  jobId: string,
  config: StageConfig,
): Promise<ResolvedVoice> {
  const cfg = getConfig();
  const channelVoice = await getChannelVoice(db, config.channelId);
  const envDefault =
    config.language === "de" ? cfg.DEFAULT_VOICE_DE : cfg.DEFAULT_VOICE_EN;

  const rowId = config.voiceIdOverride ?? channelVoice?.id ?? envDefault;
  const source: ResolvedVoice["source"] =
    config.voiceIdOverride !== undefined
      ? "job"
      : channelVoice !== null
        ? "channel"
        : "env-default";

  if (rowId === undefined || rowId.trim().length === 0) {
    return fail(
      "tts",
      jobId,
      `no TTS voice: metadata.business_hub.voice_id is unset, channel ${config.channelId} ` +
        `has no active voice binding, and DEFAULT_VOICE_${config.language.toUpperCase()} is empty.`,
    );
  }

  const voice = await getTTSVoiceByDatabaseId(db, rowId);
  if (voice === null) {
    return fail(
      "tts",
      jobId,
      `voice ${rowId} (resolved from ${source}) is not a row in tts_voices.`,
    );
  }

  const provider = voice.provider.trim().toLowerCase();
  if (
    provider !== "fish" &&
    provider !== "fishaudio" &&
    provider !== "fish_audio"
  ) {
    return fail(
      "tts",
      jobId,
      `voice "${voice.name}" (${rowId}, resolved from ${source}) is a ${voice.provider} ` +
        `voice, but this format narrates with Fish Audio and no other voice ` +
        `(design §9 — the voice is the brand). The TTS gateway would silently drop this ` +
        `reference and use the Fish account default, so it is rejected here instead. ` +
        `Bind a Fish voice to channel ${config.channelId} or set ` +
        `metadata.business_hub.voice_id.`,
    );
  }

  const settings = asRecord(voice.settings);
  return {
    rowId,
    voiceId: voice.voice_id,
    name: voice.name,
    speed: readFiniteNumber(settings, "speed"),
    source,
  };
}

/**
 * Generate the narration track through the TTS gateway and master it to one mp3.
 *
 * @throws {BusinessHubPipelineError} on any TTS or stitching failure.
 */
async function generateNarration(
  jobId: string,
  script: string,
  voice: ResolvedVoice,
  outputPath: string,
): Promise<void> {
  const chunks = chunkNarration(script);
  const tmpBase = path.join(tmpdir(), `business-hub-tts-${jobId}`);
  const chunkPaths: string[] = [];

  logger.info(
    { jobId, chunks: chunks.length, voice: voice.name, source: voice.source },
    "generating BUSINESS_PLAN_HUB narration through the TTS gateway",
  );

  try {
    for (let i = 0; i < chunks.length; i++) {
      const text = chunks[i];
      if (text === undefined) {
        return fail(
          "tts",
          jobId,
          `narration chunk ${i} is undefined after chunking`,
        );
      }
      const buffer = await requestTTS(text, voice.voiceId, {
        format: "BUSINESS_PLAN_HUB",
        engine: "fish",
        ...(voice.speed === undefined ? {} : { speed: voice.speed }),
        context: `business-hub:${jobId}`,
      });
      const chunkPath = `${tmpBase}-${i}.mp3`;
      await writeFile(chunkPath, buffer);
      chunkPaths.push(chunkPath);
    }
    await crossfadeStitchAndMaster(chunkPaths, outputPath, { loudnormTp: -2 });
  } catch (err) {
    return fail(
      "tts",
      jobId,
      `narration generation failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  } finally {
    for (const p of chunkPaths) await unlink(p).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Whisper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Word-level timings for the narration.
 *
 * Words Whisper returned without usable start/end are DROPPED, never placed at
 * t=0 — an invented position for one word pulls a whole scene's anchor with it.
 *
 * @throws {BusinessHubPipelineError} when Whisper fails or yields no usable word.
 */
async function transcribeNarration(
  jobId: string,
  audioPath: string,
  language: string,
): Promise<WordTimestamp[]> {
  let raw: unknown;
  try {
    raw = await runWhisper(audioPath, language);
  } catch (err) {
    return fail(
      "whisper",
      jobId,
      `Whisper transcription failed for ${audioPath}: ` +
        `${err instanceof Error ? err.message : String(err)}. Every scene boundary in ` +
        `this format is anchored to the word stream, so there is nothing to continue ` +
        `with. The narration mp3 is already on disk and a retry will not re-pay for TTS.`,
      err,
    );
  }

  if (!Array.isArray(raw)) {
    return fail(
      "whisper",
      jobId,
      `Whisper returned ${typeof raw} instead of a word array for ${audioPath}.`,
    );
  }

  const words: WordTimestamp[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const word = typeof entry["word"] === "string" ? entry["word"].trim() : "";
    const start = Number(entry["start"] ?? entry["start_time"]);
    const end = Number(entry["end"] ?? entry["end_time"]);
    if (word.length === 0 || !Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }
    words.push({ word, start, end });
  }

  const dropped = raw.length - words.length;
  if (dropped > 0) {
    logger.warn(
      { jobId, dropped, total: raw.length },
      "dropped Whisper words with no usable timing rather than placing them at t=0",
    );
  }
  if (words.length === 0) {
    return fail(
      "whisper",
      jobId,
      `Whisper returned ${raw.length} entries for ${audioPath} but none carried usable ` +
        `start/end timings. Check the mp3 is not silent and that language "${language}" ` +
        `matches what is spoken.`,
    );
  }
  return words;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene timing
// ─────────────────────────────────────────────────────────────────────────────

interface SceneTimingRow extends SceneTiming {
  readonly beat: string;
  readonly startFrame: number;
  readonly endFrame: number;
}

/**
 * Anchor every scene to the narration with
 * `computeSentenceImageTimingsWithOnsets` (packages/domain/src/pacing.ts:669).
 *
 * That function throws below a 0.5 match rate; the throw is propagated
 * unchanged — catching it would be the fixed-cadence fallback this codebase
 * forbids. On top of it this stage requires EVERY scene to be a real match: an
 * unmatched scene's start is linearly interpolated, and an interpolated boundary
 * is a guess that desynchronises the picture from the voice with nothing failing.
 *
 * The returned rows are contiguous by construction — scene N ends where scene
 * N+1 begins, and the last scene ends at the measured narration duration — which
 * is what the render gate (validate.ts) checks.
 *
 * @throws {BusinessHubPipelineError} when a scene is unmatched, when the
 * anchors are not strictly increasing, or when a scene has no timing at all.
 */
async function computeSceneTimings(
  jobId: string,
  plan: BusinessHubPlan,
  audioPath: string,
  words: WordTimestamp[],
  narrationDurationSec: number,
  fps: number,
): Promise<SceneTimingRow[]> {
  const sentenceImages: SentenceImage[] = plan.scenes.map((scene, index) => ({
    // The scene's spoken text is what gets matched against the word stream.
    sentence_text: scene.narration,
    // Unused by the timing pass; carries the beat slug so the pacing log names
    // something an operator can find in the plan.
    image_prompt: scene.beat,
    group_index: index,
  }));

  const onsets = await detectSilencePeriods(audioPath);
  const totalFrames = Math.max(1, Math.round(narrationDurationSec * fps));

  // Throws below a 0.5 match rate — deliberately not caught.
  const segments = await computeSentenceImageTimingsWithOnsets(
    audioPath,
    onsets,
    0,
    totalFrames,
    sentenceImages,
    words,
    fps,
  );

  const byGroup = new Map<number, (typeof segments)[number]>();
  for (const segment of segments) byGroup.set(segment.group_index, segment);

  const unmatched: string[] = [];
  const starts: number[] = [];
  for (let i = 0; i < plan.scenes.length; i++) {
    const scene = plan.scenes[i];
    if (scene === undefined) {
      return fail("timing", jobId, `plan scene ${i} is undefined`);
    }
    const segment = byGroup.get(i);
    if (segment === undefined) {
      return fail(
        "timing",
        jobId,
        `scene ${scene.id} (${scene.beat}) got no timing back from the anchoring pass. ` +
          `A scene with no duration cannot be placed on the timeline.`,
      );
    }
    if (!segment.matched) unmatched.push(`${scene.id} (${scene.beat})`);
    // Scene 0 always owns the head of the track, including any leading silence.
    starts.push(i === 0 ? 0 : segment.start_frame / fps);
  }

  if (unmatched.length > 0) {
    return fail(
      "timing",
      jobId,
      `${unmatched.length}/${plan.scenes.length} scene(s) could not be located in the ` +
        `narration and would have had their start time interpolated: ` +
        `${unmatched.slice(0, 8).join(", ")}${unmatched.length > 8 ? ", …" : ""}. ` +
        `An interpolated boundary is a guess that silently desynchronises picture from ` +
        `voice for the rest of the video. Fix: make the scene's opening words match what ` +
        `is actually spoken (numerals, abbreviations and symbols are the usual culprits), ` +
        `then retry — narration and transcript are cached and will not be regenerated.`,
    );
  }

  const rows: SceneTimingRow[] = [];
  for (let i = 0; i < plan.scenes.length; i++) {
    const scene = plan.scenes[i];
    const startSec = starts[i];
    if (scene === undefined || startSec === undefined) {
      return fail("timing", jobId, `scene/start missing at index ${i}`);
    }
    const nextStart = starts[i + 1];
    const endSec = nextStart === undefined ? narrationDurationSec : nextStart;
    if (!(endSec > startSec)) {
      return fail(
        "timing",
        jobId,
        `scene ${scene.id} (${scene.beat}) spans ${startSec.toFixed(3)}s → ` +
          `${endSec.toFixed(3)}s, a non-positive duration. Two beats anchored to the same ` +
          `moment, or a beat anchored past the end of the narration. Merge the beats or ` +
          `give this one real narration.`,
      );
    }
    rows.push({
      sceneId: scene.id,
      beat: scene.beat,
      startSec,
      endSec,
      startFrame: Math.round(startSec * fps),
      endFrame: Math.round(endSec * fps),
    });
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Visual sourcing
// ─────────────────────────────────────────────────────────────────────────────

export interface SourcedVisual {
  readonly sceneId: string;
  readonly beat: string;
  readonly visual: VisualRef;
  readonly posture: VisualResult["posture"];
  readonly reviewReason: string | null;
  readonly contentHash: string;
  readonly storagePath: string;
  readonly bytes: number;
  readonly mediaKind: VisualResult["mediaKind"];
  readonly deduplicated: boolean;
}

function orientationFor(width: number, height: number): VisualOrientation {
  if (width > height) return "landscape";
  if (height > width) return "portrait";
  return "square";
}

/**
 * How far short of its scene a sourced clip may fall before the beat is
 * rejected. Mirrors `MAX_BROLL_HOLD_RATIO` / `MAX_BROLL_HOLD_SECONDS` in
 * apps/worker-render/src/workflows/business-hub.ts, which is the authoritative
 * gate — this one exists so the failure lands during sourcing, where the
 * remedy (re-query, split the beat, pin stills) is still available, rather than
 * after the narration and every other asset has been paid for.
 */
const MAX_BROLL_SHORTFALL_RATIO = 0.2;
const MAX_BROLL_SHORTFALL_SECONDS = 2;

/** De-kebab a beat slug into a readable search phrase. */
function phraseFromBeat(beat: string): string {
  return beat
    .split("-")
    .filter((part) => part.length > 0)
    .join(" ");
}

/**
 * Function words that carry no picture. Stripped before a beat's narration is
 * handed to the gateway as a subject.
 *
 * A connective beat's slug is the FIRST SEVEN WORDS of its narration
 * (planner.ts `roleSlugSeed`), which in practice is mostly this list:
 * "the-plan-builder-we-run-is-trained", "if-the-projections-report-gross-revenue-with".
 * Feeding that to an image model asks it for a picture of nothing in particular,
 * and it answers with its idea of a generic business desk — the same one, every
 * time. That is one of the two mechanisms behind "the same plate ten times".
 */
const SUBJECT_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can",
  "do", "does", "for", "from", "get", "gets", "had", "has", "have", "how", "i",
  "if", "in", "into", "is", "it", "its", "not", "of", "on", "one", "or", "our",
  "out", "over", "run", "runs", "she", "so", "than", "that", "the", "their",
  "them", "then", "there", "these", "they", "this", "to", "up", "use", "used",
  "was", "we", "were", "what", "when", "which", "who", "will", "with", "you",
  "your",
]);

/** How many distinct content words describe a beat well enough to draw it. */
const SUBJECT_MAX_WORDS = 8;

/**
 * The subject phrase for one b-roll beat.
 *
 * Order: the beat's own headline (an author wrote it, it is the best label we
 * will ever have), then the CONTENT WORDS of the beat's own narration, then the
 * de-kebabbed beat slug as a last resort.
 *
 * The middle rung is the one that matters. It is what makes every beat ask for
 * a different picture instead of every beat asking for "a business desk", and it
 * reads the scene's own spoken text rather than the truncated slug derived from
 * it — same source, more of it, function words removed.
 *
 * @returns the phrase, or `null` when the beat yields nothing sayable. The
 *          caller fails the job; nothing is invented here.
 */
export function visualSubjectFor(scene: BusinessHubScene): string | null {
  const headline = scene.text.headline?.trim();
  if (headline !== undefined && headline.length > 0) return headline;

  const seen = new Set<string>();
  const words: string[] = [];
  for (const raw of scene.narration.toLowerCase().split(/[^a-z0-9']+/)) {
    const word = raw.replace(/^'+|'+$/g, "");
    if (word.length < 3) continue;
    if (SUBJECT_STOPWORDS.has(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    words.push(word);
    if (words.length === SUBJECT_MAX_WORDS) break;
  }
  if (words.length > 0) return words.join(" ");

  const fallback = phraseFromBeat(scene.beat).trim();
  return fallback.length > 0 ? fallback : null;
}

/**
 * Source every scene that needs a real asset through the visual gateway (O3).
 *
 * Only `broll` scenes carry a `visual`: `mg` scenes are rendered by Remotion,
 * and title/chapter/presenter-solo scenes are ground + type + figure. A `broll`
 * scene that already has a visual (a retry, or an operator-pinned asset) is left
 * exactly as it is.
 *
 * @throws {BusinessHubPipelineError} when a scene cannot be sourced. There is no
 * placeholder: an unsourced b-roll scene fails the render gate anyway, and it
 * fails here with the provider attempts attached.
 */
async function sourceSceneVisuals(
  jobId: string,
  plan: BusinessHubPlan,
  timings: readonly SceneTimingRow[],
  config: StageConfig,
): Promise<{ plan: BusinessHubPlan; sourced: SourcedVisual[] }> {
  const timingById = new Map(timings.map((t) => [t.sceneId, t]));
  const orientation = orientationFor(config.width, config.height);
  const sourced: SourcedVisual[] = [];
  const scenes: BusinessHubScene[] = [];
  /** How many broll scenes have been sourced, for the stock-footage cadence. */
  let brollIndex = 0;

  for (const scene of plan.scenes) {
    if (scene.kind !== "broll" || scene.visual !== undefined) {
      scenes.push(scene);
      continue;
    }

    // Generated prop plate, or stock footage? See StageConfig.brollPexelsEvery:
    // generation is this format's identity and stock is the stated exception, so
    // the default (no cadence authored) generates every connective visual.
    //
    // `preferMotion` must stay FALSE on a generated beat: providerOrderFor()
    // hoists pexels to the front of ANY order whenever preferMotion is set, so
    // leaving it on would route the beat straight back to stock and quietly undo
    // the choice made here.
    const pexelsEvery = config.brollPexelsEvery;
    const useStockFootage =
      pexelsEvery !== undefined && brollIndex % pexelsEvery === pexelsEvery - 1;
    /** This beat's position in the video, before the counter moves on. */
    const beatIndex = brollIndex;
    brollIndex += 1;

    const timing = timingById.get(scene.id);
    if (timing === undefined) {
      return fail(
        "visuals",
        jobId,
        `scene ${scene.id} (${scene.beat}) has no timing, so a motion clip's length is ` +
          `unknown. Sourcing must run after the anchoring pass.`,
      );
    }

    const query = visualSubjectFor(scene);
    if (query === null) {
      return fail(
        "visuals",
        jobId,
        `scene ${scene.id} (${scene.beat}) yields no search phrase: it has no headline, its ` +
          `narration contains no content words, and its beat slug is empty. The gateway is ` +
          `never asked to guess what a scene is about.`,
      );
    }

    const durationSeconds = timing.endSec - timing.startSec;
    let result: VisualResult;
    try {
      const preferMotion = useStockFootage && config.brollMotion;
      result = await requestVisual({
        intent: "broll",
        query,
        orientation,
        minWidth: Math.round(config.width),
        providerOrder: useStockFootage
          ? ["pexels", "generated"]
          : ["generated", "pexels"],
        preferMotion,
        ...(preferMotion ? { motionDurationSeconds: durationSeconds } : {}),
        topic: config.topic,
        // Rotates the camera/staging clause per beat so a run of generated
        // plates does not come back as one picture repeated. The style block is
        // untouched by it — see art-direction.ts ART_DIRECTION_VARIATIONS.
        variationIndex: beatIndex,
        // The operator's image backend/model choice. Only the `generated`
        // provider reads these; a sourced provider (Pexels, Wikimedia) ignores
        // them, which is correct — nothing is generated on that path.
        ...(config.imageBackend !== undefined
          ? { imageBackend: config.imageBackend }
          : {}),
        ...(config.imageModel !== undefined
          ? { imageModel: config.imageModel }
          : {}),
        ...(config.imageResolution !== undefined
          ? { imageResolution: config.imageResolution }
          : {}),
      });
    } catch (err) {
      return fail(
        "visuals",
        jobId,
        `scene ${scene.id} (${scene.beat}) could not be sourced for "${query}": ` +
          `${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    // A motion asset must actually cover the scene it was sourced for.
    //
    // `motionDurationSeconds` above states the length the scene needs, and
    // nothing downstream re-states it: the render pads any short video ground
    // with `tpad=stop_mode=clone`, so a clip that is too short does not fail —
    // it holds its last frame for the remainder and the render reports success.
    // The upstream floor (`footage-quality-gate.ts`, minDurationSeconds: 5)
    // legitimately accepts a 5s clip, so this is the only place the request and
    // the delivery are compared. Measured off the stored FILE, not read from
    // the provenance record, because a recorded number that disagrees with the
    // bytes on disk is exactly what this is here to catch.
    if (result.mediaKind === "video") {
      let clipSeconds: number;
      try {
        clipSeconds = await probeMediaDuration(result.storagePath);
      } catch (err) {
        return fail(
          "visuals",
          jobId,
          `scene ${scene.id} (${scene.beat}) sourced a video ` +
            `(${result.visual.provider}, ${result.visual.sourceUrl}) whose duration could ` +
            `not be probed at ${result.storagePath}. A clip whose length is unknown ` +
            `cannot be checked against its ${durationSeconds.toFixed(1)}s scene, and an ` +
            `unchecked short clip freezes on its last frame for the remainder.`,
          err,
        );
      }
      const shortfall = durationSeconds - clipSeconds;
      if (
        shortfall > 0 &&
        (shortfall / durationSeconds > MAX_BROLL_SHORTFALL_RATIO ||
          shortfall > MAX_BROLL_SHORTFALL_SECONDS)
      ) {
        return fail(
          "visuals",
          jobId,
          `scene ${scene.id} (${scene.beat}) needs ${durationSeconds.toFixed(1)}s of ` +
            `motion but the gateway returned a ${clipSeconds.toFixed(1)}s clip ` +
            `(${result.visual.provider}, ${result.visual.sourceUrl}). It would sit frozen ` +
            `on its last frame for ${shortfall.toFixed(1)}s — ` +
            `${((shortfall / durationSeconds) * 100).toFixed(0)}% of the scene, against a ` +
            `bound of ${(MAX_BROLL_SHORTFALL_RATIO * 100).toFixed(0)}% / ` +
            `${MAX_BROLL_SHORTFALL_SECONDS}s. Re-run with a different query, split the ` +
            `beat, or pin stills for this job with ` +
            `metadata.business_hub.broll_motion = false.`,
        );
      }
    }

    sourced.push({
      sceneId: scene.id,
      beat: scene.beat,
      visual: result.visual,
      posture: result.posture,
      reviewReason: result.reviewReason,
      contentHash: result.contentHash,
      storagePath: result.storagePath,
      bytes: result.bytes,
      mediaKind: result.mediaKind,
      deduplicated: result.deduplicated,
    });
    scenes.push({ ...scene, visual: result.visual });

    logger.info(
      {
        jobId,
        scene: scene.id,
        provider: result.visual.provider,
        posture: result.posture,
        deduplicated: result.deduplicated,
      },
      "sourced scene visual",
    );
  }

  assertDistinctVisuals(jobId, sourced);

  // Re-parse: the attachments must still satisfy the scene contract.
  const reparsed = BusinessHubPlanSchema.safeParse({ ...plan, scenes });
  if (!reparsed.success) {
    return fail(
      "visuals",
      jobId,
      `the plan no longer parses after attaching sourced visuals: ` +
        `${reparsed.error.message}`,
    );
  }
  return { plan: reparsed.data, sourced };
}

/**
 * ONE DISTINCT PLATE PER SCENE — enforced, not hoped for.
 *
 * The library is content-addressed and the gateway deduplicates on both
 * `sourceUrl` and sha256 (see `visual-gateway/gateway.ts`). That is exactly
 * right ACROSS videos — the 200th bakery script should not re-download the same
 * SBA form — and exactly wrong WITHIN one video, where two beats resolving to
 * the same bytes means the viewer sees the same frame twice and the render
 * still reports success. The v2 render (2026-08-16) shipped with the whole
 * middle of the video reading as one repeated plate.
 *
 * Nothing here re-sources or substitutes: a repeat means the two beats asked
 * for the same picture, and the remedy is upstream in the script or the subject
 * phrase, not a second roll of the dice at asset time.
 *
 * @throws {BusinessHubPipelineError} when two b-roll scenes share a content hash.
 */
export function assertDistinctVisuals(
  jobId: string,
  sourced: readonly SourcedVisual[],
): void {
  const byHash = new Map<string, SourcedVisual[]>();
  for (const entry of sourced) {
    const bucket = byHash.get(entry.contentHash);
    if (bucket === undefined) byHash.set(entry.contentHash, [entry]);
    else bucket.push(entry);
  }
  const repeats = [...byHash.values()].filter((bucket) => bucket.length > 1);
  if (repeats.length === 0) return;

  const detail = repeats
    .map(
      (bucket) =>
        `  - ${bucket[0]!.contentHash.slice(0, 12)} (${bucket[0]!.visual.provider}) is used by ` +
        bucket.map((e) => `${e.sceneId} "${e.beat}"`).join(", "),
    )
    .join("\n");
  return fail(
    "visuals",
    jobId,
    `${repeats.length} visual(s) are reused by more than one scene of this video:\n${detail}\n` +
      `Every beat must carry its own picture or the video stops moving. The gateway ` +
      `deduplicates by content hash across the whole catalogue, which is correct between ` +
      `videos and wrong inside one — two beats landing on the same hash means they asked ` +
      `for the same thing. Fix the beats' subjects (their headlines, or the narration the ` +
      `subject phrase is derived from), not this check.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Poses
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load `media/style-assets/presenter/poses/poses.json`, uncalibrated entries and
 * all — the planner and the validator are what reject those.
 *
 * @throws {BusinessHubPipelineError} when the file is absent or malformed.
 */
async function loadPoses(
  jobId: string,
  repoRoot: string,
): Promise<PoseManifest> {
  const posesPath = path.join(
    repoRoot,
    "media",
    "style-assets",
    "presenter",
    "poses",
    "poses.json",
  );
  let text: string;
  try {
    text = await readFile(posesPath, "utf8");
  } catch (err) {
    return fail(
      "plan",
      jobId,
      `cannot read the pose manifest at ${posesPath}: ` +
        `${err instanceof Error ? err.message : String(err)}. The presenter cannot be ` +
        `placed without it.`,
      err,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text) as unknown;
  } catch (err) {
    return fail("plan", jobId, `${posesPath} is not valid JSON`, err);
  }

  const manifest = PoseManifestSchema.safeParse(parsedJson);
  if (!manifest.success) {
    return fail(
      "plan",
      jobId,
      `${posesPath} does not match PoseManifestSchema: ${manifest.error.message}`,
    );
  }
  return manifest.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline axes — metadata.business_hub.timelines
// ─────────────────────────────────────────────────────────────────────────────

/** One labelled position on a `timeline-walk` axis. */
interface TimelineTick {
  readonly value: number;
  readonly label: string;
}

/**
 * Axis data for one `timeline-walk` scene, in exactly the shape
 * `parseSceneTimelines` (apps/worker-render/src/workflows/business-hub.ts:500)
 * validates and `timelineWalkGeometry` consumes.
 *
 * DERIVED, never authored: the ticks are the scene's own timeline events and the
 * domain is their index extent. The render refuses to start when a
 * `timeline-walk` scene has no entry here, because "the figure stands at a
 * coordinate on the axis" is the whole layout and there is no defensible default
 * coordinate.
 */
export interface BusinessHubSceneTimelineAxis {
  readonly ticks: readonly TimelineTick[];
  readonly domain: { readonly min: number; readonly max: number };
  /** Present only when the scene places the presenter. */
  readonly presenterValue?: number;
}

/** The `pointsAt` convention the planner writes: `point-<0-based index>`. */
const POINTS_AT_PATTERN = /^point-(\d+)$/;

/**
 * The events a `TimelineGraphic` draws, as the render's own element declares
 * them (apps/worker-render/src/remotion/business-hub/elements/TimelineGraphic.tsx).
 */
interface TimelineEventProp {
  readonly marker: string;
}

/**
 * Read the `events` array off a `timeline-walk` scene's props.
 *
 * @throws {BusinessHubPipelineError} when the scene carries no usable events —
 * the axis is a function of them and nothing else, so a scene without them fails
 * the job here, naming the scene, instead of reaching Chromium with an invented
 * axis.
 */
function timelineEventsFor(
  jobId: string,
  where: string,
  scene: BusinessHubScene,
): TimelineEventProp[] {
  const data: unknown = scene.kind === "mg" ? scene.data : undefined;
  const events = isRecord(data) ? data["events"] : undefined;
  if (!Array.isArray(events)) {
    return fail(
      "timelines",
      jobId,
      `${where} uses the timeline-walk layout but its props carry no "events" array ` +
        `(data is ${JSON.stringify(data)}). The axis IS the event list — each event's ` +
        `marker is a tick and the presenter stands on one of them — so it is derived ` +
        `from the scene's own props and never invented. Give the beat a TimelineGraphic ` +
        `element with { events: [{ marker, label }, ...] }, or take it off the ` +
        `timeline-walk layout.`,
    );
  }
  if (events.length < 2) {
    return fail(
      "timelines",
      jobId,
      `${where} has ${events.length} event(s). A timeline axis needs at least two so it ` +
        `has an extent; with one, every value maps to the same x and the presenter ` +
        `stands on top of the only tick. (The element caps the upper end itself.)`,
    );
  }

  return events.map((event, index) => {
    const marker = isRecord(event) ? event["marker"] : undefined;
    if (typeof marker !== "string" || marker.trim().length === 0) {
      return fail(
        "timelines",
        jobId,
        `${where}: events[${index}].marker is ${JSON.stringify(marker)}. Every tick on ` +
          `the axis is labelled with its marker; a blank one renders as an unexplained ` +
          `dot and the render's assertUsableTicks rejects it.`,
      );
    }
    return { marker };
  });
}

/**
 * Derive one scene's axis from the events it draws.
 *
 * `TimelineGraphic` spaces its markers evenly BY INDEX — "these are sequence
 * timelines (application -> underwriting -> close), not date-scaled ones", per
 * the element itself, which puts event `i` at `i / (count - 1)` of the axis. So
 * the tick coordinate is the event's index and the domain is `[0, count - 1]`:
 * the axis the layout draws lands exactly on the markers the element draws.
 * Reading the marker text as a number instead would silently move every tick
 * away from its dot.
 *
 * The presenter's coordinate comes from `pointsAt` (`point-<index>`, the
 * convention the planner writes from the figure's own shape).
 *
 * @throws {BusinessHubPipelineError} when the events are absent or unusable, or
 * when the scene places the presenter without a usable `pointsAt`. There is no
 * defensible default position on a data axis, so none is invented.
 */
function timelineAxisForScene(
  jobId: string,
  scene: BusinessHubScene,
): BusinessHubSceneTimelineAxis {
  const where = `scene "${scene.id}" (${scene.beat})`;
  const events = timelineEventsFor(jobId, where, scene);

  const ticks: TimelineTick[] = events.map((event, index) => ({
    value: index,
    label: event.marker,
  }));
  const domain = { min: 0, max: ticks.length - 1 };

  const presenter = scene.presenter;
  if (presenter === undefined) return { ticks, domain };

  const pointsAt = presenter.pointsAt;
  if (pointsAt === undefined) {
    return fail(
      "timelines",
      jobId,
      `${where} places the presenter on a timeline-walk axis but names no pointsAt. ` +
        `This layout puts the figure AT a data coordinate, so the render needs to know ` +
        `which event that is; the convention is "point-<index>". Give the scene one, ` +
        `or drop the presenter from it — a position is not guessed.`,
    );
  }
  const match = POINTS_AT_PATTERN.exec(pointsAt);
  if (match === null) {
    return fail(
      "timelines",
      jobId,
      `${where} points at "${pointsAt}", which is not the "point-<index>" form a ` +
        `sequence element exposes. The presenter's coordinate on the axis is read ` +
        `from it.`,
    );
  }
  const index = Number(match[1]);
  const tick = ticks[index];
  if (tick === undefined) {
    return fail(
      "timelines",
      jobId,
      `${where} points at "${pointsAt}" but the timeline has only ${ticks.length} ` +
        `events (0..${ticks.length - 1}). The presenter would stand off the end of the ` +
        `axis.`,
    );
  }
  return { ticks, domain, presenterValue: tick.value };
}

/**
 * Axis data for every `timeline-walk` scene in the plan.
 *
 * @throws {BusinessHubPipelineError} for the first scene whose axis cannot be
 * derived — see {@link timelineAxisForScene}.
 */
export function computeSceneTimelines(
  jobId: string,
  plan: BusinessHubPlan,
): Record<string, BusinessHubSceneTimelineAxis> {
  const timelines: Record<string, BusinessHubSceneTimelineAxis> = {};
  for (const scene of plan.scenes) {
    if (scene.layout !== "timeline-walk") continue;
    timelines[scene.id] = timelineAxisForScene(jobId, scene);
  }
  return timelines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plates — metadata.business_hub.assets
// ─────────────────────────────────────────────────────────────────────────────

/** Root of the (gitignored) presenter style-asset tree. */
function presenterAssetRoot(repoRoot: string): string {
  return path.join(repoRoot, "media", "style-assets", "presenter");
}

/** Round up to the next even integer — chroma planes want even sizes. */
function evenCeil(value: number): number {
  const ceiled = Math.ceil(value);
  return ceiled % 2 === 0 ? ceiled : ceiled + 1;
}

/**
 * The video's own ground theme: the mat it opens on.
 *
 * The watermark and the head mark are baked once per video and composited on
 * every scene, so they are coloured for one mat; per-scene grounds still come
 * from each scene's own `grade`. Reading the opening scene's ground is derived
 * data — the planner writes `ground-default`/`ground-inverse` onto every scene
 * — rather than a constant chosen here.
 *
 * @throws {BusinessHubPipelineError} when the plan is empty or its first scene
 * carries no known ground slug, which means the plan did not come from
 * `planBusinessHub`.
 */
export function resolveJobGroundTheme(
  jobId: string,
  plan: BusinessHubPlan,
): GroundThemeSlug {
  const first = plan.scenes[0];
  if (first === undefined) {
    return fail(
      "plates",
      jobId,
      `the plan has no scenes, so nothing can be baked.`,
    );
  }
  if (!isGroundThemeSlug(first.grade)) {
    return fail(
      "plates",
      jobId,
      `the opening scene "${first.id}" (${first.beat}) carries grade ` +
        `${JSON.stringify(first.grade)}, which is not a ground theme slug. The video's ` +
        `watermark and head mark are coloured for the mat it opens on.`,
    );
  }
  return first.grade;
}

/**
 * The width the head mark must be rasterised at: the largest head any scene in
 * this plan draws, at the top of the loudness pump.
 *
 * Derived, not chosen — `resolvePresenterLayout` gives the head diameter for a
 * calibrated pose at this placement, and the pump multiplies it by at most
 * `DEFAULT_HEAD_SCALE_RANGE.max` (the same default `buildPresenterTrack` uses).
 * Baking narrower would make the compositor upscale a bitmap, which reads soft.
 *
 * @throws {BusinessHubPipelineError} when a scene names a pose the manifest does
 * not hold, or when the resolved head is too small to rasterise. Errors from
 * `requireCalibratedPose` / `resolvePresenterLayout` propagate unchanged — they
 * already name the pose and point at the Presenter Studio.
 */
function headMarkWidthPx(args: {
  jobId: string;
  posedScenes: readonly BusinessHubScene[];
  poses: PoseManifest;
  placement: BusinessHubPresenterPlacement;
  width: number;
  height: number;
}): number {
  let maxDiameterPx = 0;
  for (const scene of args.posedScenes) {
    const presenter = scene.presenter;
    if (presenter === undefined) continue;
    const entry = args.poses.find((pose) => pose.slug === presenter.pose);
    if (entry === undefined) {
      return fail(
        "plates",
        args.jobId,
        `scene "${scene.id}" (${scene.beat}) names pose "${presenter.pose}", which is not ` +
          `in poses.json (${args.poses.map((p) => p.slug).join(", ")}).`,
      );
    }
    const placement: PresenterPlacement = {
      side: presenter.side,
      targetCollarPx: args.placement.targetCollarPx,
      bottomAnchor: args.placement.bottomAnchor,
      sideInset: args.placement.sideInset,
      ...(args.placement.mirror === undefined
        ? {}
        : { mirror: args.placement.mirror }),
    };
    const layout = resolvePresenterLayout({
      pose: requireCalibratedPose(entry),
      placement,
      frameWidth: args.width,
      frameHeight: args.height,
    });
    const peakDiameterPx =
      layout.head.diameterPx * DEFAULT_HEAD_SCALE_RANGE.max;
    if (peakDiameterPx > maxDiameterPx) maxDiameterPx = peakDiameterPx;
  }

  const widthPx = evenCeil(maxDiameterPx);
  if (widthPx < 2) {
    return fail(
      "plates",
      args.jobId,
      `the presenter's head resolves to ${maxDiameterPx.toFixed(2)}px at ` +
        `target_collar_px=${args.placement.targetCollarPx}. Check the head-radius hitboxes ` +
        `and the placement.`,
    );
  }
  return widthPx;
}

/**
 * The presenter library `bakePlates` needs, or `null` when this plan places no
 * presenter at all (`presenter_mode: "none"`, or a manifest with no calibrated
 * pose — the planner refuses to place an uncalibrated figure).
 *
 * @throws {BusinessHubPipelineError} when the plan DOES place the presenter but
 * no placement was authored. The three numbers have no defensible default: the
 * render says so at business-hub.ts:428, and guessing them would put the figure
 * somewhere nobody chose and at a size that changes between videos.
 */
export function resolvePresenterPlateInput(args: {
  jobId: string;
  plan: BusinessHubPlan;
  poses: PoseManifest;
  repoRoot: string;
  placement: BusinessHubPresenterPlacement | undefined;
  width: number;
  height: number;
}): PresenterPlateInput | null {
  const posedScenes = args.plan.scenes.filter(
    (scene) => scene.presenter !== undefined,
  );
  if (posedScenes.length === 0) return null;

  const placement = args.placement;
  if (placement === undefined) {
    return fail(
      "plates",
      args.jobId,
      `the plan places the presenter in ${posedScenes.length} scene(s) ` +
        `(${posedScenes.map((s) => s.id).join(", ")}) but no presenter placement is ` +
        `authored. Add ${PLACEMENT_EXAMPLE} to metadata.business_hub (or to the ` +
        `template's metadata.pipeline_config.business_hub). target_collar_px is the ` +
        `apparent-size normalisation, bottom_anchor and side_inset are where he stands; ` +
        `none of them is guessed here.`,
    );
  }

  const assetRoot = presenterAssetRoot(args.repoRoot);
  return {
    poses: [...args.poses],
    posePngDir: path.join(assetRoot, "poses"),
    headMark: {
      kind: "svg",
      path: path.join(assetRoot, "mark", "head-mark.svg"),
      widthPx: headMarkWidthPx({
        jobId: args.jobId,
        posedScenes,
        poses: args.poses,
        placement,
        width: args.width,
        height: args.height,
      }),
    },
    placement: {
      targetCollarPx: placement.targetCollarPx,
      bottomAnchor: placement.bottomAnchor,
      sideInset: placement.sideInset,
      ...(placement.mirror === undefined ? {} : { mirror: placement.mirror }),
    },
    ...(placement.headLiftPx === undefined
      ? {}
      : { headLiftPx: placement.headLiftPx }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The render envelope — metadata.business_hub
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything the render envelope is built from. Every field is a value the
 * asset stage has already computed; nothing here is read off the job again.
 */
export interface RenderEnvelopeInput {
  readonly plan: BusinessHubPlan;
  readonly aspect: string;
  readonly presenterMode: BusinessHubPresenterMode;
  readonly groundTheme: GroundThemeSlug;
  /** Whisper-anchored scene boundaries, in frames, in plan order. */
  readonly timings: ReadonlyArray<{
    readonly sceneId: string;
    readonly startFrame: number;
    readonly endFrame: number;
  }>;
  readonly plates: PlateSet;
  readonly timelines: Readonly<Record<string, BusinessHubSceneTimelineAxis>>;
  readonly figureIds: readonly string[];
  readonly visualsNeedingReview: ReadonlyArray<{
    readonly sceneId: string;
    readonly reason: string | null;
  }>;
}

/**
 * Build `metadata.business_hub` — the one slice the render workflow reads.
 *
 * Extracted from the stage so the contract can be verified against the real
 * consumer: `__tests__/render-envelope.test.ts` feeds this function's output
 * straight to `parseBusinessHubEnvelope`
 * (apps/worker-render/src/workflows/business-hub.ts:702), which is what actually
 * decides whether a job renders. `plan`, `aspect`, `timings`, `assets` and
 * `timelines` are the five keys that parser requires; the rest is operator-facing
 * detail it ignores.
 *
 * Pure — no clock, no filesystem, no database — so the caller owns
 * `asset_stage_completed_at`.
 */
export function buildRenderEnvelopeMetadata(
  input: RenderEnvelopeInput,
): JsonRecord {
  return {
    plan: input.plan,
    aspect: input.aspect,
    presenter_mode: input.presenterMode,
    timings: input.timings.map((timing) => ({
      sceneId: timing.sceneId,
      durationFrames: timing.endFrame - timing.startFrame,
    })),
    assets: input.plates,
    timelines: input.timelines,
    ground_theme: input.groundTheme,
    scene_count: input.plan.scenes.length,
    figure_ids: [...input.figureIds],
    visuals_needing_review: input.visualsNeedingReview.map((visual) => ({
      scene_id: visual.sceneId,
      reason: visual.reason,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

/** Queues this stage needs to hand the job on. */
export interface BusinessHubQueues {
  aiGeneration?: Queue;
  qmsValidation?: Queue;
  renderHeavy?: Queue;
  assetCollection?: Queue;
  autoLabel?: Queue;
  clipSelection?: Queue;
}

export interface BusinessHubAssetStageArgs {
  readonly db: DrizzleClient;
  readonly jobId: string;
  /** The `content_jobs` row, already fetched by asset-collection. */
  readonly job: ContentJobRow;
  /** The `content_templates` row for this job. */
  readonly template: ContentTemplateRow;
  /**
   * Queue handles. `qmsValidation` is REQUIRED — the stage ends by dispatching
   * to it, and `dispatchNext` throws `MissingQueueError` without it rather than
   * leaving the job in a state nothing is working on.
   */
  readonly queues: BusinessHubQueues;
  /** Injection seam for tests. Production passes nothing. */
  readonly financeKit?: BusinessHubFinanceKit;
  /**
   * Injection seam for tests: the plate baker. Production passes nothing and
   * uses `bakePlates` from `@repo/media-core`, which drives Chromium.
   */
  readonly bakePlates?: (params: BakePlatesParams) => Promise<BakePlatesResult>;
}

export interface BusinessHubAssetStageResult {
  readonly sceneCount: number;
  readonly narrationPath: string;
  readonly narrationDurationSec: number;
  readonly envelopePath: string;
  readonly envelopeFrames: number;
  readonly sourcedVisuals: number;
  readonly needsReviewVisuals: number;
  readonly figureIds: readonly string[];
  /** Scene ids that got a derived `timeline-walk` axis. */
  readonly timelineSceneIds: readonly string[];
  /** Plates served from the content-addressed store. */
  readonly plateCacheHits: number;
  /** Plates rasterised during this run. */
  readonly plateCacheMisses: number;
  readonly dispatchedTo: string | null;
}

/**
 * Run the whole BUSINESS_PLAN_HUB asset stage for one job and hand it to
 * QMS_VALIDATING.
 *
 * Long-running by design: TTS, Whisper and visual sourcing all happen inline
 * (15+ minutes for a 15-minute video). The caller's BullMQ lock must outlast it
 * — `assetCollectionWorkerOptions.lockDuration` is 30 minutes.
 *
 * @throws {BusinessHubPipelineError} for anything this stage owns, with the job
 * id, the failing step and the field named. Errors from the planner
 * (`ScenePlannerError`), the render gate (`BusinessHubPlanValidationError`) and
 * the sentence-anchoring pass propagate unchanged — they already carry better
 * diagnostics than a wrapper could add.
 */
export async function runBusinessHubAssetStage(
  args: BusinessHubAssetStageArgs,
): Promise<BusinessHubAssetStageResult> {
  const { db, jobId, job, template, queues } = args;
  const startedAt = Date.now();

  // ── 0. Configuration ─────────────────────────────────────────────────────
  const config = readStageConfig(jobId, job, template);
  const repoRoot = await resolveRepoRoot(jobId);
  const mediaDir = path.join(
    getConfig().LOCAL_MEDIA_ROOT,
    config.channelId,
    jobId,
  );
  await mkdir(mediaDir, { recursive: true });

  logger.info(
    {
      jobId,
      topic: config.topic,
      family: config.family,
      fps: config.fps,
      aspect: config.aspect,
      target_seconds: config.targetSeconds,
      media_dir: mediaDir,
    },
    "BUSINESS_PLAN_HUB asset stage starting",
  );

  // ── 0.5 Essential-provider pre-flight ────────────────────────────────────
  // BEFORE the script, before TTS, before Whisper, before a single credit is
  // spent. This format's identity is its generated prop-plate look; if no
  // generation backend can serve, every visual would fall through to sourced
  // stock and the pipeline would report success on a video that is not this
  // format at all (2026-08-16). Throws EssentialVisualProviderError naming
  // every backend probed and why each one failed.
  //
  // refCount 1: generation passes the canonical style plate as its single
  // reference (`art-direction.ts::loadStyleReference`), and a backend that
  // cannot carry a reference cannot hold this format's look steady.
  await preflightEssentialVisualProviders({
    format: "BUSINESS_PLAN_HUB",
    refCount: 1,
    aspectRatio: config.aspect === "9:16" ? "9:16" : "16:9",
  });

  // ── 1. Script ────────────────────────────────────────────────────────────
  const script = await ensureScript(db, jobId, job, config);
  assertScriptIsPlannable(jobId, script);
  const scriptHash = sha256(script);

  // What the VOICE gets. The script the planner needs is directive-annotated,
  // and the directives are square-bracketed prose that Fish reads out loud —
  // "open bracket hook close bracket" at the top of the video. Stripped through
  // the planner's own grammar so this is byte-identical to the `narration` on
  // every scene, which is what makes the Whisper-anchored scene timings line up
  // with the scenes they time.
  const narrationText = narrationTextFor(script);

  // ── 2. Narration + 3. Whisper ────────────────────────────────────────────
  // Both are cached against the script hash: a failure in a later step must not
  // re-pay for TTS on retry.
  const narrationPath = path.join(mediaDir, "narration.mp3");
  const wordsPath = path.join(mediaDir, "whisper-words.json");
  const priorHub = asRecord(asRecord(job.metadata)["business_hub"]);
  const priorNarration = asRecord(priorHub["narration"]);
  const reusable =
    readString(priorNarration, "script_sha256") === scriptHash &&
    (await fileExists(narrationPath));

  const voice = await resolveVoice(db, jobId, config);
  if (!reusable) {
    await generateNarration(jobId, narrationText, voice, narrationPath);
  } else {
    logger.info(
      { jobId, narration_path: narrationPath },
      "reusing the narration already on disk for this script",
    );
  }

  const narrationDurationSec = await probeMediaDuration(narrationPath);
  if (!Number.isFinite(narrationDurationSec) || narrationDurationSec <= 0) {
    return fail(
      "tts",
      jobId,
      `ffprobe reported ${String(narrationDurationSec)}s for ${narrationPath}. The scene ` +
        `timeline is checked against the measured duration and is never estimated from ` +
        `the word count.`,
    );
  }

  let words: WordTimestamp[] | null = null;
  if (reusable && (await fileExists(wordsPath))) {
    const cached: unknown = JSON.parse(await readFile(wordsPath, "utf8"));
    if (Array.isArray(cached) && cached.length > 0) {
      words = cached.filter(
        (w): w is WordTimestamp =>
          isRecord(w) &&
          typeof w["word"] === "string" &&
          typeof w["start"] === "number" &&
          typeof w["end"] === "number",
      );
      if (words.length === 0) words = null;
    }
  }
  if (words === null) {
    words = await transcribeNarration(jobId, narrationPath, config.language);
    await writeFile(wordsPath, JSON.stringify(words), "utf8");
  }

  // Persist the expensive artefacts immediately — everything after this point
  // is cheap to retry, and none of it should cost another TTS pass.
  await mergeHubMetadata(db, jobId, {
    narration: {
      path: narrationPath,
      script_sha256: scriptHash,
      duration_seconds: narrationDurationSec,
      voice_id: voice.rowId,
      voice_name: voice.name,
      voice_source: voice.source,
      engine: "fish",
      whisper_path: wordsPath,
      word_count: words.length,
    },
  });

  // ── 4. Presenter RMS envelope ────────────────────────────────────────────
  const envelope = await computeRmsEnvelope({
    audioPath: narrationPath,
    fps: config.fps,
  });
  const envelopePath = path.join(mediaDir, "presenter-envelope.json");
  await writeFile(
    envelopePath,
    JSON.stringify({
      fps: envelope.fps,
      sampleRate: envelope.sampleRate,
      frameCount: envelope.frameCount,
      percentile: envelope.percentile,
      reference: envelope.reference,
      smoothingTaps: envelope.smoothingTaps,
      values: envelope.values,
    }),
    "utf8",
  );
  logger.info(
    { jobId, frames: envelope.frameCount, fps: envelope.fps },
    "computed the presenter RMS envelope",
  );

  // ── 5. Finance figures ───────────────────────────────────────────────────
  const kit = args.financeKit ?? (await loadFinanceKit(jobId));
  const figures = await computeBusinessHubFigures(
    jobId,
    config.figureSpecs,
    kit,
  );
  const figureIds = Object.keys(figures);

  // ── 6. Scene plan ────────────────────────────────────────────────────────
  const poses = await loadPoses(jobId, repoRoot);
  const plannedScenes = planBusinessHub({
    topic: config.topic,
    family: config.family,
    script,
    targetSeconds: config.targetSeconds,
    figures,
    poses,
    aspect: config.aspect,
    placePresenter: config.presenterMode === "suit",
  });
  logger.info(
    { jobId, scenes: plannedScenes.scenes.length, figures: figureIds.length },
    "planned scenes",
  );

  // ── 7. Whisper-anchored scene timings ────────────────────────────────────
  const timings = await computeSceneTimings(
    jobId,
    plannedScenes,
    narrationPath,
    words,
    narrationDurationSec,
    config.fps,
  );

  // ── 8. Visual sourcing ───────────────────────────────────────────────────
  const { plan, sourced } = await sourceSceneVisuals(
    jobId,
    plannedScenes,
    timings,
    config,
  );
  const needsReview = sourced.filter((s) => s.posture === "needs-review");

  // ── 9. The render gate ───────────────────────────────────────────────────
  validateBusinessHubPlan(plan, {
    repoRoot,
    poses,
    sceneTimings: timings.map(({ sceneId, startSec, endSec }) => ({
      sceneId,
      startSec,
      endSec,
    })),
    narrationDurationSec,
    repoProbe: createNodeRepoSourceProbe(repoRoot),
  });

  // ── 10. Timeline axes ────────────────────────────────────────────────────
  // Derived from each timeline-walk scene's own series. The render throws for
  // any such scene with no entry, so this runs for every job — it is a no-op
  // for a plan that uses no timeline-walk layout.
  const timelines = computeSceneTimelines(jobId, plan);

  // ── 11. Plates ───────────────────────────────────────────────────────────
  // The stage that produces `metadata.business_hub.assets`: the ground mats,
  // the watermark, one copy plate per non-mg scene with text, and the head
  // mark. All content-addressed, so a retry re-bakes only what is missing.
  const groundTheme = resolveJobGroundTheme(jobId, plan);
  const presenterPlateInput = resolvePresenterPlateInput({
    jobId,
    plan,
    poses,
    repoRoot,
    placement: config.presenterPlacement,
    width: config.width,
    height: config.height,
  });
  const bake = args.bakePlates ?? bakePlates;
  const plateResult = await bake({
    plan,
    theme: groundTheme,
    aspect: config.aspect,
    width: config.width,
    height: config.height,
    outDir: path.join(mediaDir, "plates"),
    poses: presenterPlateInput,
    watermarkSvgPath: path.join(
      presenterAssetRoot(repoRoot),
      "mark",
      "watermark.svg",
    ),
  });
  logger.info(
    {
      jobId,
      theme: groundTheme,
      ground_plates: Object.keys(plateResult.plates.groundPlates).length,
      text_plates: Object.keys(plateResult.plates.textPlates).length,
      presenter: plateResult.plates.presenter !== null,
      cache_hits: plateResult.cacheHits,
      cache_misses: plateResult.cacheMisses,
      chromium: plateResult.chromiumExecutablePath,
    },
    "baked the plates for this video",
  );

  // ── 12. Persist ──────────────────────────────────────────────────────────
  const assemblyManifest = {
    format: "BUSINESS_PLAN_HUB" as const,
    workflow: "business-hub" as const,
    version: 1,
    generated_at: new Date().toISOString(),
    topic: config.topic,
    family: config.family,
    aspect: config.aspect,
    fps: config.fps,
    width: config.width,
    height: config.height,
    target_seconds: config.targetSeconds,
    presenter_mode: config.presenterMode,
    audio: {
      path: narrationPath,
      duration_seconds: narrationDurationSec,
      voice_id: voice.rowId,
      voice_name: voice.name,
      engine: "fish" as const,
    },
    transcript: { path: wordsPath, word_count: words.length },
    envelope: {
      path: envelopePath,
      fps: envelope.fps,
      frame_count: envelope.frameCount,
      sample_rate: envelope.sampleRate,
      percentile: envelope.percentile,
      reference: envelope.reference,
      smoothing_taps: envelope.smoothingTaps,
    },
    plan,
    scene_timings: timings,
    timelines,
    plates: plateResult.plates,
    // MEASURED by the browser during the bake, never estimated. Not part of the
    // render envelope — it is what the compositor and QC use to keep anything
    // else off the copy.
    text_plate_boxes: plateResult.textPlateBoxes,
    visuals: sourced.map((s) => ({
      scene_id: s.sceneId,
      beat: s.beat,
      asset_key: s.visual.assetKey,
      storage_path: s.storagePath,
      provider: s.visual.provider,
      licence: s.visual.licence,
      source_url: s.visual.sourceUrl,
      retrieved_at: s.visual.retrievedAt,
      posture: s.posture,
      review_reason: s.reviewReason,
      content_hash: s.contentHash,
      media_kind: s.mediaKind,
      deduplicated: s.deduplicated,
    })),
    figures,
  };

  const audioBytes = (await stat(narrationPath)).size;
  const envelopeBytes = (await stat(envelopePath)).size;
  const newAssets = [
    // "audio/tts" is the repo-wide narration type: the render workflow
    // (apps/worker-render/src/workflows/business-hub.ts) resolves the narration
    // by that type, and hub-web's timeline audio + waveform routes and
    // job-artifacts key on it too. An "audio/narration" entry rendered the
    // narration invisible to all four.
    { key: narrationPath, type: "audio/tts", size_bytes: audioBytes },
    {
      key: envelopePath,
      type: "data/rms-envelope",
      size_bytes: envelopeBytes,
    },
    ...sourced.map((s) => ({
      key: s.visual.assetKey,
      type: `visual/${s.mediaKind}`,
      size_bytes: s.bytes,
    })),
  ];

  await persistStageOutput(db, jobId, {
    assemblyManifest,
    newAssets,
    hubMetadata: {
      // ── The render envelope (apps/worker-render/src/workflows/business-hub.ts,
      // parseBusinessHubEnvelope) ──────────────────────────────────────────────
      // The render reads ONE metadata slice and defaults nothing. Everything it
      // requires is written here — `plan`, `aspect`, `timings`, `assets` and
      // `timelines`. Some of it lives in assembly_manifest too, but the render
      // is contractually bound to metadata.business_hub and duplicating a value
      // this stage already computed is cheaper than teaching it a second source
      // of truth.
      //
      // `assets` is the plate set baked in step 11 above: ground mats keyed by
      // theme slug, one full-frame copy plate per non-mg scene with text, the
      // watermark, and the presenter's pose library + head mark (`null` when the
      // plan places no presenter). `timelines` is the derived axis of every
      // timeline-walk scene. Both were missing until this stage produced them,
      // which is what made the format unable to render a frame.
      ...buildRenderEnvelopeMetadata({
        plan,
        aspect: config.aspect,
        presenterMode: config.presenterMode,
        groundTheme,
        timings,
        plates: plateResult.plates,
        timelines,
        figureIds,
        visualsNeedingReview: needsReview.map((s) => ({
          sceneId: s.sceneId,
          reason: s.reviewReason,
        })),
      }),
      asset_stage_completed_at: new Date().toISOString(),
    },
  });

  logger.info(
    {
      jobId,
      scenes: plan.scenes.length,
      visuals: sourced.length,
      needs_review: needsReview.length,
      timelines: Object.keys(timelines).length,
      elapsed_ms: Date.now() - startedAt,
    },
    "BUSINESS_PLAN_HUB asset stage complete",
  );

  // ── 13. Transition ───────────────────────────────────────────────────────
  // Straight to QMS_VALIDATING. This format has no human gate anywhere
  // (design §8 rule 7) — never AWAITING_VA_REVIEW.
  const { dispatchedTo } = await updateJobStatusAndDispatch(
    db,
    jobId,
    "QMS_VALIDATING",
    queues,
  );

  return {
    sceneCount: plan.scenes.length,
    narrationPath,
    narrationDurationSec,
    envelopePath,
    envelopeFrames: envelope.frameCount,
    sourcedVisuals: sourced.length,
    needsReviewVisuals: needsReview.length,
    figureIds,
    timelineSceneIds: Object.keys(timelines),
    plateCacheHits: plateResult.cacheHits,
    plateCacheMisses: plateResult.cacheMisses,
    dispatchedTo,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

/** Merge a patch into `metadata.business_hub` without touching sibling keys. */
async function mergeHubMetadata(
  db: DrizzleClient,
  jobId: string,
  patch: JsonRecord,
): Promise<void> {
  const [row] = await db
    .select({ metadata: contentJobs.metadata })
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);
  if (row === undefined) {
    return void fail("persist", jobId, "job row disappeared mid-stage");
  }
  const metadata = asRecord(row.metadata);
  const hub = asRecord(metadata["business_hub"]);
  await db
    .update(contentJobs)
    .set({
      metadata: { ...metadata, business_hub: { ...hub, ...patch } },
      updated_at: new Date(),
    })
    .where(eq(contentJobs.id, jobId));
}

interface ManifestAsset {
  key: string;
  type: string;
  size_bytes: number;
}

/**
 * Write the assembly manifest, merge the metadata patch and APPEND to
 * `r2_asset_manifest`.
 *
 * The append is not optional bookkeeping: the Drive-delivery scanner reads that
 * manifest, and an asset missing from it silently never leaves the VPS
 * (build brief §3.6). Entries are keyed by `key`, so a retry replaces rather
 * than duplicates.
 */
async function persistStageOutput(
  db: DrizzleClient,
  jobId: string,
  output: {
    assemblyManifest: unknown;
    newAssets: ManifestAsset[];
    hubMetadata: JsonRecord;
  },
): Promise<void> {
  const [row] = await db
    .select({
      metadata: contentJobs.metadata,
      manifest: contentJobs.r2_asset_manifest,
    })
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);
  if (row === undefined) {
    return void fail(
      "persist",
      jobId,
      "job row disappeared before the final write",
    );
  }

  const existing = Array.isArray(row.manifest) ? row.manifest : [];
  const byKey = new Map<string, ManifestAsset>();
  for (const asset of existing) byKey.set(asset.key, asset);
  for (const asset of output.newAssets) byKey.set(asset.key, asset);
  const manifest = [...byKey.values()];

  const metadata = asRecord(row.metadata);
  const hub = asRecord(metadata["business_hub"]);

  await db
    .update(contentJobs)
    .set({
      assembly_manifest: output.assemblyManifest,
      r2_asset_manifest: manifest,
      metadata: {
        ...metadata,
        business_hub: { ...hub, ...output.hubMetadata },
      },
      size_bytes_total_assets: manifest.reduce(
        (sum, asset) =>
          sum + (Number.isFinite(asset.size_bytes) ? asset.size_bytes : 0),
        0,
      ),
      updated_at: new Date(),
    })
    .where(eq(contentJobs.id, jobId));
}
