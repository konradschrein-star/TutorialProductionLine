"use server";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "../../_lib/v2-auth";
import { GlassCard } from "../../_components/glass-card";
import { hasPermission } from "@/lib/auth/rbac";
import {
  getFormatTemplates,
  getJobCountsByFormat,
} from "@/lib/repositories/format-repository";
import {
  formatSlugToEnum,
  formatDisplayName,
} from "@/components/formats/format-card";
import { db, channels, formatStyleLibraries } from "@/lib/db";
import { eq } from "drizzle-orm";

// Material Symbols icons per format
const FORMAT_ICONS: Record<string, string> = {
  EXPLAINER: "menu_book",
  DOCUMENTARY: "movie",
  TECH_COMPARISON: "monitor",
  VIDEO_ESSAY: "edit_note",
  CASUALLY_EXPLAINED: "draw",
};

const FORMAT_ACCENT: Record<string, string> = {
  EXPLAINER: "#60a5fa",
  DOCUMENTARY: "#34d399",
  TECH_COMPARISON: "#23decb",
  VIDEO_ESSAY: "#904efb",
  CASUALLY_EXPLAINED: "var(--v2-accent)",
};

function getRenderEngine(renderConfig: Record<string, any>): string | null {
  if (!renderConfig) return null;
  const engine =
    renderConfig.engine ?? renderConfig.renderer ?? renderConfig.render_engine;
  if (!engine) return null;
  return String(engine).toUpperCase();
}

function getRenderEngineBadgeStyle(engine: string | null) {
  if (engine === "REMOTION") {
    return {
      color: "var(--v2-accent)",
      bg: "rgba(var(--v2-accent-rgb), 0.12)",
      border: "rgba(var(--v2-accent-rgb), 0.25)",
    };
  }
  if (engine === "FFMPEG") {
    return {
      color: "#23decb",
      bg: "rgba(35,222,203,0.12)",
      border: "rgba(35,222,203,0.25)",
    };
  }
  return {
    color: "#cdc3d7",
    bg: "rgba(205,195,215,0.08)",
    border: "rgba(205,195,215,0.15)",
  };
}

interface FormatDetailPageProps {
  params: Promise<{ format: string }>;
}

