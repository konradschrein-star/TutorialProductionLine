import { redirect } from "next/navigation";
import { statfs } from "node:fs/promises";
import { getSession } from "../_lib/v2-auth";
import { GlassCard } from "../_components/glass-card";
import { hasPermission } from "@/lib/auth/rbac";
import {
  getFailedJobs,
  getFailedJobCountsByStatus,
} from "@/lib/repositories/system-health-repository";
import { getAllQueueMetrics } from "@/lib/services/queue-service";
import { getHubConfig } from "@/lib/config";
import {
  buildTutorialCredentialRows,
  type CredentialKind,
  type TutorialCredentialRow,
} from "@/lib/tutorial/credentials";
import { DriveArchiveCard } from "@/components/settings/sections/drive-archive-card";
import { formatTimestamp } from "@/components/system-health/status-visuals";
import { HealthTests } from "./_components/health-tests";

/**
 * System Health — a lean, self-contained status page for THIS tutorial tool.
 *
 * No provider-registry, no fallback ledger, none of the Content Forge health
 * machinery. Just the four things an operator actually needs to answer "is it
 * working?": are the keys set, are the queues moving, did anything fail, and is
 * there disk + Drive to deliver to.
 */

export const dynamic = "force-dynamic";

const GOOD = "#57d38c";
const WARN = "#e6b34a";
const BAD = "#e0605e";
const HINT = "rgba(205,195,215,0.5)";

function fmtBytes(n: number | null): string {
  if (n === null) return "—";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function readDisk(): Promise<{
  ok: boolean;
  totalBytes?: number;
  freeBytes?: number;
  usedBytes?: number;
  error?: string;
}> {
  try {
    const root = getHubConfig().LOCAL_MEDIA_ROOT;
    const s = await statfs(root);
    const total = Number(s.bsize) * Number(s.blocks);
    const free = Number(s.bsize) * Number(s.bavail);
    return { ok: true, totalBytes: total, freeBytes: free, usedBytes: total - free };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "statfs failed" };
  }
}

const KIND_LABELS: Record<CredentialKind, string> = {
  script: "Script engine",
  tts: "Voice / TTS",
  images: "Thumbnail images",
  delivery: "Delivery (Drive)",
  alerts: "Alerts (Telegram)",
};
const KIND_ORDER: CredentialKind[] = ["script", "tts", "images", "delivery", "alerts"];

