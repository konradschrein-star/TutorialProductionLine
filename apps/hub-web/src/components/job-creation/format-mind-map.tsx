"use client";

import { useState, useRef, useEffect } from "react";

/**
 * Format Mind Map - NotebookLM-style hierarchical visualization
 *
 * Hierarchy:
 * - Format Categories (e.g., "Educational", "Entertainment", "News")
 * - Formats (e.g., "Explainer", "Documentary", "Political Commentary")
 * - Templates (active templates under each format)
 *
 * Clicking a template immediately opens the job creation form.
 */

interface Template {
  id: string;
  name: string;
  format: string;
  description: string | null;
  is_active: boolean;
}

interface FormatNode {
  format: string;
  displayName: string;
  description: string;
  category: string;
  templates: Template[];
}

interface CategoryNode {
  category: string;
  displayName: string;
  formats: FormatNode[];
}

interface FormatMindMapProps {
  templates: Template[];
  onTemplateSelect: (template: Template) => void;
}

// Format categorization
const FORMAT_CATEGORIES: Record<
  string,
  { category: string; displayName: string }
> = {
  EXPLAINER: { category: "educational", displayName: "Educational Content" },
  DOCUMENTARY: { category: "educational", displayName: "Educational Content" },
  TECH_COMPARISON: {
    category: "reviews",
    displayName: "Reviews & Comparisons",
  },
  VIDEO_ESSAY: { category: "commentary", displayName: "Opinion & Commentary" },
  CASUALLY_EXPLAINED: {
    category: "entertainment",
    displayName: "Entertainment",
  },
};

const FORMAT_DISPLAY_NAMES: Record<string, string> = {
  EXPLAINER: "Explainer",
  DOCUMENTARY: "Documentary",
  TECH_COMPARISON: "Tech Comparison",
  VIDEO_ESSAY: "Video Essay",
  CASUALLY_EXPLAINED: "Casually Explained",
};

