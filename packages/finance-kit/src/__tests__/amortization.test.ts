import { describe, expect, it } from "vitest";

import {
  amortizationRows,
  amortizationSchedule,
  monthlyPayment,
} from "../amortization.js";
import { FinanceInputError, FinanceModelError } from "../errors.js";

describe("monthlyPayment", () => {
  it("matches the textbook 30-year figure", () => {
    // $200,000 at 6.00% nominal over 360 months is $1,199.10 — the canonical
    // worked example in every mortgage table. If this drifts, the annuity
    // formula is wrong, not the rounding.
    expect(
      monthlyPayment({ principal: 200_000, annualRatePct: 6, termMonths: 360 }),
    ).toBe(1199.1);
  });

  it("matches a hand-checkable one-year loan", () => {
    // i = 0.06/12 = 0.005; (1.005)^12 = 1.0616778118644983
    // payment = 100000 * 0.005 / (1 - 1/1.0616778118644983) = 8606.64297...
    expect(
      monthlyPayment({ principal: 100_000, annualRatePct: 6, termMonths: 12 }),
    ).toBe(8606.64);
  });

  it("computes a 10-year SBA-shaped loan", () => {
    expect(
      monthlyPayment({
        principal: 50_000,
        annualRatePct: 11.5,
        termMonths: 120,
      }),
    ).toBe(702.98);
  });

  it("handles a zero-rate loan as straight-line repayment, not NaN", () => {
    // The annuity formula is 0/0 at i = 0. Straight division is the limit.
    expect(
      monthlyPayment({ principal: 1200, annualRatePct: 0, termMonths: 12 }),
    ).toBe(100);
  });

  it("returns zero for a zero principal", () => {
    expect(
      monthlyPayment({ principal: 0, annualRatePct: 6, termMonths: 12 }),
    ).toBe(0);
  });

  it("throws on a negative principal", () => {
    expect(() =>
      monthlyPayment({ principal: -1, annualRatePct: 6, termMonths: 12 }),
    ).toThrow(FinanceInputError);
    expect(() =>
      monthlyPayment({ principal: -1, annualRatePct: 6, termMonths: 12 }),
    ).toThrow(/"principal" must not be negative/);
  });

  it("throws on a negative rate", () => {
    expect(() =>
      monthlyPayment({ principal: 1000, annualRatePct: -0.5, termMonths: 12 }),
    ).toThrow(/"annualRatePct" must not be negative/);
  });

  it("throws on a zero term", () => {
    expect(() =>
      monthlyPayment({ principal: 1000, annualRatePct: 6, termMonths: 0 }),
    ).toThrow(/"termMonths" must be greater than 0/);
  });

  it("throws on a fractional term", () => {
    expect(() =>
      monthlyPayment({ principal: 1000, annualRatePct: 6, termMonths: 12.5 }),
    ).toThrow(/"termMonths" must be a whole number/);
  });

  it("throws when the annuity factor overflows rather than returning NaN", () => {
    // (1 + i)^n overflows to Infinity at absurd rates. The formula then yields
    // NaN, which would reach a chart label as a blank.
    expect(() =>
      monthlyPayment({ principal: 1000, annualRatePct: 1e6, termMonths: 600 }),
    ).toThrow(FinanceModelError);
    expect(() =>
      monthlyPayment({ principal: 1000, annualRatePct: 1e6, termMonths: 600 }),
    ).toThrow(/annuity factor is degenerate/);
  });

  it("throws on non-finite inputs", () => {
    expect(() =>
      monthlyPayment({
        principal: Number.NaN,
        annualRatePct: 6,
        termMonths: 12,
      }),
    ).toThrow(/"principal" must be a finite number/);
    expect(() =>
      monthlyPayment({
        principal: 1000,
        annualRatePct: Number.POSITIVE_INFINITY,
        termMonths: 12,
      }),
    ).toThrow(/"annualRatePct" must be a finite number/);
  });
});

