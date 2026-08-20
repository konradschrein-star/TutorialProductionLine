import { describe, expect, it } from "vitest";

import { BusinessHubPlanSchema, type BusinessHubPlan } from "@repo/contracts";
import type { PlateSet } from "@repo/media-core";

import {
  BusinessHubPipelineError,
  buildRenderEnvelopeMetadata,
  computeSceneTimelines,
  type BusinessHubSceneTimelineAxis,
} from "../pipeline.js";

/**
 * The gap this file exists to keep closed.
 *
 * BUSINESS_PLAN_HUB could not render a single frame because the asset stage
 * never wrote `metadata.business_hub.assets` (nothing baked the plates) and
 * never wrote `metadata.business_hub.timelines` (nothing derived the axes). The
 * render refuses both absences by design, at business-hub.ts:736 and :584.
 *
 * A test that asserted on a hand-written "expected envelope" would re-encode my
 * own reading of the contract and would have passed on the day the format was
 * broken. So this file does the one check that cannot be self-satisfying: it
 * builds a plan, runs the REAL producers, and feeds the result to the REAL
 * consumer — `parseBusinessHubEnvelope`, the exported parser in the render
 * workflow that actually decides whether a job renders. Cross-app import is
 * deliberate; it is the only way the two halves are tested against each other
 * rather than against a mock of each other.
 */
import { parseBusinessHubEnvelope } from "../../../../../worker-render/src/workflows/business-hub.js";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const JOB_ID = "job-bph-envelope";

/** A repo citation — a timeline makes a claim on screen, so it needs one. */
const SPEC_SOURCE = {
  kind: "repo" as const,
  ref: "docs/specs/dscr.md#why-1-25-is-the-number",
};

/**
 * A four-scene plan covering every branch the envelope touches: a title on the
 * default mat, a `timeline-walk` motion graphic with a presenter standing at a
 * data coordinate, a chapter break on the inverse mat, and a b-roll scene.
 */
function makePlan(): BusinessHubPlan {
  const plan = {
    topic: "SBA 7(a) debt service coverage",
    family: "mechanism" as const,
    targetSeconds: 900,
    scenes: [
      {
        id: "s01",
        beat: "cold-open",
        kind: "title" as const,
        layout: "clipping" as const,
        grade: "ground-default",
        text: { headline: "What the lender actually checks" },
        narration: "Every SBA lender runs the same coverage test.",
      },
      {
        id: "s02",
        beat: "coverage-over-time",
        kind: "mg" as const,
        layout: "timeline-walk" as const,
        grade: "ground-default",
        element: "TimelineGraphic",
        // TimelineGraphic's props ARE the axis: it draws one marker per event,
        // evenly spaced by index (see its own source — these are sequence
        // timelines, not date-scaled ones).
        data: {
          events: [
            { marker: "2022", label: "Ratio 1.10" },
            { marker: "2023", label: "Ratio 1.18" },
            { marker: "2024", label: "Ratio 1.25" },
            { marker: "2025", label: "Ratio 1.40" },
          ],
        },
        source: SPEC_SOURCE,
        presenter: {
          pose: "holding-pointer",
          side: "left" as const,
          pointsAt: "point-2",
        },
        text: { eyebrow: "Coverage ratio" },
        narration: "By 2024 the ratio clears the 1.25 threshold.",
      },
      {
        id: "s03",
        beat: "chapter-two",
        kind: "chapter" as const,
        layout: "paper-stack" as const,
        grade: "ground-inverse",
        text: { headline: "Where the number comes from" },
        narration: "Now the derivation.",
      },
      {
        id: "s04",
        beat: "storefront-broll",
        kind: "broll" as const,
        layout: "broll-defocus" as const,
        grade: "ground-default",
        text: { body: "Main Street, 7am." },
        narration: "These are the businesses being underwritten.",
      },
    ],
  };

  // Asserting the fixture against the real schema keeps these tests from
  // drifting into validating a plan shape the contracts would reject.
  return BusinessHubPlanSchema.parse(plan);
}

/** A plate set in the shape `bakePlates` returns — absolute paths, nothing optional missing. */
function makePlates(): PlateSet {
  return {
    groundPlates: {
      "ground-default": "/media/plates/ground-default.png",
      "ground-inverse": "/media/plates/ground-inverse.png",
    },
    watermarkPngPath: "/media/plates/watermark.png",
    textPlates: {
      s01: "/media/plates/s01-copy.png",
      s03: "/media/plates/s03-copy.png",
      s04: "/media/plates/s04-copy.png",
    },
    presenter: {
      poses: [{ slug: "holding-pointer", anchor_status: "calibrated" }],
      posePngDir: "/media/style-assets/presenter/poses",
      headMarkPngPath: "/media/plates/head-mark.png",
      placement: { targetCollarPx: 320, bottomAnchor: 0.02, sideInset: 0.06 },
      headLiftPx: 18,
    },
  };
}

