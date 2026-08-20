import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Film } from "lucide-react";
import { getJobById } from "@/lib/repositories/job-repository";
import { TimelineEditorWrapper } from "@/components/timeline/timeline-editor-wrapper";

interface TimelinePageProps {
  params: Promise<{ id: string }>;
}

/**
 * V2 Timeline Editor Page
 *
 * Full-screen editor for the VideoTimeline edit layer of a content job.
 * The editor is a client component (TimelineEditorWrapper) — this page
 * is a server component that validates the job exists and passes the ID.
 *
 * Access:
 * - Any role with view:job-detail can view (read-only with no save button)
 * - edit:job permission required for saving mutations
 *
 * Navigation:
 * - Back arrow → /jobs/[id] (job detail)
 */
export default async function V2TimelinePage({ params }: TimelinePageProps) {
  const { id } = await params;
  const job = await getJobById(id);

  if (!job) {
    notFound();
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 64px)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "12px 16px",
          borderBottom: "1px solid var(--v2-border-1)",
          background: "var(--v2-surface-1)",
          flexShrink: 0,
        }}
      >
        <Link
          href={`/jobs/${id}`}
          className="v2-btn"
          style={{ padding: "6px 12px" }}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Film className="w-4 h-4" style={{ color: "var(--v2-accent)" }} />
          <div>
            <p
              style={{
                fontSize: 10,
                color: "var(--v2-text-3)",
                margin: "0 0 2px 0",
              }}
            >
              Timeline Editor
            </p>
            <p
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--v2-text-1)",
                margin: 0,
              }}
            >
              {job.title}
            </p>
          </div>
        </div>

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 9,
              color: "var(--v2-text-3)",
              fontFamily: "monospace",
            }}
          >
            {id.slice(0, 8)}…
          </span>
        </div>
      </div>

      {/* Editor */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <TimelineEditorWrapper jobId={id} jobTitle={job.title} />
      </div>
    </div>
  );
}
