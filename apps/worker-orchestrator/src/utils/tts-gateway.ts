import { generateElevenLabsTTS } from "./elevenlabs-client.js";
import { generateTTS } from "./ai33-client.js";
import { generateFishTTS } from "./fish-client.js";
import { type GatewayFormat, toGatewayFormat } from "./media-gateway/types.js";
import { reportSpend, estimateTtsCostEur } from "./spend-reporter.js";
import { reportProviderUse } from "./media-gateway/registry-bridge.js";

export { toGatewayFormat, type GatewayFormat };

/**
 * Centralized TTS gateway.
 *
 * ALL TTS generation is admitted through one process-level priority queue
 * with a global concurrency cap (TTS_MAX_CONCURRENT, default 6), so a bulk
 * format churning hundreds of chunks can never starve Tutorial Studio.
 *
 * Two entry points:
 *   - requestTTS()   — the built-in engines (AI33 ElevenLabs proxy, AI33
 *                      Minimax, Fish Audio official).
 *   - withTTSSlot()  — bring-your-own provider call (Tutorial Studio's
 *                      registry providers, EdgeTTS). The gateway supplies
 *                      admission control only; the caller keeps its own
 *                      provider construction, key resolution, and fallback
 *                      chain unchanged.
 *
 * No fallback inside the gateway — a failed call rejects and the caller's
 * own retry/fallback (BullMQ, tutorial provider chain) takes over.
 */

/** Which built-in TTS engine to invoke. */
export type TTSEngine = "elevenlabs" | "minimax" | "fish";

/**
 * Global TTS engine policy.
 *
 * Konrad's directive: use Fish Audio for basically every format. Rather than
 * touch each format's per-voice engine derivation (ai-generation, ranking,
 * reactor, drama, video-essay), we enforce the policy at the one place every
 * built-in TTS call funnels through.
 *
 *   TTS_FORCE_ENGINE unset            → force "fish" (the current policy)
 *   TTS_FORCE_ENGINE = none|off|""    → honour each caller's requested engine
 *   TTS_FORCE_ENGINE = fish|elevenlabs|minimax → force that engine everywhere
 *
 * Tutorial Studio uses withTTSSlot() (its own provider stack, already
 * Fish-default) and is unaffected — this only governs requestTTS().
 */
function resolveForcedEngine(): TTSEngine | null {
  const raw = process.env["TTS_FORCE_ENGINE"];
  if (raw === undefined) return "fish"; // default policy: Fish everywhere
  const v = raw.trim().toLowerCase();
  if (v === "" || v === "none" || v === "off") return null; // honour caller
  if (v === "fish" || v === "elevenlabs" || v === "minimax") return v;
  return "fish"; // unrecognised value → safest is the default policy
}

/**
 * Fish selects a voice by `reference_id` (a 32-hex Fish model id). ElevenLabs
 * and Minimax voice ids are NOT valid Fish references, so when we force Fish
 * onto a format still carrying a non-Fish voice id we must drop it rather than
 * send garbage: prefer FISH_DEFAULT_VOICE_ID (if it's a real Fish ref), else
 * "" → Fish account default voice.
 */
const FISH_REF_RE = /^[0-9a-f]{32}$/i;
function resolveFishVoiceId(voiceId: string): string {
  const trimmed = (voiceId ?? "").trim();
  if (FISH_REF_RE.test(trimmed)) return trimmed;
  const fallback = process.env["FISH_DEFAULT_VOICE_ID"]?.trim();
  if (fallback && FISH_REF_RE.test(fallback)) return fallback;
  return ""; // account default voice
}

export interface TTSRequestOptions {
  /** Content format — determines queue priority. */
  format: GatewayFormat;
  /** Which built-in engine to use. Defaults to "elevenlabs". */
  engine?: TTSEngine;
  /** Playback speed. ElevenLabs: clamped 0.5-1.5. */
  speed?: number;
  /** ElevenLabs V3 similarity boost (0-4 scale). */
  similarity?: number;
  /** Override the format default priority. */
  priority?: number;
  /** Log tag only. */
  context?: string;
}

