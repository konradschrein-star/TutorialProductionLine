import { z } from "zod";

/**
 * BUSINESS_PLAN_HUB — scene plan contracts.
 *
 * Implements section 4 of `docs/superpowers/specs/2026-08-15-business-plan-hub-BUILD-BRIEF.md`.
 * Dependency-free beyond zod on purpose: these schemas are bundled into the
 * Remotion browser build, so nothing here may reach for `node:*`, the DB, or
 * any app-layer helper.
 *
 * Fail-closed is the whole point of this file. Every rule below rejects rather
 * than substituting a default — a scene that cannot be validated is a build
 * failure, never a placeholder.
 */

// ─────────────────────────────────────────────────────────────────────────────
// LLM tolerance helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An OPTIONAL string on a field an LLM fills in directly.
 *
 * Same reasoning as `llmOptionalString()` in `ranking-metadata.ts`: a model
 * asked for an object with an optional field emits `"eyebrow": null` at least
 * as often as it omits the key, and both are ordinary JSON for "there isn't
 * one". Null is normalised to `undefined` so consumers keep a two-state field.
 *
 * This is NOT a synthetic fallback — it invents no value. A field that is
 * genuinely REQUIRED must never use it.
 */
const llmOptionalString = () =>
  z
    .string()
    .nullish()
    .transform((v) => v ?? undefined);

/**
 * The object-valued equivalent of {@link llmOptionalString}: accepts the key
 * being absent or explicitly `null`, and normalises `null` to `undefined`.
 * Used for `presenter`, which the build brief types as `{...} | null`.
 */
const llmOptional = <T extends z.ZodTypeAny>(schema: T) =>
  schema.nullish().transform((v) => v ?? undefined);

/**
 * A REQUIRED field whose value is deliberately untyped (`unknown`).
 *
 * `z.unknown()` accepts `undefined`, so a bare `z.object({ data: z.unknown() })`
 * happily parses `{}` — which would let an `mg` scene through with no props at
 * all and fail hours later inside a Remotion render. This wrapper makes absence
 * an explicit parse error while keeping the value untyped.
 */
const requiredUnknown = (message: string) =>
  z.unknown().superRefine((value, ctx) => {
    if (value === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What renders a scene — NOT what it looks like. `mg` goes to Remotion (cached
 * by content hash); everything else is composited by FFmpeg with no browser.
 * The planner is oblivious to this; the compositor routes on it.
 */
export const SceneKindSchema = z.enum([
  "mg",
  "broll",
  "title",
  "chapter",
  "presenter-solo",
]);
export type SceneKind = z.infer<typeof SceneKindSchema>;

/** The nine layouts of the format's visual vocabulary (design §3.2). */
export const LayoutSchema = z.enum([
  "clipping",
  "framed-chart",
  "paper-stack",
  "card-grid",
  "timeline-walk",
  "projection-room",
  "broll-defocus",
  "studio-set",
  "presenter-solo",
]);
export type Layout = z.infer<typeof LayoutSchema>;

/** Video families from design §2. Drives script shape and target length. */
export const BusinessHubFamilySchema = z.enum([
  "how-to-write-for",
  "what-they-check",
  "mechanism",
  "teardown",
  "flagship-walkthrough",
]);
export type BusinessHubFamily = z.infer<typeof BusinessHubFamilySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// SourceRef — the fail-closed citation gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ONLY domains a `kind: "primary"` source may cite. SBA and EB-5 claims sit
 * next to unauthorised-practice-of-law exposure; this allowlist is the control
 * (design §8 rule 1). Widening it is a product decision, not a code cleanup.
 */
export const PRIMARY_SOURCE_DOMAINS = [
  "uscis.gov",
  "sba.gov",
  "govinfo.gov",
  "ecfr.gov",
  "federalregister.gov",
  "irs.gov",
] as const;
export type PrimarySourceDomain = (typeof PRIMARY_SOURCE_DOMAINS)[number];

/**
 * Extracts the lowercase host from a source ref, tolerating both a full URL
 * (`https://www.sba.gov/x`) and the bare form the script writer tends to emit
 * (`sba.gov/sop-50-10-7#dscr`). Returns `undefined` when no host can be read,
 * which the caller must treat as a rejection — never as "assume it's fine".
 */
export function extractSourceHost(ref: string): string | undefined {
  const withoutScheme = ref.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const hostPart = withoutScheme.split(/[/?#]/, 1)[0] ?? "";
  const host = hostPart.split("@").pop() ?? "";
  const withoutPort = host.split(":", 1)[0] ?? "";
  const normalised = withoutPort.trim().toLowerCase().replace(/\.$/, "");
  if (normalised.length === 0 || !normalised.includes(".")) return undefined;
  return normalised.startsWith("www.") ? normalised.slice(4) : normalised;
}

/**
 * True when `ref` points at an allowlisted primary source (exact host or a
 * subdomain of one). Everything else is false — there is no "probably fine".
 */
export function isAllowlistedPrimarySource(ref: string): boolean {
  const host = extractSourceHost(ref);
  if (host === undefined) return false;
  return PRIMARY_SOURCE_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/**
 * Where a claim comes from: an in-repo spec (`repo`) or an allowlisted
 * government primary source (`primary`). Rejects a `primary` ref on any other
 * domain, and rejects a `repo` ref that is actually a URL.
 */
export const SourceRefSchema = z
  .object({
    kind: z.enum(["repo", "primary"]),
    /** Repo path with optional `#anchor`, or a URL on the primary allowlist. */
    ref: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "primary") {
      if (!isAllowlistedPrimarySource(value.ref)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ref"],
          message:
            `primary source "${value.ref}" is not on the allowlist ` +
            `(${PRIMARY_SOURCE_DOMAINS.join(", ")}). Cite the government ` +
            `primary document, or use kind:"repo" for an in-repo spec.`,
        });
      }
      return;
    }
    if (value.kind === "repo") {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value.ref)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ref"],
          message:
            `repo source "${value.ref}" looks like a URL. Use ` +
            `kind:"primary" for external citations; kind:"repo" takes a ` +
            `repo-relative path with an optional #anchor.`,
        });
      }
      return;
    }
    const never: never = value.kind;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `unhandled source kind ${String(never)}`,
    });
  });
