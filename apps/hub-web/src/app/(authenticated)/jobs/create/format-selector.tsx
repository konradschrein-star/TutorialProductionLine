"use client";

import { useRouter } from "next/navigation";
import type { FormatInfo } from "@/app/actions/formats";

interface Template {
  id: string;
  name: string;
  format: string;
  description: string | null;
  is_active: boolean;
}

interface FormatSelectorProps {
  templates: Template[];
  availableFormats: FormatInfo[];
}

export function FormatSelector({
  templates,
  availableFormats,
}: FormatSelectorProps) {
  const router = useRouter();

  // Group templates by format
  const formatMap = new Map<string, Template[]>();
  for (const template of templates) {
    if (!formatMap.has(template.format)) {
      formatMap.set(template.format, []);
    }
    formatMap.get(template.format)!.push(template);
  }

  function handleFormatClick(formatId: string) {
    const slug = formatId.toLowerCase().replace(/_/g, "-");
    router.push(`/jobs/create/${slug}`);
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: "#e5e2e1",
            margin: "0 0 8px 0",
            letterSpacing: "-0.02em",
          }}
        >
          Create New Jobs
        </h1>
        <p style={{ fontSize: 13, color: "rgba(205,195,215,0.6)", margin: 0 }}>
          Select a content format to begin creating jobs
        </p>
      </div>

      {/* Format Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 20,
        }}
      >
        {availableFormats.map((formatInfo) => {
          const formatTemplates = formatMap.get(formatInfo.id) ?? [];
          const hasTemplates = formatTemplates.length > 0;

          return (
            <button
              key={formatInfo.id}
              onClick={() => {
                if (hasTemplates) handleFormatClick(formatInfo.id);
              }}
              disabled={!hasTemplates}
              style={{
                padding: 24,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                borderRadius: 16,
                textAlign: "left",
                cursor: hasTemplates ? "pointer" : "not-allowed",
                opacity: hasTemplates ? 1 : 0.4,
                transition: "all 0.2s ease",
                position: "relative",
                overflow: "hidden",
              }}
              onMouseEnter={(e) => {
                if (hasTemplates) {
                  e.currentTarget.style.background =
                    "rgba(var(--v2-accent-rgb), 0.1)";
                  e.currentTarget.style.borderColor =
                    "rgba(var(--v2-accent-rgb), 0.4)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                e.currentTarget.style.borderColor =
                  "rgba(var(--v2-accent-rgb), 0.15)";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              {/* Icon */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 64,
                  height: 64,
                  borderRadius: 12,
                  background: hasTemplates
                    ? "rgba(var(--v2-accent-rgb), 0.15)"
                    : "rgba(255,255,255,0.05)",
                  marginBottom: 16,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 32,
                    color: hasTemplates
                      ? "var(--v2-accent)"
                      : "rgba(205,195,215,0.3)",
                  }}
                >
                  {formatInfo.icon}
                </span>
              </div>

              {/* Title */}
              <h3
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#e5e2e1",
                  margin: "0 0 8px 0",
                }}
              >
                {formatInfo.name}
              </h3>

              {/* Description */}
              <p
                style={{
                  fontSize: 12,
                  color: "rgba(205,195,215,0.6)",
                  margin: "0 0 12px 0",
                  lineHeight: 1.5,
                  minHeight: 40,
                }}
              >
                {formatInfo.description}
              </p>

              {/* Template Count */}
              {hasTemplates ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    color: "var(--v2-accent)",
                    fontWeight: 600,
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                  >
                    arrow_forward
                  </span>
                  {formatTemplates.length} template
                  {formatTemplates.length !== 1 ? "s" : ""} available
                </div>
              ) : (
                <div
                  style={{
                    padding: "6px 12px",
                    background: "rgba(255,180,0,0.1)",
                    border: "1px solid rgba(255,180,0,0.2)",
                    borderRadius: 6,
                    fontSize: 10,
                    color: "#ffb400",
                    fontWeight: 600,
                    display: "inline-block",
                  }}
                >
                  No templates
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
