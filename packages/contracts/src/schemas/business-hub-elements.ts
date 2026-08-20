import { z } from "zod";

/**
 * BUSINESS_PLAN_HUB — the motion-graphic element-name union.
 *
 * The renderer dispatches `scene.element` through an exhaustive registry
 * (`ELEMENT_REGISTRY` in
 * `apps/worker-render/src/remotion/business-hub/BusinessHubScene.tsx`) and
 * throws on a name it does not implement. The orchestrator's scene planner
 * chooses those names. Those are two different packages, and until this file
 * existed the only thing connecting them was that somebody had typed the same
 * string in both — which is exactly how the planner came to emit
 * `AmortizationChart`, `BreakEvenChart`, `ProjectionChart`, `FeeBreakdown`,
 * `TimelineChart`, `ChecklistReveal` and `DocumentClipping`, none of which the
 * renderer has ever implemented. Five of seven finance figure kinds could not
 * render a frame, and nothing failed until FFmpeg had already been paid for.
 *
 * So the union lives here, in the one package both sides already depend on, and
 * the planner's tables are typed against it: a rename now breaks the build
 * instead of a render.
 *
 * `as const` so {@link BusinessHubMgElementName} stays a literal union and a
 * `Record<BusinessHubMgElementName, T>` is checkable for exhaustiveness.
 *
 * ## Keeping this in step with the renderer
 *
 * This list must equal `BUSINESS_HUB_MG_ELEMENT_NAMES` in
 * `BusinessHubScene.tsx` (M3's twelve elements plus M4's `FormulaReveal`). The
 * renderer still declares its own copy — `apps/worker-render` is an app, not a
 * package, so the orchestrator cannot import from it, and the reverse edit is
 * owned by tasks M3/M5. The two are pinned to each other by a test
 * (`element-adapter.test.ts` → "renderer element registry"), which reads the
 * renderer's source and fails the moment the lists disagree. See
 * `docs/superpowers/handoff/P3.md` for the one-line change that would delete
 * the duplication.
 *
 * Dependency-free beyond zod, like every other schema here: this module is
 * bundled into the Remotion browser build.
 */
export const BUSINESS_HUB_MG_ELEMENT_NAMES = [
  "StatCallout",
  "StatGrid",
  "BarChart",
  "LineChart",
  "PercentageBar",
  "ComparisonTable",
  "TimelineGraphic",
  "ProcessDiagram",
  "QuoteCard",
  "Checklist",
  "PaperClipping",
  "CalloutLabel",
  "FormulaReveal",
] as const;

/** Every element name a `kind: "mg"` scene may carry. */
export type BusinessHubMgElementName =
  (typeof BUSINESS_HUB_MG_ELEMENT_NAMES)[number];

/** Parses/validates an element name at a boundary (DB row, queue payload). */
export const BusinessHubMgElementNameSchema = z.enum(
  BUSINESS_HUB_MG_ELEMENT_NAMES,
);

/**
 * Narrows an arbitrary string to an element the renderer implements.
 *
 * Callers must treat `false` as a build failure naming the offending scene —
 * never as "skip this scene", because a skipped scene leaves the narration
 * talking over the wrong picture.
 */
export function isBusinessHubMgElementName(
  element: unknown,
): element is BusinessHubMgElementName {
  return (
    typeof element === "string" &&
    (BUSINESS_HUB_MG_ELEMENT_NAMES as readonly string[]).includes(element)
  );
}