const DEFAULT_PRIORITIES: Record<GatewayFormat, number> = {
  TUTORIAL_STUDIO: 120,
  CASUALLY_EXPLAINED: 100,
  EXPLAINER: 80,
  POLITICAL_COMMENTARY_REACTOR: 80,
  TECH_COMPARISON: 60,
  LONG_FORM_DRAMA: 50,
  DOCUMENTARY: 50,
  VIDEO_ESSAY: 50,
  BUNDESTAG: 50,
  STOCK_LIBRARY: 30,
  RANKING: 60,
  // Matches the media-gateway priority for the same format, so image and TTS
  // admission agree. A real production format, but a bulk keyword-matrix one:
  // it must never outrank TUTORIAL_STUDIO (120) VA-facing work.
  BUSINESS_PLAN_HUB: 60,
  OTHER: 40,
};

function defaultPriorityFor(format: GatewayFormat): number {
  const envKey = `TTS_PRIORITY_${format}`;
  const override = process.env[envKey];
  if (override) {
    const n = Number(override);
    if (Number.isFinite(n)) return n;
  }
  return DEFAULT_PRIORITIES[format];
}

const MAX_CONCURRENT = Number(process.env["TTS_MAX_CONCURRENT"] ?? "6");

/**
 * Map a TTS engine / provider label onto a provider-registry key.
 *
 * The engine names are about WHICH VOICE MODEL; the registry is about WHICH
 * SERVICE WE PAY AND PROBE. Both AI33 engines are one billable service.
 * Anything unrecognised is passed through unchanged and shows up as an
 * off-chain provider — which is the honest answer, and louder than
 * quietly mapping it to something familiar.
 */
function registryKeyForEngine(engine: string): string {
  switch (engine) {
    case "fish":
    case "fish_audio":
      return "fish";
    case "elevenlabs":
    case "minimax":
    case "ai33":
    case "ai33_minimax":
    case "elevenlabs_ai33":
      return "ai33";
    case "elevenlabs_official":
      return "elevenlabs_official";
    case "google":
    case "google_tts":
      return "google_tts";
    case "inworld":
      return "inworld";
    case "edge":
    case "edge_tts":
      return "edge_tts";
    default:
      return engine;
  }
}

/**
 * The TTS chain as modelled today: Fish is the forced primary, the AI33
 * engines are opt-in fallbacks. Used only to classify what actually served a
 * request — the gateway itself does no fallback (callers own their chains).
 */
const TTS_CHAIN = ["fish", "ai33", "edge_tts"];

interface QueueEntry {
  /** Dispatch-log labels. */
  labels: {
    format: GatewayFormat;
    provider: string;
    context: string | null;
    text_length?: number | undefined;
  };
  priority: number;
  enqueuedAt: number;
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

class TTSGateway {
  private queue: QueueEntry[] = [];
  private inFlight = 0;
  private idleTickHandle: NodeJS.Immediate | null = null;

