import { NextResponse } from "next/server";

/**
 * GET /api/health/veo-fleet
 *
 * Health probe for the VEO Fleet image/video backend, in the same idiom as
 * /api/health/tts so the studio header can carry a second pill.
 *
 * WHY THE VERDICT IS BUILT THE WAY IT IS
 * On 2026-08-05 the fleet had produced nothing for ~12 hours while every
 * liveness signal was green: the orchestrator was up, the worker was
 * registered, heartbeating every 5s, and reporting `status: "busy"`. It was
 * busy holding one job it would never finish. `pending` climbed from 12 to 16
 * and 30 requested thumbnails never appeared.
 *
 * So this route deliberately does NOT report "up" from liveness. Liveness was
 * never the thing that broke. The verdict is driven by THROUGHPUT:
 *
 *   down      — orchestrator unreachable, or no worker online (jobs submitted
 *               now would never be claimed at all)
 *   stalled   — work is queued and the fleet has completed NOTHING recently.
 *               This is the state that used to look perfectly healthy.
 *   degraded  — queue is backing up, or the self-healing monitor is unreachable
 *               (nothing is watching), or remediations are being attempted
 *   ok        — draining work, or legitimately idle with an empty queue
 *   unknown   — probe could not be completed. Never green: an unprobed backend
 *               reporting healthy is how this failure hid for 12 hours.
 *
 * Always returns HTTP 200; the verdict is in `status`.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FLEET_BASE =
  process.env["VEO_FLEET_API_URL"] ?? "http://127.0.0.1:8091";
const MONITOR_BASE =
  process.env["VEO_FLEET_MONITOR_URL"] ?? "http://127.0.0.1:9200";
const TIMEOUT_MS = 10_000;

/**
 * How long a non-empty queue may sit with zero completions before the badge
 * calls it stalled. The fleet's own generations legitimately take minutes, so
 * this must be well above one generation; the monitor's own wedge threshold is
 * 900s and this is deliberately a little tighter so the UI notices first.
 */
const STALL_S = Number(process.env["VEO_FLEET_STALL_S"] ?? "600");
/** Queue depth beyond which we say "backing up" even while work completes. */
const DEEP_QUEUE = Number(process.env["VEO_FLEET_DEEP_QUEUE"] ?? "20");

type FleetStatus = "ok" | "degraded" | "stalled" | "down" | "unknown";

interface FleetStatusBody {
  ok?: boolean;
  workers?: { total?: number; online?: number; busy?: number };
  capacity?: { concurrent_max?: number; concurrent_now?: number };
  queue?: {
    pending?: number;
    processing?: number;
    done?: number;
    error?: number;
  };
  metrics?: {
    throughput?: { done_1m?: number; done_5m?: number; done_1h?: number };
    queue?: { oldest_pending_age_s?: number | null };
  };
}

interface MonitorHealthBody {
  ok?: boolean;
  open_incidents?: Array<{
    kind?: string;
    worker_id?: string | null;
    severity?: string;
  }>;
  counters?: Record<string, number>;
  awaiting_verification?: Array<{ key?: string; waited_s?: number }>;
}

