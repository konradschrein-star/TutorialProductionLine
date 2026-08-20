import { createContextLogger } from "@repo/logger";
import type { GatewayFormat } from "./media-gateway/types.js";
import { ytDlpSource } from "./footage-sources/yt-dlp.js";
import { pexelsSource } from "./footage-sources/pexels.js";
import { clipLibrarySource } from "./footage-sources/clip-library.js";
import type {
  FootageRequest,
  FootageResult,
  FootageSource,
  FootageSourceName,
} from "./footage-sources/types.js";

const logger = createContextLogger("footage-gateway");

const SOURCES: Record<FootageSourceName, FootageSource> = {
  "yt-dlp": ytDlpSource,
  pexels: pexelsSource,
  "clip-library": clipLibrarySource,
};

/**
 * Per-format default source order (highest priority first).
 * Override with env var `FOOTAGE_SOURCES_<FORMAT>=src1,src2,src3`.
 */
// Type widened to `string` so we can pre-list source orders for formats
// that don't exist in the GatewayFormat union on this branch yet (e.g.
// RANKING lives on feat/ranking-format off main). orderFor() does a safe
// Partial lookup at runtime, so unknown keys harmlessly fall through.
const DEFAULT_ORDER: Partial<Record<string, FootageSourceName[]>> = {
  TECH_COMPARISON: ["yt-dlp", "pexels", "clip-library"],
  RANKING: ["yt-dlp", "pexels"],
  LONG_FORM_DRAMA: ["clip-library", "pexels"],
  SPACE_VIDEO: ["pexels", "clip-library"],
};
const FALLBACK_ORDER: FootageSourceName[] = [
  "pexels",
  "yt-dlp",
  "clip-library",
];

// Same string-key widening as DEFAULT_ORDER above.
const PRIORITY_BY_FORMAT: Partial<Record<string, number>> = {
  TUTORIAL_STUDIO: 120,
  CASUALLY_EXPLAINED: 100,
  TECH_COMPARISON: 60,
  RANKING: 60,
  LONG_FORM_DRAMA: 50,
  SPACE_VIDEO: 50,
};
const DEFAULT_PRIORITY = 40;

function orderFor(format: GatewayFormat): FootageSourceName[] {
  const envKey = `FOOTAGE_SOURCES_${format}`;
  const override = process.env[envKey];
  if (override) {
    return override
      .split(",")
      .map((s) => s.trim() as FootageSourceName)
      .filter((s) => s in SOURCES);
  }
  return DEFAULT_ORDER[format] ?? FALLBACK_ORDER;
}

function priorityFor(format: GatewayFormat): number {
  return PRIORITY_BY_FORMAT[format] ?? DEFAULT_PRIORITY;
}

const MAX_CONCURRENT = Number(process.env["FOOTAGE_MAX_CONCURRENT"] ?? "4");

interface QueueEntry {
  req: FootageRequest;
  priority: number;
  enqueuedAt: number;
  resolve: (value: FootageResult | null) => void;
  reject: (err: Error) => void;
}

class FootageGateway {
  private queue: QueueEntry[] = [];
  private inFlight = 0;
  private idleTickHandle: NodeJS.Immediate | null = null;

  enqueue(req: FootageRequest): Promise<FootageResult | null> {
    const priority = priorityFor(req.format);
    return new Promise((resolve, reject) => {
      this.queue.push({
        req,
        priority,
        enqueuedAt: Date.now(),
        resolve,
        reject,
      });
      this.scheduleTick();
    });
  }

  private scheduleTick() {
    if (this.idleTickHandle) return;
    this.idleTickHandle = setImmediate(() => {
      this.idleTickHandle = null;
      this.drain();
    });
  }

  private drain() {
    while (this.queue.length > 0 && this.inFlight < MAX_CONCURRENT) {
      this.queue.sort((a, b) =>
        b.priority !== a.priority
          ? b.priority - a.priority
          : a.enqueuedAt - b.enqueuedAt,
      );
      const entry = this.queue.shift();
      if (!entry) break;
      this.inFlight++;
      void this.runOne(entry).finally(() => {
        this.inFlight--;
        this.scheduleTick();
      });
    }
  }

  private async runOne(entry: QueueEntry) {
    try {
      const order = entry.req.sources ?? orderFor(entry.req.format);
      for (const name of order) {
        const source = SOURCES[name];
        if (!source) continue;
        try {
          const result = await source.fetch(entry.req);
          if (result) {
            entry.resolve(result);
            return;
          }
        } catch (err) {
          logger.warn(
            { source: name, query: entry.req.query, err: String(err) },
            "footage source error — continuing cascade",
          );
        }
      }
      entry.resolve(null);
    } catch (err) {
      entry.reject(err as Error);
    }
  }

  stats(): FootageGatewayStats {
    const byFormat: Record<string, number> = {};
    for (const e of this.queue) {
      byFormat[e.req.format] = (byFormat[e.req.format] ?? 0) + 1;
    }
    return { inFlight: this.inFlight, queued: this.queue.length, byFormat };
  }
}

export interface FootageGatewayStats {
  inFlight: number;
  queued: number;
  byFormat: Record<string, number>;
}

const gateway = new FootageGateway();

export async function requestFootage(
  req: FootageRequest,
): Promise<FootageResult | null> {
  return gateway.enqueue(req);
}

export function footageGatewayStats(): FootageGatewayStats {
  return gateway.stats();
}
