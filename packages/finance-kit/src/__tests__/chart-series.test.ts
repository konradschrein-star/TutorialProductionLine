import { describe, expect, it } from "vitest";

import { amortizationRows } from "../amortization.js";
import {
  amortizationBalanceSeries,
  amortizationCumulativeInterestSeries,
  projectionSeries,
  toChartSeries,
} from "../chart-series.js";
import { FinanceInputError } from "../errors.js";
import { projectFiveYear } from "../projection.js";

const PROJECTION_INPUT = {
  startingRevenue: 100_000,
  growthRatePct: 20,
  grossMarginPct: 60,
  opexStart: 40_000,
  opexGrowthPct: 10,
  depreciation: 5000,
  interestExpense: 3000,
  taxRatePct: 21,
} as const;

describe("toChartSeries", () => {
  it("projects rows into parallel points and labels", () => {
    const rows = [{ n: 1 }, { n: 2 }, { n: 3 }];
    const series = toChartSeries(rows, {
      value: (row) => row.n * 10,
      label: (row) => `#${row.n}`,
    });

    expect(series.points).toEqual([10, 20, 30]);
    expect(series.labels).toEqual(["#1", "#2", "#3"]);
    expect(series.points).toHaveLength(series.labels.length);
  });

  it("passes the row index to both pickers", () => {
    const series = toChartSeries(["a", "b"], {
      value: (_row, index) => index,
      label: (row, index) => `${row}${index}`,
    });
    expect(series.points).toEqual([0, 1]);
    expect(series.labels).toEqual(["a0", "b1"]);
  });

  it("preserves negative values rather than clamping them", () => {
    const series = toChartSeries([-5, 0, 5], {
      value: (row) => row,
      label: (row) => String(row),
    });
    expect(series.points).toEqual([-5, 0, 5]);
  });

  it("throws on an empty row set", () => {
    expect(() =>
      toChartSeries([], { value: () => 1, label: () => "x" }),
    ).toThrow(/must contain at least one row/);
  });

  it("throws when rows is not an array", () => {
    expect(() =>
      toChartSeries("not an array" as unknown as readonly number[], {
        value: () => 1,
        label: () => "x",
      }),
    ).toThrow(/"rows" must be an array/);
  });

  it("throws when a picked value is not finite, naming the row index", () => {
    expect(() =>
      toChartSeries([1, 2, 3], {
        value: (row) => (row === 2 ? Number.NaN : row),
        label: (row) => String(row),
      }),
    ).toThrow(/pick\.value\(rows\[1\]\)" must return a finite number/);

    expect(() =>
      toChartSeries([1], {
        value: () => Number.POSITIVE_INFINITY,
        label: () => "x",
      }),
    ).toThrow(FinanceInputError);
  });

  it("throws when a picked label is empty or not a string", () => {
    expect(() =>
      toChartSeries([1, 2], {
        value: (row) => row,
        label: (row) => (row === 2 ? "" : "ok"),
      }),
    ).toThrow(/pick\.label\(rows\[1\]\)" must return a non-empty string/);

    expect(() =>
      toChartSeries([1], {
        value: (row) => row,
        label: () => 7 as unknown as string,
      }),
    ).toThrow(/must return a non-empty string/);
  });
});

describe("amortizationBalanceSeries", () => {
  it("plots the declining balance, one point per period", () => {
    const rows = amortizationRows({
      principal: 100_000,
      annualRatePct: 6,
      termMonths: 12,
    });
    const series = amortizationBalanceSeries(rows);

    expect(series.points).toHaveLength(12);
    expect(series.labels).toHaveLength(12);
    expect(series.points[0]).toBe(91_893.36);
    expect(series.points[11]).toBe(0);
    expect(series.labels[0]).toBe("1");
    expect(series.labels[11]).toBe("12");
  });
});

describe("amortizationCumulativeInterestSeries", () => {
  it("plots a non-decreasing cumulative interest curve", () => {
    const rows = amortizationRows({
      principal: 100_000,
      annualRatePct: 6,
      termMonths: 12,
    });
    const series = amortizationCumulativeInterestSeries(rows);

    expect(series.points[0]).toBe(500);
    expect(series.points[11]).toBe(3279.73);
    for (let i = 1; i < series.points.length; i += 1) {
      expect(series.points[i]).toBeGreaterThanOrEqual(series.points[i - 1]);
    }
  });
});

describe("projectionSeries", () => {
  const years = projectFiveYear(PROJECTION_INPUT);

  it("plots revenue labelled by year", () => {
    const series = projectionSeries(years, "revenue");
    expect(series.points).toEqual([
      100_000, 120_000, 144_000, 172_800, 207_360,
    ]);
    expect(series.labels).toEqual([
      "Year 1",
      "Year 2",
      "Year 3",
      "Year 4",
      "Year 5",
    ]);
  });

  it("plots every supported metric", () => {
    expect(projectionSeries(years, "cogs").points[0]).toBe(40_000);
    expect(projectionSeries(years, "grossProfit").points[0]).toBe(60_000);
    expect(projectionSeries(years, "operatingExpenses").points[0]).toBe(40_000);
    expect(projectionSeries(years, "ebitda").points[0]).toBe(20_000);
    expect(projectionSeries(years, "netIncome").points[0]).toBe(9480);
  });

  it("throws on an unknown metric rather than plotting undefined", () => {
    expect(() =>
      projectionSeries(years, "profitMargin" as unknown as "revenue"),
    ).toThrow(/unhandled projection metric/);
  });
});
