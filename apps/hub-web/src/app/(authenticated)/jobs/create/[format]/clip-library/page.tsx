import { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GlassCard } from "../../../../_components/glass-card";
import { listClipLibraries } from "@repo/db/repositories";

export const metadata: Metadata = {
  title: "Clip Libraries",
};

interface PageProps {
  params: Promise<{ format: string }>;
}

export default async function ClipLibrariesListPage({ params }: PageProps) {
  const { format } = await params;
  if (format !== "long-form-drama") {
    redirect(`/jobs/create/${format}`);
  }
  const libs = await listClipLibraries();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 24,
        maxWidth: 1100,
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Link
          href={`/jobs/create/${format}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            color: "#cdc3d7",
            fontSize: 12,
            textDecoration: "none",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            arrow_back
          </span>
          Back to create
        </Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 28, color: "var(--v2-accent)" }}
        >
          movie_filter
        </span>
        <h1
          style={{ fontSize: 22, fontWeight: 700, color: "#e5e2e1", margin: 0 }}
        >
          Clip Libraries
        </h1>
      </div>
      <p style={{ fontSize: 13, color: "#cdc3d7", margin: 0 }}>
        Channel-scoped containers for pre-generated stock clips, character
        descriptions, the script-writer prompt, and music settings. Pick a
        library to inspect its clips, fire a bootstrap, or change its config.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {libs.map((l) => {
          const pctReady = l.total_count
            ? Math.round((l.ready_count / l.total_count) * 100)
            : 0;
          return (
            <Link
              key={l.id}
              href={`/jobs/create/${format}/clip-library/${l.id}`}
              style={{ textDecoration: "none" }}
            >
              <GlassCard
                style={{
                  padding: 16,
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div
                    style={{ fontSize: 14, fontWeight: 700, color: "#e5e2e1" }}
                  >
                    {l.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#cdc3d7" }}>
                    music: {l.music_mode} · {l.music_volume_db} dB
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 4,
                  }}
                >
                  <div
                    style={{ fontSize: 13, fontWeight: 700, color: "#4ade80" }}
                  >
                    {l.ready_count.toLocaleString()} ready
                  </div>
                  <div style={{ fontSize: 11, color: "#cdc3d7" }}>
                    {pctReady}% of {l.total_count}
                  </div>
                </div>
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 22, color: "#cdc3d7" }}
                >
                  chevron_right
                </span>
              </GlassCard>
            </Link>
          );
        })}
        {libs.length === 0 && (
          <GlassCard style={{ padding: 24, textAlign: "center" }}>
            <span style={{ fontSize: 14, color: "#cdc3d7" }}>
              No clip libraries yet. The default one is created automatically
              when you apply the migration.
            </span>
          </GlassCard>
        )}
      </div>
    </div>
  );
}
