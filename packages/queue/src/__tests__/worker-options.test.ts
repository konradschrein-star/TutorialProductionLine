import { describe, it, expect } from "vitest";
import {
  ingestWorkerOptions,
  aiGenerationWorkerOptions,
  assetCollectionWorkerOptions,
  qmsValidationWorkerOptions,
  renderHeavyWorkerOptions,
  garbageCollectionWorkerOptions,
  sceneAnalysisWorkerOptions,
  autoLabelWorkerOptions,
  bundestagClipAnalysisWorkerOptions,
  bundestagPlaybookGenerationWorkerOptions,
  bundestagRenderWorkerOptions,
  deadLetterWorkerOptions,
  getWorkerOptions,
} from "../options/worker-options.js";
import { QUEUE_NAMES } from "../constants/queue-names.js";

// ── Shared constraint: no connection property ─────────────────────

const allOptions = [
  ingestWorkerOptions,
  aiGenerationWorkerOptions,
  assetCollectionWorkerOptions,
  qmsValidationWorkerOptions,
  renderHeavyWorkerOptions,
  garbageCollectionWorkerOptions,
  sceneAnalysisWorkerOptions,
  autoLabelWorkerOptions,
  bundestagClipAnalysisWorkerOptions,
  bundestagPlaybookGenerationWorkerOptions,
  bundestagRenderWorkerOptions,
  deadLetterWorkerOptions,
];

describe("worker options — shared constraints", () => {
  it("no worker options object contains a connection property", () => {
    for (const opts of allOptions) {
      expect(opts).not.toHaveProperty("connection");
    }
  });

  it("every worker has a defined concurrency value", () => {
    for (const opts of allOptions) {
      expect(typeof opts.concurrency).toBe("number");
      expect(opts.concurrency).toBeGreaterThan(0);
    }
  });

  it("every worker has a stalledInterval", () => {
    for (const opts of allOptions) {
      expect(opts.stalledInterval).toBeDefined();
    }
  });

  it("every worker has a lockDuration", () => {
    for (const opts of allOptions) {
      expect(opts.lockDuration).toBeDefined();
    }
  });
});

// ── ingestWorkerOptions ───────────────────────────────────────────

describe("ingestWorkerOptions", () => {
  it("has high concurrency (10) for lightweight async work", () => {
    expect(ingestWorkerOptions.concurrency).toBe(10);
  });

  it("has autorun: true", () => {
    expect(ingestWorkerOptions.autorun).toBe(true);
  });
});

// ── aiGenerationWorkerOptions ─────────────────────────────────────

describe("aiGenerationWorkerOptions", () => {
  it("has concurrency of 5", () => {
    expect(aiGenerationWorkerOptions.concurrency).toBe(5);
  });

  it("has autorun: true", () => {
    expect(aiGenerationWorkerOptions.autorun).toBe(true);
  });
});

// ── assetCollectionWorkerOptions ──────────────────────────────────

describe("assetCollectionWorkerOptions", () => {
  it("has concurrency of 8", () => {
    expect(assetCollectionWorkerOptions.concurrency).toBe(8);
  });
});

// ── qmsValidationWorkerOptions ────────────────────────────────────

describe("qmsValidationWorkerOptions", () => {
  it("has high concurrency (10) for fast pre-flight checks", () => {
    expect(qmsValidationWorkerOptions.concurrency).toBe(10);
  });

  it("has autorun: true", () => {
    expect(qmsValidationWorkerOptions.autorun).toBe(true);
  });
});

// ── renderHeavyWorkerOptions ──────────────────────────────────────

describe("renderHeavyWorkerOptions", () => {
  it("has concurrency: 1 — one CPU-bound job per worker instance", () => {
    expect(renderHeavyWorkerOptions.concurrency).toBe(1);
  });

  it("has an extended lockDuration of 10 minutes (600_000 ms)", () => {
    expect(renderHeavyWorkerOptions.lockDuration).toBe(600000);
  });

  it("lockDuration is greater than the base 60-second default", () => {
    expect(renderHeavyWorkerOptions.lockDuration).toBeGreaterThan(60000);
  });

  it("has a lockRenewTime of 3 minutes (180_000 ms)", () => {
    expect(renderHeavyWorkerOptions.lockRenewTime).toBe(180000);
  });

  it("has autorun: true", () => {
    expect(renderHeavyWorkerOptions.autorun).toBe(true);
  });
});

// ── garbageCollectionWorkerOptions ───────────────────────────────

describe("garbageCollectionWorkerOptions", () => {
  it("has low concurrency (2) for safe asset cleanup", () => {
    expect(garbageCollectionWorkerOptions.concurrency).toBe(2);
  });
});

// ── sceneAnalysisWorkerOptions ────────────────────────────────────

describe("sceneAnalysisWorkerOptions", () => {
  it("has concurrency of 8 for concurrent LLM calls", () => {
    expect(sceneAnalysisWorkerOptions.concurrency).toBe(8);
  });
});

// ── autoLabelWorkerOptions ────────────────────────────────────────

describe("autoLabelWorkerOptions", () => {
  it("has low concurrency (2) for local Ollama", () => {
    expect(autoLabelWorkerOptions.concurrency).toBe(2);
  });
});

// ── bundestagClipAnalysisWorkerOptions ────────────────────────────

