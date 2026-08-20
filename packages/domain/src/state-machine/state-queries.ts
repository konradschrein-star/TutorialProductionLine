/**
 * State Query Functions
 *
 * Helper functions for querying job state properties.
 * Pure predicates - no side effects.
 *
 * These are useful for:
 * - UI conditional rendering (show/hide buttons)
 * - Dashboard filtering (show only active jobs)
 * - Worker routing (pick up jobs awaiting processing)
 * - Operational analytics (count jobs by category)
 */

import {
  TERMINAL_STATES,
  FAILURE_STATES,
  PAUSABLE_STATES,
} from "./transition-rules.js";

/**
 * Job Status Type
 */
type JobStatus =
  | "IDEA_GENERATION"
  | "SCRIPTING"
  | "AWAITING_RESEARCH"
  | "RESEARCH_UPLOADED"
  | "ASSET_COLLECTION"
  | "CLIP_SELECTION"
  | "AWAITING_CLIP_REVIEW"
  | "AWAITING_PRODUCTION_VA"
  | "AWAITING_IMAGE_QC"
  | "AWAITING_VA_REVIEW"
  | "QMS_VALIDATING"
  | "ROUTING_RENDER"
  | "RENDERING_FFMPEG"
  | "RENDERING_REMOTION"
  | "AWAITING_QC"
  | "AWAITING_UPLOADER"
  | "UPLOADING"
  | "PUBLISHED"
  | "PAUSED"
  | "CANCELLED"
  | "FAILED_QMS"
  | "FAILED_CLIP_SELECTION"
  | "FAILED_RENDER"
  | "FAILED_UPLOAD"
  | "FAILED_GENERAL"
  | "FAILED_IRRECOVERABLE"
  | "MARKED_FOR_DELETION"
  | "DELETED";

/**
 * Is Terminal State
 *
 * Returns true if the job has reached a terminal state.
 * Terminal states: PUBLISHED, DELETED, CANCELLED
 */
export function isTerminalState(status: JobStatus): boolean {
  return TERMINAL_STATES.includes(status);
}

/**
 * Is Failure State
 *
 * Returns true if the job is in a failure state.
 * Failure states: FAILED_QMS, FAILED_RENDER, FAILED_UPLOAD, FAILED_GENERAL
 */
export function isFailureState(status: JobStatus): boolean {
  return FAILURE_STATES.includes(status);
}

/**
 * Can Retry
 *
 * Returns true if the job can be retried.
 * All failure states support retry operations.
 */
export function canRetry(status: JobStatus): boolean {
  return isFailureState(status);
}

/**
 * Can Pause
 *
 * Returns true if the job can be paused.
 * Terminal and failure states cannot be paused.
 */
export function canPause(status: JobStatus): boolean {
  return PAUSABLE_STATES.includes(status);
}

/**
 * Is Awaiting Human Action
 *
 * Returns true if the job is waiting for human operator intervention.
 * Human-in-the-loop states: AWAITING_PRODUCTION_VA, AWAITING_QC, AWAITING_UPLOADER
 */
export function isAwaitingHumanAction(status: JobStatus): boolean {
  return (
    status === "AWAITING_PRODUCTION_VA" ||
    status === "AWAITING_IMAGE_QC" ||
    status === "AWAITING_VA_REVIEW" ||
    status === "AWAITING_QC" ||
    status === "AWAITING_UPLOADER"
  );
}

/**
 * Is Actively Processing
 *
 * Returns true if the job is in an automated pipeline stage.
 * Excludes human-in-the-loop, terminal, failure, and paused states.
 *
 * Actively processing states:
 * - IDEA_GENERATION, SCRIPTING, RESEARCH_UPLOADED, ASSET_COLLECTION
 * - CLIP_SELECTION, QMS_VALIDATING, ROUTING_RENDER
 * - RENDERING_FFMPEG, RENDERING_REMOTION
 * - UPLOADING
 */
export function isActivelyProcessing(status: JobStatus): boolean {
  const activeStates: JobStatus[] = [
    "IDEA_GENERATION",
    "SCRIPTING",
    "RESEARCH_UPLOADED",
    "ASSET_COLLECTION",
    "CLIP_SELECTION",
    "QMS_VALIDATING",
    "ROUTING_RENDER",
    "RENDERING_FFMPEG",
    "RENDERING_REMOTION",
    "UPLOADING",
  ];

  return activeStates.includes(status);
}
