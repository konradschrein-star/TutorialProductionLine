import { Suspense } from "react";
import Link from "next/link";
import { getSession } from "../_lib/v2-auth";
import { listJobs } from "@/lib/repositories/job-repository";
import { getJobStatusCounts } from "@/lib/repositories/dashboard-repository";
import { GlassCard } from "../_components/glass-card";
import { SearchInput } from "./_components/search-input";
import { isDramaScopedRole } from "@/lib/auth/rbac";
import { getAvailableFormats } from "@/app/actions/formats";
import {
  JobsSignalTable,
  type JobsSignalRow,
} from "@/components/jobs/jobs-signal-table";
import { summarizeJobArtifacts } from "./_lib/job-list-artifacts";
import { STATUS_GROUPS, resolveStatusFilter } from "./_lib/job-stage";

/**
 * Jobs list.
 *
 * Rebuilt to answer "what is going on" rather than just listing rows: an
 * attention strip of real counts that each link to the filtered view, and a
 * dense table showing stage, time-in-stage, what is blocking, what the job has
 * actually produced, and the actions available right now.
 *
 * The Upload Queue page was folded in here: `?status=upload-queue` is the queue,
 * with the same awaiting/uploading/published/failed counts it used to show.
 */

interface StatusTab {
  label: string;
  value: string;
}

const STATUS_TABS: StatusTab[] = [
  { label: "All", value: "" },
  { label: "Needs human", value: "needs-human" },
  { label: "Working", value: "working" },
  { label: "Rendering", value: "rendering" },
  { label: "Upload queue", value: "upload-queue" },
  { label: "Failed", value: "failed" },
];

interface V2JobsPageProps {
  searchParams: Promise<{
    status?: string;
    page?: string;
    search?: string;
    format?: string;
    /** Set by the HITL gates when they hand a VA back to the list. */
    approved?: string;
  }>;
}

function sumOf(
  counts: Map<string, number>,
  statuses: readonly string[],
): number {
  let total = 0;
  for (const s of statuses) total += counts.get(s) ?? 0;
  return total;
}

/** One tile of the attention strip. Always a link to something actionable. */
function AttentionTile({
  label,
  value,
  hint,
  href,
  color,
  active,
}: {
  label: string;
  value: number;
  hint: string;
  href: string;
  color: string;
  active: boolean;
}) {
  return (
    <Link href={href} style={{ textDecoration: "none", display: "block" }}>
      <GlassCard
        style={{
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          border: active
            ? `1px solid ${color}`
            : value > 0
              ? `1px solid ${color}44`
              : "1px solid rgba(255,255,255,0.09)",
          background: active ? `${color}14` : undefined,
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: "#cdc3d7",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 26,
            fontWeight: 900,
            lineHeight: 1,
            color: value > 0 ? color : "#e5e2e1",
          }}
        >
          {value}
        </span>
        <span style={{ fontSize: 10, color: "rgba(205,195,215,0.45)" }}>
          {hint}
        </span>
      </GlassCard>
    </Link>
  );
}

