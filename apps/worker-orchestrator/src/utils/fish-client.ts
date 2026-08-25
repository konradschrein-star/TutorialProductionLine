/**
 * Fish Audio TTS client (https://fish.audio).
 *
 * Primary mode: `s2.1-pro-free` (free tier with no usage cap).
 * Resilient Failover Policy:
 *   1. Free tier is given a 2-minute (120s) stall window to complete. The free
 *      tier normally answers in well under 20s, so 120s is generous headroom
 *      while still failing over fast enough that a job never looks "stuck".
 *   2. If free tier stalls > window or fails, failover to paid `s2.1-pro` is
 *      admitted only if today's failover spend is under the daily $5.00 limit.
 *   3. Daily budget and spend are tracked per UTC day (YYYY-MM-DD) and persisted.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface FishTTSOptions {
  /** Playback speed 0.5–2.0 (1 = normal). Clamped to range. */
  speed?: number;
  /** Volume adjustment in dB (0 = no change). */
  volumeDb?: number;
  /** Output format. Default mp3. */
  format?: "mp3" | "wav" | "pcm" | "opus";
  /** TTS model. Default s2.1-pro-free (Fish's free S2.1 Pro tier). */
  model?: string;
}

const FISH_API_BASE = process.env["FISH_API_BASE"] ?? "https://api.fish.audio";
// 2 minutes (120,000 ms) before triggering paid failover. Free normally
// answers in <20s; override with FISH_FREE_TIMEOUT_MS if a longer stall
// tolerance is ever wanted.
const FREE_TIER_TIMEOUT_MS = parseInt(
  process.env["FISH_FREE_TIMEOUT_MS"] ?? "120000",
  10,
);
// Daily spend limit for paid failovers ($5.00/day default)
const DAILY_BUDGET_USD = parseFloat(
  process.env["FISH_FAILOVER_DAILY_BUDGET_USD"] ?? "5.00",
);
// $15 per 1,000,000 UTF-8 bytes ($0.000015/byte)
const USD_PER_BYTE = 15 / 1_000_000;

interface DailySpendState {
  date: string; // YYYY-MM-DD (UTC)
  spendUsd: number;
  failoverCount: number;
}

let inMemorySpend: DailySpendState = {
  date: new Date().toISOString().slice(0, 10),
  spendUsd: 0,
  failoverCount: 0,
};

const STATE_FILE_PATH = join(
  process.env["LOCAL_MEDIA_ROOT"] ?? process.cwd(),
  ".fish-failover-spend.json",
);

async function loadDailySpend(): Promise<DailySpendState> {
  const today = new Date().toISOString().slice(0, 10);
  if (inMemorySpend.date === today) {
    return inMemorySpend;
  }
  try {
    const raw = await readFile(STATE_FILE_PATH, "utf8");
    const data = JSON.parse(raw) as DailySpendState;
    if (data && data.date === today && typeof data.spendUsd === "number") {
      inMemorySpend = data;
      return inMemorySpend;
    }
  } catch {
    // File doesn't exist or is for a previous date
  }
  inMemorySpend = { date: today, spendUsd: 0, failoverCount: 0 };
  return inMemorySpend;
}

async function recordFailoverSpend(amountUsd: number): Promise<DailySpendState> {
  const state = await loadDailySpend();
  state.spendUsd += amountUsd;
  state.failoverCount += 1;
  inMemorySpend = state;
  try {
    await writeFile(STATE_FILE_PATH, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.warn("Failed to persist .fish-failover-spend.json:", err);
  }
  return state;
}

export function getFishFailoverSpendStats(): {
  date: string;
  spendUsd: number;
  maxBudgetUsd: number;
  failoverCount: number;
} {
  const today = new Date().toISOString().slice(0, 10);
  if (inMemorySpend.date !== today) {
    inMemorySpend = { date: today, spendUsd: 0, failoverCount: 0 };
  }
  return {
    date: inMemorySpend.date,
    spendUsd: inMemorySpend.spendUsd,
    maxBudgetUsd: DAILY_BUDGET_USD,
    failoverCount: inMemorySpend.failoverCount,
  };
}

async function executeFishRequest(
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<Buffer> {
  const res = await fetch(`${FISH_API_BASE}/v1/tts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      model,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(
      `Fish Audio TTS error ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function generateFishTTS(
  apiKey: string,
  voiceId: string,
  text: string,
  options: FishTTSOptions = {},
): Promise<Buffer> {
  const key = apiKey || process.env["FISH_API_KEY"] || "";
  if (!key) {
    throw new Error(
      "Fish Audio: no API key (set FISH_API_KEY or save a fish_audio secret)",
    );
  }
  const primaryModel =
    options.model ?? process.env["FISH_TTS_MODEL"] ?? "s2.1-pro-free";

  const prosody: Record<string, unknown> = { normalize_loudness: true };
  if (options.speed !== undefined) {
    prosody.speed = Math.min(2, Math.max(0.5, options.speed));
  }
  if (options.volumeDb !== undefined) {
    prosody.volume = options.volumeDb;
  }

  const body: Record<string, unknown> = {
    text,
    format: options.format ?? "mp3",
    mp3_bitrate: 128,
    prosody,
  };
  // reference_id selects the voice model; omit for the account default voice.
  if (voiceId) body.reference_id = voiceId;

  const isFreeTier = primaryModel.endsWith("-free");

  if (!isFreeTier) {
    // Explicit paid tier request
    return await executeFishRequest(key, primaryModel, body, 60_000);
  }

  // Attempt free tier with 4-minute stalling window
  try {
    return await executeFishRequest(
      key,
      primaryModel,
      body,
      FREE_TIER_TIMEOUT_MS,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `Fish Audio free model (${primaryModel}) stalled/failed after ${
        FREE_TIER_TIMEOUT_MS / 1000
      }s: ${errMsg}. Checking daily failover budget...`,
    );

    // Calculate cost for this failover ($15 / 1M UTF-8 bytes)
    const textBytes = Buffer.byteLength(text, "utf8");
    const estimatedCostUsd = textBytes * USD_PER_BYTE;

    const currentSpendState = await loadDailySpend();
    if (currentSpendState.spendUsd + estimatedCostUsd > DAILY_BUDGET_USD) {
      throw new Error(
        `Fish Audio free tier stalled/failed and daily failover budget ($${DAILY_BUDGET_USD.toFixed(
          2,
        )}) reached for today (Current: $${currentSpendState.spendUsd.toFixed(
          3,
        )} | Attempted: +$${estimatedCostUsd.toFixed(3)}). Error: ${errMsg}`,
      );
    }

    // Failover to s2.1-pro
    console.log(
      JSON.stringify({
        level: "info",
        message: "Failing over to Fish Audio s2.1-pro",
        estimated_cost_usd: estimatedCostUsd,
        today_spend_usd: currentSpendState.spendUsd,
        daily_budget_usd: DAILY_BUDGET_USD,
      }),
    );

    const audioBuffer = await executeFishRequest(key, "s2.1-pro", body, 60_000);
    const updatedState = await recordFailoverSpend(estimatedCostUsd);

    console.log(
      JSON.stringify({
        level: "info",
        message: "Fish Audio s2.1-pro failover successful",
        today_total_usd: updatedState.spendUsd,
        daily_budget_usd: DAILY_BUDGET_USD,
        failover_count_today: updatedState.failoverCount,
      }),
    );

    return audioBuffer;
  }
}
