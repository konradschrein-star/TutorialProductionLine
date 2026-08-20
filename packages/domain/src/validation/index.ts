/**
 * Validation Harness - Public API
 *
 * Centralized export for the validation system.
 * Use `bootstrapValidation()` to initialize all validators at app startup.
 */

// Core types and helpers
export type {
  ValidationError,
  ValidationResult,
  ValidationContext,
  ValidationSeverity,
  Validator,
} from "./types.js";

export { success, failure, validationError, combineResults } from "./types.js";

// Registry
export {
  ValidationRegistry,
  getValidationRegistry,
  resetValidationRegistry,
} from "./registry.js";

// Validators
export { IngestValidator } from "./validators/ingest-validator.js";

// Bootstrap function
import { getValidationRegistry } from "./registry.js";
import { IngestValidator } from "./validators/ingest-validator.js";

/**
 * Bootstrap the validation system
 * Registers all validators with the global registry
 * Call this once at application startup
 */
export function bootstrapValidation(): void {
  const registry = getValidationRegistry();

  // Register all validators
  registry.register(new IngestValidator());

  console.log("[validation] Validation system bootstrapped successfully");
  console.log(
    `[validation] Registered ${registry.listAll().length} validators`,
  );
}

/**
 * Helper to validate at a specific pipeline stage
 * Convenience wrapper around registry.validateStage()
 */
export async function validateStage<T>(
  stage: string,
  input: T,
  context: {
    jobId: string;
    format: string;
    environment?: "production" | "staging" | "test-agent";
    metadata?: Record<string, unknown>;
  },
) {
  const registry = getValidationRegistry();

  return registry.validateStage(stage, input, {
    jobId: context.jobId,
    stage,
    format: context.format,
    environment: context.environment ?? "production",
    timestamp: new Date(),
    metadata: context.metadata,
  });
}

/**
 * Helper to validate with a specific validator
 * Convenience wrapper around registry.validateWith()
 */
export async function validateWith<TInput, TOutput>(
  validatorId: string,
  input: TInput,
  context: {
    jobId: string;
    stage: string;
    format: string;
    environment?: "production" | "staging" | "test-agent";
    metadata?: Record<string, unknown>;
  },
) {
  const registry = getValidationRegistry();

  return registry.validateWith<TInput, TOutput>(validatorId, input, {
    jobId: context.jobId,
    stage: context.stage,
    format: context.format,
    environment: context.environment ?? "production",
    timestamp: new Date(),
    metadata: context.metadata,
  });
}
