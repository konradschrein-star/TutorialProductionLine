import type { SbaFeeResult } from "@repo/contracts";

import { assertInRange, assertPositive } from "./errors.js";
import { roundMoney } from "./money.js";

/**
 * SBA guarantee and fee arithmetic.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHICH NUMBERS ARE HARDCODED AND WHY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Two classes of number appear in SBA fee math and they are treated
 * differently here:
 *
 * **Guaranty PERCENTAGES are hardcoded.** They are set in statute
 * (15 U.S.C. § 636(a)(2)(A)) and restated in SOP 50 10, and they have been
 * 85%/75% for many years. Encoded below as {@link SBA_7A_GUARANTY_PERCENT_TIERS}.
 *
 * **Fee RATES are NOT hardcoded — they are required inputs.** The 7(a) upfront
 * guaranty fee and the annual service fee are reset by SBA for each fiscal year
 * by Information Notice, and Congress has repeatedly zeroed or altered them for
 * particular loan sizes and fiscal years. Any rate this package baked in would
 * be wrong within twelve months and would be wrong *silently*, on hundreds of
 * published videos, in a subject area that sits next to
 * unauthorised-practice-of-law exposure.
 *
 * So {@link sbaGuarantee} REQUIRES `guarantyFeeRatePct` and
 * `annualServiceFeeRatePct` from the caller. The caller reads them off the
 * current SBA notice — which the scene schema's source gate forces it to cite
 * anyway. This package does the arithmetic and the tier lookup; it does not
 * pretend to know what fiscal year it is.
 *
 * This is a deliberate choice, made under the build brief's instruction: *"do
 * NOT invent rates you are unsure of. If you are not confident of a current
 * statutory number, expose it as a REQUIRED input parameter instead of
 * hardcoding a guess, and document that choice."*
 */

/** The two SBA programs this package computes. */
export type SbaProgram = "7a" | "504";

/** What a given program charges its upfront guaranty fee against. */
export type SbaFeeBasis = "guaranteed-portion" | "debenture";

/**
 * Statutory maximum SBA guaranty percentages for the 7(a) program, by gross
 * loan amount.
 *
 * Source: 15 U.S.C. § 636(a)(2)(A) — 85% of loans not exceeding $150,000, 75%
 * of loans exceeding $150,000. Restated in SOP 50 10, Part 2 ("Lender
 * Requirements"), in the section on the SBA guaranty percentage.
 *
 * Tiers are evaluated in order; the first tier whose `maxLoanAmount` is `>=`
 * the loan amount wins. The final tier is open-ended (`Infinity`).
 */
export const SBA_7A_GUARANTY_PERCENT_TIERS: readonly {
  readonly maxLoanAmount: number;
  readonly guarantyPercent: number;
}[] = [
  { maxLoanAmount: 150_000, guarantyPercent: 0.85 },
  { maxLoanAmount: Number.POSITIVE_INFINITY, guarantyPercent: 0.75 },
];

/**
 * SBA guarantees 100% of the CDC debenture in a 504 project.
 *
 * The three-way 504 split (roughly 50% third-party lender / 40% CDC debenture /
 * 10% borrower equity) describes PROJECT financing, not the guarantee. The
 * debenture itself carries a full SBA guaranty, so for program `"504"` the
 * `loanAmount` passed to {@link sbaGuarantee} is the DEBENTURE amount, not the
 * total project cost.
 *
 * Source: 15 U.S.C. § 697; SOP 50 10, Part 2, 504 loan program section.
 */
export const SBA_504_DEBENTURE_GUARANTY_PERCENT = 1;

