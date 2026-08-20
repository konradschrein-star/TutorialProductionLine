/**
 * Validation Registry
 *
 * Central registry for all validators.
 * Enables stage-based validation lookup and execution.
 */

import type {
  Validator,
  ValidationContext,
  ValidationResult,
} from "./types.js";
import { combineResults, failure, validationError } from "./types.js";

export class ValidationRegistry {
  private validators = new Map<string, Validator<unknown, unknown>>();

  /**
   * Register a validator
   */
  register<TInput, TOutput>(validator: Validator<TInput, TOutput>): void {
    if (this.validators.has(validator.id)) {
      throw new Error(
        `Validator with id "${validator.id}" is already registered`,
      );
    }
    this.validators.set(validator.id, validator as Validator<unknown, unknown>);
  }

  /**
   * Get a validator by ID
   */
  get<TInput, TOutput>(id: string): Validator<TInput, TOutput> | undefined {
    return this.validators.get(id) as Validator<TInput, TOutput> | undefined;
  }

  /**
   * Get all validators for a specific pipeline stage
   */
  getForStage(stage: string): Validator<unknown, unknown>[] {
    return Array.from(this.validators.values()).filter((v) =>
      v.applicableStages.includes(stage),
    );
  }

  /**
   * Run all validators for a stage against input data
   * Returns combined validation result
   * FAILS FAST: If any validator fails, returns immediately with all errors
   */
  async validateStage<T>(
    stage: string,
    input: T,
    context: ValidationContext,
  ): Promise<ValidationResult<T>> {
    const validators = this.getForStage(stage);

    if (validators.length === 0) {
      // No validators registered for this stage - this is a warning condition
      // The system should have validators for all critical stages
      return {
        success: true,
        value: input,
        warnings: [
          validationError(
            "NO_VALIDATORS_REGISTERED",
            `No validators registered for stage "${stage}"`,
            {
              severity: "WARNING",
              path: "validation.registry",
              context: { stage },
              suggestion: `Register validators for "${stage}" stage to enable validation`,
            },
          ),
        ],
      };
    }

    // Run all validators in parallel
    const results = await Promise.all(
      validators.map((validator) =>
        validator.validate(input, context).catch((error) => {
          // Catch validator crashes and convert to validation failure
          // This ensures one broken validator doesn't crash the entire validation system
          return failure(
            validationError(
              "VALIDATOR_CRASHED",
              `Validator "${validator.id}" crashed: ${error instanceof Error ? error.message : String(error)}`,
              {
                severity: "ERROR",
                path: `validation.${validator.id}`,
                context: {
                  validatorId: validator.id,
                  error: error instanceof Error ? error.stack : String(error),
                },
                suggestion: `Fix the validator implementation or disable it temporarily`,
              },
            ),
          );
        }),
      ),
    );

    // Combine all results
    const combined = combineResults(results);

    // If validation failed, return the errors
    if (!combined.success) {
      return combined;
    }

    // All validators passed - return original input with any warnings
    return {
      success: true,
      value: input,
      warnings: combined.warnings,
    };
  }

  /**
   * Run a specific validator by ID
   */
  async validateWith<TInput, TOutput>(
    validatorId: string,
    input: TInput,
    context: ValidationContext,
  ): Promise<ValidationResult<TOutput>> {
    const validator = this.get<TInput, TOutput>(validatorId);

    if (!validator) {
      return failure(
        validationError(
          "VALIDATOR_NOT_FOUND",
          `Validator "${validatorId}" not found in registry`,
          {
            severity: "ERROR",
            path: "validation.registry",
            context: { validatorId },
            suggestion: `Ensure the validator is registered before use`,
          },
        ),
      );
    }

    return validator.validate(input, context);
  }

  /**
   * List all registered validators
   */
  listAll(): Array<{
    id: string;
    name: string;
    description: string;
    applicableStages: string[];
  }> {
    return Array.from(this.validators.values()).map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description,
      applicableStages: v.applicableStages,
    }));
  }

  /**
   * Check if a validator is registered
   */
  has(id: string): boolean {
    return this.validators.has(id);
  }

  /**
   * Unregister a validator (useful for testing)
   */
  unregister(id: string): boolean {
    return this.validators.delete(id);
  }

  /**
   * Clear all validators (useful for testing)
   */
  clear(): void {
    this.validators.clear();
  }
}

/**
 * Global validation registry instance
 * Initialized at application startup
 */
let globalRegistry: ValidationRegistry | null = null;

/**
 * Get the global validation registry
 * Creates one if it doesn't exist
 */
export function getValidationRegistry(): ValidationRegistry {
  if (!globalRegistry) {
    globalRegistry = new ValidationRegistry();
  }
  return globalRegistry;
}

/**
 * Reset the global registry (for testing)
 */
export function resetValidationRegistry(): void {
  globalRegistry = null;
}