export default async function SystemHealthPage() {
  const session = await getSession();
  if (!hasPermission(session, "view:system-health")) {
    redirect("/dashboard");
  }

  const [failedJobs, failedJobCounts, queueMetrics, credentials, disk] =
    await Promise.all([
      getFailedJobs().catch(() => []),
      getFailedJobCountsByStatus().catch(() => ({}) as Record<string, number>),
      getAllQueueMetrics().catch(() => []),
      buildTutorialCredentialRows().catch(() => [] as TutorialCredentialRow[]),
      readDisk(),
    ]);

  const totalFailedJobs = Object.values(failedJobCounts).reduce(
    (sum, c) => sum + c,
    0,
  );
  const totalQueueDepth = queueMetrics.reduce(
    (sum, q) => sum + q.waiting + q.active,
    0,
  );
  const top10Failed = failedJobs.slice(0, 10);
  const activeQueues = queueMetrics
    .filter((m) => m.waiting + m.active + m.failed > 0)
    .sort((a, b) => b.waiting + b.active - (a.waiting + a.active));

  // A key is "ready" when present anywhere (secrets store or .env).
  const credsByKind = KIND_ORDER.map((kind) => ({
    kind,
    rows: credentials.filter((c) => c.kind === kind),
  })).filter((g) => g.rows.length > 0);

  const diskPct =
    disk.ok && disk.totalBytes
      ? Math.min(100, ((disk.usedBytes ?? 0) / disk.totalBytes) * 100)
      : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#e5e2e1", margin: 0 }}>
            System Health
          </h1>
          <p style={{ fontSize: 12, color: "#cdc3d7", margin: "4px 0 0" }}>
            Keys, queues, failures and delivery — everything you need to know it
            is working.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Pill label={`${totalQueueDepth} in queues`} tone={totalQueueDepth > 0 ? "accent" : "good"} />
          <Pill label={`${totalFailedJobs} failed`} tone={totalFailedJobs > 0 ? "bad" : "good"} />
        </div>
      </div>

      {/* 1. Keys */}
      <Section
        title="Are the keys set?"
        subtitle="Green = a key is present (in the secrets store or .env). Set missing keys in Settings → Credentials."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {credsByKind.length === 0 && (
            <GlassCard style={{ padding: 16 }}>
              <p style={{ fontSize: 12, color: HINT, margin: 0 }}>
                Could not read credential status.
              </p>
            </GlassCard>
          )}
          {credsByKind.map((group) => (
            <div key={group.kind}>
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#cdc3d7",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  margin: "0 0 8px",
                }}
              >
                {KIND_LABELS[group.kind]}
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: 8,
                }}
              >
                {group.rows.map((row) => {
                  const ready = row.source !== "none";
                  // Providers this deployment does not use never read as red.
                  // They render muted with a gray dot and a "not needed" chip,
                  // so an operator does not mistake them for a broken key.
                  const notNeeded = row.notNeeded && !ready;
                  return (
                    <div
                      key={row.providerKey}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 12px",
                        borderRadius: 8,
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(75,68,85,0.3)",
                        opacity: notNeeded ? 0.45 : 1,
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: notNeeded ? HINT : ready ? GOOD : BAD,
                          flexShrink: 0,
                          boxShadow: ready ? `0 0 6px ${GOOD}66` : "none",
                        }}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#e5e2e1",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.displayName}
                        </div>
                        <div style={{ fontSize: 10, color: HINT }}>
                          {notNeeded
                            ? "Not used by this deployment"
                            : ready
                              ? row.source === "db"
                                ? "Secrets store"
                                : ".env"
                              : "Missing"}
                        </div>
                      </div>
                      {notNeeded && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            color: HINT,
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(75,68,85,0.4)",
                            padding: "2px 7px",
                            borderRadius: 999,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          not needed
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <a
            href="/settings"
            style={{ fontSize: 11, color: "var(--v2-accent)", textDecoration: "none" }}
          >
            Manage credentials →
          </a>
        </div>
      </Section>

      {/* 2. Run live tests */}
      <Section
        title="Do they actually work?"
        subtitle="Fire a real, cheap health check at each dependency and see pass/fail + latency. A present key can still be revoked, rate-limited or dead — only a live call proves it."
      >
        <HealthTests />
      </Section>

      {/* 3. Queues */}
      <Section title="Is the plumbing moving?" subtitle="Live queue depth across the pipeline.">
        <GlassCard style={{ padding: 16 }}>
          {activeQueues.length === 0 ? (
            <p style={{ fontSize: 12, color: HINT, margin: 0 }}>
              All queues are empty and none are carrying failures.
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 12,
              }}
            >
              {activeQueues.map((m) => (
                <div
                  key={m.name}
                  style={{
                    padding: "10px 12px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: 8,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: "#cdc3d7",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {m.name.replace(/^queue-/, "")}
                  </span>
                  <span style={{ fontSize: 20, fontWeight: 900, color: "#e5e2e1" }}>
                    {m.waiting + m.active}
                  </span>
                  <span style={{ fontSize: 9, color: HINT }}>
                    {m.waiting} waiting · {m.active} active
                    {m.failed > 0 && (
                      <span style={{ color: WARN }}> · {m.failed} failed</span>
                    )}
                    {m.paused && <span style={{ color: WARN }}> · PAUSED</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </Section>

      {/* 3. Failures */}
      <Section title="Did anything fail?" subtitle="The most recent jobs in a FAILED_* state.">
        <GlassCard style={{ overflow: "hidden" }}>
          {top10Failed.length === 0 ? (
            <div style={{ padding: "24px 20px", color: HINT, fontSize: 12 }}>
              No jobs are in a FAILED_* state.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {top10Failed.map((job, i) => (
                <div
                  key={job.id}
                  style={{
                    padding: "12px 20px",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 16,
                    borderBottom:
                      i < top10Failed.length - 1
                        ? "1px solid rgba(75,68,85,0.12)"
                        : "none",
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: "#ffb4ab",
                      background: "rgba(255,180,171,0.08)",
                      border: "1px solid rgba(255,180,171,0.2)",
                      padding: "3px 8px",
                      borderRadius: 4,
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {job.status}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 3,
                      }}
                    >
                      <span
                        style={{ fontSize: 11, color: "#e5e2e1", fontFamily: "monospace" }}
                      >
                        {job.id.slice(0, 8)}…
                      </span>
                      {job.channel?.name && (
                        <span style={{ fontSize: 10, color: "#cdc3d7" }}>
                          {job.channel.name}
                        </span>
                      )}
                    </div>
                    {job.error_message && (
                      <p
                        style={{
                          fontSize: 11,
                          color: "rgba(255,180,171,0.7)",
                          margin: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {job.error_message}
                      </p>
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: 9,
                      color: "rgba(205,195,215,0.4)",
                      fontFamily: "monospace",
                      flexShrink: 0,
                    }}
                  >
                    {formatTimestamp(job.updated_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </Section>

      {/* 4. Storage + Delivery */}
      <Section title="Room to deliver?" subtitle="Local disk for renders, and the Google Drive archive.">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 16,
            alignItems: "start",
          }}
        >
          <GlassCard style={{ padding: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                color: "#e5e2e1",
                marginBottom: 6,
              }}
            >
              <span>Local media disk</span>
              {disk.ok ? (
                <span style={{ color: HINT }}>
                  {fmtBytes(disk.usedBytes ?? 0)} / {fmtBytes(disk.totalBytes ?? 0)}
                </span>
              ) : (
                <span style={{ color: BAD }}>unavailable</span>
              )}
            </div>
            {disk.ok ? (
              <>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: "rgba(255,255,255,0.06)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${diskPct}%`,
                      height: "100%",
                      background: diskPct > 90 ? BAD : diskPct > 75 ? WARN : GOOD,
                    }}
                  />
                </div>
                <p style={{ fontSize: 11, color: HINT, margin: "6px 0 0" }}>
                  {fmtBytes(disk.freeBytes ?? 0)} free
                </p>
              </>
            ) : (
              <p style={{ fontSize: 11, color: HINT, margin: 0 }}>{disk.error}</p>
            )}
          </GlassCard>

          <DriveArchiveCard />
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p style={{ fontSize: 13, fontWeight: 800, color: "#e5e2e1", margin: "0 0 3px 0" }}>
        {title}
      </p>
      <p style={{ fontSize: 11, color: HINT, margin: "0 0 14px 0", lineHeight: 1.6 }}>
        {subtitle}
      </p>
      {children}
    </div>
  );
}

function Pill({
  label,
  tone,
}: {
  label: string;
  tone: "good" | "bad" | "accent";
}) {
  const colors = {
    good: { fg: "#23decb", bg: "rgba(35,222,203,0.1)", bd: "rgba(35,222,203,0.25)" },
    bad: { fg: "#ffb4ab", bg: "rgba(255,180,171,0.1)", bd: "rgba(255,180,171,0.3)" },
    accent: {
      fg: "var(--v2-accent)",
      bg: "rgba(var(--v2-accent-rgb), 0.1)",
      bd: "rgba(var(--v2-accent-rgb), 0.25)",
    },
  }[tone];
  return (
    <div
      style={{
        padding: "6px 14px",
        background: colors.bg,
        border: `1px solid ${colors.bd}`,
        borderRadius: 20,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: colors.fg,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
    </div>
  );
}