export type SourceRef = z.infer<typeof SourceRefSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// VisualRef — the fail-closed provenance gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A sourced or generated visual. **Every field is required** (design §8 rule 6):
 * a published asset of unknown provenance is an unbounded liability across
 * hundreds of videos, so an incomplete `VisualRef` fails the build instead of
 * shipping with a blank licence.
 */
export const VisualRefSchema = z.object({
  provider: z.enum(["generated", "pexels", "wikimedia", "google", "web"]),
  /** Content-addressed key in the local media store / clip library. */
  assetKey: z.string().min(1),
  /** Where it came from. For `generated`, the gateway request URI. */
  sourceUrl: z.string().min(1),
  /** Licence identifier or full licence text. Never blank, never "unknown". */
  licence: z.string().min(1),
  /** ISO-8601 timestamp of retrieval/generation. */
  retrievedAt: z.string().datetime({ offset: true }),
});
export type VisualRef = z.infer<typeof VisualRefSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Element → source-requirement registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Element categories that MUST carry a `source` (design §8 rule 1). A stat, a
 * formula, a quote, a comparison or a checklist is a factual claim on screen.
 */
export const SOURCED_ELEMENT_KINDS = [
  "stat",
  "formula",
  "quote",
  "comparison",
  "checklist",
] as const;
export type SourcedElementKind = (typeof SOURCED_ELEMENT_KINDS)[number];

/** `"FormulaReveal"` → `"formulareveal"`. Keys below are pre-normalised. */
const normaliseElementName = (element: string): string =>
  element.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Maps a motion-graphic element name to the claim category it displays.
 *
 * An element that is ABSENT from this map is treated as carrying no factual
 * claim and therefore needs no source. When you add an MG element that shows a
 * number, a formula, a quotation, a comparison or a requirement list, register
 * it here in the same change — otherwise the citation gate silently does not
 * apply to it. (Contracts is owned by task F2; file a
 * `docs/superpowers/handoff/<id>.md` note to get an entry added.)
 */
