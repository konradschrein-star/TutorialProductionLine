"use client";

import { useEffect, useState } from "react";

interface Character {
  id: string;
  name: string;
  description: string;
  thumbnail_url: string | null;
}

interface Clip {
  id: string;
  clip_index: number;
  section_type: string;
  text: string;
  start_ms: number;
  end_ms: number;
  image_prompt: string | null;
  image_path: string | null;
  image_status: string;
  video_path: string | null;
  video_status: string;
  character_ids: string[];
}

interface HistoryEntry {
  from_status?: string;
  to_status: string;
  timestamp: string;
  reason?: string | null;
}

interface PayloadJob {
  id: string;
  status: string;
  created_at: string | null;
  status_updated_at: string | null;
  render_mode: string | null;
  script: string | null;
  has_audio: boolean;
  has_transcript: boolean;
  state_history: HistoryEntry[];
  word_timings: Array<{
    word: string;
    start_ms: number;
    end_ms: number;
  }> | null;
}

interface Payload {
  job: PayloadJob;
  characters: Character[];
  clips: Clip[];
}

const STAGE_ORDER: Array<{ key: string; label: string }> = [
  { key: "DRAMA_TTS_GENERATING", label: "TTS" },
  { key: "DRAMA_TRANSCRIBING", label: "Transcribe" },
  { key: "DRAMA_PROMPT_GENERATING", label: "Prompt-gen" },
  { key: "DRAMA_IMAGE_GENERATING", label: "Image-gen" },
  { key: "DRAMA_VIDEO_GENERATING", label: "Video-gen" },
  { key: "DRAMA_ASSEMBLING", label: "Assemble" },
  { key: "DRAMA_QC", label: "QC" },
  { key: "AWAITING_QC", label: "Awaiting QC" },
];

function formatDuration(ms: number): string {
  if (ms < 0 || !isFinite(ms)) return "—";
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

const RENDER_MODE_COLOR: Record<string, { bg: string; color: string }> = {
  DIRECT_T2V: {
    bg: "rgba(192,132,252,0.18)",
    color: "#c084fc",
  },
  SLOW_VIDEO: {
    bg: "rgba(96,165,250,0.18)",
    color: "#60a5fa",
  },
  KEN_BURNS: {
    bg: "rgba(251,191,36,0.18)",
    color: "#fbbf24",
  },
};

const statusDot: Record<string, { bg: string; color: string; label: string }> =
  {
    done: { bg: "rgba(74,222,128,0.18)", color: "#4ade80", label: "done" },
    pending: {
      bg: "rgba(250,204,21,0.18)",
      color: "#facc15",
      label: "pending",
    },
    failed: { bg: "rgba(248,113,113,0.18)", color: "#f87171", label: "failed" },
  };

function StatusChip({ status }: { status: string }) {
  const s = statusDot[status] ?? {
    bg: "rgba(255,255,255,0.06)",
    color: "#cdc3d7",
    label: status,
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        borderRadius: 6,
        background: s.bg,
        color: s.color,
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: s.color,
        }}
      />
      {s.label}
    </span>
  );
}

