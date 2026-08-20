import { notFound } from "next/navigation";
import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { db, jobEditLists, contentJobs } from "@/lib/db";
import { EditListSchema } from "@repo/contracts";
import { getSession } from "../../../_lib/v2-auth";
import { GlassCard } from "../../../_components/glass-card";
import { EditListClient } from "./_components/edit-list-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditListPage({ params }: Props) {
  const session = await getSession();
  if (!session) notFound();

  const { id: jobId } = await params;

  const [job] = await db
    .select({
      id: contentJobs.id,
      title: contentJobs.title,
      status: contentJobs.status,
    })
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);

  if (!job) notFound();

  const [editList] = await db
    .select()
    .from(jobEditLists)
    .where(eq(jobEditLists.job_id, jobId))
    .orderBy(desc(jobEditLists.version))
    .limit(1);

  const entries = editList
    ? (EditListSchema.safeParse(editList.entries).data ?? [])
    : [];

  const withClip = entries.filter(
    (e) => !e.is_fallback && (e.clips?.length ?? 0) > 0,
  ).length;
  const fallback = entries.filter((e) => e.is_fallback).length;
  const scores = entries
    .filter((e) => !e.is_fallback && typeof e.match_score === "number")
    .map((e) => e.match_score as number);
  const avgScore =
    scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        maxWidth: 1100,
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <Link
              href="/jobs"
              style={{
                color: "rgba(205,195,215,0.4)",
                fontSize: 12,
                textDecoration: "none",
              }}
            >
              Jobs
            </Link>
            <span style={{ color: "rgba(205,195,215,0.25)", fontSize: 12 }}>
              ›
            </span>
            <a
              href={`/jobs/${jobId}`}
              style={{
                color: "rgba(205,195,215,0.4)",
                fontSize: 12,
                textDecoration: "none",
              }}
            >
              {job.title}
            </a>
            <span style={{ color: "rgba(205,195,215,0.25)", fontSize: 12 }}>
              ›
            </span>
            <span style={{ color: "#e5e2e1", fontSize: 12 }}>Edit List</span>
          </div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#e5e2e1",
              margin: 0,
            }}
          >
            Clip Edit List
          </h1>
          <p
            style={{
              fontSize: 12,
              color: "rgba(205,195,215,0.5)",
              margin: "4px 0 0",
            }}
          >
            {job.title}
          </p>
        </div>

        {editList && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                background:
                  editList.status === "approved"
                    ? "rgba(0,220,130,0.12)"
                    : editList.status === "needs_review"
                      ? "rgba(255,200,0,0.12)"
                      : "rgba(255,255,255,0.06)",
                color:
                  editList.status === "approved"
                    ? "#00dc82"
                    : editList.status === "needs_review"
                      ? "#ffc800"
                      : "rgba(205,195,215,0.5)",
                border: `1px solid ${
                  editList.status === "approved"
                    ? "rgba(0,220,130,0.3)"
                    : editList.status === "needs_review"
                      ? "rgba(255,200,0,0.3)"
                      : "rgba(255,255,255,0.1)"
                }`,
              }}
            >
              {editList.status.replace("_", " ")}
            </span>
            <span style={{ fontSize: 11, color: "rgba(205,195,215,0.4)" }}>
              v{editList.version}
            </span>
          </div>
        )}
      </div>

      {!editList ? (
        <GlassCard style={{ padding: 32, textAlign: "center" }}>
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 40,
              color: "rgba(205,195,215,0.2)",
              display: "block",
              marginBottom: 12,
            }}
          >
            movie_edit
          </span>
          <p
            style={{ color: "rgba(205,195,215,0.4)", fontSize: 14, margin: 0 }}
          >
            No edit list yet. Run clip selection to generate one.
          </p>
        </GlassCard>
      ) : (
        <>
          {/* Summary stats */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12,
            }}
          >
            {[
              {
                label: "Total Sentences",
                value: entries.length.toString(),
                icon: "format_list_numbered",
              },
              {
                label: "Matched Clips",
                value: withClip.toString(),
                icon: "check_circle",
                color: "#00dc82",
              },
              {
                label: "Fallbacks",
                value: fallback.toString(),
                icon: "warning",
                color: fallback > 0 ? "#ffc800" : undefined,
              },
              {
                label: "Avg Match Score",
                value: `${Math.round(avgScore * 100)}%`,
                icon: "analytics",
                color:
                  avgScore > 0.6
                    ? "#00dc82"
                    : avgScore > 0.3
                      ? "#ffc800"
                      : "#ff5050",
              },
            ].map(({ label, value, icon, color }) => (
              <GlassCard key={label} style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 18, color: color ?? "var(--v2-accent)" }}
                  >
                    {icon}
                  </span>
                  <div>
                    <p
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "rgba(205,195,215,0.4)",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        margin: "0 0 2px",
                      }}
                    >
                      {label}
                    </p>
                    <p
                      style={{
                        fontSize: 20,
                        fontWeight: 800,
                        color: color ?? "#e5e2e1",
                        margin: 0,
                      }}
                    >
                      {value}
                    </p>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>

          <EditListClient
            editListId={editList.id}
            editListStatus={editList.status}
            entries={entries}
            jobId={jobId}
            jobStatus={job.status}
          />
        </>
      )}
    </div>
  );
}
