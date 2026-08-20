import { createHash } from "node:crypto";

import {
  BUSINESS_HUB_MG_ELEMENT_NAMES,
  BusinessHubPlanSchema,
  HEADLINE_MAX_CHARS,
  SourceRefSchema,
  isBusinessHubMgElementName,
  requiresSource,
  sourceKindForElement,
  type BusinessHubFamily,
  type BusinessHubMgElementName,
  type BusinessHubPlan,
  type BusinessHubScene,
  type CalibratedPose,
  type Layout,
  type Pose,
  type PoseManifest,
  type ScenePresenter,
  type SourceRef,
} from "@repo/contracts";

import {
  DOCUMENT_FIELD_SEPARATOR,
  ElementAdapterError,
  adaptDocumentToElementProps,
  adaptFigureToElementProps,
  documentHeadline,
  parseValueFormatDirective,
  supportedElementsFor,
  type ElementAdapterErrorCode,
  type FinanceFigure,
  type FinanceFigureKind,
  type FinanceFigureSet,
  type ValueFormat,
} from "./element-adapter.js";

/**
 * The figure vocabulary lives in `element-adapter.ts` — the planner imports it,
 * so the shared types have to sit on the adapter side or the two modules import
 * each other. Re-exported here because `pipeline.ts` (task O5) and the tests
 * already import them from the planner, and moving a type should not move every
 * caller's import.
 */
export type { FinanceFigure, FinanceFigureKind, FinanceFigureSet };

/**
 * BUSINESS_PLAN_HUB — the scene planner.
 *
 * Compiles a generated script into a typed {@link BusinessHubPlan}: an ordered
 * scene list where every scene carries its kind, layout, copy, data, presenter
 * layer, ground theme and (for motion-graphic scenes) a content-hash cache key.
 *
 * ## Two properties this module exists to guarantee
 *
 * 1. **It is deterministic.** Same script + same figures + same pose manifest
 *    produces a byte-identical plan. It calls no LLM, reads no clock, touches
 *    no filesystem and consults no database. The model's creative decisions
 *    arrive as *annotations in the script* (§ "Script annotation grammar"), and
 *    everything downstream of those annotations is a lookup table.
 * 2. **It fails closed.** Every path that could invent a number, a citation, a
 *    layout or a pose geometry throws instead. There is no `?? default` past
 *    absent pipeline data anywhere in this file. See {@link ScenePlannerError}.
 *
 * ## Script annotation grammar (the contract with task O4)
 *
 * A script is prose with **one paragraph per beat** (blank-line separated),
 * mirroring CASUALLY_EXPLAINED's `splitIntoParagraphs`. A paragraph may be
 * preceded by one or more square-bracket directives; the remaining prose is the
 * narration spoken over the scene.
 *
 * ```text
 * [hook]
 * Nobody tells you the bank has already decided before you walk in.
 *
 * [chapter: What the underwriter actually checks]
 * There are three numbers on that page and only one of them matters.
 *
 * [fig: dscr] [source: primary sba.gov/sop-50-10-7#dscr]
 * Debt service coverage is the whole game. Here is how the number is built.
 * ```
 *
 * | Directive             | Meaning                                                              |
 * | --------------------- | -------------------------------------------------------------------- |
 * | `[hook]`              | Opening beat. Presenter scene. Exactly one per script, required.      |
 * | `[cta]`               | Mid-roll call to action. Presenter scene. Optional.                   |
 * | `[close]`             | Closing beat. Presenter scene. Exactly one per script, required.      |
 * | `[title: Text]`       | Opening/segment title card.                                           |
 * | `[chapter: Text]`     | Section break. Flips the ground theme for everything that follows.    |
 * | `[fig: id]`           | This beat displays finance figure `id` from the finance-kit set.      |
 * | `[element: Name]`     | Overrides the element chosen for a `[fig:]` beat. Requires `[fig:]`.  |
 * | `[format: unit [dp]]` | The unit of a bare `series` figure. Requires `[fig:]`. See below.     |
 * | `[doc: h \| pub \| date]` | Names a source document — renders as a torn clipping.             |
 * | `[source: kind ref]`  | Citation. `kind` is `repo` or `primary`.                              |
 * | `[headline: Text]`    | On-screen headline (<= 68 chars).                                     |
 * | `[eyebrow: Text]`     | On-screen eyebrow line.                                               |
 * | `[beat: slug]`        | Overrides the derived kebab-case beat slug.                           |
 *
 * An unrecognised directive throws rather than being ignored: a directive the
 * planner does not understand is an instruction that silently would not happen.
 *
 * ## `[format:]` — why one figure kind has to state its unit
 *
 * Every figure kind but one arrives with its unit fixed by its finance-kit
 * contract: an `SbaFeeResult` is dollars, a `DscrResult` is a ratio, an
 * `Eb5JobsResult` is a count. A `series` figure is a bare `ChartSeries` — points
 * and labels, nothing that says whether `0.41` is 41 %, $0.41 or 0.41x. So a
 * `[fig:]` beat citing a series must carry `[format: percent]`,
 * `[format: currency]`, `[format: ratio]` or `[format: number]` (optionally
 * followed by a decimal count) or the plan fails. Assuming a unit here is how a
 * confidently wrong chart gets published.
 *
 * ## `[doc:]` — why it takes three fields
 *
 * A document beat renders as `PaperClipping`, which draws a headline, a
 * publication and a date. None of the three is derivable — the citation's host
 * is where a document is *served*, not who published it — so the directive
 * carries them, pipe-separated, with an optional fourth excerpt:
 * `[doc: SBA SOP 50 10 7 | U.S. Small Business Administration | Effective 1 August 2023]`.
 *
 * ## Known dependency: pose calibration
 *
 * The planner only ever selects a pose whose `anchor_status` is `"calibrated"`
 * and which carries a complete hitbox set. Every one of the 16 poses in
 * `media/style-assets/presenter/poses/poses.json` is `"needs-calibration"`
 * today, so **until the Presenter Studio (task U1) writes hitboxes, every call
 * to {@link planBusinessHub} throws `NO_CALIBRATED_POSE`.** That is design §8
 * rule 2 working as specified, not a bug: placing a figure by guesswork is
 * exactly what the rule forbids. The error names the intent, the candidate
 * slugs and their calibration status.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/** Every way planning can fail. Exhaustive — see {@link ScenePlannerError}. */
export type ScenePlannerErrorCode =
  | "EMPTY_SCRIPT"
  | "EMPTY_NARRATION"
  | "UNKNOWN_DIRECTIVE"
  | "DUPLICATE_DIRECTIVE"
  | "CONFLICTING_DIRECTIVES"
  | "MISSING_DIRECTIVE_VALUE"
  | "MISSING_ROLE_BEAT"
  | "DUPLICATE_ROLE_BEAT"
  | "MISSING_FIGURE"
  | "UNKNOWN_ELEMENT"
  | "ELEMENT_WITHOUT_FIGURE"
  | "FORMAT_WITHOUT_FIGURE"
  // ── raised by element-adapter.ts, mapped 1:1 in adapterErrorCode() ────────
  | "UNSUPPORTED_ELEMENT_FOR_FIGURE"
  | "MISSING_VALUE_FORMAT"
  | "UNEXPECTED_VALUE_FORMAT"
  | "INVALID_VALUE_FORMAT"
  | "FIGURE_TOO_LARGE_FOR_ELEMENT"
  | "INVALID_DOCUMENT"
  | "MISSING_SOURCE"
  | "INVALID_SOURCE"
  | "HEADLINE_TOO_LONG"
  | "UNSLUGGABLE_BEAT"
  | "NO_CALIBRATED_POSE"
  | "NO_POSE_FOR_INTENT"
  | "NON_CANONICAL_DATA"
  | "INVALID_PLAN"
  | "INVALID_INPUT";

/**
 * A planning failure. Always carries the machine-readable {@link
 * ScenePlannerErrorCode} and, where one is known, the beat slug or paragraph
 * index the failure belongs to — a 40-beat script is unpleasant to debug from
 * a bare message.
 */
export class ScenePlannerError extends Error {
  readonly code: ScenePlannerErrorCode;
  readonly beat: string | undefined;

