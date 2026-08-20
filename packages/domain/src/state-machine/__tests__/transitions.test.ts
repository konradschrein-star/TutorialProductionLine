/**
 * State Transition Logic Tests
 *
 * Tests transitionJob() and getAvailableTransitions() from transitions.ts,
 * plus state-query predicates from state-queries.ts.
 */

import { describe, it, expect } from "vitest";
import { transitionJob, getAvailableTransitions } from "../transitions.js";
import { TransitionError, PauseError, ResumeError } from "../../errors/index.js";
import {
  isTerminalState,
  isFailureState,
  canRetry,
  canPause,
  isAwaitingHumanAction,
  isActivelyProcessing,
} from "../state-queries.js";

// ---------------------------------------------------------------------------
// transitionJob — valid forward transitions
// ---------------------------------------------------------------------------

describe("transitionJob — valid forward transitions", () => {
  it("allows IDEA_GENERATION → SCRIPTING", () => {
    const result = transitionJob("IDEA_GENERATION", "SCRIPTING");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("SCRIPTING");
    }
  });

  it("allows SCRIPTING → ASSET_COLLECTION", () => {
    const result = transitionJob("SCRIPTING", "ASSET_COLLECTION");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("ASSET_COLLECTION");
    }
  });

  it("allows ASSET_COLLECTION → QMS_VALIDATING (fully automated path)", () => {
    const result = transitionJob("ASSET_COLLECTION", "QMS_VALIDATING");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("QMS_VALIDATING");
    }
  });

  it("allows QMS_VALIDATING → ROUTING_RENDER", () => {
    const result = transitionJob("QMS_VALIDATING", "ROUTING_RENDER");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("ROUTING_RENDER");
    }
  });

  it("allows ROUTING_RENDER → RENDERING_FFMPEG", () => {
    const result = transitionJob("ROUTING_RENDER", "RENDERING_FFMPEG");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("RENDERING_FFMPEG");
    }
  });

  it("allows ROUTING_RENDER → RENDERING_REMOTION", () => {
    const result = transitionJob("ROUTING_RENDER", "RENDERING_REMOTION");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("RENDERING_REMOTION");
    }
  });

  it("allows RENDERING_FFMPEG → AWAITING_QC", () => {
    const result = transitionJob("RENDERING_FFMPEG", "AWAITING_QC");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("AWAITING_QC");
    }
  });

  it("allows UPLOADING → PUBLISHED", () => {
    const result = transitionJob("UPLOADING", "PUBLISHED");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("PUBLISHED");
    }
  });

  it("allows PUBLISHED → MARKED_FOR_DELETION", () => {
    const result = transitionJob("PUBLISHED", "MARKED_FOR_DELETION");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("MARKED_FOR_DELETION");
    }
  });

  it("allows MARKED_FOR_DELETION → DELETED", () => {
    const result = transitionJob("MARKED_FOR_DELETION", "DELETED");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("DELETED");
    }
  });

  it("returns { success: true, value: targetStatus } (not data property)", () => {
    const result = transitionJob("SCRIPTING", "ASSET_COLLECTION");
    expect(result.success).toBe(true);
    if (result.success) {
      // Confirm the discriminated union shape
      expect(result).toHaveProperty("value", "ASSET_COLLECTION");
      expect(result).not.toHaveProperty("data");
    }
  });
});

// ---------------------------------------------------------------------------
// transitionJob — invalid forward transitions
// ---------------------------------------------------------------------------

