import type { Eb5JobsResult } from "@repo/contracts";

import { assertPositive, assertPositiveInteger } from "./errors.js";
import { roundMoney, roundTo } from "./money.js";

/**
 * Statutory jobs each EB-5 investor must create: 10.
 *
 * Source: 8 U.S.C. § 1153(b)(5)(A)(ii) — the investment must "create full-time
 * employment for not fewer than 10 United States citizens" or other qualifying
 * workers, per investor. This number has been 10 since the program was created
 * in 1990 and is the one figure the whole EB-5 business plan turns on.
 */
export const EB5_JOBS_REQUIRED_PER_INVESTOR = 10;

/**
 * Minimum period the jobs must be sustained: 2 years.
 *
 * Source: 8 C.F.R. § 204.6(j)(4)(i) — the business plan must show the jobs will
 * be created "within the next two years". A plan that models the headcount but
 * not its persistence does not satisfy the requirement, so this package refuses
 * to report a pass without it.
 */
export const EB5_MIN_SUSTAINED_YEARS = 2;

/** Decimal places the FTE count is reported to before the pass/fail comparison. */
export const EB5_FTE_DECIMALS = 2;

/** Inputs to {@link eb5Jobs}. */
export interface Eb5JobsInput {
  /** Projected annual revenue the headcount model is driven from. `> 0`. */
  annualRevenue: number;
  /**
   * Revenue supported per full-time-equivalent employee. `> 0`.
   *
   * This is the plan's own productivity assumption and must be sourced — an
   * industry benchmark, the operator's own figures, an economist's report. It
   * is a required input precisely because it is the number a weak EB-5 plan
   * invents.
   */
  revenuePerEmployee: number;
  /** How many years the plan sustains this headcount for. `> 0`, whole years. */
  sustainedYears: number;
  /** Number of EB-5 investors in the project. `> 0`, whole. */
  investorCount: number;
  /** Capital each investor contributes, in whole currency units. `> 0`. */
  investmentPerInvestor: number;
}

/** The contract result plus the sustainment test, which the contract omits. */
export interface Eb5JobsComputation extends Eb5JobsResult {
  /** Years the plan sustains the headcount for, as supplied. */
  sustainedYears: number;
  /** Statutory minimum sustainment period ({@link EB5_MIN_SUSTAINED_YEARS}). */
  minSustainedYears: number;
  /** `sustainedYears >= minSustainedYears`. */
  meetsSustainmentPeriod: boolean;
  /** `jobsCreated >= jobsRequired`, ignoring sustainment. */
  meetsJobCount: boolean;
}

/**
 * The arithmetic behind the EB-5 ten-job requirement.
 *
 * `jobsCreated = annualRevenue / revenuePerEmployee`;
 * `jobsRequired = 10 × investorCount`.
 *
 * `meetsRequirement` is BOTH tests: enough jobs AND sustained long enough. A
 * plan that hits the headcount for one year does not qualify, and reporting it
 * as a pass would be the single most damaging error this package could make.
 * The two sub-tests are carried separately so an element can show which one
 * failed.
 *
 * The comparison is made on the FTE count rounded to
 * {@link EB5_FTE_DECIMALS} — the same value that is displayed — so what the
 * viewer sees and what the pass/fail badge says can never disagree.
 *
 * @throws {import("./errors.js").FinanceInputError} if any input is non-finite,
 * if `annualRevenue`, `revenuePerEmployee` or `investmentPerInvestor` is `<= 0`,
 * or if `sustainedYears`/`investorCount` is not a positive whole number.
 */
export function eb5Jobs(input: Eb5JobsInput): Eb5JobsComputation {
  const calculator = "eb5Jobs";

  const annualRevenue = assertPositive(
    calculator,
    "annualRevenue",
    input.annualRevenue,
  );
  const revenuePerEmployee = assertPositive(
    calculator,
    "revenuePerEmployee",
    input.revenuePerEmployee,
  );
  const sustainedYears = assertPositiveInteger(
    calculator,
    "sustainedYears",
    input.sustainedYears,
  );
  const investorCount = assertPositiveInteger(
    calculator,
    "investorCount",
    input.investorCount,
  );
  const investmentPerInvestor = assertPositive(
    calculator,
    "investmentPerInvestor",
    input.investmentPerInvestor,
  );

  const jobsCreated = roundTo(
    annualRevenue / revenuePerEmployee,
    EB5_FTE_DECIMALS,
  );
  const jobsRequired = EB5_JOBS_REQUIRED_PER_INVESTOR * investorCount;

  const meetsJobCount = jobsCreated >= jobsRequired;
  const meetsSustainmentPeriod = sustainedYears >= EB5_MIN_SUSTAINED_YEARS;

  return {
    investmentPerInvestor: roundMoney(investmentPerInvestor),
    investorCount,
    totalInvestment: roundMoney(investmentPerInvestor * investorCount),
    jobsPerInvestor: EB5_JOBS_REQUIRED_PER_INVESTOR,
    jobsRequired,
    jobsCreated,
    meetsRequirement: meetsJobCount && meetsSustainmentPeriod,
    sustainedYears,
    minSustainedYears: EB5_MIN_SUSTAINED_YEARS,
    meetsSustainmentPeriod,
    meetsJobCount,
  };
}
