/**
 * Fire-and-forget spend reporter — POSTs to the AI OS spend log.
 *
 * The AI OS `forge-control` service exposes `POST /api/spend` accepting
 * a single row or `SpendRow[]`. We use it from the gateways to record
 * per-call EUR estimates so the Today / Live screens can surface real
 * numbers instead of "— not tracked".
 *
 * Design rules:
 *   - Fire-and-forget. The reporter never throws and never blocks the
 *     caller. If the AI OS isn't reachable (dev, network blip), the gen
 *     still succeeds — we just lose that data point.
 *   - Env-gated. If FORGE_SPEND_URL is unset (dev box), the reporter is
 *     a no-op. No retry queue, no buffering — this is observability,
 *     not a guarantee.
 *   - Closed-set kinds. AI OS validates against {image, tts, llm_input,
 *     llm_output, video, music, embedding}. Keep this in sync.
 *
 * Cost estimates are deliberately rough — they're for "is today's spend
 * surprising?" not invoicing. Refine via env overrides when you have
 * a real per-provider invoice.
 */

// Read at call time — index.ts runs dotenv AFTER hoisted imports, so a
// module-level constant would freeze as undefined and silently no-op
// every report. Same trap documented in fastgen-client.ts / aios-notify.ts.
function spendUrl(): string | undefined {
  return process.env["FORGE_SPEND_URL"];
}

export type SpendKind =
  | "image"
  | "tts"
  | "llm_input"
  | "llm_output"
  | "video"
  | "music"
  | "embedding";

export interface SpendRow {
  provider: string;
  kind: SpendKind;
  amount_eur: number;
  job_id?: string;
  units?: number;
  meta?: Record<string, unknown>;
}

/**
 * Report a spend row. Never throws. Returns immediately; the POST
 * happens in the background. If SPEND_URL is unset, this is a no-op.
 */
export function reportSpend(row: SpendRow): void {
  const url = spendUrl();
  if (!url) return;
  if (!Number.isFinite(row.amount_eur) || row.amount_eur < 0) return;

  const body = JSON.stringify(row);
  // We intentionally do not await this — observability must not block
  // the hot path. AbortSignal.timeout caps the hanging socket on a
  // dead AI OS at 3s.
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(3_000),
  }).catch(() => {
    // Swallow. Spend reporting is best-effort.
  });
}

/**
 * Rough per-image EUR estimates. Override per provider via env:
 *   FORGE_IMAGE_COST_<PROVIDER>=<eur>
 *
 * Defaults below are based on public list prices as of 2026-06.
 * They are estimates, not invoices.
 */
const DEFAULT_IMAGE_COSTS: Record<string, number> = {
  "nano-banana-2": 0.003, // Gemini image gen via fastgen
  fastgen: 0.003, // generic fastgen fallback
  "veo-studio": 0, // browser-driven, no marginal cost
  "forge-api": 0,
  vup: 0, // VEO Unlimited Pro wrapper, no marginal per-call cost
  ai33: 0.004, // dead path; kept for older callers
};

export function estimateImageCostEur(provider: string): number {
  const envKey = `FORGE_IMAGE_COST_${provider.toUpperCase().replace(/-/g, "_")}`;
  const override = process.env[envKey];
  if (override) {
    const n = Number(override);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_IMAGE_COSTS[provider] ?? 0.003;
}

/**
 * Rough per-clip video EUR estimates. Override per provider via env:
 *   FORGE_VIDEO_COST_<PROVIDER>=<eur>
 */
const DEFAULT_VIDEO_COSTS: Record<string, number> = {
  "forge-api": 0, // browser-driven VEO Studio, no marginal cost
  vup: 0, // VEO Unlimited Pro wrapper, no marginal per-call cost
  fastgen: 0.1,
  flower: 0.1,
  flow: 0.1,
  grok: 0.05,
};

export function estimateVideoCostEur(provider: string): number {
  const envKey = `FORGE_VIDEO_COST_${provider.toUpperCase().replace(/-/g, "_")}`;
  const override = process.env[envKey];
  if (override) {
    const n = Number(override);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_VIDEO_COSTS[provider] ?? 0.1;
}

/**
 * Rough per-character TTS EUR estimates. Override per engine via env:
 *   FORGE_TTS_COST_<ENGINE>_PER_1K=<eur>
 */
const DEFAULT_TTS_COSTS_PER_1K: Record<string, number> = {
  elevenlabs: 0.165, // ElevenLabs V3
  minimax: 0.05,
  fish: 0.02,
};

export function estimateTtsCostEur(engine: string, textLength: number): number {
  const envKey = `FORGE_TTS_COST_${engine.toUpperCase()}_PER_1K`;
  const override = process.env[envKey];
  const per1k = override
    ? Number(override)
    : (DEFAULT_TTS_COSTS_PER_1K[engine] ?? 0.05);
  if (!Number.isFinite(per1k) || per1k < 0) return 0;
  return (textLength / 1000) * per1k;
}