/** Whisper-anchored frame boundaries, one per scene, in plan order. */
const TIMINGS = [
  { sceneId: "s01", startFrame: 0, endFrame: 120 },
  { sceneId: "s02", startFrame: 120, endFrame: 450 },
  { sceneId: "s03", startFrame: 450, endFrame: 540 },
  { sceneId: "s04", startFrame: 540, endFrame: 700 },
];

/**
 * Wrap a metadata slice in the `content_jobs` row shape the render parser reads.
 * The parser only touches `id` and `metadata`; the rest is the real column set.
 */
function jobWith(hub: unknown) {
  return {
    id: JOB_ID,
    channel_id: "chan-1",
    format: "BUSINESS_PLAN_HUB",
    title: "SBA 7(a) debt service coverage",
    initial_topic: null,
    script: null,
    language: "en",
    metadata: { business_hub: hub },
    r2_asset_manifest: [],
    assembly_manifest: null,
  };
}

/** The envelope the asset stage writes, built by the real producers. */
function buildEnvelope(
  plan: BusinessHubPlan,
  overrides?: { timelines?: Record<string, BusinessHubSceneTimelineAxis> },
) {
  return buildRenderEnvelopeMetadata({
    plan,
    aspect: "16:9",
    presenterMode: "suit",
    groundTheme: "ground-default",
    timings: TIMINGS,
    plates: makePlates(),
    timelines: overrides?.timelines ?? computeSceneTimelines(JOB_ID, plan),
    figureIds: ["dscr-2024"],
    visualsNeedingReview: [
      { sceneId: "s04", reason: "google result, licence unverified" },
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The end-to-end contract
// ─────────────────────────────────────────────────────────────────────────────

describe("the asset stage writes an envelope the render accepts", () => {
  it("satisfies parseBusinessHubEnvelope end to end", () => {
    const plan = makePlan();

    const parsed = parseBusinessHubEnvelope(jobWith(buildEnvelope(plan)));

    expect(parsed.aspect).toBe("16:9");
    expect(parsed.plan.scenes.map((s) => s.id)).toEqual([
      "s01",
      "s02",
      "s03",
      "s04",
    ]);
    // durationFrames is derived from the frame boundaries, not copied.
    expect(parsed.timings).toEqual([
      { sceneId: "s01", durationFrames: 120 },
      { sceneId: "s02", durationFrames: 330 },
      { sceneId: "s03", durationFrames: 90 },
      { sceneId: "s04", durationFrames: 160 },
    ]);
  });

  it("carries the assets the render used to throw for at business-hub.ts:736", () => {
    const parsed = parseBusinessHubEnvelope(jobWith(buildEnvelope(makePlan())));

    expect(parsed.assets.groundPlates["ground-default"]).toBe(
      "/media/plates/ground-default.png",
    );
    expect(parsed.assets.groundPlates["ground-inverse"]).toBe(
      "/media/plates/ground-inverse.png",
    );
    expect(parsed.assets.watermarkPngPath).toBe("/media/plates/watermark.png");
    // Keyed by SCENE ID, and only for non-mg scenes that carry copy — s02 is an
    // mg scene and typesets itself inside Remotion.
    expect(Object.keys(parsed.assets.textPlates).sort()).toEqual([
      "s01",
      "s03",
      "s04",
    ]);
    expect(parsed.assets.presenter).not.toBeNull();
    expect(parsed.assets.presenter?.placement.targetCollarPx).toBe(320);
    expect(parsed.assets.presenter?.headMarkPngPath).toBe(
      "/media/plates/head-mark.png",
    );
  });

  it("carries axis data for the timeline-walk scene the render used to reject", () => {
    const parsed = parseBusinessHubEnvelope(jobWith(buildEnvelope(makePlan())));

    const axis = parsed.timelines["s02"];
    expect(axis).toBeDefined();
    // One tick per event, at the event's index — exactly where the element puts
    // its marker (i / (count - 1) of the axis).
    expect(axis?.ticks).toEqual([
      { value: 0, label: "2022" },
      { value: 1, label: "2023" },
      { value: 2, label: "2024" },
      { value: 3, label: "2025" },
    ]);
    expect(axis?.domain).toEqual({ min: 0, max: 3 });
    // pointsAt "point-2" is the third marker.
    expect(axis?.presenterValue).toBe(2);
    // Only timeline-walk scenes get an entry.
    expect(Object.keys(parsed.timelines)).toEqual(["s02"]);
  });

  it("maps visuals_needing_review into the key the render reads", () => {
    const parsed = parseBusinessHubEnvelope(jobWith(buildEnvelope(makePlan())));

    expect(parsed.visualsNeedingReview).toEqual([
      { sceneId: "s04", reason: "google result, licence unverified" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The checks stay closed
// ─────────────────────────────────────────────────────────────────────────────

describe("the render still refuses an envelope that is missing a piece", () => {
  it("throws when assets is absent, naming the four keys it needs", () => {
    const envelope = buildEnvelope(makePlan());
    delete envelope["assets"];

    expect(() => parseBusinessHubEnvelope(jobWith(envelope))).toThrow(
      /assets is missing.*groundPlates.*watermarkPngPath.*textPlates.*presenter/s,
    );
  });

  it("throws when the timeline-walk scene has no axis, naming the scene", () => {
    const envelope = buildEnvelope(makePlan(), { timelines: {} });

    expect(() => parseBusinessHubEnvelope(jobWith(envelope))).toThrow(
      /s02 \(coverage-over-time\)/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Axis derivation — derived, never invented
// ─────────────────────────────────────────────────────────────────────────────

/** Swap scene s02's fields to exercise one axis branch at a time. */
function planWithS02(patch: Record<string, unknown>): BusinessHubPlan {
  const plan = makePlan();
  const scenes = plan.scenes.map((scene) =>
    scene.id === "s02" ? { ...scene, ...patch } : scene,
  );
  return BusinessHubPlanSchema.parse({ ...plan, scenes });
}

describe("timeline axes are derived from the scene's own events", () => {
  it("labels each tick with the event's marker, whatever it says", () => {
    const plan = planWithS02({
      data: {
        events: [
          { marker: "Application", label: "Filed" },
          { marker: "Underwriting", label: "Credit memo" },
          { marker: "Close", label: "Funds move" },
        ],
      },
      presenter: { pose: "holding-pointer", side: "left", pointsAt: "point-0" },
    });

    const axis = computeSceneTimelines(JOB_ID, plan)["s02"];

    expect(axis?.ticks).toEqual([
      { value: 0, label: "Application" },
      { value: 1, label: "Underwriting" },
      { value: 2, label: "Close" },
    ]);
    expect(axis?.domain).toEqual({ min: 0, max: 2 });
    expect(axis?.presenterValue).toBe(0);
  });

  it("does not read a numeric marker as a coordinate", () => {
    // The element spaces markers evenly by index, so 2022/2023/2030 is still
    // three evenly spaced dots. Ticks at 2022/2023/2030 would put every label
    // somewhere the element drew nothing.
    const plan = planWithS02({
      data: {
        events: [
          { marker: "2022", label: "Ratio 1.10" },
          { marker: "2023", label: "Ratio 1.18" },
          { marker: "2030", label: "Ratio 1.40" },
        ],
      },
      presenter: { pose: "holding-pointer", side: "left", pointsAt: "point-1" },
    });

    const axis = computeSceneTimelines(JOB_ID, plan)["s02"];

    expect(axis?.ticks.map((t) => t.value)).toEqual([0, 1, 2]);
    expect(axis?.presenterValue).toBe(1);
  });

  it("omits presenterValue when the scene places no presenter", () => {
    const plan = planWithS02({ presenter: undefined });

    const axis = computeSceneTimelines(JOB_ID, plan)["s02"];

    expect(axis?.presenterValue).toBeUndefined();
    expect(axis?.ticks).toHaveLength(4);
  });

  it("throws rather than invent ticks when the events are absent", () => {
    const plan = planWithS02({ data: { not: "a timeline" } });

    expect(() => computeSceneTimelines(JOB_ID, plan)).toThrow(
      BusinessHubPipelineError,
    );
    expect(() => computeSceneTimelines(JOB_ID, plan)).toThrow(
      /scene "s02" \(coverage-over-time\) uses the timeline-walk layout but its props carry no "events" array/,
    );
  });

  it("throws when the axis has a single event and therefore no extent", () => {
    const plan = planWithS02({
      data: { events: [{ marker: "2024", label: "Ratio 1.25" }] },
      presenter: { pose: "holding-pointer", side: "left", pointsAt: "point-0" },
    });

    expect(() => computeSceneTimelines(JOB_ID, plan)).toThrow(
      /has 1 event\(s\)/,
    );
  });

  it("throws when an event marker is blank", () => {
    const plan = planWithS02({
      data: {
        events: [
          { marker: "2024", label: "Ratio 1.25" },
          { marker: "   ", label: "Ratio 1.40" },
        ],
      },
      presenter: { pose: "holding-pointer", side: "left", pointsAt: "point-0" },
    });

    expect(() => computeSceneTimelines(JOB_ID, plan)).toThrow(
      /events\[1\]\.marker is/,
    );
  });

  it("throws when the presenter stands on the axis but names no pointsAt", () => {
    const plan = planWithS02({
      presenter: { pose: "holding-pointer", side: "left" },
    });

    expect(() => computeSceneTimelines(JOB_ID, plan)).toThrow(
      /places the presenter on a timeline-walk axis but names no pointsAt/,
    );
  });

  it("throws when pointsAt runs off the end of the series", () => {
    const plan = planWithS02({
      presenter: { pose: "holding-pointer", side: "left", pointsAt: "point-9" },
    });

    expect(() => computeSceneTimelines(JOB_ID, plan)).toThrow(
      /but the timeline has only 4 events \(0\.\.3\)/,
    );
  });

  it("is a no-op for a plan that uses no timeline-walk layout", () => {
    const plan = makePlan();
    const withoutWalk = BusinessHubPlanSchema.parse({
      ...plan,
      scenes: plan.scenes.filter((scene) => scene.layout !== "timeline-walk"),
    });

    expect(computeSceneTimelines(JOB_ID, withoutWalk)).toEqual({});
  });
});
