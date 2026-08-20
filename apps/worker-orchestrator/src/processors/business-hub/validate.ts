import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  HEADLINE_MAX_CHARS,
  PRIMARY_SOURCE_DOMAINS,
  isAllowlistedPrimarySource,
  sourceKindForElement,
  type BusinessHubPlan,
  type BusinessHubScene,
  type Pose,
} from "@repo/contracts";

/**
 * BUSINESS_PLAN_HUB — the fail-closed plan validator (task O2).
 *
 * Implements section 8 of
 * `docs/superpowers/specs/2026-08-15-business-plan-hub-format-design.md`. The
 * scene *schema* (task F2, `@repo/contracts`) rejects a malformed scene; this
 * module rejects a well-formed scene that is nonetheless unbuildable — a
 * citation pointing at a file that no longer exists, a pose whose hitboxes were
 * never calibrated, a headline that will overflow, a colour literal that
 * bypasses the theme tokens, a timeline with a hole in it.
 *
 * Two entry points, deliberately:
 *
 *  - {@link collectViolations} is pure with respect to its inputs (all
 *    filesystem access goes through the injected {@link RepoSourceProbe}) and
 *    returns every violation it finds. A future Presenter/Plan Studio can render
 *    that list without catching anything.
 *  - {@link validateBusinessHubPlan} throws ONE
 *    {@link BusinessHubPlanValidationError} listing every violation. At this
 *    volume, failing on the first problem turns a 40-scene plan into forty
 *    round-trips, so the aggregate is the point.
 *
 * Nothing here repairs, estimates, defaults or downgrades a violation to a
 * warning. If a rule cannot be *checked* (an unreadable file behind an anchored
 * citation, a plan with no timing data) that is itself a violation — "could not
 * verify" is never "assume fine".
 */

// ─────────────────────────────────────────────────────────────────────────────
// Budgets and tolerances — the tunable constants, all in one place
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-slot character budgets, in characters, at 1920x1080.
 *
 * Derived from design §3 (visual system): the ground carries objects rather
 * than full-bleed text, nothing renders below 18px, and `headline` is stated
 * there as ≤ 68 — re-exported from `@repo/contracts`' {@link HEADLINE_MAX_CHARS}
 * so the two can never drift apart. The remaining numbers are the widths the
 * §3.2 layouts leave for each slot once the presenter's `safeRegion` is
 * subtracted: a card in `card-grid` and a row in a `paper-stack` checklist are
 * roughly a third of the frame, a stat value is set large enough that twelve
 * glyphs is the whole box.
 *
 * Overflow fails at BUILD, never in the render (design §8 rule 5) — a truncated
 * headline is invisible until someone watches the published video.
 */
export const TEXT_BUDGETS = {
  /** `scene.text.headline`. Design §3 / §6 state this one explicitly. */
  headline: HEADLINE_MAX_CHARS,
  /** `scene.text.eyebrow` — the small line above the headline. */
  eyebrow: 34,
  /** `scene.text.body` — the paragraph slot under a headline. */
  body: 220,
  /** One row of a checklist element. */
  checklistItem: 92,
  /** The large number in a stat element. Twelve glyphs fills the box. */
  statValue: 12,
  /** The caption under a stat's number. */
  statLabel: 40,
  /** A quotation's body. */
  quote: 240,
  /** The "— SBA SOP 50 10 7.1" line under a quotation. */
  attribution: 60,
  /** One cell of a comparison table. */
  comparisonCell: 48,
  /** A comparison table's column header. */
  columnHeader: 28,
  /** One term of a formula being built up. */
  formulaTerm: 28,
  /** The explanatory line under a formula step. */
  formulaCaption: 96,
  /** A chart axis tick label. */
  axisLabel: 24,
  /** A chart series name in the legend. */
  seriesLabel: 32,
  /** A footnote or callout note anywhere on the mat. */
  calloutNote: 120,
} as const satisfies Record<string, number>;

/** A named slot in {@link TEXT_BUDGETS}. */
export type TextBudgetSlot = keyof typeof TEXT_BUDGETS;

/**
 * Which budget a string inside `scene.data` is measured against, keyed by the
 * property name that holds it (lowercased; array indices are ignored, so
 * `items[2]` is budgeted as `items`).
 *
 * A property name that is NOT listed here is unbudgeted. That is deliberate —
 * inventing a budget for an unknown key would fail plans for no stated reason.
 * **When you add an MG element with a new text prop, add its key here in the
 * same change**, otherwise that prop silently has no overflow gate.
 */
