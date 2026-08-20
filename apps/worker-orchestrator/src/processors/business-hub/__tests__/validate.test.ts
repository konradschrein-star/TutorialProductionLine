import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  BusinessHubPlanSchema,
  type BusinessHubPlan,
  type Pose,
} from "@repo/contracts";
import {
  BusinessHubPlanValidationError,
  createNodeRepoSourceProbe,
  NARRATION_DURATION_TOLERANCE_SEC,
  SCENE_TIMING_CONTIGUITY_TOLERANCE_SEC,
  TEXT_BUDGETS,
  anchorResolvesInText,
  collectViolations,
  formatViolation,
  validateBusinessHubPlan,
  type BusinessHubValidationContext,
  type RepoSourceProbe,
  type ViolationRule,
} from "../validate.js";

/**
 * Every rule in design §8 that `validate.ts` owns, each with a fixture that
 * passes and a fixture that fails. The fixtures are real plan shapes — the
 * passing one is asserted to satisfy `BusinessHubPlanSchema` as well, so these
 * tests cannot drift into validating a shape the contracts would reject.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const SPEC_PATH = "docs/specs/dscr.md";
const SPEC_TEXT = [
  "# SBA underwriting notes",
  "",
  "## Why 1.25 is the number",
  "",
  "Lenders size the loan so net operating income covers debt service.",
  "",
  "## Guaranty fees",
  "",
  "Charged on the guaranteed portion at close.",
].join("\n");

const CALIBRATED_HITBOXES = {
  head: { center: { x: 0.5, y: 0.11 }, radius: 0.09 },
  collar: { width: 0.22 },
  pointOrigin: { x: 0.72, y: 0.44 },
  pointDirection: { x: 0.86, y: -0.2 },
  safeRegion: { x: 0, y: 0, w: 0.5, h: 1 },
  crop: { x: 0, y: 0, w: 1, h: 1 },
};

const POINTER_POSE: Pose = {
  source: "Businessman_standing_and_pointing_2K.jpeg",
  source_size: [2752, 1536],
  crop: [96, 36, 1120, 1500],
  coverage: 0.2642,
  soft_edge_px: 12056,
  head_anchor: null,
  slug: "holding-pointer",
  file: "holding-pointer.png",
  size: [1120, 1500],
  anchor_status: "calibrated",
  hitboxes: CALIBRATED_HITBOXES,
};

/** The state every one of the 16 poses is actually in on disk today. */
const UNCALIBRATED_POSE: Pose = {
  ...POINTER_POSE,
  slug: "arms-at-side",
  file: "arms-at-side.png",
  anchor_status: "needs-calibration",
  hitboxes: undefined,
};

function basePlan(): BusinessHubPlan {
  return {
    topic: "how to write a bakery business plan for an SBA 7(a) loan",
    family: "how-to-write-for",
    targetSeconds: 900,
    scenes: [
      {
        id: "s01",
        beat: "hook-what-lenders-check",
        kind: "title",
        layout: "presenter-solo",
        text: { headline: "What a lender actually reads first" },
        narration:
          "Before anyone reads your marketing section, they check one number.",
        presenter: { pose: "holding-pointer", side: "right" },
      },
      {
        id: "s02",
        beat: "why-1-25-is-the-number",
        kind: "mg",
        layout: "framed-chart",
        element: "FormulaReveal",
        text: { eyebrow: "Debt service coverage" },
        data: {
          steps: [
            {
              lhs: "DSCR",
              rhs: "NOI / debt service",
              caption: "The whole test in one line.",
            },
          ],
          labels: ["Year 1", "Year 2", "Year 3"],
        },
        source: { kind: "repo", ref: `${SPEC_PATH}#why-1-25-is-the-number` },
        cacheKey: "b8c1f0d2e3a4b5c6",
        presenter: {
          pose: "holding-pointer",
          side: "right",
          pointsAt: "step-1",
        },
        narration: "Net operating income divided by annual debt service.",
      },
      {
        id: "s03",
        beat: "bakery-storefront",
        kind: "broll",
        layout: "broll-defocus",
        text: {},
        visual: {
          provider: "pexels",
          assetKey: "sha256:9f2b",
          sourceUrl: "https://www.pexels.com/video/12345/",
          licence: "Pexels License",
          retrievedAt: "2026-08-15T10:00:00Z",
        },
        narration: "This is what the lender is lending against.",
      },
    ],
  } as BusinessHubPlan;
}