/** Inputs to {@link sbaGuarantee}. */
export interface SbaGuaranteeInput {
  /**
   * For `"7a"`: the gross loan amount. For `"504"`: the CDC DEBENTURE amount
   * (not total project cost — see {@link SBA_504_DEBENTURE_GUARANTY_PERCENT}).
   * Must be `> 0`.
   */
  loanAmount: number;
  /** Which program's rules to apply. */
  program: SbaProgram;
  /**
   * Upfront guaranty fee as a PERCENT of the fee basis. **Required — this
   * package does not know the current fiscal year's rate.** See the module
   * doc comment. `0..100`; `0` is legitimate (fees have been waived for some
   * loan sizes in some fiscal years).
   */
  guarantyFeeRatePct: number;
  /**
   * Annual (ongoing) service fee as a PERCENT of the outstanding guaranteed
   * balance. **Required, same reason.** `0..100`.
   */
  annualServiceFeeRatePct: number;
  /**
   * Override the guaranty percentage as a FRACTION (`0.9` = 90%).
   *
   * The tier table is a statutory MAXIMUM and a lender may request less, and
   * certain programs (Export Working Capital, for one) carry different
   * percentages. When omitted, the percentage is derived from
   * {@link SBA_7A_GUARANTY_PERCENT_TIERS} for `"7a"` and from
   * {@link SBA_504_DEBENTURE_GUARANTY_PERCENT} for `"504"`.
   */
  guarantyPercentOverride?: number;
}

/**
 * The contract result plus the derivation the video shows: which tier applied,
 * what the fee was charged against, and at what rate.
 */
export interface SbaGuaranteeResult extends SbaFeeResult {
  /** Program the figures were computed under. */
  program: SbaProgram;
  /** What the upfront guaranty fee was charged against. */
  feeBasis: SbaFeeBasis;
  /** The dollar amount `guarantyFee` was computed from. */
  feeBasisAmount: number;
  /** The dollar amount `annualServiceFee` was computed from. */
  annualServiceFeeBasisAmount: number;
  /** Echo of the caller-supplied upfront fee rate, as a percent. */
  guarantyFeeRatePct: number;
  /** Echo of the caller-supplied annual service fee rate, as a percent. */
  annualServiceFeeRatePct: number;
  /** True when `guarantyPercentOverride` was supplied rather than derived. */
  guarantyPercentWasOverridden: boolean;
}

/**
 * Look up the statutory maximum 7(a) guaranty percentage for a loan amount.
 *
 * @returns a fraction, e.g. `0.85`.
 * @throws {import("./errors.js").FinanceInputError} if `loanAmount` is
 * non-finite or `<= 0`.
 */
export function sba7aGuarantyPercent(loanAmount: number): number {
  const amount = assertPositive(
    "sba7aGuarantyPercent",
    "loanAmount",
    loanAmount,
  );
  for (const tier of SBA_7A_GUARANTY_PERCENT_TIERS) {
    if (amount <= tier.maxLoanAmount) return tier.guarantyPercent;
  }
  // Unreachable: the final tier is open-ended. Kept as an explicit error rather
  // than a fallback value, so a future edit that drops the open tier fails loudly.
  throw new Error(
    `finance-kit sba7aGuarantyPercent: no tier matched loanAmount ${amount}. ` +
      `SBA_7A_GUARANTY_PERCENT_TIERS must end with an open-ended tier.`,
  );
}

/**
 * Compute the SBA guaranteed portion, the upfront guaranty fee, and the annual
 * service fee for one loan.
 *
 * The annual service fee is computed on the guaranteed balance AT ORIGINATION.
 * It is charged on the outstanding guaranteed balance, which declines as the
 * loan amortises, so this figure is the year-one fee and the largest one — pair
 * it with {@link import("./amortization.js").amortizationSchedule} if a video
 * needs the declining series.
 *
 * @throws {import("./errors.js").FinanceInputError} if `loanAmount` is
 * non-finite or `<= 0`, if either fee rate is non-finite or outside `0..100`,
 * or if `guarantyPercentOverride` is supplied outside `(0, 1]`.
 * @throws {Error} if `program` is not a known {@link SbaProgram} — the switch is
 * exhaustive with a `never` check, so an unhandled program is a compile error
 * first and a runtime throw second.
 */
