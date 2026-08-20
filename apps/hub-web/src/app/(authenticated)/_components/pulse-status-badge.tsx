interface StatusConfig {
  label: string;
  color: string;
  glow: string;
  pulse: boolean;
}

// Accent-based statuses use CSS vars for full theme responsiveness.
// Fixed-semantic statuses (error, warning, success, muted) use absolute colors.
const ACCENT = "var(--v2-accent)";
const ACCENT_GLOW = "rgba(var(--v2-accent-rgb), 0.5)";

const STATUS_MAP: Record<string, StatusConfig> = {
  IDEA_GENERATION: {
    label: "Idea Gen",
    color: ACCENT,
    glow: ACCENT_GLOW,
    pulse: true,
  },
  SCRIPTING: {
    label: "Scripting",
    color: ACCENT,
    glow: ACCENT_GLOW,
    pulse: true,
  },
  TRANSLATING: {
    label: "Translating",
    color: ACCENT,
    glow: ACCENT_GLOW,
    pulse: true,
  },
  ASSET_COLLECTION: {
    label: "Assets",
    color: ACCENT,
    glow: ACCENT_GLOW,
    pulse: true,
  },
  AWAITING_PRODUCTION_VA: {
    label: "Awaiting VA",
    color: "#f97316",
    glow: "rgba(249,115,22,0.5)",
    pulse: false,
  },
  AWAITING_IMAGE_QC: {
    label: "Image QC",
    color: "#f97316",
    glow: "rgba(249,115,22,0.5)",
    pulse: false,
  },
  CLIP_SELECTION: {
    label: "Clip Select",
    color: ACCENT,
    glow: ACCENT_GLOW,
    pulse: true,
  },
  AWAITING_CLIP_REVIEW: {
    label: "Clip Review",
    color: "#f97316",
    glow: "rgba(249,115,22,0.5)",
    pulse: false,
  },
  FAILED_CLIP_SELECTION: {
    label: "Clip Sel Failed",
    color: "#ffb4ab",
    glow: "rgba(255,180,171,0.5)",
    pulse: false,
  },
  QMS_VALIDATING: {
    label: "QMS Check",
    color: ACCENT,
    glow: ACCENT_GLOW,
    pulse: true,
  },
  ROUTING_RENDER: {
    label: "Routing",
    color: ACCENT,
    glow: ACCENT_GLOW,
    pulse: false,
  },
  RENDERING_REMOTION: {
    label: "Rendering",
    color: ACCENT,
    glow: ACCENT_GLOW,
    pulse: true,
  },
  RENDERING_FFMPEG: {
    label: "Rendering",
    color: ACCENT,
    glow: ACCENT_GLOW,
    pulse: true,
  },
  AWAITING_QC: {
    label: "QC Review",
    color: "#f97316",
    glow: "rgba(249,115,22,0.5)",
    pulse: false,
  },
  AWAITING_UPLOADER: {
    label: "Upload Queue",
    color: "#f97316",
    glow: "rgba(249,115,22,0.5)",
    pulse: false,
  },
  UPLOADING: {
    label: "Uploading",
    color: ACCENT,
    glow: ACCENT_GLOW,
    pulse: true,
  },
  PUBLISHED: {
    label: "Published",
    color: "#23decb",
    glow: "rgba(35,222,203,0.5)",
    pulse: false,
  },
  PAUSED: {
    label: "Paused",
    color: "#4b4455",
    glow: "rgba(75,68,85,0.4)",
    pulse: false,
  },
  CANCELLED: {
    label: "Cancelled",
    color: "#4b4455",
    glow: "rgba(75,68,85,0.4)",
    pulse: false,
  },
  MARKED_FOR_DELETION: {
    label: "Deleting",
    color: "#4b4455",
    glow: "rgba(75,68,85,0.4)",
    pulse: false,
  },
  DELETED: {
    label: "Deleted",
    color: "#4b4455",
    glow: "rgba(75,68,85,0.4)",
    pulse: false,
  },
  FAILED_QMS: {
    label: "QMS Failed",
    color: "#ffb4ab",
    glow: "rgba(255,180,171,0.5)",
    pulse: false,
  },
  FAILED_RENDER: {
    label: "Render Failed",
    color: "#ffb4ab",
    glow: "rgba(255,180,171,0.5)",
    pulse: false,
  },
  FAILED_UPLOAD: {
    label: "Upload Failed",
    color: "#ffb4ab",
    glow: "rgba(255,180,171,0.5)",
    pulse: false,
  },
  FAILED_GENERAL: {
    label: "Failed",
    color: "#ffb4ab",
    glow: "rgba(255,180,171,0.5)",
    pulse: false,
  },
};

interface Props {
  status: string;
}

export function PulseStatusBadge({ status }: Props) {
  const config = STATUS_MAP[status] ?? {
    label: status,
    color: "#4b4455",
    glow: "rgba(75,68,85,0.4)",
    pulse: false,
  };
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={config.pulse ? "animate-pulse" : ""}
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: config.color,
          boxShadow: `0 0 6px ${config.glow}`,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          color: config.color,
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {config.label}
      </span>
    </div>
  );
}