function baseContext(
  overrides: Partial<BusinessHubValidationContext> = {},
): BusinessHubValidationContext {
  return {
    repoRoot: "C:/repo",
    poses: [POINTER_POSE, UNCALIBRATED_POSE],
    sceneTimings: [
      { sceneId: "s01", startSec: 0, endSec: 10 },
      { sceneId: "s02", startSec: 10, endSec: 20 },
      { sceneId: "s03", startSec: 20, endSec: 30 },
    ],
    narrationDurationSec: 30,
    repoProbe: fakeProbe({ [SPEC_PATH]: SPEC_TEXT }),
    ...overrides,
  };
}

/** A probe over an in-memory filesystem. `null` text = exists but unreadable. */
function fakeProbe(
  files: Readonly<Record<string, string | null>>,
): RepoSourceProbe {
  return {
    probe(repoRelativePath: string) {
      if (!Object.prototype.hasOwnProperty.call(files, repoRelativePath)) {
        return { exists: false, text: null };
      }
      return { exists: true, text: files[repoRelativePath] };
    },
  };
}

/** Deep clone so a mutation in one test cannot leak into another. */
function planWith(mutate: (plan: BusinessHubPlan) => void): BusinessHubPlan {
  const plan = structuredClone(basePlan());
  mutate(plan);
  return plan;
}

function rulesOf(
  violations: readonly { rule: ViolationRule }[],
): ViolationRule[] {
  return violations.map((v) => v.rule);
}

/** Narrows a fixture scene to the `mg` member so `data` is assignable. */
function mgScene(plan: BusinessHubPlan, index: number) {
  const scene = plan.scenes[index];
  if (scene === undefined || scene.kind !== "mg") {
    throw new Error(`fixture scene ${index} is not an mg scene`);
  }
  return scene;
}

// ─────────────────────────────────────────────────────────────────────────────
// The passing fixture
// ─────────────────────────────────────────────────────────────────────────────

