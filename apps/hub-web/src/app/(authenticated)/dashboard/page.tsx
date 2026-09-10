import Link from "next/link";
import { GlassCard } from "../_components/glass-card";
import { getJobStatusCounts } from "@/lib/repositories/dashboard-repository";
import { getAllQueueMetrics } from "@/lib/services/queue-service";
import {
  getActiveStageCounts,
  getAwaitingHuman,
  getCreatedSince,
  getLastSuccessfulRender,
  getPublishedSince,
  getRecentCompletions,
  getRecentFailures,
  getReconciliationSummary,
  getStuckJobs,
  type DashboardJobRow,
} from "./_lib/dashboard-queries";
import { STATUS_GROUPS, shortDuration, stageFor } from "./_lib/job-stage";

/**
 * Dashboard — operational intel for an operator opening the tab at 7am.
 *
 * Answers, in order: what needs me, what broke overnight, what is stuck, what
 * finished, and how deep are the queues. Every card links to the filtered view
 * that lets you act on it.
 *
 * Hard rule: if a number cannot be sourced from real data it is not shown. The
 * previous version rendered a hardcoded 75% bar, a "2 of 4 lit" segment
 * indicator, a queue gauge divided by an invented constant of 200, and a
 * dead-letter bar of count × 5 — all removed rather than given a fake
 * denominator. It also showed the failed count twice under two different names.
 */

export const dynamic = "force-dynamic";

const TEXT_1 = "#e5e2e1";
const TEXT_2 = "#cdc3d7";
const TEXT_3 = "rgba(205,195,215,0.45)";

function Icon({
  name,
  size = 16,
  color,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  return (
    <span
      className="material-symbols-outlined"
      style={{ fontSize: size, color, lineHeight: 1, flexShrink: 0 }}
    >
      {name}
    </span>
  );
}

function sumOf(counts: Map<string, number>, statuses: readonly string[]) {
  let n = 0;
  for (const s of statuses) n += counts.get(s) ?? 0;
  return n;
}

function SectionHeading({
  icon,
  title,
  hint,
  href,
  linkLabel,
}: {
  icon: string;
  title: string;
  hint?: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name={icon} size={16} color="var(--v2-accent)" />
        <h2
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--v2-accent)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            margin: 0,
          }}
        >
          {title}
        </h2>
        {hint && <span style={{ fontSize: 11, color: TEXT_3 }}>{hint}</span>}
      </div>
      {href && (
        <Link
          href={href}
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--v2-accent)",
            textDecoration: "none",
          }}
        >
          {linkLabel ?? "View all"} →
        </Link>
      )}
    </div>
  );
}

/** Headline tile. Always links somewhere actionable. */
function KpiTile({
  label,
  value,
  hint,
  href,
  color,
}: {
  label: string;
  value: number;
  hint: string;
  href: string;
  color: string;
}) {
  return (
    <Link href={href} style={{ textDecoration: "none", display: "block" }}>
      <GlassCard
        style={{
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          border:
            value > 0
              ? `1px solid ${color}44`
              : "1px solid rgba(255,255,255,0.09)",
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: TEXT_2,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 32,
            fontWeight: 900,
            lineHeight: 1,
            color: value > 0 ? color : TEXT_1,
          }}
        >
          {value}
        </span>
        <span style={{ fontSize: 10, color: TEXT_3 }}>{hint}</span>
      </GlassCard>
    </Link>
  );
}

/** A compact job row used by the attention lists. */
function JobLine({
  job,
  showError,
}: {
  job: DashboardJobRow;
  showError?: boolean;
}) {
  const stage = stageFor(job.status);
  const waited = shortDuration(job.statusUpdatedAt);
  return (
    <Link
      href="/tutorial-studio"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 7,
        textDecoration: "none",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(var(--v2-accent-rgb), 0.07)",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: stage.color,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12,
          fontWeight: 600,
          color: TEXT_1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={job.title}
      >
        {job.title}
      </span>
      {showError && job.errorMessage && (
        <span
          style={{
            fontSize: 10,
            color: "#ffb4ab",
            maxWidth: 240,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={job.errorMessage}
        >
          {job.errorMessage}
        </span>
      )}
      <span style={{ fontSize: 10, color: TEXT_3, whiteSpace: "nowrap" }}>
        {stage.label}
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: TEXT_2,
          whiteSpace: "nowrap",
          minWidth: 34,
          textAlign: "right",
        }}
        title="Time in this stage"
      >
        {waited ?? "—"}
      </span>
    </Link>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "14px 10px",
        borderRadius: 7,
        background: "rgba(255,255,255,0.02)",
        border: "1px dashed rgba(var(--v2-accent-rgb), 0.12)",
      }}
    >
      <Icon name="check_circle" size={15} color={TEXT_3} />
      <span style={{ fontSize: 12, color: TEXT_2 }}>{text}</span>
    </div>
  );
}

