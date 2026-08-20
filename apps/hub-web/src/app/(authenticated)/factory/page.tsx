import Link from "next/link";
import { desc, eq, inArray, not, sql } from "drizzle-orm";
import { GlassCard } from "../_components/glass-card";
import { FactoryKanbanClient } from "./_components/factory-kanban-client";
import { db, contentJobs, channels } from "@/lib/db";
import {
  FactoryBoard,
  type FactoryCard,
} from "@/components/jobs/factory-board";
import { summarizeJobArtifacts } from "../jobs/_lib/job-list-artifacts";
import { stageFor } from "../jobs/_lib/job-stage";

/**
 * Production Board (formerly "Dark Factory").
 *
 * The original board fetched the Hermes Control Plane daemon (127.0.0.1:8650) —
 * a separate, retired system whose job ids are not content-job ids, which is why
 * nothing on it was clickable and why it never told you anything about your
 * actual production. Every trace of that dependency is gone (Konrad's decision
 * C7 + B3): no HCP probe, no Hermes strip.
 *
 * This board is `content_jobs`, grouped by pipeline lane — a LIVE STAGE VIEW.
 * For the filterable table with history use /jobs. Terminal states are hidden
 * here on purpose; the count of hidden rows is shown so nothing is silently
 * omitted.
 */

export const dynamic = "force-dynamic";

/** Terminal states we do not want cluttering the live board. */
const HIDDEN = ["DELETED", "CANCELLED", "MARKED_FOR_DELETION"] as const;

async function loadBoardJobs() {
  try {
    return await db
      .select({
        id: contentJobs.id,
        title: contentJobs.title,
        status: contentJobs.status,
        format: contentJobs.format,
        channelId: contentJobs.channel_id,
        channelName: channels.name,
        statusUpdatedAt: contentJobs.status_updated_at,
        errorMessage: contentJobs.error_message,
      })
      .from(contentJobs)
      .leftJoin(channels, eq(contentJobs.channel_id, channels.id))
      .where(not(inArray(contentJobs.status, [...HIDDEN] as never[])))
      .orderBy(desc(contentJobs.status_updated_at))
      .limit(150);
  } catch {
    return [];
  }
}

/** How many jobs the board is deliberately not showing (terminal states). */
async function countHiddenJobs(): Promise<number | null> {
  try {
    const [row] = await db
      .select({ n: sql<number>`cast(count(*) as integer)` })
      .from(contentJobs)
      .where(inArray(contentJobs.status, [...HIDDEN] as never[]));
    return row?.n ?? 0;
  } catch {
    // Unknown, not zero — never fabricate a count.
    return null;
  }
}

export default async function ProductionBoardPage() {
  const [rows, hiddenCount] = await Promise.all([
    loadBoardJobs(),
    countHiddenJobs(),
  ]);

  const artefacts = await summarizeJobArtifacts(
    rows.map((r) => ({ id: r.id, channel_id: r.channelId })),
  );

  const cards: FactoryCard[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    format: r.format,
    channelName: r.channelName ?? null,
    statusUpdatedAt: new Date(r.statusUpdatedAt).toISOString(),
    errorMessage: r.errorMessage,
    hasVideo: artefacts.get(r.id)?.hasVideo ?? false,
    thumbnailId: artefacts.get(r.id)?.thumbnailId ?? null,
  }));

  const needsYou = cards.filter(
    (c) => stageFor(c.status).group === "needs-human",
  ).length;
  const failed = cards.filter(
    (c) => stageFor(c.status).group === "failed",
  ).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Auto-refresh every 15s */}
      <FactoryKanbanClient />

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
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
            }}
          >
            Production Board
          </h1>
          <p
            style={{
              fontSize: 12,
              color: "rgba(205,195,215,0.6)",
              margin: "4px 0 0 0",
            }}
          >
            {cards.length} live job{cards.length === 1 ? "" : "s"} on the floor
            {needsYou > 0 ? ` · ${needsYou} waiting on you` : ""}
            {failed > 0 ? ` · ${failed} failed` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/jobs?status=needs-human" className="v2-btn">
            Needs you
          </Link>
          <Link href="/jobs/create" className="v2-btn-accent">
            + New Job
          </Link>
        </div>
      </div>

      {/* The board */}
      <GlassCard style={{ padding: 18 }}>
        {cards.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              padding: "40px 20px",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 28, color: "rgba(205,195,215,0.45)" }}
            >
              conveyor_belt
            </span>
            <p style={{ fontSize: 13, color: "#cdc3d7", margin: 0 }}>
              No active jobs. Everything is either finished or nothing has been
              created yet.
            </p>
            <Link href="/jobs/create" className="v2-btn-accent">
              Create a job
            </Link>
          </div>
        ) : (
          <FactoryBoard cards={cards} />
        )}
      </GlassCard>

      {/* Honest footer: the board is a live view, not the whole picture. Never
          silently omit rows — say how many terminal jobs are not shown, and
          send the operator to /jobs for the full filterable history. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          padding: "10px 4px",
        }}
      >
        <span style={{ fontSize: 11, color: "rgba(205,195,215,0.55)" }}>
          {hiddenCount == null
            ? "Could not count terminal jobs (database unavailable)."
            : hiddenCount === 0
              ? "No jobs are hidden — every job is shown above."
              : `${hiddenCount} job${hiddenCount === 1 ? "" : "s"} hidden (deleted, cancelled or marked for deletion).`}
        </span>
        <Link
          href="/jobs"
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--v2-accent)",
            textDecoration: "none",
          }}
        >
          Full job list &amp; history →
        </Link>
      </div>
    </div>
  );
}