describe("the passing fixture", () => {
  it("is a plan the contracts schema also accepts", () => {
    const parsed = BusinessHubPlanSchema.safeParse(basePlan());
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  it("produces no violations", () => {
    expect(collectViolations(basePlan(), baseContext())).toEqual([]);
  });

  it("does not throw", () => {
    expect(() =>
      validateBusinessHubPlan(basePlan(), baseContext()),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule 1 — sources
// ─────────────────────────────────────────────────────────────────────────────

describe("rule 1: every claim scene carries a resolvable source", () => {
  it("accepts an allowlisted primary source", () => {
    const plan = planWith((p) => {
      p.scenes[1].source = {
        kind: "primary",
        ref: "https://www.sba.gov/document/sop-50-10-7#dscr",
      };
    });
    expect(collectViolations(plan, baseContext())).toEqual([]);
  });

  it("fails a formula scene with no source at all", () => {
    const plan = planWith((p) => {
      delete p.scenes[1].source;
    });
    const violations = collectViolations(plan, baseContext());
    expect(rulesOf(violations)).toContain("source-missing");
    const violation = violations.find((v) => v.rule === "source-missing");
    expect(violation?.sceneId).toBe("s02");
    expect(violation?.beat).toBe("why-1-25-is-the-number");
    expect(violation?.message).toContain("formula");
  });

  it("fails an element that is not registered in the citation map, source or no source", () => {
    // Deny by default. This is the RENDER gate, and it also runs on plans it
    // did not produce (Presenter/Plan Studio, operator-pinned, retried). An
    // unregistered element used to mean "carries no factual claim", so a
    // renamed or newly-added element carrying a stat walked straight past
    // design §8 rule 1 with nothing said.
    for (const withSource of [true, false]) {
      const plan = planWith((p) => {
        p.scenes[1].element = "ProfitProjectionBlock";
        if (!withSource) delete p.scenes[1].source;
      });
      const violations = collectViolations(plan, baseContext());
      expect(rulesOf(violations)).toContain("element-unregistered");
      const violation = violations.find(
        (v) => v.rule === "element-unregistered",
      );
      expect(violation?.sceneId).toBe("s02");
      expect(violation?.message).toContain("ProfitProjectionBlock");
      expect(violation?.remedy).toContain("ELEMENT_SOURCE_KIND");
    }
  });

  it("fails a primary source that is off the allowlist", () => {
    const plan = planWith((p) => {
      p.scenes[1].source = {
        kind: "primary",
        ref: "https://bankrate.com/sba-loans",
      };
    });
    const violations = collectViolations(plan, baseContext());
    expect(rulesOf(violations)).toEqual(["source-unresolved"]);
    expect(violations[0].message).toContain("bankrate.com");
  });

  it("fails a repo source whose file is not on disk", () => {
    const plan = planWith((p) => {
      p.scenes[1].source = { kind: "repo", ref: "docs/specs/gone.md#dscr" };
    });
    const violations = collectViolations(plan, baseContext());
    expect(rulesOf(violations)).toEqual(["source-unresolved"]);
    expect(violations[0].message).toContain("does not exist");
  });

  it("fails a repo source whose anchor was renamed out of an existing file", () => {
    const plan = planWith((p) => {
      p.scenes[1].source = {
        kind: "repo",
        ref: `${SPEC_PATH}#why-1-15-is-the-number`,
      };
    });
    const violations = collectViolations(plan, baseContext());
    expect(rulesOf(violations)).toEqual(["source-unresolved"]);
    expect(violations[0].message).toContain("was not found");
  });

  it("fails closed when an anchored citation points at a file it cannot read", () => {
    const plan = planWith((p) => {
      p.scenes[1].source = { kind: "repo", ref: "docs/specs/scan.pdf#dscr" };
    });
    const ctx = baseContext({
      repoProbe: fakeProbe({ "docs/specs/scan.pdf": null }),
    });
    const violations = collectViolations(plan, ctx);
    expect(rulesOf(violations)).toEqual(["source-unresolved"]);
    expect(violations[0].message).toContain("could not be read as text");
  });

  it("rejects a repo ref that escapes the repo root", () => {
    const plan = planWith((p) => {
      p.scenes[1].source = { kind: "repo", ref: "../../etc/passwd#root" };
    });
    const violations = collectViolations(plan, baseContext());
    expect(rulesOf(violations)).toEqual(["source-unresolved"]);
    expect(violations[0].message).toContain("escapes the repo root");
  });

  it("checks sources on scenes that do not require one", () => {
    const plan = planWith((p) => {
      p.scenes[2].source = { kind: "repo", ref: "docs/specs/gone.md" };
    });
    expect(rulesOf(collectViolations(plan, baseContext()))).toEqual([
      "source-unresolved",
    ]);
  });
});

describe("anchorResolvesInText", () => {
  it("resolves a markdown heading by its slug", () => {
    expect(anchorResolvesInText("why-1-25-is-the-number", SPEC_TEXT)).toBe(
      true,
    );
  });

  it("resolves a heading regardless of the anchor's punctuation", () => {
    expect(anchorResolvesInText("Guaranty Fees", SPEC_TEXT)).toBe(true);
  });

  it("resolves a symbol cited out of source code", () => {
    expect(
      anchorResolvesInText("computeDscr", "export function computeDscr() {}"),
    ).toBe(true);
  });

  it("resolves an in-range line anchor and rejects an out-of-range one", () => {
    expect(anchorResolvesInText("L3", "a\nb\nc\nd")).toBe(true);
    expect(anchorResolvesInText("L99", "a\nb\nc\nd")).toBe(false);
  });

  it("rejects an anchor that appears nowhere", () => {
    expect(anchorResolvesInText("collateral-shortfall", SPEC_TEXT)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule 2 — poses and hitboxes
// ─────────────────────────────────────────────────────────────────────────────

describe("rule 2: presenter poses exist and are fully calibrated", () => {
  it("accepts a calibrated pose that points", () => {
    expect(collectViolations(basePlan(), baseContext())).toEqual([]);
  });

  it("fails a pose that is not in the manifest", () => {
    const plan = planWith((p) => {
      p.scenes[0].presenter = { pose: "leaning-on-desk", side: "left" };
    });
    const violations = collectViolations(plan, baseContext());
    expect(rulesOf(violations)).toEqual(["pose-missing"]);
    expect(violations[0].sceneId).toBe("s01");
  });

  it("fails an uncalibrated pose — the state all 16 poses ship in today", () => {
    const plan = planWith((p) => {
      p.scenes[0].presenter = { pose: "arms-at-side", side: "left" };
    });
    const violations = collectViolations(plan, baseContext());
    expect(rulesOf(violations)).toEqual(["pose-uncalibrated"]);
    expect(violations[0].message).toContain("needs-calibration");
  });

  it("fails a pose marked calibrated whose head hitbox is absent", () => {
    const broken: Pose = {
      ...POINTER_POSE,
      hitboxes: {
        ...CALIBRATED_HITBOXES,
        head: undefined,
      } as unknown as Pose["hitboxes"],
    };
    const violations = collectViolations(
      basePlan(),
      baseContext({ poses: [broken] }),
    );
    expect(rulesOf(violations)).toEqual(["hitbox-missing", "hitbox-missing"]);
    expect(violations[0].message).toContain('"head"');
  });

  it("fails a pose whose collar width is missing (the scale normaliser)", () => {
    const broken: Pose = {
      ...POINTER_POSE,
      hitboxes: { ...CALIBRATED_HITBOXES, collar: { width: 0 } },
    };
    const violations = collectViolations(
      basePlan(),
      baseContext({ poses: [broken] }),
    );
    expect(violations.every((v) => v.rule === "hitbox-missing")).toBe(true);
    expect(violations[0].message).toContain('"collar"');
  });

  it("requires pointOrigin and pointDirection only when the scene points", () => {
    const noPointHitboxes: Pose = {
      ...POINTER_POSE,
      hitboxes: {
        ...CALIBRATED_HITBOXES,
        pointOrigin: undefined,
        pointDirection: undefined,
      } as unknown as Pose["hitboxes"],
    };

    const pointing = collectViolations(
      basePlan(),
      baseContext({ poses: [noPointHitboxes] }),
    );
    expect(rulesOf(pointing)).toEqual(["hitbox-missing", "hitbox-missing"]);
    expect(pointing[0].message).toContain("pointOrigin");

    const notPointing = planWith((p) => {
      p.scenes[1].presenter = { pose: "holding-pointer", side: "right" };
    });
    expect(
      collectViolations(notPointing, baseContext({ poses: [noPointHitboxes] })),
    ).toEqual([]);
  });

  it("fails a zero-length pointDirection", () => {
    const broken: Pose = {
      ...POINTER_POSE,
      hitboxes: { ...CALIBRATED_HITBOXES, pointDirection: { x: 0, y: 0 } },
    };
    const violations = collectViolations(
      basePlan(),
      baseContext({ poses: [broken] }),
    );
    expect(rulesOf(violations)).toEqual(["hitbox-missing"]);
    expect(violations[0].message).toContain("zero-length");
  });

  it("fails a presenter-solo scene that names no pose", () => {
    const plan = planWith((p) => {
      p.scenes[0].kind = "presenter-solo";
      delete p.scenes[0].presenter;
    });
    expect(rulesOf(collectViolations(plan, baseContext()))).toEqual([
      "pose-missing",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule 3 — visual provenance
// ─────────────────────────────────────────────────────────────────────────────

describe("rule 3: sourced visuals carry full provenance", () => {
  it("accepts a fully tagged visual", () => {
    expect(collectViolations(basePlan(), baseContext())).toEqual([]);
  });

  it("fails a visual with a blank licence", () => {
    const plan = planWith((p) => {
      const visual = p.scenes[2].visual;
      if (visual !== undefined) visual.licence = "   ";
    });
    const violations = collectViolations(plan, baseContext());
    expect(rulesOf(violations)).toEqual(["visual-provenance"]);
    expect(violations[0].path).toBe("scenes[2].visual.licence");
  });

  it("reports every missing provenance field at once", () => {
    const plan = planWith((p) => {
      p.scenes[2].visual = {
        provider: "google",
        assetKey: "",
        sourceUrl: "",
        licence: "",
        retrievedAt: "",
      } as never;
    });
    expect(collectViolations(plan, baseContext())).toHaveLength(4);
  });

  it("fails a broll scene with no visual at all", () => {
    const plan = planWith((p) => {
      delete p.scenes[2].visual;
    });
    const violations = collectViolations(plan, baseContext());
    expect(rulesOf(violations)).toEqual(["visual-missing"]);
    expect(violations[0].beat).toBe("bakery-storefront");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule 4 — text budgets
// ─────────────────────────────────────────────────────────────────────────────

describe("rule 4: copy fits its element budget", () => {
  it("accepts a headline exactly at the budget", () => {
    const plan = planWith((p) => {
      p.scenes[0].text.headline = "x".repeat(TEXT_BUDGETS.headline);
    });
    expect(collectViolations(plan, baseContext())).toEqual([]);
  });

  it("fails a headline one character over", () => {
    const plan = planWith((p) => {
      p.scenes[0].text.headline = "x".repeat(TEXT_BUDGETS.headline + 1);
    });
    const violations = collectViolations(plan, baseContext());
    expect(rulesOf(violations)).toEqual(["text-budget"]);
    expect(violations[0].path).toBe("scenes[0].text.headline");
    expect(violations[0].message).toContain(String(TEXT_BUDGETS.headline));
  });

  it("budgets checklist items inside mg data by their property name", () => {
    const plan = planWith((p) => {
      mgScene(p, 1).data = {
        items: ["fits fine", "y".repeat(TEXT_BUDGETS.checklistItem + 1)],
      };
    });
    const violations = collectViolations(plan, baseContext());
    expect(rulesOf(violations)).toEqual(["text-budget"]);
    expect(violations[0].path).toBe("scenes[1].data.items[1]");
  });

  it("leaves unregistered property names unbudgeted rather than inventing a limit", () => {
    const plan = planWith((p) => {
      mgScene(p, 1).data = { internalDebugBlob: "z".repeat(5000) };
    });
    expect(collectViolations(plan, baseContext())).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule 5 — no hex colour literals
// ─────────────────────────────────────────────────────────────────────────────

describe("rule 5: colour comes from theme tokens, never from plan data", () => {
  it("accepts a grade name and a cache key that merely look hexish", () => {
    const plan = planWith((p) => {
      p.scenes[1].grade = "cool";
      p.scenes[1].cacheKey = "0b0f14deadbeef";
    });
    expect(collectViolations(plan, baseContext())).toEqual([]);
  });

  it("fails a six-digit hex literal buried in mg data", () => {
    const plan = planWith((p) => {
      mgScene(p, 1).data = { steps: [{ caption: "line in #0b0f14" }] };
    });
    const violations = collectViolations(plan, baseContext());
    expect(rulesOf(violations)).toEqual(["hex-colour"]);
    expect(violations[0].message).toContain("#0b0f14");
  });

  it("fails a three-digit hex literal in a headline", () => {
    const plan = planWith((p) => {
      p.scenes[0].text.headline = "Set the mat to #fff";
    });
    expect(rulesOf(collectViolations(plan, baseContext()))).toEqual([
      "hex-colour",
    ]);
  });

  it("does not flag the anchor of a citation", () => {
    const plan = planWith((p) => {
      p.scenes[1].source = { kind: "repo", ref: `${SPEC_PATH}#Guaranty Fees` };
    });
    expect(collectViolations(plan, baseContext())).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule 6 — durations
// ─────────────────────────────────────────────────────────────────────────────

describe("rule 6: scene durations are positive, contiguous and sum to the narration", () => {
  it("accepts a contiguous timeline inside tolerance", () => {
    const ctx = baseContext({
      sceneTimings: [
        { sceneId: "s01", startSec: 0, endSec: 10 },
        { sceneId: "s02", startSec: 10.02, endSec: 20 },
        { sceneId: "s03", startSec: 20, endSec: 30.1 },
      ],
    });
    expect(collectViolations(basePlan(), ctx)).toEqual([]);
  });

  it("fails a zero-length scene", () => {
    const ctx = baseContext({
      sceneTimings: [
        { sceneId: "s01", startSec: 0, endSec: 10 },
        { sceneId: "s02", startSec: 10, endSec: 10 },
        { sceneId: "s03", startSec: 10, endSec: 30 },
      ],
    });
    const violations = collectViolations(basePlan(), ctx);
    expect(rulesOf(violations)).toEqual(["scene-timing"]);
    expect(violations[0].sceneId).toBe("s02");
    expect(violations[0].message).toContain("must occupy time");
  });

  it("fails a gap between two scenes", () => {
    const gap = SCENE_TIMING_CONTIGUITY_TOLERANCE_SEC + 0.5;
    const ctx = baseContext({
      sceneTimings: [
        { sceneId: "s01", startSec: 0, endSec: 10 },
        { sceneId: "s02", startSec: 10 + gap, endSec: 20 },
        { sceneId: "s03", startSec: 20, endSec: 30 },
      ],
    });
    const violations = collectViolations(basePlan(), ctx);
    expect(rulesOf(violations)).toEqual(["scene-timing"]);
    expect(violations[0].message).toContain("gap");
  });

  it("fails when the timeline does not reach the narration duration", () => {
    const ctx = baseContext({
      narrationDurationSec: 30 + NARRATION_DURATION_TOLERANCE_SEC + 1,
    });
    const violations = collectViolations(basePlan(), ctx);
    expect(rulesOf(violations)).toEqual(["scene-timing"]);
    expect(violations[0].message).toContain("sum to");
  });

  it("fails a scene with no timing at all rather than assuming an average", () => {
    const ctx = baseContext({
      sceneTimings: [
        { sceneId: "s01", startSec: 0, endSec: 10 },
        { sceneId: "s03", startSec: 10, endSec: 30 },
      ],
    });
    const violations = collectViolations(basePlan(), ctx);
    expect(
      violations.some((v) => v.sceneId === "s02" && v.rule === "scene-timing"),
    ).toBe(true);
  });

  it("fails a timing that references a scene the plan does not contain", () => {
    const ctx = baseContext({
      sceneTimings: [
        ...baseContext().sceneTimings,
        { sceneId: "s99", startSec: 30, endSec: 40 },
      ],
    });
    const violations = collectViolations(basePlan(), ctx);
    expect(violations.some((v) => v.message.includes("s99"))).toBe(true);
  });

  it("fails an unmeasured narration duration instead of deriving one", () => {
    const ctx = baseContext({ narrationDurationSec: Number.NaN });
    const violations = collectViolations(basePlan(), ctx);
    expect(rulesOf(violations)).toEqual(["context-invalid"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule 7 — cache keys
// ─────────────────────────────────────────────────────────────────────────────

describe("rule 7: every mg scene carries a derived cache key", () => {
  it("accepts an mg scene with a cache key", () => {
    expect(collectViolations(basePlan(), baseContext())).toEqual([]);
  });

  it("fails an mg scene with no cache key", () => {
    const plan = planWith((p) => {
      delete p.scenes[1].cacheKey;
    });
    const violations = collectViolations(plan, baseContext());
    expect(rulesOf(violations)).toEqual(["cache-key"]);
    expect(violations[0].sceneId).toBe("s02");
  });

  it("does not demand a cache key from an ffmpeg-composited scene", () => {
    const plan = planWith((p) => {
      delete p.scenes[0].cacheKey;
      delete p.scenes[2].cacheKey;
    });
    expect(collectViolations(plan, baseContext())).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unwalkable data
// ─────────────────────────────────────────────────────────────────────────────

describe("data the validator cannot walk is a violation, not a skip", () => {
  it("fails circular mg data", () => {
    const plan = basePlan();
    const cyclic: Record<string, unknown> = { label: "cycle" };
    cyclic.self = cyclic;
    mgScene(plan, 1).data = cyclic;
    const violations = collectViolations(plan, baseContext());
    expect(rulesOf(violations)).toContain("data-unwalkable");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The real filesystem probe (the production path the fakes bypass)
// ─────────────────────────────────────────────────────────────────────────────

describe("createNodeRepoSourceProbe", () => {
  // vitest's root is apps/worker-orchestrator; the monorepo root is two up.
  const repoRoot = path.resolve(process.cwd(), "..", "..");
  const probe = createNodeRepoSourceProbe(repoRoot);
  const designDoc =
    "docs/superpowers/specs/2026-08-15-business-plan-hub-format-design.md";

  it("reads a real file in this repo and resolves an anchor in it", () => {
    const result = probe.probe(designDoc);
    expect(result.exists).toBe(true);
    expect(result.text).not.toBeNull();
    expect(anchorResolvesInText("8-fail-closed-rules", result.text ?? "")).toBe(
      true,
    );
  });

  it("reports a file that is not there", () => {
    expect(probe.probe("docs/does-not-exist-9f2b.md")).toEqual({
      exists: false,
      text: null,
    });
  });

  it("refuses to read outside the repo root", () => {
    expect(
      probe.probe("../../../Windows/System32/drivers/etc/hosts").exists,
    ).toBe(false);
  });

  it("reports a directory as not a file", () => {
    expect(probe.probe("docs").exists).toBe(false);
  });

  it("resolves a real repo citation end to end", () => {
    const plan = planWith((p) => {
      p.scenes[1].source = {
        kind: "repo",
        ref: `${designDoc}#8-fail-closed-rules`,
      };
    });
    const ctx = baseContext({ repoRoot, repoProbe: undefined });
    expect(collectViolations(plan, ctx)).toEqual([]);
  });

  it("fails a real citation whose anchor is not in the real file", () => {
    const plan = planWith((p) => {
      p.scenes[1].source = {
        kind: "repo",
        ref: `${designDoc}#chapter-not-written-yet`,
      };
    });
    const ctx = baseContext({ repoRoot, repoProbe: undefined });
    expect(rulesOf(collectViolations(plan, ctx))).toEqual([
      "source-unresolved",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Aggregation
// ─────────────────────────────────────────────────────────────────────────────

describe("validateBusinessHubPlan aggregates", () => {
  it("throws one error listing every violation, each naming its scene and beat", () => {
    const plan = planWith((p) => {
      delete p.scenes[1].source;
      delete p.scenes[1].cacheKey;
      delete p.scenes[2].visual;
      p.scenes[0].text.headline = "x".repeat(TEXT_BUDGETS.headline + 1);
    });

    let caught: unknown;
    try {
      validateBusinessHubPlan(plan, baseContext());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BusinessHubPlanValidationError);
    const error = caught as BusinessHubPlanValidationError;
    expect(rulesOf(error.violations).sort()).toEqual(
      ["cache-key", "source-missing", "text-budget", "visual-missing"].sort(),
    );
    expect(error.message).toContain("4 violations");
    expect(error.message).toContain("why-1-25-is-the-number");
    expect(error.message).toContain("bakery-storefront");
    expect(error.message).toContain("hook-what-lenders-check");
  });

  it("formats a plan-level violation without inventing a scene", () => {
    const line = formatViolation({
      rule: "scene-timing",
      sceneId: null,
      beat: null,
      path: "ctx.sceneTimings",
      message: "m",
      remedy: "r",
    });
    expect(line).toBe("[scene-timing] plan at ctx.sceneTimings: m -> r");
  });
});
