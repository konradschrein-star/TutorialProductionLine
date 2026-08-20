import {
  AmortizationScheduleSchema,
  BreakEvenResultSchema,
  ChartSeriesSchema,
  DscrResultSchema,
  Eb5JobsResultSchema,
  ProjectionSchema,
  ProjectionYearSchema,
  SbaFeeResultSchema,
} from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { amortizationRows, amortizationSchedule } from "../amortization.js";
import { breakEven } from "../break-even.js";
import {
  amortizationBalanceSeries,
  projectionSeries,
} from "../chart-series.js";
import { dscr } from "../dscr.js";
import { eb5Jobs } from "../eb5.js";
import { projectFiveYear, projection } from "../projection.js";
import { sbaGuarantee } from "../sba.js";

/**
 * finance-kit's results cross into the Remotion elements through the zod
 * schemas in `@repo/contracts` (task F2). Every calculator's output is parsed
 * here against the real schema, so a drift on either side of that boundary
 * fails in this package rather than as a blank frame in a published video.
 *
 * These parse the ACTUAL schema objects, not a local copy.
 */
describe("contract conformance", () => {
  it("amortizationSchedule satisfies AmortizationScheduleSchema", () => {
    const schedule = amortizationSchedule({
      principal: 250_000,
      annualRatePct: 9.75,
      termMonths: 120,
    });
    expect(() => AmortizationScheduleSchema.parse(schedule)).not.toThrow();
  });

  it("a zero-rate schedule still satisfies the schema", () => {
    const schedule = amortizationSchedule({
      principal: 1200,
      annualRatePct: 0,
      termMonths: 12,
    });
    expect(() => AmortizationScheduleSchema.parse(schedule)).not.toThrow();
  });

  it("a zero-principal schedule still satisfies the schema", () => {
    const schedule = amortizationSchedule({
      principal: 0,
      annualRatePct: 6,
      termMonths: 6,
    });
    expect(() => AmortizationScheduleSchema.parse(schedule)).not.toThrow();
  });

  it("dscr satisfies DscrResultSchema, including a negative ratio", () => {
    expect(() =>
      DscrResultSchema.parse(
        dscr({ netOperatingIncome: 187_500, annualDebtService: 150_000 }),
      ),
    ).not.toThrow();
    expect(() =>
      DscrResultSchema.parse(
        dscr({ netOperatingIncome: -20_000, annualDebtService: 150_000 }),
      ),
    ).not.toThrow();
  });

  it("breakEven satisfies BreakEvenResultSchema", () => {
    expect(() =>
      BreakEvenResultSchema.parse(
        breakEven({
          fixedCosts: 82_500,
          pricePerUnit: 18.75,
          variableCostPerUnit: 6.4,
        }),
      ),
    ).not.toThrow();
  });

  it("breakEven with zero fixed costs satisfies the schema", () => {
    expect(() =>
      BreakEvenResultSchema.parse(
        breakEven({ fixedCosts: 0, pricePerUnit: 10, variableCostPerUnit: 1 }),
      ),
    ).not.toThrow();
  });

  it("projectFiveYear rows satisfy ProjectionYearSchema, loss years included", () => {
    const profitable = projectFiveYear({
      startingRevenue: 100_000,
      growthRatePct: 20,
      grossMarginPct: 60,
      opexStart: 40_000,
      opexGrowthPct: 10,
      depreciation: 5000,
      interestExpense: 3000,
      taxRatePct: 21,
    });
    for (const year of profitable) {
      expect(() => ProjectionYearSchema.parse(year)).not.toThrow();
    }

    const lossMaking = projectFiveYear({
      startingRevenue: 50_000,
      growthRatePct: 0,
      grossMarginPct: 50,
      opexStart: 80_000,
      opexGrowthPct: 0,
      depreciation: 5000,
      interestExpense: 3000,
      taxRatePct: 21,
    });
    for (const year of lossMaking) {
      expect(() => ProjectionYearSchema.parse(year)).not.toThrow();
    }
    expect(lossMaking[0].netIncome).toBeLessThan(0);
  });

  it("projection satisfies ProjectionSchema", () => {
    expect(() =>
      ProjectionSchema.parse(
        projection({
          years: 5,
          startingRevenue: 500_000,
          growthRatePct: 12,
          grossMarginPct: 45,
          opexStart: 180_000,
          opexGrowthPct: 6,
          depreciation: 22_000,
          interestExpense: 14_500,
          taxRatePct: 25,
        }),
      ),
    ).not.toThrow();
  });

  it("sbaGuarantee satisfies SbaFeeResultSchema for both programs", () => {
    const sevenA = sbaGuarantee({
      loanAmount: 750_000,
      program: "7a",
      guarantyFeeRatePct: 3.5,
      annualServiceFeeRatePct: 0.55,
    });
    expect(() => SbaFeeResultSchema.parse(sevenA)).not.toThrow();

    const fiveOhFour = sbaGuarantee({
      loanAmount: 1_200_000,
      program: "504",
      guarantyFeeRatePct: 0.5,
      annualServiceFeeRatePct: 0.914,
    });
    expect(() => SbaFeeResultSchema.parse(fiveOhFour)).not.toThrow();
  });

  it("sbaGuarantee with zero fee rates satisfies the schema", () => {
    expect(() =>
      SbaFeeResultSchema.parse(
        sbaGuarantee({
          loanAmount: 125_000,
          program: "7a",
          guarantyFeeRatePct: 0,
          annualServiceFeeRatePct: 0,
        }),
      ),
    ).not.toThrow();
  });

  it("eb5Jobs satisfies Eb5JobsResultSchema, passing and failing", () => {
    const passing = eb5Jobs({
      annualRevenue: 3_000_000,
      revenuePerEmployee: 120_000,
      sustainedYears: 3,
      investorCount: 2,
      investmentPerInvestor: 1_050_000,
    });
    expect(() => Eb5JobsResultSchema.parse(passing)).not.toThrow();

    const failing = eb5Jobs({
      annualRevenue: 300_000,
      revenuePerEmployee: 120_000,
      sustainedYears: 1,
      investorCount: 4,
      investmentPerInvestor: 800_000,
    });
    expect(() => Eb5JobsResultSchema.parse(failing)).not.toThrow();
    expect(failing.meetsRequirement).toBe(false);
  });

  it("chart series satisfy ChartSeriesSchema", () => {
    const rows = amortizationRows({
      principal: 60_000,
      annualRatePct: 7.25,
      termMonths: 36,
    });
    expect(() =>
      ChartSeriesSchema.parse(amortizationBalanceSeries(rows)),
    ).not.toThrow();

    const years = projectFiveYear({
      startingRevenue: 200_000,
      growthRatePct: 15,
      grossMarginPct: 55,
      opexStart: 90_000,
      opexGrowthPct: 8,
      depreciation: 12_000,
      interestExpense: 8000,
      taxRatePct: 21,
    });
    expect(() =>
      ChartSeriesSchema.parse(projectionSeries(years, "ebitda")),
    ).not.toThrow();
  });
});

describe("determinism", () => {
  it("produces byte-identical output for identical input", () => {
    // The render segment cache keys on hash({element, data, ...}). If these
    // calculators were not deterministic, the cache would be unsound.
    const input = { principal: 175_000, annualRatePct: 8.5, termMonths: 240 };
    expect(JSON.stringify(amortizationSchedule(input))).toBe(
      JSON.stringify(amortizationSchedule(input)),
    );

    const projectionInput = {
      startingRevenue: 640_000,
      growthRatePct: 17.5,
      grossMarginPct: 62.5,
      opexStart: 210_000,
      opexGrowthPct: 9.25,
      depreciation: 31_000,
      interestExpense: 19_400,
      taxRatePct: 21,
    };
    expect(JSON.stringify(projectFiveYear(projectionInput))).toBe(
      JSON.stringify(projectFiveYear(projectionInput)),
    );
  });
});
