/**
 * finance-kit error types and input guards.
 *
 * Standing rule for this package: **fail closed**. Every exported calculator
 * validates its inputs and throws on nonsense. Nothing is clamped, defaulted,
 * estimated or silently corrected — a chart drawn from a corrected number is a
 * published lie, and this package exists precisely so that the numbers on
 * screen are trustworthy.
 */

/**
 * Thrown when a calculator is handed an input it cannot compute from.
 *
 * Carries the calculator name and the offending field so the diagnostic points
 * at the caller rather than at arithmetic deep inside this package.
 */
export class FinanceInputError extends Error {
  public readonly calculator: string;
  public readonly field: string;
  public readonly received: unknown;

  constructor(
    calculator: string,
    field: string,
    received: unknown,
    requirement: string,
  ) {
    super(
      `finance-kit ${calculator}: "${field}" ${requirement} (received ${describe(received)}). ` +
        `finance-kit never estimates or clamps — supply a real value or do not draw this element.`,
    );
    this.name = "FinanceInputError";
    this.calculator = calculator;
    this.field = field;
    this.received = received;
  }
}

/**
 * Thrown when the inputs are individually valid but the model they describe has
 * no answer — e.g. a break-even with a non-positive contribution margin, which
 * has no finite unit count at all.
 */
export class FinanceModelError extends Error {
  public readonly calculator: string;

  constructor(calculator: string, message: string) {
    super(`finance-kit ${calculator}: ${message}`);
    this.name = "FinanceModelError";
    this.calculator = calculator;
  }
}

/** Render an unknown value for an error message without throwing on exotics. */
function describe(value: unknown): string {
  if (typeof value === "number") {
    return Number.isNaN(value) ? "NaN" : String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `array(length ${value.length})`;
  return typeof value;
}

/**
 * Narrow `value` to a finite `number`.
 *
 * @throws {FinanceInputError} if the value is not a number, is `NaN`, or is
 * `Infinity`/`-Infinity`. Non-finite values reaching a chart axis produce a
 * blank frame rather than an error, so they are rejected here.
 */
export function assertFinite(
  calculator: string,
  field: string,
  value: unknown,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(calculator, field, value, "must be a finite number");
  }
  return value;
}

/**
 * Narrow `value` to a finite number `> 0`.
 *
 * @throws {FinanceInputError} if not finite or if `<= 0`.
 */
export function assertPositive(
  calculator: string,
  field: string,
  value: unknown,
): number {
  const n = assertFinite(calculator, field, value);
  if (n <= 0) return fail(calculator, field, value, "must be greater than 0");
  return n;
}

/**
 * Narrow `value` to a finite number `>= 0`.
 *
 * @throws {FinanceInputError} if not finite or if negative.
 */
export function assertNonNegative(
  calculator: string,
  field: string,
  value: unknown,
): number {
  const n = assertFinite(calculator, field, value);
  if (n < 0) return fail(calculator, field, value, "must not be negative");
  return n;
}

/**
 * Narrow `value` to a positive safe integer.
 *
 * @throws {FinanceInputError} if not an integer, or if `<= 0`.
 */
export function assertPositiveInteger(
  calculator: string,
  field: string,
  value: unknown,
): number {
  const n = assertFinite(calculator, field, value);
  if (!Number.isSafeInteger(n))
    return fail(calculator, field, value, "must be a whole number");
  if (n <= 0) return fail(calculator, field, value, "must be greater than 0");
  return n;
}

/**
 * Narrow `value` to a finite number inside `[min, max]` inclusive.
 *
 * @throws {FinanceInputError} if not finite or outside the range.
 */
export function assertInRange(
  calculator: string,
  field: string,
  value: unknown,
  min: number,
  max: number,
): number {
  const n = assertFinite(calculator, field, value);
  if (n < min || n > max) {
    return fail(
      calculator,
      field,
      value,
      `must be between ${min} and ${max} inclusive`,
    );
  }
  return n;
}

/**
 * Narrow `value` to a finite percentage that cannot drive an amount below zero,
 * i.e. `>= -100`. Used for growth rates: `-100` means "revenue goes to zero",
 * anything below that would imply negative revenue.
 *
 * @throws {FinanceInputError} if not finite or `< -100`.
 */
export function assertGrowthPct(
  calculator: string,
  field: string,
  value: unknown,
): number {
  const n = assertFinite(calculator, field, value);
  if (n < -100) {
    return fail(
      calculator,
      field,
      value,
      "must be >= -100 (a rate below -100% implies a negative amount)",
    );
  }
  return n;
}

/** Always throws. Return type is `never`-shaped as `number` for use in expressions. */
function fail(
  calculator: string,
  field: string,
  value: unknown,
  requirement: string,
): never {
  throw new FinanceInputError(calculator, field, value, requirement);
}
