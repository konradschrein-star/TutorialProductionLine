"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SourceVideo {
  id: string;
  title: string | null;
  duration_ms: number | null;
  ingest_status: string;
  fps?: number | null;
}

interface AlgorithmResult {
  boundaries_ms: number[];
  elapsed_s: number;
}

interface Metrics {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

// ── Algorithms ────────────────────────────────────────────────────────────────

const ALGORITHMS = [
  {
    id: "pyscenedetect-content",
    label: "PySceneDetect — ContentDetector",
    color: "#ff6b6b",
  },
  {
    id: "pyscenedetect-adaptive",
    label: "PySceneDetect — AdaptiveDetector",
    color: "#ffd93d",
  },
  {
    id: "pyscenedetect-threshold",
    label: "PySceneDetect — ThresholdDetector",
    color: "#6bcb77",
  },
  {
    id: "ffmpeg-scene-030",
    label: "FFmpeg scene filter (0.30)",
    color: "#4d96ff",
  },
  {
    id: "ffmpeg-scene-040",
    label: "FFmpeg scene filter (0.40)",
    color: "#c77dff",
  },
  {
    id: "ffmpeg-scene-050",
    label: "FFmpeg scene filter (0.50)",
    color: "#ff9671",
  },
  { id: "opencv-framediff", label: "OpenCV frame diff", color: "#00c9a7" },
  { id: "transnetv2", label: "TransNetV2", color: "#f4a261" },
] as const;

type AlgorithmId = (typeof ALGORITHMS)[number]["id"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function msToTimecode(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m % 60)}:${pad(s % 60)}.${pad(ms % 1000, 3)}`;
}

function formatMs(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`;
}

function computeMetrics(
  groundMs: number[],
  predictedMs: number[],
  toleranceMs = 500,
): Metrics {
  if (groundMs.length === 0 || predictedMs.length === 0) {
    return {
      tp: 0,
      fp: predictedMs.length,
      fn: groundMs.length,
      precision: 0,
      recall: 0,
      f1: 0,
    };
  }
  const matched = new Set<number>();
  let tp = 0;
  for (const p of predictedMs) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < groundMs.length; i++) {
      if (matched.has(i)) continue;
      const d = Math.abs((groundMs[i] ?? 0) - p);
      if (d <= toleranceMs && d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      matched.add(bestIdx);
      tp++;
    }
  }
  const fp = predictedMs.length - tp;
  const fn = groundMs.length - tp;
  const precision = predictedMs.length === 0 ? 0 : tp / predictedMs.length;
  const recall = groundMs.length === 0 ? 0 : tp / groundMs.length;
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1 };
}

// ── Sub-components ────────────────────────────────────────────────────────────

const THUMB_PX = 80; // px per thumbnail (= 4s of video)

