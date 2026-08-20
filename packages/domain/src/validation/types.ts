/**
 * Validation Harness - Core Types
 *
 * Foundation types for the validation system.
 * Fail-fast philosophy: NO silent fallbacks.
 * All validation failures must be explicit and actionable.
 */

/**
 * Validation severity levels
 */
export type ValidationSeverity = "ERROR" | "WARNING" | "INFO";

/**
 * Structured validation error
 */
export interface ValidationError {
  /** Error code for programmatic handling */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Severity level */
  severity: ValidationSeverity;
  /** Context path (e.g., "payload.archetype_id", "metadata.comparison.product_a_name") */
  path?: string;
  /** Additional context data */
  context?: Record<string, unknown>;
  /** Suggested fix or action */
  suggestion?: string;
}

/**
 * Validation result - discriminated union
 * Forces explicit handling of success vs failure cases
 */
export type ValidationResult<T = void> =
  | {
      success: true;
      value: T;
      warnings?: ValidationError[];
    }
  | {
      success: false;
      errors: ValidationError[];
    };

/**
 * Validation context passed to validators
 * Contains job state, environment info, and dependency data
 */
export interface ValidationContext {
  /** Job ID being validated */
  jobId: string;
  /** Current pipeline stage */
  stage: string;
  /** Job format (EXPLAINER, TECH_COMPARISON, etc.) */
  format: string;
  /** Environment (production, staging, test-agent) */
  environment: "production" | "staging" | "test-agent";
  /** Timestamp of validation */
  timestamp: Date;
  /** Additional context data */
  metadata?: Record<string, unknown>;
}

/**
 * Base validator interface
 * All validators must implement this contract
 */
export interface Validator<TInput, TOutput = TInput> {
  /** Validator identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this validator checks */
  description: string;
  /** Pipeline stages where this validator applies */
  applicableStages: string[];
  /** Validate input and return structured result */
  validate(
    input: TInput,
    context: ValidationContext,
  ): Promise<ValidationResult<TOutput>>;
}

/**
 * Helper to create a success result
 */
export function success<T>(
  value: T,
  warnings?: ValidationError[],
): ValidationResult<T> {
  return warnings && warnings.length > 0
    ? { success: true, value, warnings }
    : { success: true, value };
}

/**
 * Helper to create a failure result
 */
export function failure(
  errors: ValidationError | ValidationError[],
): ValidationResult<never> {
  return {
    success: false,
    errors: Array.isArray(errors) ? errors : [errors],
  };
}

/**
 * Helper to create a validation error
 */
export function validationError(
  code: string,
  message: string,
  options?: {
    severity?: ValidationSeverity;
    path?: string;
    context?: Record<string, unknown>;
    suggestion?: string;
  },
): ValidationError {
  return {
    code,
    message,
    severity: options?.severity ?? "ERROR",
    path: options?.path,
    context: options?.context,
    suggestion: options?.suggestion,
  };
}

/**
 * Combine multiple validation results
 * If any fail, return combined failure
 * If all succeed, return combined success with merged warnings
 */
export function combineResults<T>(
  results: ValidationResult<T>[],
): ValidationResult<T[]> {
  const failures = results.filter((r) => !r.success);

  if (failures.length > 0) {
    const allErrors = failures.flatMap((f) => (f.success ? [] : f.errors));
    return failure(allErrors);
  }

  const successes = results.filter((r) => r.success);
  const values = successes.map((s) => (s.success ? s.value : (null as never)));
  const allWarnings = successes.flatMap((s) =>
    s.success && s.warnings ? s.warnings : [],
  );

  return success(values, allWarnings.length > 0 ? allWarnings : undefined);
}