export function FormatMindMap({
  templates,
  onTemplateSelect,
}: FormatMindMapProps) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [expandedFormat, setExpandedFormat] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Group templates by category → format
  const categoryNodes: CategoryNode[] = [];
  const categoryMap = new Map<string, CategoryNode>();

  templates.forEach((template) => {
    const formatInfo = FORMAT_CATEGORIES[template.format];
    if (!formatInfo) return;

    const { category, displayName: categoryDisplayName } = formatInfo;

    // Get or create category node
    let categoryNode = categoryMap.get(category);
    if (!categoryNode) {
      categoryNode = {
        category,
        displayName: categoryDisplayName,
        formats: [],
      };
      categoryMap.set(category, categoryNode);
      categoryNodes.push(categoryNode);
    }

    // Find or create format node
    let formatNode = categoryNode.formats.find(
      (f) => f.format === template.format,
    );
    if (!formatNode) {
      formatNode = {
        format: template.format,
        displayName: FORMAT_DISPLAY_NAMES[template.format] || template.format,
        description: "", // Could be enriched from template metadata
        category,
        templates: [],
      };
      categoryNode.formats.push(formatNode);
    }

    formatNode.templates.push(template);
  });

  // Auto-expand if only one category
  useEffect(() => {
    if (categoryNodes.length === 1 && !expandedCategory) {
      setExpandedCategory(categoryNodes[0]!.category);
    }
  }, [categoryNodes.length, expandedCategory]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        minHeight: 500,
        background: "rgba(0,0,0,0.2)",
        borderRadius: 16,
        padding: "40px 60px",
        overflow: "auto",
      }}
    >
      {/* Center root node */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 60,
        }}
      >
        {/* Root */}
        <div
          style={{
            padding: "16px 32px",
            background:
              "linear-gradient(135deg, rgba(var(--v2-accent-rgb), 0.2), rgba(var(--v2-accent-rgb), 0.1))",
            border: "2px solid var(--v2-accent)",
            borderRadius: 12,
            fontSize: 16,
            fontWeight: 700,
            color: "var(--v2-accent)",
            textAlign: "center",
            letterSpacing: "0.05em",
          }}
        >
          Content Formats
        </div>

        {/* Categories */}
        <div
          style={{
            display: "flex",
            gap: 40,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {categoryNodes.map((categoryNode) => {
            const isExpanded = expandedCategory === categoryNode.category;

            return (
              <div
                key={categoryNode.category}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 24,
                }}
              >
                {/* Category node */}
                <button
                  onClick={() =>
                    setExpandedCategory(
                      isExpanded ? null : categoryNode.category,
                    )
                  }
                  style={{
                    padding: "14px 24px",
                    background: isExpanded
                      ? "rgba(var(--v2-accent-rgb), 0.15)"
                      : "rgba(255,255,255,0.04)",
                    border: isExpanded
                      ? "2px solid rgba(var(--v2-accent-rgb), 0.5)"
                      : "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    color: isExpanded ? "var(--v2-accent)" : "#e5e2e1",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                  >
                    {isExpanded ? "expand_less" : "expand_more"}
                  </span>
                  {categoryNode.displayName}
                  <span
                    style={{
                      marginLeft: 4,
                      padding: "2px 8px",
                      background: "rgba(var(--v2-accent-rgb), 0.2)",
                      borderRadius: 6,
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {categoryNode.formats.length}
                  </span>
                </button>

                {/* Formats under this category */}
                {isExpanded && (
                  <div
                    style={{
                      display: "flex",
                      gap: 24,
                      flexWrap: "wrap",
                      justifyContent: "center",
                      maxWidth: 600,
                    }}
                  >
                    {categoryNode.formats.map((formatNode) => {
                      const isFormatExpanded =
                        expandedFormat === formatNode.format;

                      return (
                        <div
                          key={formatNode.format}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 16,
                          }}
                        >
                          {/* Format node */}
                          <button
                            onClick={() =>
                              setExpandedFormat(
                                isFormatExpanded ? null : formatNode.format,
                              )
                            }
                            style={{
                              padding: "12px 20px",
                              background: isFormatExpanded
                                ? "rgba(var(--v2-accent-rgb), 0.1)"
                                : "rgba(255,255,255,0.03)",
                              border: isFormatExpanded
                                ? "1px solid rgba(var(--v2-accent-rgb), 0.4)"
                                : "1px solid rgba(255,255,255,0.1)",
                              borderRadius: 8,
                              fontSize: 12,
                              fontWeight: 600,
                              color: isFormatExpanded
                                ? "#e5e2e1"
                                : "rgba(205,195,215,0.8)",
                              cursor: "pointer",
                              transition: "all 0.2s ease",
                              minWidth: 160,
                            }}
                          >
                            {formatNode.displayName}
                            <span
                              style={{
                                marginLeft: 6,
                                padding: "1px 6px",
                                background: "rgba(var(--v2-accent-rgb), 0.15)",
                                borderRadius: 4,
                                fontSize: 9,
                                fontWeight: 700,
                              }}
                            >
                              {formatNode.templates.length}
                            </span>
                          </button>

                          {/* Templates under this format */}
                          {isFormatExpanded && (
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 8,
                              }}
                            >
                              {formatNode.templates.map((template) => (
                                <button
                                  key={template.id}
                                  onClick={() => onTemplateSelect(template)}
                                  style={{
                                    padding: "10px 16px",
                                    background:
                                      "rgba(var(--v2-accent-rgb), 0.08)",
                                    border:
                                      "1px solid rgba(var(--v2-accent-rgb), 0.25)",
                                    borderRadius: 6,
                                    fontSize: 11,
                                    fontWeight: 500,
                                    color: "#e5e2e1",
                                    cursor: "pointer",
                                    transition: "all 0.15s ease",
                                    textAlign: "left",
                                    minWidth: 200,
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background =
                                      "rgba(var(--v2-accent-rgb), 0.15)";
                                    e.currentTarget.style.borderColor =
                                      "var(--v2-accent)";
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background =
                                      "rgba(var(--v2-accent-rgb), 0.08)";
                                    e.currentTarget.style.borderColor =
                                      "rgba(var(--v2-accent-rgb), 0.25)";
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                    }}
                                  >
                                    <span
                                      className="material-symbols-outlined"
                                      style={{
                                        fontSize: 14,
                                        color: "var(--v2-accent)",
                                      }}
                                    >
                                      arrow_forward
                                    </span>
                                    {template.name}
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
