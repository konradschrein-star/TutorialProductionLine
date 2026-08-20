"use client";

const DRAMA_STAGES = [
  {
    status: "DRAMA_TTS_GENERATING",
    label: "Voice Generation",
    icon: "record_voice_over",
    description: "ElevenLabs TTS — generating audio from script",
  },
  {
    status: "DRAMA_TRANSCRIBING",
    label: "Transcribing",
    icon: "closed_caption",
    description: "Whisper — extracting word-level timings",
  },
  {
    status: "DRAMA_PROMPT_GENERATING",
    label: "Prompt Generation",
    icon: "auto_awesome",
    description: "Gemini — detecting chapters and writing image prompts",
  },
  {
    status: "DRAMA_IMAGE_GENERATING",
    label: "Image Generation",
    icon: "image",
    description: "VPS Nano Banana — generating photorealistic scenes",
  },
  {
    status: "DRAMA_VIDEO_GENERATING",
    label: "Video Generation",
    icon: "video_camera_back",
    description: "Veo i2v — animating each scene into video (Slow Video mode)",
  },
  {
    status: "DRAMA_ASSEMBLING",
    label: "Assembling",
    icon: "movie_edit",
    description: "FFmpeg — stitching clips, crossfades, subtitles",
  },
  {
    status: "DRAMA_QC",
    label: "Quality Check",
    icon: "fact_check",
    description: "Black frames, scene distribution, LUFS levels",
  },
  {
    status: "AWAITING_QC",
    label: "Human Review",
    icon: "rate_review",
    description: "Manual QC review before upload",
  },
  {
    status: "AWAITING_UPLOADER",
    label: "Ready to Upload",
    icon: "upload",
    description: "Video ready — awaiting upload",
  },
] as const;

const DRAMA_STATUS_ORDER = DRAMA_STAGES.map((s) => s.status);

function getStageState(
  stageStatus: string,
  currentStatus: string,
): "done" | "active" | "pending" | "failed" {
  if (
    currentStatus === "DRAMA_QC_FAILED" ||
    currentStatus === "FAILED_DRAMA_PIPELINE"
  ) {
    const currentIdx = DRAMA_STATUS_ORDER.indexOf(
      currentStatus === "DRAMA_QC_FAILED"
        ? "DRAMA_QC"
        : ("DRAMA_ASSEMBLING" as any),
    );
    const stageIdx = DRAMA_STATUS_ORDER.indexOf(stageStatus as any);
    if (stageIdx < currentIdx) return "done";
    if (stageIdx === currentIdx) return "failed";
    return "pending";
  }

  const currentIdx = DRAMA_STATUS_ORDER.indexOf(currentStatus as any);
  const stageIdx = DRAMA_STATUS_ORDER.indexOf(stageStatus as any);

  if (currentIdx === -1) return "pending";
  if (stageIdx < currentIdx) return "done";
  if (stageIdx === currentIdx) return "active";
  return "pending";
}

interface Props {
  status: string;
  metadata?: Record<string, unknown> | null;
}

export function DramaPipelineTracker({ status, metadata }: Props) {
  const isDramaJob =
    status.startsWith("DRAMA_") ||
    status === "AWAITING_QC" ||
    status === "AWAITING_UPLOADER";

  if (!isDramaJob) return null;

  const isFailed =
    status === "DRAMA_QC_FAILED" || status === "FAILED_DRAMA_PIPELINE";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 20,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(var(--v2-accent-rgb),0.12)",
        borderRadius: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 16, color: "#f472b6" }}
        >
          theater_comedy
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#e5e2e1" }}>
          Drama Pipeline
        </span>
        {isFailed && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#ffb4ab",
              background: "rgba(255,180,171,0.1)",
              border: "1px solid rgba(255,180,171,0.2)",
              borderRadius: 10,
              padding: "2px 8px",
              marginLeft: "auto",
            }}
          >
            FAILED
          </span>
        )}
      </div>

      {/* Stage list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {DRAMA_STAGES.map((stage, i) => {
          const state = getStageState(stage.status, status);
          const isLast = i === DRAMA_STAGES.length - 1;

          const dotColor =
            state === "done"
              ? "#34d399"
              : state === "active"
                ? "#f472b6"
                : state === "failed"
                  ? "#ffb4ab"
                  : "rgba(205,195,215,0.2)";

          const textColor =
            state === "done"
              ? "#cdc3d7"
              : state === "active"
                ? "#e5e2e1"
                : state === "failed"
                  ? "#ffb4ab"
                  : "rgba(205,195,215,0.3)";

          return (
            <div
              key={stage.status}
              style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
            >
              {/* Connector column */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  width: 20,
                  flexShrink: 0,
                }}
              >
                {/* Dot */}
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background:
                      state === "active"
                        ? "rgba(244,114,182,0.15)"
                        : state === "done"
                          ? "rgba(52,211,153,0.12)"
                          : state === "failed"
                            ? "rgba(255,180,171,0.12)"
                            : "rgba(255,255,255,0.04)",
                    border: `2px solid ${dotColor}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    boxShadow:
                      state === "active"
                        ? `0 0 10px rgba(244,114,182,0.4)`
                        : "none",
                  }}
                >
                  {state === "done" && (
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 11, color: "#34d399" }}
                    >
                      check
                    </span>
                  )}
                  {state === "active" && (
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "#f472b6",
                        animation: "pulse 1.5s ease-in-out infinite",
                      }}
                    />
                  )}
                  {state === "failed" && (
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 11, color: "#ffb4ab" }}
                    >
                      close
                    </span>
                  )}
                </div>
                {/* Connector line */}
                {!isLast && (
                  <div
                    style={{
                      width: 2,
                      height: 28,
                      background:
                        state === "done"
                          ? "rgba(52,211,153,0.3)"
                          : "rgba(255,255,255,0.06)",
                      marginTop: 2,
                    }}
                  />
                )}
              </div>

              {/* Stage info */}
              <div style={{ paddingTop: 1, paddingBottom: isLast ? 0 : 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 13, color: dotColor }}
                  >
                    {stage.icon}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: state === "active" ? 700 : 500,
                      color: textColor,
                    }}
                  >
                    {stage.label}
                  </span>
                  {state === "active" && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: "#f472b6",
                        background: "rgba(244,114,182,0.12)",
                        border: "1px solid rgba(244,114,182,0.25)",
                        borderRadius: 8,
                        padding: "1px 6px",
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                      }}
                    >
                      Running
                    </span>
                  )}
                </div>
                {state === "active" && (
                  <p
                    style={{
                      fontSize: 10,
                      color: "rgba(205,195,215,0.5)",
                      margin: "3px 0 0 0",
                      lineHeight: 1.4,
                    }}
                  >
                    {stage.description}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
