import type { DscrResult } from "@repo/contracts";

import { assertFinite, assertPositive } from "./errors.js";
import { roundMoney, roundTo } from "./money.js";

/**
 * The conventional commercial-lending floor: 1.15x.
 *
 * Widely used by conventional lenders and by SBA participating lenders on
 * smaller/lower-risk credits. Named here so no caller types a bare `1.15`.
 */
export const DSCR_THRESHOLD_CONVENTIONAL = 1.15;

/**
 * The figure most SBA 7(a) lenders underwrite to: 1.25x.
 *
 * This is a lender underwriting convention, not a statutory number — SBA's SOP
 * requires the lender to document repayment ability, and 1.15/1.25 are the two
 * numbers that convention has settled on. Any on-screen claim that SBA
 * *requires* 1.25 must carry a source under the scene schema's source gate.
 */
export const DSCR_THRESHOLD_SBA_7A = 1.25;

/** Number of decimal places a DSCR is reported to. Lenders quote two. */
export const DSCR_DECIMALS = 2;

/** Inputs to {@link dscr}. */
export interface DscrInput {
  /**
   * Net operating income for the period. MAY be negative — a business losing
   * money has a negative DSCR and the chart must show it, not clamp it.
   */
  netOperatingIncome: number;
  /** Total principal + interest due over the same period. Must be `> 0`. */
  annualDebtService: number;
  /**
   * Pass/fail threshold. Defaults to {@link DSCR_THRESHOLD_SBA_7A}.
   *
   * This default is a convention chosen by this package, not pipeline data that
   * went missing, which is why defaulting it is not a fallback: the caller can
   * always name the threshold it is actually underwriting to.
   */
  threshold?: number;
}

/**
 * Debt Service Coverage Ratio: `NOI / annual debt service`.
 *
 * The comparison against the threshold is made on the UNROUNDED ratio and
 * carried in `meetsThreshold`, so an element never re-derives pass/fail from
 * the two-decimal display value. A 1.2449 DSCR displays as "1.24" and fails;
 * re-deriving from "1.25" would pass it.
 *
 * @throws {import("./errors.js").FinanceInputError} if `netOperatingIncome` is
 * non-finite, if `annualDebtService` is non-finite or `<= 0` (division by zero
 * has no meaning here — a business with no debt has no coverage ratio, not an
 * infinite one), or if `threshold` is supplied non-finite or `<= 0`.
 */
export function dscr(input: DscrInput): DscrResult {
  const netOperatingIncome = assertFinite(
    "dscr",
    "netOperatingIncome",
    input.netOperatingIncome,
  );
  const annualDebtService = assertPositive(
    "dscr",
    "annualDebtService",
    input.annualDebtService,
  );
  const threshold =
    input.threshold === undefined
      ? DSCR_THRESHOLD_SBA_7A
      : assertPositive("dscr", "threshold", input.threshold);

  const exact = netOperatingIncome / annualDebtService;

  return {
    netOperatingIncome: roundMoney(netOperatingIncome),
    annualDebtService: roundMoney(annualDebtService),
    dscr: roundTo(exact, DSCR_DECIMALS),
    threshold,
    meetsThreshold: exact >= threshold,
  };
}