export async function GET() {
  const checkedAt = new Date().toISOString();
  const start = Date.now();

  let body: FleetStatusBody;
  let httpStatus = 0;
  try {
    const res = await fetch(`${FLEET_BASE}/status`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    httpStatus = res.status;
    if (!res.ok) {
      return NextResponse.json({
        status: "down" as FleetStatus,
        provider: "VEO Fleet",
        latencyMs: Date.now() - start,
        httpStatus,
        error: `orchestrator /status returned HTTP ${res.status}`,
        checkedAt,
      });
    }
    body = (await res.json()) as FleetStatusBody;
  } catch (err) {
    return NextResponse.json({
      status: "down" as FleetStatus,
      provider: "VEO Fleet",
      latencyMs: Date.now() - start,
      httpStatus,
      error: err instanceof Error ? err.message : String(err),
      checkedAt,
    });
  }

  const latencyMs = Date.now() - start;

  const online = body.workers?.online ?? 0;
  const pending = body.queue?.pending ?? 0;
  const processing = body.queue?.processing ?? 0;
  const done1m = body.metrics?.throughput?.done_1m ?? 0;
  const done5m = body.metrics?.throughput?.done_5m ?? 0;
  const done1h = body.metrics?.throughput?.done_1h ?? 0;
  const oldestPendingS = body.metrics?.queue?.oldest_pending_age_s ?? null;
  const concurrentNow = body.capacity?.concurrent_now ?? 0;
  const concurrentMax = body.capacity?.concurrent_max ?? 0;

  // The monitor is the thing that is supposed to notice and fix all this. If it
  // is not answering, the fleet is unsupervised even when it looks fine.
  const monitor = await probeMonitor();

  let status: FleetStatus;
  let reason: string;

  if (body.ok !== true) {
    status = "down";
    reason = "orchestrator /status did not report ok:true";
  } else if (online < 1) {
    status = "down";
    reason = "no worker online — submitted jobs would never be claimed";
  } else if (
    pending > 0 &&
    done1m === 0 &&
    done5m === 0 &&
    oldestPendingS !== null &&
    oldestPendingS >= STALL_S
  ) {
    // The 2026-08-05 failure, stated as a rule.
    status = "stalled";
    reason =
      `${pending} job(s) queued and nothing has completed in the last 5 min ` +
      `(oldest has waited ${Math.round(oldestPendingS)}s). ` +
      (concurrentNow > 0
        ? `A worker is holding ${concurrentNow} job(s) — busy is not progress.`
        : "No worker has claimed them.");
  } else if (monitor.status === "down") {
    status = "degraded";
    reason = `fleet is moving but the self-healing monitor is unreachable (${monitor.error ?? "no response"}) — nothing is watching it`;
  } else if (pending >= DEEP_QUEUE) {
    status = "degraded";
    reason = `queue backing up: ${pending} pending, ${processing} processing`;
  } else if ((monitor.openIncidents?.length ?? 0) > 0) {
    status = "degraded";
    reason = `monitor is handling ${monitor.openIncidents?.length} open incident(s): ${(
      monitor.openIncidents ?? []
    )
      .map((i) => i.kind ?? "?")
      .join(", ")}`;
  } else if (pending === 0 && processing === 0) {
    status = "ok";
    reason = "idle — queue empty";
  } else {
    status = "ok";
    reason = `draining: ${pending} pending, ${processing} processing, ${done5m} done in last 5 min`;
  }

  return NextResponse.json({
    status,
    provider: "VEO Fleet",
    reason,
    latencyMs,
    httpStatus,
    workers: {
      online,
      total: body.workers?.total ?? 0,
      concurrentNow,
      concurrentMax,
    },
    queue: {
      pending,
      processing,
      done: body.queue?.done ?? 0,
      error: body.queue?.error ?? 0,
      oldestPendingS,
    },
    throughput: { done1m, done5m, done1h },
    monitor,
    checkedAt,
  });
}

async function probeMonitor(): Promise<{
  status: "ok" | "down" | "unknown";
  openIncidents?: MonitorHealthBody["open_incidents"];
  counters?: Record<string, number>;
  awaitingVerification?: MonitorHealthBody["awaiting_verification"];
  error?: string;
}> {
  try {
    const res = await fetch(`${MONITOR_BASE}/monitor/health`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      return { status: "down", error: `monitor HTTP ${res.status}` };
    }
    const m = (await res.json()) as MonitorHealthBody;
    return {
      status: "ok",
      openIncidents: m.open_incidents ?? [],
      counters: m.counters ?? {},
      awaitingVerification: m.awaiting_verification ?? [],
    };
  } catch (err) {
    return {
      status: "down",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