export function sbaGuarantee(input: SbaGuaranteeInput): SbaGuaranteeResult {
  const calculator = "sbaGuarantee";

  const loanAmount = assertPositive(calculator, "loanAmount", input.loanAmount);
  const guarantyFeeRatePct = assertInRange(
    calculator,
    "guarantyFeeRatePct",
    input.guarantyFeeRatePct,
    0,
    100,
  );
  const annualServiceFeeRatePct = assertInRange(
    calculator,
    "annualServiceFeeRatePct",
    input.annualServiceFeeRatePct,
    0,
    100,
  );

  const guarantyPercentWasOverridden =
    input.guarantyPercentOverride !== undefined;
  const derivedGuarantyPercent = defaultGuarantyPercent(
    input.program,
    loanAmount,
  );
  const guarantyPercent = guarantyPercentWasOverridden
    ? assertGuarantyFraction(calculator, input.guarantyPercentOverride)
    : derivedGuarantyPercent;

  const guaranteedAmount = roundMoney(loanAmount * guarantyPercent);
  const feeBasis = feeBasisFor(input.program);

  // 7(a): the upfront fee is charged on the guaranteed (deferred participation)
  //       portion — 15 U.S.C. § 636(a)(18).
  // 504:  the one-time fee is charged on the debenture.
  const feeBasisAmount =
    feeBasis === "guaranteed-portion"
      ? guaranteedAmount
      : roundMoney(loanAmount);
  const annualServiceFeeBasisAmount = feeBasisAmount;

  const guarantyFee = roundMoney(feeBasisAmount * (guarantyFeeRatePct / 100));
  const annualServiceFee = roundMoney(
    annualServiceFeeBasisAmount * (annualServiceFeeRatePct / 100),
  );

  return {
    loanAmount: roundMoney(loanAmount),
    guarantyPercent,
    guaranteedAmount,
    guarantyFee,
    annualServiceFee,
    // The annual service fee is not paid at close, so it is not part of the
    // upfront total. Today the guaranty fee is the only upfront fee this
    // package models; the field exists so packaging/closing fees can join it
    // without changing the shape.
    totalUpfrontFees: guarantyFee,
    program: input.program,
    feeBasis,
    feeBasisAmount,
    annualServiceFeeBasisAmount,
    guarantyFeeRatePct,
    annualServiceFeeRatePct,
    guarantyPercentWasOverridden,
  };
}

function defaultGuarantyPercent(
  program: SbaProgram,
  loanAmount: number,
): number {
  switch (program) {
    case "7a":
      return sba7aGuarantyPercent(loanAmount);
    case "504":
      return SBA_504_DEBENTURE_GUARANTY_PERCENT;
    default: {
      const exhaustive: never = program;
      throw new Error(
        `finance-kit sbaGuarantee: unhandled SBA program ${JSON.stringify(exhaustive)}. ` +
          `Add it to SbaProgram and to every switch in sba.ts.`,
      );
    }
  }
}

function feeBasisFor(program: SbaProgram): SbaFeeBasis {
  switch (program) {
    case "7a":
      return "guaranteed-portion";
    case "504":
      return "debenture";
    default: {
      const exhaustive: never = program;
      throw new Error(
        `finance-kit sbaGuarantee: unhandled SBA program ${JSON.stringify(exhaustive)}. ` +
          `Add it to SbaProgram and to every switch in sba.ts.`,
      );
    }
  }
}

function assertGuarantyFraction(calculator: string, value: unknown): number {
  const fraction = assertInRange(
    calculator,
    "guarantyPercentOverride",
    value,
    0,
    1,
  );
  if (fraction <= 0) {
    // assertInRange admits 0; a zero guaranty is not an SBA loan.
    return assertPositive(calculator, "guarantyPercentOverride", value);
  }
  return fraction;
}
