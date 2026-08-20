import "server-only";
import { vupFleetEndpoint, vupMonitorEndpoint } from "./config";
import { fetchJson } from "./fetch-json";

/**
 * VUP (VEO wrapper) operational snapshot, read from the fleet orchestrator.
 *
 * IMPORTANT — two different endpoints wear the "VUP" name:
 *
 *   VUP_API_URL   http://192.168.122.93:5210   the wrapper process INSIDE the
 *                 win11 guest. This is what the media gateway posts jobs to.
 *   VUP_FLEET_URL http://127.0.0.1:8091        the fleet orchestrator on the
 *                 VPS. It owns the worker registry, the libvirt VM list and
 *                 the SQLite job DB — i.e. all of the analytics.
 *
 * They are not interchangeable and their health can disagree. When it does,
 * that disagreement IS the finding, so the detail view reports both.
 */

// ── Upstream shapes (observed 2026-07-30) ───────────────────────────────────

interface FleetMetrics {
  ok?: boolean;
  version?: string;
  throughput?: {
    done_1m?: number;
    done_5m?: number;
    done_1h?: number;
    jobs_per_min?: number;
  };
  latency?: { avg_generation_s?: number | null; samples?: number };
  error_rate?: number;
  queue?: {
    pending?: number;
    processing?: number;
    done?: number;
    error?: number;
    depth?: number;
    oldest_pending_age_s?: number | null;
  };
  workers?: {
    online?: number;
    total?: number;
    busy?: number;
    concurrent_max?: number;
    concurrent_now?: number;
  };
  per_worker?: Record<
    string,
    {
      done?: number;
      errors?: number;
      online?: boolean;
      concurrent_now?: number;
      capacity_max?: number;
      status?: string;
    }
  >;
}

interface FleetHealthz {
  ok?: boolean;
  version?: string;
  uptime_s?: number;
}

interface BridgeClient {
  worker_id?: string;
  lan_addr?: string;
  status?: string;
  capacity_max?: number;
  concurrent_now?: number;
  assigned_apis?: number;
  health?: Record<string, unknown>;
  last_seen?: number;
}

interface AdminVm {
  name?: string;
  state?: string;
  controllable?: boolean;
  role?: string;
  lan_ip?: string;
  worker_online?: boolean;
}

interface MonitorHealth {
  ok?: boolean;
  uptime_s?: number;
  polls?: number;
  last_poll_ok?: boolean;
  orchestrator?: { url?: string; reachable?: boolean };
  open_incidents?: Array<Record<string, unknown>>;
  counters?: Record<string, number>;
  config?: Record<string, unknown>;
}

// ── Our shape ───────────────────────────────────────────────────────────────

export interface FleetOps {
  provider: "veo_fleet";
  reachable: boolean;
  errors: string[];
  baseUrl: string;
  version: string | null;
  uptimeS: number | null;
  vms: {
    total: number | null;
    running: number | null;
    rows: Array<{
      name: string;
      state: string;
      role: string;
      lanIp: string | null;
      /** Correlated by us — the orchestrator's own field is broken. */
      workerOnline: boolean;
      workerId: string | null;
    }>;
    /** Set when we had to correlate VM→worker ourselves. */
    correlationNote: string | null;
  };
  workers: {
    total: number | null;
    online: number | null;
    busy: number | null;
    concurrentMax: number | null;
    concurrentNow: number | null;
    rows: Array<{
      workerId: string;
      status: string;
      capacityMax: number | null;
      concurrentNow: number | null;
      assignedApis: number | null;
      lastSeenSecondsAgo: number | null;
      vupHealth: string | null;
      lastError: string | null;
      done: number | null;
      errors: number | null;
    }>;
  };
  throughput: {
    done1m: number | null;
    done5m: number | null;
    done1h: number | null;
    jobsPerMin: number | null;
    avgGenerationS: number | null;
    latencySamples: number | null;
    errorRate: number | null;
  };
  queue: {
    pending: number | null;
    processing: number | null;
    depth: number | null;
    oldestPendingAgeS: number | null;
  };
  /** DB-backed, survives restarts. */
  lifetime: {
    totalCompleted: number | null;
    totalErrors: number | null;
    totalJobs: number | null;
    successRate: number | null;
    scope: "persisted-since-2026-07-29";
    note: string;
  };
  incidents: {
    available: boolean;
    openCount: number | null;
    open: Array<{ kind: string; workerId: string | null; severity: string | null }>;
    countersSinceMonitorStart: Record<string, number>;
    monitorUptimeS: number | null;
    note: string;
  };
}

