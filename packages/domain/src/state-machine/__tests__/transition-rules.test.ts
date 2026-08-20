/**
 * Transition Rules Tests
 *
 * Verifies the static TRANSITION_MAP and associated constant arrays are
 * correct and internally consistent.  No IO — pure data assertions.
 */

import { describe, it, expect } from "vitest";
import {
  TRANSITION_MAP,
  TERMINAL_STATES,
  FAILURE_STATES,
  PAUSABLE_STATES,
} from "../transition-rules.js";

// All possible JobStatus values as expressed in the TRANSITION_MAP keys.
// This is derived directly from the source to stay in sync.
const ALL_STATUSES = Object.keys(TRANSITION_MAP) as Array<
  keyof typeof TRANSITION_MAP
>;

describe("TRANSITION_MAP coverage", () => {
  it("contains exactly 52 status entries", () => {
    expect(ALL_STATUSES).toHaveLength(52);
  });

  it("covers every expected JobStatus value", () => {
    const expected = [
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
      "PUBLISHED",
      "PAUSED",
      "CANCELLED",
      "FAILED_QMS",
      "FAILED_RENDER",
      "FAILED_UPLOAD",
      "FAILED_GENERAL",
      "MARKED_FOR_DELETION",
      "DELETED",
    ];
    for (const status of expected) {
      expect(ALL_STATUSES).toContain(status);
    }
  });

  it("has no duplicate allowed transitions for any status", () => {
    for (const status of ALL_STATUSES) {
      const transitions = TRANSITION_MAP[status];
      const uniqueTransitions = new Set(transitions);
      expect(uniqueTransitions.size).toBe(transitions.length);
    }
  });

  it("all transition targets are themselves valid statuses", () => {
    for (const status of ALL_STATUSES) {
      for (const target of TRANSITION_MAP[status]) {
        expect(ALL_STATUSES).toContain(target);
      }
    }
  });
});

describe("DELETED status", () => {
  it("has no allowed transitions (truly terminal)", () => {
    expect(TRANSITION_MAP.DELETED).toEqual([]);
  });
});

describe("PUBLISHED and CANCELLED", () => {
  it("PUBLISHED only allows MARKED_FOR_DELETION", () => {
    expect(TRANSITION_MAP.PUBLISHED).toEqual(["MARKED_FOR_DELETION"]);
  });

  it("CANCELLED only allows MARKED_FOR_DELETION", () => {
    expect(TRANSITION_MAP.CANCELLED).toEqual(["MARKED_FOR_DELETION"]);
  });
});

describe("MARKED_FOR_DELETION", () => {
  it("only allows DELETED", () => {
    expect(TRANSITION_MAP.MARKED_FOR_DELETION).toEqual(["DELETED"]);
  });
});

describe("FAILURE_STATES", () => {
  it("contains the six expected failure statuses", () => {
    expect(FAILURE_STATES).toContain("FAILED_CLIP_SELECTION");
    expect(FAILURE_STATES).toContain("FAILED_QMS");
    expect(FAILURE_STATES).toContain("FAILED_RENDER");
    expect(FAILURE_STATES).toContain("FAILED_UPLOAD");
    expect(FAILURE_STATES).toContain("FAILED_GENERAL");
    expect(FAILURE_STATES).toContain("FAILED_IRRECOVERABLE");
    expect(FAILURE_STATES).toHaveLength(10);
  });

  it("every failure state allows MARKED_FOR_DELETION", () => {
    for (const status of FAILURE_STATES) {
      expect(TRANSITION_MAP[status as keyof typeof TRANSITION_MAP]).toContain(
        "MARKED_FOR_DELETION",
      );
    }
  });

  it("no failure state allows PAUSED", () => {
    // Failure states are not pausable — pausing is for active pipeline states only
    for (const status of FAILURE_STATES) {
      expect(
        TRANSITION_MAP[status as keyof typeof TRANSITION_MAP],
      ).not.toContain("PAUSED");
    }
  });
});

describe("TERMINAL_STATES", () => {
  it("contains PUBLISHED, DELETED, CANCELLED, FAILED_IRRECOVERABLE", () => {
    expect(TERMINAL_STATES).toContain("PUBLISHED");
    expect(TERMINAL_STATES).toContain("DELETED");
    expect(TERMINAL_STATES).toContain("CANCELLED");
    expect(TERMINAL_STATES).toContain("FAILED_IRRECOVERABLE");
    expect(TERMINAL_STATES).toHaveLength(4);
  });
});

