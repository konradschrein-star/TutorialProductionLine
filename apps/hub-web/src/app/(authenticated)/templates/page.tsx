import Link from "next/link";
import { getSession } from "../_lib/v2-auth";
import { GlassCard } from "../_components/glass-card";
import { hasPermission } from "@/lib/auth/rbac";
import { listTemplates } from "@/lib/repositories/template-repository";

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

export default async function V2TemplatesPage() {
  const session = await getSession();

  const templates = await listTemplates();
  const canManage = hasPermission(session, "manage:templates");

  const activeCount = templates.filter((t) => t.is_active).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#e5e2e1",
              margin: 0,
              marginBottom: 4,
            }}
          >
            Templates
          </h1>
          <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
            {templates.length} template{templates.length !== 1 ? "s" : ""} total
            {activeCount < templates.length && ` · ${activeCount} active`}
          </p>
        </div>

        {/* Summary pills */}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div
            style={{
              padding: "6px 14px",
              background: "rgba(35,222,203,0.1)",
              border: "1px solid rgba(35,222,203,0.2)",
              borderRadius: 20,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#23decb",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {activeCount} Active
            </span>
          </div>
          <div
            style={{
              padding: "6px 14px",
              background: "rgba(var(--v2-accent-rgb), 0.1)",
              border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
              borderRadius: 20,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "var(--v2-accent)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {templates.length} Total
            </span>
          </div>
        </div>
      </div>

      {/* Grid */}
      {templates.length === 0 ? (
        <GlassCard className="p-12" style={{ textAlign: "center" }}>
          <p
            style={{ fontSize: 14, color: "rgba(205,195,215,0.5)", margin: 0 }}
          >
            No templates found.
          </p>
          {canManage && (
            <Link
              href="/templates/create"
              style={{
                display: "inline-block",
                marginTop: 16,
                fontSize: 12,
                color: "var(--v2-accent)",
                textDecoration: "none",
              }}
            >
              Create your first template →
            </Link>
          )}
        </GlassCard>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 20,
          }}
        >
          {templates.map((template) => {
            const renderEngine = getRenderEngine(template.render_config);
            const engineStyle = getRenderEngineBadgeStyle(renderEngine);
            const stageCount = template.pipeline_stages?.length ?? 0;

            return (
              <GlassCard
                key={template.id}
                className="p-5"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  opacity: template.is_active ? 1 : 0.6,
                  position: "relative",
                }}
              >
                {/* Inactive overlay label */}
                {!template.is_active && (
                  <div
                    style={{
                      position: "absolute",
                      top: 12,
                      right: 12,
                      fontSize: 8,
                      fontWeight: 700,
                      color: "rgba(205,195,215,0.5)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      background: "rgba(75,68,85,0.3)",
                      padding: "2px 7px",
                      borderRadius: 4,
                    }}
                  >
                    Inactive
                  </div>
                )}

                {/* Name + format badge */}
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <h3
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#e5e2e1",
                        margin: 0,
                        lineHeight: 1.3,
                      }}
                    >
                      {template.name}
                    </h3>
                  </div>

                  {/* Format badge */}
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: "var(--v2-accent)",
                      background: "rgba(var(--v2-accent-rgb), 0.12)",
                      border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                      padding: "3px 9px",
                      borderRadius: 20,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {template.format}
                  </span>
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
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {template.description}
                  </p>
                )}

                {/* Stats row */}
                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    paddingTop: 4,
                    borderTop: "1px solid rgba(75,68,85,0.2)",
                  }}
                >
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 2 }}
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
                    style={{ display: "flex", flexDirection: "column", gap: 2 }}
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

                {/* Footer: engine badge + view link */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
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
                        padding: "3px 9px",
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

                  <Link
                    href={`/templates/${template.id}`}
                    className="v2-btn-outline"
                  >
                    View →
                  </Link>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
