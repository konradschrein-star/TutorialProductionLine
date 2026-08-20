import "server-only";
import { veoforgeEndpoint } from "./config";
import { fetchJson } from "./fetch-json";

/**
 * VeoForge operational snapshot.
 *
 * Built from the three admin endpoints the service already exposes
 * (`/metrics`, `/status`, `/accounts`) plus the unauthenticated `/health`.
 * Nothing here is invented — every field traces to a response field, and a
 * field the service does not expose comes back null with a reason rather
 * than an estimate.
 */

// ── Upstream shapes (as observed 2026-07-30) ────────────────────────────────

interface VfProxyBlock {
  configured?: number;
  mode?: string;
  exclusive?: boolean;
  in_use?: number;
  available?: number;
  cooling?: number;
  health?: Record<string, { ok?: boolean; ip?: string; age_s?: number }>;
  reputation?: Record<string, { ok?: number; bad?: number; score?: number }>;
}

interface VfMetrics {
  jobs_per_min?: number;
  completed_last_hour?: number;
  avg_latency_s?: number | null;
  per_account_throughput_1h?: Record<string, number>;
  coalescing_ratio?: number;
  ban_cooldown_count?: number;
  failures?: number;
  submits?: number;
  active_workers?: number;
  workers_configured?: number;
  queue_depth?: number;
  accounts_total?: number;
  accounts_healthy?: number;
  accounts_by_status?: Record<string, number>;
  proxy?: VfProxyBlock;
}

interface VfAccount {
  email?: string;
  status?: string;
  uses?: number;
  source?: string;
  model?: string | null;
  error_count?: number;
  errors_403?: number;
  active_jobs?: number;
  healthy?: boolean;
  assignable?: boolean;
  bound_worker?: string | null;
  proxy?: string | null;
  session_expires_in_s?: number | null;
  cooldown_s?: number;
  quarantine_s?: number;
  degrade_s?: number;
  note?: string;
}

interface VfWorker {
  id?: string;
  state?: string;
  why_down?: string | null;
  account?: string | null;
  browser_up?: boolean;
  session_ready?: boolean;
  circuit?: { state?: string; fails?: number; trips?: number; cooldown_s?: number };
}

interface VfStatus {
  workers?: { configured?: number; active_sessions?: number; workers?: VfWorker[] };
  pool?: { total?: number; healthy?: number; accounts?: VfAccount[] };
  queue_depth?: number;
}

interface VfHealth {
  ok?: boolean;
  workers_configured?: number;
  active_sessions?: number;
  accounts_total?: number;
  accounts_healthy?: number;
  queue_depth?: number;
}

// ── Our shape ───────────────────────────────────────────────────────────────

export interface ConcurrencyTerm {
  name: string;
  label: string;
  value: number;
  /** True for the term that is actually capping throughput. */
  binding: boolean;
  /** What the operator would do to raise this term. */
  lever: string;
}

export interface VeoForgeOps {
  provider: "veoforge";
  reachable: boolean;
  errors: string[];
  baseUrl: string;
  /** min(VF_WORKERS, healthy assignable accounts, distinct proxy exits). */
  effectiveConcurrency: number | null;
  concurrencyTerms: ConcurrencyTerm[];
  bindingConstraint: string | null;
  throughput: {
    jobsPerMin: number | null;
    completedLastHour: number | null;
    avgLatencyS: number | null;
    queueDepth: number | null;
    perAccount1h: Record<string, number>;
  };
  counters: {
    submits: number | null;
    failures: number | null;
    banCooldowns: number | null;
    /** These reset when the uvicorn process restarts — say so in the UI. */
    scope: "since-process-start";
  };
  accounts: {
    total: number | null;
    healthy: number | null;
    assignable: number;
    byStatus: Record<string, number>;
    bySource: Record<string, number>;
    rows: Array<{
      email: string;
      status: string;
      source: string;
      model: string | null;
      healthy: boolean;
      assignable: boolean;
      boundWorker: string | null;
      uses: number;
      errorCount: number;
      errors403: number;
      sessionExpiresInS: number | null;
      cooldownS: number;
      quarantineS: number;
      note: string;
    }>;
  };
  workers: {
    configured: number | null;
    activeSessions: number | null;
    rows: Array<{
      id: string;
      state: string;
      whyDown: string | null;
      account: string | null;
      browserUp: boolean;
      sessionReady: boolean;
      circuitState: string;
      circuitTrips: number;
    }>;
  };
  proxy: {
    configured: number | null;
    available: number | null;
    inUse: number | null;
    cooling: number | null;
    mode: string | null;
    exits: Array<{ label: string; ok: boolean; ageS: number | null; score: number | null }>;
  };
}

