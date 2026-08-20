import type { Projection, ProjectionYear } from "@repo/contracts";

import {
  FinanceInputError,
  assertGrowthPct,
  assertInRange,
  assertNonNegative,
  assertPositiveInteger,
} from "./errors.js";
import { roundMoney } from "./money.js";

/** The default horizon: lenders and USCIS both expect five years. */
export const PROJECTION_DEFAULT_YEARS = 5;

/**
 * A per-year figure the caller must supply: either one number applied to every
 * year, or one number per year (length must equal the horizon exactly).
 */
export type PerYearAmount = number | readonly number[];

/** Inputs to {@link projectFiveYear} / {@link projectYears}. */
export interface ProjectionInput {
  /** Year-1 revenue, in whole currency units. `>= 0`. */
  startingRevenue: number;
  /** Year-over-year revenue growth as a PERCENT (`20` = +20%/yr). `>= -100`. */
  growthRatePct: number;
  /** Gross margin as a PERCENT of revenue, `0..100`. Drives COGS. */
  grossMarginPct: number;
  /** Year-1 operating expenses, in whole currency units. `>= 0`. */
  opexStart: number;
  /** Year-over-year opex growth as a PERCENT. `>= -100`. */
  opexGrowthPct: number;

  /**
   * Depreciation & amortisation per year. **Required.**
   *
   * `ProjectionYearSchema` carries D&A, interest and tax, so this package
   * cannot emit a conforming year without them. They are required inputs
   * rather than assumed defaults: a made-up depreciation figure on a lender's
   * projection is exactly the class of invented number this format exists to
   * eliminate.
   */
  depreciation: PerYearAmount;
  /** Interest expense per year, in whole currency units. **Required.** */
  interestExpense: PerYearAmount;
  /**
   * Effective income tax rate as a PERCENT, `0..100`. **Required.**
   *
   * Applied to positive pre-tax income only. Loss years carry `taxes: 0` — this
   * model has NO loss carry-forward, so a loss does not generate a tax credit
   * against a later year. That is a stated modelling rule, not a gap: any video
   * asserting a specific tax outcome needs its own source under the scene
   * schema's source gate.
   */
  taxRatePct: number;
}

/** {@link projectYears} takes the horizon explicitly. */
export interface ProjectionYearsInput extends ProjectionInput {
  /** Number of years to project. Positive whole number. */
  years: number;
}

/**
 * Project a five-year P&L.
 *
 * Revenue compounds from `startingRevenue` at `growthRatePct`; COGS falls out
 * of `grossMarginPct`; opex compounds independently at `opexGrowthPct`. EBITDA
 * is gross profit less opex. Net income is EBITDA less D&A, less interest, less
 * tax on positive pre-tax income.
 *
 * @returns exactly five `ProjectionYear` rows, `year` 1-indexed and ascending.
 * @throws {import("./errors.js").FinanceInputError} on any non-finite input, a
 * negative `startingRevenue`/`opexStart`, a `grossMarginPct` outside `0..100`,
 * a `taxRatePct` outside `0..100`, a growth rate below `-100`, a negative
 * per-year D&A or interest figure, or a per-year array whose length does not
 * equal the horizon.
 */
export function projectFiveYear(input: ProjectionInput): ProjectionYear[] {
  return projectYears({ ...input, years: PROJECTION_DEFAULT_YEARS });
}

/**
 * Project a P&L over an arbitrary horizon. See {@link projectFiveYear} for the
 * model and the thrown errors; the only difference is the explicit `years`.
 */
export function projectYears(input: ProjectionYearsInput): ProjectionYear[] {
  const calculator = "projectYears";

  const years = assertPositiveInteger(calculator, "years", input.years);
  const startingRevenue = assertNonNegative(
    calculator,
    "startingRevenue",
    input.startingRevenue,
  );
  const growthRatePct = assertGrowthPct(
    calculator,
    "growthRatePct",
    input.growthRatePct,
  );
  const grossMarginPct = assertInRange(
    calculator,
    "grossMarginPct",
    input.grossMarginPct,
    0,
    100,
  );
  const opexStart = assertNonNegative(calculator, "opexStart", input.opexStart);
  const opexGrowthPct = assertGrowthPct(
    calculator,
    "opexGrowthPct",
    input.opexGrowthPct,
  );
  const taxRatePct = assertInRange(
    calculator,
    "taxRatePct",
    input.taxRatePct,
    0,
    100,
  );

  const depreciation = expandPerYear(
    calculator,
    "depreciation",
    input.depreciation,
    years,
  );
  const interestExpense = expandPerYear(
    calculator,
    "interestExpense",
    input.interestExpense,
    years,
  );

  const revenueGrowth = 1 + growthRatePct / 100;
  const opexGrowth = 1 + opexGrowthPct / 100;
  const marginFraction = grossMarginPct / 100;
  const taxFraction = taxRatePct / 100;

  const rows: ProjectionYear[] = [];

  for (let index = 0; index < years; index += 1) {
    const revenue = roundMoney(startingRevenue * revenueGrowth ** index);
    const cogs = roundMoney(revenue * (1 - marginFraction));
    const grossProfit = roundMoney(revenue - cogs);
    const operatingExpenses = roundMoney(opexStart * opexGrowth ** index);
    const ebitda = roundMoney(grossProfit - operatingExpenses);

    const yearDepreciation = depreciation[index];
    const yearInterest = interestExpense[index];

    const preTaxIncome = roundMoney(ebitda - yearDepreciation - yearInterest);
    const taxes = preTaxIncome > 0 ? roundMoney(preTaxIncome * taxFraction) : 0;
    const netIncome = roundMoney(preTaxIncome - taxes);

    rows.push({
      year: index + 1,
      revenue,
      cogs,
      grossProfit,
      operatingExpenses,
      ebitda,
      depreciation: yearDepreciation,
      interestExpense: yearInterest,
      taxes,
      netIncome,
    });
  }

  return rows;
}

/**
 * The same projection wrapped in the `Projection` envelope from
 * `@repo/contracts`, for callers handing a whole projection to one element.
 *
 * @throws the same errors as {@link projectYears}.
 */
export function projection(input: ProjectionYearsInput): Projection {
  return { years: projectYears(input) };
}

/**
 * Normalise a scalar-or-array per-year input into a rounded array of exactly
 * `years` non-negative amounts.
 */
function expandPerYear(
  calculator: string,
  field: string,
  value: unknown,
  years: number,
): number[] {
  if (typeof value === "number") {
    const amount = roundMoney(assertNonNegative(calculator, field, value));
    return new Array<number>(years).fill(amount);
  }

  if (!Array.isArray(value)) {
    throw new FinanceInputError(
      calculator,
      field,
      value,
      "must be a number or an array of numbers, one per projected year",
    );
  }

  // Widen away the `any[]` that `Array.isArray` produces: entries stay
  // `unknown` and go through the same guard as every other input.
  const entries: readonly unknown[] = value;

  if (entries.length !== years) {
    throw new FinanceInputError(
      calculator,
      field,
      value,
      `must have exactly ${years} entries to match the projection horizon`,
    );
  }

  return entries.map((entry, index) =>
    roundMoney(assertNonNegative(calculator, `${field}[${index}]`, entry)),
  );
}
