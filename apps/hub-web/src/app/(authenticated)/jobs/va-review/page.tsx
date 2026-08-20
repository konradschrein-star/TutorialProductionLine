import Link from "next/link";
import { getSession } from "../../_lib/v2-auth";
import { GlassCard } from "../../_components/glass-card";
import { getVAReviewWorklist } from "@/app/actions/jobs";
import { isDramaScopedRole } from "@/lib/auth/rbac";
import { shortDuration } from "../_lib/job-stage";
import { StartNextButton } from "./start-next-button";

export const dynamic = "force-dynamic";

/**
 * B-Roll Selection Studio worklist.
 *
 * The heaviest human gate in the pipeline (15–45 min per job, AWAITING_VA_REVIEW)
 * had no entry point at all: the only link to /jobs/[id]/va-review lived on the
 * job detail page, so a VA had to hunt each job down through the generic jobs
 * list and click into it first. This is the queue: oldest first, with block
 * progress, how long it has been waiting, and who is already on it.
 */
export default async function VAReviewWorklistPage() {
  const session = await getSession();
  const all = await getVAReviewWorklist();
  // Same scoping rule the jobs list applies: a drama-scoped operator only ever
  // sees LONG_FORM_DRAMA, even by URL.
  const jobs = isDramaScopedRole(session?.role)
    ? all.filter((j) => j.format === "LONG_FORM_DRAMA")
    : all;

  const free = jobs.filter((j) => !j.claimedByOther);
  const mine = jobs.filter((j) => j.mine);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
              color: "#e5e2e1",
              fontSize: 20,
              fontWeight: 800,
              margin: 0,
            }}
          >
            B-Roll Selection Studio
          </h1>
          <p
            style={{
              color: "rgba(205,195,215,0.6)",
              fontSize: 12,
              marginTop: 4,
              marginBottom: 0,
            }}
          >
            {jobs.length} job{jobs.length === 1 ? "" : "s"} waiting ·{" "}
            {free.length} free to take
            {mine.length > 0 ? ` · ${mine.length} already yours` : ""}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/jobs?status=needs-human" className="v2-btn">
            All human gates
          </Link>
          <StartNextButton disabled={free.length === 0} />
        </div>
      </div>

      {/* Worklist */}
      <GlassCard style={{ padding: 4 }}>
        {jobs.length === 0 ? (
          <div
            style={{
              padding: "56px 16px",
              textAlign: "center",
              color: "rgba(205,195,215,0.45)",
              fontSize: 13,
            }}
          >
            Nothing waiting for a B-roll pick right now.
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
            }}
          >
            <thead>
              <tr>
                {["Topic", "Blocks left", "Waiting", "State", ""].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "rgba(205,195,215,0.45)",
                      borderBottom: "1px solid rgba(255,255,255,0.07)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const waited = shortDuration(job.waitingSince);
                return (
                  <tr
                    key={job.id}
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                      opacity: job.claimedByOther ? 0.55 : 1,
                    }}
                  >
                    <td style={{ padding: "12px 12px", minWidth: 0 }}>
                      <div
                        style={{
                          color: "#e5e2e1",
                          fontWeight: 700,
                          marginBottom: 2,
                        }}
                      >
                        {job.topic}
                      </div>
                      <div
                        style={{
                          fontFamily: "monospace",
                          fontSize: 10,
                          color: "rgba(205,195,215,0.35)",
                        }}
                      >
                        {job.format} · {job.id}
                      </div>
                    </td>
                    <td style={{ padding: "12px 12px", whiteSpace: "nowrap" }}>
                      <span
                        style={{
                          color:
                            job.blocksPending > 0
                              ? "var(--v2-accent)"
                              : "#23decb",
                          fontWeight: 800,
                        }}
                      >
                        {job.blocksPending}
                      </span>
                      <span style={{ color: "rgba(205,195,215,0.4)" }}>
                        {" / "}
                        {job.blocksTotal}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "12px 12px",
                        whiteSpace: "nowrap",
                        color: "rgba(205,195,215,0.6)",
                      }}
                    >
                      {waited ?? "—"}
                    </td>
                    <td style={{ padding: "12px 12px", whiteSpace: "nowrap" }}>
                      {job.claimedByOther ? (
                        <span style={{ color: "#f97316", fontWeight: 700 }}>
                          taken by another VA
                        </span>
                      ) : job.mine ? (
                        <span
                          style={{ color: "var(--v2-accent)", fontWeight: 700 }}
                        >
                          yours
                        </span>
                      ) : (
                        <span style={{ color: "rgba(205,195,215,0.5)" }}>
                          free
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "12px 12px",
                        textAlign: "right",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <Link
                        href={`/jobs/${job.id}/va-review`}
                        className="v2-btn"
                        style={{ textDecoration: "none" }}
                      >
                        Open studio
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </GlassCard>
    </div>
  );
}
