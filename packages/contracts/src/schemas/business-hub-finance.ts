import { z } from "zod";

/**
 * BUSINESS_PLAN_HUB — finance output contracts.
 *
 * The typed boundary between `@repo/finance-kit` (task F1, which computes these
 * deterministically) and the motion-graphic elements that draw them (task M3).
 * The LLM never authors any value in this file: it chooses WHICH element
 * illustrates a beat, and finance-kit produces the numbers.
 *
 * Money is plain `number` in whole currency units (dollars, not cents) because
 * these values are drawn on screen, not settled. Every numeric field is
 * `.finite()` — `NaN`/`Infinity` reaching a chart axis produces a blank frame
 * rather than an error, so they are rejected at the boundary instead.
 *
 * Dependency-free beyond zod: bundled into the Remotion browser build.
 */

/** Any finite number — may be negative (a loss, a drawdown). */
const money = () => z.number().finite();

/** A finite number that cannot sensibly be negative (a balance, a cost). */
const nonNegativeMoney = () => z.number().min(0).finite();

/** A ratio expressed as a fraction, e.g. `0.075` for 7.5%. */
const rate = () => z.number().finite();

// ─────────────────────────────────────────────────────────────────────────────
// Amortization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One period of a loan amortization schedule. `period` is 1-based; `balance` is
 * the balance REMAINING after this period's payment, so the final row's balance
 * is 0.
 */
export const AmortizationRowSchema = z.object({
  period: z.number().int().positive(),
  payment: nonNegativeMoney(),
  principal: nonNegativeMoney(),
  interest: nonNegativeMoney(),
  balance: nonNegativeMoney(),
  /** Interest paid from period 1 through this period inclusive. */
  cumulativeInterest: nonNegativeMoney(),
});
export type AmortizationRow = z.infer<typeof AmortizationRowSchema>;

/** A full amortization schedule plus its summary figures. */
export const AmortizationScheduleSchema = z.object({
  principal: nonNegativeMoney(),
  /** Nominal ANNUAL interest rate as a fraction (0.115 = 11.5%). */
  annualRate: rate(),
  termMonths: z.number().int().positive(),
  monthlyPayment: nonNegativeMoney(),
  totalInterest: nonNegativeMoney(),
  totalPaid: nonNegativeMoney(),
  rows: z.array(AmortizationRowSchema).min(1),
});
export type AmortizationSchedule = z.infer<typeof AmortizationScheduleSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// DSCR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Debt Service Coverage Ratio: NOI / annual debt service. `threshold` is the
 * lender's minimum (1.25 for SBA 7(a) under SOP 50 10); `meetsThreshold` is the
 * comparison finance-kit already made, carried so the element does not re-derive
 * a pass/fail from a rounded display value.
 */
export const DscrResultSchema = z.object({
  netOperatingIncome: money(),
  annualDebtService: z.number().gt(0).finite(),
  dscr: z.number().finite(),
  threshold: z.number().gt(0).finite(),
  meetsThreshold: z.boolean(),
});
export type DscrResult = z.infer<typeof DscrResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Break-even
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unit break-even. `contributionMargin` = price - variable cost per unit and
 * must be > 0; a non-positive margin has no break-even point at all, which
 * finance-kit reports as a failure rather than an infinite unit count.
 */
export const BreakEvenResultSchema = z.object({
  fixedCosts: nonNegativeMoney(),
  pricePerUnit: z.number().gt(0).finite(),
  variableCostPerUnit: nonNegativeMoney(),
  contributionMargin: z.number().gt(0).finite(),
  /** contributionMargin / pricePerUnit, 0..1. */
  contributionMarginRatio: z.number().gt(0).max(1).finite(),
  breakEvenUnits: z.number().min(0).finite(),
  breakEvenRevenue: nonNegativeMoney(),
});
export type BreakEvenResult = z.infer<typeof BreakEvenResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Projections
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One year of a P&L projection. `year` is 1-based (year 1 = first full year of
 * operation). Profit lines may be negative — early-year losses are the norm in
 * these plans and must render as such, never clamped to zero.
 */