export default async function V2JobsPage({ searchParams }: V2JobsPageProps) {
  const session = await getSession();

  const params = await searchParams;
  const currentStatus = params.status ?? "";
  const currentPage = Math.max(1, parseInt(params.page ?? "1", 10));
  const search = params.search;
  // Drama-scoped operator ignores any ?format= override and is always
  // pinned to LONG_FORM_DRAMA — even if they type the URL by hand.
  const dramaScoped = isDramaScopedRole(session?.role);
  const currentFormat = dramaScoped ? "LONG_FORM_DRAMA" : (params.format ?? "");

  const statusFilter = resolveStatusFilter(currentStatus);

  // Format filter tabs derived from the live registry (auto-includes RANKING
  // and any future format). Drama-scoped operators only ever see drama.
  const availableFormats = await getAvailableFormats();
  const formatFilterTabs = (
    dramaScoped
      ? availableFormats.filter((f) => f.id === "LONG_FORM_DRAMA")
      : availableFormats
  ).map((f) => ({ label: f.name, value: f.id }));

  const [result, statusCountRows] = await Promise.all([
    listJobs(
      {
        status: statusFilter,
        search: search,
        format: currentFormat || undefined,
      },
      currentPage,
      25,
    ),
    getJobStatusCounts(),
  ]);

  const counts = new Map<string, number>(
    statusCountRows.map((r) => [r.status, Number(r.count)]),
  );

  // Verified on disk — never inferred from status.
  const artefacts = await summarizeJobArtifacts(
    result.jobs.map((j) => ({ id: j.id, channel_id: j.channel_id })),
  );

  const rows: JobsSignalRow[] = result.jobs.map((job) => {
    const summary = artefacts.get(job.id);
    // status_updated_at is a real column; the repository's Job type predates it.
    const statusUpdatedAt =
      (job as unknown as { status_updated_at?: Date | string })
        .status_updated_at ?? job.updated_at;
    return {
      id: job.id,
      title: job.title,
      status: job.status,
      format: job.format,
      channelName: job.channel?.name ?? null,
      statusUpdatedAt: new Date(statusUpdatedAt).toISOString(),
      updatedAt: new Date(job.updated_at).toISOString(),
      errorMessage: job.error_message,
      retryCount: job.retry_count ?? 0,
      assigneeName: job.assigned_production_va?.name ?? null,
      youtubeVideoId: job.youtube_video_id,
      hasVideo: summary?.hasVideo ?? false,
      thumbnailId: summary?.thumbnailId ?? null,
      failureCount: (job.state_machine_history ?? []).filter((h) =>
        h.to_status?.startsWith("FAILED_"),
      ).length,
    };
  });

  const isUploadQueue = currentStatus === "upload-queue";

  function hrefFor(status: string): string {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (currentFormat) p.set("format", currentFormat);
    if (search) p.set("search", search);
    const qs = p.toString();
    return qs ? `/jobs?${qs}` : "/jobs";
  }

  const justApproved = params.approved === "1";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Landed here from a HITL gate that ran out of work — say so, rather
          than showing what looks like an arbitrary filtered list. */}
      {justApproved && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 12,
            color: "#23decb",
            background: "rgba(35,222,203,0.08)",
            border: "1px solid rgba(35,222,203,0.25)",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            check_circle
          </span>
          Approved — that queue is clear. Here is everything still waiting on a
          human.
        </div>
      )}

      {/* Page header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              color: "#e5e2e1",
              fontSize: 20,
              fontWeight: 800,
              margin: 0,
            }}
          >
            Jobs
          </h1>
          <p
            style={{
              color: "rgba(205,195,215,0.6)",
              fontSize: 12,
              marginTop: 4,
              marginBottom: 0,
            }}
          >
            {result.total.toLocaleString()}{" "}
            {currentStatus || currentFormat || search
              ? "matching this filter"
              : "total jobs"}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Suspense>
            <SearchInput defaultValue={search ?? ""} />
          </Suspense>
          <Link href="/jobs/create" className="v2-btn-accent">
            + New Job
          </Link>
        </div>
      </div>

      {/* Attention strip — every tile is a real count and a link to act on it. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
        }}
      >
        <AttentionTile
          label="Needs you"
          value={sumOf(counts, STATUS_GROUPS["needs-human"])}
          hint="blocked on a human"
          href={hrefFor("needs-human")}
          color="#f97316"
          active={currentStatus === "needs-human"}
        />
        {/* The B-Roll Selection Studio queue — the heaviest human gate, and
            until now the only one with no entry point anywhere in the app. */}
        <AttentionTile
          label="B-roll picks"
          value={counts.get("AWAITING_VA_REVIEW") ?? 0}
          hint="open the studio worklist"
          href="/jobs/va-review"
          color="#f97316"
          active={false}
        />
        <AttentionTile
          label="Failed"
          value={sumOf(counts, STATUS_GROUPS.failed)}
          hint="need a retry or a fix"
          href={hrefFor("failed")}
          color="#ffb4ab"
          active={currentStatus === "failed"}
        />
        <AttentionTile
          label="In flight"
          value={sumOf(counts, STATUS_GROUPS.working)}
          hint="pipeline is working"
          href={hrefFor("working")}
          color="#80ccff"
          active={currentStatus === "working"}
        />
        <AttentionTile
          label="Ready to upload"
          value={counts.get("AWAITING_UPLOADER") ?? 0}
          hint="rendered and approved"
          href={hrefFor("upload-queue")}
          color="#23decb"
          active={isUploadQueue}
        />
        <AttentionTile
          label="Published"
          value={counts.get("PUBLISHED") ?? 0}
          hint="live on YouTube"
          href={hrefFor("PUBLISHED")}
          color="#23decb"
          active={currentStatus === "PUBLISHED"}
        />
      </div>

      {/* Upload-queue sub-summary — the numbers the old Upload Queue page had. */}
      {isUploadQueue && (
        <GlassCard style={{ padding: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16, color: "var(--v2-accent)" }}
              >
                upload
              </span>
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
                Upload queue
              </h2>
              <span style={{ fontSize: 11, color: "rgba(205,195,215,0.45)" }}>
                download the render, publish it, then record the video id on the
                job
              </span>
            </div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {(
                [
                  ["Awaiting uploader", "AWAITING_UPLOADER", "#f97316"],
                  ["Uploading", "UPLOADING", "var(--v2-accent)"],
                  ["Published", "PUBLISHED", "#23decb"],
                  ["Failed upload", "FAILED_UPLOAD", "#ffb4ab"],
                ] as const
              ).map(([label, status, color]) => (
                <Link
                  key={status}
                  href={hrefFor(status)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    textDecoration: "none",
                  }}
                >
                  <span
                    style={{
                      fontSize: 20,
                      fontWeight: 800,
                      color,
                      lineHeight: 1,
                    }}
                  >
                    {counts.get(status) ?? 0}
                  </span>
                  <span
                    style={{ fontSize: 10, color: "rgba(205,195,215,0.5)" }}
                  >
                    {label}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </GlassCard>
      )}

      {/* Status filter tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {STATUS_TABS.map((tab) => {
          const isActive = currentStatus === tab.value;
          return (
            <Link
              key={tab.value}
              href={hrefFor(tab.value)}
              className={`v2-tab${isActive ? " v2-tab-active" : ""}`}
              style={{
                padding: "6px 16px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                textDecoration: "none",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                background: isActive
                  ? "rgba(var(--v2-accent-rgb), 0.1)"
                  : "var(--v2-surface-2)",
                border: isActive
                  ? "1px solid rgba(var(--v2-accent-rgb), 0.3)"
                  : "1px solid var(--v2-border-1)",
                color: isActive ? "var(--v2-accent)" : "var(--v2-text-2)",
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {/* Format filter — derived from the live format registry so it stays in
          sync with the formats we actually have (no hardcoded list to go stale). */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: -8 }}>
        {[{ label: "All Formats", value: "" }, ...formatFilterTabs].map((f) => {
          const isActive = currentFormat === f.value;
          const linkParams = new URLSearchParams();
          if (currentStatus) linkParams.set("status", currentStatus);
          if (f.value) linkParams.set("format", f.value);
          if (search) linkParams.set("search", search);
          return (
            <Link
              key={f.value}
              href={`/jobs?${linkParams.toString()}`}
              style={{
                padding: "4px 12px",
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 700,
                textDecoration: "none",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                background: isActive
                  ? "rgba(var(--v2-accent-rgb), 0.1)"
                  : "rgba(255,255,255,0.03)",
                border: isActive
                  ? "1px solid rgba(var(--v2-accent-rgb), 0.3)"
                  : "1px solid rgba(var(--v2-accent-rgb), 0.1)",
                color: isActive ? "var(--v2-accent)" : "rgba(205,195,215,0.5)",
              }}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {/* Jobs table */}
      <GlassCard style={{ padding: 4 }}>
        <JobsSignalTable jobs={rows} />
      </GlassCard>

      {/* Pagination */}
      {result.totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 8,
            alignItems: "center",
          }}
        >
          {currentPage > 1 && (
            <Link
              href={`/jobs?${new URLSearchParams({
                ...(currentStatus && { status: currentStatus }),
                ...(currentFormat && { format: currentFormat }),
                ...(search && { search }),
                page: String(currentPage - 1),
              }).toString()}`}
              className="v2-btn"
            >
              ← Prev
            </Link>
          )}
          <span style={{ fontSize: 11, color: "var(--v2-text-3)" }}>
            Page {currentPage} of {result.totalPages}
          </span>
          {currentPage < result.totalPages && (
            <Link
              href={`/jobs?${new URLSearchParams({
                ...(currentStatus && { status: currentStatus }),
                ...(currentFormat && { format: currentFormat }),
                ...(search && { search }),
                page: String(currentPage + 1),
              }).toString()}`}
              className="v2-btn"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
