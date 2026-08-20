/**
 * Retry wrapper for file operations that may fail due to temporary locks.
 *
 * Handles Windows/OneDrive-specific file locking issues where files are
 * temporarily locked during sync operations. Uses exponential backoff to
 * retry operations that fail with EBUSY or EPERM errors.
 *
 * @param operation - The file operation to retry
 * @param options - Configuration options for retry behavior
 * @returns The result of the successful operation
 * @throws The original error if max attempts reached or non-retryable error
 */
export async function retryFileOperation<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    backoffMultiplier?: number;
    operationName?: string;
  } = {},
): Promise<T> {
  const {
    maxAttempts = 5,
    baseDelayMs = 100,
    backoffMultiplier = 2,
    operationName = "file operation",
  } = options;

  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err: any) {
      lastError = err;

      // Check if error is retryable
      const isRetryable = isRetryableError(err);

      // Get error message for logging
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (attempt === maxAttempts) {
        console.error(
          `[retry] ${operationName} failed after ${maxAttempts} attempts: ${errorMessage}`,
        );
        throw err; // Throw original error
      }

      if (!isRetryable) {
        console.error(
          `[retry] ${operationName} failed with non-retryable error: ${errorMessage}`,
        );
        throw err; // Throw original error
      }

      // Calculate delay with exponential backoff
      const delayMs = baseDelayMs * Math.pow(backoffMultiplier, attempt - 1);

      console.log(
        `[retry] ${operationName} failed (${err.code}): ${errorMessage}`,
      );
      console.log(
        `[retry] Attempt ${attempt}/${maxAttempts} - Retrying in ${delayMs}ms...`,
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // This should never be reached due to the throw in the loop, but TypeScript needs it
  throw lastError || new Error("Operation failed with unknown error");
}

/**
 * Determines if a file operation error is retryable.
 *
 * Retryable errors:
 * - EBUSY: Resource busy or locked (OneDrive sync, antivirus scan, etc.)
 * - EPERM: Operation not permitted (temporary permission issues)
 *
 * Non-retryable errors:
 * - ENOENT: File not found (won't resolve with retry)
 * - EACCES: Permission denied (permanent access issue)
 * - EEXIST: File already exists (logical error, not a lock)
 * - All other errors
 */
function isRetryableError(err: any): boolean {
  const retryableCodes = ["EBUSY", "EPERM"];
  return retryableCodes.includes(err.code);
}
