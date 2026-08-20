import { describe, expect, it } from "vitest";

import {
  DSCR_THRESHOLD_CONVENTIONAL,
  DSCR_THRESHOLD_SBA_7A,
  dscr,
} from "../dscr.js";
import { FinanceInputError } from "../errors.js";

describe("dscr", () => {
  it("pins the two conventional thresholds", () => {
    expect(DSCR_THRESHOLD_CONVENTIONAL).toBe(1.15);
    expect(DSCR_THRESHOLD_SBA_7A).toBe(1.25);
  });

  it("computes a hand-checkable ratio", () => {
    // 150,000 / 100,000 = 1.50
    const result = dscr({
      netOperatingIncome: 150_000,
      annualDebtService: 100_000,
    });
    expect(result.dscr).toBe(1.5);
    expect(result.meetsThreshold).toBe(true);
    expect(result.threshold).toBe(DSCR_THRESHOLD_SBA_7A);
    expect(result.netOperatingIncome).toBe(150_000);
    expect(result.annualDebtService).toBe(100_000);
  });

  it("defaults to the SBA 7(a) threshold and fails just below it", () => {
    // 124,900 / 100,000 = 1.249 -> displays 1.25, still fails.
    const result = dscr({
      netOperatingIncome: 124_900,
      annualDebtService: 100_000,
    });
    expect(result.dscr).toBe(1.25);
    expect(result.meetsThreshold).toBe(false);
  });

  it("compares on the exact ratio, not the rounded display value", () => {
    // This is the whole reason meetsThreshold is carried rather than re-derived:
    // an element reading "1.25" off the label would wrongly pass this loan.
    const failing = dscr({
      netOperatingIncome: 124_499,
      annualDebtService: 100_000,
    });
    expect(failing.dscr).toBe(1.24);
    expect(failing.meetsThreshold).toBe(false);

    const passing = dscr({
      netOperatingIncome: 125_000,
      annualDebtService: 100_000,
    });
    expect(passing.dscr).toBe(1.25);
    expect(passing.meetsThreshold).toBe(true);
  });

  it("passes at exactly the threshold", () => {
    const result = dscr({
      netOperatingIncome: 115_000,
      annualDebtService: 100_000,
      threshold: 1.15,
    });
    expect(result.dscr).toBe(1.15);
    expect(result.meetsThreshold).toBe(true);
  });

  it("accepts an explicit conventional threshold", () => {
    const result = dscr({
      netOperatingIncome: 120_000,
      annualDebtService: 100_000,
      threshold: DSCR_THRESHOLD_CONVENTIONAL,
    });
    expect(result.threshold).toBe(1.15);
    expect(result.meetsThreshold).toBe(true);
  });

  it("reports a negative DSCR rather than clamping a loss to zero", () => {
    const result = dscr({
      netOperatingIncome: -50_000,
      annualDebtService: 100_000,
    });
    expect(result.dscr).toBe(-0.5);
    expect(result.meetsThreshold).toBe(false);
  });

  it("throws on zero debt service instead of returning Infinity", () => {
    // A business with no debt has no coverage ratio; Infinity renders blank.
    expect(() =>
      dscr({ netOperatingIncome: 100_000, annualDebtService: 0 }),
    ).toThrow(/"annualDebtService" must be greater than 0/);
  });

  it("throws on negative debt service", () => {
    expect(() =>
      dscr({ netOperatingIncome: 100_000, annualDebtService: -1 }),
    ).toThrow(FinanceInputError);
  });

  it("throws on non-finite NOI", () => {
    expect(() =>
      dscr({ netOperatingIncome: Number.NaN, annualDebtService: 100_000 }),
    ).toThrow(/"netOperatingIncome" must be a finite number/);
  });

  it("throws on a non-positive explicit threshold", () => {
    expect(() =>
      dscr({
        netOperatingIncome: 100_000,
        annualDebtService: 100_000,
        threshold: 0,
      }),
    ).toThrow(/"threshold" must be greater than 0/);
  });
});
