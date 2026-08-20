import { describe, it, expect } from "vitest";
import { QUEUE_NAMES } from "../constants/queue-names.js";
import type { QueueName } from "../constants/queue-names.js";

// ── QUEUE_NAMES object ────────────────────────────────────────────

describe("QUEUE_NAMES", () => {
  it("exports an object with exactly 46 queue name entries", () => {
    expect(Object.keys(QUEUE_NAMES)).toHaveLength(46);
  });

  it("all queue name values are non-empty strings", () => {
    for (const value of Object.values(QUEUE_NAMES)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("all queue name values are unique", () => {
    const values = Object.values(QUEUE_NAMES);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it("all queue names follow the 'queue-*' prefix convention", () => {
    for (const value of Object.values(QUEUE_NAMES)) {
      expect(value).toMatch(/^queue-/);
    }
  });

  // ── Spot-checks ──────────────────────────────────────────────────

  it("INGEST is 'queue-ingest'", () => {
    expect(QUEUE_NAMES.INGEST).toBe("queue-ingest");
  });

  it("AI_GENERATION is 'queue-ai-generation'", () => {
    expect(QUEUE_NAMES.AI_GENERATION).toBe("queue-ai-generation");
  });

  it("ASSET_COLLECTION is 'queue-asset-collection'", () => {
    expect(QUEUE_NAMES.ASSET_COLLECTION).toBe("queue-asset-collection");
  });

  it("QMS_VALIDATION is 'queue-qms-validation'", () => {
    expect(QUEUE_NAMES.QMS_VALIDATION).toBe("queue-qms-validation");
  });

  it("RENDER_HEAVY is 'queue-render-heavy'", () => {
    expect(QUEUE_NAMES.RENDER_HEAVY).toBe("queue-render-heavy");
  });

  it("GARBAGE_COLLECTION is 'queue-garbage-collection'", () => {
    expect(QUEUE_NAMES.GARBAGE_COLLECTION).toBe("queue-garbage-collection");
  });

  it("SCENE_ANALYSIS is 'queue-scene-analysis'", () => {
    expect(QUEUE_NAMES.SCENE_ANALYSIS).toBe("queue-scene-analysis");
  });

  it("AUTO_LABEL is 'queue-auto-label'", () => {
    expect(QUEUE_NAMES.AUTO_LABEL).toBe("queue-auto-label");
  });

  it("DEAD_LETTER is 'queue-dead-letter'", () => {
    expect(QUEUE_NAMES.DEAD_LETTER).toBe("queue-dead-letter");
  });

  it("BUNDESTAG_CLIP_ANALYSIS is 'queue-bundestag-clip-analysis'", () => {
    expect(QUEUE_NAMES.BUNDESTAG_CLIP_ANALYSIS).toBe(
      "queue-bundestag-clip-analysis",
    );
  });

  it("BUNDESTAG_PLAYBOOK_GENERATION is 'queue-bundestag-playbook-generation'", () => {
    expect(QUEUE_NAMES.BUNDESTAG_PLAYBOOK_GENERATION).toBe(
      "queue-bundestag-playbook-generation",
    );
  });

  it("BUNDESTAG_RENDER is 'queue-bundestag-render'", () => {
    expect(QUEUE_NAMES.BUNDESTAG_RENDER).toBe("queue-bundestag-render");
  });

  // ── Type safety ───────────────────────────────────────────────────

  it("QueueName type is assignable from any QUEUE_NAMES value", () => {
    // Compile-time check: assignment should not require a cast
    const name: QueueName = QUEUE_NAMES.RENDER_HEAVY;
    expect(name).toBe("queue-render-heavy");
  });
});
