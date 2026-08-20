import { describe, it, expect } from "vitest";
import type { QueueOptions } from "bullmq";
import {
  ingestQueueOptions,
  aiGenerationQueueOptions,
  assetCollectionQueueOptions,
  qmsValidationQueueOptions,
  renderHeavyQueueOptions,
  garbageCollectionQueueOptions,
  sceneAnalysisQueueOptions,
  autoLabelQueueOptions,
  deadLetterQueueOptions,
  getQueueOptions,
} from "../options/queue-options.js";
import { QUEUE_NAMES } from "../constants/queue-names.js";

/**
 * BullMQ's `DefaultJobOptions` type (used for `QueueOptions.defaultJobOptions`)
 * does not include `timeout` in its public type surface, even though BullMQ
 * accepts it at runtime. The source uses `as Omit<QueueOptions, "connection">`
 * to escape the narrower inner type. We use the same cast here so we can
 * assert on `timeout` without a TS error.
 */
function jobOpts(opts: Omit<QueueOptions, "connection">): Record<string, unknown> {
  return (opts.defaultJobOptions ?? {}) as Record<string, unknown>;
}

// ── Shared constraint: no connection property ─────────────────────

const allOptions = [
  ingestQueueOptions,
  aiGenerationQueueOptions,
  assetCollectionQueueOptions,
  qmsValidationQueueOptions,
  renderHeavyQueueOptions,
  garbageCollectionQueueOptions,
  sceneAnalysisQueueOptions,
  autoLabelQueueOptions,
  deadLetterQueueOptions,
];

describe("queue options — shared constraints", () => {
  it("no queue options object contains a connection property", () => {
    for (const opts of allOptions) {
      expect(opts).not.toHaveProperty("connection");
    }
  });

  it("every queue options object has a defaultJobOptions field", () => {
    for (const opts of allOptions) {
      expect(opts).toHaveProperty("defaultJobOptions");
    }
  });
});

// ── ingestQueueOptions ────────────────────────────────────────────

describe("ingestQueueOptions", () => {
  it("has attempts: 3", () => {
    expect(ingestQueueOptions.defaultJobOptions?.attempts).toBe(3);
  });

  it("has exponential backoff", () => {
    const backoff = ingestQueueOptions.defaultJobOptions?.backoff as { type: string; delay: number };
    expect(backoff?.type).toBe("exponential");
  });
});

// ── aiGenerationQueueOptions ──────────────────────────────────────

describe("aiGenerationQueueOptions", () => {
  it("has attempts: 3", () => {
    expect(aiGenerationQueueOptions.defaultJobOptions?.attempts).toBe(3);
  });

  it("has exponential backoff with a 30 second initial delay for rate-limit recovery", () => {
    const backoff = aiGenerationQueueOptions.defaultJobOptions?.backoff as {
      type: string;
      delay: number;
    };
    expect(backoff?.type).toBe("exponential");
    expect(backoff?.delay).toBe(30000);
  });

  it("has a 2-minute timeout for external API calls", () => {
    expect(jobOpts(aiGenerationQueueOptions).timeout).toBe(120000);
  });
});

// ── assetCollectionQueueOptions ───────────────────────────────────

describe("assetCollectionQueueOptions", () => {
  it("has attempts: 3", () => {
    expect(assetCollectionQueueOptions.defaultJobOptions?.attempts).toBe(3);
  });

  it("has a 1-minute timeout", () => {
    expect(jobOpts(assetCollectionQueueOptions).timeout).toBe(60000);
  });
});

// ── qmsValidationQueueOptions ─────────────────────────────────────

describe("qmsValidationQueueOptions", () => {
  it("has attempts: 3", () => {
    expect(qmsValidationQueueOptions.defaultJobOptions?.attempts).toBe(3);
  });

  it("has a 30-second timeout for fast pre-flight checks", () => {
    expect(jobOpts(qmsValidationQueueOptions).timeout).toBe(30000);
  });
});

// ── renderHeavyQueueOptions ───────────────────────────────────────

describe("renderHeavyQueueOptions", () => {
  it("has attempts: 2 — only one retry for expensive renders", () => {
    expect(renderHeavyQueueOptions.defaultJobOptions?.attempts).toBe(2);
  });

  it("has a 3-hour timeout (10_800_000 ms)", () => {
    expect(jobOpts(renderHeavyQueueOptions).timeout).toBe(10_800_000);
  });

  it("has removeOnFail: false to keep all failures for inspection", () => {
    expect(renderHeavyQueueOptions.defaultJobOptions?.removeOnFail).toBe(false);
  });

  it("uses fixed backoff (not exponential)", () => {
    const backoff = renderHeavyQueueOptions.defaultJobOptions?.backoff as {
      type: string;
      delay: number;
    };
    expect(backoff?.type).toBe("fixed");
  });

  it("has a 30-second fixed backoff delay between retries", () => {
    const backoff = renderHeavyQueueOptions.defaultJobOptions?.backoff as {
      type: string;
      delay: number;
    };
    expect(backoff?.delay).toBe(30000);
  });
});