describe("transitionJob — invalid forward transitions", () => {
  it("rejects IDEA_GENERATION → PUBLISHED", () => {
    const result = transitionJob("IDEA_GENERATION", "PUBLISHED");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(TransitionError);
    }
  });

  it("rejects SCRIPTING → RENDERING_FFMPEG (skips required stages)", () => {
    const result = transitionJob("SCRIPTING", "RENDERING_FFMPEG");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(TransitionError);
    }
  });

  it("rejects PUBLISHED → SCRIPTING", () => {
    const result = transitionJob("PUBLISHED", "SCRIPTING");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(TransitionError);
    }
  });

  it("rejects DELETED → any status (truly terminal)", () => {
    const result = transitionJob("DELETED", "IDEA_GENERATION");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(TransitionError);
    }
  });

  it("TransitionError carries fromStatus and toStatus", () => {
    const result = transitionJob("IDEA_GENERATION", "PUBLISHED");
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error as TransitionError;
      expect(err.fromStatus).toBe("IDEA_GENERATION");
      expect(err.toStatus).toBe("PUBLISHED");
    }
  });

  it("TransitionError has name 'TransitionError'", () => {
    const result = transitionJob("SCRIPTING", "UPLOADED" as never);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.name).toBe("TransitionError");
    }
  });
});

// ---------------------------------------------------------------------------
// transitionJob — pause transitions
// ---------------------------------------------------------------------------

describe("transitionJob — pausing", () => {
  it("allows pausing from a pausable state (IDEA_GENERATION)", () => {
    const result = transitionJob("IDEA_GENERATION", "PAUSED");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("PAUSED");
    }
  });

  it("allows pausing from RENDERING_FFMPEG", () => {
    const result = transitionJob("RENDERING_FFMPEG", "PAUSED");
    expect(result.success).toBe(true);
  });

  it("allows pausing from UPLOADING", () => {
    const result = transitionJob("UPLOADING", "PAUSED");
    expect(result.success).toBe(true);
  });

  it("rejects pausing from a terminal state (PUBLISHED)", () => {
    const result = transitionJob("PUBLISHED", "PAUSED");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(PauseError);
      expect(result.error.name).toBe("PauseError");
    }
  });

  it("rejects pausing from DELETED", () => {
    const result = transitionJob("DELETED", "PAUSED");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(PauseError);
    }
  });

  it("rejects pausing from CANCELLED", () => {
    const result = transitionJob("CANCELLED", "PAUSED");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(PauseError);
    }
  });

  it("rejects pausing from a failure state (FAILED_RENDER)", () => {
    const result = transitionJob("FAILED_RENDER", "PAUSED");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(PauseError);
    }
  });

  it("rejects pausing from FAILED_QMS", () => {
    const result = transitionJob("FAILED_QMS", "PAUSED");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(PauseError);
    }
  });

  it("PauseError carries currentStatus", () => {
    const result = transitionJob("PUBLISHED", "PAUSED");
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error as PauseError;
      expect(err.currentStatus).toBe("PUBLISHED");
    }
  });
});

// ---------------------------------------------------------------------------
// transitionJob — resume transitions
// ---------------------------------------------------------------------------

describe("transitionJob — resuming", () => {
  it("allows resume when target matches pausedFromStatus", () => {
    const result = transitionJob("PAUSED", "SCRIPTING", "SCRIPTING");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("SCRIPTING");
    }
  });

  it("allows resume from any pipeline state", () => {
    const result = transitionJob("PAUSED", "RENDERING_FFMPEG", "RENDERING_FFMPEG");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("RENDERING_FFMPEG");
    }
  });

  it("rejects resume without pausedFromStatus", () => {
    const result = transitionJob("PAUSED", "SCRIPTING");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ResumeError);
      expect(result.error.name).toBe("ResumeError");
    }
  });

  it("rejects resume without pausedFromStatus (null)", () => {
    const result = transitionJob("PAUSED", "SCRIPTING", null);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ResumeError);
    }
  });

  it("rejects resume when target does not match pausedFromStatus", () => {
    const result = transitionJob("PAUSED", "SCRIPTING", "RENDERING_FFMPEG");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ResumeError);
    }
  });

  it("ResumeError message contains mismatch information", () => {
    const result = transitionJob("PAUSED", "SCRIPTING", "RENDERING_FFMPEG");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("SCRIPTING");
      expect(result.error.message).toContain("RENDERING_FFMPEG");
    }
  });
});

