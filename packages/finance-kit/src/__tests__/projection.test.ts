import { describe, expect, it } from "vitest";

import { FinanceInputError } from "../errors.js";
import {
  PROJECTION_DEFAULT_YEARS,
  projectFiveYear,
  projectYears,
  projection,
} from "../projection.js";

/** The worked example every assertion below is checked against by hand. */
const BASE = {
  startingRevenue: 100_000,
  growthRatePct: 20,
  grossMarginPct: 60,
  opexStart: 40_000,
  opexGrowthPct: 10,
  depreciation: 5000,
  interestExpense: 3000,
  taxRatePct: 21,
} as const;

describe("projectFiveYear", () => {
  it("projects exactly five years", () => {
    expect(PROJECTION_DEFAULT_YEARS).toBe(5);
    const rows = projectFiveYear(BASE);
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.year)).toEqual([1, 2, 3, 4, 5]);
  });

  it("matches the hand-computed year 1", () => {
    // rev 100,000; cogs 40% = 40,000; gp 60,000; opex 40,000; ebitda 20,000
    // pretax 20,000 - 5,000 - 3,000 = 12,000; tax 21% = 2,520; net 9,480
    expect(projectFiveYear(BASE)[0]).toEqual({
      year: 1,
      revenue: 100_000,
      cogs: 40_000,
      grossProfit: 60_000,
      operatingExpenses: 40_000,
      ebitda: 20_000,
      depreciation: 5000,
      interestExpense: 3000,
      taxes: 2520,
      netIncome: 9480,
    });
  });

  it("matches the hand-computed year 3", () => {
    // rev 100,000 x 1.2^2 = 144,000; opex 40,000 x 1.1^2 = 48,400
    // gp 86,400; ebitda 38,000; pretax 30,000; tax 6,300; net 23,700
    expect(projectFiveYear(BASE)[2]).toEqual({
      year: 3,
      revenue: 144_000,
      cogs: 57_600,
      grossProfit: 86_400,
      operatingExpenses: 48_400,
      ebitda: 38_000,
      depreciation: 5000,
      interestExpense: 3000,
      taxes: 6300,
      netIncome: 23_700,
    });
  });

  it("matches the hand-computed year 5, including cents", () => {
    // rev 100,000 x 1.2^4 = 207,360; opex 40,000 x 1.1^4 = 58,564
    // gp 124,416; ebitda 65,852; pretax 57,852; tax 12,148.92; net 45,703.08
    expect(projectFiveYear(BASE)[4]).toEqual({
      year: 5,
      revenue: 207_360,
      cogs: 82_944,
      grossProfit: 124_416,
      operatingExpenses: 58_564,
      ebitda: 65_852,
      depreciation: 5000,
      interestExpense: 3000,
      taxes: 12_148.92,
      netIncome: 45_703.08,
    });
  });

  it("keeps every year internally consistent", () => {
    for (const row of projectFiveYear(BASE)) {
      expect(row.grossProfit).toBeCloseTo(row.revenue - row.cogs, 2);
      expect(row.ebitda).toBeCloseTo(
        row.grossProfit - row.operatingExpenses,
        2,
      );
      const preTax = row.ebitda - row.depreciation - row.interestExpense;
      expect(row.netIncome).toBeCloseTo(preTax - row.taxes, 2);
    }
  });

  it("reports a loss rather than clamping it to zero, and charges no tax on it", () => {
    // Early-year losses are the norm in these plans and must render as such.
    const rows = projectFiveYear({
      ...BASE,
      startingRevenue: 50_000,
      grossMarginPct: 50,
      opexStart: 80_000,
      growthRatePct: 0,
      opexGrowthPct: 0,
    });
    expect(rows[0].ebitda).toBe(-55_000);
    expect(rows[0].taxes).toBe(0);
    expect(rows[0].netIncome).toBe(-63_000);
  });

  it("shrinks revenue on a negative growth rate", () => {
    const rows = projectFiveYear({ ...BASE, growthRatePct: -25 });
    expect(rows[0].revenue).toBe(100_000);
    expect(rows[1].revenue).toBe(75_000);
    expect(rows[2].revenue).toBe(56_250);
  });

  it("drives revenue to zero at -100% growth without going negative", () => {
    const rows = projectFiveYear({ ...BASE, growthRatePct: -100 });
    expect(rows[0].revenue).toBe(100_000);
    expect(rows[1].revenue).toBe(0);
    expect(rows[4].revenue).toBe(0);
  });

  it("produces zero COGS at a 100% gross margin", () => {
    const rows = projectFiveYear({ ...BASE, grossMarginPct: 100 });
    expect(rows[0].cogs).toBe(0);
    expect(rows[0].grossProfit).toBe(100_000);
  });

  it("accepts per-year depreciation and interest arrays", () => {
    const rows = projectFiveYear({
      ...BASE,
      depreciation: [10_000, 8000, 6000, 4000, 2000],
      interestExpense: [9000, 7500, 6000, 4500, 3000],
    });
    expect(rows.map((row) => row.depreciation)).toEqual([
      10_000, 8000, 6000, 4000, 2000,
    ]);
    expect(rows.map((row) => row.interestExpense)).toEqual([
      9000, 7500, 6000, 4500, 3000,
    ]);
    // Year 1: ebitda 20,000 - 10,000 - 9,000 = 1,000 pretax; tax 210; net 790.
    expect(rows[0].taxes).toBe(210);
    expect(rows[0].netIncome).toBe(790);
  });

  it("throws when a per-year array is the wrong length", () => {
    expect(() =>
      projectFiveYear({ ...BASE, depreciation: [1000, 2000] }),
    ).toThrow(/"depreciation" must have exactly 5 entries/);
  });

  it("throws on a negative entry inside a per-year array", () => {
    expect(() =>
      projectFiveYear({
        ...BASE,
        interestExpense: [1000, 2000, -1, 4000, 5000],
      }),
    ).toThrow(/"interestExpense\[2\]" must not be negative/);
  });

  it("throws when a per-year input is neither a number nor an array", () => {
    expect(() =>
      projectFiveYear({ ...BASE, depreciation: "5000" as unknown as number }),
    ).toThrow(/"depreciation" must be a number or an array of numbers/);
  });

  it("throws on a gross margin above 100%", () => {
    expect(() => projectFiveYear({ ...BASE, grossMarginPct: 101 })).toThrow(
      /"grossMarginPct" must be between 0 and 100/,
    );
  });

  it("throws on a negative gross margin", () => {
    expect(() => projectFiveYear({ ...BASE, grossMarginPct: -1 })).toThrow(
      FinanceInputError,
    );
  });

  it("throws on a growth rate below -100%", () => {
    expect(() => projectFiveYear({ ...BASE, growthRatePct: -101 })).toThrow(
      /"growthRatePct" must be >= -100/,
    );
  });

  it("throws on a tax rate outside 0..100", () => {
    expect(() => projectFiveYear({ ...BASE, taxRatePct: 101 })).toThrow(
      /"taxRatePct" must be between 0 and 100/,
    );
    expect(() => projectFiveYear({ ...BASE, taxRatePct: -1 })).toThrow(
      FinanceInputError,
    );
  });

  it("throws on negative starting revenue or opex", () => {
    expect(() => projectFiveYear({ ...BASE, startingRevenue: -1 })).toThrow(
      /"startingRevenue" must not be negative/,
    );
    expect(() => projectFiveYear({ ...BASE, opexStart: -1 })).toThrow(
      /"opexStart" must not be negative/,
    );
  });

  it("throws on non-finite inputs", () => {
    expect(() =>
      projectFiveYear({ ...BASE, startingRevenue: Number.NaN }),
    ).toThrow(/"startingRevenue" must be a finite number/);
  });
});

describe("projectYears", () => {
  it("honours an explicit horizon", () => {
    const rows = projectYears({ ...BASE, years: 3 });
    expect(rows).toHaveLength(3);
    expect(rows[2].revenue).toBe(144_000);
  });

  it("requires per-year arrays to match the explicit horizon", () => {
    expect(() =>
      projectYears({ ...BASE, years: 3, depreciation: [1, 2, 3, 4, 5] }),
    ).toThrow(/must have exactly 3 entries/);
  });

  it("throws on a zero or fractional horizon", () => {
    expect(() => projectYears({ ...BASE, years: 0 })).toThrow(
      /"years" must be greater than 0/,
    );
    expect(() => projectYears({ ...BASE, years: 2.5 })).toThrow(
      /"years" must be a whole number/,
    );
  });
});

describe("projection", () => {
  it("wraps the rows in the contract envelope", () => {
    const result = projection({ ...BASE, years: 5 });
    expect(result.years).toEqual(projectFiveYear(BASE));
  });
});
