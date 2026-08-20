/**
 * Result Type
 *
 * Custom discriminated union for functional error handling.
 * Used throughout packages/domain for operations where failure is expected.
 *
 * Prefer this over throwing exceptions for business logic failures.
 * Reserve exceptions for truly exceptional circumstances (infrastructure failure).
 *
 * Usage:
 * ```typescript
 * function doSomething(): Result<string, Error> {
 *   if (success) {
 *     return { success: true, data: "result" };
 *   }
 *   return { success: false, error: new Error("reason") };
 * }
 *
 * const result = doSomething();
 * if (result.success) {
 *   console.log(result.data); // TypeScript knows this exists
 * } else {
 *   console.error(result.error); // TypeScript knows this exists
 * }
 * ```
 */
export type Success<T> = {
  success: true;
  data: T;
};

export type Failure<E> = {
  success: false;
  error: E;
};

export type Result<T, E = Error> = Success<T> | Failure<E>;

/**
 * Helper constructors for creating Result values
 */
export const Result = {
  success: <T>(data: T): Success<T> => ({
    success: true,
    data,
  }),

  failure: <E>(error: E): Failure<E> => ({
    success: false,
    error,
  }),
};
