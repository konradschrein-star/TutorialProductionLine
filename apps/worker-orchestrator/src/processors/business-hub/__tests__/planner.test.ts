import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  BUSINESS_HUB_MG_ELEMENT_NAMES,
  PoseManifestSchema,
  requiresSource,
  type BusinessHubPlan,
  type BusinessHubScene,
  type Pose,
  type PoseManifest,
  type Projection,
} from "@repo/contracts";

import {
  DOCUMENT_ELEMENT,
  ELEMENT_LAYOUT,
  FIGURE_ELEMENT,
  GROUND_THEMES,
  INTENT_POSES,
  MAX_FRAME_TILT_DEG,
  PRESENTER_RATIO,
  ScenePlannerError,
  canonicalStringify,
  computeSceneCacheKey,
  framedChartRotationDeg,
  isCalibratedPose,
  planBusinessHub,
  splitIntoBeats,
  type FinanceFigure,
  type FinanceFigureSet,
  type ScenePlannerErrorCode,
  type ScenePlannerInput,
} from "../planner.js";

/**
 * The planner is the one place in BUSINESS_PLAN_HUB where a script becomes a
 * render plan, so these tests care about two things above all: that it is
 * deterministic, and that every fail-closed rule actually fires. A planner that
 * quietly picked a default rotation, invented a chart number or skipped a
 * citation would produce a video that looks fine and is wrong — which at this
 * volume is the expensive failure mode.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** Real pose slugs, taken from `media/style-assets/presenter/poses/poses.json`. */
const REAL_POSE_SLUGS = [
  "pointing-down-left",
  "arms-at-side",
  "full-body-standing",
  "thumbs-up",
  "hand-to-collar",
  "pointing-up",
  "holding-pointer",
  "holding-tablet",
  "arms-folded-thinking",
  "arms-open",
  "fist-pump",
  "hands-in-pockets",
  "pointing-both-hands",
  "pointing-left-arm-out",
  "pointing-left-wide",
  "pointing-right-arm-out",
] as const;

/** Plausible pointing vectors per pose. Fixture data — poses.json has none yet. */
const FIXTURE_DIRECTIONS: Readonly<Record<string, { x: number; y: number }>> = {
  "pointing-down-left": { x: -0.8, y: 0.5 },
  "arms-at-side": { x: 0.1, y: 0.95 },
  "full-body-standing": { x: 0.2, y: 0.9 },
  "thumbs-up": { x: 0.3, y: -0.8 },
  "hand-to-collar": { x: -0.2, y: -0.3 },
  "pointing-up": { x: 0.04, y: -0.98 },
  "holding-pointer": { x: 0.9, y: -0.2 },
  "holding-tablet": { x: 0.4, y: 0.4 },
  "arms-folded-thinking": { x: -0.3, y: 0.2 },
  "arms-open": { x: 0.7, y: 0.1 },
  "fist-pump": { x: 0.25, y: -0.7 },
  "hands-in-pockets": { x: 0.05, y: 0.6 },
  "pointing-both-hands": { x: 0.85, y: 0.15 },
  "pointing-left-arm-out": { x: -0.9, y: -0.1 },
  "pointing-left-wide": { x: -0.95, y: 0.05 },
  "pointing-right-arm-out": { x: 0.95, y: -0.05 },
};

function uncalibratedPose(slug: string): Pose {
  return {
    source: `${slug}.jpeg`,
    source_size: [2752, 1536],
    crop: [0, 0, 1120, 1500],
    coverage: 0.26,
    soft_edge_px: 1200,
    head_anchor: null,
    slug,
    file: `${slug}.png`,
    size: [1120, 1500],
    anchor_status: "needs-calibration",
  };
}

function calibratedPose(slug: string): Pose {
  const direction = FIXTURE_DIRECTIONS[slug];
  if (direction === undefined) {
    throw new Error(`fixture has no pointDirection for pose "${slug}"`);
  }
  return {
    ...uncalibratedPose(slug),
    anchor_status: "calibrated",
    hitboxes: {
      head: { center: { x: 0.5, y: 0.08 }, radius: 0.11 },
      collar: { width: 0.24 },
      pointOrigin: { x: 0.72, y: 0.35 },
      pointDirection: direction,
      safeRegion: { x: 0.0, y: 0.1, w: 0.45, h: 0.8 },
      crop: { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },
    },
  };
}

const CALIBRATED_MANIFEST: PoseManifest = REAL_POSE_SLUGS.map(calibratedPose);
const UNCALIBRATED_MANIFEST: PoseManifest =
  REAL_POSE_SLUGS.map(uncalibratedPose);

const PROJECTION: Projection = {
  years: [
    {
      year: 1,
      revenue: 420_000,
      cogs: 168_000,
      grossProfit: 252_000,
      operatingExpenses: 231_000,
      ebitda: 21_000,
      depreciation: 18_000,
      interestExpense: 41_000,
      taxes: 0,
      netIncome: -38_000,
    },
    {
      year: 2,
      revenue: 610_000,
      cogs: 238_000,
      grossProfit: 372_000,
      operatingExpenses: 268_000,
      ebitda: 104_000,
      depreciation: 18_000,
      interestExpense: 38_000,
      taxes: 10_000,
      netIncome: 38_000,
    },
    {
      year: 3,
      revenue: 780_000,
      cogs: 296_000,
      grossProfit: 484_000,
      operatingExpenses: 301_000,
      ebitda: 183_000,
      depreciation: 18_000,
      interestExpense: 34_000,
      taxes: 32_000,
      netIncome: 99_000,
    },
  ],
};