// ---------------------------------------------------------------------------
// getAvailableTransitions
// ---------------------------------------------------------------------------

describe("getAvailableTransitions", () => {
  it("returns the transition map entries for normal states", () => {
    const transitions = getAvailableTransitions("IDEA_GENERATION");
    expect(transitions).toContain("SCRIPTING");
    expect(transitions).toContain("PAUSED");
  });

  it("returns [pausedFromStatus] when PAUSED with a known origin", () => {
    const transitions = getAvailableTransitions("PAUSED", "SCRIPTING");
    expect(transitions).toEqual(["SCRIPTING"]);
  });

  it("returns [] when PAUSED without a known origin", () => {
    const transitions = getAvailableTransitions("PAUSED");
    expect(transitions).toEqual([]);
  });

  it("returns [] when PAUSED with null origin", () => {
    const transitions = getAvailableTransitions("PAUSED", null);
    expect(transitions).toEqual([]);
  });

  it("returns [] for DELETED (truly terminal)", () => {
    const transitions = getAvailableTransitions("DELETED");
    expect(transitions).toEqual([]);
  });

  it("returns only MARKED_FOR_DELETION for PUBLISHED", () => {
    const transitions = getAvailableTransitions("PUBLISHED");
    expect(transitions).toEqual(["MARKED_FOR_DELETION"]);
  });
});

// ---------------------------------------------------------------------------
// state-queries — isTerminalState
// ---------------------------------------------------------------------------