  constructor(
    code: ScenePlannerErrorCode,
    message: string,
    beat?: string | undefined,
  ) {
    super(beat === undefined ? message : `[beat ${beat}] ${message}`);
    this.name = "ScenePlannerError";
    this.code = code;
    this.beat = beat;
  }
}

/**
 * Maps an {@link ElementAdapterErrorCode} onto this module's own vocabulary.
 *
 * The adapter is a separate module with its own error type, so its failures are
 * re-thrown as {@link ScenePlannerError} rather than leaking a second error
 * class to callers. The switch is exhaustive: a new adapter failure mode stops
 * this file compiling instead of arriving at a caller as an unclassified error.
 */
function adapterErrorCode(
  code: ElementAdapterErrorCode,
): ScenePlannerErrorCode {
  switch (code) {
    case "UNSUPPORTED_PAIRING":
      return "UNSUPPORTED_ELEMENT_FOR_FIGURE";
    case "MISSING_VALUE_FORMAT":
      return "MISSING_VALUE_FORMAT";
    case "UNEXPECTED_VALUE_FORMAT":
      return "UNEXPECTED_VALUE_FORMAT";
    case "INVALID_VALUE_FORMAT":
      return "INVALID_VALUE_FORMAT";
    case "FIGURE_TOO_LARGE_FOR_ELEMENT":
      return "FIGURE_TOO_LARGE_FOR_ELEMENT";
    case "INVALID_DOCUMENT":
      return "INVALID_DOCUMENT";
    default: {
      const never: never = code;
      throw new ScenePlannerError(
        "INVALID_PLAN",
        `unhandled element-adapter error code ${JSON.stringify(never)}`,
      );
    }
  }
}

/**
 * Runs an element-adapter call, re-throwing its failures as planner failures
 * with the beat attached.
 *
 * @throws {@link ScenePlannerError} — never an {@link ElementAdapterError}.
 */
