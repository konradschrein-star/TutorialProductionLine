import "server-only";
import { and, asc, gte, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { providerHealthChecks } from "@repo/db";

/**
 * Analytics-over-time and outage history for ANY provider, derived from the
 * `provider_health_checks` rows the worker's prober already writes every
 * ~5 minutes.
 *
 * WHY NO NEW TABLE. Everything the operator asked for that needs storage —
 * "analytics over time", "outages", "lifetime metrics" — is a function of
 * (checked_at, status, detail) over time, and that table already carries all
 * three, with `detail` as jsonb. It holds ~319 rows/provider/day today. The
 * only thing missing was that the probes for these two providers wrote
 * `detail: null`; adding `extractDetail` to the catalog fills it going
 * forward. Adding a second, near-identical table would have split the
 * history in half for no gain.
 *
 * The honest limit, surfaced in the UI: this series starts when the provider
 * was first probed, so on day one the outage list and the counter series are
 * short. It is a real record, not a backfilled guess.
 */

export interface OutageEpisode {
  startedAt: string;
  endedAt: string | null;
  minutes: number | null;
  status: string;
  /** Most common error seen during the episode. */
  reason: string | null;
  checks: number;
}

export interface HistoryPoint {
  bucket: string;
  checks: number;
  upChecks: number;
  avgLatencyMs: number | null;
  /** Numeric fields lifted out of `detail`, averaged over the bucket. */
  metrics: Record<string, number>;
}

export interface ProviderHistory {
  providerKey: string;
  windowHours: number;
  firstCheckAt: string | null;
  lastCheckAt: string | null;
  totalChecks: number;
  /** Fraction of checks in the window that were up/degraded. */
  uptimeFraction: number | null;
  outages: OutageEpisode[];
  series: HistoryPoint[];
  /**
   * Counter fields from `detail` accumulated across process restarts.
   * VeoForge's submits/failures reset to 0 when uvicorn restarts, so a plain
   * "latest value" understates the truth. We sum the positive deltas and
   * count the resets instead — that IS the lifetime figure, as observed.
   */
  observedLifetime: Record<string, { total: number; resets: number; latest: number }>;
  note: string;
}

/**
 * Fields in `detail` we accumulate as monotonic counters.
 *
 * `jobs_done` / `jobs_error` come from veo_fleet's /status and are already
 * DB-backed lifetime totals upstream — accumulating them here mainly guards
 * against the orchestrator's job table being pruned or rebuilt. `submits` /
 * `failures` are VeoForge's in-process counters, which DO reset on restart,
 * and are the reason this accumulator exists at all.
 */
const COUNTER_FIELDS = [
  "jobs_done",
  "jobs_error",
  "submits",
  "failures",
  "ban_cooldown_count",
];

interface Row {
  status: string;
  latency_ms: number | null;
  error: string | null;
  checked_at: Date;
  detail: Record<string, unknown> | null;
}

function isUp(status: string): boolean {
  return status === "up" || status === "degraded";
}

export async function loadProviderHistory(
  providerKey: string,
  windowHours = 24 * 7,
  bucketMinutes = 60,
): Promise<ProviderHistory> {
  const since = new Date(Date.now() - windowHours * 3_600_000);

  const rows = (await db
    .select({
      status: providerHealthChecks.status,
      latency_ms: providerHealthChecks.latency_ms,
      error: providerHealthChecks.error,
      checked_at: providerHealthChecks.checked_at,
      detail: providerHealthChecks.detail,
    })
    .from(providerHealthChecks)
    .where(
      and(
        eq(providerHealthChecks.provider_key, providerKey),
        gte(providerHealthChecks.checked_at, since),
      ),
    )
    // Ascending: episode detection and counter deltas both need chronological
    // order, and re-sorting 2k rows in JS to save a keyword is silly.
    .orderBy(asc(providerHealthChecks.checked_at))) as Row[];

  if (rows.length === 0) {
    return {
      providerKey,
      windowHours,
      firstCheckAt: null,
      lastCheckAt: null,
      totalChecks: 0,
      uptimeFraction: null,
      outages: [],
      series: [],
      observedLifetime: {},
      note: "No probe history stored for this provider yet. It appears once the worker prober has run against it — history is never backfilled or estimated.",
    };
  }

  // ── Outage episodes: contiguous runs of not-up ───────────────────────────
  const outages: OutageEpisode[] = [];
  let current: { start: Date; status: string; errors: string[]; checks: number } | null = null;
  for (const r of rows) {
    if (!isUp(r.status)) {
      if (current && current.status === r.status) {
        current.checks += 1;
        if (r.error) current.errors.push(r.error);
      } else {
        if (current) closeEpisode(current, r.checked_at);
        current = {
          start: r.checked_at,
          status: r.status,
          errors: r.error ? [r.error] : [],
          checks: 1,
        };
      }
    } else if (current) {
      closeEpisode(current, r.checked_at);
      current = null;
    }
  }
  // Still failing at the end of the window → episode is open, endedAt null.
  if (current) {
    outages.push({
      startedAt: current.start.toISOString(),
      endedAt: null,
      minutes: Math.round((Date.now() - current.start.getTime()) / 60000),
      status: current.status,
      reason: commonest(current.errors),
      checks: current.checks,
    });
  }

  function closeEpisode(
    ep: { start: Date; status: string; errors: string[]; checks: number },
    endedAt: Date,
  ) {
    outages.push({
      startedAt: ep.start.toISOString(),
      endedAt: endedAt.toISOString(),
      minutes: Math.round((endedAt.getTime() - ep.start.getTime()) / 60000),
      status: ep.status,
      reason: commonest(ep.errors),
      checks: ep.checks,
    });
  }

  // ── Time buckets ────────────────────────────────────────────────────────
  const bucketMs = bucketMinutes * 60_000;
  const buckets = new Map<
    number,
    { checks: number; up: number; latency: number[]; metrics: Map<string, number[]> }
  >();
  for (const r of rows) {
    const k = Math.floor(r.checked_at.getTime() / bucketMs) * bucketMs;
    let b = buckets.get(k);
    if (!b) {
      b = { checks: 0, up: 0, latency: [], metrics: new Map() };
      buckets.set(k, b);
    }
    b.checks += 1;
    if (isUp(r.status)) b.up += 1;
    if (typeof r.latency_ms === "number") b.latency.push(r.latency_ms);
    for (const [key, val] of Object.entries(r.detail ?? {})) {
      if (typeof val !== "number" || !Number.isFinite(val)) continue;
      const arr = b.metrics.get(key) ?? [];
      arr.push(val);
      b.metrics.set(key, arr);
    }
  }

  const series: HistoryPoint[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, b]) => ({
      bucket: new Date(k).toISOString(),
      checks: b.checks,
      upChecks: b.up,
      avgLatencyMs: b.latency.length ? Math.round(avg(b.latency)) : null,
      metrics: Object.fromEntries(
        [...b.metrics.entries()].map(([key, vals]) => [key, round2(avg(vals))]),
      ),
    }));

  // ── Counter accumulation across restarts ────────────────────────────────
  const observedLifetime: Record<string, { total: number; resets: number; latest: number }> = {};
  for (const field of COUNTER_FIELDS) {
    let total = 0;
    let resets = 0;
    let prev: number | null = null;
    let latest = 0;
    let seen = false;
    for (const r of rows) {
      const v = r.detail?.[field];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      seen = true;
      latest = v;
      if (prev === null) {
        total += v; // first observation: everything up to now
      } else if (v >= prev) {
        total += v - prev;
      } else {
        // Counter went backwards → the process restarted. The work done
        // before the restart is already in `total`; the new value is work
        // done since, so add all of it and record the discontinuity.
        resets += 1;
        total += v;
      }
      prev = v;
    }
    if (seen) observedLifetime[field] = { total, resets, latest };
  }

  const upChecks = rows.filter((r) => isUp(r.status)).length;

  return {
    providerKey,
    windowHours,
    firstCheckAt: rows[0].checked_at.toISOString(),
    lastCheckAt: rows[rows.length - 1].checked_at.toISOString(),
    totalChecks: rows.length,
    uptimeFraction: upChecks / rows.length,
    outages: outages.reverse(),
    series,
    observedLifetime,
    note: `Derived from ${rows.length} stored probe results. Uptime is the share of probes that answered, not wall-clock availability — a gap between probes is invisible to it.`,
  };
}

/**
 * How far back the stored history actually reaches for a provider. Used to
 * qualify "lifetime" claims instead of implying we have seen everything.
 */
export async function firstEverCheck(providerKey: string): Promise<string | null> {
  const [row] = await db
    .select({ first: sql<Date | null>`min(${providerHealthChecks.checked_at})` })
    .from(providerHealthChecks)
    .where(eq(providerHealthChecks.provider_key, providerKey));
  return row?.first ? new Date(row.first).toISOString() : null;
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function commonest(xs: string[]): string | null {
  if (xs.length === 0) return null;
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
