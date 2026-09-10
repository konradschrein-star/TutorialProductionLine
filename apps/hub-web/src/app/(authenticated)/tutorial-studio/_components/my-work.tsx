"use client";

import Link from "next/link";
import type { TutorialJob } from "@repo/db";
import { V2Card } from "../../_components";

function nextAction(job: TutorialJob) {
  if (job.va_review_status === "rework_requested") return { label: "Record again", tab: "studio" };
  if (job.status === "READY_TO_RECORD") return { label: "Start recording", tab: "studio" };
  if (job.status.startsWith("FAILED")) return { label: "Resolve failure", tab: "studio" };
  if (job.status === "COMPLETED") return job.va_review_status === "approved"
    ? { label: "View tutorial", tab: "library" }
    : { label: "Review tutorial", tab: "review" };
  return { label: "View progress", tab: "studio" };
}

export function MyWork({ jobs }: { jobs: TutorialJob[] }) {
  const active = jobs.filter((job) => job.status !== "CANCELLED" && !job.is_uploaded);
  const failures = active.filter((job) => job.status.startsWith("FAILED") || job.va_review_status === "rework_requested");
  const steps = [
    { label: "Ready to record", count: active.filter((job) => job.status === "READY_TO_RECORD").length, tab: "studio" },
    { label: "Processing", count: active.filter((job) => ["QUEUED", "GENERATING_SCRIPT", "GENERATING_AUDIO", "AWAITING_UPLOAD", "SPLICING"].includes(job.status)).length, tab: "studio" },
    { label: "Awaiting final review", count: active.filter((job) => job.status === "COMPLETED" && !job.va_review_status).length, tab: "review" },
    { label: "Approved", count: active.filter((job) => job.status === "COMPLETED" && job.va_review_status === "approved").length, tab: "library" },
  ];
  return <div style={{ display: "grid", gap: 20 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div><h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Your queue at a glance</h2>
        <p style={{ color: "var(--v2-text-3)", fontSize: 12, margin: "6px 0 0" }}>Latest {jobs.length} loaded originals. Use All tutorials for the full history.</p></div>
      <Link className="v2-btn-accent" href="/tutorial-studio?tab=keywords">Choose a software batch</Link>
    </div>
    <div className="studio-queue-summary">
      {steps.map((step) => <Link key={step.label} href={`/tutorial-studio?tab=${step.tab}`}>
        <span className="studio-queue-count">{step.count}</span><span>{step.label}</span>
      </Link>)}
    </div>
    {failures.length > 0 && <V2Card style={{ padding: 20, borderColor: "var(--v2-warning)" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>{failures.length} tutorial{failures.length === 1 ? " needs" : "s need"} attention</h3>
      <p style={{ margin: 0, color: "var(--v2-text-2)", fontSize: 14 }}>These items need a retry or a new recording. Other tutorials can continue.</p>
      {failures.map((job) => <div key={job.id} style={{ marginTop: 12 }}><Link href={`/tutorial-studio?tab=studio&jobId=${job.id}`} style={{ color: "var(--v2-accent)" }}>{job.title}</Link><div style={{ fontSize: 14, marginTop: 4 }}>{job.error_message || "Open the recording queue for recovery options."}</div></div>)}
    </V2Card>}
    <V2Card style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 16 }}><h3 style={{ fontSize: 16, margin: 0 }}>Continue working</h3><Link href="/tutorial-studio?tab=library" style={{ fontSize: 13, color: "var(--v2-accent)" }}>All tutorials →</Link></div>
      {active.length === 0 ? <p style={{ color: "var(--v2-text-2)", fontSize: 16 }}>Choose a software batch or prepare a manual topic to begin.</p> :
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead><tr>{["Tutorial", "Stage", "Next action"].map((label) => <th key={label} style={{ textAlign: "left", padding: "10px 12px", color: "var(--v2-text-2)", fontWeight: 500 }}>{label}</th>)}</tr></thead>
          <tbody>{active.slice(0, 6).map((job) => { const action = nextAction(job); return <tr key={job.id} style={{ borderTop: "1px solid var(--v2-border-1)" }}>
            <td style={{ padding: 12 }}>{job.title}</td><td style={{ padding: 12, color: "var(--v2-text-2)" }}>{job.va_review_status === "rework_requested" ? "Rework requested" : job.status.toLowerCase().replaceAll("_", " ")}</td>
            <td style={{ padding: 12 }}><Link href={`/tutorial-studio?tab=${action.tab}${["studio", "review"].includes(action.tab) ? `&jobId=${job.id}` : ""}`} style={{ color: "var(--v2-accent)", whiteSpace: "nowrap" }}>{action.label} →</Link></td>
          </tr>; })}</tbody>
        </table></div>}
    </V2Card>
  </div>;
}
