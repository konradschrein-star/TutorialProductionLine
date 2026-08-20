import { redirect } from "next/navigation";
import { getSession } from "../_lib/v2-auth";
import { GlassCard } from "../_components/glass-card";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import {
  getFailedJobs,
  getFailedJobCountsByStatus,
} from "@/lib/repositories/system-health-repository";
import { getAllQueueMetrics } from "@/lib/services/queue-service";
import {
  loadSnapshot,
  recentFallbacks,
  setRegistryDb,
  syncCatalog,
  usageRollup,
  type UsageEventRow,
} from "@repo/provider-registry";
import { buildRegistryView, type RegistryView } from "./_lib/registry-view";
import { loadProductionOutcomes } from "./_lib/production-outcomes";
import { ProviderBoard } from "@/components/system-health/provider-board";
import { FallbackFeed } from "@/components/system-health/fallback-feed";
import { OutcomeHeadline } from "@/components/system-health/outcome-headline";
import { formatTimestamp } from "@/components/system-health/status-visuals";

/**
 * System Health.
 *
 * Reading order is the point:
 *   1. Did the work come out?           (production outcomes)
 *   2. Did we get what we asked for?    (substitutions / fallbacks)
 *   3. What do we have and does it work? (provider board + chains)
 *   4. Is the plumbing moving?           (queues, failed jobs)
 *
 * Provider reachability comes third because it is the least informative of
 * the four — everything can be green while nothing works.
 */

export const dynamic = "force-dynamic";

interface RegistryLoad {
  migrated: boolean;
  error: string | null;
  view: RegistryView | null;
  fallbacks: UsageEventRow[];
  anyUsageRecorded: boolean;
}