const FIGURES: FinanceFigureSet = {
  dscr: {
    kind: "dscr",
    value: {
      netOperatingIncome: 148_000,
      annualDebtService: 112_000,
      dscr: 1.3214285714285714,
      threshold: 1.25,
      meetsThreshold: true,
    },
  },
  "loan-amortization": {
    kind: "amortization",
    value: {
      principal: 750_000,
      annualRate: 0.115,
      termMonths: 3,
      monthlyPayment: 254_558.33,
      totalInterest: 13_675.0,
      totalPaid: 763_675.0,
      rows: [
        {
          period: 1,
          payment: 254_558.33,
          principal: 247_371.66,
          interest: 7_187.5,
          balance: 502_628.34,
          cumulativeInterest: 7_187.5,
        },
        {
          period: 2,
          payment: 254_558.33,
          principal: 249_688.83,
          interest: 4_869.5,
          balance: 252_939.51,
          cumulativeInterest: 12_057.0,
        },
        {
          period: 3,
          payment: 254_558.33,
          principal: 252_939.51,
          interest: 1_618.0,
          balance: 0,
          cumulativeInterest: 13_675.0,
        },
      ],
    },
  },
  projection: { kind: "projection", value: PROJECTION },
  "break-even": {
    kind: "break-even",
    value: {
      fixedCosts: 264_000,
      pricePerUnit: 14,
      variableCostPerUnit: 5.6,
      contributionMargin: 8.4,
      contributionMarginRatio: 0.6,
      breakEvenUnits: 31_428.571428571428,
      breakEvenRevenue: 440_000,
    },
  },
  "sba-fees": {
    kind: "sba-fees",
    value: {
      loanAmount: 750_000,
      guarantyPercent: 0.75,
      guaranteedAmount: 562_500,
      guarantyFee: 19_687.5,
      annualServiceFee: 3_093.75,
      totalUpfrontFees: 21_187.5,
    },
  },
  "rejection-rate": {
    kind: "series",
    value: {
      points: [0.41, 0.37, 0.34, 0.29],
      labels: ["2022", "2023", "2024", "2025"],
    },
  },
};

/**
 * A realistic `mechanism`-family script: 28 beats, five figure beats, one named
 * document, three chapters, a hook, a mid-roll CTA and a close.
 */
const SCRIPT = `
[hook]
Your lender decided whether to fund you before you walked in the door, and the thing that decided it is one line on page nine.

[title: How a lender actually reads your plan]
This is what happens to your business plan between the moment you email it and the moment somebody says yes.

Most of what you were told to put in the document is not what gets read. The narrative matters, but it matters second.

[chapter: What the underwriter opens first]
The first person to open your plan is not looking for your story. They are looking for one ratio, and they already know roughly what it needs to be.

That ratio is debt service coverage, and it is the single number that decides whether the rest of your document gets read at all.

[fig: dscr] [source: primary sba.gov/sop-50-10-7#dscr]
Take net operating income, divide by everything you owe the bank in a year, and you get debt service coverage. Watch it get built one term at a time.

Anything at or above one point two five clears the bar. Below it, the file stops moving no matter how good the story is.

People hear that and assume it is a target. It is a floor, and a file that lands exactly on the floor is a file with no room in it.

[doc: SBA SOP 50 10 7 | U.S. Small Business Administration | Effective 1 August 2023] [source: primary sba.gov/document/sop-50-10-7]
The number is not folklore. It is written down, in the standard operating procedure every 7a lender works from.

Now look at what produces that number on the debt side, because most applicants get this part wrong by a wide margin.

[fig: loan-amortization] [source: repo packages/finance-kit/README.md#amortization]
A seven fifty loan at eleven and a half percent does not cost what people think it costs. Here is where every dollar of the payment actually goes.

The principal falls slowly at first. That shape is why your year one coverage looks worse than your year three coverage.

Which brings us to the part everybody wants to skip.

[cta]
If you want this checked properly rather than guessed at, the tool is trained on exactly the standard we are walking through here.

[chapter: The five-year projection]
Now the projection. This is the section that gets padded, and padding is the fastest way to lose a reader who reads these all day.

[fig: projection] [source: repo packages/finance-kit/README.md#projection]
Three years of revenue, cost of goods, operating expense and what is actually left. Notice the first year loses money and that is fine.

A plan that shows profit in month one is a plan nobody believes. The curve matters more than the peak.

[fig: break-even] [source: repo packages/finance-kit/README.md#break-even]
Break even is the honest version of the same story: fixed cost divided by contribution margin, in units you actually have to sell.

Thirty one thousand units. Say that out loud and the projection either holds up or it does not.

[fig: sba-fees] [source: primary sba.gov/partners/lenders/7a-loan-program/fees]
And before any of that, there are the fees, which come off the top and never appear in the optimistic version of the plan.

That is the whole cost side. Now the failure side.

[chapter: What gets you rejected]
Rejection is boring and repetitive. The same five things, over and over, across every industry.

The most common one is not a bad idea. It is a projection that cannot be reconciled with the debt the applicant is asking for.

[fig: rejection-rate] [format: percent 0] [source: primary sba.gov/document/report-7a-504-lending-data]
Decline rates have moved over the last four years, and not for the reason most people assume.

The rate went down because the applications got better, not because the standard got softer. That distinction matters to you.

The applicants who got funded did not write better sentences. They wrote numbers that reconciled, and they showed the reconciliation.

Everything above is the method. It is genuinely all of it, and you can do it by hand this afternoon.

[close]
Doing it by hand is the expensive part. Check your work with the free checker and see how many of these it finds.
`;

const BASE_INPUT: ScenePlannerInput = {
  topic: "why 1.25 dscr",
  family: "mechanism",
  script: SCRIPT,
  targetSeconds: 900,
  figures: FIGURES,
  poses: CALIBRATED_MANIFEST,
  aspect: "16:9",
  placePresenter: true,
};

const plan = (overrides: Partial<ScenePlannerInput> = {}): BusinessHubPlan =>
  planBusinessHub({ ...BASE_INPUT, ...overrides });

