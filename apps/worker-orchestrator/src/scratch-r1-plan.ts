/**
 * SCRATCH (task R1) — DRY RUN of the plan gate, with no TTS and no image spend.
 *
 * Runs exactly what `runBusinessHubAssetStage` runs at steps 5, 6 and 9 —
 * finance-kit figures, `loadPoses`, `planBusinessHub`, then the render gate's
 * own `collectViolations` — against a candidate annotated script. Timing rules
 * cannot be checked here (there is no narration yet), so `scene-timing`
 * violations are reported separately and are expected; every other rule is real.
 *
 * usage: tsx src/scratch-r1-plan.ts <annotated-script-file>
 */
import "./scratch-r1-env.js";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { breakEven, dscr } from "@repo/finance-kit";

import { planBusinessHub } from "./processors/business-hub/planner.js";
import type { FinanceFigureSet } from "./processors/business-hub/planner.js";
import {
  collectViolations,
  createNodeRepoSourceProbe,
} from "./processors/business-hub/validate.js";
import { PoseManifestSchema } from "@repo/contracts";

const REPO_ROOT = path.resolve(process.cwd(), "../..");

/**
 * The figure inputs this video's narration SPEAKS ALOUD, verbatim:
 *   break-even  "twelve thousand dollars a month" / "five dollars" / "two dollars"
 *   coverage    "one hundred and twenty thousand" / "ninety six thousand" / "one point two five"
 * Nothing here may change without the script changing in the same edit — an
 * on-screen number the narration does not say is the one thing this format
 * must never print.
 */
export const R1_FIGURE_SPECS = {
  breakeven: {
    kind: "break-even",
    inputs: { fixedCosts: 12000, pricePerUnit: 5, variableCostPerUnit: 2 },
  },
  coverage: {
    kind: "dscr",
    inputs: { netOperatingIncome: 120000, annualDebtService: 96000 },
  },
} as const;

const scriptPath = process.argv[2];
if (scriptPath === undefined) {
  throw new Error("usage: scratch-r1-plan.ts <annotated-script-file>");
}

async function main(): Promise<void> {
  const script = (await readFile(scriptPath, "utf8")).trim();

  const figures: FinanceFigureSet = {
    breakeven: {
      kind: "break-even",
      value: breakEven(R1_FIGURE_SPECS.breakeven.inputs),
    },
    coverage: { kind: "dscr", value: dscr(R1_FIGURE_SPECS.coverage.inputs) },
  };
  console.log("=== FIGURES ===");
  console.log(JSON.stringify(figures, null, 2));

  const posesRaw: unknown = JSON.parse(
    await readFile(
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
  );
  const poses = PoseManifestSchema.parse(posesRaw);

  const plan = planBusinessHub({
    topic: "How to write a business plan for a bakery",
    family: "how-to-write-for",
    script,
    targetSeconds: 210,
    figures,
    poses,
    aspect: "16:9",
    placePresenter: true,
  });

  console.log("\n=== SCENES ===");
  let presenterCount = 0;
  for (const scene of plan.scenes) {
    const presenter = scene.presenter;
    if (presenter !== undefined) presenterCount += 1;
    console.log(
      [
        scene.id,
        scene.kind.padEnd(15),
        scene.layout.padEnd(15),
        scene.grade.padEnd(14),
        presenter === undefined
          ? "—"
          : `PRESENTER ${presenter.pose} (${presenter.side}${
              presenter.pointsAt === undefined
                ? ""
                : ` -> ${presenter.pointsAt}`
            })`,
      ].join(" | "),
    );
  }
  console.log(
    `\nscenes=${plan.scenes.length} presenter_scenes=${presenterCount}`,
  );

  const violations = collectViolations(plan, {
    repoRoot: REPO_ROOT,
    poses,
    // Empty on purpose: there is no narration yet, so the timing rules cannot
    // run. Their violations are filtered out below and re-checked for real
    // inside the asset stage.
    sceneTimings: [],
    narrationDurationSec: 0,
    repoProbe: createNodeRepoSourceProbe(REPO_ROOT),
  });
  const real = violations.filter((v) => v.rule !== "scene-timing");
  console.log(`\n=== VIOLATIONS (excluding scene-timing) === ${real.length}`);
  for (const v of real) {
    console.log(`  [${v.rule}] ${v.sceneId ?? "-"} ${v.path}: ${v.message}`);
  }
}

main().catch((err: unknown) => {
  console.error("\n=== PLAN DRY RUN FAILED ===");
  console.error(err);
  process.exit(1);
});