export const ELEMENT_SOURCE_KIND: Readonly<Record<string, SourcedElementKind>> =
  {
    // bare category names, so a planner may emit the kind directly
    stat: "stat",
    formula: "formula",
    quote: "quote",
    comparison: "comparison",
    checklist: "checklist",
    // stat
    statcard: "stat",
    statgrid: "stat",
    statblock: "stat",
    bignumber: "stat",
    keystat: "stat",
    metriccallout: "stat",
    // formula
    formulareveal: "formula",
    formulabuild: "formula",
    derivation: "formula",
    dscrformula: "formula",
    // quote
    quotecard: "quote",
    pullquote: "quote",
    regulationquote: "quote",
    // comparison
    comparisontable: "comparison",
    sidebyside: "comparison",
    versustable: "comparison",
    // checklist
    checklistreveal: "checklist",
    requirementchecklist: "checklist",
    documentchecklist: "checklist",

    // ── The elements that actually shipped ────────────────────────────────
    // Registered 2026-08-15 (INT) on the strength of M3.md §1, O1.md §4 and
    // O4.md §6: every name below draws a number, a quotation or a stated
    // sequence, and without an entry here BusinessHubSceneSchema lets the
    // scene through with no citation and design §8 rule 1 silently does not
    // apply to it. Two families are covered:
    //
    //  (a) the twelve elements implemented in
    //      apps/worker-render/src/remotion/business-hub/elements/, and
    //  (b) legacy planner-side names that no longer reach a plan.
    //
    // (b) needs explaining, because the obvious reading is that it is dead
    // weight. It is not. Those names were emitted by the planner's
    // FIGURE_ELEMENT until 2026-08-16, when the two sets were reconciled and
    // FIGURE_ELEMENT was typed against the renderer's element union so a
    // divergence now breaks the build rather than surfacing at render time.
    // (An earlier revision of this comment said the sets "DO NOT AGREE yet"
    // and pointed at docs/superpowers/handoff/INT.md. That is no longer true.)
    //
    // They stay registered anyway, deliberately: this table is deny-by-default,
    // and a scene whose element is ABSENT from it is treated as claim-free and
    // skips the citation gate entirely. A hand-authored or LLM-authored plan
    // naming one of these would otherwise slip an uncited statistic past
    // design §8 rule 1. Keeping a stale name costs one map entry; dropping one
    // opens a silent hole. Never prune this table to "clean it up".
    //
    // TimelineGraphic / ProcessDiagram are filed as `checklist` ("a list of
    // things that are required, in order"). M3 offered a sixth `process`
    // category; the category only shapes the validator's diagnostic wording,
    // and widening SourcedElementKind for two elements was not worth the
    // ripple through O2's messages.
    statcallout: "stat",
    barchart: "stat",
    linechart: "stat",
    percentagebar: "stat",
    calloutlabel: "stat",
    timelinegraphic: "checklist",
    processdiagram: "checklist",
    paperclipping: "quote",
    // Planner-side element names.
    amortizationchart: "stat",
    breakevenchart: "stat",
    projectionchart: "stat",
    timelinechart: "stat",
    feebreakdown: "stat",
    documentclipping: "quote",
    // O4.md §6: the writer's SOP tells the model that worked examples cite a
    // finance-kit path, so a table of amortization rows or a DSCR derivation is
    // claim-bearing under either name. Nothing renders these yet; the entries
    // exist so a script that names them cannot bypass the gate.
    amortizationtable: "stat",
    dscrtable: "stat",
  };

/**
 * The claim category an element displays, or `undefined` when the element is
 * not registered as making a factual claim.
 */
export function sourceKindForElement(
  element: string,
): SourcedElementKind | undefined {
  return ELEMENT_SOURCE_KIND[normaliseElementName(element)];
}

/** True when a scene using this element must carry a `source`. */
export function requiresSource(element: string): boolean {
  return sourceKindForElement(element) !== undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene
// ─────────────────────────────────────────────────────────────────────────────

/** Headline budget at 1080p (design §6). Longer headlines fail at build. */
export const HEADLINE_MAX_CHARS = 68;

/**
 * The presenter layer on a scene. `pose` is a slug in
 * `media/style-assets/presenter/poses/poses.json`; `pointsAt` names an element
 * sub-id and drives the object's rotation in `framed-chart`.
 */
export const ScenePresenterSchema = z.object({
  pose: z.string().min(1),
  side: z.enum(["left", "right", "center"]),
  pointsAt: llmOptionalString(),
});
export type ScenePresenter = z.infer<typeof ScenePresenterSchema>;

/** Copy shown on the scene. All three slots are optional; headline is budgeted. */
export const SceneTextSchema = z.object({
  headline: z
    .string()
    .max(
      HEADLINE_MAX_CHARS,
      `headline exceeds the ${HEADLINE_MAX_CHARS}-character budget; it will overflow at 1080p`,
    )
    .nullish()
    .transform((v) => v ?? undefined),
  eyebrow: llmOptionalString(),
  body: llmOptionalString(),
});
export type SceneText = z.infer<typeof SceneTextSchema>;

/** Fields every scene carries regardless of `kind`. */
const sceneCommonShape = {
  /** Stable within a plan, e.g. `"s07"`. */
  id: z.string().min(1),
  /** Stable kebab-case slug — feeds the segment cache key and debug output. */
  beat: z
    .string()
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "beat must be a kebab-case slug (lowercase, digits, single hyphens) — it is used in cache keys and filenames",
    ),
  layout: LayoutSchema,
  text: SceneTextSchema,
  /** Sourced/generated asset. Required on `broll` at the render gate (task O2). */
  visual: VisualRefSchema.optional(),
  presenter: llmOptional(ScenePresenterSchema),
  grade: llmOptional(z.string().min(1)),
  /** Citation. REQUIRED for stat/formula/quote/comparison/checklist elements. */
  source: SourceRefSchema.optional(),
  /** The sentences spoken over this scene. */
  narration: z.string(),
  /**
   * `sha256(JSON.stringify({element, data, grade, layout, aspect}))`.
   * DERIVED by the segment cache — never authored by the planner or the LLM.
   */
  cacheKey: z.string().optional(),
} as const;