/** Redact an account email to `ab…@gmail.com` for the UI. */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const user = email.slice(0, at);
  const head = user.slice(0, 2);
  return `${head}${"·".repeat(Math.max(1, user.length - 2))}${email.slice(at)}`;
}

/**
 * Proxy exit labels come back as full `http://ip:port` URLs. /metrics keeps
 * the IP for admin-scope callers (it is stripped for demo scope), but there
 * is no reason to render a residential exit IP in a browser tab, so show the
 * port and a truncated octet only.
 */
function maskProxy(label: string): string {
  const m = /^\w+:\/\/(\d+)\.(\d+)\.[\d]+\.[\d]+:(\d+)/.exec(label);
  return m ? `${m[1]}.${m[2]}.x.x:${m[3]}` : label.replace(/\d+\.\d+\.\d+\.\d+/, "x.x.x.x");
}

function tally<T>(rows: T[], pick: (r: T) => string | null | undefined) {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = pick(r);
    if (!k) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export async function collectVeoForgeOps(
  env: NodeJS.ProcessEnv = process.env,
): Promise<VeoForgeOps> {
  const ep = veoforgeEndpoint(env);
  const errors: string[] = [];
  if (!ep.configured && ep.reason) errors.push(ep.reason);

  const [health, metrics, status] = await Promise.all([
    fetchJson<VfHealth>(`${ep.baseUrl}/health`, {}),
    fetchJson<VfMetrics>(`${ep.baseUrl}/metrics`, ep.headers),
    fetchJson<VfStatus>(`${ep.baseUrl}/status`, ep.headers),
  ]);

  if (!health.ok) errors.push(`/health: ${health.error}`);
  if (!metrics.ok) errors.push(`/metrics: ${metrics.error}`);
  if (!status.ok) errors.push(`/status: ${status.error}`);

  const m: VfMetrics = metrics.ok ? metrics.data : {};
  const s: VfStatus = status.ok ? status.data : {};
  const h: VfHealth = health.ok ? health.data : {};
  const proxy = m.proxy ?? {};

  const accountRows = s.pool?.accounts ?? [];
  const assignable = accountRows.filter((a) => a.assignable === true).length;

  // ── The min() the operator actually needs ────────────────────────────────
  // Deliberately built from /status (the account list) rather than the
  // /metrics summary, because "healthy" and "assignable" are different: an
  // account already bound to a worker is healthy but NOT assignable, and it
  // is the assignable count that caps a new job.
  const workersConfigured =
    m.workers_configured ?? s.workers?.configured ?? h.workers_configured ?? null;
  const proxyExits = proxy.configured ?? null;
  const healthyAccounts =
    s.pool?.healthy ?? m.accounts_healthy ?? h.accounts_healthy ?? null;

  const terms: ConcurrencyTerm[] = [];
  if (workersConfigured !== null)
    terms.push({
      name: "workers",
      label: "VF_WORKERS",
      value: workersConfigured,
      binding: false,
      lever: "Raise VF_WORKERS (default 16, hard cap 40). Free — but only helps if accounts and proxies keep up.",
    });
  if (healthyAccounts !== null)
    terms.push({
      name: "accounts",
      label: "Healthy accounts",
      value: healthyAccounts,
      binding: false,
      lever: "Add Google accounts to the pool (own export or harvested). One account drives one worker.",
    });
  if (proxyExits !== null)
    terms.push({
      name: "proxies",
      label: "Distinct proxy exits",
      value: proxyExits,
      binding: false,
      lever: "Buy more residential proxy exits. Exits are exclusive — two accounts must never share one.",
    });

  let effectiveConcurrency: number | null = null;
  let bindingConstraint: string | null = null;
  if (terms.length > 0) {
    const min = terms.reduce((a, b) => (b.value < a.value ? b : a));
    effectiveConcurrency = min.value;
    bindingConstraint = min.name;
    // Every term AT the minimum is binding — two tied constraints both have
    // to be lifted, and showing only one would send the operator shopping
    // for the wrong thing.
    for (const t of terms) t.binding = t.value === min.value;
  }

  return {
    provider: "veoforge",
    reachable: health.ok || metrics.ok || status.ok,
    errors,
    baseUrl: ep.baseUrl,
    effectiveConcurrency,
    concurrencyTerms: terms,
    bindingConstraint,
    throughput: {
      jobsPerMin: m.jobs_per_min ?? null,
      completedLastHour: m.completed_last_hour ?? null,
      avgLatencyS: m.avg_latency_s ?? null,
      queueDepth: m.queue_depth ?? s.queue_depth ?? h.queue_depth ?? null,
      perAccount1h: Object.fromEntries(
        Object.entries(m.per_account_throughput_1h ?? {}).map(([k, v]) => [
          maskEmail(k),
          v,
        ]),
      ),
    },
    counters: {
      submits: m.submits ?? null,
      failures: m.failures ?? null,
      banCooldowns: m.ban_cooldown_count ?? null,
      scope: "since-process-start",
    },
    accounts: {
      total: s.pool?.total ?? m.accounts_total ?? h.accounts_total ?? null,
      healthy: healthyAccounts,
      assignable,
      byStatus: m.accounts_by_status ?? tally(accountRows, (a) => a.status),
      bySource: tally(accountRows, (a) => a.source),
      rows: accountRows.map((a) => ({
        email: maskEmail(a.email ?? "unknown"),
        status: a.status ?? "unknown",
        source: a.source ?? "unknown",
        model: a.model ?? null,
        healthy: a.healthy === true,
        assignable: a.assignable === true,
        boundWorker: a.bound_worker ?? null,
        uses: a.uses ?? 0,
        errorCount: a.error_count ?? 0,
        errors403: a.errors_403 ?? 0,
        sessionExpiresInS: a.session_expires_in_s ?? null,
        cooldownS: a.cooldown_s ?? 0,
        quarantineS: a.quarantine_s ?? 0,
        note: a.note ?? "",
      })),
    },
    workers: {
      configured: workersConfigured,
      activeSessions: s.workers?.active_sessions ?? m.active_workers ?? null,
      rows: (s.workers?.workers ?? []).map((w) => ({
        id: w.id ?? "?",
        state: w.state ?? "unknown",
        whyDown: w.why_down ?? null,
        account: w.account ? maskEmail(w.account) : null,
        browserUp: w.browser_up === true,
        sessionReady: w.session_ready === true,
        circuitState: w.circuit?.state ?? "unknown",
        circuitTrips: w.circuit?.trips ?? 0,
      })),
    },
    proxy: {
      configured: proxyExits,
      available: proxy.available ?? null,
      inUse: proxy.in_use ?? null,
      cooling: proxy.cooling ?? null,
      mode: proxy.mode ?? null,
      exits: Object.entries(proxy.health ?? {}).map(([label, hh]) => ({
        label: maskProxy(label),
        ok: hh?.ok === true,
        ageS: hh?.age_s ?? null,
        score: proxy.reputation?.[label]?.score ?? null,
      })),
    },
  };
}
