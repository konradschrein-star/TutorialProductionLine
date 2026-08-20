import type {
  AmortizationRow,
  ChartSeries,
  ProjectionYear,
} from "@repo/contracts";

import { FinanceInputError } from "./errors.js";

/**
 * How to turn one row into one plotted point.
 *
 * Both functions are required. There is deliberately no "label defaults to the
 * index" convenience: an unlabelled axis is the classic silent chart defect,
 * and this package's whole reason to exist is that nothing on screen is
 * guessed.
 */
export interface ChartSeriesPick<TRow> {
  /** The plotted value for this row. Must return a finite number. */
  value: (row: TRow, index: number) => number;
  /** The axis label for this row. Must return a non-empty string. */
  label: (row: TRow, index: number) => string;
}

/**
 * Project any array of finance-kit rows into a `ChartSeries` an MG element can
 * take as props.
 *
 * `points` and `labels` come out the same length by construction, which is the
 * invariant `ChartSeriesSchema` enforces at the contract boundary.
 *
 * @throws {FinanceInputError} if `rows` is empty (a chart with no data is not a
 * chart), if `value` returns a non-finite number for any row, or if `label`
 * returns anything other than a non-empty string. Each message names the row
 * index so the caller can find the bad row.
 */
export function toChartSeries<TRow>(
  rows: readonly TRow[],
  pick: ChartSeriesPick<TRow>,
): ChartSeries {
  if (!Array.isArray(rows)) {
    throw new FinanceInputError(
      "toChartSeries",
      "rows",
      rows,
      "must be an array",
    );
  }
  if (rows.length === 0) {
    throw new FinanceInputError(
      "toChartSeries",
      "rows",
      rows,
      "must contain at least one row — an empty series renders as a blank frame",
    );
  }

  const points: number[] = [];
  const labels: string[] = [];

  rows.forEach((row, index) => {
    const value: unknown = pick.value(row, index);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new FinanceInputError(
        "toChartSeries",
        `pick.value(rows[${index}])`,
        value,
        "must return a finite number",
      );
    }

    const label: unknown = pick.label(row, index);
    if (typeof label !== "string" || label.length === 0) {
      throw new FinanceInputError(
        "toChartSeries",
        `pick.label(rows[${index}])`,
        label,
        "must return a non-empty string",
      );
    }

    points.push(value);
    labels.push(label);
  });

  return { points, labels };
}

/**
 * Plot the remaining balance of an amortization schedule, one point per period,
 * labelled by period number.
 *
 * @throws the same errors as {@link toChartSeries}.
 */
export function amortizationBalanceSeries(
  rows: readonly AmortizationRow[],
): ChartSeries {
  return toChartSeries(rows, {
    value: (row) => row.balance,
    label: (row) => String(row.period),
  });
}

/**
 * Plot cumulative interest paid across an amortization schedule — the shot that
 * makes a 25-year loan land.
 *
 * @throws the same errors as {@link toChartSeries}.
 */
export function amortizationCumulativeInterestSeries(
  rows: readonly AmortizationRow[],
): ChartSeries {
  return toChartSeries(rows, {
    value: (row) => row.cumulativeInterest,
    label: (row) => String(row.period),
  });
}

/** Which line of a projection year to plot. */
export type ProjectionMetric =
  | "revenue"
  | "cogs"
  | "grossProfit"
  | "operatingExpenses"
  | "ebitda"
  | "netIncome";

/**
 * Plot one line of a multi-year projection, labelled `"Year 1"`, `"Year 2"`, …
 *
 * @throws {Error} if `metric` is not a known {@link ProjectionMetric} — the
 * switch is exhaustive with a `never` check.
 * @throws the same errors as {@link toChartSeries}.
 */
export function projectionSeries(
  years: readonly ProjectionYear[],
  metric: ProjectionMetric,
): ChartSeries {
  return toChartSeries(years, {
    value: (year) => selectProjectionMetric(year, metric),
    label: (year) => `Year ${year.year}`,
  });
}

function selectProjectionMetric(
  year: ProjectionYear,
  metric: ProjectionMetric,
): number {
  switch (metric) {
    case "revenue":
      return year.revenue;
    case "cogs":
      return year.cogs;
    case "grossProfit":
      return year.grossProfit;
    case "operatingExpenses":
      return year.operatingExpenses;
    case "ebitda":
      return year.ebitda;
    case "netIncome":
      return year.netIncome;
    default: {
      const exhaustive: never = metric;
      throw new Error(
        `finance-kit projectionSeries: unhandled projection metric ` +
          `${JSON.stringify(exhaustive)}. Add it to ProjectionMetric and to this switch.`,
      );
    }
  }
}
