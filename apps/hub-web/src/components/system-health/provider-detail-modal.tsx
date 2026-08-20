"use client";

import { useCallback, useEffect, useState } from "react";
import { V2Listbox } from "@/components/thumbnails/v2-listbox";
import { STATUS_VISUALS, formatRelative } from "./status-visuals";
import type { ProviderStatus } from "@repo/provider-registry";

/**
 * Provider detail view — opened by double-clicking a provider card.
 *
 * The design rule inherited from the page it sits on: never render a number
 * we did not measure. Every panel here either shows an upstream value or says
 * which call failed and why. "Not exposed by this API" is written out in full
 * rather than shown as a zero, because a zero reads as a measurement.
 */

// ── Payload types (mirror /api/providers/[key]/ops) ─────────────────────────

interface ConcurrencyTerm {
  name: string;
  label: string;
  value: number;
  binding: boolean;
  lever: string;
}

interface VeoForgeOps {
  provider: "veoforge";
  reachable: boolean;
  errors: string[];
  baseUrl: string;
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
    scope: string;
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

interface FleetOps {
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
      workerOnline: boolean;
      workerId: string | null;
    }>;
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
  lifetime: {
    totalCompleted: number | null;
    totalErrors: number | null;
    totalJobs: number | null;
    successRate: number | null;
    scope: string;
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

interface History {
  windowHours: number;
  firstCheckAt: string | null;
  lastCheckAt: string | null;
  totalChecks: number;
  uptimeFraction: number | null;
  outages: Array<{
    startedAt: string;
    endedAt: string | null;
    minutes: number | null;
    status: string;
    reason: string | null;
    checks: number;
  }>;
  series: Array<{
    bucket: string;
    checks: number;
    upChecks: number;
    avgLatencyMs: number | null;
    metrics: Record<string, number>;
  }>;
  observedLifetime: Record<string, { total: number; resets: number; latest: number }>;
  note: string;
}

interface OpsPayload {
  providerKey: string;
  hasLiveOps: boolean;
  live: VeoForgeOps | FleetOps | null;
  liveError: string | null;
  history: History | null;
  firstEverCheckedAt: string | null;
  generatedAt: string;
  error?: string;
}

interface Props {
  providerKey: string;
  displayName: string;
  status: ProviderStatus;
  onClose: () => void;
}

const WINDOW_OPTIONS = [
  { value: "24", label: "Last 24 hours" },
  { value: "72", label: "Last 3 days" },
  { value: "168", label: "Last 7 days" },
  { value: "720", label: "Last 30 days" },
];

const TEXT = "#e5e2e1";
const MUTED = "rgba(205,195,215,0.55)";
const FAINT = "rgba(205,195,215,0.38)";
const GOOD = "#23decb";
const WARN = "#f5c26b";
const BAD = "#ffb4ab";

export function ProviderDetailModal({
  providerKey,
  displayName,
  status,
  onClose,
}: Props) {
  const [hours, setHours] = useState("168");
  const [data, setData] = useState<OpsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/providers/${encodeURIComponent(providerKey)}/ops?hours=${hours}`,
      );
      const body = (await res.json()) as OpsPayload;
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        setData(null);
      } else {
        setData(body);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [providerKey, hours]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // The board behind the modal scrolls otherwise, which makes the overlay
    // feel like a page rather than a dialog.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const v = STATUS_VISUALS[status];
  const live = data?.live ?? null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(6,6,8,0.78)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "40px 20px",
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${displayName} operations`}
        style={{
          width: "min(1080px, 100%)",
          background: "#131313",
          border: "1px solid rgba(var(--v2-accent-rgb), 0.18)",
          borderRadius: 16,
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "18px 22px",
            borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: TEXT }}>
                {displayName}
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: "0.05em",
                  color: v.color,
                  background: v.background,
                  border: `1px solid ${v.border}`,
                  padding: "3px 8px",
                  borderRadius: 12,
                }}
              >
                {v.label}
              </span>
            </div>
            <span style={{ fontSize: 10, color: FAINT, fontFamily: "monospace" }}>
              {providerKey}
              {live ? ` · ${live.baseUrl}` : ""}
            </span>
          </div>

          <div style={{ width: 168 }}>
            <V2Listbox
              value={hours}
              onChange={setHours}
              options={WINDOW_OPTIONS}
              fullWidth
            />
          </div>

          <IconButton icon="refresh" label="Reload" onClick={() => void load()} />
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>

        <div
          style={{
            padding: 22,
            display: "flex",
            flexDirection: "column",
            gap: 26,
            opacity: loading ? 0.55 : 1,
          }}
        >
          {loading && !data && <Muted>Loading operational data…</Muted>}
          {error && <Banner tone="bad">{error}</Banner>}
          {data?.liveError && (
            <Banner tone="bad">Live data call failed: {data.liveError}</Banner>
          )}
          {data && !data.hasLiveOps && (
            <Banner tone="warn">
              No live operations adapter exists for this provider — only stored
              probe history is shown. Live panels exist for VeoForge and the VEO
              wrapper (VUP), which expose real metrics endpoints.
            </Banner>
          )}
          {live && live.errors.length > 0 && (
            <Banner tone="warn">
              {live.errors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </Banner>
          )}

          {live?.provider === "veoforge" && <VeoForgePanels ops={live} />}
          {live?.provider === "veo_fleet" && <FleetPanels ops={live} />}

          {data?.history && (
            <HistoryPanels
              history={data.history}
              firstEver={data.firstEverCheckedAt}
            />
          )}
          {data && data.history === null && (
            <Banner tone="warn">
              Probe history is unavailable — the provider registry tables are not
              present on this database.
            </Banner>
          )}
        </div>
      </div>
    </div>
  );
}

