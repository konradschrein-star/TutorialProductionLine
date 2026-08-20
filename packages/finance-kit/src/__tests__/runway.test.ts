import { describe, expect, it } from "vitest";

import { FinanceInputError } from "../errors.js";
import { runwayMonths } from "../runway.js";

describe("runwayMonths", () => {
  it("computes a hand-checkable runway", () => {
    // 250,000 / 20,000 = 12.5 months
    expect(runwayMonths({ cashOnHand: 250_000, monthlyBurn: 20_000 })).toBe(
      12.5,
    );
  });

  it("rounds to one decimal place", () => {
    // 100,000 / 30,000 = 3.333... -> 3.3
    expect(runwayMonths({ cashOnHand: 100_000, monthlyBurn: 30_000 })).toBe(
      3.3,
    );
  });

  it("returns zero when there is no cash", () => {
    expect(runwayMonths({ cashOnHand: 0, monthlyBurn: 5000 })).toBe(0);
  });

  it("throws on a zero burn instead of returning Infinity", () => {
    // Infinite runway is not a number and must not be drawn as one.
    expect(() => runwayMonths({ cashOnHand: 100_000, monthlyBurn: 0 })).toThrow(
      /"monthlyBurn" must be greater than 0/,
    );
  });

  it("throws on a negative burn, which is a profit and has no runway", () => {
    expect(() =>
      runwayMonths({ cashOnHand: 100_000, monthlyBurn: -5000 }),
    ).toThrow(FinanceInputError);
  });

  it("throws on negative cash", () => {
    expect(() => runwayMonths({ cashOnHand: -1, monthlyBurn: 5000 })).toThrow(
      /"cashOnHand" must not be negative/,
    );
  });

  it("throws on non-finite inputs", () => {
    expect(() =>
      runwayMonths({ cashOnHand: Number.NaN, monthlyBurn: 5000 }),
    ).toThrow(/"cashOnHand" must be a finite number/);
    expect(() =>
      runwayMonths({ cashOnHand: 1000, monthlyBurn: Number.POSITIVE_INFINITY }),
    ).toThrow(/"monthlyBurn" must be a finite number/);
  });
});