function viaAdapter<T>(beat: string, run: () => T): T {
  try {
    return run();
  } catch (error: unknown) {
    if (error instanceof ElementAdapterError) {
      throw new ScenePlannerError(
        adapterErrorCode(error.code),
        error.message,
        beat,
      );
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────────────

/** Everything {@link planBusinessHub} needs. All fields required. */
export interface ScenePlannerInput {
  /** The keyword/topic this video answers. */
  readonly topic: string;
  readonly family: BusinessHubFamily;
  /** The generated script: prose, one paragraph per beat, with directives. */
  readonly script: string;
  /** Target runtime in seconds (15 min default = 900). */
  readonly targetSeconds: number;
  /** Figures finance-kit produced for this topic. May be empty. */
  readonly figures: FinanceFigureSet;
  /** `poses.json`, already parsed with `PoseManifestSchema`. */
  readonly poses: PoseManifest;
  /** Render aspect, e.g. `"16:9"`. Part of every mg scene's cache key. */
  readonly aspect: string;
  /**
   * Whether this video has a presenter at all.
   *
   * Comes from the operator's `presenterMode` (design §3.4 subformat variants):
   * `"suit"` places the figure, `"none"` produces the same script and the same
   * scene plan as motion graphics only. It is a real product variant — one
   * script, three renders, retention compared on identical content — and it is
   * also the only way to plan a video while every pose in
   * `media/style-assets/presenter/poses/poses.json` is still uncalibrated.
   *
   * `false` does NOT relax any gate: with no presenter placed, no pose is
   * required, so there is nothing to guess. It is not a fallback for a missing
   * pose — a job that asks for `"suit"` against an uncalibrated manifest still
   * throws.
   */
  readonly placePresenter: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Beat splitting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paragraph length at which a double-newline split is considered "structured"
 * prose rather than incidental line wrapping. Mirrors
 * `splitIntoParagraphs` in `../scene-analysis.ts`.
 */
const STRUCTURED_PARAGRAPH_CHARS = 30;

/** A double-newline split must yield this many real paragraphs to be trusted. */
const STRUCTURED_PARAGRAPH_MIN_COUNT = 4;

/**
 * Splits a script into beats — one paragraph per beat, double-newline
 * separated, falling back to single newlines when the script has no paragraph
 * structure. This is CASUALLY_EXPLAINED's `splitIntoParagraphs` heuristic.
 *
 * **Deliberate difference from CE:** CE *discards* fragments of 30 characters
 * or fewer. This planner keeps every non-empty fragment and only uses the
 * 30-character rule to decide whether paragraph structure exists at all.
 * Dropping a fragment would drop narration, and the narration of a plan has to
 * reconstitute the script exactly or the scenes desynchronise from the TTS
 * audio they are timed against.
 *
 * @throws {@link ScenePlannerError} `EMPTY_SCRIPT` when nothing remains.
 */
export function splitIntoBeats(script: string): string[] {
  const blocks = script
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const structured =
    blocks.filter((p) => p.length > STRUCTURED_PARAGRAPH_CHARS).length >=
    STRUCTURED_PARAGRAPH_MIN_COUNT;

  const beats = structured
    ? blocks
    : script
        .split(/\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

  if (beats.length === 0) {
    throw new ScenePlannerError(
      "EMPTY_SCRIPT",
      "script contains no beats. Expected prose with one paragraph per beat; got only whitespace.",
    );
  }
  return beats;
}

/**
 * The SPOKEN text of a directive-annotated script: every beat's narration, in
 * order, with the directives peeled off.
 *
 * This is what goes to TTS, and it must be this rather than the raw script: the
 * directives are square-bracketed and Fish reads them out loud, so a script the
 * planner needs is a script the voice must not be given verbatim.
 *
 * It reuses `splitIntoBeats` + `parseBeatText`, so the narration is
 * character-for-character what lands on `scene.narration` — which is what makes
 * the Whisper-anchored scene timings line up with the scenes they time. A second
 * stripping implementation here would be a second grammar, and the two would
 * drift.
 *
 * @throws {@link ScenePlannerError} on any grammar violation, same as planning.
 */
export function narrationTextFor(script: string): string {
  return splitIntoBeats(script)
    .map((paragraph, index) => parseBeatText(paragraph, index).narration)
    .join("\n\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Directive parsing
// ─────────────────────────────────────────────────────────────────────────────

/** Directives the planner understands. Anything else throws. */
const KNOWN_DIRECTIVES = [
  "hook",
  "cta",
  "close",
  "title",
  "chapter",
  "fig",
  "element",
  "format",
  "doc",
  "source",
  "headline",
  "eyebrow",
  "beat",
] as const;
type DirectiveName = (typeof KNOWN_DIRECTIVES)[number];

const isDirectiveName = (name: string): name is DirectiveName =>
  (KNOWN_DIRECTIVES as readonly string[]).includes(name);

/** Matches one leading `[name]` or `[name: value]`, newlines included. */
const LEADING_DIRECTIVE = /^\s*\[([a-zA-Z][a-zA-Z0-9-]*)(?::([^\]]*))?\]/;

interface ParsedBeatText {
  readonly directives: ReadonlyMap<DirectiveName, string>;
  readonly narration: string;
}

/** Directives that are meaningless without a value. */
const DIRECTIVES_REQUIRING_VALUE: ReadonlySet<DirectiveName> =
  new Set<DirectiveName>([
    "title",
    "chapter",
    "fig",
    "element",
    "format",
    "doc",
    "source",
    "headline",
    "eyebrow",
    "beat",
  ]);

/**
 * Peels the leading directives off one paragraph and returns them plus the
 * narration prose. Directives must lead the paragraph; a bracket later in the
 * prose is left alone as ordinary text.
 *
 * @throws {@link ScenePlannerError} `UNKNOWN_DIRECTIVE` for an unrecognised
 * name, `DUPLICATE_DIRECTIVE` when one appears twice, `MISSING_DIRECTIVE_VALUE`
 * when a value-taking directive is empty, and `EMPTY_NARRATION` when no prose
 * remains (every scene is spoken over — a silent scene has no place in the
 * timeline).
 */
export function parseBeatText(
  paragraph: string,
  index: number,
): ParsedBeatText {
  const directives = new Map<DirectiveName, string>();
  let rest = paragraph;

  for (;;) {
    const match = LEADING_DIRECTIVE.exec(rest);
    if (match === null) break;

    const rawName = match[1].toLowerCase();
    if (!isDirectiveName(rawName)) {
      throw new ScenePlannerError(
        "UNKNOWN_DIRECTIVE",
        `paragraph ${index + 1} carries unknown directive "[${rawName}]". ` +
          `Known directives: ${KNOWN_DIRECTIVES.join(", ")}. An unrecognised ` +
          `directive is an instruction that would silently not happen, so it is rejected.`,
      );
    }
    if (directives.has(rawName)) {
      throw new ScenePlannerError(
        "DUPLICATE_DIRECTIVE",
        `paragraph ${index + 1} repeats directive "[${rawName}]". Each directive may appear at most once per beat.`,
      );
    }

    const value = (match[2] ?? "").trim();
    if (DIRECTIVES_REQUIRING_VALUE.has(rawName) && value.length === 0) {
      throw new ScenePlannerError(
        "MISSING_DIRECTIVE_VALUE",
        `paragraph ${index + 1} has "[${rawName}]" with no value. Write it as "[${rawName}: ...]".`,
      );
    }

    directives.set(rawName, value);
    rest = rest.slice(match[0].length);
  }

  const narration = rest.replace(/\s+/g, " ").trim();
  if (narration.length === 0) {
    throw new ScenePlannerError(
      "EMPTY_NARRATION",
      `paragraph ${index + 1} has directives but no narration. Every scene is spoken over; ` +
        `put the directives at the head of the paragraph they belong to.`,
    );
  }

  return { directives, narration };
}

// ─────────────────────────────────────────────────────────────────────────────
// Beat roles — the scene vocabulary rules (design §3.2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a beat *is*, derived only from its directives. This is the whole of the
 * planner's classification logic: everything after this point is a table
 * lookup keyed on the role.
 */
export type BeatRole =
  | { readonly role: "hook" }
  | { readonly role: "cta" }
  | { readonly role: "close" }
  | { readonly role: "title"; readonly title: string }
  | { readonly role: "chapter"; readonly title: string }
  | {
      readonly role: "figure";
      readonly figureId: string;
      readonly elementOverride: string | undefined;
      /** The `[format:]` directive verbatim, if the beat carried one. */
      readonly rawFormat: string | undefined;
    }
  | { readonly role: "document"; readonly document: string }
  | { readonly role: "connective" };

/** Directives that decide the role. At most one may appear on a beat. */
const ROLE_DIRECTIVES: readonly DirectiveName[] = [
  "hook",
  "cta",
  "close",
  "title",
  "chapter",
  "fig",
  "doc",
];

/**
 * Classifies one beat from its directives.
 *
 * @throws {@link ScenePlannerError} `CONFLICTING_DIRECTIVES` when a beat claims
 * two roles, and `ELEMENT_WITHOUT_FIGURE` when `[element:]` appears without a
 * `[fig:]` — an mg element with no finance figure has no props, and the planner
 * will not invent them.
 */
export function classifyBeat(
  directives: ReadonlyMap<DirectiveName, string>,
  index: number,
): BeatRole {
  const present = ROLE_DIRECTIVES.filter((name) => directives.has(name));
  if (present.length > 1) {
    throw new ScenePlannerError(
      "CONFLICTING_DIRECTIVES",
      `paragraph ${index + 1} claims ${present.length} roles at once (${present
        .map((n) => `[${n}]`)
        .join(
          " ",
        )}). A beat is exactly one of: hook, cta, close, title, chapter, fig, doc.`,
    );
  }

  const elementOverride = directives.get("element");
  const figureId = directives.get("fig");
  const rawFormat = directives.get("format");

  if (elementOverride !== undefined && figureId === undefined) {
    throw new ScenePlannerError(
      "ELEMENT_WITHOUT_FIGURE",
      `paragraph ${index + 1} sets "[element: ${elementOverride}]" without "[fig: ...]". ` +
        `A motion-graphic element needs props, and the only source of props is a finance-kit figure. ` +
        `Add the figure, or drop the element directive.`,
    );
  }
  if (rawFormat !== undefined && figureId === undefined) {
    throw new ScenePlannerError(
      "FORMAT_WITHOUT_FIGURE",
      `paragraph ${index + 1} sets "[format: ${rawFormat}]" without "[fig: ...]". ` +
        `The directive states the unit of a plotted figure; on a beat with no figure ` +
        `it would silently do nothing. Add the figure, or drop the format directive.`,
    );
  }

  if (directives.has("hook")) return { role: "hook" };
  if (directives.has("cta")) return { role: "cta" };
  if (directives.has("close")) return { role: "close" };

  const title = directives.get("title");
  if (title !== undefined) return { role: "title", title };

  const chapter = directives.get("chapter");
  if (chapter !== undefined) return { role: "chapter", title: chapter };

  if (figureId !== undefined) {
    // The directive is carried raw and parsed in `buildDraft`, where the beat
    // slug exists to name in the diagnostic.
    return { role: "figure", figureId, elementOverride, rawFormat };
  }

  const document = directives.get("doc");
  if (document !== undefined) return { role: "document", document };

  return { role: "connective" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Element and layout registries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default motion-graphic element per figure kind. `[element: X]` overrides it
 * with any element `FIGURE_ELEMENT_SUPPORT` (element-adapter.ts) lists for that
 * kind.
 *
 * **Typed against `BusinessHubMgElementName`.** These names are dispatched by
 * `ELEMENT_REGISTRY` in the renderer's `BusinessHubScene.tsx`, which throws on a
 * name it does not implement — and for most of this format's life the two
 * disagreed. The planner emitted `AmortizationChart`, `BreakEvenChart`,
 * `ProjectionChart`, `FeeBreakdown` and `TimelineChart`; the renderer has never
 * implemented any of them, so five of the seven figure kinds could not produce a
 * frame and nothing said so until FFmpeg had already been paid for. The union
 * now lives in `@repo/contracts` and both sides are typed against it, so a
 * rename breaks this build instead of a render.
 *
 * Every name here is also registered in `ELEMENT_SOURCE_KIND` in
 * `@repo/contracts`, which is what makes the plan-time citation gate apply.
 */
export const FIGURE_ELEMENT: Readonly<
  Record<FinanceFigureKind, BusinessHubMgElementName>
> = {
  // The shape of a loan over time: balance falling, interest accumulating. A
  // 25-year term is 300 periods, far past anything a bar chart can draw.
  amortization: "LineChart",
  // The format's signature element — the ratio built one term at a time.
  dscr: "FormulaReveal",
  // The claim of a break-even is a single unit count, not a curve.
  "break-even": "StatCallout",
  projection: "LineChart",
  // Four unrelated dollar figures: cards, not an axis.
  "sba-fees": "StatGrid",
  "eb5-jobs": "StatGrid",
  // A bare series has no known unit; the beat states it with `[format:]`.
  series: "LineChart",
};

/**
 * The element a `[doc:]` beat renders as: a torn newspaper clipping on the mat.
 *
 * `PaperClipping` draws a headline, a publication and a date, which is why the
 * `[doc:]` directive carries all three (see the grammar note at the top of this
 * file).
 */
export const DOCUMENT_ELEMENT: BusinessHubMgElementName = "PaperClipping";

/**
 * The layout every renderable element is composed in. Exhaustive over
 * `BusinessHubMgElementName` on purpose: adding an element to the renderer
 * without deciding where it stands stops this file compiling, and a chart placed
 * in the wrong composition is a silently wrong video.
 */
export const ELEMENT_LAYOUT: Readonly<
  Record<BusinessHubMgElementName, Layout>
> = {
  // Charts and derivations stand in a frame, tilted along the pointing vector.
  FormulaReveal: "framed-chart",
  LineChart: "framed-chart",
  BarChart: "framed-chart",
  PercentageBar: "framed-chart",
  StatCallout: "framed-chart",
  // Cards and tables are paper on the mat.
  StatGrid: "paper-stack",
  ComparisonTable: "paper-stack",
  // A stated sequence walks along an axis.
  TimelineGraphic: "timeline-walk",
  ProcessDiagram: "card-grid",
  Checklist: "card-grid",
  // Reproductions of published text are cuttings.
  QuoteCard: "clipping",
  PaperClipping: "clipping",
  // An annotation floats over the set rather than inside a surface.
  CalloutLabel: "studio-set",
};

/**
 * Layout of a `chapter` break: the title sits on the top sheet of an offset
 * stack, on the inverse ground. There is no dedicated "chapter" layout in the
 * nine — `paper-stack` is the one that reads as a section marker.
 */
const CHAPTER_LAYOUT: Layout = "paper-stack";

/** Layout of a `title` card: a torn headline strip, rotated. */
const TITLE_LAYOUT: Layout = "clipping";

/** Layout of connective narration: defocused footage under the voice. */
const CONNECTIVE_LAYOUT: Layout = "broll-defocus";

/**
 * Resolves the element for a figure beat, honouring `[element:]`.
 *
 * Two gates, in order: the override must name an element the renderer actually
 * implements, and that element must have an adaptation for this figure's kind
 * (checked in {@link adaptFigureToElementProps}, which runs immediately after).
 *
 * @throws {@link ScenePlannerError} `UNKNOWN_ELEMENT` when the override is not a
 * renderable element name.
 */
function resolveElement(
  role: Extract<BeatRole, { role: "figure" }>,
  figure: FinanceFigure,
  beatSlug: string,
): BusinessHubMgElementName {
  if (role.elementOverride === undefined) return FIGURE_ELEMENT[figure.kind];
  if (!isBusinessHubMgElementName(role.elementOverride)) {
    throw new ScenePlannerError(
      "UNKNOWN_ELEMENT",
      `element "${role.elementOverride}" is not implemented by the renderer, so the ` +
        `scene would fail inside the render with nothing left to do about it. ` +
        `Implemented elements: ${[...BUSINESS_HUB_MG_ELEMENT_NAMES].sort().join(", ")}. ` +
        `A "${figure.kind}" figure can be drawn by: ` +
        `${supportedElementsFor(figure.kind).join(", ")}.`,
      beatSlug,
    );
  }
  return role.elementOverride;
}

/** Layout for an element name the compiler has already proven is registered. */
function layoutForElement(element: BusinessHubMgElementName): Layout {
  return ELEMENT_LAYOUT[element];
}

// ─────────────────────────────────────────────────────────────────────────────
// Ground theme
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The two grounds of design §3.1: near-black mat with a faint ocean grid, and
 * its near-white inverse. Carried on `scene.grade`, which is the only themeable
 * string the scene schema has; the ground renderer (task M1) reads it.
 */
export const GROUND_THEMES = ["ground-default", "ground-inverse"] as const;
export type GroundTheme = (typeof GROUND_THEMES)[number];

/** Body ground for the n-th chapter (0 = everything before the first break). */
const bodyThemeForChapter = (chapterIndex: number): GroundTheme =>
  GROUND_THEMES[chapterIndex % GROUND_THEMES.length];

/** A chapter card takes the opposite ground to the chapter it introduces. */
const cardThemeForChapter = (chapterIndex: number): GroundTheme =>
  GROUND_THEMES[(chapterIndex + 1) % GROUND_THEMES.length];

// ─────────────────────────────────────────────────────────────────────────────
// Presenter scheduling policy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How much of the video the presenter is on screen for.
 *
 * The reference channel's presenter is punctuation, not a host: he appears at
 * the hook, the call to action and the close, and on the handful of beats where
 * he is *doing* something — pointing at a data point, gesturing across a card
 * grid. Continuous presence flattens him into a talking head and costs the
 * charts their stage.
 *
 * `target` is what the policy aims for; `min`/`max` bound what is acceptable
 * and are asserted by the tests. The three role beats (hook/cta/close) are a
 * FLOOR that overrides `max`: on a very short plan they alone can exceed 25%,
 * and dropping the close to satisfy a ratio would be the wrong trade.
 */
export const PRESENTER_RATIO = { min: 0.15, target: 0.2, max: 0.25 } as const;

/** Layouts on which the presenter is doing something worth showing. */
const ACTION_LAYOUTS: ReadonlySet<Layout> = new Set<Layout>([
  "framed-chart",
  "card-grid",
]);

interface PresenterCandidate {
  readonly index: number;
  readonly mandatory: boolean;
  readonly layout: Layout;
}

/**
 * Chooses which scenes carry the presenter.
 *
 * Policy, in order:
 *  1. Every role beat (hook, cta, close) — mandatory, always.
 *  2. Action beats (`framed-chart`, `card-grid`) in script order, taken until
 *     the plan reaches {@link PRESENTER_RATIO}`.target`, skipping any beat
 *     adjacent to a scene that already has him. Adjacency is what makes him
 *     read as punctuation instead of a presence.
 *  3. Nothing else, ever.
 *
 * Deterministic: no randomness, no dependence on anything but the ordered
 * candidate list.
 */
export function selectPresenterIndices(
  candidates: readonly PresenterCandidate[],
  sceneCount: number,
): ReadonlySet<number> {
  const selected = new Set<number>();
  for (const candidate of candidates) {
    if (candidate.mandatory) selected.add(candidate.index);
  }

  const desired = Math.round(sceneCount * PRESENTER_RATIO.target);
  const ceiling = Math.max(
    selected.size,
    Math.floor(sceneCount * PRESENTER_RATIO.max),
  );

  for (const candidate of candidates) {
    if (selected.size >= desired || selected.size >= ceiling) break;
    if (candidate.mandatory) continue;
    if (!ACTION_LAYOUTS.has(candidate.layout)) continue;
    if (
      selected.has(candidate.index - 1) ||
      selected.has(candidate.index + 1)
    ) {
      continue;
    }
    selected.add(candidate.index);
  }

  return selected;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pose selection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Why the presenter is on this scene. Intent — not layout — picks the pose:
 * a rising figure wants a hand going up, a rhetorical question wants open
 * arms, a chart wants the pointer.
 */
export type PresenterIntent =
  | "rhetorical-question"
  | "affirm"
  | "rising-figure"
  | "chart"
  | "card-grid"
  | "consider";

/**
 * Pose preference per intent, most-wanted first. Slugs are the 16 poses in
 * `media/style-assets/presenter/poses/poses.json`. Candidates that are absent
 * from the manifest or uncalibrated are skipped; if none survives, the planner
 * throws rather than placing an arbitrary figure.
 */
export const INTENT_POSES: Readonly<
  Record<PresenterIntent, readonly string[]>
> = {
  // TRAILING ENTRIES BELOW THE FIRST BLANK GROUP ARE CALIBRATED FALLBACKS.
  //
  // 2026-08-16: only 7 of the 16 poses are calibrated (pointing-down-left,
  // arms-at-side, full-body-standing, thumbs-up, holding-pointer,
  // arms-folded-thinking, holding-tablet). Two intents had NO calibrated
  // candidate at all — "rhetorical-question", which every plan hits because the
  // [hook] beat always carries it, and "card-grid". Both threw
  // NO_POSE_FOR_INTENT, which made the format unable to place a presenter on any
  // real script and pushed operators toward presenter_mode "none" — i.e. toward
  // shipping the variant with no figure at all.
  //
  // Each appended slug is a pose that genuinely CARRIES that intent's meaning,
  // not merely a calibrated one: the class doc's rule (never substitute a pose
  // from another intent) is preserved. They are appended, never reordered, so
  // the authored preference still wins the moment the other 9 are calibrated.
  "rhetorical-question": [
    "arms-open",
    "hands-in-pockets",
    "hand-to-collar",
    // Open, non-gesturing, squared to camera — the body language of putting a
    // question TO the viewer. Not a gesture that says anything else.
    "arms-at-side",
    "full-body-standing",
  ],
  affirm: ["thumbs-up", "fist-pump", "arms-open"],
  "rising-figure": ["pointing-up", "pointing-both-hands", "holding-pointer"],
  chart: [
    "holding-pointer",
    "pointing-right-arm-out",
    "pointing-left-arm-out",
    "pointing-down-left",
  ],
  "card-grid": [
    "pointing-left-wide",
    "pointing-both-hands",
    "pointing-right-arm-out",
    // Indicating a laid-out set below/beside the figure. A pointing pose, which
    // is what this intent means; the direction is the only thing it gives up.
    "pointing-down-left",
  ],
  consider: ["arms-folded-thinking", "hand-to-collar", "holding-tablet"],
};

/**
 * True when a pose is render-ready: calibrated, with a complete hitbox set.
 * Uncalibrated poses are invisible to the planner (design §8 rule 2).
 */
export function isCalibratedPose(pose: Pose): pose is CalibratedPose {
  return pose.anchor_status === "calibrated" && pose.hitboxes !== undefined;
}

/**
 * Deterministic pose picker with rotation.
 *
 * Holds one cursor per intent so repeated beats of the same intent walk the
 * preference list instead of hammering its first entry, and refuses to hand
 * back the pose used on the immediately preceding presenter scene — cutting
 * from a pose to itself reads as a freeze-frame.
 *
 * It NEVER leaves the intent's own preference list. INTENT_POSES is a semantic
 * map — `chart` means the pointer poses, `rhetorical-question` means open arms
 * — so handing back "any other calibrated pose" would ship a figure with arms
 * folded pointing at nothing, and every downstream gate would pass because the
 * substituted pose IS calibrated. Design §5/§8.2: a pose is never guessed.
 *
 * The two degradations it will accept, in order:
 *   1. Repeat the previous pose when the intent has exactly one calibrated
 *      candidate. A held gesture is a visual blemish; the wrong gesture is a
 *      wrong statement. Logged, never silent.
 *   2. Nothing. It throws.
 */
class PoseRotation {
  private readonly byslug: ReadonlyMap<string, CalibratedPose>;
  private readonly cursors = new Map<PresenterIntent, number>();
  private readonly manifestSummary: string;

  constructor(poses: PoseManifest) {
    const calibrated = new Map<string, CalibratedPose>();
    for (const pose of poses) {
      if (isCalibratedPose(pose)) calibrated.set(pose.slug, pose);
    }
    this.byslug = calibrated;
    this.manifestSummary = poses
      .map((p) => `${p.slug}=${p.anchor_status}`)
      .join(", ");
  }

  /**
   * @throws {@link ScenePlannerError} `NO_POSE_FOR_INTENT` when no pose this
   * intent means is calibrated, and `NO_CALIBRATED_POSE` when the manifest
   * holds no calibrated pose at all.
   */
  next(
    intent: PresenterIntent,
    previousPose: string | undefined,
    beatSlug: string,
  ): CalibratedPose {
    const preferred = INTENT_POSES[intent].filter((slug) =>
      this.byslug.has(slug),
    );

    if (preferred.length === 0) {
      // Deliberately NOT widened to some other calibrated pose. See the class
      // doc: a substituted pose is a different statement, and it passes every
      // downstream gate.
      if (this.byslug.size === 0) {
        throw new ScenePlannerError(
          "NO_CALIBRATED_POSE",
          `the pose manifest contains no calibrated pose at all. ` +
            `Manifest state: ${this.manifestSummary || "(empty)"}. ` +
            `Run the Presenter Studio (task U1) to author hitboxes — the planner will ` +
            `not place a figure whose head, collar and pointing vector are unknown. To ` +
            `produce this video without a presenter instead, set ` +
            `metadata.business_hub.presenter_mode = "none".`,
          beatSlug,
        );
      }
      throw new ScenePlannerError(
        "NO_POSE_FOR_INTENT",
        `no calibrated pose means "${intent}". This beat needs one of ` +
          `${INTENT_POSES[intent].join(", ")}; the calibrated set is ` +
          `${[...this.byslug.keys()].join(", ")}. Substituting a pose from another ` +
          `intent would put the wrong gesture on a correct-looking frame — arms folded ` +
          `while the narration points at a chart — and every downstream gate would pass, ` +
          `because the substituted pose IS calibrated. Calibrate one of the preferred ` +
          `poses in the Presenter Studio (task U1), or set ` +
          `metadata.business_hub.presenter_mode = "none" to plan this video without a ` +
          `figure. Manifest state: ${this.manifestSummary || "(empty)"}.`,
        beatSlug,
      );
    }

    const cursor = this.cursors.get(intent) ?? 0;
    for (let step = 0; step < preferred.length; step += 1) {
      const slug = preferred[(cursor + step) % preferred.length];
      if (slug === previousPose) continue;
      this.cursors.set(intent, (cursor + step + 1) % preferred.length);
      return this.get(slug, beatSlug);
    }

    // Every candidate for this intent IS the previous pose, i.e. the intent has
    // exactly one calibrated pose and the last presenter beat used it. Repeat
    // it: holding a gesture across a cut is a blemish, showing the wrong
    // gesture is a wrong statement. Stated in the log, never silent.
    const repeated = preferred[0];
    if (repeated === undefined) {
      throw new ScenePlannerError(
        "NO_POSE_FOR_INTENT",
        `intent "${intent}" reported ${preferred.length} candidates and then produced ` +
          `none. This is a planner bug, not a data problem.`,
        beatSlug,
      );
    }
    console.warn(
      `[business-hub/planner] beat ${beatSlug}: intent "${intent}" has exactly one ` +
        `calibrated pose ("${repeated}") and the previous presenter beat already used ` +
        `it, so it repeats across the cut. Calibrate another of ` +
        `${INTENT_POSES[intent].join(", ")} to restore the rotation.`,
    );
    return this.get(repeated, beatSlug);
  }

  private get(slug: string, beatSlug: string): CalibratedPose {
    const pose = this.byslug.get(slug);
    if (pose === undefined) {
      throw new ScenePlannerError(
        "NO_CALIBRATED_POSE",
        `pose "${slug}" vanished from the calibrated set while planning.`,
        beatSlug,
      );
    }
    return pose;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Framed-chart geometry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maximum tilt, in degrees, of an object in the content layer. Design §3.2:
 * "nothing is axis-aligned … objects carry a few degrees of rotation". Past
 * about six degrees the frame stops reading as placed and starts reading as
 * fallen over.
 */
export const MAX_FRAME_TILT_DEG = 6;

/**
 * The rotation, in degrees clockwise, a `framed-chart` object takes given the
 * pose pointing at it.
 *
 * The composition rule of design §3.2 is that the pointer draws a *physical*
 * line from hand to data point: the frame is not decorated with a random tilt,
 * it lies along the pointing vector. So the vector is read left-to-right (a
 * vector and its negation describe the same line), its slope is taken as the
 * frame's tilt, and the result is clamped to {@link MAX_FRAME_TILT_DEG}.
 *
 * A purely vertical vector has no left-to-right slope; `atan2` resolves it to
 * -90°, which clamps to `-MAX_FRAME_TILT_DEG`. That is deterministic and
 * documented rather than special-cased.
 *
 * @throws {@link ScenePlannerError} `NO_CALIBRATED_POSE` when the pose has no
 * hitboxes. There is no default rotation — design §8 rule 2.
 */
export function framedChartRotationDeg(pose: Pose): number {
  if (!isCalibratedPose(pose)) {
    throw new ScenePlannerError(
      "NO_CALIBRATED_POSE",
      `pose "${pose.slug}" is ${pose.anchor_status} and carries no pointDirection hitbox, ` +
        `so the framed-chart rotation cannot be derived. Calibrate it in the Presenter Studio (task U1).`,
    );
  }
  const { x, y } = pose.hitboxes.pointDirection;
  // Read the line left-to-right: a vector and its negation are the same line.
  const dx = x < 0 ? -x : x;
  const dy = x < 0 ? -y : y;
  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  return clamp(degrees, -MAX_FRAME_TILT_DEG, MAX_FRAME_TILT_DEG);
}

const clamp = (value: number, low: number, high: number): number =>
  value < low ? low : value > high ? high : value;

/**
 * Which side of frame the presenter stands on, so his arm reaches *into* the
 * object rather than away from it: a hand pointing right puts him on the left.
 * A near-vertical vector puts him centre.
 */
function presenterSideForPose(pose: CalibratedPose): ScenePresenter["side"] {
  const { x } = pose.hitboxes.pointDirection;
  if (Math.abs(x) < 0.1) return "center";
  return x > 0 ? "left" : "right";
}

/**
 * The element sub-id the presenter points at. Derived from the figure's own
 * shape — the last data point is where the eye should land — so it moves with
 * the data instead of being authored.
 *
 * The convention (contract with tasks M3/M4): series elements expose
 * `point-<0-based index>` sub-ids, and single-value derivations expose
 * `result`.
 */
function pointsAtForFigure(figure: FinanceFigure): string {
  switch (figure.kind) {
    case "amortization":
      return `point-${figure.value.rows.length - 1}`;
    case "projection":
      return `point-${figure.value.years.length - 1}`;
    case "series":
      return `point-${figure.value.points.length - 1}`;
    case "dscr":
    case "break-even":
    case "sba-fees":
    case "eb5-jobs":
      return "result";
    default: {
      const never: never = figure;
      throw new ScenePlannerError(
        "MISSING_FIGURE",
        `unhandled figure kind ${JSON.stringify(never)}`,
      );
    }
  }
}

/**
 * True when the figure's headline series goes up over its own domain. A rising
 * figure gets a rising hand; everything else gets the pointer.
 *
 * Only `projection` and `series` have a meaningful direction — an amortization
 * balance always falls and its cumulative interest always rises, so reading a
 * "direction" off them would be noise dressed as signal.
 */
function isRisingFigure(figure: FinanceFigure): boolean {
  if (figure.kind === "series") {
    const { points } = figure.value;
    return points[points.length - 1] > points[0];
  }
  if (figure.kind === "projection") {
    const { years } = figure.value;
    return years[years.length - 1].revenue > years[0].revenue;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache key
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic JSON: object keys sorted recursively by UTF-16 code unit,
 * arrays left in order, `undefined` properties omitted exactly as
 * `JSON.stringify` omits them.
 *
 * The segment cache is what makes a keyword-matrix catalogue affordable — "why
 * 1.25 DSCR" renders once for the whole library — and a hash that changed
 * because a caller happened to build its props object in a different order
 * would quietly halve the hit rate. So key order must not reach the hash.
 *
 * **Byte-compatible with `canonicalStringify` in
 * `packages/media-core/src/cache/canonical-json.ts` (task R2), deliberately.**
 * The renderer computes the same key with that function, so any divergence
 * would mean the orchestrator and the renderer disagree about cache identity
 * and every segment renders twice. It is duplicated here only because
 * `@repo/media-core`'s barrel does not export the cache module yet (task R4
 * owns that file) — when it does, delete this and import theirs. A test in
 * `__tests__/planner.test.ts` pins the two implementations together so the
 * duplication cannot rot silently. See `docs/superpowers/handoff/O1.md`.
 *
 * @throws {@link ScenePlannerError} `NON_CANONICAL_DATA` on anything JSON
 * cannot carry losslessly — `undefined`, `NaN`/`Infinity`, `bigint`, a
 * function, a `Date`/`Map`/class instance, or a cycle. Every one of those would
 * otherwise be coerced into a key that does not describe the render.
 */
export function canonicalStringify(value: unknown): string {
  return writeCanonical(value, "$", new Set<object>());
}

function writeCanonical(
  value: unknown,
  path: string,
  seen: Set<object>,
): string {
  const valueType = typeof value;
  switch (valueType) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new ScenePlannerError(
          "NON_CANONICAL_DATA",
          `non-finite number ${String(value)} at ${path}: JSON would silently write null, producing a cache key that does not describe the render`,
        );
      }
      return JSON.stringify(value);
    case "undefined":
      throw new ScenePlannerError(
        "NON_CANONICAL_DATA",
        `undefined at ${path} is not a JSON value; supply the real value or omit the property`,
      );
    case "bigint":
    case "function":
    case "symbol":
      throw new ScenePlannerError(
        "NON_CANONICAL_DATA",
        `${valueType} at ${path} is not a JSON value`,
      );
    case "object":
      break;
    default: {
      // Exhaustive over every `typeof` tag. A future JS primitive stops this
      // compiling rather than silently hashing something we cannot represent.
      const unhandled: never = valueType;
      throw new ScenePlannerError(
        "NON_CANONICAL_DATA",
        `unsupported value at ${path}: ${String(unhandled)}`,
      );
    }
  }

  if (value === null) return "null";
  // Narrowing `value` itself is not possible here because the switch above
  // tests `valueType`, not `value`; the two checks together establish this.
  const object = value as object;

  if (seen.has(object)) {
    throw new ScenePlannerError(
      "NON_CANONICAL_DATA",
      `circular reference at ${path}: a cache key cannot be computed for a cyclic spec`,
    );
  }
  seen.add(object);

  try {
    if (Array.isArray(value)) {
      return `[${value
        .map((item: unknown, index) => {
          if (item === undefined) {
            throw new ScenePlannerError(
              "NON_CANONICAL_DATA",
              `undefined inside the array at ${path}[${index}]: JSON would write null, changing the meaning of the array`,
            );
          }
          return writeCanonical(item, `${path}[${index}]`, seen);
        })
        .join(",")}]`;
    }

    const prototype: unknown = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ScenePlannerError(
        "NON_CANONICAL_DATA",
        `the value at ${path} is not a plain object; convert it to plain JSON before hashing so the key describes what was actually rendered`,
      );
    }

    const record = object as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .filter((key) => record[key] !== undefined)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${writeCanonical(record[key], `${path}.${key}`, seen)}`,
      )
      .join(",")}}`;
  } finally {
    seen.delete(object);
  }
}

/** The inputs that make one rendered motion-graphic island distinct. */
export interface SceneCacheKeyInput {
  readonly element: string;
  readonly data: unknown;
  readonly grade: string | undefined;
  readonly layout: Layout;
  readonly aspect: string;
}

/**
 * `sha256` of the canonical form of `{element, data, grade, layout, aspect}`,
 * hex encoded. Stable across key reordering in `data`; changes when any of the
 * five inputs changes.
 */
export function computeSceneCacheKey(input: SceneCacheKeyInput): string {
  return createHash("sha256")
    .update(
      canonicalStringify({
        element: input.element,
        data: input.data,
        grade: input.grade,
        layout: input.layout,
        aspect: input.aspect,
      }),
    )
    .digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Slugs
// ─────────────────────────────────────────────────────────────────────────────

const MAX_SLUG_CHARS = 48;

/** Kebab-cases arbitrary text into the slug shape the scene schema demands. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter((part) => part.length > 0)
    .join("-")
    .slice(0, MAX_SLUG_CHARS)
    .replace(/-+$/g, "");
}

/**
 * The stable slug for a beat: `[beat:]` if given, else the role's own text,
 * else the opening words of the narration. Deduplicated with a numeric suffix
 * so a plan never carries two beats of the same name.
 *
 * @throws {@link ScenePlannerError} `UNSLUGGABLE_BEAT` when nothing sluggable
 * remains (narration of pure punctuation, for instance).
 */
function beatSlugFor(
  role: BeatRole,
  directives: ReadonlyMap<DirectiveName, string>,
  narration: string,
  index: number,
  taken: Set<string>,
): string {
  const override = directives.get("beat");
  const base = override ?? roleSlugSeed(role, narration);
  const slug = slugify(base);
  if (slug.length === 0) {
    throw new ScenePlannerError(
      "UNSLUGGABLE_BEAT",
      `paragraph ${index + 1} produced an empty beat slug from "${base}". ` +
        `Beat slugs feed cache keys and filenames; add "[beat: some-slug]" to this paragraph.`,
    );
  }
  if (!taken.has(slug)) {
    taken.add(slug);
    return slug;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${slug}-${suffix}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

function roleSlugSeed(role: BeatRole, narration: string): string {
  switch (role.role) {
    case "hook":
      return "hook";
    case "cta":
      return "cta";
    case "close":
      return "close";
    case "title":
      return role.title;
    case "chapter":
      return `chapter-${role.title}`;
    case "figure":
      return role.figureId;
    case "document":
      // Only the document's own name — the publication and date fields that
      // follow it are for the clipping, not for a filename.
      return role.document.split(DOCUMENT_FIELD_SEPARATOR)[0];
    case "connective":
      return narration.split(/\s+/).slice(0, 7).join(" ");
    default: {
      const never: never = role;
      throw new ScenePlannerError(
        "INVALID_PLAN",
        `unhandled beat role ${JSON.stringify(never)}`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Source parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses `[source: repo docs/x.md#anchor]` / `[source: primary sba.gov/...]`.
 *
 * @throws {@link ScenePlannerError} `INVALID_SOURCE` when the kind word is
 * missing or the ref fails the allowlist in `@repo/contracts`.
 */
export function parseSourceDirective(raw: string, beatSlug: string): SourceRef {
  const separator = raw.search(/\s/);
  if (separator === -1) {
    throw new ScenePlannerError(
      "INVALID_SOURCE",
      `source "${raw}" is missing its kind. Write "[source: repo <path>]" or "[source: primary <url>]".`,
      beatSlug,
    );
  }
  const kind = raw.slice(0, separator).trim().toLowerCase();
  const ref = raw.slice(separator + 1).trim();

  if (kind !== "repo" && kind !== "primary") {
    throw new ScenePlannerError(
      "INVALID_SOURCE",
      `source kind "${kind}" is not recognised. Use "repo" for an in-repo spec or "primary" for an allowlisted government document.`,
      beatSlug,
    );
  }

  const parsed = SourceRefSchema.safeParse({ kind, ref });
  if (!parsed.success) {
    throw new ScenePlannerError(
      "INVALID_SOURCE",
      `source "${kind} ${ref}" was rejected: ${parsed.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
      beatSlug,
    );
  }
  return parsed.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Planning
// ─────────────────────────────────────────────────────────────────────────────

interface DraftScene {
  readonly index: number;
  readonly beat: string;
  readonly role: BeatRole;
  readonly kind: BusinessHubScene["kind"];
  readonly layout: Layout;
  readonly element: BusinessHubMgElementName | undefined;
  readonly figure: FinanceFigure | undefined;
  /**
   * The mg element's props, present exactly when `kind === "mg"`. Wrapped so
   * "no props" is distinguishable from "props are literally undefined" — an mg
   * scene that reached here without props is a planner bug, not a default.
   */
  readonly mgProps: { readonly props: unknown } | undefined;
  readonly headline: string | undefined;
  readonly eyebrow: string | undefined;
  readonly source: SourceRef | undefined;
  readonly narration: string;
  readonly grade: GroundTheme;
}

/**
 * Compiles a script into a validated {@link BusinessHubPlan}.
 *
 * Deterministic: the same input always produces the same plan, byte for byte.
 * No LLM call, no clock, no filesystem, no database.
 *
 * @throws {@link ScenePlannerError} on any of the fail-closed conditions —
 * a beat citing a figure finance-kit did not produce (`MISSING_FIGURE`), a
 * factual-claim element with no citation (`MISSING_SOURCE`), an unregistered
 * element (`UNKNOWN_ELEMENT`), an uncalibrated presenter pose
 * (`NO_CALIBRATED_POSE`), a missing hook or close (`MISSING_ROLE_BEAT`), a
 * headline past its 68-character budget (`HEADLINE_TOO_LONG`), or a plan the
 * contracts schema rejects (`INVALID_PLAN`). It never substitutes a default for
 * any of them.
 */
export function planBusinessHub(input: ScenePlannerInput): BusinessHubPlan {
  if (input.aspect.trim().length === 0) {
    throw new ScenePlannerError(
      "INVALID_INPUT",
      'aspect is empty. It is part of every motion-graphic cache key, so it must be explicit (e.g. "16:9").',
    );
  }
  if (typeof input.placePresenter !== "boolean") {
    // Not defaulted either way. Omitting it and getting `false` would silently
    // produce the presenter-less subformat for a job that asked for the suit,
    // and every downstream gate would pass because a plan with no presenter is
    // a perfectly valid plan.
    throw new ScenePlannerError(
      "INVALID_INPUT",
      `placePresenter is ${JSON.stringify(input.placePresenter)}; a boolean is required. ` +
        `It is the design §3.4 subformat choice ("suit" vs "none"), not an optional hint.`,
    );
  }

  const paragraphs = splitIntoBeats(input.script);
  const takenSlugs = new Set<string>();
  const drafts: DraftScene[] = [];
  const roleCounts = new Map<string, number>();
  let chapterIndex = 0;

  paragraphs.forEach((paragraph, index) => {
    const { directives, narration } = parseBeatText(paragraph, index);
    const role = classifyBeat(directives, index);
    const beat = beatSlugFor(role, directives, narration, index, takenSlugs);

    roleCounts.set(role.role, (roleCounts.get(role.role) ?? 0) + 1);

    const source = readSource(directives, beat);

    if (role.role === "chapter") chapterIndex += 1;
    const grade: GroundTheme =
      role.role === "chapter"
        ? cardThemeForChapter(chapterIndex)
        : bodyThemeForChapter(chapterIndex);

    drafts.push(
      buildDraft({
        index,
        beat,
        role,
        directives,
        narration,
        source,
        grade,
        figures: input.figures,
        placePresenter: input.placePresenter,
      }),
    );
  });

  requireRoleBeat(roleCounts, "hook");
  requireRoleBeat(roleCounts, "close");

  // `presenterMode: "none"` is a stated subformat (design §3.4), not a
  // degradation: the same scenes, no figure. Selecting nothing here is what
  // makes the pose rotation below a no-op, so no pose is ever required.
  const presenterIndices = input.placePresenter
    ? selectPresenterIndices(
        drafts.map((draft) => ({
          index: draft.index,
          mandatory:
            draft.role.role === "hook" ||
            draft.role.role === "cta" ||
            draft.role.role === "close",
          layout: draft.layout,
        })),
        drafts.length,
      )
    : new Set<number>();

  const rotation = new PoseRotation(input.poses);
  let previousPose: string | undefined;

  const scenes: BusinessHubScene[] = drafts.map((draft, position) => {
    let presenter: ScenePresenter | undefined;
    if (presenterIndices.has(draft.index)) {
      const intent = intentFor(draft);
      const pose = rotation.next(intent, previousPose, draft.beat);
      previousPose = pose.slug;
      presenter = {
        pose: pose.slug,
        side:
          draft.kind === "presenter-solo"
            ? "center"
            : presenterSideForPose(pose),
        pointsAt:
          draft.layout === "framed-chart" && draft.figure !== undefined
            ? pointsAtForFigure(draft.figure)
            : undefined,
      };
      if (draft.layout === "framed-chart") {
        // Asserts the pointing vector exists — the frame's rotation is derived
        // from it at render time and must not be discovered missing there.
        framedChartRotationDeg(pose);
      }
    }
    // `previousPose` deliberately survives scenes without a presenter: the rule
    // is that consecutive APPEARANCES differ, and he is off screen in between.

    return finishScene(draft, position, presenter, input.aspect);
  });

  const parsed = BusinessHubPlanSchema.safeParse({
    scenes,
    topic: input.topic,
    family: input.family,
    targetSeconds: input.targetSeconds,
  });
  if (!parsed.success) {
    throw new ScenePlannerError(
      "INVALID_PLAN",
      `the planned scenes do not satisfy BusinessHubPlanSchema: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

function readSource(
  directives: ReadonlyMap<DirectiveName, string>,
  beat: string,
): SourceRef | undefined {
  const raw = directives.get("source");
  return raw === undefined ? undefined : parseSourceDirective(raw, beat);
}

function requireRoleBeat(
  counts: ReadonlyMap<string, number>,
  role: "hook" | "close",
): void {
  const count = counts.get(role) ?? 0;
  if (count === 0) {
    throw new ScenePlannerError(
      "MISSING_ROLE_BEAT",
      `script has no [${role}] beat. The presenter's appearances are scheduled around the hook, the CTA and the close; without a [${role}] the plan has no ${role}.`,
    );
  }
  if (count > 1) {
    throw new ScenePlannerError(
      "DUPLICATE_ROLE_BEAT",
      `script has ${count} [${role}] beats. Exactly one is allowed.`,
    );
  }
}

interface BuildDraftArgs {
  readonly index: number;
  readonly beat: string;
  readonly role: BeatRole;
  readonly directives: ReadonlyMap<DirectiveName, string>;
  readonly narration: string;
  readonly source: SourceRef | undefined;
  readonly grade: GroundTheme;
  readonly figures: FinanceFigureSet;
  /** See {@link ScenePlannerInput.placePresenter}. */
  readonly placePresenter: boolean;
}

/** Resolves one beat into its kind, layout, element, data and copy. */
function buildDraft(args: BuildDraftArgs): DraftScene {
  const { role, beat, directives } = args;
  const eyebrow = directives.get("eyebrow");
  const headlineOverride = directives.get("headline");

  const common = {
    index: args.index,
    beat,
    role,
    narration: args.narration,
    grade: args.grade,
    eyebrow,
    source: args.source,
  } as const;

  switch (role.role) {
    case "hook":
    case "cta":
    case "close":
      // `presenter-solo` means literally "the presenter alone on the mat", and
      // the render gate (validate.ts rule 2) rejects one that carries no pose.
      // With `presenterMode: "none"` there is no figure to be alone, so the
      // role beat becomes what it is without him: a headline strip on the mat.
      return args.placePresenter
        ? {
            ...common,
            kind: "presenter-solo",
            layout: "presenter-solo",
            element: undefined,
            figure: undefined,
            mgProps: undefined,
            headline: checkHeadline(headlineOverride, beat),
          }
        : {
            ...common,
            kind: "title",
            layout: TITLE_LAYOUT,
            element: undefined,
            figure: undefined,
            mgProps: undefined,
            headline: checkHeadline(headlineOverride, beat),
          };

    case "title":
      return {
        ...common,
        kind: "title",
        layout: TITLE_LAYOUT,
        element: undefined,
        figure: undefined,
        mgProps: undefined,
        headline: checkHeadline(headlineOverride ?? role.title, beat),
      };

    case "chapter":
      return {
        ...common,
        kind: "chapter",
        layout: CHAPTER_LAYOUT,
        element: undefined,
        figure: undefined,
        mgProps: undefined,
        headline: checkHeadline(headlineOverride ?? role.title, beat),
      };

    case "document": {
      const element = DOCUMENT_ELEMENT;
      requireSourceFor({
        element,
        source: args.source,
        beat,
        reason: `it names the source document "${role.document}"`,
      });
      return {
        ...common,
        kind: "mg",
        layout: layoutForElement(element),
        element,
        figure: undefined,
        // Every field of a clipping is authored in the script's `[doc:]`
        // directive. Nothing is synthesised: a fabricated masthead or date on a
        // reproduction of a federal document is the worst thing this format
        // could ship, so a missing field throws.
        mgProps: {
          props: viaAdapter(beat, () =>
            adaptDocumentToElementProps(role.document, beat),
          ),
        },
        headline: checkHeadline(
          headlineOverride ??
            viaAdapter(beat, () => documentHeadline(role.document, beat)),
          beat,
        ),
      };
    }

    case "figure": {
      const figure = args.figures[role.figureId];
      if (figure === undefined) {
        const available = Object.keys(args.figures).sort();
        throw new ScenePlannerError(
          "MISSING_FIGURE",
          `beat cites "[fig: ${role.figureId}]" but finance-kit produced no such figure for this topic. ` +
            `Available figures: ${available.length > 0 ? available.join(", ") : "(none)"}. ` +
            `Either compute it in finance-kit or drop the figure from the script — a number will not be invented to fill the chart.`,
          beat,
        );
      }
      const element = resolveElement(role, figure, beat);
      requireSourceFor({
        element,
        source: args.source,
        beat,
        reason: `it renders finance figure "${role.figureId}" (${figure.kind}) on screen`,
      });
      // The finance-kit result is NOT the element's props: `LineChart` asks for
      // `{ series, format }` and an `AmortizationSchedule` has `rows`. The
      // conversion happens here, at plan time, because `scene.data` is what the
      // cache key hashes — adapting later would make every key describe a
      // payload no renderer ever receives.
      const rawFormat = role.rawFormat;
      const valueFormat: ValueFormat | undefined =
        rawFormat === undefined
          ? undefined
          : viaAdapter(beat, () => parseValueFormatDirective(rawFormat));
      return {
        ...common,
        kind: "mg",
        layout: layoutForElement(element),
        element,
        figure,
        mgProps: {
          props: viaAdapter(beat, () =>
            adaptFigureToElementProps({ element, figure, beat, valueFormat }),
          ),
        },
        headline: checkHeadline(headlineOverride, beat),
      };
    }

    case "connective":
      return {
        ...common,
        kind: "broll",
        layout: CONNECTIVE_LAYOUT,
        element: undefined,
        figure: undefined,
        mgProps: undefined,
        headline: checkHeadline(headlineOverride, beat),
      };

    default: {
      const never: never = role;
      throw new ScenePlannerError(
        "INVALID_PLAN",
        `unhandled beat role ${JSON.stringify(never)}`,
      );
    }
  }
}

interface RequireSourceArgs {
  readonly element: string;
  readonly source: SourceRef | undefined;
  readonly beat: string;
  readonly reason: string;
}

/**
 * The citation gate (design §8 rule 1), applied at plan time so a script fails
 * here rather than four stages later inside a render.
 *
 * Two independent triggers, both fatal:
 *  - the element is registered in `ELEMENT_SOURCE_KIND` as displaying a stat,
 *    formula, quote, comparison or checklist; or
 *  - the scene puts a computed figure or a named document on screen, which is a
 *    factual claim whether or not the element happens to be registered.
 *
 * @throws {@link ScenePlannerError} `MISSING_SOURCE`.
 */
function requireSourceFor(args: RequireSourceArgs): void {
  if (args.source !== undefined) return;
  const claimKind = sourceKindForElement(args.element);
  const registered = requiresSource(args.element);
  throw new ScenePlannerError(
    "MISSING_SOURCE",
    `beat has no [source: ...] but ${args.reason}` +
      (registered
        ? ` and element "${args.element}" displays a ${claimKind}`
        : "") +
      `. Add "[source: primary <allowlisted gov url>]" or "[source: repo <path#anchor>]". ` +
      `SBA and EB-5 claims sit next to unauthorised-practice-of-law exposure; this gate is the control.`,
    args.beat,
  );
}

/**
 * @throws {@link ScenePlannerError} `HEADLINE_TOO_LONG` — the budget is a
 * render constraint (design §6), so it fails at build, not at 1080p.
 */
function checkHeadline(
  headline: string | undefined,
  beat: string,
): string | undefined {
  if (headline === undefined) return undefined;
  if (headline.length > HEADLINE_MAX_CHARS) {
    throw new ScenePlannerError(
      "HEADLINE_TOO_LONG",
      `headline is ${headline.length} characters; the budget is ${HEADLINE_MAX_CHARS} and it will overflow at 1080p: "${headline}"`,
      beat,
    );
  }
  return headline;
}

/** Why the presenter is on this scene — drives pose choice. */
function intentFor(draft: DraftScene): PresenterIntent {
  switch (draft.role.role) {
    case "hook":
      return "rhetorical-question";
    case "cta":
    case "close":
      return "affirm";
    case "figure":
      if (draft.figure !== undefined && isRisingFigure(draft.figure)) {
        return "rising-figure";
      }
      return draft.layout === "card-grid" ? "card-grid" : "chart";
    case "document":
      return draft.layout === "card-grid" ? "card-grid" : "consider";
    case "title":
    case "chapter":
    case "connective":
      return "consider";
    default: {
      const never: never = draft.role;
      throw new ScenePlannerError(
        "INVALID_PLAN",
        `unhandled beat role ${JSON.stringify(never)}`,
      );
    }
  }
}

/** Materialises a draft into the discriminated scene the contracts define. */
function finishScene(
  draft: DraftScene,
  position: number,
  presenter: ScenePresenter | undefined,
  aspect: string,
): BusinessHubScene {
  const id = `s${String(position + 1).padStart(2, "0")}`;
  const text = {
    headline: draft.headline,
    eyebrow: draft.eyebrow,
    body: undefined,
  };
  const base = {
    id,
    beat: draft.beat,
    layout: draft.layout,
    text,
    presenter,
    grade: draft.grade,
    source: draft.source,
    narration: draft.narration,
  } as const;

  switch (draft.kind) {
    case "mg": {
      if (draft.element === undefined || draft.mgProps === undefined) {
        throw new ScenePlannerError(
          "INVALID_PLAN",
          "an mg scene reached assembly without an element or its props — this is a planner bug, not a missing input",
          draft.beat,
        );
      }
      const props: unknown = draft.mgProps.props;
      return {
        ...base,
        kind: "mg",
        element: draft.element,
        data: props,
        cacheKey: computeSceneCacheKey({
          element: draft.element,
          data: props,
          grade: draft.grade,
          layout: draft.layout,
          aspect,
        }),
      };
    }
    case "broll":
      return { ...base, kind: "broll" };
    case "title":
      return { ...base, kind: "title" };
    case "chapter":
      return { ...base, kind: "chapter" };
    case "presenter-solo":
      return { ...base, kind: "presenter-solo" };
    default: {
      const never: never = draft.kind;
      throw new ScenePlannerError(
        "INVALID_PLAN",
        `unhandled scene kind ${JSON.stringify(never)}`,
        draft.beat,
      );
    }
  }
}
