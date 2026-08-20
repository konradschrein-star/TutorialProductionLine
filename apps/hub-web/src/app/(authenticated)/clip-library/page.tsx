import Link from "next/link";
import { getSession } from "../_lib/v2-auth";
import { GlassCard } from "../_components/glass-card";
import { db } from "@/lib/db";
import { clipLibraries } from "@repo/db";

export const dynamic = "force-dynamic";

function formatDuration(ms: number): string {
  if (ms === 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export default async function ClipLibraryIndexPage() {
  await getSession();

  const libraries = await db
    .select()
    .from(clipLibraries)
    .orderBy(clipLibraries.created_at);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
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
            Clip Libraries
          </h1>
          <p
            style={{
              color: "rgba(205,195,215,0.6)",
              fontSize: 12,
              marginTop: 4,
              marginBottom: 0,
            }}
          >
            {libraries.length}{" "}
            {libraries.length === 1 ? "library" : "libraries"}
          </p>
        </div>
        <Link
          href="/clip-library/new"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 16px",
            borderRadius: 8,
            background: "var(--v2-accent)",
            color: "#000",
            fontSize: 11,
            fontWeight: 700,
            textDecoration: "none",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            add
          </span>
          New Library
        </Link>
      </div>

      {/* Libraries grid */}
      {libraries.length === 0 ? (
        <GlassCard style={{ padding: 48, textAlign: "center" }}>
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 48,
              color: "rgba(var(--v2-accent-rgb), 0.3)",
              display: "block",
              marginBottom: 16,
            }}
          >
            video_library
          </span>
          <p style={{ color: "#cdc3d7", fontSize: 14, margin: "0 0 4px 0" }}>
            No clip libraries yet
          </p>
          <p
            style={{ color: "rgba(205,195,215,0.4)", fontSize: 12, margin: 0 }}
          >
            Create your first library to start ingesting source videos
          </p>
        </GlassCard>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 16,
          }}
        >
          {libraries.map((lib) => (
            <Link
              key={lib.id}
              href={`/clip-library/${lib.id}`}
              style={{ textDecoration: "none" }}
            >
              <GlassCard
                style={{
                  padding: 20,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  cursor: "pointer",
                  transition: "border-color 0.15s",
                  border: "1px solid rgba(var(--v2-accent-rgb), 0.12)",
                }}
              >
                {/* Top row: name + status */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <h2
                      style={{
                        color: "#e5e2e1",
                        fontSize: 15,
                        fontWeight: 700,
                        margin: "0 0 4px 0",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {lib.name}
                    </h2>
                    <p
                      style={{
                        color: "rgba(205,195,215,0.5)",
                        fontSize: 11,
                        margin: 0,
                        fontFamily: "monospace",
                      }}
                    >
                      {lib.slug}
                    </p>
                  </div>
                  <span
                    style={{
                      flexShrink: 0,
                      padding: "3px 8px",
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      background: lib.is_active
                        ? "rgba(var(--v2-accent-rgb), 0.15)"
                        : "rgba(255,255,255,0.06)",
                      color: lib.is_active
                        ? "var(--v2-accent)"
                        : "rgba(205,195,215,0.4)",
                      border: lib.is_active
                        ? "1px solid rgba(var(--v2-accent-rgb), 0.3)"
                        : "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    {lib.is_active ? "Active" : "Inactive"}
                  </span>
                </div>

                {/* Stats row */}
                <div style={{ display: "flex", gap: 16 }}>
                  {/* Clip count */}
                  <div>
                    <p
                      style={{
                        color: "rgba(205,195,215,0.4)",
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        margin: "0 0 2px 0",
                      }}
                    >
                      Clips
                    </p>
                    <p
                      style={{
                        color: "#e5e2e1",
                        fontSize: 20,
                        fontWeight: 800,
                        margin: 0,
                        lineHeight: 1,
                      }}
                    >
                      {lib.clip_count.toLocaleString()}
                    </p>
                  </div>

                  {/* Duration */}
                  <div>
                    <p
                      style={{
                        color: "rgba(205,195,215,0.4)",
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        margin: "0 0 2px 0",
                      }}
                    >
                      Duration
                    </p>
                    <p
                      style={{
                        color: "#e5e2e1",
                        fontSize: 20,
                        fontWeight: 800,
                        margin: 0,
                        lineHeight: 1,
                      }}
                    >
                      {formatDuration(lib.total_duration_ms)}
                    </p>
                  </div>

                  {/* Storage strategy */}
                  <div>
                    <p
                      style={{
                        color: "rgba(205,195,215,0.4)",
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        margin: "0 0 2px 0",
                      }}
                    >
                      Strategy
                    </p>
                    <p
                      style={{
                        color: "#cdc3d7",
                        fontSize: 12,
                        fontWeight: 600,
                        margin: 0,
                        lineHeight: 1.4,
                        textTransform: "capitalize",
                      }}
                    >
                      {lib.clip_storage_strategy}
                    </p>
                  </div>
                </div>

                {/* Footer */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    paddingTop: 12,
                    borderTop: "1px solid rgba(var(--v2-accent-rgb), 0.08)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--v2-accent)",
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    View library
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 14 }}
                    >
                      arrow_forward
                    </span>
                  </span>
                </div>
              </GlassCard>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