// ── VeoForge ────────────────────────────────────────────────────────────────

function VeoForgePanels({ ops }: { ops: VeoForgeOps }) {
  const binding = ops.concurrencyTerms.filter((t) => t.binding);
  return (
    <>
      <Section
        title="Effective concurrency"
        subtitle="One account drives one worker through one proxy exit, so the real ceiling is the smallest of the three — not VF_WORKERS. The binding term is what to buy next."
      >
        <div style={{ display: "flex", alignItems: "stretch", gap: 14, flexWrap: "wrap" }}>
          <div
            style={{
              padding: "16px 22px",
              borderRadius: 12,
              background: "rgba(var(--v2-accent-rgb), 0.08)",
              border: "1px solid rgba(var(--v2-accent-rgb), 0.22)",
              minWidth: 140,
            }}
          >
            <div style={{ fontSize: 34, fontWeight: 900, color: "var(--v2-accent)", lineHeight: 1 }}>
              {ops.effectiveConcurrency ?? "—"}
            </div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 6 }}>
              concurrent jobs, actual
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", flex: 1 }}>
            {ops.concurrencyTerms.map((t) => (
              <div
                key={t.name}
                title={t.lever}
                style={{
                  flex: "1 1 180px",
                  padding: "12px 14px",
                  borderRadius: 10,
                  background: t.binding ? "rgba(245,194,107,0.09)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${t.binding ? "rgba(245,194,107,0.35)" : "rgba(255,255,255,0.07)"}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                  <span
                    style={{
                      fontSize: 22,
                      fontWeight: 900,
                      color: t.binding ? WARN : TEXT,
                    }}
                  >
                    {t.value}
                  </span>
                  {t.binding && (
                    <span
                      style={{
                        fontSize: 8,
                        fontWeight: 800,
                        color: WARN,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                      }}
                    >
                      binding
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: MUTED, marginTop: 3 }}>{t.label}</div>
                {t.binding && (
                  <div style={{ fontSize: 10, color: FAINT, marginTop: 6, lineHeight: 1.5 }}>
                    {t.lever}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        {binding.length > 1 && (
          <p style={{ fontSize: 10, color: WARN, margin: "10px 0 0 0" }}>
            {binding.length} terms are tied at the minimum — lifting only one of
            them will not raise throughput.
          </p>
        )}
      </Section>

      <Section title="Throughput" subtitle="Live, from the admin /metrics endpoint.">
        <StatRow
          stats={[
            { label: "Jobs / min", value: fmt(ops.throughput.jobsPerMin) },
            { label: "Completed (1h)", value: fmt(ops.throughput.completedLastHour) },
            {
              label: "Avg latency",
              value: ops.throughput.avgLatencyS === null ? "no samples" : `${ops.throughput.avgLatencyS.toFixed(1)}s`,
            },
            { label: "Queue depth", value: fmt(ops.throughput.queueDepth) },
            { label: "Active sessions", value: fmt(ops.workers.activeSessions) },
          ]}
        />
      </Section>

      <Section
        title="Counters"
        subtitle="VeoForge keeps these in process memory — they reset to zero whenever the service restarts, so they are NOT lifetime totals. The lifetime figures we do have are further down, accumulated from our own stored probes."
      >
        <StatRow
          stats={[
            { label: "Submits (since start)", value: fmt(ops.counters.submits) },
            { label: "Failures (since start)", value: fmt(ops.counters.failures), tone: (ops.counters.failures ?? 0) > 0 ? "bad" : undefined },
            { label: "Ban cooldowns", value: fmt(ops.counters.banCooldowns), tone: (ops.counters.banCooldowns ?? 0) > 0 ? "warn" : undefined },
          ]}
        />
      </Section>

      <Section
        title="Account pool"
        subtitle="Healthy is not the same as assignable — an account already bound to a worker cannot take a new job."
      >
        <StatRow
          stats={[
            { label: "Total", value: fmt(ops.accounts.total) },
            { label: "Healthy", value: fmt(ops.accounts.healthy) },
            { label: "Assignable now", value: String(ops.accounts.assignable), tone: ops.accounts.assignable === 0 ? "warn" : undefined },
            {
              label: "Sources",
              value:
                Object.entries(ops.accounts.bySource)
                  .map(([k, n]) => `${k} ${n}`)
                  .join(" · ") || "—",
            },
          ]}
        />
        <Table
          head={["Account", "Status", "Source", "Tier", "Worker", "Uses", "Errors", "Session"]}
          rows={ops.accounts.rows.map((a) => [
            a.email,
            <Chip key="s" tone={a.healthy ? "good" : "bad"}>{a.status}</Chip>,
            a.source,
            a.model ?? "—",
            a.boundWorker ?? (a.assignable ? "assignable" : "—"),
            String(a.uses),
            a.errorCount + a.errors403 > 0 ? `${a.errorCount} (${a.errors403}× 403)` : "0",
            a.sessionExpiresInS === null
              ? "—"
              : a.sessionExpiresInS <= 0
                ? "expired"
                : `${Math.round(a.sessionExpiresInS / 60)}m`,
          ])}
        />
      </Section>

      <Section title="Workers" subtitle="Why a worker is idle is the useful half of this table.">
        <Table
          head={["Worker", "State", "Account", "Browser", "Circuit", "Why down"]}
          rows={ops.workers.rows.map((w) => [
            w.id,
            w.sessionReady ? <Chip key="c" tone="good">ready</Chip> : w.state,
            w.account ?? "—",
            w.browserUp ? "up" : "—",
            w.circuitTrips > 0 ? `${w.circuitState} (${w.circuitTrips} trips)` : w.circuitState,
            w.whyDown ?? "—",
          ])}
          maxRows={8}
        />
      </Section>

      <Section title="Proxy exits" subtitle="Exits are exclusive: two accounts must never share one.">
        <StatRow
          stats={[
            { label: "Configured", value: fmt(ops.proxy.configured) },
            { label: "In use", value: fmt(ops.proxy.inUse) },
            { label: "Available", value: fmt(ops.proxy.available), tone: ops.proxy.available === 0 ? "warn" : undefined },
            { label: "Cooling", value: fmt(ops.proxy.cooling) },
            { label: "Mode", value: ops.proxy.mode ?? "—" },
          ]}
        />
        {ops.proxy.exits.length > 0 && (
          <Table
            head={["Exit", "Reachable", "Session age", "Reputation"]}
            rows={ops.proxy.exits.map((e) => [
              e.label,
              <Chip key="o" tone={e.ok ? "good" : "bad"}>{e.ok ? "ok" : "down"}</Chip>,
              e.ageS === null ? "—" : `${Math.round(e.ageS / 3600)}h`,
              e.score === null ? "—" : e.score.toFixed(2),
            ])}
          />
        )}
      </Section>
    </>
  );
}

// ── VUP ─────────────────────────────────────────────────────────────────────

function FleetPanels({ ops }: { ops: FleetOps }) {
  return (
    <>
      <Section
        title="Virtual machines"
        subtitle="libvirt domains on the VPS, from the fleet orchestrator's /admin/vms."
      >
        <StatRow
          stats={[
            { label: "VMs running", value: `${fmt(ops.vms.running)} / ${fmt(ops.vms.total)}` },
            { label: "Workers online", value: `${fmt(ops.workers.online)} / ${fmt(ops.workers.total)}` },
            { label: "Busy workers", value: fmt(ops.workers.busy) },
            {
              label: "Concurrency",
              value: `${fmt(ops.workers.concurrentNow)} / ${fmt(ops.workers.concurrentMax)}`,
            },
            { label: "Orchestrator uptime", value: ops.uptimeS === null ? "—" : fmtDuration(ops.uptimeS) },
          ]}
        />
        <Table
          head={["VM", "State", "Role", "LAN IP", "Worker"]}
          rows={ops.vms.rows.map((v) => [
            v.name,
            <Chip key="s" tone={v.state === "running" ? "good" : "bad"}>{v.state}</Chip>,
            v.role,
            v.lanIp ?? "—",
            v.workerId ?? "not correlated",
          ])}
        />
        {ops.vms.correlationNote && (
          <Banner tone="warn">{ops.vms.correlationNote}</Banner>
        )}
      </Section>

      <Section title="Workers" subtitle="Agent processes that claim jobs. Heartbeat age tells you online from stale.">
        <Table
          head={["Worker", "Status", "Last seen", "Capacity", "VUP", "Done", "Errors"]}
          rows={ops.workers.rows.map((w) => [
            w.workerId,
            <Chip key="s" tone={w.status === "online" ? "good" : "bad"}>{w.status}</Chip>,
            w.lastSeenSecondsAgo === null ? "—" : `${w.lastSeenSecondsAgo}s ago`,
            `${fmt(w.concurrentNow)} / ${fmt(w.capacityMax)}`,
            w.vupHealth ? (
              <Chip key="v" tone={w.vupHealth === "up" ? "good" : "bad"}>{w.vupHealth}</Chip>
            ) : (
              "—"
            ),
            fmt(w.done),
            fmt(w.errors),
          ])}
        />
      </Section>

      <Section title="Throughput" subtitle="Rolling windows, recomputed from the job table on every request.">
        <StatRow
          stats={[
            { label: "Done (1m)", value: fmt(ops.throughput.done1m) },
            { label: "Done (5m)", value: fmt(ops.throughput.done5m) },
            { label: "Done (1h)", value: fmt(ops.throughput.done1h) },
            { label: "Jobs / min", value: fmt(ops.throughput.jobsPerMin) },
            {
              label: "Error rate (1h)",
              value: ops.throughput.errorRate === null ? "—" : `${(ops.throughput.errorRate * 100).toFixed(1)}%`,
              tone: (ops.throughput.errorRate ?? 0) > 0 ? "warn" : undefined,
            },
            {
              label: "Avg generation",
              value:
                ops.throughput.avgGenerationS === null
                  ? "no samples in window"
                  : `${ops.throughput.avgGenerationS.toFixed(0)}s (n=${fmt(ops.throughput.latencySamples)})`,
            },
          ]}
        />
      </Section>

      <Section title="Queue" subtitle="">
        <StatRow
          stats={[
            { label: "Pending", value: fmt(ops.queue.pending) },
            { label: "Processing", value: fmt(ops.queue.processing) },
            { label: "Depth", value: fmt(ops.queue.depth) },
            {
              label: "Oldest pending",
              value: ops.queue.oldestPendingAgeS === null ? "—" : fmtDuration(ops.queue.oldestPendingAgeS),
            },
          ]}
        />
      </Section>

      <Section title="Lifetime" subtitle={ops.lifetime.note}>
        <StatRow
          stats={[
            { label: "Total generations", value: fmt(ops.lifetime.totalCompleted) },
            { label: "Cumulative failures", value: fmt(ops.lifetime.totalErrors), tone: (ops.lifetime.totalErrors ?? 0) > 0 ? "bad" : undefined },
            { label: "Total jobs", value: fmt(ops.lifetime.totalJobs) },
            {
              label: "Success rate",
              value: ops.lifetime.successRate === null ? "—" : `${(ops.lifetime.successRate * 100).toFixed(1)}%`,
              tone: (ops.lifetime.successRate ?? 1) < 0.95 ? "warn" : "good",
            },
          ]}
        />
        <p style={{ fontSize: 10, color: FAINT, margin: "10px 0 0 0", lineHeight: 1.6 }}>
          Total minutes of video produced is computable from the orchestrator&apos;s
          job table (sum of <code>params.duration</code> over completed jobs) but no
          HTTP route exposes it, so it is deliberately not shown rather than
          guessed.
        </p>
      </Section>

      <Section title="Incidents" subtitle={ops.incidents.note}>
        {ops.incidents.available ? (
          <>
            <StatRow
              stats={[
                {
                  label: "Open incidents",
                  value: fmt(ops.incidents.openCount),
                  tone: (ops.incidents.openCount ?? 0) > 0 ? "bad" : "good",
                },
                {
                  label: "Monitor uptime",
                  value: ops.incidents.monitorUptimeS === null ? "—" : fmtDuration(ops.incidents.monitorUptimeS),
                },
                ...Object.entries(ops.incidents.countersSinceMonitorStart).map(([k, n]) => ({
                  label: k.replace(/_/g, " "),
                  value: String(n),
                })),
              ]}
            />
            {ops.incidents.open.length > 0 && (
              <Table
                head={["Kind", "Worker", "Severity"]}
                rows={ops.incidents.open.map((i) => [i.kind, i.workerId ?? "—", i.severity ?? "—"])}
              />
            )}
          </>
        ) : (
          <Muted>
            The self-healer is not reachable from this host. Outage history below
            comes from our own stored probe results instead.
          </Muted>
        )}
      </Section>
    </>
  );
}

// ── History (any provider) ──────────────────────────────────────────────────

function HistoryPanels({
  history,
  firstEver,
}: {
  history: History;
  firstEver: string | null;
}) {
  const counterKeys = Object.keys(history.observedLifetime);
  const metricKeys = new Set<string>();
  for (const p of history.series) for (const k of Object.keys(p.metrics)) metricKeys.add(k);
  // Only chart keys the probe extractors actually persist into
  // provider_health_checks.detail. Anything else would render as a flat zero
  // line, which reads as a measurement rather than an absence.
  const charted = [
    // veo_fleet (/status)
    "workers_online",
    "concurrent_now",
    "queue_pending",
    // veoforge (/health)
    "accounts_healthy",
    "active_sessions",
    "queue_depth",
  ].filter((k) => metricKeys.has(k));

  return (
    <>
      <Section
        title="Availability over time"
        subtitle={history.note}
      >
        <StatRow
          stats={[
            {
              label: `Uptime (${history.windowHours}h)`,
              value:
                history.uptimeFraction === null
                  ? "—"
                  : `${(history.uptimeFraction * 100).toFixed(1)}%`,
              tone:
                history.uptimeFraction === null
                  ? undefined
                  : history.uptimeFraction > 0.99
                    ? "good"
                    : history.uptimeFraction > 0.9
                      ? "warn"
                      : "bad",
            },
            { label: "Probes stored", value: String(history.totalChecks) },
            { label: "First ever probe", value: firstEver ? formatRelative(firstEver) : "—" },
            { label: "Last probe", value: history.lastCheckAt ? formatRelative(history.lastCheckAt) : "—" },
          ]}
        />
        {history.series.length > 1 && (
          <Sparkline
            label="Probes answering per bucket"
            points={history.series.map((p) => (p.checks ? p.upChecks / p.checks : 0))}
            max={1}
          />
        )}
      </Section>

      {charted.length > 0 && (
        <Section
          title="Metrics over time"
          subtitle="Averaged per bucket from the metrics snapshot stored with each probe."
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {charted.map((k) => (
              <Sparkline
                key={k}
                label={k.replace(/_/g, " ")}
                points={history.series.map((p) => p.metrics[k] ?? 0)}
              />
            ))}
          </div>
        </Section>
      )}

      {counterKeys.length > 0 && (
        <Section
          title="Observed lifetime"
          subtitle="Accumulated by us across service restarts: we sum the positive deltas between probes, so a counter that resets to zero does not erase the history."
        >
          <StatRow
            stats={counterKeys.map((k) => ({
              label: k.replace(/_/g, " "),
              value: `${history.observedLifetime[k].total}${
                history.observedLifetime[k].resets > 0
                  ? ` (${history.observedLifetime[k].resets} restarts)`
                  : ""
              }`,
            }))}
          />
        </Section>
      )}

      <Section
        title="Outage history"
        subtitle="Contiguous runs of probes that did not answer. Derived from stored probe results, so it only reaches back as far as we have been probing."
      >
        {history.outages.length === 0 ? (
          <Muted>No failed probes in this window.</Muted>
        ) : (
          <Table
            head={["Started", "Ended", "Duration", "Status", "Probes", "Reason"]}
            rows={history.outages.map((o) => [
              new Date(o.startedAt).toLocaleString(),
              o.endedAt ? new Date(o.endedAt).toLocaleString() : <Chip key="o" tone="bad">ongoing</Chip>,
              o.minutes === null ? "—" : fmtDuration(o.minutes * 60),
              o.status,
              String(o.checks),
              o.reason ?? "—",
            ])}
            maxRows={12}
          />
        )}
      </Section>
    </>
  );
}

// ── Primitives ──────────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p style={{ fontSize: 12, fontWeight: 800, color: TEXT, margin: "0 0 3px 0" }}>
        {title}
      </p>
      {subtitle ? (
        <p style={{ fontSize: 10, color: FAINT, margin: "0 0 12px 0", lineHeight: 1.6 }}>
          {subtitle}
        </p>
      ) : (
        <div style={{ height: 10 }} />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </div>
  );
}

function StatRow({
  stats,
}: {
  stats: Array<{ label: string; value: string; tone?: "good" | "warn" | "bad" }>;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
        gap: 10,
      }}
    >
      {stats.map((s, i) => (
        <div
          key={`${s.label}-${i}`}
          style={{
            padding: "10px 12px",
            background: "rgba(255,255,255,0.03)",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: FAINT,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 5,
            }}
          >
            {s.label}
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 800,
              color:
                s.tone === "good" ? GOOD : s.tone === "warn" ? WARN : s.tone === "bad" ? BAD : TEXT,
              wordBreak: "break-word",
            }}
          >
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function Table({
  head,
  rows,
  maxRows,
}: {
  head: string[];
  rows: Array<Array<React.ReactNode>>;
  maxRows?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  if (rows.length === 0) return <Muted>Nothing reported.</Muted>;
  const limit = maxRows && !showAll ? maxRows : rows.length;
  const shown = rows.slice(0, limit);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  padding: "7px 10px",
                  fontSize: 9,
                  fontWeight: 700,
                  color: FAINT,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td
                  key={j}
                  style={{
                    padding: "7px 10px",
                    color: MUTED,
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    whiteSpace: j === r.length - 1 ? "normal" : "nowrap",
                  }}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {maxRows && rows.length > maxRows && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          style={{
            marginTop: 8,
            fontSize: 10,
            color: "var(--v2-accent)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {showAll ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

/**
 * Inline SVG sparkline. No chart library — this page must not pull one in for
 * four small series, and a self-contained polyline has no runtime to break.
 */
function Sparkline({
  label,
  points,
  max,
}: {
  label: string;
  points: number[];
  max?: number;
}) {
  if (points.length < 2) return null;
  const w = 600;
  const h = 40;
  const hi = max ?? Math.max(...points, 1);
  const lo = 0;
  const span = hi - lo || 1;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - lo) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 9,
          color: FAINT,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 4,
        }}
      >
        <span>{label}</span>
        <span>
          now {round(points[points.length - 1])} · peak {round(hi)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{
          width: "100%",
          height: 40,
          display: "block",
          background: "rgba(255,255,255,0.025)",
          borderRadius: 6,
        }}
      >
        <path d={d} fill="none" stroke="var(--v2-accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function Chip({ tone, children }: { tone: "good" | "warn" | "bad"; children: React.ReactNode }) {
  const c = tone === "good" ? GOOD : tone === "warn" ? WARN : BAD;
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        color: c,
        background: `${c}1a`,
        border: `1px solid ${c}44`,
        padding: "2px 7px",
        borderRadius: 10,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Banner({ tone, children }: { tone: "warn" | "bad"; children: React.ReactNode }) {
  const c = tone === "bad" ? BAD : WARN;
  return (
    <div
      style={{
        padding: "10px 14px",
        fontSize: 11,
        lineHeight: 1.6,
        color: c,
        background: `${c}14`,
        border: `1px solid ${c}3d`,
        borderRadius: 8,
      }}
    >
      {children}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 11, color: FAINT, margin: 0 }}>{children}</p>;
}

function IconButton({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        color: MUTED,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8,
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 17 }}>
        {icon}
      </span>
    </button>
  );
}

function fmt(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : String(n);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}
