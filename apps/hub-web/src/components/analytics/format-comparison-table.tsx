"use client";

/**
 * Format Comparison Table - V2 Styling
 *
 * Compares production metrics across all content formats.
 */

interface FormatComparison {
  format: string;
  jobs_completed: number;
  jobs_active: number;
  error_count: number;
  avg_lead_time_hours: number | null;
}

interface FormatComparisonTableProps {
  formats: FormatComparison[];
}

function formatName(format: string): string {
  return format
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function FormatComparisonTable({ formats }: FormatComparisonTableProps) {
  if (formats.length === 0) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "32px 0",
          color: "rgba(205,195,215,0.4)",
          fontSize: 12,
        }}
      >
        No format data available
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr
            style={{
              borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
            }}
          >
            <th
              style={{
                padding: "8px 16px",
                textAlign: "left",
                fontSize: 10,
                fontWeight: 700,
                color: "#cdc3d7",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Format
            </th>
            <th
              style={{
                padding: "8px 16px",
                textAlign: "right",
                fontSize: 10,
                fontWeight: 700,
                color: "#cdc3d7",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Completed
            </th>
            <th
              style={{
                padding: "8px 16px",
                textAlign: "right",
                fontSize: 10,
                fontWeight: 700,
                color: "#cdc3d7",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Active
            </th>
            <th
              style={{
                padding: "8px 16px",
                textAlign: "right",
                fontSize: 10,
                fontWeight: 700,
                color: "#cdc3d7",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Errors
            </th>
            <th
              style={{
                padding: "8px 16px",
                textAlign: "right",
                fontSize: 10,
                fontWeight: 700,
                color: "#cdc3d7",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Avg Lead Time
            </th>
          </tr>
        </thead>
        <tbody>
          {formats.map((f, index) => (
            <tr
              key={f.format}
              style={{
                borderBottom:
                  index < formats.length - 1
                    ? "1px solid rgba(75,68,85,0.1)"
                    : "none",
                transition: "background 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  "rgba(var(--v2-accent-rgb), 0.05)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <td style={{ padding: "12px 16px" }}>
                <span
                  style={{ fontSize: 12, fontWeight: 600, color: "#e5e2e1" }}
                >
                  {formatName(f.format)}
                </span>
              </td>
              <td style={{ padding: "12px 16px", textAlign: "right" }}>
                <span
                  style={{ fontSize: 12, color: "#23decb", fontWeight: 600 }}
                >
                  {f.jobs_completed}
                </span>
              </td>
              <td style={{ padding: "12px 16px", textAlign: "right" }}>
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--v2-accent)",
                    fontWeight: 600,
                  }}
                >
                  {f.jobs_active}
                </span>
              </td>
              <td style={{ padding: "12px 16px", textAlign: "right" }}>
                <span
                  style={{
                    fontSize: 12,
                    color:
                      f.error_count > 0 ? "#ffb4ab" : "rgba(205,195,215,0.5)",
                    fontWeight: 600,
                  }}
                >
                  {f.error_count}
                </span>
              </td>
              <td style={{ padding: "12px 16px", textAlign: "right" }}>
                <span style={{ fontSize: 12, color: "rgba(205,195,215,0.6)" }}>
                  {f.avg_lead_time_hours
                    ? `${f.avg_lead_time_hours.toFixed(1)}h`
                    : "—"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