function Timeline({
  durationMs,
  currentMs,
  thumbnails,
  stepS,
  manualCuts,
  algorithmResults,
  onSeek,
}: {
  durationMs: number;
  currentMs: number;
  thumbnails: string[];
  stepS: number;
  manualCuts: number[];
  algorithmResults: Map<AlgorithmId, AlgorithmResult>;
  onSeek: (ms: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const totalWidth = thumbnails.length * THUMB_PX;

  const msToX = (ms: number) => Math.round((ms / durationMs) * totalWidth);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scrollLeft = containerRef.current.scrollLeft;
    const x = e.clientX - rect.left + scrollLeft;
    const ms = Math.round((x / totalWidth) * durationMs);
    onSeek(Math.max(0, Math.min(durationMs, ms)));
  };

  // Auto-scroll to keep playhead in view
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const x = msToX(currentMs);
    const { scrollLeft, clientWidth } = el;
    if (x < scrollLeft + 40 || x > scrollLeft + clientWidth - 40) {
      el.scrollLeft = Math.max(0, x - clientWidth / 2);
    }
  }, [currentMs]);

  const playheadX = msToX(currentMs);

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      style={{
        position: "relative",
        height: 90,
        overflowX: "auto",
        overflowY: "hidden",
        cursor: "crosshair",
        background: "rgba(0,0,0,0.4)",
        borderRadius: 8,
        border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
      }}
    >
      <div style={{ position: "relative", width: totalWidth, height: 90 }}>
        {/* Thumbnail strip */}
        {thumbnails.map((b64, i) => (
          <img
            key={i}
            src={`data:image/jpeg;base64,${b64}`}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              left: i * THUMB_PX,
              top: 0,
              width: THUMB_PX,
              height: 90,
              objectFit: "cover",
              userSelect: "none",
            }}
          />
        ))}

        {/* Empty placeholder when no thumbnails yet */}
        {thumbnails.length === 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(205,195,215,0.3)",
              fontSize: 11,
            }}
          >
            Thumbnails loading…
          </div>
        )}

        {/* Algorithm cut lines */}
        {ALGORITHMS.map((algo) => {
          const result = algorithmResults.get(algo.id);
          if (!result) return null;
          return result.boundaries_ms.map((ms) => (
            <div
              key={`${algo.id}-${ms}`}
              style={{
                position: "absolute",
                left: msToX(ms),
                top: 0,
                width: 2,
                height: "100%",
                background: algo.color,
                opacity: 0.7,
                pointerEvents: "none",
              }}
            />
          ));
        })}

        {/* Manual cut lines */}
        {manualCuts.map((ms) => (
          <div
            key={`manual-${ms}`}
            style={{
              position: "absolute",
              left: msToX(ms),
              top: 0,
              width: 2,
              height: "100%",
              background: "#fff",
              boxShadow: "0 0 4px rgba(255,255,255,0.8)",
              pointerEvents: "none",
              zIndex: 10,
            }}
          />
        ))}

        {/* Playhead */}
        <div
          style={{
            position: "absolute",
            left: playheadX,
            top: 0,
            width: 2,
            height: "100%",
            background: "var(--v2-accent)",
            boxShadow: "0 0 6px var(--v2-accent)",
            pointerEvents: "none",
            zIndex: 20,
          }}
        />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  libraryId: string;
}