// ── garbageCollectionQueueOptions ────────────────────────────────

describe("garbageCollectionQueueOptions", () => {
  it("has attempts: 3", () => {
    expect(garbageCollectionQueueOptions.defaultJobOptions?.attempts).toBe(3);
  });

  it("has a 5-minute timeout for asset cleanup", () => {
    expect(jobOpts(garbageCollectionQueueOptions).timeout).toBe(300000);
  });
});

// ── sceneAnalysisQueueOptions ─────────────────────────────────────

describe("sceneAnalysisQueueOptions", () => {
  it("has attempts: 3", () => {
    expect(sceneAnalysisQueueOptions.defaultJobOptions?.attempts).toBe(3);
  });

  it("has a 2-minute timeout for LLM scene decomposition", () => {
    expect(jobOpts(sceneAnalysisQueueOptions).timeout).toBe(120000);
  });
});

// ── autoLabelQueueOptions ─────────────────────────────────────────

describe("autoLabelQueueOptions", () => {
  it("has attempts: 2 — limited retries for local Ollama", () => {
    expect(autoLabelQueueOptions.defaultJobOptions?.attempts).toBe(2);
  });

  it("uses fixed backoff", () => {
    const backoff = autoLabelQueueOptions.defaultJobOptions?.backoff as {
      type: string;
      delay: number;
    };
    expect(backoff?.type).toBe("fixed");
  });

  it("has a 10-second fixed backoff delay", () => {
    const backoff = autoLabelQueueOptions.defaultJobOptions?.backoff as {
      type: string;
      delay: number;
    };
    expect(backoff?.delay).toBe(10000);
  });

  it("has a 1-minute timeout", () => {
    expect(jobOpts(autoLabelQueueOptions).timeout).toBe(60000);
  });
});

// ── deadLetterQueueOptions ────────────────────────────────────────

describe("deadLetterQueueOptions", () => {
  it("has attempts: 1 — no automatic retries", () => {
    expect(deadLetterQueueOptions.defaultJobOptions?.attempts).toBe(1);
  });

  it("has removeOnFail: false — never auto-removes failed jobs", () => {
    expect(deadLetterQueueOptions.defaultJobOptions?.removeOnFail).toBe(false);
  });

  it("keeps a large number of completed jobs (>= 500)", () => {
    const removeOnComplete = deadLetterQueueOptions.defaultJobOptions?.removeOnComplete as
      | { count: number }
      | undefined;
    expect(removeOnComplete?.count).toBeGreaterThanOrEqual(500);
  });
});

// ── getQueueOptions ───────────────────────────────────────────────

describe("getQueueOptions", () => {
  it("returns ingestQueueOptions for QUEUE_NAMES.INGEST", () => {
    expect(getQueueOptions(QUEUE_NAMES.INGEST)).toBe(ingestQueueOptions);
  });

  it("returns aiGenerationQueueOptions for QUEUE_NAMES.AI_GENERATION", () => {
    expect(getQueueOptions(QUEUE_NAMES.AI_GENERATION)).toBe(aiGenerationQueueOptions);
  });

  it("returns renderHeavyQueueOptions for QUEUE_NAMES.RENDER_HEAVY", () => {
    expect(getQueueOptions(QUEUE_NAMES.RENDER_HEAVY)).toBe(renderHeavyQueueOptions);
  });

  it("returns deadLetterQueueOptions for QUEUE_NAMES.DEAD_LETTER", () => {
    expect(getQueueOptions(QUEUE_NAMES.DEAD_LETTER)).toBe(deadLetterQueueOptions);
  });

  it("returns qmsValidationQueueOptions for QUEUE_NAMES.QMS_VALIDATION", () => {
    expect(getQueueOptions(QUEUE_NAMES.QMS_VALIDATION)).toBe(qmsValidationQueueOptions);
  });

  it("returns sceneAnalysisQueueOptions for QUEUE_NAMES.SCENE_ANALYSIS", () => {
    expect(getQueueOptions(QUEUE_NAMES.SCENE_ANALYSIS)).toBe(sceneAnalysisQueueOptions);
  });

  it("returns autoLabelQueueOptions for QUEUE_NAMES.AUTO_LABEL", () => {
    expect(getQueueOptions(QUEUE_NAMES.AUTO_LABEL)).toBe(autoLabelQueueOptions);
  });

  it("returns a fallback options object for an unrecognised queue name", () => {
    const result = getQueueOptions("queue-unknown");
    expect(result).toBeDefined();
    expect(result).not.toHaveProperty("connection");
  });
});