export async function collectFleetOps(
  env: NodeJS.ProcessEnv = process.env,
): Promise<FleetOps> {
  const ep = vupFleetEndpoint(env);
  const mon = vupMonitorEndpoint(env);
  const errors: string[] = [];
  if (!ep.configured && ep.reason) errors.push(ep.reason);

  const [metrics, healthz, clients, vms, monitor] = await Promise.all([
    fetchJson<FleetMetrics>(`${ep.baseUrl}/metrics`, ep.headers),
    fetchJson<FleetHealthz>(`${ep.baseUrl}/healthz`, ep.headers),
    fetchJson<{ workers?: BridgeClient[] }>(`${ep.baseUrl}/bridge/clients`, ep.headers),
    fetchJson<AdminVm[]>(`${ep.baseUrl}/admin/vms`, ep.headers),
    // Loopback-only; a dev laptop simply cannot reach it and that is fine.
    fetchJson<MonitorHealth>(`${mon.baseUrl}/monitor/health`, {}, 5000),
  ]);

  if (!metrics.ok) errors.push(`/metrics: ${metrics.error}`);
  if (!clients.ok) errors.push(`/bridge/clients: ${clients.error}`);
  if (!vms.ok) errors.push(`/admin/vms: ${vms.error}`);

  const m: FleetMetrics = metrics.ok ? metrics.data : {};
  const workerRows = clients.ok ? (clients.data.workers ?? []) : [];
  const vmRows = vms.ok ? (Array.isArray(vms.data) ? vms.data : []) : [];
  const perWorker = m.per_worker ?? {};
  const nowS = Date.now() / 1000;

  // ── VM ↔ worker correlation ──────────────────────────────────────────────
  // The orchestrator's own `worker_online` is permanently false: it matches on
  // domain-name == worker_id ("win11" != "worker-1") or on lan_ip == the
  // worker's lan_addr, and lan_addr is "" because the agent heartbeats without
  // ever calling /bridge/register. We do not trust that field. Correlate by
  // lan_addr when the agent supplies one, otherwise say plainly that we could
  // not — never guess a mapping.
  const onlineWorkers = workerRows.filter((w) => w.status === "online");
  let correlationNote: string | null = null;
  const vmOut = vmRows.map((v) => {
    const match = workerRows.find(
      (w) => w.lan_addr && v.lan_ip && w.lan_addr.includes(v.lan_ip),
    );
    return {
      name: v.name ?? "?",
      state: v.state ?? "unknown",
      role: v.role ?? "unknown",
      lanIp: v.lan_ip ?? null,
      workerOnline: match ? match.status === "online" : false,
      workerId: match?.worker_id ?? null,
    };
  });
  if (vmRows.length > 0 && vmOut.every((v) => v.workerId === null)) {
    correlationNote =
      `Could not map any VM to a worker: the agents heartbeat without calling /bridge/register, so their lan_addr is empty. ` +
      `${onlineWorkers.length} worker(s) are online overall — which guest each runs in is not reported. ` +
      `Fix upstream by having the agent send lan_addr on register.`;
  }

  const done = m.queue?.done ?? null;
  const errored = m.queue?.error ?? null;
  const totalJobs = done !== null && errored !== null ? done + errored : null;

  const openIncidents = monitor.ok ? (monitor.data.open_incidents ?? []) : [];

  return {
    provider: "veo_fleet",
    reachable: metrics.ok,
    errors,
    baseUrl: ep.baseUrl,
    version: m.version ?? (healthz.ok ? (healthz.data.version ?? null) : null),
    uptimeS: healthz.ok ? (healthz.data.uptime_s ?? null) : null,
    vms: {
      total: vms.ok ? vmRows.length : null,
      running: vms.ok ? vmRows.filter((v) => v.state === "running").length : null,
      rows: vmOut,
      correlationNote,
    },
    workers: {
      total: m.workers?.total ?? (clients.ok ? workerRows.length : null),
      online: m.workers?.online ?? (clients.ok ? onlineWorkers.length : null),
      busy: m.workers?.busy ?? null,
      concurrentMax: m.workers?.concurrent_max ?? null,
      concurrentNow: m.workers?.concurrent_now ?? null,
      rows: workerRows.map((w) => {
        const id = w.worker_id ?? "?";
        const stats = perWorker[id] ?? {};
        const health = (w.health ?? {}) as Record<string, unknown>;
        return {
          workerId: id,
          status: w.status ?? "unknown",
          capacityMax: w.capacity_max ?? stats.capacity_max ?? null,
          concurrentNow: w.concurrent_now ?? stats.concurrent_now ?? null,
          assignedApis: w.assigned_apis ?? null,
          lastSeenSecondsAgo:
            typeof w.last_seen === "number" ? Math.max(0, Math.round(nowS - w.last_seen)) : null,
          vupHealth: typeof health.vup === "string" ? health.vup : null,
          lastError: typeof health.last_error === "string" ? health.last_error : null,
          done: stats.done ?? null,
          errors: stats.errors ?? null,
        };
      }),
    },
    throughput: {
      done1m: m.throughput?.done_1m ?? null,
      done5m: m.throughput?.done_5m ?? null,
      done1h: m.throughput?.done_1h ?? null,
      jobsPerMin: m.throughput?.jobs_per_min ?? null,
      avgGenerationS: m.latency?.avg_generation_s ?? null,
      latencySamples: m.latency?.samples ?? null,
      errorRate: m.error_rate ?? null,
    },
    queue: {
      pending: m.queue?.pending ?? null,
      processing: m.queue?.processing ?? null,
      depth: m.queue?.depth ?? null,
      oldestPendingAgeS: m.queue?.oldest_pending_age_s ?? null,
    },
    lifetime: {
      totalCompleted: done,
      totalErrors: errored,
      totalJobs,
      successRate: totalJobs && totalJobs > 0 && done !== null ? done / totalJobs : null,
      scope: "persisted-since-2026-07-29",
      note:
        "Counted with GROUP BY over the orchestrator's SQLite jobs table, so these survive restarts — but the table only goes back to the fleet rollout on 2026-07-29. Total video SECONDS produced is derivable there (SUM of params.duration) but no HTTP route exposes it.",
    },
    incidents: {
      available: monitor.ok,
      openCount: monitor.ok ? openIncidents.length : null,
      open: openIncidents.map((i) => ({
        kind: String((i as Record<string, unknown>).kind ?? "unknown"),
        workerId: ((i as Record<string, unknown>).worker_id as string) ?? null,
        severity: ((i as Record<string, unknown>).severity as string) ?? null,
      })),
      countersSinceMonitorStart: monitor.ok ? (monitor.data.counters ?? {}) : {},
      monitorUptimeS: monitor.ok ? (monitor.data.uptime_s ?? null) : null,
      note: monitor.ok
        ? "Open incidents and counters come from the veo-fleet-monitor self-healer (:9200). Its counters reset whenever the monitor restarts, and closed incidents are written only to journald — so this is not a complete outage log."
        : "The self-healer on :9200 is not proxied publicly and is only reachable from the VPS. Outage history below is derived from our own stored probe history instead.",
    },
  };
}
