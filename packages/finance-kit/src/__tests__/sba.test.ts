import { describe, expect, it } from "vitest";

import { FinanceInputError } from "../errors.js";
import {
  SBA_504_DEBENTURE_GUARANTY_PERCENT,
  SBA_7A_GUARANTY_PERCENT_TIERS,
  sba7aGuarantyPercent,
  sbaGuarantee,
} from "../sba.js";

/**
 * Fee rates are REQUIRED inputs, not constants — see the module doc comment in
 * sba.ts. These test values are chosen to make the arithmetic checkable by
 * hand; they are not an assertion about any particular fiscal year's rates.
 */
const RATES = { guarantyFeeRatePct: 3, annualServiceFeeRatePct: 0.55 } as const;

describe("SBA_7A_GUARANTY_PERCENT_TIERS", () => {
  it("encodes the statutory 85/75 split at $150,000", () => {
    expect(SBA_7A_GUARANTY_PERCENT_TIERS).toEqual([
      { maxLoanAmount: 150_000, guarantyPercent: 0.85 },
      { maxLoanAmount: Number.POSITIVE_INFINITY, guarantyPercent: 0.75 },
    ]);
  });

  it("ends with an open-ended tier so no loan amount can fall through", () => {
    const last =
      SBA_7A_GUARANTY_PERCENT_TIERS[SBA_7A_GUARANTY_PERCENT_TIERS.length - 1];
    expect(last.maxLoanAmount).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("sba7aGuarantyPercent", () => {
  it("returns 85% at and below the $150,000 boundary", () => {
    expect(sba7aGuarantyPercent(1)).toBe(0.85);
    expect(sba7aGuarantyPercent(149_999)).toBe(0.85);
    expect(sba7aGuarantyPercent(150_000)).toBe(0.85);
  });

  it("returns 75% above the boundary", () => {
    expect(sba7aGuarantyPercent(150_000.01)).toBe(0.75);
    expect(sba7aGuarantyPercent(5_000_000)).toBe(0.75);
  });

  it("throws on a non-positive or non-finite loan amount", () => {
    expect(() => sba7aGuarantyPercent(0)).toThrow(
      /"loanAmount" must be greater than 0/,
    );
    expect(() => sba7aGuarantyPercent(-1)).toThrow(FinanceInputError);
    expect(() => sba7aGuarantyPercent(Number.NaN)).toThrow(
      /must be a finite number/,
    );
  });
});

describe("sbaGuarantee — 7(a)", () => {
  it("charges the guaranty fee on the guaranteed portion", () => {
    // 500,000 above the boundary -> 75% guaranteed = 375,000.
    // fee = 3% of 375,000 = 11,250. annual = 0.55% of 375,000 = 2,062.50.
    const result = sbaGuarantee({
      loanAmount: 500_000,
      program: "7a",
      ...RATES,
    });

    expect(result.guarantyPercent).toBe(0.75);
    expect(result.guaranteedAmount).toBe(375_000);
    expect(result.feeBasis).toBe("guaranteed-portion");
    expect(result.feeBasisAmount).toBe(375_000);
    expect(result.guarantyFee).toBe(11_250);
    expect(result.annualServiceFee).toBe(2062.5);
    expect(result.totalUpfrontFees).toBe(11_250);
    expect(result.loanAmount).toBe(500_000);
    expect(result.program).toBe("7a");
    expect(result.guarantyPercentWasOverridden).toBe(false);
  });

  it("applies the 85% tier to a small loan", () => {
    // 100,000 -> 85% = 85,000 guaranteed; fee 3% = 2,550.
    const result = sbaGuarantee({
      loanAmount: 100_000,
      program: "7a",
      ...RATES,
    });
    expect(result.guarantyPercent).toBe(0.85);
    expect(result.guaranteedAmount).toBe(85_000);
    expect(result.guarantyFee).toBe(2550);
  });

  it("does not include the annual service fee in the upfront total", () => {
    // The annual fee is not paid at close; folding it in would overstate what
    // the borrower brings to the table.
    const result = sbaGuarantee({
      loanAmount: 500_000,
      program: "7a",
      ...RATES,
    });
    expect(result.totalUpfrontFees).toBe(result.guarantyFee);
    expect(result.annualServiceFee).toBeGreaterThan(0);
  });

  it("echoes the caller-supplied rates so the derivation can be drawn", () => {
    const result = sbaGuarantee({
      loanAmount: 250_000,
      program: "7a",
      ...RATES,
    });
    expect(result.guarantyFeeRatePct).toBe(3);
    expect(result.annualServiceFeeRatePct).toBe(0.55);
  });

  it("accepts a zero fee rate, which has been the case in some fiscal years", () => {
    const result = sbaGuarantee({
      loanAmount: 100_000,
      program: "7a",
      guarantyFeeRatePct: 0,
      annualServiceFeeRatePct: 0,
    });
    expect(result.guarantyFee).toBe(0);
    expect(result.annualServiceFee).toBe(0);
    expect(result.totalUpfrontFees).toBe(0);
  });

  it("honours a guaranty percent override", () => {
    // The tier table is a statutory maximum; a lender may request less.
    const result = sbaGuarantee({
      loanAmount: 500_000,
      program: "7a",
      guarantyPercentOverride: 0.5,
      ...RATES,
    });
    expect(result.guarantyPercent).toBe(0.5);
    expect(result.guaranteedAmount).toBe(250_000);
    expect(result.guarantyFee).toBe(7500);
    expect(result.guarantyPercentWasOverridden).toBe(true);
  });
});

describe("sbaGuarantee — 504", () => {
  it("guarantees 100% of the CDC debenture and charges the fee on it", () => {
    expect(SBA_504_DEBENTURE_GUARANTY_PERCENT).toBe(1);

    const result = sbaGuarantee({
      loanAmount: 1_000_000,
      program: "504",
      ...RATES,
    });
    expect(result.guarantyPercent).toBe(1);
    expect(result.guaranteedAmount).toBe(1_000_000);
    expect(result.feeBasis).toBe("debenture");
    expect(result.feeBasisAmount).toBe(1_000_000);
    expect(result.guarantyFee).toBe(30_000);
    expect(result.annualServiceFee).toBe(5500);
    expect(result.program).toBe("504");
  });
});

describe("sbaGuarantee — input validation", () => {
  it("throws on a zero or negative loan amount", () => {
    expect(() =>
      sbaGuarantee({ loanAmount: 0, program: "7a", ...RATES }),
    ).toThrow(/"loanAmount" must be greater than 0/);
    expect(() =>
      sbaGuarantee({ loanAmount: -1, program: "504", ...RATES }),
    ).toThrow(FinanceInputError);
  });

  it("throws on a fee rate outside 0..100", () => {
    expect(() =>
      sbaGuarantee({
        loanAmount: 100_000,
        program: "7a",
        guarantyFeeRatePct: 101,
        annualServiceFeeRatePct: 1,
      }),
    ).toThrow(/"guarantyFeeRatePct" must be between 0 and 100/);
    expect(() =>
      sbaGuarantee({
        loanAmount: 100_000,
        program: "7a",
        guarantyFeeRatePct: -1,
        annualServiceFeeRatePct: 1,
      }),
    ).toThrow(FinanceInputError);
    expect(() =>
      sbaGuarantee({
        loanAmount: 100_000,
        program: "7a",
        guarantyFeeRatePct: 1,
        annualServiceFeeRatePct: 200,
      }),
    ).toThrow(/"annualServiceFeeRatePct" must be between 0 and 100/);
  });

  it("throws on a non-finite fee rate rather than defaulting it", () => {
    // The whole point of these being required inputs is that a missing rate
    // must be loud, not silently zero.
    expect(() =>
      sbaGuarantee({
        loanAmount: 100_000,
        program: "7a",
        guarantyFeeRatePct: Number.NaN,
        annualServiceFeeRatePct: 0.55,
      }),
    ).toThrow(/"guarantyFeeRatePct" must be a finite number/);
  });

  it("throws on a guaranty override outside (0, 1]", () => {
    expect(() =>
      sbaGuarantee({
        loanAmount: 100_000,
        program: "7a",
        guarantyPercentOverride: 1.5,
        ...RATES,
      }),
    ).toThrow(/"guarantyPercentOverride" must be between 0 and 1/);
    expect(() =>
      sbaGuarantee({
        loanAmount: 100_000,
        program: "7a",
        guarantyPercentOverride: 0,
        ...RATES,
      }),
    ).toThrow(/"guarantyPercentOverride" must be greater than 0/);
    expect(() =>
      sbaGuarantee({
        loanAmount: 100_000,
        program: "7a",
        guarantyPercentOverride: -0.1,
        ...RATES,
      }),
    ).toThrow(FinanceInputError);
  });

  it("accepts a full 100% override", () => {
    const result = sbaGuarantee({
      loanAmount: 100_000,
      program: "7a",
      guarantyPercentOverride: 1,
      ...RATES,
    });
    expect(result.guarantyPercent).toBe(1);
    expect(result.guaranteedAmount).toBe(100_000);
  });
});
