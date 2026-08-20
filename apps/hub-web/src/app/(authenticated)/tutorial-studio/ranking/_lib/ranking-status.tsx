/**
 * Status presentation for RANKING jobs, shared by the Rankings tab and the
 * job detail page.
 *
 * One copy, because these two surfaces sit one click apart: a job labelled
 * "Ready to upload" in the list that said something else on its own page would
 * be read as two different jobs.
 */

/**
 * Chip colours by pipeline phase, not by individual status. RANKING moves
 * through content_jobs' ~50-value status enum, and colouring each one
 * separately would be unmaintainable and unreadable. Four meanings is what a
 * VA actually needs: working, your turn, done, broken.
 */
export function statusColor(status: string): string {
  if (status.startsWith("FAILED_")) return "#ef4444";
  if (status === "AWAITING_VA_REVIEW") return "#22c55e";
  if (status === "AWAITING_UPLOADER" || status === "PUBLISHED")
    return "#3b82f6";
  if (status === "MARKED_FOR_DELETION" || status === "DELETED")
    return "#6b7280";
  return "#f59e0b";
}

/** Plain-English label. Raw enum names mean nothing to a VA. */
export function statusLabel(status: string): string {
  switch (status) {
    case "IDEA_GENERATION":
      return "Starting";
    case "SCRIPTING":
      return "Writing script";
    case "ASSET_COLLECTION":
      return "Finding footage + voice";
    case "AWAITING_VA_REVIEW":
      return "Your turn: pick B-roll";
    case "QMS_VALIDATING":
      return "Checking";
    case "ROUTING_RENDER":
    case "RENDERING":
    case "RENDERING_REMOTION":
      return "Rendering";
    case "AWAITING_UPLOADER":
      return "Ready to upload";
    case "PUBLISHED":
      return "Published";
    case "MARKED_FOR_DELETION":
    case "DELETED":
      return "Deleted";
    default:
      return status.replace(/_/g, " ").toLowerCase();
  }
}

export function StatusChip({ status }: { status: string }) {
  const color = statusColor(status);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 9999,
        fontSize: 9,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        background: `${color}22`,
        color,
        border: `1px solid ${color}44`,
        whiteSpace: "nowrap",
      }}
    >
      {statusLabel(status)}
    </span>
  );
}