function formatMs(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Mirror of the server-side DIRECT_T2V prompt builder in
 * video-gen.ts. Kept here so the user can verify exactly what would be
 * sent to VEO without us having to persist a `video_prompt` column.
 * Keep this in sync if the server-side builder changes.
 */
function buildT2VPromptPreview(
  clip: Clip,
  charById: Map<string, Character>,
): string {
  const action =
    clip.image_prompt
      ?.split(/[.!?]+/)
      .map((s) => s.trim())
      .find((s) => s.length > 0) ??
    clip.text ??
    "";
  const lookOnly = (desc: string) => {
    const first =
      desc
        .split(/[.\n]/)
        .map((s) => s.trim())
        .find((s) => s.length > 0) ?? desc;
    const parts = first.split(",").map((s) => s.trim());
    if (
      parts.length > 1 &&
      /^[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+){0,2}$/.test(parts[0]!)
    ) {
      parts.shift();
    }
    const joined = parts.join(", ");
    return joined.length > 110 ? joined.slice(0, 110) + "…" : joined;
  };
  const charLines = (clip.character_ids ?? [])
    .map((id) => charById.get(id))
    .filter((c): c is Character => !!c)
    .map((c) => `- ${lookOnly(c.description)}`)
    .join("\n");
  return [
    action.trim() + ".",
    charLines ? `\nCharacters:\n${charLines}` : "",
    "\nUrban reality TV style. One shot, no cuts, static camera, no camera movement.",
  ]
    .filter(Boolean)
    .join("\n");
}

interface Props {
  jobId: string;
}

export function DramaClipsPanel({ jobId }: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expandedClipIdx, setExpandedClipIdx] = useState<number | null>(null);
  const [expandedCharId, setExpandedCharId] = useState<string | null>(null);
  // Live tick so the "X min in this stage" timer updates every second
  // even when the server payload hasn't refreshed.
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/drama/${jobId}/clips`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as Payload;
        if (mounted) setData(body);
      } catch (e) {
        if (mounted) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const interval = setInterval(load, 8000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [jobId]);

  if (err) {
    return (
      <div
        style={{
          padding: 16,
          color: "#f87171",
          fontSize: 12,
        }}
      >
        Failed to load clips: {err}
      </div>
    );
  }

  if (!data) {
    return (
      <div
        style={{
          padding: 16,
          color: "#cdc3d7",
          fontSize: 12,
        }}
      >
        Loading clips…
      </div>
    );
  }

  if (data.clips.length === 0) {
    return (
      <div
        style={{
          padding: 16,
          color: "#cdc3d7",
          fontSize: 12,
          fontStyle: "italic",
        }}
      >
        Waiting on prompt-gen — no clips have been written yet.
      </div>
    );
  }

  const total = data.clips.length;
  const imagesDone = data.clips.filter((c) => c.image_status === "done").length;
  const videosDone = data.clips.filter((c) => c.video_status === "done").length;
  const imageFailed = data.clips.filter(
    (c) => c.image_status === "failed",
  ).length;
  const videoFailed = data.clips.filter(
    (c) => c.video_status === "failed",
  ).length;
  const charById = new Map(data.characters.map((c) => [c.id, c]));

  // Compute per-stage elapsed times from state_machine_history. The
  // current stage is data.job.status; its start is the timestamp of the
  // most recent transition into it. Past stages get total time spent.
  const stageEntries = computeStageEntries(
    data.job.state_history,
    data.job.status,
    data.job.created_at,
  );
  const renderMode = data.job.render_mode ?? "—";
  const modeStyle = RENDER_MODE_COLOR[renderMode] ?? {
    bg: "rgba(255,255,255,0.06)",
    color: "#cdc3d7",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Render mode + current stage timer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(var(--v2-accent-rgb),0.12)",
          borderRadius: 10,
        }}
      >
        <span
          style={{
            padding: "4px 10px",
            background: modeStyle.bg,
            color: modeStyle.color,
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 0.5,
            textTransform: "uppercase",
          }}
        >
          {renderMode}
        </span>
        <span style={{ fontSize: 11, color: "#cdc3d7" }}>
          {data.job.status}
        </span>
        <CurrentStageTimer
          since={data.job.status_updated_at}
          stage={data.job.status}
        />
      </div>

      {/* Stage timeline */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: 16,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(var(--v2-accent-rgb),0.12)",
          borderRadius: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 16, color: "#a78bfa" }}
          >
            timeline
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#e5e2e1" }}>
            Stage timeline
          </span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {stageEntries.map((e) => (
            <div
              key={e.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "4px 8px",
                background:
                  e.state === "current"
                    ? "rgba(192,132,252,0.12)"
                    : "transparent",
                borderRadius: 6,
                fontSize: 11,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background:
                    e.state === "done"
                      ? "#4ade80"
                      : e.state === "current"
                        ? "#c084fc"
                        : "rgba(255,255,255,0.15)",
                }}
              />
              <span
                style={{
                  color: e.state === "future" ? "#7a6f86" : "#e5e2e1",
                  fontWeight: e.state === "current" ? 700 : 500,
                  minWidth: 130,
                }}
              >
                {e.label}
              </span>
              <span
                style={{
                  color: "#cdc3d7",
                  fontFamily: "monospace",
                  fontSize: 10,
                }}
              >
                {e.state === "future" ? "—" : formatDuration(e.elapsedMs)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Audio + transcript */}
      {(data.job.has_audio || data.job.has_transcript) && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: 16,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(var(--v2-accent-rgb),0.12)",
            borderRadius: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16, color: "#facc15" }}
            >
              graphic_eq
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#e5e2e1" }}>
              Voice + transcript
            </span>
          </div>
          {data.job.has_audio && (
            <audio
              controls
              src={`/api/drama/${jobId}/file?name=tts.mp3`}
              style={{ width: "100%", maxWidth: 480 }}
            />
          )}
          {data.job.word_timings && data.job.word_timings.length > 0 && (
            <details>
              <summary
                style={{
                  fontSize: 11,
                  color: "#cdc3d7",
                  cursor: "pointer",
                }}
              >
                Transcript ({data.job.word_timings.length} words) — click to
                expand
              </summary>
              <div
                style={{
                  marginTop: 6,
                  padding: 10,
                  background: "rgba(0,0,0,0.2)",
                  borderRadius: 6,
                  fontSize: 11,
                  color: "#e5e2e1",
                  lineHeight: 1.5,
                  maxHeight: 240,
                  overflowY: "auto",
                }}
              >
                {data.job.word_timings.map((w) => w.word).join(" ")}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Header with overall progress */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: 16,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(var(--v2-accent-rgb),0.12)",
          borderRadius: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16, color: "var(--v2-accent)" }}
            >
              movie_filter
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#e5e2e1" }}>
              Per-Clip Progress
            </span>
            <span style={{ fontSize: 10, color: "#cdc3d7" }}>
              {data.job.render_mode ?? "—"}
            </span>
          </div>
          <span style={{ fontSize: 10, color: "#cdc3d7" }}>
            {total} clips · {imagesDone} images · {videosDone} videos
            {(imageFailed > 0 || videoFailed > 0) && (
              <>
                {" · "}
                <span style={{ color: "#f87171" }}>
                  {imageFailed + videoFailed} failed
                </span>
              </>
            )}
          </span>
        </div>

        {/* Two progress bars */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <ProgressBar
            label="Images"
            done={imagesDone}
            failed={imageFailed}
            total={total}
          />
          <ProgressBar
            label="Videos"
            done={videosDone}
            failed={videoFailed}
            total={total}
          />
        </div>
      </div>

      {/* Characters */}
      {data.characters.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: 16,
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
              groups
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#e5e2e1" }}>
              Cast ({data.characters.length})
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 10,
            }}
          >
            {data.characters.map((c) => {
              const isExpanded = expandedCharId === c.id;
              return (
                <div
                  key={c.id}
                  onClick={() => setExpandedCharId(isExpanded ? null : c.id)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: 12,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#e5e2e1",
                    }}
                  >
                    {c.name}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "#cdc3d7",
                      lineHeight: 1.45,
                      maxHeight: isExpanded ? "none" : 60,
                      overflow: "hidden",
                    }}
                  >
                    {c.description}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Clips */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.clips.map((clip) => {
          const isExpanded = expandedClipIdx === clip.clip_index;
          const durSec = Math.max((clip.end_ms - clip.start_ms) / 1000, 0);
          return (
            <div
              key={clip.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 12,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
                borderRadius: 10,
              }}
            >
              <div
                onClick={() =>
                  setExpandedClipIdx(isExpanded ? null : clip.clip_index)
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#cdc3d7",
                    background: "rgba(var(--v2-accent-rgb),0.12)",
                    padding: "2px 8px",
                    borderRadius: 6,
                    minWidth: 36,
                    textAlign: "center",
                  }}
                >
                  #{clip.clip_index}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: "#cdc3d7",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  {clip.section_type}
                </span>
                <span style={{ fontSize: 10, color: "#cdc3d7" }}>
                  {formatMs(clip.start_ms)} → {formatMs(clip.end_ms)} (
                  {durSec.toFixed(1)}s)
                </span>
                <StatusChip status={clip.image_status} />
                <StatusChip status={clip.video_status} />
                <span
                  style={{
                    fontSize: 11,
                    color: "#e5e2e1",
                    flex: 1,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {clip.text || clip.image_prompt?.slice(0, 80) || ""}
                </span>
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 18, color: "#cdc3d7" }}
                >
                  {isExpanded ? "expand_less" : "expand_more"}
                </span>
              </div>
              {isExpanded && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    paddingTop: 8,
                    borderTop: "1px solid rgba(var(--v2-accent-rgb),0.08)",
                  }}
                >
                  {clip.character_ids.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                      }}
                    >
                      {clip.character_ids.map((id) => {
                        const c = charById.get(id);
                        return (
                          <span
                            key={id}
                            style={{
                              fontSize: 10,
                              color: "#e5e2e1",
                              background: "rgba(var(--v2-accent-rgb),0.1)",
                              padding: "2px 8px",
                              borderRadius: 6,
                            }}
                          >
                            {c?.name ?? id.slice(0, 8)}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {clip.image_prompt && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          color: "#a78bfa",
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          fontWeight: 700,
                        }}
                      >
                        Image prompt (Gemini → Nano Banana)
                      </span>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#e5e2e1",
                          background: "rgba(0,0,0,0.2)",
                          border: "1px solid rgba(var(--v2-accent-rgb),0.08)",
                          borderRadius: 6,
                          padding: 10,
                          lineHeight: 1.5,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {clip.image_prompt}
                      </div>
                    </div>
                  )}
                  {data.job.render_mode === "DIRECT_T2V" && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          color: "#c084fc",
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          fontWeight: 700,
                        }}
                      >
                        Video prompt (sent to VEO t2v) — computed live
                      </span>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#e5e2e1",
                          background: "rgba(192,132,252,0.06)",
                          border: "1px solid rgba(192,132,252,0.18)",
                          borderRadius: 6,
                          padding: 10,
                          lineHeight: 1.5,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {buildT2VPromptPreview(clip, charById)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CurrentStageTimer({
  since,
  stage,
}: {
  since: string | null;
  stage: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return null;
  const elapsedMs = now - new Date(since).getTime();
  const isLong =
    (stage === "DRAMA_PROMPT_GENERATING" && elapsedMs > 3 * 60_000) ||
    (stage === "DRAMA_TTS_GENERATING" && elapsedMs > 5 * 60_000) ||
    (stage === "DRAMA_TRANSCRIBING" && elapsedMs > 3 * 60_000) ||
    (stage === "DRAMA_IMAGE_GENERATING" && elapsedMs > 8 * 60_000) ||
    (stage === "DRAMA_VIDEO_GENERATING" && elapsedMs > 10 * 60_000) ||
    (stage === "DRAMA_ASSEMBLING" && elapsedMs > 3 * 60_000);
  return (
    <span
      style={{
        marginLeft: "auto",
        fontFamily: "monospace",
        fontSize: 11,
        color: isLong ? "#fbbf24" : "#cdc3d7",
        fontWeight: isLong ? 700 : 500,
      }}
    >
      {formatDuration(elapsedMs)} in this stage{isLong ? " ⚠" : ""}
    </span>
  );
}

interface StageEntry {
  key: string;
  label: string;
  state: "done" | "current" | "future";
  elapsedMs: number;
}

function computeStageEntries(
  history: HistoryEntry[],
  currentStatus: string,
  jobCreatedAt: string | null,
): StageEntry[] {
  // For each stage, find the earliest "to_status === stage" transition.
  // Duration = next transition's timestamp − this transition's timestamp.
  // Current stage runs from its entry until "now".
  const earliestEntry = new Map<string, number>(); // stage → ms timestamp
  for (const h of history) {
    if (!earliestEntry.has(h.to_status)) {
      const ts = new Date(h.timestamp).getTime();
      if (!isNaN(ts)) earliestEntry.set(h.to_status, ts);
    }
  }
  if (!earliestEntry.has(currentStatus) && jobCreatedAt) {
    earliestEntry.set(currentStatus, new Date(jobCreatedAt).getTime());
  }
  const currentIdx = STAGE_ORDER.findIndex((s) => s.key === currentStatus);
  const now = Date.now();
  return STAGE_ORDER.map((s, idx) => {
    const enterAt = earliestEntry.get(s.key);
    const nextEnterAt = (() => {
      // find a later stage with a known entry
      for (let j = idx + 1; j < STAGE_ORDER.length; j++) {
        const e = earliestEntry.get(STAGE_ORDER[j]!.key);
        if (e !== undefined) return e;
      }
      return undefined;
    })();
    let state: "done" | "current" | "future";
    if (currentIdx === -1) {
      state = enterAt !== undefined ? "done" : "future";
    } else if (idx < currentIdx) {
      state = enterAt !== undefined ? "done" : "future";
    } else if (idx === currentIdx) {
      state = "current";
    } else {
      state = "future";
    }
    let elapsedMs = 0;
    if (state === "current" && enterAt !== undefined) elapsedMs = now - enterAt;
    else if (state === "done" && enterAt !== undefined) {
      elapsedMs = (nextEnterAt ?? now) - enterAt;
    }
    return { key: s.key, label: s.label, state, elapsedMs };
  });
}

function ProgressBar({
  label,
  done,
  failed,
  total,
}: {
  label: string;
  done: number;
  failed: number;
  total: number;
}) {
  const donePct = total > 0 ? (done / total) * 100 : 0;
  const failPct = total > 0 ? (failed / total) * 100 : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          color: "#cdc3d7",
        }}
      >
        <span>{label}</span>
        <span>
          {done}/{total}
          {failed > 0 && (
            <span style={{ color: "#f87171" }}> · {failed} failed</span>
          )}
        </span>
      </div>
      <div
        style={{
          height: 6,
          background: "rgba(255,255,255,0.06)",
          borderRadius: 3,
          overflow: "hidden",
          display: "flex",
        }}
      >
        <div
          style={{
            width: `${donePct}%`,
            background: "#4ade80",
            transition: "width 0.4s ease",
          }}
        />
        <div
          style={{
            width: `${failPct}%`,
            background: "#f87171",
            transition: "width 0.4s ease",
          }}
        />
      </div>
    </div>
  );
}
