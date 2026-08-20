import Link from "next/link";
import { GlassCard } from "../../_components/glass-card";

/**
 * Templates Tab (V2)
 *
 * Shows all templates for this format with V2 inline styling.
 * Templates are the primary focus - formats are just containers.
 */

interface TemplatesTabProps {
  format: string;
  formatSlug: string;
  templates: Array<{
    id: string;
    name: string;
    description: string | null;
    pipeline_stages: string[];
    render_config: Record<string, any>;
    is_active: boolean;
    job_count: number;
  }>;
}

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

export function TemplatesTab({
  format,
  formatSlug,
  templates,
}: TemplatesTabProps) {
  const activeTemplates = templates.filter((t) => t.is_active);
  const inactiveTemplates = templates.filter((t) => !t.is_active);
  const sortedTemplates = [...activeTemplates, ...inactiveTemplates];

  if (templates.length === 0) {
    return (
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
        <h3
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#e5e2e1",
            margin: 0,
            marginBottom: 8,
          }}
        >
          No Templates Yet
        </h3>
        <p
          style={{
            fontSize: 12,
            color: "rgba(205,195,215,0.5)",
            margin: 0,
            marginBottom: 24,
          }}
        >
          This format doesn&apos;t have any templates configured yet.
        </p>
      </GlassCard>
    );
  }

  return (
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
          <GlassCard
            key={template.id}
            style={{
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              opacity: template.is_active ? 1 : 0.5,
              position: "relative",
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
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
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
                  style={{ fontSize: 18, fontWeight: 700, color: "#e5e2e1" }}
                >
                  {stageCount}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
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
                  style={{ fontSize: 18, fontWeight: 700, color: "#e5e2e1" }}
                >
                  {template.job_count}
                </span>
              </div>
            </div>

            {/* Footer: engine badge + use button */}
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

              {template.is_active && (
                <Link
                  href={`/formats/${formatSlug}?template=${template.id}`}
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--v2-accent)",
                    textDecoration: "none",
                    padding: "6px 12px",
                    background: "rgba(var(--v2-accent-rgb), 0.1)",
                    border: "1px solid rgba(var(--v2-accent-rgb), 0.25)",
                    borderRadius: 6,
                    transition: "all 0.2s",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  Use Template
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 14 }}
                  >
                    arrow_forward
                  </span>
                </Link>
              )}
            </div>
          </GlassCard>
        );
      })}
    </div>
  );
}