describe("bundestagClipAnalysisWorkerOptions", () => {
  it("has low concurrency (2) for Whisper transcription (memory intensive)", () => {
    expect(bundestagClipAnalysisWorkerOptions.concurrency).toBe(2);
  });

  it("has an extended lockDuration of 10 minutes for slow transcriptions", () => {
    expect(bundestagClipAnalysisWorkerOptions.lockDuration).toBe(600000);
  });

  it("has a lockRenewTime of 3 minutes", () => {
    expect(bundestagClipAnalysisWorkerOptions.lockRenewTime).toBe(180000);
  });
});

// ── bundestagPlaybookGenerationWorkerOptions ──────────────────────

describe("bundestagPlaybookGenerationWorkerOptions", () => {
  it("has low concurrency (1) for LLM inference (resource-intensive)", () => {
    expect(bundestagPlaybookGenerationWorkerOptions.concurrency).toBe(1);
  });

  it("has an extended lockDuration of 5 minutes for complex playbook generation", () => {
    expect(bundestagPlaybookGenerationWorkerOptions.lockDuration).toBe(300000);
  });

  it("has a lockRenewTime of 2 minutes", () => {
    expect(bundestagPlaybookGenerationWorkerOptions.lockRenewTime).toBe(120000);
  });
});

// ── bundestagRenderWorkerOptions ──────────────────────────────────

describe("bundestagRenderWorkerOptions", () => {
  it("has low concurrency (2) for FFmpeg composition (memory intensive)", () => {
    expect(bundestagRenderWorkerOptions.concurrency).toBe(2);
  });

  it("has an extended lockDuration of 10 minutes for complex multi-camera renders", () => {
    expect(bundestagRenderWorkerOptions.lockDuration).toBe(600000);
  });

  it("has a lockRenewTime of 3 minutes", () => {
    expect(bundestagRenderWorkerOptions.lockRenewTime).toBe(180000);
  });
});

// ── deadLetterWorkerOptions ───────────────────────────────────────

describe("deadLetterWorkerOptions", () => {
  it("has autorun: false — requires manual inspection", () => {
    expect(deadLetterWorkerOptions.autorun).toBe(false);
  });

  it("has concurrency: 1", () => {
    expect(deadLetterWorkerOptions.concurrency).toBe(1);
  });
});

// ── getWorkerOptions ──────────────────────────────────────────────

describe("getWorkerOptions", () => {
  it("returns ingestWorkerOptions for QUEUE_NAMES.INGEST", () => {
    expect(getWorkerOptions(QUEUE_NAMES.INGEST)).toBe(ingestWorkerOptions);
  });

  it("returns aiGenerationWorkerOptions for QUEUE_NAMES.AI_GENERATION", () => {
    expect(getWorkerOptions(QUEUE_NAMES.AI_GENERATION)).toBe(
      aiGenerationWorkerOptions,
    );
  });

  it("returns renderHeavyWorkerOptions for QUEUE_NAMES.RENDER_HEAVY", () => {
    expect(getWorkerOptions(QUEUE_NAMES.RENDER_HEAVY)).toBe(
      renderHeavyWorkerOptions,
    );
  });

  it("returns deadLetterWorkerOptions for QUEUE_NAMES.DEAD_LETTER", () => {
    expect(getWorkerOptions(QUEUE_NAMES.DEAD_LETTER)).toBe(
      deadLetterWorkerOptions,
    );
  });

  it("returns qmsValidationWorkerOptions for QUEUE_NAMES.QMS_VALIDATION", () => {
    expect(getWorkerOptions(QUEUE_NAMES.QMS_VALIDATION)).toBe(
      qmsValidationWorkerOptions,
    );
  });

  it("returns sceneAnalysisWorkerOptions for QUEUE_NAMES.SCENE_ANALYSIS", () => {
    expect(getWorkerOptions(QUEUE_NAMES.SCENE_ANALYSIS)).toBe(
      sceneAnalysisWorkerOptions,
    );
  });

  it("returns autoLabelWorkerOptions for QUEUE_NAMES.AUTO_LABEL", () => {
    expect(getWorkerOptions(QUEUE_NAMES.AUTO_LABEL)).toBe(
      autoLabelWorkerOptions,
    );
  });

  it("returns bundestagClipAnalysisWorkerOptions for QUEUE_NAMES.BUNDESTAG_CLIP_ANALYSIS", () => {
    expect(getWorkerOptions(QUEUE_NAMES.BUNDESTAG_CLIP_ANALYSIS)).toBe(
      bundestagClipAnalysisWorkerOptions,
    );
  });

  it("returns bundestagPlaybookGenerationWorkerOptions for QUEUE_NAMES.BUNDESTAG_PLAYBOOK_GENERATION", () => {
    expect(getWorkerOptions(QUEUE_NAMES.BUNDESTAG_PLAYBOOK_GENERATION)).toBe(
      bundestagPlaybookGenerationWorkerOptions,
    );
  });

  it("returns bundestagRenderWorkerOptions for QUEUE_NAMES.BUNDESTAG_RENDER", () => {
    expect(getWorkerOptions(QUEUE_NAMES.BUNDESTAG_RENDER)).toBe(
      bundestagRenderWorkerOptions,
    );
  });

  it("returns a fallback options object for an unrecognised queue name", () => {
    const result = getWorkerOptions("queue-unknown");
    expect(result).toBeDefined();
    expect(result).not.toHaveProperty("connection");
  });
});