describe("PAUSABLE_STATES", () => {
  it("contains all active pipeline stages", () => {
    const expected = [
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
    ];
    for (const status of expected) {
      expect(PAUSABLE_STATES).toContain(status);
    }
  });

  it("does not include terminal states", () => {
    for (const status of TERMINAL_STATES) {
      expect(PAUSABLE_STATES).not.toContain(status);
    }
  });

  it("does not include failure states", () => {
    for (const status of FAILURE_STATES) {
      expect(PAUSABLE_STATES).not.toContain(status);
    }
  });

  it("does not include PAUSED itself", () => {
    expect(PAUSABLE_STATES).not.toContain("PAUSED");
  });

  it("does not include MARKED_FOR_DELETION", () => {
    expect(PAUSABLE_STATES).not.toContain("MARKED_FOR_DELETION");
  });

  it("every pausable state includes PAUSED in its allowed transitions", () => {
    for (const status of PAUSABLE_STATES) {
      expect(TRANSITION_MAP[status as keyof typeof TRANSITION_MAP]).toContain(
        "PAUSED",
      );
    }
  });
});

describe("Happy-path pipeline chain navigability", () => {
  /**
   * The canonical fully-automated happy path (no VA steps, no QC).
   * Each step must appear in the previous step's allowed transitions.
   */
  const happyPath = [
    "IDEA_GENERATION",
    "SCRIPTING",
    "ASSET_COLLECTION",
    "QMS_VALIDATING",
    "ROUTING_RENDER",
    "RENDERING_FFMPEG",
    "AWAITING_QC",
    "AWAITING_UPLOADER",
    "UPLOADING",
    "PUBLISHED",
    "MARKED_FOR_DELETION",
    "DELETED",
  ] as const;

  it("every consecutive pair is a legal transition", () => {
    for (let i = 0; i < happyPath.length - 1; i++) {
      const from = happyPath[i];
      const to = happyPath[i + 1];
      expect(TRANSITION_MAP[from]).toContain(to);
    }
  });

  it("RENDERING_REMOTION also leads to AWAITING_QC (parallel render path)", () => {
    expect(TRANSITION_MAP.RENDERING_REMOTION).toContain("AWAITING_QC");
  });
});

describe("VA loop-back transitions", () => {
  it("AWAITING_PRODUCTION_VA can return to SCRIPTING", () => {
    expect(TRANSITION_MAP.AWAITING_PRODUCTION_VA).toContain("SCRIPTING");
  });

  it("AWAITING_PRODUCTION_VA can return to ASSET_COLLECTION", () => {
    expect(TRANSITION_MAP.AWAITING_PRODUCTION_VA).toContain("ASSET_COLLECTION");
  });

  it("AWAITING_QC can send back to ROUTING_RENDER for re-render", () => {
    expect(TRANSITION_MAP.AWAITING_QC).toContain("ROUTING_RENDER");
  });

  it("AWAITING_IMAGE_QC can return to ASSET_COLLECTION for regeneration", () => {
    expect(TRANSITION_MAP.AWAITING_IMAGE_QC).toContain("ASSET_COLLECTION");
  });
});

describe("Failure state retry paths", () => {
  it("FAILED_QMS can retry QMS_VALIDATING", () => {
    expect(TRANSITION_MAP.FAILED_QMS).toContain("QMS_VALIDATING");
  });

  it("FAILED_QMS can re-collect assets", () => {
    expect(TRANSITION_MAP.FAILED_QMS).toContain("ASSET_COLLECTION");
  });

  it("FAILED_RENDER can retry via ROUTING_RENDER", () => {
    expect(TRANSITION_MAP.FAILED_RENDER).toContain("ROUTING_RENDER");
  });

  it("FAILED_UPLOAD can retry UPLOADING", () => {
    expect(TRANSITION_MAP.FAILED_UPLOAD).toContain("UPLOADING");
  });

  it("FAILED_GENERAL can restart from IDEA_GENERATION", () => {
    expect(TRANSITION_MAP.FAILED_GENERAL).toContain("IDEA_GENERATION");
  });
});