describe("amortizationSchedule", () => {
  it("produces one row per period with the verified first row", () => {
    const schedule = amortizationSchedule({
      principal: 100_000,
      annualRatePct: 6,
      termMonths: 12,
    });

    expect(schedule.rows).toHaveLength(12);
    expect(schedule.monthlyPayment).toBe(8606.64);
    // Period 1 interest = 100,000 x 0.005 = 500 exactly.
    expect(schedule.rows[0]).toEqual({
      period: 1,
      payment: 8606.64,
      interest: 500,
      principal: 8106.64,
      balance: 91_893.36,
      cumulativeInterest: 500,
    });
  });

  it("closes the balance at exactly zero and puts the rounding on the last payment", () => {
    const schedule = amortizationSchedule({
      principal: 100_000,
      annualRatePct: 6,
      termMonths: 12,
    });

    const finalRow = schedule.rows[11];
    expect(finalRow.balance).toBe(0);
    expect(finalRow).toEqual({
      period: 12,
      payment: 8606.69,
      interest: 42.82,
      principal: 8563.87,
      balance: 0,
      cumulativeInterest: 3279.73,
    });
    // The final payment differs from the level payment by the accumulated
    // rounding. That is a lender's table, not a defect.
    expect(finalRow.payment).not.toBe(schedule.monthlyPayment);
  });

  it("reports summary figures that reconcile with the rows", () => {
    const schedule = amortizationSchedule({
      principal: 100_000,
      annualRatePct: 6,
      termMonths: 12,
    });

    const summedInterest = schedule.rows.reduce(
      (total, row) => total + row.interest,
      0,
    );
    const summedPrincipal = schedule.rows.reduce(
      (total, row) => total + row.principal,
      0,
    );
    const summedPayments = schedule.rows.reduce(
      (total, row) => total + row.payment,
      0,
    );

    expect(summedInterest).toBeCloseTo(schedule.totalInterest, 2);
    expect(summedPrincipal).toBeCloseTo(schedule.principal, 2);
    expect(summedPayments).toBeCloseTo(schedule.totalPaid, 2);
    expect(schedule.totalPaid).toBeCloseTo(
      schedule.principal + schedule.totalInterest,
      2,
    );
    expect(schedule.totalInterest).toBe(3279.73);
  });

  it("reports the annual rate as a fraction while taking a percent", () => {
    const schedule = amortizationSchedule({
      principal: 10_000,
      annualRatePct: 11.5,
      termMonths: 24,
    });
    expect(schedule.annualRate).toBeCloseTo(0.115, 10);
  });

  it("amortises a 30-year loan to zero", () => {
    const schedule = amortizationSchedule({
      principal: 200_000,
      annualRatePct: 6,
      termMonths: 360,
    });

    expect(schedule.rows).toHaveLength(360);
    expect(schedule.rows[359].balance).toBe(0);
    expect(schedule.totalInterest).toBe(231_677.04);
    // Interest must be monotonically non-increasing on a level-payment loan.
    for (let i = 1; i < schedule.rows.length; i += 1) {
      expect(schedule.rows[i].interest).toBeLessThanOrEqual(
        schedule.rows[i - 1].interest,
      );
    }
  });

  it("handles a zero-rate loan with no interest at all", () => {
    const schedule = amortizationSchedule({
      principal: 1200,
      annualRatePct: 0,
      termMonths: 12,
    });

    expect(schedule.monthlyPayment).toBe(100);
    expect(schedule.totalInterest).toBe(0);
    expect(schedule.rows[0]).toEqual({
      period: 1,
      payment: 100,
      interest: 0,
      principal: 100,
      balance: 1100,
      cumulativeInterest: 0,
    });
    expect(schedule.rows[11].balance).toBe(0);
  });

  it("produces an all-zero schedule for a zero principal rather than throwing", () => {
    // Degenerate but legitimate: monthlyPayment already returns 0 here, and the
    // negative-amortization guard must not fire when there is no balance to
    // amortise in the first place.
    const schedule = amortizationSchedule({
      principal: 0,
      annualRatePct: 6,
      termMonths: 6,
    });

    expect(schedule.rows).toHaveLength(6);
    expect(schedule.monthlyPayment).toBe(0);
    expect(schedule.totalInterest).toBe(0);
    expect(schedule.totalPaid).toBe(0);
    for (const row of schedule.rows) {
      expect(row).toMatchObject({
        payment: 0,
        principal: 0,
        interest: 0,
        balance: 0,
      });
    }
  });

  it("keeps cumulativeInterest monotonically non-decreasing", () => {
    const schedule = amortizationSchedule({
      principal: 75_000,
      annualRatePct: 9.25,
      termMonths: 84,
    });
    for (let i = 1; i < schedule.rows.length; i += 1) {
      expect(schedule.rows[i].cumulativeInterest).toBeGreaterThanOrEqual(
        schedule.rows[i - 1].cumulativeInterest,
      );
    }
    expect(schedule.rows[83].cumulativeInterest).toBe(schedule.totalInterest);
  });

  it("never emits a negative balance", () => {
    const schedule = amortizationSchedule({
      principal: 12_345.67,
      annualRatePct: 7.77,
      termMonths: 37,
    });
    for (const row of schedule.rows) {
      expect(row.balance).toBeGreaterThanOrEqual(0);
      expect(row.principal).toBeGreaterThanOrEqual(0);
      expect(row.interest).toBeGreaterThanOrEqual(0);
    }
  });

  it("throws FinanceModelError when interest never falls below the payment", () => {
    // A 1-month term at a huge rate still amortises, so force the pathological
    // case: an extremely long term at a rate high enough that the level payment
    // is effectively interest-only and rounding leaves no principal.
    expect(() =>
      amortizationSchedule({
        principal: 100,
        annualRatePct: 240,
        termMonths: 600,
      }),
    ).toThrow(FinanceModelError);
  });

  it("throws on the same bad inputs as monthlyPayment", () => {
    expect(() =>
      amortizationSchedule({ principal: -5, annualRatePct: 6, termMonths: 12 }),
    ).toThrow(FinanceInputError);
    expect(() =>
      amortizationSchedule({ principal: 5, annualRatePct: 6, termMonths: -12 }),
    ).toThrow(FinanceInputError);
  });
});

describe("amortizationRows", () => {
  it("returns exactly the schedule's rows", () => {
    const input = { principal: 25_000, annualRatePct: 8, termMonths: 60 };
    expect(amortizationRows(input)).toEqual(amortizationSchedule(input).rows);
  });
});