export const TEXT_BUDGET_BY_DATA_KEY: Readonly<Record<string, TextBudgetSlot>> =
  {
    headline: "headline",
    title: "headline",
    heading: "headline",
    eyebrow: "eyebrow",
    kicker: "eyebrow",
    body: "body",
    description: "body",
    paragraph: "body",
    items: "checklistItem",
    item: "checklistItem",
    bullets: "checklistItem",
    checklist: "checklistItem",
    requirements: "checklistItem",
    value: "statValue",
    figure: "statValue",
    amount: "statValue",
    label: "statLabel",
    metric: "statLabel",
    quote: "quote",
    quotation: "quote",
    attribution: "attribution",
    author: "attribution",
    cite: "attribution",
    cells: "comparisonCell",
    cell: "comparisonCell",
    columns: "columnHeader",
    headers: "columnHeader",
    term: "formulaTerm",
    terms: "formulaTerm",
    lhs: "formulaTerm",
    rhs: "formulaTerm",
    expression: "formulaTerm",
    caption: "formulaCaption",
    labels: "axisLabel",
    series: "seriesLabel",
    note: "calloutNote",
    footnote: "calloutNote",
  };

/**
 * How far a scene's start may sit from the previous scene's end before the
 * timeline counts as broken. 0.05s is under two frames at 30fps — anything
 * larger is a visible gap or an overlap, not float noise.
 */
export const SCENE_TIMING_CONTIGUITY_TOLERANCE_SEC = 0.05;

/**
 * How far the scene timeline's total may sit from the measured narration
 * duration. A quarter-second of trailing room absorbs the encoder's frame
 * rounding without letting a whole dropped scene through.
 */
export const NARRATION_DURATION_TOLERANCE_SEC = 0.25;

/** Depth cap on the `scene.data` walk. Deeper than this is not MG props. */
const MAX_DATA_DEPTH = 12;

/** Files larger than this are not slurped to resolve an anchor. */
const MAX_PROBE_FILE_BYTES = 4 * 1024 * 1024;

/**
 * A CSS hex colour literal: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. The
 * trailing `\b` and the longest-first alternation stop this matching a longer
 * hex-ish identifier (a cache key, a commit sha).
 */
const HEX_COLOUR_RE =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/;

// ─────────────────────────────────────────────────────────────────────────────
// Violations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which rule a violation broke. Stable strings — a Studio may group on them.
 *
 * - `context-invalid`   the validation context itself cannot support a check
 * - `source-missing`    a claim scene carries no citation (design §8 rule 1)
 * - `source-unresolved` a citation that does not resolve (§8 rule 1)
 * - `pose-missing`      a presenter scene names a pose that is not in the manifest
 * - `pose-uncalibrated` the pose exists but was never calibrated (§8 rule 2)
 * - `hitbox-missing`    a required hitbox is absent or unusable (§8 rule 2)
 * - `visual-missing`    a `broll` scene with no visual
 * - `visual-provenance` a visual missing provider/sourceUrl/licence/retrievedAt (§8 rule 6)
 * - `text-budget`       copy overflows its slot (§8 rule 5)
 * - `hex-colour`        a colour literal in plan data instead of a theme token
 * - `scene-timing`      non-positive, non-contiguous or non-summing durations
 * - `cache-key`         an `mg` scene with no derived cache key
 * - `data-unwalkable`   scene data too deep or circular to verify at all
 */
export type ViolationRule =
  | "context-invalid"
  | "source-missing"
  | "source-unresolved"
  | "element-unregistered"
  | "pose-missing"
  | "pose-uncalibrated"
  | "hitbox-missing"
  | "visual-missing"
  | "visual-provenance"
  | "text-budget"
  | "hex-colour"
  | "scene-timing"
  | "cache-key"
  | "data-unwalkable";

/** One thing wrong with a plan. Never a warning — every violation blocks. */
export interface Violation {
  readonly rule: ViolationRule;
  /** Scene id, or `null` for a plan-level violation. */
  readonly sceneId: string | null;
  /** Beat slug, or `null` for a plan-level violation. */
  readonly beat: string | null;
  /** Where it is, e.g. `scenes[6].data.items[2]`. */
  readonly path: string;
  /** What is wrong. */
  readonly message: string;
  /** What to do about it. */
  readonly remedy: string;
}

/**
 * One human-readable line for a violation, always naming the scene id and the
 * beat slug so a failure can be located without opening the plan JSON.
 */
export function formatViolation(violation: Violation): string {
  const where =
    violation.sceneId === null
      ? "plan"
      : `scene ${violation.sceneId} (${violation.beat ?? "no-beat"})`;
  return `[${violation.rule}] ${where} at ${violation.path}: ${violation.message} -> ${violation.remedy}`;
}

/**
 * Thrown by {@link validateBusinessHubPlan} with EVERY violation attached, not
 * just the first. `violations` is the machine-readable form of `message`.
 */
export class BusinessHubPlanValidationError extends Error {
  readonly violations: readonly Violation[];

