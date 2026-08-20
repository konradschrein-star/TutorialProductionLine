import type { BreakEvenResult } from "@repo/contracts";

import {
  FinanceModelError,
  assertNonNegative,
  assertPositive,
} from "./errors.js";
import { roundMoney, roundTo } from "./money.js";

/** Decimal places break-even unit counts are reported to. */
export const BREAK_EVEN_UNIT_DECIMALS = 2;

/** Inputs to {@link breakEven}. */
export interface BreakEvenInput {
  /** Total fixed costs for the period, in whole currency units. `>= 0`. */
  fixedCosts: number;
  /** Selling price of one unit. Must be `> 0`. */
  pricePerUnit: number;
  /** Variable cost to produce/deliver one unit. `>= 0`. */
  variableCostPerUnit: number;
}

/**
 * Unit break-even: `fixedCosts / (price - variableCost)`.
 *
 * @returns a `BreakEvenResult` carrying the contribution margin and margin
 * ratio alongside the answer, because the derivation is what the video shows —
 * the format's strongest asset is animating a number being built rather than
 * asserting it.
 *
 * @throws {import("./errors.js").FinanceInputError} on non-finite inputs,
 * negative `fixedCosts` or `variableCostPerUnit`, or `pricePerUnit <= 0`.
 * @throws {FinanceModelError} if the contribution margin is `<= 0`. A unit sold
 * at or below its variable cost never repays fixed costs, so there is no
 * break-even point. Returning `Infinity` here would render as a blank axis and
 * quietly publish a nonsense chart; the build fails instead.
 */
export function breakEven(input: BreakEvenInput): BreakEvenResult {
  const fixedCosts = assertNonNegative(
    "breakEven",
    "fixedCosts",
    input.fixedCosts,
  );
  const pricePerUnit = assertPositive(
    "breakEven",
    "pricePerUnit",
    input.pricePerUnit,
  );
  const variableCostPerUnit = assertNonNegative(
    "breakEven",
    "variableCostPerUnit",
    input.variableCostPerUnit,
  );

  const contributionMargin = pricePerUnit - variableCostPerUnit;
  if (contributionMargin <= 0) {
    throw new FinanceModelError(
      "breakEven",
      `contribution margin is ${roundMoney(contributionMargin)} ` +
        `(price ${pricePerUnit} - variable cost ${variableCostPerUnit}). ` +
        `A non-positive margin has no break-even point at any volume — every unit sold ` +
        `widens the loss. Fix the unit economics or do not draw this element.`,
    );
  }

  // The ratio is reported to 6 places. A margin thin enough to round away is
  // rejected rather than reported as 0, which would violate the contract's
  // `> 0` invariant and draw a zero-height bar.
  const contributionMarginRatio = roundTo(contributionMargin / pricePerUnit, 6);
  if (contributionMarginRatio <= 0) {
    throw new FinanceModelError(
      "breakEven",
      `contribution margin ratio ${contributionMargin / pricePerUnit} is too thin to represent ` +
        `at 6 decimal places (margin ${contributionMargin} on price ${pricePerUnit}). ` +
        `These unit economics do not survive being drawn.`,
    );
  }

  const exactUnits = fixedCosts / contributionMargin;
  const exactRevenue = exactUnits * pricePerUnit;

  return {
    fixedCosts: roundMoney(fixedCosts),
    pricePerUnit: roundMoney(pricePerUnit),
    variableCostPerUnit: roundMoney(variableCostPerUnit),
    contributionMargin: roundMoney(contributionMargin),
    contributionMarginRatio,
    breakEvenUnits: roundTo(exactUnits, BREAK_EVEN_UNIT_DECIMALS),
    breakEvenRevenue: roundMoney(exactRevenue),
  };
}