async function loadRegistry(): Promise<RegistryLoad> {
  const empty: RegistryLoad = {
    migrated: false,
    error: null,
    view: null,
    fallbacks: [],
    anyUsageRecorded: false,
  };
  try {
    setRegistryDb(db);
    await syncCatalog();
    const [snapshot, rollup, fallbacks] = await Promise.all([
      loadSnapshot(),
      usageRollup(24),
      recentFallbacks(25),
    ]);
    return {
      migrated: true,
      error: null,
      view: buildRegistryView(snapshot, rollup),
      fallbacks,
      anyUsageRecorded: rollup.length > 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missingTables =
      /relation "provider/i.test(message) ||
      (err as { code?: string } | null)?.code === "42P01";
    return {
      ...empty,
      error: missingTables
        ? "Provider registry tables are not present yet. Apply migrations 0038 + 0043–0045 — run `pnpm --filter @repo/db exec tsx src/run-migration-system-health.ts` against the real Content Forge DB (docker pg :5432), then reload."
        : `Provider registry unavailable: ${message}`,
    };
  }
}

export default async function V2SystemHealthPage() {
  const session = await getSession();

  if (!hasPermission(session, "view:system-health")) {
    redirect("/dashboard");
  }

  const [failedJobs, failedJobCounts, queueMetrics, registry, outcomes] =
    await Promise.all([
      getFailedJobs(),
      getFailedJobCountsByStatus(),
      getAllQueueMetrics(),
      loadRegistry(),
      loadProductionOutcomes(),
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
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
          <h1
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#e5e2e1",
              margin: 0,
              marginBottom: 4,
            }}
          >
            System Health
          </h1>
          <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
            What we have, whether it works, and who actually served each
            request.
          </p>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <Pill
            label={`${totalQueueDepth} in queues`}
            tone={totalQueueDepth > 0 ? "accent" : "good"}
          />
          <Pill
            label={`${totalFailedJobs} failed jobs`}
            tone={totalFailedJobs > 0 ? "bad" : "good"}
          />
        </div>
      </div>

      {/* 1. Outcomes */}
      <Section
        title="Did the work come out?"
        subtitle="Real production results. This is the signal a provider ping cannot give you."
      >
        <OutcomeHeadline signals={outcomes} />
      </Section>

      {/* 2. Substitutions */}
      <Section
        title="Did we get what we asked for?"
        subtitle="Silent substitution is the failure mode that shipped bad thumbnails for weeks. It is not silent any more."
      >
        <FallbackFeed
          events={registry.fallbacks.map((e) => ({
            id: e.id,
            capability: e.capability,
            consumer: e.consumer,
            requestedProvider: e.requestedProvider,
            servedProvider: e.servedProvider,
            fallbackDepth: e.fallbackDepth,
            outcome: e.outcome,
            context: e.context ?? null,
            jobId: e.jobId ?? null,
            createdAt: e.createdAt,
          }))}
          anyUsageRecorded={registry.anyUsageRecorded}
        />
      </Section>

      {/* 3. Providers */}
      <Section
        title="What do we have?"
        subtitle="Every external service this codebase can call, its credentials, plan, cost and capacity — and the chains that decide who gets asked first."
      >
        {registry.error && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "14px 18px",
              marginBottom: 16,
              background: "rgba(245,194,107,0.08)",
              border: "1px solid rgba(245,194,107,0.3)",
              borderRadius: 12,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 20, color: "#f5c26b", flexShrink: 0 }}
            >
              build
            </span>
            <div>
              <p
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#f5c26b",
                  margin: 0,
                }}
              >
                Registry not initialised
              </p>
              <p
                style={{
                  fontSize: 11,
                  color: "#cdc3d7",
                  margin: "4px 0 0 0",
                  lineHeight: 1.6,
                }}
              >
                {registry.error} Until then this section shows nothing rather
                than guessing.
              </p>
            </div>
          </div>
        )}
        {registry.view && (
          <ProviderBoard
            providers={registry.view.providers}
            chains={registry.view.chains}
            consumerPriorities={registry.view.consumerPriorities}
            migrated={registry.migrated}
          />
        )}
      </Section>

      {/* 4. Plumbing */}
      <Section
        title="Is the plumbing moving?"
        subtitle="Queue depth and recent job failures."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <GlassCard style={{ padding: 16 }}>
            {activeQueues.length === 0 ? (
              <p
                style={{
                  fontSize: 12,
                  color: "rgba(205,195,215,0.5)",
                  margin: 0,
                }}
              >
                All queues are empty and none are carrying failures.
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
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
                    <span
                      style={{
                        fontSize: 20,
                        fontWeight: 900,
                        color: "#e5e2e1",
                      }}
                    >
                      {m.waiting + m.active}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        color: "rgba(205,195,215,0.5)",
                      }}
                    >
                      {m.waiting} waiting · {m.active} active
                      {m.failed > 0 && (
                        <span style={{ color: "#f97316" }}>
                          {" "}
                          · {m.failed} failed
                        </span>
                      )}
                      {m.paused && (
                        <span style={{ color: "#f97316" }}> · PAUSED</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          <GlassCard style={{ overflow: "hidden" }}>
            <div
              style={{
                padding: "14px 20px",
                borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
                background: "#131313",
              }}
            >
              <h3
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#e5e2e1",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  margin: 0,
                }}
              >
                Recent failed jobs
              </h3>
            </div>
            {top10Failed.length === 0 ? (
              <div
                style={{
                  padding: "24px 20px",
                  color: "rgba(205,195,215,0.45)",
                  fontSize: 12,
                }}
              >
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
                          style={{
                            fontSize: 11,
                            color: "#e5e2e1",
                            fontFamily: "monospace",
                          }}
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
      <p
        style={{
          fontSize: 13,
          fontWeight: 800,
          color: "#e5e2e1",
          margin: "0 0 3px 0",
        }}
      >
        {title}
      </p>
      <p
        style={{
          fontSize: 11,
          color: "rgba(205,195,215,0.5)",
          margin: "0 0 16px 0",
          lineHeight: 1.6,
        }}
      >
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
    good: {
      fg: "#23decb",
      bg: "rgba(35,222,203,0.1)",
      bd: "rgba(35,222,203,0.25)",
    },
    bad: {
      fg: "#ffb4ab",
      bg: "rgba(255,180,171,0.1)",
      bd: "rgba(255,180,171,0.3)",
    },
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