describe("isTerminalState", () => {
  it("returns true for PUBLISHED", () => {
    expect(isTerminalState("PUBLISHED")).toBe(true);
  });

  it("returns true for DELETED", () => {
    expect(isTerminalState("DELETED")).toBe(true);
  });

  it("returns true for CANCELLED", () => {
    expect(isTerminalState("CANCELLED")).toBe(true);
  });

  it("returns false for active pipeline states", () => {
    expect(isTerminalState("SCRIPTING")).toBe(false);
    expect(isTerminalState("RENDERING_FFMPEG")).toBe(false);
    expect(isTerminalState("UPLOADING")).toBe(false);
  });

  it("returns false for PAUSED", () => {
    expect(isTerminalState("PAUSED")).toBe(false);
  });

  it("returns false for failure states", () => {
    expect(isTerminalState("FAILED_RENDER")).toBe(false);
    expect(isTerminalState("FAILED_QMS")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// state-queries — isFailureState
// ---------------------------------------------------------------------------

describe("isFailureState", () => {
  it("returns true for FAILED_QMS", () => {
    expect(isFailureState("FAILED_QMS")).toBe(true);
  });

  it("returns true for FAILED_RENDER", () => {
    expect(isFailureState("FAILED_RENDER")).toBe(true);
  });

  it("returns true for FAILED_UPLOAD", () => {
    expect(isFailureState("FAILED_UPLOAD")).toBe(true);
  });

  it("returns true for FAILED_GENERAL", () => {
    expect(isFailureState("FAILED_GENERAL")).toBe(true);
  });

  it("returns false for non-failure states", () => {
    expect(isFailureState("SCRIPTING")).toBe(false);
    expect(isFailureState("PUBLISHED")).toBe(false);
    expect(isFailureState("PAUSED")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// state-queries — canRetry
// ---------------------------------------------------------------------------

describe("canRetry", () => {
  it("is true for all failure states", () => {
    expect(canRetry("FAILED_QMS")).toBe(true);
    expect(canRetry("FAILED_RENDER")).toBe(true);
    expect(canRetry("FAILED_UPLOAD")).toBe(true);
    expect(canRetry("FAILED_GENERAL")).toBe(true);
  });

  it("is false for active states", () => {
    expect(canRetry("SCRIPTING")).toBe(false);
    expect(canRetry("RENDERING_FFMPEG")).toBe(false);
  });

  it("is false for terminal states", () => {
    expect(canRetry("PUBLISHED")).toBe(false);
    expect(canRetry("DELETED")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// state-queries — canPause
// ---------------------------------------------------------------------------

describe("canPause", () => {
  it("is true for all pausable pipeline states", () => {
    const pausable = [
      "IDEA_GENERATION",
      "SCRIPTING",
      "ASSET_COLLECTION",
      "AWAITING_PRODUCTION_VA",
      "AWAITING_IMAGE_QC",
      "QMS_VALIDATING",
      "ROUTING_RENDER",
      "RENDERING_FFMPEG",
      "RENDERING_REMOTION",
      "AWAITING_QC",
      "AWAITING_UPLOADER",
      "UPLOADING",
    ] as const;
    for (const status of pausable) {
      expect(canPause(status)).toBe(true);
    }
  });

  it("is false for terminal states", () => {
    expect(canPause("PUBLISHED")).toBe(false);
    expect(canPause("DELETED")).toBe(false);
    expect(canPause("CANCELLED")).toBe(false);
  });

  it("is false for failure states", () => {
    expect(canPause("FAILED_QMS")).toBe(false);
    expect(canPause("FAILED_RENDER")).toBe(false);
    expect(canPause("FAILED_UPLOAD")).toBe(false);
    expect(canPause("FAILED_GENERAL")).toBe(false);
  });

  it("is false for PAUSED itself", () => {
    expect(canPause("PAUSED")).toBe(false);
  });

  it("is false for MARKED_FOR_DELETION", () => {
    expect(canPause("MARKED_FOR_DELETION")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// state-queries — isAwaitingHumanAction
// ---------------------------------------------------------------------------

describe("isAwaitingHumanAction", () => {
  it("returns true for AWAITING_PRODUCTION_VA", () => {
    expect(isAwaitingHumanAction("AWAITING_PRODUCTION_VA")).toBe(true);
  });

  it("returns true for AWAITING_IMAGE_QC", () => {
    expect(isAwaitingHumanAction("AWAITING_IMAGE_QC")).toBe(true);
  });

  it("returns true for AWAITING_QC", () => {
    expect(isAwaitingHumanAction("AWAITING_QC")).toBe(true);
  });

  it("returns true for AWAITING_UPLOADER", () => {
    expect(isAwaitingHumanAction("AWAITING_UPLOADER")).toBe(true);
  });

  it("returns false for automated pipeline states", () => {
    expect(isAwaitingHumanAction("SCRIPTING")).toBe(false);
    expect(isAwaitingHumanAction("RENDERING_FFMPEG")).toBe(false);
    expect(isAwaitingHumanAction("QMS_VALIDATING")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// state-queries — isActivelyProcessing
// ---------------------------------------------------------------------------

describe("isActivelyProcessing", () => {
  it("returns true for automated worker states", () => {
    const active = [
      "IDEA_GENERATION",
      "SCRIPTING",
      "ASSET_COLLECTION",
      "QMS_VALIDATING",
      "ROUTING_RENDER",
      "RENDERING_FFMPEG",
      "RENDERING_REMOTION",
      "UPLOADING",
    ] as const;
    for (const status of active) {
      expect(isActivelyProcessing(status)).toBe(true);
    }
  });

  it("returns false for human-in-the-loop states", () => {
    expect(isActivelyProcessing("AWAITING_PRODUCTION_VA")).toBe(false);
    expect(isActivelyProcessing("AWAITING_QC")).toBe(false);
    expect(isActivelyProcessing("AWAITING_UPLOADER")).toBe(false);
  });

  it("returns false for PAUSED", () => {
    expect(isActivelyProcessing("PAUSED")).toBe(false);
  });

  it("returns false for terminal states", () => {
    expect(isActivelyProcessing("PUBLISHED")).toBe(false);
    expect(isActivelyProcessing("DELETED")).toBe(false);
  });

  it("returns false for failure states", () => {
    expect(isActivelyProcessing("FAILED_RENDER")).toBe(false);
    expect(isActivelyProcessing("FAILED_QMS")).toBe(false);
  });
});
