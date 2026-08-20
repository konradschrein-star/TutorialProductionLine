/**
 * ONE DISTINCT PLATE PER SCENE.
 *
 * Konrad's note on the 2026-08-16 v2 render was "the same plate repeats about
 * ten times in a row". Two mechanisms produced that, and this file pins the fix
 * to both:
 *
 *  1. Every connective beat asked the image model for essentially the same
 *     thing. A connective beat's slug is the FIRST SEVEN WORDS of its narration
 *     (planner.ts `roleSlugSeed`), which is mostly function words —
 *     "the-plan-builder-we-run-is-trained" describes no picture, so the model
 *     drew its idea of a generic business desk, every time.
 *     `visualSubjectFor` is what stops that.
 *  2. Nothing checked. The gateway deduplicates by content hash across the whole
 *     catalogue — right BETWEEN videos, wrong INSIDE one — and a repeat renders
 *     and reports success. `assertDistinctVisuals` is the gate.
 */

import { describe, expect, it } from "vitest";

import type { BusinessHubScene } from "@repo/contracts";

import {
  BusinessHubPipelineError,
  assertDistinctVisuals,
  visualSubjectFor,
  type SourcedVisual,
} from "../pipeline.js";

const JOB_ID = "job-bph-distinct";

function brollScene(over: {
  id: string;
  beat: string;
  narration: string;
  headline?: string;
}): BusinessHubScene {
  return {
    id: over.id,
    beat: over.beat,
    kind: "broll",
    layout: "broll-defocus",
    text: over.headline === undefined ? {} : { headline: over.headline },
    narration: over.narration,
  } as BusinessHubScene;
}

function sourced(over: {
  sceneId: string;
  beat: string;
  contentHash: string;
  provider?: SourcedVisual["visual"]["provider"];
}): SourcedVisual {
  return {
    sceneId: over.sceneId,
    beat: over.beat,
    visual: {
      provider: over.provider ?? "generated",
      assetKey: `visual-library/objects/ab/${over.contentHash}.png`,
      sourceUrl: `mediagateway:fleet:${over.contentHash}`,
      licence: "generated:in-house",
      retrievedAt: "2026-08-16T12:00:00.000Z",
    },
    posture: "publishable",
    reviewReason: null,
    contentHash: over.contentHash,
    storagePath: `/media/visual-library/objects/ab/${over.contentHash}.png`,
    bytes: 1024,
    mediaKind: "image",
    deduplicated: false,
  };
}

describe("visualSubjectFor", () => {
  it("prefers the beat's authored headline", () => {
    expect(
      visualSubjectFor(
        brollScene({
          id: "s02",
          beat: "the-plan-builder-we-run-is-trained",
          narration: "The plan builder we run is trained on lender packets.",
          headline: "How a lender reads projections",
        }),
      ),
    ).toBe("How a lender reads projections");
  });

  it("drops the function words that made every beat ask for the same picture", () => {
    // This is the exact beat slug from the v2 render.
    const subject = visualSubjectFor(
      brollScene({
        id: "s02",
        beat: "the-plan-builder-we-run-is-trained",
        narration:
          "The plan builder we run is trained on the packets that lenders actually approve.",
      }),
    );
    expect(subject).not.toBeNull();
    for (const stopword of ["the", "we", "is", "that", "on"]) {
      expect(subject!.split(" ")).not.toContain(stopword);
    }
    expect(subject).toContain("plan");
    expect(subject).toContain("lenders");
  });

  it("gives two different beats two different subjects", () => {
    const a = visualSubjectFor(
      brollScene({
        id: "s02",
        beat: "build-revenue-as-average-tickets-per-day",
        narration:
          "Build revenue as average tickets per day multiplied by the basket size.",
      }),
    );
    const b = visualSubjectFor(
      brollScene({
        id: "s03",
        beat: "break-even-equals-fixed-costs-divided-by-unit",
        narration:
          "Break even equals fixed costs divided by the unit contribution margin.",
      }),
    );
    expect(a).not.toBe(b);
  });

  it("does not repeat a word, so eight words describe eight things", () => {
    const subject = visualSubjectFor(
      brollScene({
        id: "s02",
        beat: "ovens",
        narration:
          "Ovens, ovens, ovens. Ovens cost money and ovens need power and ovens need space.",
      }),
    )!;
    const words = subject.split(" ");
    expect(new Set(words).size).toBe(words.length);
  });

  it("falls back to the beat slug when the narration is all function words", () => {
    expect(
      visualSubjectFor(
        brollScene({
          id: "s02",
          beat: "so-it-is",
          narration: "So it is.",
        }),
      ),
    ).toBe("so it is");
  });

  it("returns null — rather than something invented — when nothing is sayable", () => {
    expect(
      visualSubjectFor(
        brollScene({ id: "s02", beat: "", narration: "..." }),
      ),
    ).toBeNull();
  });
});

describe("assertDistinctVisuals", () => {
  it("accepts a plan where every beat carries its own picture", () => {
    expect(() =>
      assertDistinctVisuals(JOB_ID, [
        sourced({ sceneId: "s02", beat: "one", contentHash: "aaa1" }),
        sourced({ sceneId: "s03", beat: "two", contentHash: "bbb2" }),
        sourced({ sceneId: "s04", beat: "three", contentHash: "ccc3" }),
      ]),
    ).not.toThrow();
  });

  it("accepts a plan with no b-roll at all", () => {
    expect(() => assertDistinctVisuals(JOB_ID, [])).not.toThrow();
  });

  it("refuses the v2 failure: one plate serving many scenes", () => {
    expect(() =>
      assertDistinctVisuals(JOB_ID, [
        sourced({ sceneId: "s02", beat: "one", contentHash: "same" }),
        sourced({ sceneId: "s03", beat: "two", contentHash: "same" }),
        sourced({ sceneId: "s04", beat: "three", contentHash: "other" }),
      ]),
    ).toThrow(BusinessHubPipelineError);
  });

  it("names every scene sharing the plate, so the report is actionable", () => {
    let message = "";
    try {
      assertDistinctVisuals(JOB_ID, [
        sourced({ sceneId: "s02", beat: "revenue-build", contentHash: "same" }),
        sourced({ sceneId: "s07", beat: "break-even", contentHash: "same" }),
      ]);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("s02");
    expect(message).toContain("s07");
    expect(message).toContain("revenue-build");
    expect(message).toContain("break-even");
  });

  it("catches a repeat regardless of which provider served it", () => {
    expect(() =>
      assertDistinctVisuals(JOB_ID, [
        sourced({ sceneId: "s02", beat: "one", contentHash: "same", provider: "pexels" }),
        sourced({ sceneId: "s03", beat: "two", contentHash: "same", provider: "pexels" }),
      ]),
    ).toThrow(BusinessHubPipelineError);
  });
});