export default async function V2FormatDetailPage({
  params,
}: FormatDetailPageProps) {
  const { format: formatSlugParam } = await params;

  const session = await getSession();
  if (!hasPermission(session, "view:formats")) {
    redirect("/formats");
  }

  const formatEnum = formatSlugToEnum(formatSlugParam);
  if (!formatEnum) notFound();

  const [templates, allFormatStats, channelList, styleCollectionsList] =
    await Promise.all([
      getFormatTemplates(formatEnum),
      getJobCountsByFormat(),
      db.select().from(channels),
      db
        .select()
        .from(formatStyleLibraries)
        .where(eq(formatStyleLibraries.format, formatEnum)),
    ]);

  const formatStats = allFormatStats.find((s) => s.format === formatEnum);
  const activeTemplates = templates.filter((t) => t.is_active);
  const inactiveTemplates = templates.filter((t) => !t.is_active);
  const sortedTemplates = [...activeTemplates, ...inactiveTemplates];

  const name = formatDisplayName(formatEnum);
  const icon = FORMAT_ICONS[formatEnum] ?? "play_circle";
  const accent = FORMAT_ACCENT[formatEnum] ?? "var(--v2-accent)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Back */}
      <Link
        href="/formats"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: "rgba(205,195,215,0.5)",
          textDecoration: "none",
          width: "fit-content",
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          arrow_back
        </span>
        All Formats
      </Link>

      {/* Header with Create Job button */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: `color-mix(in srgb, ${accent} 15%, transparent)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 28, color: accent }}
            >
              {icon}
            </span>
          </div>
          <div>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: "#e5e2e1",
                margin: 0,
                marginBottom: 6,
              }}
            >
              {name}
            </h1>
            <p
              style={{
                fontSize: 12,
                color: "rgba(205,195,215,0.5)",
                margin: 0,
              }}
            >
              {activeTemplates.length} active template
              {activeTemplates.length !== 1 ? "s" : ""}
              {" · "}
              {formatStats?.total_jobs ?? 0} total jobs
              {formatStats?.active_jobs
                ? ` · ${formatStats.active_jobs} active`
                : ""}
            </p>
          </div>
        </div>

        {/* Create Job Button */}
        {activeTemplates.length > 0 && (
          <Link
            href={`/jobs/create/${formatSlugParam}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 20px",
              background: "var(--v2-accent)",
              color: "#0a0a0a",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              textDecoration: "none",
              transition: "all 0.2s",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              add
            </span>
            Create Job
          </Link>
        )}
      </div>

      {/* Templates Section */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#e5e2e1",
              margin: 0,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Templates
          </h2>
          <span style={{ fontSize: 11, color: "rgba(205,195,215,0.5)" }}>
            {templates.length} total
          </span>
        </div>

        {templates.length === 0 ? (
          <GlassCard style={{ padding: 48, textAlign: "center" }}>
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 48,
                color: "rgba(205,195,215,0.3)",
                marginBottom: 16,
                display: "block",
              }}
            >
              note_stack
            </span>
            <p
              style={{
                fontSize: 13,
                color: "rgba(205,195,215,0.5)",
                margin: 0,
              }}
            >
              No templates configured for this format yet
            </p>
          </GlassCard>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 20,
            }}
          >
            {sortedTemplates.map((template) => {
              const renderEngine = getRenderEngine(template.render_config);
              const engineStyle = getRenderEngineBadgeStyle(renderEngine);
              const stageCount = template.pipeline_stages?.length ?? 0;

              return (
                <Link
                  key={template.id}
                  href={`/templates/${template.id}`}
                  style={{ textDecoration: "none", display: "block" }}
                >
                  <GlassCard
                    className="v2-card-hover"
                    style={{
                      padding: 20,
                      display: "flex",
                      flexDirection: "column",
                      gap: 16,
                      opacity: template.is_active ? 1 : 0.5,
                      position: "relative",
                      height: "100%",
                      cursor: "pointer",
                    }}
                  >
                    {/* Inactive badge */}
                    {!template.is_active && (
                      <div
                        style={{
                          position: "absolute",
                          top: 14,
                          right: 14,
                          fontSize: 8,
                          fontWeight: 700,
                          color: "rgba(205,195,215,0.5)",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          background: "rgba(75,68,85,0.3)",
                          padding: "3px 8px",
                          borderRadius: 4,
                        }}
                      >
                        Inactive
                      </div>
                    )}

                    {/* Template name */}
                    <div>
                      <h3
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: "#e5e2e1",
                          margin: 0,
                          marginBottom: 12,
                          lineHeight: 1.3,
                        }}
                      >
                        {template.name}
                      </h3>
                    </div>

                    {/* Description */}
                    {template.description && (
                      <p
                        style={{
                          fontSize: 11,
                          color: "rgba(205,195,215,0.6)",
                          margin: 0,
                          lineHeight: 1.5,
                          display: "-webkit-box",
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          minHeight: 48,
                        }}
                      >
                        {template.description}
                      </p>
                    )}

                    {/* Stats */}
                    <div
                      style={{
                        display: "flex",
                        gap: 20,
                        paddingTop: 12,
                        borderTop: "1px solid rgba(75,68,85,0.2)",
                        marginTop: "auto",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 9,
                            color: "#cdc3d7",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Stages
                        </span>
                        <span
                          style={{
                            fontSize: 18,
                            fontWeight: 700,
                            color: "#e5e2e1",
                          }}
                        >
                          {stageCount}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 9,
                            color: "#cdc3d7",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Jobs
                        </span>
                        <span
                          style={{
                            fontSize: 18,
                            fontWeight: 700,
                            color: "#e5e2e1",
                          }}
                        >
                          {template.job_count}
                        </span>
                      </div>
                    </div>

                    {/* Footer: engine badge */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      {renderEngine ? (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            color: engineStyle.color,
                            background: engineStyle.bg,
                            border: `1px solid ${engineStyle.border}`,
                            padding: "4px 10px",
                            borderRadius: 4,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {renderEngine}
                        </span>
                      ) : (
                        <span />
                      )}

                      <span
                        style={{
                          fontSize: 10,
                          color: "var(--v2-accent)",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        Edit
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
              );
            })}
          </div>
        )}
      </div>

      {/* Channels Section */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#e5e2e1",
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Channels
        </h2>

        <GlassCard style={{ padding: 20 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {channelList.map((channel) => (
              <Link
                key={channel.id}
                href={`/channels/${channel.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 14px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#e5e2e1",
                  textDecoration: "none",
                  transition: "all 0.2s",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16, color: "var(--v2-accent)" }}
                >
                  campaign
                </span>
                {channel.name}
              </Link>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* Style Libraries Section */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#e5e2e1",
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Style Libraries
        </h2>

        <GlassCard style={{ padding: 20 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {styleCollectionsList.map((collection) => (
              <Link
                key={collection.id}
                href={`/style-library/${collection.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 14px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#e5e2e1",
                  textDecoration: "none",
                  transition: "all 0.2s",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16, color: "var(--v2-accent)" }}
                >
                  palette
                </span>
                {collection.name}
              </Link>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