/** Remotion-rendered motion-graphic island. `element` + `data` are mandatory. */
export const MgSceneSchema = z.object({
  ...sceneCommonShape,
  kind: z.literal("mg"),
  /** MG component name, e.g. `"FormulaReveal"`. */
  element: z.string().min(1),
  /**
   * MG props. Comes from `@repo/finance-kit` or a sourced fact — NEVER invented
   * by the model. Untyped here because each element owns its own prop shape;
   * the element validates its own props at render time.
   */
  data: requiredUnknown(
    'scene kind "mg" requires `data` (the MG element props, from finance-kit or a sourced fact) — a motion-graphic scene with no props cannot render',
  ),
});

/** Footage/photo scene. FFmpeg-composited, no browser. */
export const BrollSceneSchema = z.object({
  ...sceneCommonShape,
  kind: z.literal("broll"),
});

/** Opening/segment title card. */
export const TitleSceneSchema = z.object({
  ...sceneCommonShape,
  kind: z.literal("title"),
});

/** Chapter break — typically the inverse (near-white) ground. */
export const ChapterSceneSchema = z.object({
  ...sceneCommonShape,
  kind: z.literal("chapter"),
});

/** Presenter alone on the mat, cropped by the frame edge. */
export const PresenterSoloSceneSchema = z.object({
  ...sceneCommonShape,
  kind: z.literal("presenter-solo"),
});

/**
 * One scene of the plan.
 *
 * Two gates beyond field validation:
 *  1. `kind: "mg"` must carry `element` and `data` (discriminated union above).
 *  2. An element that displays a stat, formula, quote, comparison or checklist
 *     must carry `source` (design §8 rule 1).
 */
export const BusinessHubSceneSchema = z
  .discriminatedUnion("kind", [
    MgSceneSchema,
    BrollSceneSchema,
    TitleSceneSchema,
    ChapterSceneSchema,
    PresenterSoloSceneSchema,
  ])
  .superRefine((scene, ctx) => {
    if (scene.kind !== "mg") return;
    const claimKind = sourceKindForElement(scene.element);
    if (claimKind !== undefined && scene.source === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source"],
        message:
          `scene "${scene.id}" (${scene.beat}) uses element "${scene.element}", ` +
          `which displays a ${claimKind} and therefore requires a source. ` +
          `Add source: { kind: "repo" | "primary", ref } citing an in-repo ` +
          `spec or an allowlisted primary document ` +
          `(${PRIMARY_SOURCE_DOMAINS.join(", ")}).`,
      });
    }
  });
export type BusinessHubScene = z.infer<typeof BusinessHubSceneSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Plan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The full scene plan for one BUSINESS_PLAN_HUB video: the ordered scene list
 * plus the job-level facts the planner and render both need.
 *
 * Scene ids must be unique — duplicates would collide in the segment cache and
 * in every diagnostic that names a scene, so they are rejected here rather than
 * silently deduplicated.
 */
export const BusinessHubPlanSchema = z
  .object({
    scenes: z.array(BusinessHubSceneSchema).min(1),
    /** The keyword/topic this video answers. */
    topic: z.string().min(1),
    family: BusinessHubFamilySchema,
    /** Target runtime in seconds (15 min default = 900). */
    targetSeconds: z.number().positive().finite(),
  })
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    plan.scenes.forEach((scene, index) => {
      if (seen.has(scene.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenes", index, "id"],
          message: `duplicate scene id "${scene.id}" — scene ids must be unique within a plan`,
        });
      }
      seen.add(scene.id);
    });
  });
export type BusinessHubPlan = z.infer<typeof BusinessHubPlanSchema>;