export function SceneBenchmarkClient({ libraryId }: Props) {
  // Video selection
  const [videos, setVideos] = useState<SourceVideo[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  // Playback
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [fps, setFps] = useState(30);

  // Timeline
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [thumbStep, setThumbStep] = useState(4);
  const [loadingThumbs, setLoadingThumbs] = useState(false);

  // Manual cuts
  const [manualCuts, setManualCuts] = useState<number[]>([]);

  // Algorithm results
  const [algorithmResults, setAlgorithmResults] = useState<
    Map<AlgorithmId, AlgorithmResult>
  >(new Map());

  // Persist results + manual cuts to localStorage keyed by videoId
  const storageKey = selectedId ? `benchmark-${selectedId}` : null;

  const saveToStorage = useCallback(
    (cuts: number[], results: Map<AlgorithmId, AlgorithmResult>) => {
      if (!storageKey) return;
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            manualCuts: cuts,
            algorithmResults: Object.fromEntries(results),
          }),
        );
      } catch {}
    },
    [storageKey],
  );
  const [running, setRunning] = useState<AlgorithmId | null>(null);
  const [runAllProgress, setRunAllProgress] = useState<number>(0);
  const [runAllActive, setRunAllActive] = useState(false);
  const [errors, setErrors] = useState<Map<AlgorithmId, string>>(new Map());

  // Collapse state
  const [collapsed, setCollapsed] = useState(false);

  // ── Load source videos ──────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`/api/clip-library/${libraryId}/source-videos`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { sourceVideos?: SourceVideo[] }) => {
        const eligible = (d.sourceVideos ?? []).filter((v) =>
          ["labeling", "ready"].includes(v.ingest_status),
        );
        setVideos(eligible);
        if (eligible.length > 0 && eligible[0]) setSelectedId(eligible[0].id);
      })
      .catch(console.error);
  }, [libraryId]);

  // ── Thumbnail generation ────────────────────────────────────────────────────

  const generateThumbnails = useCallback(async (videoId: string) => {
    setLoadingThumbs(true);
    setThumbnails([]);
    try {
      const res = await fetch(
        `/api/clip-library/benchmark/${videoId}/thumbnails`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        thumbnails: string[];
        step_s: number;
        duration_ms: number;
      };
      setThumbnails(data.thumbnails);
      setThumbStep(data.step_s);
      setDurationMs(data.duration_ms);
    } catch (err) {
      console.error("thumbnail generation failed:", err);
    } finally {
      setLoadingThumbs(false);
    }
  }, []);

  // When selected video changes, restore from localStorage (or reset) and load thumbnails
  useEffect(() => {
    if (!selectedId) return;
    setErrors(new Map());
    setCurrentMs(0);

    const key = `benchmark-${selectedId}`;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          manualCuts?: number[];
          algorithmResults?: Record<string, AlgorithmResult>;
        };
        setManualCuts(parsed.manualCuts ?? []);
        setAlgorithmResults(
          new Map(Object.entries(parsed.algorithmResults ?? {})) as Map<
            AlgorithmId,
            AlgorithmResult
          >,
        );
      } else {
        setManualCuts([]);
        setAlgorithmResults(new Map());
      }
    } catch {
      setManualCuts([]);
      setAlgorithmResults(new Map());
    }

    void generateThumbnails(selectedId);
  }, [selectedId, generateThumbnails]);

  // ── Video events ────────────────────────────────────────────────────────────

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTime = () => setCurrentMs(Math.round(video.currentTime * 1000));
    const onMeta = () => {
      setDurationMs(Math.round(video.duration * 1000));
      // Derive FPS from selected video or fall back to 30
      const sv = videos.find((v) => v.id === selectedId);
      setFps(sv?.fps ?? 30);
    };

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
    };
  }, [selectedId, videos]);

  // ── Keyboard handler ────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      const video = videoRef.current;
      if (!video) return;
      const frameMs = 1000 / fps;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        video.currentTime = Math.min(
          video.duration,
          video.currentTime + frameMs / 1000,
        );
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - frameMs / 1000);
      } else if (e.key === "b" && e.ctrlKey) {
        e.preventDefault();
        const ms = Math.round(video.currentTime * 1000);
        setManualCuts((prev) => {
          if (prev.includes(ms)) return prev;
          const next = [...prev, ms].sort((a, b) => a - b);
          saveToStorage(next, algorithmResults);
          return next;
        });
      } else if (e.key === " ") {
        e.preventDefault();
        if (video.paused) void video.play();
        else video.pause();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fps, algorithmResults, saveToStorage]);

  // ── Seek ────────────────────────────────────────────────────────────────────

  const seek = useCallback((ms: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = ms / 1000;
    }
  }, []);

  // ── Run algorithm ───────────────────────────────────────────────────────────

  const runAlgorithm = useCallback(
    async (algorithmId: AlgorithmId) => {
      if (!selectedId || running) return;
      setRunning(algorithmId);
      setErrors((prev) => {
        const next = new Map(prev);
        next.delete(algorithmId);
        return next;
      });

      try {
        const res = await fetch(
          `/api/clip-library/benchmark/${selectedId}/detect`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ algorithm: algorithmId }),
          },
        );
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as {
          boundaries_ms: number[];
          elapsed_s: number;
        };
        setAlgorithmResults((prev) => {
          const next = new Map(prev);
          next.set(algorithmId, {
            boundaries_ms: data.boundaries_ms,
            elapsed_s: data.elapsed_s,
          });
          saveToStorage(manualCuts, next);
          return next;
        });
      } catch (err) {
        setErrors((prev) => {
          const next = new Map(prev);
          next.set(
            algorithmId,
            err instanceof Error ? err.message : String(err),
          );
          return next;
        });
      } finally {
        setRunning(null);
      }
    },
    [selectedId, running, manualCuts, saveToStorage],
  );

  const runAll = useCallback(async () => {
    if (!selectedId || runAllActive) return;
    setRunAllActive(true);
    setRunAllProgress(0);
    for (let i = 0; i < ALGORITHMS.length; i++) {
      const algo = ALGORITHMS[i];
      if (!algo) continue;
      setRunAllProgress(i);
      await runAlgorithm(algo.id);
    }
    setRunAllProgress(ALGORITHMS.length);
    setRunAllActive(false);
  }, [selectedId, runAllActive, runAlgorithm]);

  // ── Export ground truth ─────────────────────────────────────────────────────

  const exportData = () => {
    const data = {
      video_id: selectedId,
      ground_truth_ms: manualCuts,
      tolerance_ms: 500,
      algorithms: Object.fromEntries(
        ALGORITHMS.map((a) => {
          const r = algorithmResults.get(a.id);
          if (!r) return [a.id, null];
          const m = computeMetrics(manualCuts, r.boundaries_ms);
          return [
            a.id,
            {
              label: a.label,
              boundaries_ms: r.boundaries_ms,
              elapsed_s: r.elapsed_s,
              cut_count: r.boundaries_ms.length,
              metrics: m,
            },
          ];
        }),
      ),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scene-benchmark-${selectedId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const selectedVideo = videos.find((v) => v.id === selectedId);
  const streamUrl = selectedId
    ? `/api/clip-library/benchmark/${selectedId}/stream`
    : "";

  const inputStyle: React.CSSProperties = {
    padding: "7px 10px",
    borderRadius: 6,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
    color: "#e5e2e1",
    fontSize: 13,
    outline: "none",
  };

  const btnStyle = (accent = false): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 12px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    border: accent ? "none" : "1px solid rgba(var(--v2-accent-rgb),0.25)",
    background: accent ? "var(--v2-accent)" : "rgba(var(--v2-accent-rgb),0.1)",
    color: accent ? "#000" : "var(--v2-accent)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    whiteSpace: "nowrap" as const,
  });

  return (
    <div
      style={{
        marginTop: 32,
        borderTop: "1px solid rgba(var(--v2-accent-rgb),0.08)",
        paddingTop: 24,
      }}
    >
      {/* Section header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: collapsed ? 0 : 20,
          cursor: "pointer",
        }}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 20, color: "var(--v2-accent)" }}
        >
          analytics
        </span>
        <div>
          <h2
            style={{
              color: "#e5e2e1",
              fontSize: 14,
              fontWeight: 800,
              margin: 0,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Scene Detection Benchmark
          </h2>
          <p
            style={{
              color: "rgba(205,195,215,0.4)",
              fontSize: 11,
              margin: "2px 0 0 0",
            }}
          >
            Compare 8 algorithms · mark ground truth with Ctrl+B · measure
            accuracy
          </p>
        </div>
        <span
          className="material-symbols-outlined"
          style={{
            marginLeft: "auto",
            fontSize: 18,
            color: "rgba(205,195,215,0.4)",
          }}
        >
          {collapsed ? "expand_more" : "expand_less"}
        </span>
      </div>

      {!collapsed && (
        <>
          {/* Video selector */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <label
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "rgba(205,195,215,0.5)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                flexShrink: 0,
              }}
            >
              Video
            </label>
            {videos.length === 0 ? (
              <span style={{ fontSize: 12, color: "rgba(205,195,215,0.4)" }}>
                No ingested source videos found in this library.
              </span>
            ) : (
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                style={{ ...inputStyle, minWidth: 280 }}
              >
                {videos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title ?? v.id.slice(0, 8)} —{" "}
                    {v.duration_ms ? formatMs(v.duration_ms) : "?"}
                  </option>
                ))}
              </select>
            )}
            {selectedVideo && (
              <span style={{ fontSize: 11, color: "rgba(205,195,215,0.4)" }}>
                {selectedVideo.ingest_status}
              </span>
            )}
          </div>

          {selectedId && (
            <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
              {/* ── Left column: video + timeline ── */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Video player */}
                <video
                  ref={videoRef}
                  src={streamUrl}
                  controls
                  style={{
                    width: "100%",
                    borderRadius: 8,
                    background: "#000",
                    display: "block",
                  }}
                />

                {/* Status bar */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    padding: "8px 0",
                    fontSize: 11,
                    color: "rgba(205,195,215,0.6)",
                    flexWrap: "wrap",
                  }}
                >
                  <span>
                    <span
                      style={{ color: "var(--v2-accent)", fontWeight: 700 }}
                    >
                      {msToTimecode(currentMs)}
                    </span>
                  </span>
                  <span>
                    Frame{" "}
                    <span style={{ color: "#e5e2e1", fontWeight: 600 }}>
                      {Math.round((currentMs / 1000) * fps)}
                    </span>
                  </span>
                  <span>
                    <span
                      style={{
                        color: "#fff",
                        fontWeight: 700,
                        background: "rgba(255,255,255,0.1)",
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}
                    >
                      {manualCuts.length}
                    </span>{" "}
                    manual cuts
                  </span>
                  <span style={{ color: "rgba(205,195,215,0.35)" }}>
                    ← / → frame step · Ctrl+B = add cut · Space = play/pause
                  </span>
                </div>

                {/* Cut controls */}
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <button
                    style={btnStyle()}
                    onClick={() => {
                      const ms = currentMs;
                      setManualCuts((prev) => {
                        if (prev.includes(ms)) return prev;
                        return [...prev, ms].sort((a, b) => a - b);
                      });
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 14 }}
                    >
                      content_cut
                    </span>
                    Add Cut at {msToTimecode(currentMs).slice(3, 11)}
                  </button>
                  <button
                    style={{
                      ...btnStyle(),
                      color: "#ff5050",
                      borderColor: "rgba(255,80,80,0.3)",
                    }}
                    onClick={() => setManualCuts([])}
                    disabled={manualCuts.length === 0}
                  >
                    Clear All
                  </button>
                  {manualCuts.length > 0 && (
                    <button style={btnStyle()} onClick={exportData}>
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 14 }}
                      >
                        download
                      </span>
                      Export JSON
                    </button>
                  )}
                </div>

                {/* Timeline */}
                <div style={{ position: "relative" }}>
                  {loadingThumbs && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        zIndex: 30,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "rgba(0,0,0,0.6)",
                        borderRadius: 8,
                        gap: 8,
                        color: "var(--v2-accent)",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{
                          fontSize: 16,
                          animation: "spin 1.5s linear infinite",
                        }}
                      >
                        progress_activity
                      </span>
                      Generating thumbnails…
                    </div>
                  )}
                  <Timeline
                    durationMs={durationMs || 1}
                    currentMs={currentMs}
                    thumbnails={thumbnails}
                    stepS={thumbStep}
                    manualCuts={manualCuts}
                    algorithmResults={algorithmResults}
                    onSeek={seek}
                  />
                </div>

                {/* Legend */}
                {algorithmResults.size > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      marginTop: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 10,
                      }}
                    >
                      <div
                        style={{
                          width: 12,
                          height: 12,
                          background: "#fff",
                          borderRadius: 2,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ color: "rgba(205,195,215,0.7)" }}>
                        Manual (ground truth)
                      </span>
                    </div>
                    {ALGORITHMS.map((a) => {
                      if (!algorithmResults.has(a.id)) return null;
                      return (
                        <div
                          key={a.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            fontSize: 10,
                          }}
                        >
                          <div
                            style={{
                              width: 12,
                              height: 12,
                              background: a.color,
                              borderRadius: 2,
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ color: "rgba(205,195,215,0.7)" }}>
                            {a.label.split(" — ")[1] ?? a.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Manual cut list */}
                {manualCuts.length > 0 && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: "10px 12px",
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 8,
                      maxHeight: 120,
                      overflowY: "auto",
                    }}
                  >
                    <p
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "rgba(205,195,215,0.4)",
                        margin: "0 0 8px 0",
                      }}
                    >
                      Manual cuts ({manualCuts.length})
                    </p>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                      }}
                    >
                      {manualCuts.map((ms) => (
                        <span
                          key={ms}
                          onClick={() => seek(ms)}
                          style={{
                            padding: "3px 8px",
                            borderRadius: 4,
                            fontSize: 11,
                            background: "rgba(255,255,255,0.08)",
                            color: "#e5e2e1",
                            cursor: "pointer",
                            fontFamily: "monospace",
                          }}
                        >
                          {msToTimecode(ms).slice(3, 11)}
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              setManualCuts((p) => p.filter((x) => x !== ms));
                            }}
                            style={{
                              marginLeft: 4,
                              color: "rgba(205,195,215,0.4)",
                              cursor: "pointer",
                            }}
                          >
                            ×
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Right sidebar: algorithms + metrics ── */}
              <div
                style={{
                  width: 300,
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    padding: "12px 14px",
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
                    borderRadius: 10,
                  }}
                >
                  <p
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "rgba(205,195,215,0.4)",
                      margin: "0 0 12px 0",
                    }}
                  >
                    Algorithms
                  </p>

                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    {ALGORITHMS.map((algo) => {
                      const result = algorithmResults.get(algo.id);
                      const isRunning = running === algo.id;
                      const err = errors.get(algo.id);

                      return (
                        <div
                          key={algo.id}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 8,
                            background: result
                              ? `${algo.color}12`
                              : "rgba(255,255,255,0.02)",
                            border: `1px solid ${result ? `${algo.color}40` : "rgba(255,255,255,0.06)"}`,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <div
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: 2,
                                background: algo.color,
                                flexShrink: 0,
                              }}
                            />
                            <span
                              style={{
                                fontSize: 11,
                                color: "#e5e2e1",
                                fontWeight: 600,
                                flex: 1,
                                lineHeight: 1.3,
                              }}
                            >
                              {algo.label}
                            </span>
                            {!result && !isRunning && (
                              <button
                                onClick={() => void runAlgorithm(algo.id)}
                                disabled={!!running || runAllActive}
                                style={{
                                  padding: "3px 8px",
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  cursor:
                                    running || runAllActive
                                      ? "not-allowed"
                                      : "pointer",
                                  background: "rgba(var(--v2-accent-rgb),0.1)",
                                  border:
                                    "1px solid rgba(var(--v2-accent-rgb),0.2)",
                                  color: "var(--v2-accent)",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.04em",
                                  flexShrink: 0,
                                }}
                              >
                                Run
                              </button>
                            )}
                            {isRunning && (
                              <span
                                className="material-symbols-outlined"
                                style={{
                                  fontSize: 14,
                                  color: "var(--v2-accent)",
                                  animation: "spin 1.5s linear infinite",
                                  flexShrink: 0,
                                }}
                              >
                                progress_activity
                              </span>
                            )}
                          </div>

                          {result && (
                            <div
                              style={{
                                marginTop: 6,
                                fontSize: 10,
                                color: "rgba(205,195,215,0.6)",
                              }}
                            >
                              {result.boundaries_ms.length} cuts ·{" "}
                              {result.elapsed_s}s
                              {manualCuts.length > 0 &&
                                (() => {
                                  const m = computeMetrics(
                                    manualCuts,
                                    result.boundaries_ms,
                                  );
                                  return (
                                    <span style={{ marginLeft: 6 }}>
                                      · F1{" "}
                                      <span
                                        style={{
                                          color: algo.color,
                                          fontWeight: 700,
                                        }}
                                      >
                                        {m.f1.toFixed(2)}
                                      </span>
                                    </span>
                                  );
                                })()}
                            </div>
                          )}

                          {err && (
                            <p
                              style={{
                                fontSize: 10,
                                color: "#ff5050",
                                margin: "4px 0 0 0",
                                wordBreak: "break-all",
                              }}
                            >
                              {err.slice(0, 120)}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => void runAll()}
                    disabled={!!running || runAllActive || !selectedId}
                    style={{
                      ...btnStyle(true),
                      marginTop: 12,
                      width: "100%",
                      justifyContent: "center",
                      opacity: runAllActive ? 0.6 : 1,
                      cursor: runAllActive ? "not-allowed" : "pointer",
                    }}
                  >
                    {runAllActive ? (
                      <>
                        <span
                          className="material-symbols-outlined"
                          style={{
                            fontSize: 14,
                            animation: "spin 1.5s linear infinite",
                          }}
                        >
                          progress_activity
                        </span>
                        Running {runAllProgress + 1}/{ALGORITHMS.length}…
                      </>
                    ) : (
                      <>
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 14 }}
                        >
                          play_circle
                        </span>
                        Run All Algorithms
                      </>
                    )}
                  </button>
                </div>

                {/* Metrics table */}
                {manualCuts.length > 0 && algorithmResults.size > 0 && (
                  <div
                    style={{
                      padding: "12px 14px",
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
                      borderRadius: 10,
                    }}
                  >
                    <p
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "rgba(205,195,215,0.4)",
                        margin: "0 0 10px 0",
                      }}
                    >
                      Accuracy · ±500ms tolerance
                    </p>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: 11,
                      }}
                    >
                      <thead>
                        <tr>
                          {["Algorithm", "P", "R", "F1"].map((h) => (
                            <th
                              key={h}
                              style={{
                                textAlign: h === "Algorithm" ? "left" : "right",
                                color: "rgba(205,195,215,0.4)",
                                fontWeight: 700,
                                fontSize: 9,
                                textTransform: "uppercase",
                                letterSpacing: "0.06em",
                                paddingBottom: 6,
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ALGORITHMS.map((algo) => {
                          const result = algorithmResults.get(algo.id);
                          if (!result) return null;
                          const m = computeMetrics(
                            manualCuts,
                            result.boundaries_ms,
                          );
                          return (
                            <tr key={algo.id}>
                              <td
                                style={{
                                  paddingBottom: 4,
                                  color: algo.color,
                                  fontSize: 10,
                                  maxWidth: 140,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {algo.label.split(" — ")[1] ?? algo.label}
                              </td>
                              <td
                                style={{
                                  textAlign: "right",
                                  paddingBottom: 4,
                                  color: "#e5e2e1",
                                  fontFamily: "monospace",
                                  fontSize: 11,
                                }}
                              >
                                {m.precision.toFixed(2)}
                              </td>
                              <td
                                style={{
                                  textAlign: "right",
                                  paddingBottom: 4,
                                  color: "#e5e2e1",
                                  fontFamily: "monospace",
                                  fontSize: 11,
                                }}
                              >
                                {m.recall.toFixed(2)}
                              </td>
                              <td
                                style={{
                                  textAlign: "right",
                                  paddingBottom: 4,
                                  fontFamily: "monospace",
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: algo.color,
                                }}
                              >
                                {m.f1.toFixed(2)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    <p
                      style={{
                        fontSize: 9,
                        color: "rgba(205,195,215,0.3)",
                        margin: "8px 0 0 0",
                        lineHeight: 1.4,
                      }}
                    >
                      Ground truth: {manualCuts.length} cuts. P = precision, R =
                      recall, F1 = harmonic mean. A cut is a TP if within ±500ms
                      of a ground truth cut.
                    </p>

                    <button
                      onClick={exportData}
                      style={{
                        ...btnStyle(),
                        marginTop: 10,
                        width: "100%",
                        justifyContent: "center",
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 14 }}
                      >
                        download
                      </span>
                      Export Full Report JSON
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
