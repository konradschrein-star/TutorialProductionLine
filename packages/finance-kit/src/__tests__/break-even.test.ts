import { describe, expect, it } from "vitest";

import { breakEven } from "../break-even.js";
import { FinanceInputError, FinanceModelError } from "../errors.js";

describe("breakEven", () => {
  it("computes a hand-checkable break-even", () => {
    // margin = 25 - 15 = 10; units = 10,000 / 10 = 1,000; revenue = 25,000.
    const result = breakEven({
      fixedCosts: 10_000,
      pricePerUnit: 25,
      variableCostPerUnit: 15,
    });
    expect(result).toEqual({
      fixedCosts: 10_000,
      pricePerUnit: 25,
      variableCostPerUnit: 15,
      contributionMargin: 10,
      contributionMarginRatio: 0.4,
      breakEvenUnits: 1000,
      breakEvenRevenue: 25_000,
    });
  });

  it("carries the derivation, which is what the video animates", () => {
    const result = breakEven({
      fixedCosts: 4500,
      pricePerUnit: 12,
      variableCostPerUnit: 4.5,
    });
    // margin 7.50, ratio 0.625, units 600, revenue 7,200.
    expect(result.contributionMargin).toBe(7.5);
    expect(result.contributionMarginRatio).toBe(0.625);
    expect(result.breakEvenUnits).toBe(600);
    expect(result.breakEvenRevenue).toBe(7200);
    // Revenue must equal units x price, and also fixed costs / margin ratio.
    expect(result.breakEvenRevenue).toBeCloseTo(
      result.breakEvenUnits * result.pricePerUnit,
      2,
    );
    expect(result.breakEvenRevenue).toBeCloseTo(
      result.fixedCosts / result.contributionMarginRatio,
      2,
    );
  });

  it("reports fractional units rather than rounding to a whole unit", () => {
    // 1,000 / 3 = 333.333...
    const result = breakEven({
      fixedCosts: 1000,
      pricePerUnit: 4,
      variableCostPerUnit: 1,
    });
    expect(result.breakEvenUnits).toBe(333.33);
  });

  it("handles zero variable cost", () => {
    const result = breakEven({
      fixedCosts: 5000,
      pricePerUnit: 50,
      variableCostPerUnit: 0,
    });
    expect(result.contributionMargin).toBe(50);
    expect(result.contributionMarginRatio).toBe(1);
    expect(result.breakEvenUnits).toBe(100);
  });

  it("breaks even at zero units when there are no fixed costs", () => {
    const result = breakEven({
      fixedCosts: 0,
      pricePerUnit: 10,
      variableCostPerUnit: 4,
    });
    expect(result.breakEvenUnits).toBe(0);
    expect(result.breakEvenRevenue).toBe(0);
  });

  it("throws instead of returning Infinity when the margin is zero", () => {
    expect(() =>
      breakEven({
        fixedCosts: 10_000,
        pricePerUnit: 15,
        variableCostPerUnit: 15,
      }),
    ).toThrow(FinanceModelError);
    expect(() =>
      breakEven({
        fixedCosts: 10_000,
        pricePerUnit: 15,
        variableCostPerUnit: 15,
      }),
    ).toThrow(/no break-even point at any volume/);
  });

  it("throws when the margin is negative", () => {
    expect(() =>
      breakEven({
        fixedCosts: 10_000,
        pricePerUnit: 10,
        variableCostPerUnit: 15,
      }),
    ).toThrow(FinanceModelError);
  });

  it("throws when the margin ratio is too thin to represent", () => {
    // A margin that rounds away at 6dp would violate the contract's `> 0`
    // invariant and draw a zero-height bar.
    expect(() =>
      breakEven({
        fixedCosts: 1000,
        pricePerUnit: 1_000_000,
        variableCostPerUnit: 999_999.9,
      }),
    ).toThrow(/too thin to represent/);
  });

  it("throws on a zero price", () => {
    expect(() =>
      breakEven({
        fixedCosts: 10_000,
        pricePerUnit: 0,
        variableCostPerUnit: 0,
      }),
    ).toThrow(/"pricePerUnit" must be greater than 0/);
  });

  it("throws on negative fixed costs", () => {
    expect(() =>
      breakEven({ fixedCosts: -1, pricePerUnit: 10, variableCostPerUnit: 5 }),
    ).toThrow(/"fixedCosts" must not be negative/);
  });

  it("throws on a negative variable cost", () => {
    expect(() =>
      breakEven({ fixedCosts: 100, pricePerUnit: 10, variableCostPerUnit: -1 }),
    ).toThrow(/"variableCostPerUnit" must not be negative/);
  });

  it("throws on non-finite inputs", () => {
    expect(() =>
      breakEven({
        fixedCosts: Number.POSITIVE_INFINITY,
        pricePerUnit: 10,
        variableCostPerUnit: 5,
      }),
    ).toThrow(FinanceInputError);
  });
});
