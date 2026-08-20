import { notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../_lib/v2-auth";
import { GlassCard } from "../../_components/glass-card";
import { db } from "@/lib/db";
import { clipLibraries, sourceVideos } from "@repo/db";
import { eq } from "drizzle-orm";
import { AddSourceVideoForm } from "./_components/add-source-video-form";
import { DeleteSourceVideoButton } from "./_components/delete-source-video-button";

export const dynamic = "force-dynamic";

function formatDuration(ms: number | null): string {
  if (!ms) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const STATUS_COLORS: Record<
  string,
  { bg: string; text: string; border: string }
> = {
  pending: {
    bg: "rgba(255,200,0,0.12)",
    text: "#ffc800",
    border: "rgba(255,200,0,0.3)",
  },
  downloading: {
    bg: "rgba(var(--v2-accent-rgb),0.12)",
    text: "var(--v2-accent)",
    border: "rgba(var(--v2-accent-rgb),0.3)",
  },
  download_failed: {
    bg: "rgba(255,80,80,0.12)",
    text: "#ff5050",
    border: "rgba(255,80,80,0.3)",
  },
  processing: {
    bg: "rgba(var(--v2-accent-rgb),0.12)",
    text: "var(--v2-accent)",
    border: "rgba(var(--v2-accent-rgb),0.3)",
  },
  processing_failed: {
    bg: "rgba(255,80,80,0.12)",
    text: "#ff5050",
    border: "rgba(255,80,80,0.3)",
  },
  labeling: {
    bg: "rgba(var(--v2-accent-rgb),0.12)",
    text: "var(--v2-accent)",
    border: "rgba(var(--v2-accent-rgb),0.3)",
  },
  labeling_failed: {
    bg: "rgba(255,80,80,0.12)",
    text: "#ff5050",
    border: "rgba(255,80,80,0.3)",
  },
  embedding: {
    bg: "rgba(var(--v2-accent-rgb),0.12)",
    text: "var(--v2-accent)",
    border: "rgba(var(--v2-accent-rgb),0.3)",
  },
  embedding_failed: {
    bg: "rgba(255,80,80,0.12)",
    text: "#ff5050",
    border: "rgba(255,80,80,0.3)",
  },
  ready: {
    bg: "rgba(0,220,130,0.12)",
    text: "#00dc82",
    border: "rgba(0,220,130,0.3)",
  },
  archived: {
    bg: "rgba(255,255,255,0.06)",
    text: "rgba(205,195,215,0.4)",
    border: "rgba(255,255,255,0.08)",
  },
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.pending;
  return (
    <span
      style={{
        padding: "3px 8px",
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        background: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

interface Props {
  params: Promise<{ libraryId: string }>;
}

export default async function ClipLibraryDetailPage({ params }: Props) {
  await getSession();
  const { libraryId } = await params;

  const [library] = await db
    .select()
    .from(clipLibraries)
    .where(eq(clipLibraries.id, libraryId))
    .limit(1);

  if (!library) notFound();

  const videos = await db
    .select()
    .from(sourceVideos)
    .where(eq(sourceVideos.library_id, libraryId))
    .orderBy(sourceVideos.created_at);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link
          href="/clip-library"
          style={{
            color: "rgba(205,195,215,0.5)",
            fontSize: 12,
            textDecoration: "none",
            fontWeight: 500,
          }}
        >
          Clip Libraries
        </Link>
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 14, color: "rgba(205,195,215,0.3)" }}
        >
          chevron_right
        </span>
        <span style={{ color: "#e5e2e1", fontSize: 12, fontWeight: 600 }}>
          {library.name}
        </span>
      </div>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 6,
            }}
          >
            <h1
              style={{
                color: "#e5e2e1",
                fontSize: 20,
                fontWeight: 800,
                margin: 0,
              }}
            >
              {library.name}
            </h1>
            <span
              style={{
                padding: "3px 8px",
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                background: library.is_active
                  ? "rgba(var(--v2-accent-rgb),0.15)"
                  : "rgba(255,255,255,0.06)",
                color: library.is_active
                  ? "var(--v2-accent)"
                  : "rgba(205,195,215,0.4)",
                border: library.is_active
                  ? "1px solid rgba(var(--v2-accent-rgb),0.3)"
                  : "1px solid rgba(255,255,255,0.1)",
              }}
            >
              {library.is_active ? "Active" : "Inactive"}
            </span>
          </div>
          <p
            style={{ color: "rgba(205,195,215,0.5)", fontSize: 12, margin: 0 }}
          >
            {library.clip_count.toLocaleString()} clips &middot;{" "}
            {formatDuration(library.total_duration_ms)} total &middot;{" "}
            {library.clip_storage_strategy} strategy
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            {
              label: "Clips",
              href: `/clip-library/${libraryId}/clips`,
              icon: "grid_view",
            },
            {
              label: "Ingest",
              href: `/clip-library/${libraryId}/ingest`,
              icon: "download",
            },
            {
              label: "Search",
              href: `/clip-library/${libraryId}/search`,
              icon: "search",
            },
            {
              label: "Review",
              href: `/clip-library/${libraryId}/review`,
              icon: "rate_review",
              accent: true,
            },
            {
              label: "Settings",
              href: `/clip-library/${libraryId}/settings`,
              icon: "settings",
            },
          ].map((tab) => (
            <Link
              key={tab.label}
              href={tab.href}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "7px 14px",
                borderRadius: 7,
                fontSize: 11,
                fontWeight: 700,
                textDecoration: "none",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                background: tab.accent
                  ? "var(--v2-accent)"
                  : "rgba(255,255,255,0.05)",
                color: tab.accent ? "#000" : "rgba(205,195,215,0.7)",
                border: tab.accent
                  ? "none"
                  : "1px solid rgba(255,255,255,0.09)",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14 }}
              >
                {tab.icon}
              </span>
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Add video form */}
      <GlassCard style={{ padding: 20 }}>
        <h2
          style={{
            color: "#e5e2e1",
            fontSize: 13,
            fontWeight: 700,
            margin: "0 0 16px 0",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Add Source Video
        </h2>
        <AddSourceVideoForm libraryId={libraryId} />
      </GlassCard>

      {/* Source videos table */}
      <div>
        <h2
          style={{
            color: "#e5e2e1",
            fontSize: 13,
            fontWeight: 700,
            margin: "0 0 12px 0",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Source Videos ({videos.length})
        </h2>

        {videos.length === 0 ? (
          <GlassCard style={{ padding: 40, textAlign: "center" }}>
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 40,
                color: "rgba(var(--v2-accent-rgb),0.3)",
                display: "block",
                marginBottom: 12,
              }}
            >
              video_file
            </span>
            <p style={{ color: "#cdc3d7", fontSize: 13, margin: "0 0 4px 0" }}>
              No source videos yet
            </p>
            <p
              style={{
                color: "rgba(205,195,215,0.4)",
                fontSize: 12,
                margin: 0,
              }}
            >
              Add a YouTube URL or file path above to start ingesting clips
            </p>
          </GlassCard>
        ) : (
          <GlassCard>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid rgba(var(--v2-accent-rgb),0.1)",
                  }}
                >
                  {["Title", "Status", "Clips", "Duration", "Action"].map(
                    (h) => (
                      <th
                        key={h}
                        style={{
                          padding: "12px 16px",
                          textAlign: "left",
                          fontSize: 10,
                          fontWeight: 700,
                          color: "rgba(205,195,215,0.5)",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {videos.map((video, i) => (
                  <tr
                    key={video.id}
                    style={{
                      borderBottom:
                        i < videos.length - 1
                          ? "1px solid rgba(255,255,255,0.04)"
                          : undefined,
                    }}
                  >
                    {/* Title */}
                    <td style={{ padding: "14px 16px" }}>
                      <p
                        style={{
                          color: "#e5e2e1",
                          fontSize: 13,
                          fontWeight: 600,
                          margin: "0 0 2px 0",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 320,
                        }}
                      >
                        {video.title ??
                          video.source_url ??
                          video.source_file_path ??
                          video.id}
                      </p>
                      {video.source_url && (
                        <p
                          style={{
                            color: "rgba(205,195,215,0.4)",
                            fontSize: 11,
                            margin: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: 320,
                          }}
                        >
                          {video.source_url}
                        </p>
                      )}
                    </td>

                    {/* Status */}
                    <td style={{ padding: "14px 16px" }}>
                      <StatusBadge status={video.ingest_status} />
                    </td>

                    {/* Clip count */}
                    <td style={{ padding: "14px 16px" }}>
                      <span
                        style={{
                          color: "#e5e2e1",
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        {video.clip_count}
                      </span>
                    </td>

                    {/* Duration */}
                    <td style={{ padding: "14px 16px" }}>
                      <span style={{ color: "#cdc3d7", fontSize: 13 }}>
                        {formatDuration(video.duration_ms)}
                      </span>
                    </td>

                    {/* Action */}
                    <td style={{ padding: "14px 16px" }}>
                      <div
                        style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
                      >
                        {video.clip_count > 0 && (
                          <Link
                            href={`/clip-library/${libraryId}/review?source_video_id=${video.id}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              padding: "5px 10px",
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 600,
                              textDecoration: "none",
                              background: "rgba(var(--v2-accent-rgb),0.1)",
                              color: "var(--v2-accent)",
                              border:
                                "1px solid rgba(var(--v2-accent-rgb),0.2)",
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                            }}
                          >
                            <span
                              className="material-symbols-outlined"
                              style={{ fontSize: 13 }}
                            >
                              rate_review
                            </span>
                            Review
                          </Link>
                        )}
                        <DeleteSourceVideoButton
                          libraryId={libraryId}
                          videoId={video.id}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassCard>
        )}
      </div>
    </div>
  );
}
