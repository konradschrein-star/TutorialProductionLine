import { NextResponse } from "next/server";

/**
 * GET /api/health/tts
 *
 * Health probe for the TTS engine the Tutorial Studio actually uses.
 *
 * That engine is Fish Audio. The studio header used to poll /api/health/ai33,
 * which had shown a red "AI33 TTS · DOWN" pill continuously since AI33 was
 * dropped as a TTS provider — a permanent alarm about a system nobody depends
 * on, sitting next to a pipeline that was working fine. A status light that is
 * always red is worse than no status light, because it trains people to ignore
 * the one place the app tells them something is broken.
 *
 * Probes the wallet endpoint (no synthesis, no spend) and measures latency.
 *
 * Status semantics:
 *   ok        — 200 and latency <= DEGRADED_LATENCY_MS
 *   degraded  — 200 but slow, or credit below LOW_CREDIT
 *   down      — non-2xx, timeout, network error, or no key configured
 *
 * Always returns HTTP 200; the verdict is in the `status` field.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FISH_API_BASE = process.env["FISH_API_BASE"] ?? "https://api.fish.audio";
const DEGRADED_LATENCY_MS = 2500;
const TIMEOUT_MS = 10_000;
/** Fish credit is denominated in dollars. Below this, say so before it stops. */
const LOW_CREDIT = 5;

type TtsStatus = "ok" | "degraded" | "down";

export async function GET() {
  const checkedAt = new Date().toISOString();
  const apiKey = process.env["FISH_API_KEY"] ?? "";

  if (!apiKey) {
    return NextResponse.json({
      status: "down" as TtsStatus,
      provider: "Fish Audio",
      latencyMs: 0,
      credits: null,
      httpStatus: 0,
      error: "FISH_API_KEY not configured",
      checkedAt,
    });
  }

  const start = Date.now();
  try {
    const res = await fetch(`${FISH_API_BASE}/wallet/self/api-credit`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const latencyMs = Date.now() - start;

    // Fish returns credit as a decimal STRING ("58.075890"), so Number() is
    // needed and a parse failure must stay null rather than becoming 0 — "0
    // credit" and "we could not read the credit" are different alarms.
    let credits: number | null = null;
    try {
      const body = (await res.json()) as { credit?: string | number };
      const raw = body.credit;
      const parsed = typeof raw === "string" ? Number(raw) : raw;
      if (typeof parsed === "number" && Number.isFinite(parsed)) {
        credits = parsed;
      }
    } catch {
      // Body parse failure is non-fatal — latency + status still meaningful.
    }

    let status: TtsStatus;
    if (!res.ok) status = "down";
    else if (latencyMs > DEGRADED_LATENCY_MS) status = "degraded";
    else if (credits !== null && credits < LOW_CREDIT) status = "degraded";
    else status = "ok";

    return NextResponse.json({
      status,
      provider: "Fish Audio",
      latencyMs,
      credits,
      httpStatus: res.status,
      checkedAt,
    });
  } catch (err) {
    return NextResponse.json({
      status: "down" as TtsStatus,
      provider: "Fish Audio",
      latencyMs: Date.now() - start,
      credits: null,
      httpStatus: 0,
      error: err instanceof Error ? err.message : String(err),
      checkedAt,
    });
  }
}
