/**
 * State Transition Errors
 *
 * Custom error types for domain-level state transition failures.
 * These are discriminated errors providing structured failure information.
 *
 * Design: These are NOT thrown - they're returned as Result.failure()
 * values for functional error handling.
 */

/**
 * Illegal State Transition Error
 *
 * Thrown when attempting a state transition that violates the TRANSITION_MAP.
 */
export class TransitionError extends Error {
  constructor(
    public readonly fromStatus: string,
    public readonly toStatus: string,
    public readonly reason: string
  ) {
    super(
      `Illegal transition from ${fromStatus} to ${toStatus}: ${reason}`
    );
    this.name = "TransitionError";
  }
}

/**
 * Pause Error
 *
 * Thrown when attempting to pause a job in a non-pausable state.
 */
export class PauseError extends Error {
  constructor(
    public readonly currentStatus: string,
    public readonly reason: string
  ) {
    super(`Cannot pause job in status ${currentStatus}: ${reason}`);
    this.name = "PauseError";
  }
}

/**
 * Resume Error
 *
 * Thrown when attempting to resume without valid paused_from_status.
 */
export class ResumeError extends Error {
  constructor(public readonly reason: string) {
    super(`Cannot resume job: ${reason}`);
    this.name = "ResumeError";
  }
}