  enqueue<T>(
    labels: QueueEntry["labels"],
    priority: number,
    task: () => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        labels,
        priority,
        enqueuedAt: Date.now(),
        task,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.queue.sort((a, b) =>
        a.priority !== b.priority
          ? b.priority - a.priority
          : a.enqueuedAt - b.enqueuedAt,
      );
      this.scheduleTick();
    });
  }

  private scheduleTick(): void {
    if (this.idleTickHandle != null) return;
    this.idleTickHandle = setImmediate(() => {
      this.idleTickHandle = null;
      this.drain();
    });
  }

  private drain(): void {
    while (this.inFlight < MAX_CONCURRENT && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      this.inFlight++;
      this.process(entry).finally(() => {
        this.inFlight--;
        this.scheduleTick();
      });
    }
  }

  private async process(entry: QueueEntry): Promise<void> {
    console.log(
      JSON.stringify({
        level: "info",
        message: "tts-gateway dispatching",
        ...entry.labels,
        priority: entry.priority,
        queued_ms: Date.now() - entry.enqueuedAt,
      }),
    );
    const servedProvider = registryKeyForEngine(entry.labels.provider);
    const started = Date.now();
    try {
      const result = await entry.task();
      reportProviderUse({
        capability: "tts",
        consumer: entry.labels.format,
        chain: TTS_CHAIN,
        servedProvider,
        outcome: "success",
        latencyMs: Date.now() - started,
        context: entry.labels.context,
      });
      entry.resolve(result);
    } catch (err) {
      reportProviderUse({
        capability: "tts",
        consumer: entry.labels.format,
        chain: TTS_CHAIN,
        servedProvider,
        outcome: "error",
        latencyMs: Date.now() - started,
        context: entry.labels.context,
        error: err instanceof Error ? err.message.slice(0, 300) : String(err),
      });
      entry.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  stats(): {
    inFlight: number;
    queued: number;
    byFormat: Record<string, number>;
  } {
    const byFormat: Record<string, number> = {};
    for (const entry of this.queue) {
      byFormat[entry.labels.format] = (byFormat[entry.labels.format] ?? 0) + 1;
    }
    return { inFlight: this.inFlight, queued: this.queue.length, byFormat };
  }
}

const gateway = new TTSGateway();

/**
 * Request TTS audio via the built-in engines through the gateway queue.
 */
export async function requestTTS(
  text: string,
  voiceId: string,
  options: TTSRequestOptions,
): Promise<Buffer> {
  const engine = resolveForcedEngine() ?? options.engine ?? "fish";
  const priority = options.priority ?? defaultPriorityFor(options.format);
  return gateway.enqueue(
    {
      format: options.format,
      provider: engine,
      context: options.context ?? null,
      text_length: text.length,
    },
    priority,
    async () => {
      let buffer: Buffer;
      if (engine === "fish") {
        // Fish Audio uses its own key (FISH_API_KEY), not AI33. A non-Fish
        // voice id (ElevenLabs/Minimax) can't be a Fish reference_id, so
        // resolve to a valid Fish ref or the account default voice.
        const fishVoiceId = resolveFishVoiceId(voiceId);
        if (voiceId && fishVoiceId !== voiceId) {
          console.log(
            JSON.stringify({
              level: "info",
              message:
                "tts-gateway: dropped non-Fish voice id under forced Fish engine",
              format: options.format,
              requested_voice_id: voiceId,
              used_voice_id: fishVoiceId || "(account default)",
              context: options.context ?? null,
            }),
          );
        }
        buffer = await generateFishTTS(
          process.env["FISH_API_KEY"] ?? "",
          fishVoiceId,
          text,
          { speed: options.speed },
        );
      } else {
        const apiKey = process.env["AI33_API_KEY"];
        if (!apiKey) {
          throw new Error("AI33_API_KEY is not configured");
        }
        if (engine === "minimax") {
          buffer = await generateTTS(apiKey, voiceId, text);
        } else {
          buffer = await generateElevenLabsTTS(apiKey, voiceId, text, {
            speed: options.speed,
            similarity: options.similarity,
          });
        }
      }
      reportSpend({
        provider: engine,
        kind: "tts",
        amount_eur: estimateTtsCostEur(engine, text.length),
        units: text.length,
        meta: { format: options.format, context: options.context ?? null },
      });
      return buffer;
    },
  );
}

/**
 * Run an arbitrary TTS provider call through the gateway's priority queue.
 *
 * For callers with their own provider stack (Tutorial Studio registry,
 * EdgeTTS): the call executes when a slot in the global concurrency cap
 * frees up, ordered by format priority. Errors pass through unchanged so
 * the caller's own fallback chain keeps working.
 */
export async function withTTSSlot<T>(
  options: {
    format: GatewayFormat;
    /** Provider label for logs + spend attribution. */
    provider: string;
    priority?: number;
    context?: string;
    /** When set, a spend row is reported on success. */
    textLength?: number;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const priority = options.priority ?? defaultPriorityFor(options.format);
  return gateway.enqueue(
    {
      format: options.format,
      provider: options.provider,
      context: options.context ?? null,
      text_length: options.textLength,
    },
    priority,
    async () => {
      const result = await fn();
      if (options.textLength != null) {
        reportSpend({
          provider: options.provider,
          kind: "tts",
          amount_eur: estimateTtsCostEur(options.provider, options.textLength),
          units: options.textLength,
          meta: { format: options.format, context: options.context ?? null },
        });
      }
      return result;
    },
  );
}

export function ttsGatewayStats() {
  return gateway.stats();
}
