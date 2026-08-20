/**
 * Money rounding for finance-kit.
 *
 * Every monetary value this package emits is rounded to cents at the point it
 * enters a result object. Two reasons:
 *
 * 1. These numbers are drawn on screen. `8606.643096373374` on a chart label is
 *    a defect.
 * 2. Amortization tables must reconcile. Rounding each row's interest and
 *    principal and carrying the ROUNDED balance forward is how a lender's own
 *    table behaves, so a viewer checking our arithmetic against their statement
 *    gets the same figures.
 *
 * Rounding is half-away-from-zero and sign-symmetric. JavaScript's `Math.round`
 * is half-toward-`+Infinity`, which rounds `-0.005` to `-0` and `0.005` to
 * `0.01` — an asymmetry that shows up as a one-cent drift on loss years.
 */

/** Number of decimal places money is carried to. */
export const MONEY_DECIMALS = 2;

const MONEY_SCALE = 10 ** MONEY_DECIMALS;

/**
 * Round a finite number to cents, half-away-from-zero, normalising `-0` to `0`.
 *
 * Does not validate: callers in this package have already asserted finiteness.
 * A non-finite input returns itself unchanged rather than `NaN`-ing silently,
 * because the schema boundary rejects non-finite values anyway.
 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return value;
  const scaled = Math.abs(value) * MONEY_SCALE;
  // + Number.EPSILON * scaled corrects binary representations that land a hair
  // below the .5 boundary, e.g. 1.005 stored as 1.00499999999999989.
  const rounded = Math.round(scaled + scaled * Number.EPSILON) / MONEY_SCALE;
  const signed = value < 0 ? -rounded : rounded;
  return signed === 0 ? 0 : signed;
}

/**
 * Round a finite number to `decimals` places, half-away-from-zero, normalising
 * `-0` to `0`. Used for ratios (DSCR, runway months, break-even units) where
 * cents are meaningless but raw float tails still leak into labels.
 */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** decimals;
  const scaled = Math.abs(value) * scale;
  const rounded = Math.round(scaled + scaled * Number.EPSILON) / scale;
  const signed = value < 0 ? -rounded : rounded;
  return signed === 0 ? 0 : signed;
}
