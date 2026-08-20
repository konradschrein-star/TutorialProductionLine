/**
 * The inputs the asset stage hands `bakePlates`.
 *
 * `bakePlates` itself (packages/media-core/src/plates/) is tested there and
 * drives Chromium; what this file pins is the part the pipeline owns — the mat
 * the video is baked for, and the refusal to place the presenter with geometry
 * nobody authored. Both are fail-closed rules with no default behind them.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BusinessHubPlanSchema, PoseManifestSchema } from "@repo/contracts";
import type { BusinessHubPlan } from "@repo/contracts";

import {
  BusinessHubPipelineError,
  resolveJobGroundTheme,
  resolvePresenterPlateInput,
} from "../pipeline.js";

const JOB_ID = "job-bph-plates";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../..",
);

/** The real, uncalibrated manifest the workers read at run time. */
const POSES = PoseManifestSchema.parse(
  JSON.parse(
    readFileSync(
      path.join(
        REPO_ROOT,
        "media",
        "style-assets",
        "presenter",
        "poses",
        "poses.json",
      ),
      "utf8",
    ),
  ),
);

function makePlan(overrides?: {
  firstGrade?: string;
  presenterOnFirst?: boolean;
}): BusinessHubPlan {
  return BusinessHubPlanSchema.parse({
    topic: "SBA 7(a) debt service coverage",
    family: "mechanism",
    targetSeconds: 900,
    scenes: [
      {
        id: "s01",
        beat: "cold-open",
        kind: "title",
        layout: "clipping",
        grade: overrides?.firstGrade ?? "ground-default",
        text: { headline: "What the lender actually checks" },
        narration: "Every lender runs the same test.",
        ...(overrides?.presenterOnFirst === true
          ? { presenter: { pose: "arms-open", side: "left" } }
          : {}),
      },
      {
        id: "s02",
        beat: "chapter-two",
        kind: "chapter",
        layout: "paper-stack",
        grade: "ground-inverse",
        text: { headline: "Where the number comes from" },
        narration: "Now the derivation.",
      },
    ],
  });
}

describe("the mat the video is baked for", () => {
  it("is the ground the plan opens on", () => {
    expect(resolveJobGroundTheme(JOB_ID, makePlan())).toBe("ground-default");
    expect(
      resolveJobGroundTheme(JOB_ID, makePlan({ firstGrade: "ground-inverse" })),
    ).toBe("ground-inverse");
  });

  it("throws on a grade the planner never writes", () => {
    expect(() =>
      resolveJobGroundTheme(JOB_ID, makePlan({ firstGrade: "midnight" })),
    ).toThrow(/not a ground theme slug/);
  });
});

describe("the presenter half of the plate set", () => {
  it("is null when the plan places nobody", () => {
    expect(
      resolvePresenterPlateInput({
        jobId: JOB_ID,
        plan: makePlan(),
        poses: POSES,
        repoRoot: REPO_ROOT,
        placement: undefined,
        width: 1920,
        height: 1080,
      }),
    ).toBeNull();
  });

  it("refuses to guess where a placed presenter stands", () => {
    const call = (): unknown =>
      resolvePresenterPlateInput({
        jobId: JOB_ID,
        plan: makePlan({ presenterOnFirst: true }),
        poses: POSES,
        repoRoot: REPO_ROOT,
        placement: undefined,
        width: 1920,
        height: 1080,
      });

    expect(call).toThrow(BusinessHubPipelineError);
    // The diagnostic has to say what to author, and where.
    expect(call).toThrow(/target_collar_px/);
    expect(call).toThrow(/metadata\.business_hub/);
  });

  it("still refuses when the pose the plan names is uncalibrated", () => {
    // Every entry in poses.json today is `needs-calibration`, so this is the
    // live behaviour: the head mark cannot be sized without a head hitbox, and
    // one is never invented.
    expect(() =>
      resolvePresenterPlateInput({
        jobId: JOB_ID,
        plan: makePlan({ presenterOnFirst: true }),
        poses: POSES,
        repoRoot: REPO_ROOT,
        placement: {
          targetCollarPx: 320,
          bottomAnchor: 1,
          sideInset: 0.06,
          mirror: undefined,
          headLiftPx: undefined,
        },
        width: 1920,
        height: 1080,
      }),
    ).toThrow(/calibrat/i);
  });
});
