import type { AmortizationRow, AmortizationSchedule } from "@repo/contracts";

import {
  assertNonNegative,
  assertPositiveInteger,
  FinanceModelError,
} from "./errors.js";
import { roundMoney } from "./money.js";

/** Inputs to {@link monthlyPayment} and {@link amortizationSchedule}. */
export interface AmortizationInput {
  /** Amount borrowed, in whole currency units. Must be `>= 0`. */
  principal: number;
  /**
   * Nominal ANNUAL interest rate as a PERCENT — `11.5` means 11.5%.
   *
   * The result object reports `annualRate` as a FRACTION (`0.115`), matching
   * `AmortizationScheduleSchema`. Percent in, fraction out, deliberately: every
   * caller-facing input in this package is a percent so nobody has to remember
   * which convention a given function uses.
   */
  annualRatePct: number;
  /** Number of monthly payments. Must be a positive whole number. */
  termMonths: number;
}

/**
 * Level monthly payment for a fully-amortising loan.
 *
 * `payment = P * i / (1 - (1 + i)^-n)` where `i = annualRate / 12`.
 * At `i === 0` the formula is `0/0`; the zero-rate loan is handled explicitly
 * as `P / n` rather than being allowed to produce `NaN`.
 *
 * @returns the payment rounded to cents.
 * @throws {import("./errors.js").FinanceInputError} if `principal` is negative
 * or non-finite, `annualRatePct` is non-finite or negative, or `termMonths` is
 * not a positive whole number.
 * @throws {FinanceModelError} if the rate is negative enough that the
 * annuity denominator collapses (no finite level payment exists).
 */
export function monthlyPayment(input: AmortizationInput): number {
  const { principal, monthlyRate, termMonths } = normalise(
    "monthlyPayment",
    input,
  );
  return roundMoney(
    rawMonthlyPayment("monthlyPayment", principal, monthlyRate, termMonths),
  );
}

/**
 * Build a full level-payment amortization schedule.
 *
 * Each row reports the interest and principal for that period and the balance
 * REMAINING after it. The final row's principal is set to whatever balance is
 * left so the schedule closes at exactly `0` — the cent or two of accumulated
 * rounding lands on the last payment, which is what a lender's table does.
 * Consequently the last row's `payment` may differ from the others by a few
 * cents. That is correct, not a defect.
 *
 * @returns an `AmortizationSchedule` conforming to
 * `AmortizationScheduleSchema` in `@repo/contracts`, with `rows.length ===
 * termMonths`.
 * @throws {import("./errors.js").FinanceInputError} on negative/non-finite
 * principal, non-finite or negative rate, or non-positive/non-integer term.
 * @throws {FinanceModelError} if a period's interest exceeds its payment
 * (negative amortization — the balance would never reach zero).
 */
export function amortizationSchedule(
  input: AmortizationInput,
): AmortizationSchedule {
  const { principal, monthlyRate, termMonths, annualRate } = normalise(
    "amortizationSchedule",
    input,
  );

  const payment = roundMoney(
    rawMonthlyPayment(
      "amortizationSchedule",
      principal,
      monthlyRate,
      termMonths,
    ),
  );

  const rows: AmortizationRow[] = [];
  let balance = roundMoney(principal);
  let cumulativeInterest = 0;
  let totalPaid = 0;

  for (let period = 1; period <= termMonths; period += 1) {
    const interest = roundMoney(balance * monthlyRate);
    const isFinalPeriod = period === termMonths;

    let principalPortion = isFinalPeriod
      ? balance
      : roundMoney(payment - interest);
    let periodPayment = isFinalPeriod
      ? roundMoney(principalPortion + interest)
      : payment;

    // Negative amortization: the payment does not cover the interest, so the
    // balance would never reach zero. Only meaningful while a balance remains —
    // a zero-principal loan retires zero principal per period quite correctly.
    if (!isFinalPeriod && principalPortion <= 0 && balance > 0) {
      throw new FinanceModelError(
        "amortizationSchedule",
        `period ${period} interest (${interest}) is not less than the level payment (${payment}), ` +
          `so the balance never amortises. principal=${principal}, annualRatePct=${input.annualRatePct}, ` +
          `termMonths=${termMonths}. Lengthen the term or lower the rate.`,
      );
    }

    // Guard the penultimate-period case where rounding leaves less principal
    // outstanding than the level payment would retire.
    if (!isFinalPeriod && principalPortion > balance) {
      principalPortion = balance;
      periodPayment = roundMoney(principalPortion + interest);
    }

    balance = roundMoney(balance - principalPortion);
    cumulativeInterest = roundMoney(cumulativeInterest + interest);
    totalPaid = roundMoney(totalPaid + periodPayment);

    rows.push({
      period,
      payment: periodPayment,
      principal: principalPortion,
      interest,
      balance,
      cumulativeInterest,
    });
  }

  return {
    principal: roundMoney(principal),
    annualRate,
    termMonths,
    monthlyPayment: payment,
    totalInterest: cumulativeInterest,
    totalPaid,
    rows,
  };
}

/**
 * The schedule's rows alone.
 *
 * Convenience for chart elements that plot a balance or interest curve and have
 * no use for the summary block.
 *
 * @throws the same errors as {@link amortizationSchedule}.
 */
export function amortizationRows(input: AmortizationInput): AmortizationRow[] {
  return amortizationSchedule(input).rows;
}

interface NormalisedAmortizationInput {
  principal: number;
  annualRate: number;
  monthlyRate: number;
  termMonths: number;
}

function normalise(
  calculator: string,
  input: AmortizationInput,
): NormalisedAmortizationInput {
  const principal = assertNonNegative(calculator, "principal", input.principal);
  // Negative nominal rates exist in sovereign debt but never in SBA/EB-5
  // lending, and they invert every assumption in the schedule loop below.
  const annualRatePct = assertNonNegative(
    calculator,
    "annualRatePct",
    input.annualRatePct,
  );
  const termMonths = assertPositiveInteger(
    calculator,
    "termMonths",
    input.termMonths,
  );

  const annualRate = annualRatePct / 100;
  return { principal, annualRate, monthlyRate: annualRate / 12, termMonths };
}

function rawMonthlyPayment(
  calculator: string,
  principal: number,
  monthlyRate: number,
  termMonths: number,
): number {
  if (principal === 0) return 0;
  if (monthlyRate === 0) return principal / termMonths;

  const growth = (1 + monthlyRate) ** termMonths;
  const denominator = 1 - 1 / growth;
  if (!Number.isFinite(growth) || denominator <= 0) {
    throw new FinanceModelError(
      calculator,
      `the annuity factor is degenerate for monthlyRate=${monthlyRate} over ${termMonths} periods; ` +
        `no finite level payment exists.`,
    );
  }
  return (principal * monthlyRate) / denominator;
}
