import { describe, it, expect } from "vitest";
import {
  AmortizationRowSchema,
  AmortizationScheduleSchema,
  BreakEvenResultSchema,
  ChartSeriesSchema,
  DscrResultSchema,
  Eb5JobsResultSchema,
  ProjectionYearSchema,
  SbaFeeResultSchema,
} from "../../schemas/business-hub-finance.js";

describe("AmortizationRow / Schedule", () => {
  const row = {
    period: 1,
    payment: 4_582.11,
    principal: 1_248.78,
    interest: 3_333.33,
    balance: 398_751.22,
    cumulativeInterest: 3_333.33,
  };

  it("parses a row and a schedule", () => {
    expect(AmortizationRowSchema.safeParse(row).success).toBe(true);
    expect(
      AmortizationScheduleSchema.safeParse({
        principal: 400_000,
        annualRate: 0.1,
        termMonths: 120,
        monthlyPayment: 4_582.11,
        totalInterest: 149_853.2,
        totalPaid: 549_853.2,
        rows: [row],
      }).success,
    ).toBe(true);
  });

  it("rejects a 0-based period, a negative balance and a non-finite number", () => {
    expect(AmortizationRowSchema.safeParse({ ...row, period: 0 }).success).toBe(false);
    expect(AmortizationRowSchema.safeParse({ ...row, balance: -1 }).success).toBe(false);
    expect(AmortizationRowSchema.safeParse({ ...row, interest: Number.NaN }).success).toBe(false);
    expect(
      AmortizationRowSchema.safeParse({ ...row, payment: Number.POSITIVE_INFINITY }).success,
    ).toBe(false);
  });

  it("rejects an empty schedule", () => {
    expect(
      AmortizationScheduleSchema.safeParse({
        principal: 400_000,
        annualRate: 0.1,
        termMonths: 120,
        monthlyPayment: 4_582.11,
        totalInterest: 149_853.2,
        totalPaid: 549_853.2,
        rows: [],
      }).success,
    ).toBe(false);
  });
});

describe("DscrResult", () => {
  it("parses a passing and a failing ratio", () => {
    expect(
      DscrResultSchema.safeParse({
        netOperatingIncome: 92_000,
        annualDebtService: 54_985,
        dscr: 1.673,
        threshold: 1.25,
        meetsThreshold: true,
      }).success,
    ).toBe(true);
    expect(
      DscrResultSchema.safeParse({
        netOperatingIncome: -4_000,
        annualDebtService: 54_985,
        dscr: -0.07,
        threshold: 1.25,
        meetsThreshold: false,
      }).success,
    ).toBe(true);
  });

  it("rejects zero annual debt service (the divide-by-zero case)", () => {
    expect(
      DscrResultSchema.safeParse({
        netOperatingIncome: 92_000,
        annualDebtService: 0,
        dscr: Number.POSITIVE_INFINITY,
        threshold: 1.25,
        meetsThreshold: true,
      }).success,
    ).toBe(false);
  });
});

describe("BreakEvenResult", () => {
  it("parses a normal break-even", () => {
    expect(
      BreakEvenResultSchema.safeParse({
        fixedCosts: 96_000,
        pricePerUnit: 6.5,
        variableCostPerUnit: 2.1,
        contributionMargin: 4.4,
        contributionMarginRatio: 0.6769,
        breakEvenUnits: 21_819,
        breakEvenRevenue: 141_823.5,
      }).success,
    ).toBe(true);
  });

  it("rejects a non-positive contribution margin (no break-even exists)", () => {
    expect(
      BreakEvenResultSchema.safeParse({
        fixedCosts: 96_000,
        pricePerUnit: 2,
        variableCostPerUnit: 2.5,
        contributionMargin: -0.5,
        contributionMarginRatio: -0.25,
        breakEvenUnits: 0,
        breakEvenRevenue: 0,
      }).success,
    ).toBe(false);
  });
});

describe("ProjectionYear", () => {
  it("allows a negative net income in year 1", () => {
    expect(
      ProjectionYearSchema.safeParse({
        year: 1,
        revenue: 240_000,
        cogs: 96_000,
        grossProfit: 144_000,
        operatingExpenses: 168_000,
        ebitda: -24_000,
        depreciation: 12_000,
        interestExpense: 38_000,
        taxes: 0,
        netIncome: -74_000,
      }).success,
    ).toBe(true);
  });

  it("rejects a 0 year and negative revenue", () => {
    expect(ProjectionYearSchema.safeParse({ year: 0, revenue: 1, cogs: 0, grossProfit: 1, operatingExpenses: 0, ebitda: 1, depreciation: 0, interestExpense: 0, taxes: 0, netIncome: 1 }).success).toBe(false);
    expect(ProjectionYearSchema.safeParse({ year: 1, revenue: -1, cogs: 0, grossProfit: 1, operatingExpenses: 0, ebitda: 1, depreciation: 0, interestExpense: 0, taxes: 0, netIncome: 1 }).success).toBe(false);
  });
});

describe("SbaFeeResult / Eb5JobsResult", () => {
  it("parses SBA fee math", () => {
    expect(
      SbaFeeResultSchema.safeParse({
        loanAmount: 500_000,
        guarantyPercent: 0.75,
        guaranteedAmount: 375_000,
        guarantyFee: 11_250,
        annualServiceFee: 1_912.5,
        totalUpfrontFees: 13_750,
      }).success,
    ).toBe(true);
  });

  it("rejects a guaranty percent given as 75 instead of 0.75", () => {
    expect(
      SbaFeeResultSchema.safeParse({
        loanAmount: 500_000,
        guarantyPercent: 75,
        guaranteedAmount: 375_000,
        guarantyFee: 11_250,
        annualServiceFee: 1_912.5,
        totalUpfrontFees: 13_750,
      }).success,
    ).toBe(false);
  });

  it("parses EB-5 job counts and rejects a fractional investor count", () => {
    expect(
      Eb5JobsResultSchema.safeParse({
        investmentPerInvestor: 800_000,
        investorCount: 12,
        totalInvestment: 9_600_000,
        jobsPerInvestor: 10,
        jobsRequired: 120,
        jobsCreated: 137.4,
        meetsRequirement: true,
      }).success,
    ).toBe(true);
    expect(
      Eb5JobsResultSchema.safeParse({
        investmentPerInvestor: 800_000,
        investorCount: 12.5,
        totalInvestment: 10_000_000,
        jobsPerInvestor: 10,
        jobsRequired: 125,
        jobsCreated: 137.4,
        meetsRequirement: true,
      }).success,
    ).toBe(false);
  });
});

describe("ChartSeries", () => {
  it("parses matched points and labels", () => {
    const result = ChartSeriesSchema.safeParse({
      points: [240_000, 312_000, 401_000, 465_000, 512_000],
      labels: ["Y1", "Y2", "Y3", "Y4", "Y5"],
    });
    if (!result.success) throw new Error(JSON.stringify(result.error.issues, null, 2));
    expect(result.data.points).toHaveLength(5);
  });

  it("REJECTS a label/point length mismatch", () => {
    const result = ChartSeriesSchema.safeParse({
      points: [1, 2, 3],
      labels: ["Y1", "Y2"],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("every point must be labelled");
    }
  });

  it("rejects empty series and non-finite points", () => {
    expect(ChartSeriesSchema.safeParse({ points: [], labels: [] }).success).toBe(false);
    expect(ChartSeriesSchema.safeParse({ points: [Number.NaN], labels: ["Y1"] }).success).toBe(
      false,
    );
  });
});