  constructor(violations: readonly Violation[], planLabel: string) {
    const lines = violations.map((v, i) => `  ${i + 1}. ${formatViolation(v)}`);
    super(
      `BUSINESS_PLAN_HUB plan failed validation: ${violations.length} violation` +
        `${violations.length === 1 ? "" : "s"} (${planLabel})\n${lines.join("\n")}`,
    );
    this.name = "BusinessHubPlanValidationError";
    this.violations = violations;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

/** Where one scene sits on the narration timeline, in seconds. */
export interface SceneTiming {
  readonly sceneId: string;
  readonly startSec: number;
  readonly endSec: number;
}

/** What a {@link RepoSourceProbe} reports about one repo-relative path. */
export interface RepoProbeResult {
  /** True when the path resolves to a regular file inside the repo. */
  readonly exists: boolean;
  /**
   * The file's text, for anchor resolution. `null` when the file is absent,
   * binary, unreadable or over {@link MAX_PROBE_FILE_BYTES} — in which case an
   * ANCHORED citation fails closed, because it cannot be verified.
   */
  readonly text: string | null;
}

/**
 * The filesystem port. Injected so {@link collectViolations} stays pure with
 * respect to its arguments and so tests do not need fixture files on disk.
 */
export interface RepoSourceProbe {
  probe(repoRelativePath: string): RepoProbeResult;
}

/** Everything the validator needs beyond the plan itself. */
export interface BusinessHubValidationContext {
  /** Absolute path to the monorepo root. `repo` citations resolve against it. */
  readonly repoRoot: string;
  /**
   * The parsed `media/style-assets/presenter/poses/poses.json`. Pass what is on
   * disk, uncalibrated entries and all — this validator is what rejects them.
   */
  readonly poses: readonly Pose[];
  /** One entry per scene, in playback order. */
  readonly sceneTimings: readonly SceneTiming[];
  /** Measured duration of the narration track, in seconds (ffprobe/Whisper). */
  readonly narrationDurationSec: number;
  /**
   * Filesystem port. Defaults to a real `node:fs` probe rooted at `repoRoot`
   * (see {@link createNodeRepoSourceProbe}); tests inject a fake.
   */
  readonly repoProbe?: RepoSourceProbe;
}

/**
 * The real filesystem probe: resolves a repo-relative path under `repoRoot`,
 * refuses to escape it, and reads the file's text when it is small enough and
 * looks like text.
 *
 * Never throws — an unreadable file is reported as `{ exists, text: null }` and
 * the caller turns that into a violation. Results are memoised per instance
 * because a plan cites the same spec from a dozen scenes.
 */
export function createNodeRepoSourceProbe(repoRoot: string): RepoSourceProbe {
  const cache = new Map<string, RepoProbeResult>();
  const missing: RepoProbeResult = { exists: false, text: null };

  return {
    probe(repoRelativePath: string): RepoProbeResult {
      const cached = cache.get(repoRelativePath);
      if (cached !== undefined) return cached;

      const result = ((): RepoProbeResult => {
        if (repoRoot.trim().length === 0) return missing;
        const segments = repoRelativePath
          .split(/[\\/]/)
          .filter((s) => s !== "");
        if (segments.length === 0) return missing;
        if (segments.some((s) => s === "..")) return missing;

        const absolute = path.resolve(repoRoot, ...segments);
        const rootResolved = path.resolve(repoRoot);
        if (
          absolute !== rootResolved &&
          !absolute.startsWith(rootResolved + path.sep)
        ) {
          return missing;
        }

        try {
          if (!existsSync(absolute)) return missing;
          const stat = statSync(absolute);
          if (!stat.isFile()) return missing;
          if (stat.size > MAX_PROBE_FILE_BYTES) {
            return { exists: true, text: null };
          }
          const text = readFileSync(absolute, "utf8");
          // A NUL byte means this is not text; anchors cannot be enumerated.
          if (text.includes("\u0000")) return { exists: true, text: null };
          return { exists: true, text };
        } catch {
          return missing;
        }
      })();

      cache.set(repoRelativePath, result);
      return result;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Small guards — everything below treats its input as untrusted
// ─────────────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNormPoint(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

// ─────────────────────────────────────────────────────────────────────────────
// Anchor resolution
// ─────────────────────────────────────────────────────────────────────────────

/** GitHub-style heading slug: lowercase, non-alphanumerics to hyphens. */
function slugifyAnchor(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeForRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when `anchor` (the part after `#` in a repo citation) actually points at
 * something inside `text`.
 *
 * Three accepted forms, in order:
 *  1. `L120` / `L120-L140` — a line number that exists in the file.
 *  2. A Markdown heading, matched on its GitHub-style slug, or an explicit
 *     `id="..."` / `name="..."` attribute.
 *  3. A literal token appearing in the file on a word boundary — how a citation
 *     into source code names a symbol.
 *
 * Anything else is unresolved. Exported so the rule is directly testable.
 */
export function anchorResolvesInText(anchor: string, text: string): boolean {
  const trimmed = anchor.trim();
  if (trimmed.length === 0) return false;

  const lineRef = /^L(\d+)(?:-L?(\d+))?$/i.exec(trimmed);
  if (lineRef !== null) {
    const lineCount = text.split(/\r?\n/).length;
    const start = Number.parseInt(lineRef[1], 10);
    const end =
      lineRef[2] === undefined ? start : Number.parseInt(lineRef[2], 10);
    return start >= 1 && end >= start && end <= lineCount;
  }

  const wanted = slugifyAnchor(trimmed);
  if (wanted.length === 0) return false;

  for (const match of text.matchAll(
    /^\s{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*\s*$/gm,
  )) {
    if (slugifyAnchor(match[1]) === wanted) return true;
  }
  for (const match of text.matchAll(/(?:\bid|\bname)=["']([^"']+)["']/g)) {
    if (slugifyAnchor(match[1]) === wanted) return true;
  }

  return new RegExp(`\\b${escapeForRegExp(trimmed)}\\b`, "i").test(text);
}

/** Splits `docs/spec.md#dscr` into its path and its optional anchor. */
function splitRepoRef(ref: string): {
  readonly filePath: string;
  readonly anchor: string | null;
} {
  const hashIndex = ref.indexOf("#");
  if (hashIndex < 0) return { filePath: ref.trim(), anchor: null };
  return {
    filePath: ref.slice(0, hashIndex).trim(),
    anchor: ref.slice(hashIndex + 1).trim(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// String-leaf walk over scene.data
// ─────────────────────────────────────────────────────────────────────────────

interface StringLeaf {
  /** Full dotted/indexed path, e.g. `scenes[3].data.items[2]`. */
  readonly path: string;
  /** Nearest named property, e.g. `items`. Drives budget lookup. */
  readonly key: string;
  readonly value: string;
}

interface WalkOutcome {
  readonly leaves: readonly StringLeaf[];
  /** Paths that could not be walked (too deep, or circular). */
  readonly unwalkable: readonly { path: string; reason: string }[];
}

/**
 * Collects every string inside an arbitrary MG-props value, remembering the
 * property name that holds it. Depth-capped and cycle-safe: both conditions are
 * REPORTED rather than skipped, because data the validator cannot walk is data
 * the cache cannot hash.
 *
 * ## Why the cycle set is an ANCESTOR set, not a visited set
 *
 * A value is only circular if it contains ITSELF — i.e. if it appears on the
 * path from the root to the current node. A value that merely appears twice in
 * different branches is a shared reference, and a shared reference is a DAG:
 * `JSON.stringify` expands it into two copies and a cache key hashes fine.
 *
 * This used to be a plain `seen` set that was never unwound, so the second
 * branch to reach a shared node was reported as `data-unwalkable` with the
 * message "circular reference — this data cannot be JSON-serialised". That
 * claim was false, and it was load-bearing: `buildDscrSteps` (element-adapter)
 * deliberately reuses the SAME term nodes across its six reveal steps — the
 * "DSCR" label and the "=" relation are literally one object referenced six
 * times, which is what makes the steps describe one formula being rewritten
 * rather than six unrelated formulas. Every `FormulaReveal` scene therefore
 * failed this format's own render gate, and `FormulaReveal` is the format's
 * signature element (planner.ts: "the format's signature element — the ratio
 * built one term at a time"). Adding to the set on the way down and removing on
 * the way back up keeps true self-containment fatal and lets a DAG through.
 */
function walkStrings(root: unknown, rootPath: string): WalkOutcome {
  const leaves: StringLeaf[] = [];
  const unwalkable: { path: string; reason: string }[] = [];
  /** The objects on the path from the root to the node being visited. */
  const ancestors = new Set<object>();

  const visit = (
    value: unknown,
    currentPath: string,
    key: string,
    depth: number,
  ): void => {
    if (typeof value === "string") {
      leaves.push({ path: currentPath, key, value });
      return;
    }
    if (value === null || typeof value !== "object") return;
    if (ancestors.has(value)) {
      unwalkable.push({
        path: currentPath,
        reason:
          "circular reference — this data cannot be JSON-serialised, so no cache key can be derived from it",
      });
      return;
    }
    if (depth >= MAX_DATA_DEPTH) {
      unwalkable.push({
        path: currentPath,
        reason: `nests deeper than ${MAX_DATA_DEPTH} levels, so its text and colours cannot be verified`,
      });
      return;
    }
    ancestors.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        visit(item, `${currentPath}[${index}]`, key, depth + 1);
      });
    } else {
      for (const [childKey, childValue] of Object.entries(value)) {
        visit(childValue, `${currentPath}.${childKey}`, childKey, depth + 1);
      }
    }
    ancestors.delete(value);
  };

  visit(root, rootPath, "", 0);
  return { leaves, unwalkable };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rules
// ─────────────────────────────────────────────────────────────────────────────

interface SceneRef {
  readonly scene: BusinessHubScene;
  readonly index: number;
  readonly path: string;
}

type Emit = (
  rule: ViolationRule,
  ref: SceneRef | null,
  subPath: string,
  message: string,
  remedy: string,
) => void;

/** Rule 1 — the citation gate (design §8 rule 1). */
function checkSource(ref: SceneRef, probe: RepoSourceProbe, emit: Emit): void {
  const { scene } = ref;

  if (scene.kind === "mg") {
    const claimKind = sourceKindForElement(scene.element);
    if (claimKind === undefined) {
      // DENY BY DEFAULT. `ELEMENT_SOURCE_KIND` is an allowlist of element names
      // known to make a factual claim, and `@repo/contracts` states the
      // consequence of a gap outright: "An element that is ABSENT from this map
      // is treated as carrying no factual claim ... otherwise the citation gate
      // silently does not apply to it." The planner gates its own figure and
      // document beats deny-by-default, so today's planner output is covered —
      // but THIS is the render gate, and it also runs on plans it did not
      // produce (Presenter/Plan Studio, operator-pinned, retried plans). For
      // those, an element that was renamed or newly added would carry a stat, a
      // formula or a quotation past design §8 rule 1 with nothing said. Rule 1
      // is the unauthorised-practice-of-law exposure control; an unrecognised
      // element is a gap in the control, not an exemption from it.
      emit(
        "element-unregistered",
        ref,
        ".element",
        `element "${scene.element}" is not registered in ELEMENT_SOURCE_KIND, so the citation gate (design §8 rule 1) does not know whether it makes a factual claim`,
        `register it in ELEMENT_SOURCE_KIND (packages/contracts/src/schemas/business-hub-scene.ts) with the claim category it displays — stat, formula, quote, comparison or checklist — in the same change that adds the element`,
      );
    } else if (scene.source === undefined) {
      emit(
        "source-missing",
        ref,
        ".source",
        `element "${scene.element}" displays a ${claimKind}, which is a factual claim on screen, but the scene carries no source`,
        `add source: { kind: "repo", ref: "<repo path>#<anchor>" } or { kind: "primary", ref: "<url on ${PRIMARY_SOURCE_DOMAINS.join(" | ")}>" }`,
      );
    }
  }

  const source = scene.source;
  if (source === undefined) return;

  if (!isNonEmptyString(source.ref)) {
    emit(
      "source-unresolved",
      ref,
      ".source.ref",
      "source ref is empty",
      "cite a repo path with an anchor, or an allowlisted primary document",
    );
    return;
  }

  if (source.kind === "primary") {
    if (!isAllowlistedPrimarySource(source.ref)) {
      emit(
        "source-unresolved",
        ref,
        ".source.ref",
        `primary source "${source.ref}" is not on the allowlist`,
        `cite one of ${PRIMARY_SOURCE_DOMAINS.join(", ")}, or restate the claim from an in-repo spec with kind:"repo"`,
      );
    }
    return;
  }

  if (source.kind === "repo") {
    const { filePath, anchor } = splitRepoRef(source.ref);
    if (filePath.length === 0) {
      emit(
        "source-unresolved",
        ref,
        ".source.ref",
        `repo source "${source.ref}" has no file path before its anchor`,
        "write the ref as <repo-relative path>#<anchor>",
      );
      return;
    }
    if (path.isAbsolute(filePath) || filePath.split(/[\\/]/).includes("..")) {
      emit(
        "source-unresolved",
        ref,
        ".source.ref",
        `repo source "${filePath}" is not a repo-relative path (absolute, or escapes the repo root)`,
        "use a path relative to the monorepo root, e.g. docs/superpowers/specs/...md#anchor",
      );
      return;
    }

    const probed = probe.probe(filePath);
    if (!probed.exists) {
      emit(
        "source-unresolved",
        ref,
        ".source.ref",
        `repo source file "${filePath}" does not exist`,
        "cite a file that is actually in the repo, or move the claim to an allowlisted primary source",
      );
      return;
    }
    if (anchor === null) return;
    if (anchor.length === 0) {
      emit(
        "source-unresolved",
        ref,
        ".source.ref",
        `repo source "${source.ref}" ends in a bare "#"`,
        "name the section/symbol after the #, or drop the # entirely",
      );
      return;
    }
    if (probed.text === null) {
      emit(
        "source-unresolved",
        ref,
        ".source.ref",
        `repo source "${filePath}" exists but could not be read as text, so anchor "#${anchor}" cannot be verified`,
        "cite a text file, or drop the anchor and cite the file as a whole",
      );
      return;
    }
    if (!anchorResolvesInText(anchor, probed.text)) {
      emit(
        "source-unresolved",
        ref,
        ".source.ref",
        `anchor "#${anchor}" was not found in "${filePath}" — the heading or symbol it cites has been renamed or removed`,
        "re-point the anchor at a heading, an id/name attribute, an existing symbol, or an in-range #L<line>",
      );
    }
    return;
  }

  const never: never = source.kind;
  emit(
    "source-unresolved",
    ref,
    ".source.kind",
    `unhandled source kind ${String(never)}`,
    'use kind:"repo" or kind:"primary"',
  );
}

/** Rule 2 — the pose/hitbox gate (design §8 rule 2, §6.2). */
function checkPresenter(
  ref: SceneRef,
  poses: readonly Pose[],
  emit: Emit,
): void {
  const { scene } = ref;
  // isRecord rather than `!== undefined`: the schema normalises `null` to
  // `undefined`, but this validator also runs on plans that were never parsed.
  const presenter = scene.presenter;

  if (!isRecord(presenter)) {
    if (scene.kind === "presenter-solo") {
      emit(
        "pose-missing",
        ref,
        ".presenter",
        'scene kind "presenter-solo" is the presenter alone on the mat, but no presenter/pose is set',
        "set presenter: { pose, side } naming a calibrated pose, or change the scene kind",
      );
    }
    return;
  }

  if (!isNonEmptyString(presenter.pose)) {
    emit(
      "pose-missing",
      ref,
      ".presenter.pose",
      "presenter pose slug is empty",
      "name a slug from media/style-assets/presenter/poses/poses.json",
    );
    return;
  }

  const pose = poses.find((candidate) => candidate.slug === presenter.pose);
  if (pose === undefined) {
    const known = poses.map((p) => p.slug).join(", ");
    emit(
      "pose-missing",
      ref,
      ".presenter.pose",
      `pose "${presenter.pose}" is not in the pose manifest (${poses.length} pose${poses.length === 1 ? "" : "s"} known${known.length > 0 ? `: ${known}` : ""})`,
      "use an existing slug, or onboard the pose in the Presenter Studio first",
    );
    return;
  }

  if (pose.anchor_status !== "calibrated") {
    emit(
      "pose-uncalibrated",
      ref,
      ".presenter.pose",
      `pose "${pose.slug}" has anchor_status "${pose.anchor_status}" — its head position, collar width and pointing vector were never authored`,
      "calibrate the pose in the Presenter Studio (task U1); head placement is never guessed",
    );
    return;
  }

  const hitboxes: unknown = pose.hitboxes;
  if (!isRecord(hitboxes)) {
    emit(
      "hitbox-missing",
      ref,
      ".presenter.pose",
      `pose "${pose.slug}" claims anchor_status "calibrated" but carries no hitboxes object`,
      "re-save the pose in the Presenter Studio; a calibrated pose always has a complete hitbox set",
    );
    return;
  }

  const head: unknown = hitboxes.head;
  if (
    !isRecord(head) ||
    !isNormPoint(head.center) ||
    !isFiniteNumber(head.radius) ||
    head.radius <= 0
  ) {
    emit(
      "hitbox-missing",
      ref,
      ".presenter.pose",
      `pose "${pose.slug}" is missing a usable "head" hitbox (needs center {x,y} and radius > 0)`,
      "drag the head hitbox in the Presenter Studio; the head mark and the RMS pump both place off it",
    );
  }

  const collar: unknown = hitboxes.collar;
  if (!isRecord(collar) || !isFiniteNumber(collar.width) || collar.width <= 0) {
    emit(
      "hitbox-missing",
      ref,
      ".presenter.pose",
      `pose "${pose.slug}" is missing a usable "collar" hitbox (needs width > 0)`,
      "author the collar width in the Presenter Studio; it is the apparent-scale normaliser that stops the presenter teleporting between poses",
    );
  }

  // An absent, null or blank `pointsAt` means the scene does not point at
  // anything, so pointOrigin/pointDirection are not required for it.
  if (!isNonEmptyString(presenter.pointsAt)) return;

  if (!isNormPoint(hitboxes.pointOrigin)) {
    emit(
      "hitbox-missing",
      ref,
      ".presenter.pointsAt",
      `scene points at "${presenter.pointsAt}" but pose "${pose.slug}" has no "pointOrigin" hitbox`,
      "author pointOrigin (the hand) in the Presenter Studio, or drop pointsAt from the scene",
    );
  }

  const direction: unknown = hitboxes.pointDirection;
  if (!isNormPoint(direction)) {
    emit(
      "hitbox-missing",
      ref,
      ".presenter.pointsAt",
      `scene points at "${presenter.pointsAt}" but pose "${pose.slug}" has no "pointDirection" hitbox`,
      "author pointDirection in the Presenter Studio, or drop pointsAt from the scene",
    );
    return;
  }
  if (
    isRecord(direction) &&
    isFiniteNumber(direction.x) &&
    isFiniteNumber(direction.y) &&
    Math.hypot(direction.x, direction.y) < 1e-6
  ) {
    emit(
      "hitbox-missing",
      ref,
      ".presenter.pointsAt",
      `pose "${pose.slug}" has a zero-length pointDirection — it points at nothing, and the object rotation it drives would silently be 0 degrees`,
      "re-author pointDirection in the Presenter Studio",
    );
  }
}

/** Rule 3 — visual provenance (design §8 rule 6). */
function checkVisual(ref: SceneRef, emit: Emit): void {
  const { scene } = ref;
  const visual = scene.visual;

  if (visual === undefined) {
    if (scene.kind === "broll") {
      emit(
        "visual-missing",
        ref,
        ".visual",
        'scene kind "broll" has no visual — there is nothing to composite',
        "attach the sourced asset from the visual gateway, or change the scene kind",
      );
    }
    return;
  }

  const record: unknown = visual;
  if (!isRecord(record)) {
    emit(
      "visual-provenance",
      ref,
      ".visual",
      "visual is not an object",
      "attach a full VisualRef from the visual gateway",
    );
    return;
  }

  const required = [
    "provider",
    "assetKey",
    "sourceUrl",
    "licence",
    "retrievedAt",
  ] as const;
  for (const field of required) {
    if (!isNonEmptyString(record[field])) {
      emit(
        "visual-provenance",
        ref,
        `.visual.${field}`,
        `sourced visual is missing "${field}" — unknown provenance is an unbounded liability across hundreds of published videos`,
        "re-fetch through the visual gateway, which tags every asset with provider, sourceUrl, licence and retrievedAt",
      );
    }
  }
}

/** Rules 4 and 5 — text budgets and colour literals. */
function checkTextAndColour(ref: SceneRef, emit: Emit): void {
  const { scene } = ref;

  const budgeted: { path: string; slot: TextBudgetSlot; value: unknown }[] = [
    { path: ".text.headline", slot: "headline", value: scene.text.headline },
    { path: ".text.eyebrow", slot: "eyebrow", value: scene.text.eyebrow },
    { path: ".text.body", slot: "body", value: scene.text.body },
  ];
  for (const entry of budgeted) {
    if (typeof entry.value !== "string") continue;
    const budget = TEXT_BUDGETS[entry.slot];
    if (entry.value.length > budget) {
      emit(
        "text-budget",
        ref,
        entry.path,
        `${entry.slot} is ${entry.value.length} characters, over its ${budget}-character budget: ${JSON.stringify(entry.value)}`,
        `cut it to ${budget} characters — overflow is invisible until the published video is watched`,
      );
    }
  }

  const colourScan: { path: string; value: string }[] = [];
  for (const entry of budgeted) {
    if (typeof entry.value === "string") {
      colourScan.push({ path: entry.path, value: entry.value });
    }
  }
  if (typeof scene.narration === "string") {
    colourScan.push({ path: ".narration", value: scene.narration });
  }
  if (typeof scene.grade === "string") {
    colourScan.push({ path: ".grade", value: scene.grade });
  }

  if (scene.kind === "mg") {
    const walked = walkStrings(scene.data, ".data");
    for (const problem of walked.unwalkable) {
      emit(
        "data-unwalkable",
        ref,
        problem.path,
        `scene data ${problem.reason}`,
        "flatten the MG props; element props are plain JSON",
      );
    }
    for (const leaf of walked.leaves) {
      colourScan.push({ path: leaf.path, value: leaf.value });
      const slot = TEXT_BUDGET_BY_DATA_KEY[leaf.key.toLowerCase()];
      if (slot === undefined) continue;
      const budget = TEXT_BUDGETS[slot];
      if (leaf.value.length > budget) {
        emit(
          "text-budget",
          ref,
          leaf.path,
          `${slot} is ${leaf.value.length} characters, over its ${budget}-character budget: ${JSON.stringify(leaf.value)}`,
          `cut it to ${budget} characters, or move the detail into the narration`,
        );
      }
    }
  }

  for (const candidate of colourScan) {
    const match = HEX_COLOUR_RE.exec(candidate.value);
    if (match !== null) {
      emit(
        "hex-colour",
        ref,
        candidate.path,
        `contains the hex colour literal "${match[0]}" — colour comes from the theme tokens, never from plan data`,
        "remove the literal and let the element read the ocean-palette token (design §3.1); a hard-coded colour cannot follow the inverse ground",
      );
    }
  }
}

/** Rule 7 — every `mg` scene carries a derived cache key. */
function checkCacheKey(ref: SceneRef, emit: Emit): void {
  if (ref.scene.kind !== "mg") return;
  if (isNonEmptyString(ref.scene.cacheKey)) return;
  emit(
    "cache-key",
    ref,
    ".cacheKey",
    'scene kind "mg" has no cacheKey, so its Remotion island cannot be looked up in or written to the segment cache',
    "derive it before validating: sha256(JSON.stringify({element, data, grade, layout, aspect}))",
  );
}

/** Rule 6 — durations positive, contiguous, and summing to the narration. */
function checkTimings(
  plan: BusinessHubPlan,
  ctx: BusinessHubValidationContext,
  refs: readonly SceneRef[],
  emit: Emit,
): void {
  if (
    !isFiniteNumber(ctx.narrationDurationSec) ||
    ctx.narrationDurationSec <= 0
  ) {
    emit(
      "context-invalid",
      null,
      "ctx.narrationDurationSec",
      `narration duration is ${String(ctx.narrationDurationSec)} — the scene timeline cannot be checked against it`,
      "probe the rendered TTS track and pass its measured duration; never estimate it from the word count",
    );
    return;
  }

  const byId = new Map<string, SceneTiming>();
  for (const timing of ctx.sceneTimings) {
    if (!byId.has(timing.sceneId)) byId.set(timing.sceneId, timing);
  }

  const planIds = new Set(plan.scenes.map((scene) => scene.id));
  for (const timing of ctx.sceneTimings) {
    if (!planIds.has(timing.sceneId)) {
      emit(
        "scene-timing",
        null,
        `ctx.sceneTimings[${timing.sceneId}]`,
        `timing references scene "${timing.sceneId}", which is not in the plan`,
        "re-run the timing pass against this plan; a stale timing list means the audio and the scenes disagree",
      );
    }
  }

  let previousEnd: number | null = null;
  let total = 0;
  let sawGap = false;

  for (const ref of refs) {
    const timing = byId.get(ref.scene.id);
    if (timing === undefined) {
      emit(
        "scene-timing",
        ref,
        ".timing",
        "scene has no entry in ctx.sceneTimings, so its duration is unknown",
        "produce one timing per scene from the Whisper-anchored pass; a missing duration is never filled in with an average",
      );
      sawGap = true;
      continue;
    }
    if (!isFiniteNumber(timing.startSec) || !isFiniteNumber(timing.endSec)) {
      emit(
        "scene-timing",
        ref,
        ".timing",
        `timing is not finite (startSec=${String(timing.startSec)}, endSec=${String(timing.endSec)})`,
        "re-run the timing pass",
      );
      sawGap = true;
      continue;
    }
    const duration = timing.endSec - timing.startSec;
    if (duration <= 0) {
      emit(
        "scene-timing",
        ref,
        ".timing",
        `duration is ${duration.toFixed(3)}s (startSec=${timing.startSec}, endSec=${timing.endSec}) — a scene must occupy time`,
        "merge the beat into its neighbour, or give it real narration",
      );
      sawGap = true;
      continue;
    }

    const expectedStart = previousEnd ?? 0;
    if (
      Math.abs(timing.startSec - expectedStart) >
      SCENE_TIMING_CONTIGUITY_TOLERANCE_SEC
    ) {
      emit(
        "scene-timing",
        ref,
        ".timing.startSec",
        `starts at ${timing.startSec.toFixed(3)}s but the previous scene ${previousEnd === null ? "boundary is 0" : `ends at ${previousEnd.toFixed(3)}s`} — a ${(timing.startSec - expectedStart).toFixed(3)}s ${timing.startSec > expectedStart ? "gap" : "overlap"} exceeds the ${SCENE_TIMING_CONTIGUITY_TOLERANCE_SEC}s tolerance`,
        "the scene timeline is contiguous by construction; re-run the timing pass rather than nudging one scene",
      );
      sawGap = true;
    }

    previousEnd = timing.endSec;
    total += duration;
  }

  if (sawGap) return;

  if (
    Math.abs(total - ctx.narrationDurationSec) >
    NARRATION_DURATION_TOLERANCE_SEC
  ) {
    emit(
      "scene-timing",
      null,
      "ctx.sceneTimings",
      `scene durations sum to ${total.toFixed(3)}s but the narration is ${ctx.narrationDurationSec.toFixed(3)}s — a ${(total - ctx.narrationDurationSec).toFixed(3)}s difference, over the ${NARRATION_DURATION_TOLERANCE_SEC}s tolerance`,
      "the video would end before or after the voice does; re-run the timing pass instead of padding the last scene",
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every rule in design §8 that this module owns, run over a whole plan.
 *
 * Pure with respect to its arguments: the only I/O is through
 * `ctx.repoProbe`, which defaults to a real `node:fs` probe rooted at
 * `ctx.repoRoot`. Returns every violation found — it never throws for a bad
 * plan, only {@link validateBusinessHubPlan} does that.
 *
 * @throws nothing. A malformed context is reported as a `context-invalid`
 * violation, not an exception.
 */
export function collectViolations(
  plan: BusinessHubPlan,
  ctx: BusinessHubValidationContext,
): Violation[] {
  const violations: Violation[] = [];
  const emit: Emit = (rule, ref, subPath, message, remedy) => {
    violations.push({
      rule,
      sceneId: ref?.scene.id ?? null,
      beat: ref?.scene.beat ?? null,
      path: ref === null ? subPath : `${ref.path}${subPath}`,
      message,
      remedy,
    });
  };

  if (!isNonEmptyString(ctx.repoRoot)) {
    emit(
      "context-invalid",
      null,
      "ctx.repoRoot",
      "repoRoot is empty, so no repo citation can be resolved",
      "pass the absolute monorepo root",
    );
  }

  const probe = ctx.repoProbe ?? createNodeRepoSourceProbe(ctx.repoRoot);
  const poses = ctx.poses;

  const refs: SceneRef[] = plan.scenes.map((scene, index) => ({
    scene,
    index,
    path: `scenes[${index}]`,
  }));

  for (const ref of refs) {
    checkSource(ref, probe, emit);
    checkPresenter(ref, poses, emit);
    checkVisual(ref, emit);
    checkTextAndColour(ref, emit);
    checkCacheKey(ref, emit);
  }

  checkTimings(plan, ctx, refs, emit);

  return violations;
}

/**
 * The build gate. Runs {@link collectViolations} and, if anything is wrong,
 * throws ONE error listing every violation with its scene id and beat slug.
 *
 * Returns nothing on success — there is no repaired plan to hand back, because
 * this validator never repairs anything.
 *
 * @throws {BusinessHubPlanValidationError} when the plan breaks any rule in
 * design §8. The error carries the full `violations` array.
 */
export function validateBusinessHubPlan(
  plan: BusinessHubPlan,
  ctx: BusinessHubValidationContext,
): void {
  const violations = collectViolations(plan, ctx);
  if (violations.length === 0) return;
  const label = `topic ${JSON.stringify(plan.topic)}, family ${plan.family}, ${plan.scenes.length} scene${plan.scenes.length === 1 ? "" : "s"}`;
  throw new BusinessHubPlanValidationError(violations, label);
}