export const ProjectionYearSchema = z.object({
  year: z.number().int().positive(),
  revenue: nonNegativeMoney(),
  cogs: nonNegativeMoney(),
  grossProfit: money(),
  operatingExpenses: nonNegativeMoney(),
  ebitda: money(),
  depreciation: nonNegativeMoney(),
  interestExpense: nonNegativeMoney(),
  taxes: money(),
  netIncome: money(),
});
export type ProjectionYear = z.infer<typeof ProjectionYearSchema>;

/** A multi-year projection, ordered by ascending `year`. */
export const ProjectionSchema = z.object({
  years: z.array(ProjectionYearSchema).min(1),
});
export type Projection = z.infer<typeof ProjectionSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// SBA fees
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SBA guarantee + fee math for one loan. `guarantyPercent` is a fraction
 * (0.75 = 75%). Anything a video asserts from this must cite sba.gov — the
 * scene schema's source gate enforces that separately.
 */
export const SbaFeeResultSchema = z.object({
  loanAmount: z.number().gt(0).finite(),
  guarantyPercent: z.number().gt(0).max(1).finite(),
  /** loanAmount * guarantyPercent — the dollar amount SBA guarantees. */
  guaranteedAmount: nonNegativeMoney(),
  /** Upfront guaranty fee, charged on the guaranteed portion. */
  guarantyFee: nonNegativeMoney(),
  /** Annual service fee on the outstanding guaranteed balance. */
  annualServiceFee: nonNegativeMoney(),
  /** Every upfront fee summed — what the borrower actually pays at close. */
  totalUpfrontFees: nonNegativeMoney(),
});
export type SbaFeeResult = z.infer<typeof SbaFeeResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// EB-5 job creation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EB-5 job-creation arithmetic. `jobsRequired` is per-investor statutory
 * minimum (10) times `investorCount`; `meetsRequirement` is finance-kit's own
 * comparison, carried so an element never re-derives eligibility from a rounded
 * display value.
 */
export const Eb5JobsResultSchema = z.object({
  investmentPerInvestor: z.number().gt(0).finite(),
  investorCount: z.number().int().positive(),
  totalInvestment: nonNegativeMoney(),
  /** Statutory jobs required per investor (10 under 8 U.S.C. 1153(b)(5)). */
  jobsPerInvestor: z.number().int().positive(),
  jobsRequired: z.number().int().positive(),
  /** Jobs the plan's model produces — may be fractional before rounding. */
  jobsCreated: z.number().min(0).finite(),
  meetsRequirement: z.boolean(),
  // ── The sustainment half of the test (F1 handoff §3) ────────────────────
  // `meetsRequirement` is BOTH tests: headcount AND sustainment for at least
  // two years (8 C.F.R. § 204.6(j)(4)(i)). finance-kit's `Eb5JobsComputation`
  // carries the sub-tests, but zod strips unknown keys, so parsing the result
  // used to DROP them — an element that showed "fails" could not say which
  // half failed, and the sustainment test is the one a viewer will not guess.
  // Optional so an older stored result still parses.
  /** Years the plan sustains the headcount for, as supplied. */
  sustainedYears: z.number().int().positive().optional(),
  /** Statutory minimum sustainment period (2 years). */
  minSustainedYears: z.number().int().positive().optional(),
  /** `sustainedYears >= minSustainedYears`. */
  meetsSustainmentPeriod: z.boolean().optional(),
  /** `jobsCreated >= jobsRequired`, ignoring sustainment. */
  meetsJobCount: z.boolean().optional(),
});
export type Eb5JobsResult = z.infer<typeof Eb5JobsResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Chart series
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The plotted form of any of the above: parallel `points` and `labels` arrays
 * handed straight to a chart element as props.
 *
 * The lengths MUST match. A shorter label array is the classic silent chart
 * defect — the axis renders with blank ticks and nobody notices until the video
 * is published — so it is a parse error here instead.
 */
export const ChartSeriesSchema = z
  .object({
    points: z.array(z.number().finite()).min(1),
    labels: z.array(z.string()).min(1),
  })
  .superRefine((series, ctx) => {
    if (series.points.length !== series.labels.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["labels"],
        message:
          `chart series has ${series.points.length} points but ` +
          `${series.labels.length} labels — every point must be labelled ` +
          `(no blank axis ticks, no truncated series)`,
      });
    }
  });
export type ChartSeries = z.infer<typeof ChartSeriesSchema>;
