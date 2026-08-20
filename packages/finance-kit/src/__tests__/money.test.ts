import { describe, expect, it } from "vitest";

import { MONEY_DECIMALS, roundMoney, roundTo } from "../money.js";

describe("roundMoney", () => {
  it("carries money to two decimal places", () => {
    expect(MONEY_DECIMALS).toBe(2);
    expect(roundMoney(8606.64297070823)).toBe(8606.64);
    expect(roundMoney(1199.1010503055138)).toBe(1199.1);
  });

  it("rounds half away from zero, symmetrically for negatives", () => {
    // Math.round is half-toward-+Infinity: Math.round(-0.5) === -0. A loss year
    // must round the same magnitude as the equivalent profit year.
    expect(roundMoney(0.005)).toBe(0.01);
    expect(roundMoney(-0.005)).toBe(-0.01);
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(-2.675)).toBe(-2.68);
  });

  it("corrects binary representations that sit a hair under the .5 boundary", () => {
    // 1.005 is stored as 1.00499999999999989, so a naive round gives 1.00.
    expect(roundMoney(1.005)).toBe(1.01);
  });

  it("normalises negative zero to zero", () => {
    // -0 serialises to "0" in JSON but Object.is(-0, 0) is false, which makes
    // cache keys built from JSON.stringify disagree with value comparisons.
    expect(Object.is(roundMoney(-0.001), 0)).toBe(true);
    expect(Object.is(roundMoney(-0), 0)).toBe(true);
  });

  it("leaves already-round values untouched", () => {
    expect(roundMoney(100)).toBe(100);
    expect(roundMoney(0)).toBe(0);
    expect(roundMoney(-2500.5)).toBe(-2500.5);
  });

  it("returns non-finite input unchanged rather than producing NaN silently", () => {
    expect(roundMoney(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(roundMoney(Number.NaN))).toBe(true);
  });
});

describe("roundTo", () => {
  it("rounds to the requested precision", () => {
    expect(roundTo(1.23456789, 4)).toBe(1.2346);
    expect(roundTo(1.23456789, 0)).toBe(1);
    expect(roundTo(12.55, 1)).toBe(12.6);
  });

  it("is sign-symmetric and normalises negative zero", () => {
    expect(roundTo(-1.23456789, 4)).toBe(-1.2346);
    expect(Object.is(roundTo(-0.0001, 2), 0)).toBe(true);
  });

  it("returns non-finite input unchanged", () => {
    expect(roundTo(Number.NEGATIVE_INFINITY, 2)).toBe(Number.NEGATIVE_INFINITY);
  });
});
