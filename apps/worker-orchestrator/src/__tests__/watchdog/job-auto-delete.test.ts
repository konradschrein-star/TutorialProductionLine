import { describe, it, expect } from "vitest";
import { EXEMPT_STATUSES } from "../../watchdog/job-auto-delete.js";

/**
 * This watchdog HARD-DELETES rows (`db.delete`, not a state transition), on a
 * timer, in production. Its exemption list is therefore a data-loss boundary,
 * not a preference — anything missing from it gets destroyed 48h after its last
 * state change with no way to recover it.
 *
 * It used to exempt only PUBLISHED / DELETED / MARKED_FOR_DELETION, so every
 * human-in-the-loop state was collectable. A RANKING job parked at
 * AWAITING_VA_REVIEW for clip selection over a weekend was deleted on the
 * Sunday, and a render held at AWAITING_QC by the output QA gate — the one
 * thing the gate exists to preserve for a human — was deleted two days later.
 */
describe("auto-delete exemptions protect human-in-the-loop jobs", () => {
  const exempt = new Set<string>(EXEMPT_STATUSES);

  it("never collects a job waiting on a person", () => {
    // Every AWAITING_* state in the job-status enum. A job in any of these is
    // by definition waiting for a human, and "the human has not got to it yet"
    // is the normal state of a queue with a person in it — not garbage.
    const humanStates = [
      "AWAITING_RESEARCH",
      "AWAITING_CLIP_REVIEW",
      "AWAITING_PRODUCTION_VA",
      "AWAITING_IMAGE_QC",
      "AWAITING_VA_REVIEW",
      "AWAITING_QC",
      "AWAITING_UPLOADER",
    ];
    for (const status of humanStates) {
      expect(exempt.has(status), `${status} must be exempt`).toBe(true);
    }
  });

  it("never collects a deliberately paused job", () => {
    expect(exempt.has("PAUSED")).toBe(true);
  });

  it("keeps the original terminal exemptions", () => {
    for (const status of ["PUBLISHED", "DELETED", "MARKED_FOR_DELETION"]) {
      expect(exempt.has(status)).toBe(true);
    }
  });

  it("STILL collects genuinely abandoned work", () => {
    // The watchdog must not become a no-op: a job stuck mid-pipeline with no
    // human waiting on it is exactly what it is for.
    for (const status of [
      "IDEA_GENERATION",
      "SCRIPTING",
      "ASSET_COLLECTION",
      "QMS_VALIDATING",
      "ROUTING_RENDER",
      "FAILED_GENERAL",
    ]) {
      expect(exempt.has(status), `${status} should remain collectable`).toBe(
        false,
      );
    }
  });

  it("the QA gate's holding state is protected", () => {
    // The output QA gate routes a suspect render to AWAITING_QC so a human can
    // decide. Deleting it on a timer would destroy the evidence.
    expect(exempt.has("AWAITING_QC")).toBe(true);
  });
});
