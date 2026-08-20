/**
 * `@repo/finance-kit` — deterministic finance calculators for BUSINESS_PLAN_HUB.
 *
 * Every number that appears on screen in this format comes from here. The LLM
 * writes the script and chooses WHICH element illustrates a beat; it never
 * invents a figure. That separation is the format's core credibility claim, and
 * this package is the half of it that has to be right.
 *
 * Everything exported is **pure and synchronous**. No IO, no clock, no random,
 * no network — the same inputs always produce byte-identical output, which is
 * also what makes the render segment cache (`cacheKey = hash({element, data,
 * …})`) sound.
 *
 * **Fail closed.** Every calculator validates its inputs and throws
 * `FinanceInputError` or `FinanceModelError` on nonsense. Nothing is clamped,
 * defaulted past missing data, or estimated. A break-even with a non-positive
 * contribution margin throws rather than returning `Infinity`; a zero burn rate
 * throws rather than returning an infinite runway.
 *
 * **Rate convention:** every rate INPUT is a percent (`11.5` = 11.5%). Result
 * objects report fractions (`0.115`) where `@repo/contracts` defines them that
 * way. Percent in, contract out.
 *
 * Result types come from `@repo/contracts/schemas/business-hub-finance.ts`
 * (task F2) so the boundary to the motion-graphic elements (task M3) is a
 * single shared definition.
 */

// Errors and input guards
export { FinanceInputError, FinanceModelError } from "./errors.js";
export {
  assertFinite,
  assertPositive,
  assertNonNegative,
  assertPositiveInteger,
  assertInRange,
  assertGrowthPct,
} from "./errors.js";

// Money rounding
export { MONEY_DECIMALS, roundMoney, roundTo } from "./money.js";

// Amortization
export {
  monthlyPayment,
  amortizationSchedule,
  amortizationRows,
} from "./amortization.js";
export type { AmortizationInput } from "./amortization.js";

// DSCR
export {
  dscr,
  DSCR_THRESHOLD_CONVENTIONAL,
  DSCR_THRESHOLD_SBA_7A,
  DSCR_DECIMALS,
} from "./dscr.js";
export type { DscrInput } from "./dscr.js";

// Break-even
export { breakEven, BREAK_EVEN_UNIT_DECIMALS } from "./break-even.js";
export type { BreakEvenInput } from "./break-even.js";

// Runway
export { runwayMonths, RUNWAY_DECIMALS } from "./runway.js";
export type { RunwayInput } from "./runway.js";

// Projections
export {
  projectFiveYear,
  projectYears,
  projection,
  PROJECTION_DEFAULT_YEARS,
} from "./projection.js";
export type {
  ProjectionInput,
  ProjectionYearsInput,
  PerYearAmount,
} from "./projection.js";

// SBA
export {
  sbaGuarantee,
  sba7aGuarantyPercent,
  SBA_7A_GUARANTY_PERCENT_TIERS,
  SBA_504_DEBENTURE_GUARANTY_PERCENT,
} from "./sba.js";
export type {
  SbaProgram,
  SbaFeeBasis,
  SbaGuaranteeInput,
  SbaGuaranteeResult,
} from "./sba.js";

// EB-5
export {
  eb5Jobs,
  EB5_JOBS_REQUIRED_PER_INVESTOR,
  EB5_MIN_SUSTAINED_YEARS,
  EB5_FTE_DECIMALS,
} from "./eb5.js";
export type { Eb5JobsInput, Eb5JobsComputation } from "./eb5.js";

// Chart series
export {
  toChartSeries,
  amortizationBalanceSeries,
  amortizationCumulativeInterestSeries,
  projectionSeries,
} from "./chart-series.js";
export type { ChartSeriesPick, ProjectionMetric } from "./chart-series.js";

// Re-export the contract result types so consumers need one import, not two.
export type {
  AmortizationRow,
  AmortizationSchedule,
  DscrResult,
  BreakEvenResult,
  ProjectionYear,
  Projection,
  SbaFeeResult,
  Eb5JobsResult,
  ChartSeries,
} from "@repo/contracts";
