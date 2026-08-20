/**
 * Core State Transition Logic
 *
 * Pure functions for validating and executing state transitions.
 * Zero side effects - just business rules.
 *
 * Design:
 * - Result<T, E> pattern for functional error handling
 * - No exceptions thrown - errors are returned as values
 * - Explicit pause/resume handling via paused_from_status
 */

import {
  TRANSITION_MAP,
  PAUSABLE_STATES,
  TERMINAL_STATES,
  FAILURE_STATES,
} from "./transition-rules.js";
import { TransitionError, PauseError, ResumeError } from "../errors/index.js";

/**
 * Result Type
 *
 * Discriminated union for success/failure results.
 * Enables functional error handling without exceptions.
 */
export type Result<T, E> =
  | { success: true; value: T }
  | { success: false; error: E };

/**
 * Job Status Type
 * (Inferred from TRANSITION_MAP keys)
 */
type JobStatus = keyof typeof TRANSITION_MAP;

/**
 * Transition Job
 *
 * Validates whether a state transition is legal according to TRANSITION_MAP.
 *
 * Special handling:
 * - Transitioning TO PAUSED: Validates current state is pausable
 * - Transitioning FROM PAUSED: Validates target matches paused_from_status
 *
 * @param currentStatus - Current job status
 * @param targetStatus - Desired target status
 * @param pausedFromStatus - Status before PAUSED (required when resuming)
 * @returns Result with target status on success, error on failure
 */
export function transitionJob(
  currentStatus: JobStatus,
  targetStatus: JobStatus,
  pausedFromStatus?: JobStatus | null
): Result<JobStatus, TransitionError | PauseError | ResumeError> {
  // Special case: Pausing a job
  if (targetStatus === "PAUSED") {
    if (!PAUSABLE_STATES.includes(currentStatus)) {
      return {
        success: false,
        error: new PauseError(
          currentStatus,
          `State ${currentStatus} is not pausable (terminal or failure state)`
        ),
      };
    }
    // Pausing is always allowed from pausable states
    return { success: true, value: targetStatus };
  }

  // Special case: Resuming from PAUSED
  if (currentStatus === "PAUSED") {
    if (!pausedFromStatus) {
      return {
        success: false,
        error: new ResumeError(
          "Cannot resume without paused_from_status - no target state known"
        ),
      };
    }
    if (targetStatus !== pausedFromStatus) {
      return {
        success: false,
        error: new ResumeError(
          `Target status ${targetStatus} does not match paused_from_status ${pausedFromStatus}`
        ),
      };
    }
    // Valid resume
    return { success: true, value: targetStatus };
  }

  // Normal transition: Check TRANSITION_MAP
  const allowedTransitions = TRANSITION_MAP[currentStatus];

  if (!allowedTransitions.includes(targetStatus)) {
    return {
      success: false,
      error: new TransitionError(
        currentStatus,
        targetStatus,
        `Transition not allowed per TRANSITION_MAP. Allowed transitions: ${allowedTransitions.join(", ")}`
      ),
    };
  }

  // Valid transition
  return { success: true, value: targetStatus };
}

/**
 * Get Available Transitions
 *
 * Returns array of valid next states from current status.
 * Useful for UI dropdowns and operational dashboards.
 *
 * Special case: If current is PAUSED, return [pausedFromStatus]
 * (can only resume to one state).
 *
 * @param currentStatus - Current job status
 * @param pausedFromStatus - Status before PAUSED (for resume logic)
 * @returns Array of legal next states
 */
export function getAvailableTransitions(
  currentStatus: JobStatus,
  pausedFromStatus?: JobStatus | null
): JobStatus[] {
  // Special case: PAUSED can only resume to paused_from_status
  if (currentStatus === "PAUSED") {
    return pausedFromStatus ? [pausedFromStatus] : [];
  }

  // Normal case: Return allowed transitions from TRANSITION_MAP
  return TRANSITION_MAP[currentStatus];
}
