import { assertNonNegative, assertPositive } from "./errors.js";
import { roundTo } from "./money.js";

/** Decimal places a runway figure is reported to. */
export const RUNWAY_DECIMALS = 1;

/** Inputs to {@link runwayMonths}. */
export interface RunwayInput {
  /** Unrestricted cash available today, in whole currency units. `>= 0`. */
  cashOnHand: number;
  /**
   * Average NET cash burned per month, as a POSITIVE number.
   *
   * Must be `> 0`. A business that is cash-flow positive has no runway figure —
   * it has infinite runway, which is not a number and must not be drawn as one.
   * Callers holding a negative burn (i.e. a profit) must not call this.
   */
  monthlyBurn: number;
}

/**
 * Months of runway: `cashOnHand / monthlyBurn`.
 *
 * @returns months, rounded to one decimal place.
 * @throws {import("./errors.js").FinanceInputError} if `cashOnHand` is
 * non-finite or negative, or if `monthlyBurn` is non-finite or `<= 0`. Zero
 * burn is division by zero and a negative burn is a profit; neither has a
 * finite runway, and returning `Infinity` would render as a blank label.
 */
export function runwayMonths(input: RunwayInput): number {
  const cashOnHand = assertNonNegative(
    "runwayMonths",
    "cashOnHand",
    input.cashOnHand,
  );
  const monthlyBurn = assertPositive(
    "runwayMonths",
    "monthlyBurn",
    input.monthlyBurn,
  );
  return roundTo(cashOnHand / monthlyBurn, RUNWAY_DECIMALS);
}