async function LegacyContentDashboard() {
  // Queue metrics hit Redis, which may be down. Track that honestly rather than
  // rendering zeros that look like an idle-but-healthy system.
  const queueMetrics = await getAllQueueMetrics().catch(() => null);

  const [
    statusRows,
    stuck,
    failures,
    awaitingHuman,
    completions,
    activeStages,
    created24h,
    published24h,
    lastRender,
    reconciliation,
  ] = await Promise.all([
    // G2: getJobStatusCounts has no internal try/catch, unlike the rest. A DB
    // blip must degrade this one card to "unavailable", not 500 the page or
    // render zeros that look like an idle-but-healthy system.
    getJobStatusCounts().catch(() => null),
    getStuckJobs(),
    getRecentFailures(24),
    getAwaitingHuman(),
    getRecentCompletions(),
    getActiveStageCounts(),
    getCreatedSince(24),
    getPublishedSince(24),
    getLastSuccessfulRender(),
    getReconciliationSummary(),
  ]);

  const countsAvailable = statusRows != null;
  const counts = new Map<string, number>(
    (statusRows ?? []).map((r) => [r.status, Number(r.count)]),
  );

  const needsHuman = sumOf(counts, STATUS_GROUPS["needs-human"]);
  const failed = sumOf(counts, STATUS_GROUPS.failed);
  const working = sumOf(counts, STATUS_GROUPS.working);
  const readyToUpload = counts.get("AWAITING_UPLOADER") ?? 0;
  const publishedCount = reconciliation.publishedCount;
  // Only meaningful when counts are available.
  const totalActive = needsHuman + failed + working + readyToUpload;

  const queueDepth = queueMetrics
    ? queueMetrics.reduce((s, m) => s + m.waiting + m.active, 0)
    : null;
  const busyQueues = (queueMetrics ?? []).filter(
    (m) => m.waiting + m.active + m.failed > 0,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: TEXT_1, margin: 0 }}>
          Dashboard
        </h1>
        <p style={{ fontSize: 12, color: TEXT_2, margin: "4px 0 0 0" }}>
          {created24h} content job{created24h === 1 ? "" : "s"} created and{" "}
          {published24h} published in the last 24 hours.{" "}
          {/* G6: is this thing working at all? A real timestamp or an honest no. */}
          {lastRender
            ? `Last render finished ${new Date(lastRender).toISOString().slice(0, 16).replace("T", " ")} UTC.`
            : "No successful render on record."}
        </p>
        {/* G7: these counts are content_jobs only — tutorials are a separate
            operation and are deliberately not surfaced here (D7). */}
        <p style={{ fontSize: 10.5, color: TEXT_3, margin: "3px 0 0 0" }}>
          Counts below are Content jobs only. Tutorial jobs are tracked
          separately in Tutorial Studio.
        </p>
      </div>

      {/* Headline KPIs — all real, all clickable. G2: when the count query
          itself fails, say so instead of rendering four zeros. */}
      {!countsAvailable ? (
        <GlassCard
          style={{
            padding: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
            border: "1px solid rgba(249,115,22,0.2)",
            background: "rgba(249,115,22,0.05)",
          }}
        >
          <Icon name="error" size={18} color="#f97316" />
          <span style={{ fontSize: 12, color: TEXT_2 }}>
            Job counts are unavailable — the database could not be reached. This
            is not the same as there being no jobs.
          </span>
        </GlassCard>
      ) : totalActive === 0 && failures.length === 0 ? (
        // G3: with only phantom/terminal rows, four zeros read as "broken".
        // Say plainly that nothing is active, and point at Storage truth.
        <GlassCard style={{ padding: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="bedtime" size={18} color={TEXT_2} />
              <span style={{ fontSize: 14, fontWeight: 800, color: TEXT_1 }}>
                No active jobs
              </span>
            </div>
            <span style={{ fontSize: 12, color: TEXT_2 }}>
              Nothing is in flight, waiting on a person, failed or ready to
              upload right now.
              {publishedCount > 0
                ? ` ${publishedCount} job${publishedCount === 1 ? "" : "s"} report PUBLISHED — see Storage truth below for whether their artefacts still exist.`
                : ""}
            </span>
          </div>
        </GlassCard>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 14,
          }}
        >
          <KpiTile
            label="Needs you"
            value={needsHuman}
            hint="blocked on a human"
            href="/tutorial-studio"
            color="#f97316"
          />
          <KpiTile
            label="Failed"
            value={failed}
            hint="need a retry or a fix"
            href="/tutorial-studio"
            color="#ffb4ab"
          />
          <KpiTile
            label="In flight"
            value={working}
            hint="pipeline is working"
            href="/tutorial-studio"
            color="#80ccff"
          />
          <KpiTile
            label="Ready to upload"
            value={readyToUpload}
            hint="rendered and approved"
            href="/tutorial-studio"
            color="#23decb"
          />
        </div>
      )}

      {/* G4: Storage truth — fed by the reconciler (migration 0048). Until it
          runs, this says "never run" rather than a clean-looking zero. */}
      <GlassCard style={{ padding: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionHeading
            icon="fact_check"
            title="Storage truth"
            hint="does the database agree with the disk?"
            href="/system-health"
            linkLabel="System Health"
          />
          {reconciliation.lastRun == null ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: 14,
                borderRadius: 8,
                background: "rgba(255,255,255,0.02)",
                border: "1px dashed rgba(var(--v2-accent-rgb), 0.15)",
              }}
            >
              <Icon name="pending" size={16} color={TEXT_3} />
              <span style={{ fontSize: 12, color: TEXT_2 }}>
                Artefact reconciliation has <strong>never run</strong>. Run{" "}
                <code style={{ fontFamily: "monospace" }}>
                  reconcile-artefacts
                </code>{" "}
                to compare the {publishedCount > 0 ? `${publishedCount} ` : ""}
                published record{publishedCount === 1 ? "" : "s"} against what
                is actually on disk.
              </span>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                gap: 24,
                flexWrap: "wrap",
                fontSize: 12,
                color: TEXT_2,
              }}
            >
              <span>
                <strong style={{ color: TEXT_1 }}>
                  {reconciliation.jobsVerified}
                </strong>{" "}
                job{reconciliation.jobsVerified === 1 ? "" : "s"} reconciled
              </span>
              <span>
                <strong
                  style={{
                    color:
                      (reconciliation.missingTotal ?? 0) > 0
                        ? "#ffb4ab"
                        : TEXT_1,
                  }}
                >
                  {reconciliation.missingTotal == null
                    ? "unknown"
                    : reconciliation.missingTotal}
                </strong>{" "}
                manifest file{reconciliation.missingTotal === 1 ? "" : "s"}{" "}
                missing
              </span>
              <span style={{ color: TEXT_3 }}>
                last run{" "}
                {new Date(reconciliation.lastRun)
                  .toISOString()
                  .slice(0, 16)
                  .replace("T", " ")}{" "}
                UTC
              </span>
            </div>
          )}
        </div>
      </GlassCard>

      {/* Two-column attention area */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* Failed overnight */}
        <GlassCard style={{ padding: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SectionHeading
              icon="error"
              title="Failed in the last 24h"
              hint={failures.length > 0 ? `${failures.length}` : undefined}
              href="/tutorial-studio"
            />
            {failures.length === 0 ? (
              <EmptyLine text="Nothing failed in the last 24 hours." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {failures.map((j) => (
                  <JobLine key={j.id} job={j} showError />
                ))}
              </div>
            )}
          </div>
        </GlassCard>

        {/* Awaiting a human */}
        <GlassCard style={{ padding: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SectionHeading
              icon="person_alert"
              title="Waiting on a human"
              hint={awaitingHuman.length > 0 ? "oldest first" : undefined}
              href="/tutorial-studio"
            />
            {awaitingHuman.length === 0 ? (
              <EmptyLine text="Nothing is blocked on a person right now." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {awaitingHuman.map((j) => (
                  <JobLine key={j.id} job={j} />
                ))}
              </div>
            )}
          </div>
        </GlassCard>

        {/* Stuck */}
        <GlassCard style={{ padding: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SectionHeading
              icon="hourglass_disabled"
              title="Stuck in an automated stage"
              hint="over 2h with no movement"
              href="/tutorial-studio"
            />
            {stuck.length === 0 ? (
              <EmptyLine text="No job has been sitting in an automated stage for over 2 hours." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {stuck.map((j) => (
                  <JobLine key={j.id} job={j} />
                ))}
              </div>
            )}
          </div>
        </GlassCard>

        {/* Recent completions */}
        <GlassCard style={{ padding: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SectionHeading
              icon="movie"
              title="Recently finished"
              hint="open one to see its video"
              href="/tutorial-studio"
            />
            {completions.length === 0 ? (
              <EmptyLine text="No completed renders yet." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {completions.map((j) => (
                  <JobLine key={j.id} job={j} />
                ))}
              </div>
            )}
          </div>
        </GlassCard>
      </div>

      {/* Pipeline distribution — real counts, no invented ordering or opacity */}
      <GlassCard style={{ padding: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <SectionHeading
            icon="account_tree"
            title="Where the work is"
            hint="every unfinished stage that has jobs in it"
            href="/tutorial-studio"
          />
          {activeStages.length === 0 ? (
            <EmptyLine text="No jobs are in progress." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(() => {
                const max = Math.max(...activeStages.map((s) => s.count));
                return activeStages.map((s) => {
                  const stage = stageFor(s.status);
                  return (
                    <Link
                      key={s.status}
                      href="/tutorial-studio"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        textDecoration: "none",
                      }}
                    >
                      <span
                        style={{
                          width: 130,
                          fontSize: 11,
                          color: TEXT_2,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                        title={stage.meaning}
                      >
                        {stage.label}
                      </span>
                      <span
                        style={{
                          flex: 1,
                          height: 6,
                          borderRadius: 3,
                          background: "rgba(255,255,255,0.05)",
                          overflow: "hidden",
                        }}
                      >
                        {/* Width is share of the busiest stage — a real ratio. */}
                        <span
                          style={{
                            display: "block",
                            height: "100%",
                            width: `${Math.round((s.count / max) * 100)}%`,
                            background: stage.color,
                            borderRadius: 3,
                          }}
                        />
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: TEXT_1,
                          minWidth: 28,
                          textAlign: "right",
                        }}
                      >
                        {s.count}
                      </span>
                    </Link>
                  );
                });
              })()}
            </div>
          )}
        </div>
      </GlassCard>

      {/* Queue depth — real BullMQ metrics, or an honest failure notice */}
      <GlassCard style={{ padding: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <SectionHeading
            icon="queue"
            title="Queue depth"
            hint={
              queueDepth != null ? `${queueDepth} waiting or active` : undefined
            }
          />
          {queueMetrics == null ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: 14,
                borderRadius: 8,
                background: "rgba(249,115,22,0.05)",
                border: "1px solid rgba(249,115,22,0.2)",
              }}
            >
              <Icon name="cloud_off" size={16} color="#f97316" />
              <span style={{ fontSize: 12, color: TEXT_2 }}>
                Redis is unreachable, so queue depth is unknown. That is not the
                same as the queues being empty.
              </span>
            </div>
          ) : busyQueues.length === 0 ? (
            <EmptyLine text="All queues are empty — nothing waiting, nothing running." />
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 10,
              }}
            >
              {busyQueues.map((q) => (
                <div
                  key={q.name}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    padding: 12,
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(var(--v2-accent-rgb), 0.08)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: TEXT_2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={q.name}
                  >
                    {q.name.replace(/^queue-/, "")}
                    {q.paused && " · paused"}
                  </span>
                  <div style={{ display: "flex", gap: 12 }}>
                    <span style={{ fontSize: 11, color: TEXT_1 }}>
                      <strong>{q.active}</strong>{" "}
                      <span style={{ color: TEXT_3 }}>active</span>
                    </span>
                    <span style={{ fontSize: 11, color: TEXT_1 }}>
                      <strong>{q.waiting}</strong>{" "}
                      <span style={{ color: TEXT_3 }}>waiting</span>
                    </span>
                    {q.failed > 0 && (
                      <span style={{ fontSize: 11, color: "#ffb4ab" }}>
                        <strong>{q.failed}</strong> failed
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}
import { redirect } from "next/navigation";

/** Standalone Studio starts with tutorial work, not unrelated content counters. */
export default function DashboardPage() {
  redirect("/tutorial-studio?tab=dashboard");
}
