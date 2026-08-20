import { describe, expect, it } from "vitest";

import {
  EB5_JOBS_REQUIRED_PER_INVESTOR,
  EB5_MIN_SUSTAINED_YEARS,
  eb5Jobs,
} from "../eb5.js";
import { FinanceInputError } from "../errors.js";

const BASE = {
  annualRevenue: 2_000_000,
  revenuePerEmployee: 100_000,
  sustainedYears: 2,
  investorCount: 1,
  investmentPerInvestor: 800_000,
} as const;

describe("eb5Jobs", () => {
  it("pins the statutory constants", () => {
    expect(EB5_JOBS_REQUIRED_PER_INVESTOR).toBe(10);
    expect(EB5_MIN_SUSTAINED_YEARS).toBe(2);
  });

  it("computes a hand-checkable single-investor case", () => {
    // 2,000,000 / 100,000 = 20 FTE against 10 required -> passes.
    const result = eb5Jobs(BASE);
    expect(result.jobsCreated).toBe(20);
    expect(result.jobsRequired).toBe(10);
    expect(result.jobsPerInvestor).toBe(10);
    expect(result.meetsJobCount).toBe(true);
    expect(result.meetsSustainmentPeriod).toBe(true);
    expect(result.meetsRequirement).toBe(true);
    expect(result.totalInvestment).toBe(800_000);
  });

  it("scales the requirement by investor count", () => {
    // 5 investors -> 50 jobs required; 20 created -> fails.
    const result = eb5Jobs({ ...BASE, investorCount: 5 });
    expect(result.jobsRequired).toBe(50);
    expect(result.jobsCreated).toBe(20);
    expect(result.meetsJobCount).toBe(false);
    expect(result.meetsRequirement).toBe(false);
    expect(result.totalInvestment).toBe(4_000_000);
  });

  it("passes at exactly the required job count", () => {
    // 1,000,000 / 100,000 = 10 FTE against 10 required.
    const result = eb5Jobs({ ...BASE, annualRevenue: 1_000_000 });
    expect(result.jobsCreated).toBe(10);
    expect(result.meetsRequirement).toBe(true);
  });

  it("fails one job short", () => {
    // 900,000 / 100,000 = 9 FTE.
    const result = eb5Jobs({ ...BASE, annualRevenue: 900_000 });
    expect(result.jobsCreated).toBe(9);
    expect(result.meetsJobCount).toBe(false);
    expect(result.meetsRequirement).toBe(false);
  });

  it("reports a fractional FTE count to two places", () => {
    // 1,234,567 / 100,000 = 12.34567 -> 12.35
    const result = eb5Jobs({ ...BASE, annualRevenue: 1_234_567 });
    expect(result.jobsCreated).toBe(12.35);
  });

  it("fails a plan that hits the headcount but does not sustain it", () => {
    // This is the error that would do the most damage if reported as a pass:
    // 8 CFR 204.6(j)(4)(i) requires the jobs within/for two years.
    const result = eb5Jobs({ ...BASE, sustainedYears: 1 });
    expect(result.jobsCreated).toBe(20);
    expect(result.meetsJobCount).toBe(true);
    expect(result.meetsSustainmentPeriod).toBe(false);
    expect(result.meetsRequirement).toBe(false);
  });

  it("passes when sustained beyond the minimum", () => {
    const result = eb5Jobs({ ...BASE, sustainedYears: 5 });
    expect(result.meetsSustainmentPeriod).toBe(true);
    expect(result.meetsRequirement).toBe(true);
    expect(result.sustainedYears).toBe(5);
    expect(result.minSustainedYears).toBe(2);
  });

  it("throws on a zero or negative revenue-per-employee instead of dividing by zero", () => {
    expect(() => eb5Jobs({ ...BASE, revenuePerEmployee: 0 })).toThrow(
      /"revenuePerEmployee" must be greater than 0/,
    );
    expect(() => eb5Jobs({ ...BASE, revenuePerEmployee: -1 })).toThrow(
      FinanceInputError,
    );
  });

  it("throws on a zero or negative annual revenue", () => {
    expect(() => eb5Jobs({ ...BASE, annualRevenue: 0 })).toThrow(
      /"annualRevenue" must be greater than 0/,
    );
  });

  it("throws on a non-whole or non-positive investor count", () => {
    expect(() => eb5Jobs({ ...BASE, investorCount: 0 })).toThrow(
      /"investorCount" must be greater than 0/,
    );
    expect(() => eb5Jobs({ ...BASE, investorCount: 1.5 })).toThrow(
      /"investorCount" must be a whole number/,
    );
  });

  it("throws on a non-whole or non-positive sustained period", () => {
    expect(() => eb5Jobs({ ...BASE, sustainedYears: 0 })).toThrow(
      /"sustainedYears" must be greater than 0/,
    );
    expect(() => eb5Jobs({ ...BASE, sustainedYears: 2.5 })).toThrow(
      /"sustainedYears" must be a whole number/,
    );
  });

  it("throws on a non-positive investment per investor", () => {
    expect(() => eb5Jobs({ ...BASE, investmentPerInvestor: 0 })).toThrow(
      /"investmentPerInvestor" must be greater than 0/,
    );
  });

  it("throws on non-finite inputs", () => {
    expect(() =>
      eb5Jobs({ ...BASE, annualRevenue: Number.POSITIVE_INFINITY }),
    ).toThrow(/"annualRevenue" must be a finite number/);
  });
});