function expectPlannerError(
  run: () => unknown,
  code: ScenePlannerErrorCode,
): ScenePlannerError {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected ${code} but nothing was thrown`).toBeInstanceOf(
    ScenePlannerError,
  );
  const error = caught as ScenePlannerError;
  expect(error.code, error.message).toBe(code);
  return error;
}

const presenterScenes = (p: BusinessHubPlan): BusinessHubScene[] =>
  p.scenes.filter((scene) => scene.presenter !== undefined);

// ─────────────────────────────────────────────────────────────────────────────
// Beat splitting
// ─────────────────────────────────────────────────────────────────────────────

describe("splitIntoBeats", () => {
  it("splits a structured script on blank lines", () => {
    const beats = splitIntoBeats(SCRIPT);
    expect(beats.length).toBe(28);
    expect(beats[0].startsWith("[hook]")).toBe(true);
  });

  it("keeps short beats instead of discarding them like CASUALLY_EXPLAINED does", () => {
    const short = `${SCRIPT}\n\n[beat: tail] That's it.\n`;
    const beats = splitIntoBeats(short);
    expect(beats.length).toBe(29);
    expect(beats[28]).toContain("That's it.");
  });

  it("falls back to single-newline splitting when there is no paragraph structure", () => {
    const beats = splitIntoBeats("[hook] one line\n[close] another line\n");
    expect(beats.length).toBe(2);
  });

  it("throws on an empty script rather than returning an empty plan", () => {
    expectPlannerError(() => splitIntoBeats("   \n\n  "), "EMPTY_SCRIPT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────────────────────

describe("planBusinessHub — plan shape", () => {
  it("emits one scene per beat with unique sequential ids", () => {
    const result = plan();
    expect(result.scenes.length).toBe(28);
    expect(result.scenes.map((s) => s.id)).toEqual(
      Array.from(
        { length: 28 },
        (_, i) => `s${String(i + 1).padStart(2, "0")}`,
      ),
    );
    expect(new Set(result.scenes.map((s) => s.beat)).size).toBe(28);
  });

  it("carries the job facts through unchanged", () => {
    const result = plan();
    expect(result.topic).toBe("why 1.25 dscr");
    expect(result.family).toBe("mechanism");
    expect(result.targetSeconds).toBe(900);
  });

  it("routes each beat to the kind and layout its directive implies", () => {
    const byBeat = new Map(plan().scenes.map((s) => [s.beat, s]));

    expect(byBeat.get("hook")?.kind).toBe("presenter-solo");
    expect(byBeat.get("close")?.kind).toBe("presenter-solo");
    expect(byBeat.get("cta")?.kind).toBe("presenter-solo");
    expect(byBeat.get("chapter-what-the-underwriter-opens-first")?.kind).toBe(
      "chapter",
    );
    expect(byBeat.get("how-a-lender-actually-reads-your-plan")?.kind).toBe(
      "title",
    );

    const dscr = byBeat.get("dscr");
    expect(dscr?.kind).toBe("mg");
    expect(dscr?.layout).toBe("framed-chart");

    const doc = byBeat.get("sba-sop-50-10-7");
    expect(doc?.kind).toBe("mg");
    expect(doc?.layout).toBe("clipping");

    // an un-directed paragraph is connective narration
    const connective = plan().scenes.filter((s) => s.kind === "broll");
    expect(connective.length).toBeGreaterThan(8);
    expect(connective.every((s) => s.layout === "broll-defocus")).toBe(true);
  });

  it("uses the element registered for each figure kind", () => {
    const byBeat = new Map(plan().scenes.map((s) => [s.beat, s]));
    for (const [beat, figureKey] of [
      ["dscr", "dscr"],
      ["loan-amortization", "loan-amortization"],
      ["projection", "projection"],
      ["break-even", "break-even"],
      ["sba-fees", "sba-fees"],
      ["rejection-rate", "rejection-rate"],
    ] as const) {
      const scene = byBeat.get(beat);
      const figure = FIGURES[figureKey];
      expect(scene?.kind).toBe("mg");
      if (scene?.kind !== "mg") throw new Error("unreachable");
      expect(scene.element).toBe(FIGURE_ELEMENT[figure.kind]);
      expect(scene.layout).toBe(ELEMENT_LAYOUT[scene.element]);
    }
  });

  it("puts the element's own props on the scene, built only from finance-kit's numbers", () => {
    const scene = plan().scenes.find((s) => s.beat === "projection");
    if (scene?.kind !== "mg") throw new Error("expected an mg scene");
    // `scene.data` IS the element's props. The raw `Projection` is not: a
    // LineChart asks for `{ series, format }` and would throw on `{ years }`.
    expect(scene.element).toBe("LineChart");
    expect(scene.data).toEqual({
      series: {
        points: PROJECTION.years.map((y) => y.revenue),
        labels: PROJECTION.years.map((y) => `Year ${y.year}`),
      },
      format: { kind: "currency", currency: "USD", decimals: 0 },
      seriesLabel: "Revenue",
      compare: {
        series: {
          points: PROJECTION.years.map((y) => y.netIncome),
          labels: PROJECTION.years.map((y) => `Year ${y.year}`),
        },
        label: "Net income",
      },
      xAxisLabel: "PROJECTION YEAR",
    });
  });

  it("gives a document clipping the three fields the script printed on it", () => {
    const scene = plan().scenes.find((s) => s.beat === "sba-sop-50-10-7");
    if (scene?.kind !== "mg") throw new Error("expected an mg scene");
    expect(scene.element).toBe(DOCUMENT_ELEMENT);
    expect(scene.data).toEqual({
      headlineText: "SBA SOP 50 10 7",
      publication: "U.S. Small Business Administration",
      dateText: "Effective 1 August 2023",
    });
    expect(scene.text.headline).toBe("SBA SOP 50 10 7");
  });

  it("keeps every beat's narration, directives stripped", () => {
    const result = plan();
    const hook = result.scenes[0];
    expect(hook.narration).toBe(
      "Your lender decided whether to fund you before you walked in the door, and the thing that decided it is one line on page nine.",
    );
    expect(result.scenes.every((s) => s.narration.length > 0)).toBe(true);
    expect(result.scenes.some((s) => s.narration.includes("["))).toBe(false);
  });

  it("attaches the parsed citation to every sourced scene", () => {
    const byBeat = new Map(plan().scenes.map((s) => [s.beat, s]));
    expect(byBeat.get("dscr")?.source).toEqual({
      kind: "primary",
      ref: "sba.gov/sop-50-10-7#dscr",
    });
    expect(byBeat.get("projection")?.source).toEqual({
      kind: "repo",
      ref: "packages/finance-kit/README.md#projection",
    });
  });

  it("is deterministic — the same input plans byte-identically", () => {
    expect(JSON.stringify(plan())).toBe(JSON.stringify(plan()));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ground theme
// ─────────────────────────────────────────────────────────────────────────────

describe("ground theme", () => {
  it("alternates the body ground across chapters and pops the chapter card against its own chapter", () => {
    const scenes = plan().scenes;
    let chapterIndex = 0;
    const bodyThemesSeen: string[] = [];

    for (const scene of scenes) {
      if (scene.kind === "chapter") {
        chapterIndex += 1;
        const own = GROUND_THEMES[chapterIndex % GROUND_THEMES.length];
        expect(scene.grade, `chapter card ${scene.beat}`).not.toBe(own);
        continue;
      }
      bodyThemesSeen[chapterIndex] = scene.grade ?? "";
      expect(scene.grade).toBe(GROUND_THEMES[chapterIndex % 2]);
    }

    expect(chapterIndex).toBe(3);
    expect(bodyThemesSeen).toEqual([
      "ground-default",
      "ground-inverse",
      "ground-default",
      "ground-inverse",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Presenter policy
// ─────────────────────────────────────────────────────────────────────────────

describe("presenter scheduling", () => {
  it("keeps the presenter inside the documented ratio band", () => {
    const result = plan();
    const ratio = presenterScenes(result).length / result.scenes.length;
    expect(ratio).toBeGreaterThanOrEqual(PRESENTER_RATIO.min);
    expect(ratio).toBeLessThanOrEqual(PRESENTER_RATIO.max);
  });

  it("stops at the target rather than taking every action beat it could", () => {
    // The band alone cannot catch a policy that grabs everything, because the
    // hard ceiling sits exactly on `max`. This pins the target-seeking itself:
    // the fixture has five framed-chart beats and only three are taken.
    const result = plan();
    expect(presenterScenes(result).length).toBe(
      Math.round(result.scenes.length * PRESENTER_RATIO.target),
    );
    const actionBeats = result.scenes.filter(
      (s) => s.layout === "framed-chart",
    );
    expect(actionBeats.length).toBe(5);
    expect(actionBeats.filter((s) => s.presenter !== undefined).length).toBe(3);
  });

  it("always shows him at the hook, the CTA and the close", () => {
    const byBeat = new Map(plan().scenes.map((s) => [s.beat, s]));
    for (const beat of ["hook", "cta", "close"]) {
      expect(byBeat.get(beat)?.presenter, beat).toBeDefined();
    }
  });

  it("only adds him to beats where he is doing something", () => {
    for (const scene of presenterScenes(plan())) {
      expect(
        ["presenter-solo", "framed-chart", "card-grid"],
        `${scene.beat} (${scene.layout})`,
      ).toContain(scene.layout);
    }
  });

  it("never places him on two adjacent scenes outside the mandatory roles", () => {
    const scenes = plan().scenes;
    for (let i = 1; i < scenes.length; i += 1) {
      const both =
        scenes[i].presenter !== undefined &&
        scenes[i - 1].presenter !== undefined;
      if (both) {
        expect(
          [scenes[i].kind, scenes[i - 1].kind].every(
            (kind) => kind === "presenter-solo",
          ),
        ).toBe(true);
      }
    }
  });

  it("never repeats a pose back-to-back, across gaps or adjacent", () => {
    const poses = presenterScenes(plan()).map((s) => s.presenter?.pose);
    expect(poses.length).toBeGreaterThan(3);
    for (let i = 1; i < poses.length; i += 1) {
      expect(poses[i], `appearance ${i}`).not.toBe(poses[i - 1]);
    }
  });

  it("never places two adjacent scenes with the same pose", () => {
    const scenes = plan().scenes;
    for (let i = 1; i < scenes.length; i += 1) {
      const a = scenes[i - 1].presenter?.pose;
      const b = scenes[i].presenter?.pose;
      if (a !== undefined && b !== undefined) expect(b).not.toBe(a);
    }
  });

  /** Three adjacent mandatory beats: hook (rhetorical-question), cta, close. */
  const THREE_ROLE_BEATS = [
    "[hook] The bank decided before you walked in, and here is the line that decided it.",
    "[cta] If you want it checked properly, the tool is trained on this exact standard.",
    "[close] Doing it by hand is the expensive part, so check your work first.",
  ].join("\n\n");

  const manifestWith = (...calibrated: string[]) => [
    ...calibrated.map(calibratedPose),
    ...REAL_POSE_SLUGS.filter((slug) => !calibrated.includes(slug)).map(
      uncalibratedPose,
    ),
  ];

  it("walks the intent's own preference list instead of repeating a pose", () => {
    // `affirm` prefers thumbs-up, fist-pump, arms-open. With the first two
    // calibrated the CTA and the close take one each, so nothing repeats and
    // every pose still means what its beat means.
    const result = planBusinessHub({
      ...BASE_INPUT,
      script: THREE_ROLE_BEATS,
      poses: manifestWith("arms-open", "thumbs-up", "fist-pump"),
    });
    expect(result.scenes.map((s) => s.presenter?.pose)).toEqual([
      "arms-open",
      "thumbs-up",
      "fist-pump",
    ]);
  });

  it("repeats the intent's own pose rather than substituting one from another intent", () => {
    // The only calibrated pose `affirm` can reach is arms-open, and the hook
    // just used it. The rejected alternative is handing back hands-in-pockets
    // — a `rhetorical-question` pose — which would put the wrong gesture on a
    // CTA while passing every downstream gate, because it IS calibrated.
    const result = planBusinessHub({
      ...BASE_INPUT,
      script: THREE_ROLE_BEATS,
      poses: manifestWith("arms-open", "hands-in-pockets"),
    });
    const poses = result.scenes.map((s) => s.presenter?.pose);
    expect(poses).toEqual(["arms-open", "arms-open", "arms-open"]);
    expect(poses).not.toContain("hands-in-pockets");
  });

  it("picks the pose from the beat's intent", () => {
    const byBeat = new Map(plan().scenes.map((s) => [s.beat, s]));
    expect(INTENT_POSES["rhetorical-question"]).toContain(
      byBeat.get("hook")?.presenter?.pose,
    );
    expect(INTENT_POSES.affirm).toContain(byBeat.get("close")?.presenter?.pose);
    // revenue rises across the projection, so the hand goes up
    expect(byBeat.get("projection")?.presenter?.pose).toBe("pointing-up");
    // dscr is a single derived value: the pointer, not a rising hand
    expect(INTENT_POSES.chart).toContain(byBeat.get("dscr")?.presenter?.pose);
  });

  it("rotates through an intent's preference list rather than reusing its head", () => {
    const chartPoses = presenterScenes(plan())
      .filter((s) => s.layout === "framed-chart")
      .map((s) => s.presenter?.pose);
    expect(new Set(chartPoses).size).toBe(chartPoses.length);
  });

  it("points at the last data point of a series and at the result of a derivation", () => {
    const byBeat = new Map(plan().scenes.map((s) => [s.beat, s]));
    expect(byBeat.get("projection")?.presenter?.pointsAt).toBe("point-2");
    expect(byBeat.get("dscr")?.presenter?.pointsAt).toBe("result");
    // presenter-solo scenes point at nothing and stand centre
    expect(byBeat.get("hook")?.presenter?.pointsAt).toBeUndefined();
    expect(byBeat.get("hook")?.presenter?.side).toBe("center");
  });

  it("stands opposite the direction the hand points, so the arm reaches into the object", () => {
    const dscr = plan().scenes.find((s) => s.beat === "dscr");
    // holding-pointer points right (x = +0.9) → he stands on the left
    expect(dscr?.presenter?.pose).toBe("holding-pointer");
    expect(dscr?.presenter?.side).toBe("left");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Framed-chart geometry
// ─────────────────────────────────────────────────────────────────────────────

describe("framedChartRotationDeg", () => {
  it("reads the pointing line left-to-right so mirrored poses tilt opposite ways", () => {
    const right = framedChartRotationDeg(calibratedPose("holding-pointer"));
    const left = framedChartRotationDeg(
      calibratedPose("pointing-left-arm-out"),
    );
    expect(right).toBeLessThan(0); // hand rising to the right lifts the right edge
    expect(left).toBeGreaterThan(0);
  });

  it("clamps to a few degrees — nothing falls over", () => {
    for (const slug of REAL_POSE_SLUGS) {
      const tilt = framedChartRotationDeg(calibratedPose(slug));
      expect(Math.abs(tilt)).toBeLessThanOrEqual(MAX_FRAME_TILT_DEG);
    }
  });

  it("does not clamp a shallow vector", () => {
    const shallow: Pose = {
      ...calibratedPose("holding-pointer"),
    };
    if (shallow.hitboxes === undefined) throw new Error("unreachable");
    const tilted: Pose = {
      ...shallow,
      hitboxes: {
        ...shallow.hitboxes,
        pointDirection: { x: 1, y: 0.05 },
      },
    };
    const tilt = framedChartRotationDeg(tilted);
    expect(tilt).toBeCloseTo((Math.atan2(0.05, 1) * 180) / Math.PI, 6);
    expect(Math.abs(tilt)).toBeLessThan(MAX_FRAME_TILT_DEG);
  });

  it("throws rather than defaulting to zero when the pose is uncalibrated", () => {
    const error = expectPlannerError(
      () => framedChartRotationDeg(uncalibratedPose("holding-pointer")),
      "NO_CALIBRATED_POSE",
    );
    expect(error.message).toContain("Presenter Studio");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cache keys
// ─────────────────────────────────────────────────────────────────────────────

describe("segment cache key", () => {
  const base = {
    element: "FormulaReveal",
    data: { a: 1, b: [3, 2, 1], c: { d: true, e: "x" } },
    grade: "ground-default",
    layout: "framed-chart",
    aspect: "16:9",
  } as const;

  it("is stable when object keys are reordered", () => {
    const reordered = {
      ...base,
      data: { c: { e: "x", d: true }, b: [3, 2, 1], a: 1 },
    };
    expect(computeSceneCacheKey(reordered)).toBe(computeSceneCacheKey(base));
  });

  it("is NOT stable when array order changes — order is data", () => {
    const shuffled = { ...base, data: { a: 1, b: [1, 2, 3], c: base.data.c } };
    expect(computeSceneCacheKey(shuffled)).not.toBe(computeSceneCacheKey(base));
  });

  it("changes when any of element, grade, layout or aspect changes", () => {
    const original = computeSceneCacheKey(base);
    expect(computeSceneCacheKey({ ...base, element: "StatGrid" })).not.toBe(
      original,
    );
    expect(computeSceneCacheKey({ ...base, grade: "ground-inverse" })).not.toBe(
      original,
    );
    expect(computeSceneCacheKey({ ...base, layout: "paper-stack" })).not.toBe(
      original,
    );
    expect(computeSceneCacheKey({ ...base, aspect: "9:16" })).not.toBe(
      original,
    );
  });

  it("is a sha256 hex digest", () => {
    expect(computeSceneCacheKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is set on every mg scene and on no other scene", () => {
    for (const scene of plan().scenes) {
      if (scene.kind === "mg") {
        expect(scene.cacheKey, scene.beat).toMatch(/^[0-9a-f]{64}$/);
      } else {
        expect(scene.cacheKey, scene.beat).toBeUndefined();
      }
    }
  });

  it("survives an aspect change by changing every mg key", () => {
    const wide = plan();
    const tall = plan({ aspect: "9:16" });
    const keys = (p: BusinessHubPlan) =>
      p.scenes.filter((s) => s.kind === "mg").map((s) => s.cacheKey);
    expect(keys(tall)).not.toEqual(keys(wide));
  });
});

describe("canonicalStringify", () => {
  it("sorts keys at every depth", () => {
    expect(canonicalStringify({ b: { d: 1, c: 2 }, a: 3 })).toBe(
      '{"a":3,"b":{"c":2,"d":1}}',
    );
  });

  it("drops undefined members exactly as JSON.stringify does", () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("preserves array order", () => {
    expect(canonicalStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("handles null, numbers, strings and booleans", () => {
    expect(canonicalStringify(null)).toBe("null");
    expect(canonicalStringify(1.5)).toBe("1.5");
    expect(canonicalStringify("a")).toBe('"a"');
    expect(canonicalStringify(false)).toBe("false");
  });

  it("refuses values JSON cannot carry losslessly", () => {
    expectPlannerError(
      () => canonicalStringify({ a: Number.NaN }),
      "NON_CANONICAL_DATA",
    );
    expectPlannerError(
      () => canonicalStringify({ a: [1, undefined, 3] }),
      "NON_CANONICAL_DATA",
    );
    expectPlannerError(
      () => canonicalStringify({ at: new Date(0) }),
      "NON_CANONICAL_DATA",
    );
    expectPlannerError(
      () => canonicalStringify(undefined),
      "NON_CANONICAL_DATA",
    );
  });

  it("refuses a cycle instead of overflowing the stack", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expectPlannerError(() => canonicalStringify(cyclic), "NON_CANONICAL_DATA");
  });
});

/**
 * The renderer (task W1) computes a segment's key with
 * `@repo/media-core`'s `computeCacheKey`, while the planner writes
 * `scene.cacheKey` with its own copy — media-core's barrel does not export the
 * cache module yet (task R4). If those two ever disagree by a byte, every
 * cached segment misses and the format's whole economic argument evaporates
 * silently. So the two implementations are pinned to each other here, by
 * importing R2's source directly.
 *
 * When R4 exports the cache from `@repo/media-core`, delete the planner's copy,
 * import theirs, and delete this block.
 */
describe("cache-key compatibility with @repo/media-core (task R2)", () => {
  const specs: unknown[] = [
    {
      element: "FormulaReveal",
      data: FIGURES.dscr.value,
      grade: "ground-default",
      layout: "framed-chart",
      aspect: "16:9",
    },
    {
      element: "LineChart",
      data: PROJECTION,
      grade: "ground-inverse",
      layout: "framed-chart",
      aspect: "9:16",
    },
    {
      element: DOCUMENT_ELEMENT,
      data: {
        headlineText: "SBA SOP 50 10 7",
        publication: "U.S. Small Business Administration",
        dateText: "Effective 1 August 2023",
      },
      grade: "ground-default",
      layout: "clipping",
      aspect: "16:9",
    },
    { nested: { deep: [1, { z: 1, a: [true, null, "s"] }] } },
  ];

  it("serialises identically", async () => {
    const upstream =
      await import("../../../../../../packages/media-core/src/cache/index.js");
    for (const spec of specs) {
      expect(canonicalStringify(spec)).toBe(upstream.canonicalStringify(spec));
    }
  });

  it("hashes every mg scene to the key the renderer will look up", async () => {
    const upstream =
      await import("../../../../../../packages/media-core/src/cache/index.js");
    for (const scene of plan().scenes) {
      if (scene.kind !== "mg") continue;
      // The shape W1 builds, per docs/superpowers/handoff/R2.md.
      const spec: unknown = {
        element: scene.element,
        layout: scene.layout,
        aspect: "16:9",
        grade: scene.grade ?? null,
        data: scene.data,
      };
      // The planner's data must survive R2's own JSON guard, or the renderer
      // would throw where the planner happily produced a key.
      expect(upstream.isJsonValue(spec), scene.beat).toBe(true);
      if (!upstream.isJsonValue(spec)) throw new Error("unreachable");
      expect(scene.cacheKey, scene.beat).toBe(upstream.computeCacheKey(spec));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fail-closed
// ─────────────────────────────────────────────────────────────────────────────

describe("fail-closed rules", () => {
  const replaceBeat = (from: string, to: string): string => {
    if (!SCRIPT.includes(from)) throw new Error(`fixture missing "${from}"`);
    return SCRIPT.replace(from, to);
  };

  it("throws naming the beat and the figure when finance-kit did not produce it", () => {
    const error = expectPlannerError(
      () => plan({ script: replaceBeat("[fig: dscr]", "[fig: dscr-ratio]") }),
      "MISSING_FIGURE",
    );
    expect(error.message).toContain("dscr-ratio");
    expect(error.message).toContain("break-even");
    expect(error.beat).toBe("dscr-ratio");
  });

  it("throws when the figure set is empty rather than planning an empty chart", () => {
    expectPlannerError(() => plan({ figures: {} }), "MISSING_FIGURE");
  });

  it("throws when a figure beat carries no citation", () => {
    const error = expectPlannerError(
      () =>
        plan({
          script: replaceBeat(
            "[fig: dscr] [source: primary sba.gov/sop-50-10-7#dscr]",
            "[fig: dscr]",
          ),
        }),
      "MISSING_SOURCE",
    );
    expect(error.message).toContain("formula");
    expect(error.beat).toBe("dscr");
  });

  it("throws when a document beat carries no citation", () => {
    expectPlannerError(
      () =>
        plan({
          script: replaceBeat(
            "[doc: SBA SOP 50 10 7 | U.S. Small Business Administration | Effective 1 August 2023] [source: primary sba.gov/document/sop-50-10-7]",
            "[doc: SBA SOP 50 10 7 | U.S. Small Business Administration | Effective 1 August 2023]",
          ),
        }),
      "MISSING_SOURCE",
    );
  });

  it("throws when a document beat names no publication and no date to print", () => {
    const error = expectPlannerError(
      () =>
        plan({
          script: replaceBeat(
            "[doc: SBA SOP 50 10 7 | U.S. Small Business Administration | Effective 1 August 2023]",
            "[doc: SBA SOP 50 10 7]",
          ),
        }),
      "INVALID_DOCUMENT",
    );
    // A clipping draws all three; the renderer throws on a missing one, and
    // neither a masthead nor a date is derivable from anything the pipeline has.
    expect(error.message).toContain("publication");
    expect(error.beat).toBe("sba-sop-50-10-7");
  });

  it("rejects a primary citation that is not on the government allowlist", () => {
    const error = expectPlannerError(
      () =>
        plan({
          script: replaceBeat(
            "[source: primary sba.gov/sop-50-10-7#dscr]",
            "[source: primary bizplanblog.example.com/dscr]",
          ),
        }),
      "INVALID_SOURCE",
    );
    expect(error.message).toContain("allowlist");
  });

  it("rejects a citation with no kind word", () => {
    expectPlannerError(
      () =>
        plan({
          script: replaceBeat(
            "[source: primary sba.gov/sop-50-10-7#dscr]",
            "[source: sba.gov]",
          ),
        }),
      "INVALID_SOURCE",
    );
  });

  it("throws on an element the renderer does not implement", () => {
    const error = expectPlannerError(
      () =>
        plan({
          script: replaceBeat("[fig: dscr] ", "[fig: dscr] [element: Sankey] "),
        }),
      "UNKNOWN_ELEMENT",
    );
    expect(error.message).toContain("not implemented by the renderer");
    // The diagnostic must list what IS available, or the author has to go
    // reading the renderer to find out.
    expect(error.message).toContain("FormulaReveal");
  });

  it("throws on a real element that cannot draw this figure kind", () => {
    const error = expectPlannerError(
      () =>
        plan({
          script: replaceBeat(
            "[fig: dscr] ",
            "[fig: dscr] [element: ComparisonTable] ",
          ),
        }),
      "UNSUPPORTED_ELEMENT_FOR_FIGURE",
    );
    expect(error.message).toContain("FormulaReveal, StatCallout");
    expect(error.beat).toBe("dscr");
  });

  it("throws when a bare series beat does not state its unit", () => {
    const error = expectPlannerError(
      () =>
        plan({
          script: replaceBeat(
            "[fig: rejection-rate] [format: percent 0] ",
            "[fig: rejection-rate] ",
          ),
        }),
      "MISSING_VALUE_FORMAT",
    );
    expect(error.message).toContain("[format:");
    expect(error.beat).toBe("rejection-rate");
  });

  it("throws when a figure whose unit is already fixed states one anyway", () => {
    expectPlannerError(
      () =>
        plan({
          script: replaceBeat(
            "[fig: dscr] ",
            "[fig: dscr] [format: currency] ",
          ),
        }),
      "UNEXPECTED_VALUE_FORMAT",
    );
  });

  it("throws on an unrecognised unit rather than picking one", () => {
    const error = expectPlannerError(
      () =>
        plan({
          script: replaceBeat("[format: percent 0]", "[format: dollars]"),
        }),
      "INVALID_VALUE_FORMAT",
    );
    expect(error.message).toContain("currency, percent, ratio, number");
  });

  it("throws when a format directive has no figure to describe", () => {
    expectPlannerError(
      () =>
        plan({
          script: replaceBeat(
            "[chapter: The five-year projection]",
            "[format: percent]",
          ),
        }),
      "FORMAT_WITHOUT_FIGURE",
    );
  });

  it("throws when an element is named without a figure to feed it", () => {
    expectPlannerError(
      () =>
        plan({
          script: replaceBeat(
            "[chapter: The five-year projection]",
            "[element: FormulaReveal]",
          ),
        }),
      "ELEMENT_WITHOUT_FIGURE",
    );
  });

  it("throws when every pose is uncalibrated instead of guessing a placement", () => {
    const error = expectPlannerError(
      () => plan({ poses: UNCALIBRATED_MANIFEST }),
      "NO_CALIBRATED_POSE",
    );
    expect(error.message).toContain("needs-calibration");
    expect(error.message).toContain("Presenter Studio");
  });

  it("throws when the manifest has no pose at all", () => {
    expectPlannerError(() => plan({ poses: [] }), "NO_CALIBRATED_POSE");
  });

  it("never substitutes a pose from another intent when the preferred ones are uncalibrated", () => {
    // Only `arms-open` is calibrated. It serves `rhetorical-question` and
    // `affirm`; nothing in the manifest serves `chart`, and the script's DSCR
    // beat is a chart beat. The old behaviour widened to "any other calibrated
    // pose" and shipped arms-open pointing at nothing.
    const onlyArmsOpen = CALIBRATED_MANIFEST.filter(
      (pose) => pose.slug === "arms-open",
    );
    expect(onlyArmsOpen).toHaveLength(1);
    const error = expectPlannerError(
      () => plan({ poses: onlyArmsOpen }),
      "NO_POSE_FOR_INTENT",
    );
    expect(error.message).toContain("arms-open");
    expect(error.message).toContain("presenter_mode");
  });

  it("plans without a figure when placePresenter is false, and requires no pose at all", () => {
    const planned = plan({
      placePresenter: false,
      poses: UNCALIBRATED_MANIFEST,
    });
    expect(planned.scenes.every((scene) => scene.presenter === undefined)).toBe(
      true,
    );
    // `presenter-solo` means "the presenter alone on the mat"; with no
    // presenter the role beats must not claim that kind, or the render gate
    // rejects the plan for a missing pose.
    expect(
      planned.scenes.some((scene) => scene.kind === "presenter-solo"),
    ).toBe(false);
  });

  it("refuses a planner input that omits the subformat choice", () => {
    expectPlannerError(
      () =>
        planBusinessHub({
          ...BASE_INPUT,
          placePresenter: undefined as unknown as boolean,
        }),
      "INVALID_INPUT",
    );
  });

  it("throws on an unknown directive rather than ignoring it", () => {
    const error = expectPlannerError(
      () => plan({ script: replaceBeat("[hook]", "[intro]") }),
      "UNKNOWN_DIRECTIVE",
    );
    expect(error.message).toContain("intro");
  });

  it("throws when a beat claims two roles", () => {
    expectPlannerError(
      () => plan({ script: replaceBeat("[cta]", "[cta] [chapter: Wait]") }),
      "CONFLICTING_DIRECTIVES",
    );
  });

  it("throws when a directive repeats on one beat", () => {
    expectPlannerError(
      () =>
        plan({
          script: replaceBeat("[fig: dscr] ", "[fig: dscr] [fig: projection] "),
        }),
      "DUPLICATE_DIRECTIVE",
    );
  });

  it("throws when a value-taking directive has no value", () => {
    expectPlannerError(
      () => plan({ script: replaceBeat("[fig: dscr]", "[fig]") }),
      "MISSING_DIRECTIVE_VALUE",
    );
  });

  it("throws when a beat is nothing but directives", () => {
    expectPlannerError(
      () =>
        plan({
          script: SCRIPT.replace(
            /\[chapter: What gets you rejected\]\n[^\n]+/,
            "[chapter: What gets you rejected]",
          ),
        }),
      "EMPTY_NARRATION",
    );
  });

  it("throws when the script has no hook", () => {
    const error = expectPlannerError(
      () => plan({ script: replaceBeat("[hook]", "[beat: opener]") }),
      "MISSING_ROLE_BEAT",
    );
    expect(error.message).toContain("[hook]");
  });

  it("throws when the script has no close", () => {
    expectPlannerError(
      () => plan({ script: replaceBeat("[close]", "[beat: outro]") }),
      "MISSING_ROLE_BEAT",
    );
  });

  it("throws when the script has two hooks", () => {
    expectPlannerError(
      () => plan({ script: replaceBeat("[cta]", "[hook]") }),
      "DUPLICATE_ROLE_BEAT",
    );
  });

  it("throws when a headline blows its 1080p budget", () => {
    const error = expectPlannerError(
      () =>
        plan({
          script: replaceBeat(
            "[chapter: What gets you rejected]",
            "[chapter: What gets you rejected, and why it is almost never the idea itself in the plan]",
          ),
        }),
      "HEADLINE_TOO_LONG",
    );
    expect(error.message).toContain("68");
  });

  it("throws on an empty aspect — it is part of every cache key", () => {
    expectPlannerError(() => plan({ aspect: "  " }), "INVALID_INPUT");
  });

  it("throws when the assembled plan would not satisfy the contracts schema", () => {
    expectPlannerError(() => plan({ targetSeconds: 0 }), "INVALID_PLAN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Real asset manifest
// ─────────────────────────────────────────────────────────────────────────────

describe("poses.json on disk", () => {
  const manifestPath = fileURLToPath(
    new URL(
      "../../../../../../media/style-assets/presenter/poses/poses.json",
      import.meta.url,
    ),
  );
  const manifest = PoseManifestSchema.parse(
    JSON.parse(readFileSync(manifestPath, "utf8")),
  );

  it("parses with the contracts schema", () => {
    expect(manifest.length).toBeGreaterThan(0);
  });

  it("contains every pose slug the intent table can ask for", () => {
    const slugs = new Set(manifest.map((pose) => pose.slug));
    for (const [intent, candidates] of Object.entries(INTENT_POSES)) {
      for (const slug of candidates) {
        expect(slugs.has(slug), `${intent} → ${slug}`).toBe(true);
      }
    }
  });

  it("agrees with isCalibratedPose about which poses are usable", () => {
    for (const pose of manifest) {
      expect(isCalibratedPose(pose)).toBe(
        pose.anchor_status === "calibrated" && pose.hitboxes !== undefined,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Figure typing
// ─────────────────────────────────────────────────────────────────────────────

describe("finance figure routing", () => {
  const kinds: FinanceFigure["kind"][] = [
    "amortization",
    "dscr",
    "break-even",
    "projection",
    "sba-fees",
    "eb5-jobs",
    "series",
  ];

  it("maps every figure kind to an element that has a layout", () => {
    for (const kind of kinds) {
      const element = FIGURE_ELEMENT[kind];
      expect(element, kind).toBeDefined();
      expect(ELEMENT_LAYOUT[element], `${kind} → ${element}`).toBeDefined();
    }
  });

  it("maps every figure kind to an element the renderer actually implements", () => {
    // The defect this whole module exists to close: for months the planner
    // emitted AmortizationChart / BreakEvenChart / ProjectionChart /
    // FeeBreakdown / TimelineChart, none of which has ever had a component, so
    // five of seven figure kinds could not render a frame.
    for (const kind of kinds) {
      expect(
        BUSINESS_HUB_MG_ELEMENT_NAMES as readonly string[],
        `${kind} → ${FIGURE_ELEMENT[kind]}`,
      ).toContain(FIGURE_ELEMENT[kind]);
    }
  });

  it("registers a layout for every element the renderer implements", () => {
    for (const element of BUSINESS_HUB_MG_ELEMENT_NAMES) {
      expect(ELEMENT_LAYOUT[element], element).toBeDefined();
    }
  });

  it("keeps every emittable element inside the plan-time citation gate", () => {
    // `BusinessHubSceneSchema` only demands a source for elements registered in
    // ELEMENT_SOURCE_KIND. An element the planner can emit but contracts has
    // never heard of would pass schema validation with no citation at all.
    for (const kind of kinds) {
      expect(requiresSource(FIGURE_ELEMENT[kind]), kind).toBe(true);
    }
    expect(requiresSource(DOCUMENT_ELEMENT)).toBe(true);
  });

  it("routes the document beat to an element the renderer implements", () => {
    expect(BUSINESS_HUB_MG_ELEMENT_NAMES as readonly string[]).toContain(
      DOCUMENT_ELEMENT,
    );
  });

  it("names an element on every mg scene the renderer can dispatch", () => {
    for (const scene of plan().scenes) {
      if (scene.kind !== "mg") continue;
      expect(
        BUSINESS_HUB_MG_ELEMENT_NAMES as readonly string[],
        `${scene.beat} → ${scene.element}`,
      ).toContain(scene.element);
    }
  });
});
