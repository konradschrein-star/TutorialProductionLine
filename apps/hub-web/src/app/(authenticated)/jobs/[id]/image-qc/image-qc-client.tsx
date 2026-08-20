"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SceneQCCard } from "@/components/jobs/scene-qc-card";
import { GenerationLogViewer } from "@/components/jobs/generation-log-viewer";
import { V2Button, V2Card } from "@/app/(authenticated)/_components";
import {
  approveImageQC,
  regenerateSceneImage,
  getNextImageQCJob,
} from "@/app/actions/jobs";
import { useSSE } from "@/hooks/use-sse";

/**
 * V2 Image QC Review Page Client Component
 *
 * VA reviews all generated scene images before the job proceeds to render.
 * Keyboard-first: ←/→ navigate, R regenerate, Ctrl+Enter approve.
 *
 * Real-time updates via SSE: Listens for scene_image_complete events
 * and auto-refreshes images. Falls back to polling if SSE unavailable.
 */

interface Scene {
  scene_index: number;
  paragraph: string;
  visual_asset_key: string | null;
  image_prompt?: string | null;
}

async function fetchJob(id: string) {
  const res = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

export function V2ImageQCPageClient({ jobId }: { jobId: string }) {
  const router = useRouter();

  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedBatch, setSelectedBatch] = useState<Set<number>>(new Set());
  const [approving, setApproving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [regeneratingBatch, setRegeneratingBatch] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [showHotkeys, setShowHotkeys] = useState(false);
  const [regeneratingScenes, setRegeneratingScenes] = useState<Set<number>>(
    new Set(),
  );
  const [detailTab, setDetailTab] = useState<"details" | "logs">("details");
  const lastShiftClickRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // SSE hook for real-time scene image completion events
  const { data: sseEvent, isConnected } = useSSE("scene_image_complete");

  const load = useCallback(async () => {
    const data = await fetchJob(jobId);
    setJob(data);
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  // Handle SSE events for scene image completion
  useEffect(() => {
    if (!sseEvent || sseEvent.event_type !== "scene_image_complete") return;
    if (sseEvent.job_id !== jobId) return;

    const sceneIndex = sseEvent.payload?.scene_index;
    if (sceneIndex === undefined) return;

    // Remove scene from regenerating set
    setRegeneratingScenes((prev) => {
      const next = new Set(prev);
      next.delete(sceneIndex);
      return next;
    });

    // Reload job data to get updated asset manifest
    load();
  }, [sseEvent, jobId, load]);

  // Fallback polling: only when SSE is not connected and no active regenerations
  useEffect(() => {
    if (isConnected || regeneratingScenes.size > 0) {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      return;
    }

    refreshTimerRef.current = setInterval(load, 8000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [isConnected, regeneratingScenes.size, load]);

  const scenes: Scene[] = job?.assembly_manifest?.scenes ?? [];
  const r2Manifest: any[] = job?.r2_asset_manifest ?? [];
  const tolerance: number =
    job?.template?.render_config?.misgeneration_tolerance_pct ?? 15;

  const imageUrlMap: Record<number, string | null> = {};
  for (const scene of scenes) {
    const asset = r2Manifest.find(
      (a) => a.type === "image/broll" && a.scene_index === scene.scene_index,
    );
    if (asset) {
      imageUrlMap[scene.scene_index] =
        `/api/assets/${jobId}/${encodeURIComponent(asset.key)}`;
    } else if (scene.visual_asset_key) {
      imageUrlMap[scene.scene_index] =
        `/api/assets/${jobId}/${encodeURIComponent(scene.visual_asset_key)}`;
    } else {
      imageUrlMap[scene.scene_index] = null;
    }
  }

  const missingCount = scenes.filter((s) => !imageUrlMap[s.scene_index]).length;
  const missingPct =
    scenes.length > 0 ? (missingCount / scenes.length) * 100 : 0;
  const withinTolerance = missingPct <= tolerance;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft" || e.key === "k") {
        setSelectedIndex((i) => Math.max(0, i - 1));
        setSelectedBatch(new Set());
      } else if (e.key === "ArrowRight" || e.key === "j") {
        setSelectedIndex((i) => Math.min(scenes.length - 1, i + 1));
        setSelectedBatch(new Set());
      } else if (e.key === "r" || e.key === "R") {
        const scene = scenes[selectedIndex];
        if (scene) {
          setRegeneratingScenes((prev) => new Set(prev).add(scene.scene_index));
          regenerateSceneImage(jobId, scene.scene_index).catch(() => {
            setRegeneratingScenes((prev) => {
              const next = new Set(prev);
              next.delete(scene.scene_index);
              return next;
            });
          });
        }
      } else if (e.key === "s" || e.key === "S") {
        handleSkip();
      } else if (e.key === "?") {
        setShowHotkeys((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        handleApprove();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        selectAllMissing();
      } else if (e.key >= "1" && e.key <= "9") {
        setSelectedIndex(Math.min(Number(e.key) - 1, scenes.length - 1));
        setSelectedBatch(new Set());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, selectedIndex, jobId]);

  async function navigateToNextImageQCJob() {
    const { jobId: nextId } = await getNextImageQCJob(jobId);
    if (nextId) {
      router.push(`/jobs/${nextId}/image-qc`);
    } else {
      // `__va_queue__` was never a resolvable filter — it fell through
      // resolveStatusFilter and was matched as a literal status, i.e. zero
      // rows. `needs-human` is a real group. (NOTE: this component is not
      // imported anywhere; page.tsx carries the live implementation.)
      router.push("/jobs?status=needs-human&approved=1");
    }
  }

  async function handleApprove() {
    if (approving) return;
    setApproving(true);
    setApproveError(null);
    const result = await approveImageQC(jobId);
    if (result.success) {
      await navigateToNextImageQCJob();
    } else {
      setApproveError(result.error ?? "Failed to approve");
      setApproving(false);
    }
  }

  async function handleSkip() {
    if (skipping) return;
    setSkipping(true);
    await navigateToNextImageQCJob();
  }

  function selectAllMissing() {
    const missing = new Set<number>();
    for (const scene of scenes) {
      if (!imageUrlMap[scene.scene_index]) {
        missing.add(scenes.indexOf(scene));
      }
    }
    setSelectedBatch(missing);
  }

  function toggleSceneSelection(idx: number, e: React.MouseEvent) {
    if (e.shiftKey && lastShiftClickRef.current !== null) {
      // Shift+click: select range
      const start = Math.min(lastShiftClickRef.current, idx);
      const end = Math.max(lastShiftClickRef.current, idx);
      const newSelected = new Set(selectedBatch);
      for (let i = start; i <= end; i++) {
        newSelected.add(i);
      }
      setSelectedBatch(newSelected);
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+click: toggle
      const newSelected = new Set(selectedBatch);
      if (newSelected.has(idx)) {
        newSelected.delete(idx);
      } else {
        newSelected.add(idx);
      }
      setSelectedBatch(newSelected);
      lastShiftClickRef.current = idx;
    } else {
      // Regular click: clear selection and show detail panel
      setSelectedIndex(idx);
      setSelectedBatch(new Set());
      lastShiftClickRef.current = idx;
    }
  }

  async function handleRegenerateSelected() {
    if (regeneratingBatch || selectedBatch.size === 0) return;
    setRegeneratingBatch(true);
    try {
      const indices = Array.from(selectedBatch).sort();
      const sceneIndices = indices
        .map((idx) => scenes[idx]?.scene_index)
        .filter((idx): idx is number => idx !== undefined);

      // Add all scenes to regenerating set
      setRegeneratingScenes((prev) => new Set([...prev, ...sceneIndices]));

      // Request regeneration for all scenes
      for (const idx of indices) {
        const scene = scenes[idx];
        if (scene) {
          regenerateSceneImage(jobId, scene.scene_index).catch(() => {
            // On error, remove from regenerating set
            setRegeneratingScenes((prev) => {
              const next = new Set(prev);
              next.delete(scene.scene_index);
              return next;
            });
          });
        }
      }
    } finally {
      setRegeneratingBatch(false);
    }
  }

  if (loading) {
    return (
      <div
        style={{
          minHeight: "60vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--v2-text-3)",
          fontSize: 13,
        }}
      >
        Loading…
      </div>
    );
  }

  if (!job) {
    return (
      <div
        style={{
          minHeight: "60vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--v2-error-soft)",
          fontSize: 13,
        }}
      >
        Job not found
      </div>
    );
  }

  if (job.status !== "AWAITING_IMAGE_QC") {
    return (
      <div
        style={{
          minHeight: "60vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
        }}
      >
        <p style={{ fontSize: 13, color: "var(--v2-text-3)" }}>
          Job is not in AWAITING_IMAGE_QC (current:{" "}
          <strong style={{ color: "var(--v2-text-1)" }}>{job.status}</strong>)
        </p>
        <Link
          href={`/jobs/${jobId}`}
          style={{
            fontSize: 12,
            color: "var(--v2-accent)",
            textDecoration: "none",
          }}
        >
          ← Back to job
        </Link>
      </div>
    );
  }

  const selectedScene = scenes[selectedIndex];
  const selectedImageUrl = selectedScene
    ? (imageUrlMap[selectedScene.scene_index] ?? null)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Sticky top bar */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "var(--v2-surface-0)",
          borderBottom: "1px solid var(--v2-border-1)",
          padding: "12px 0",
          marginTop: -8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          {/* Left: back + title */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              minWidth: 0,
            }}
          >
            <Link
              href={`/jobs/${jobId}`}
              style={{
                color: "var(--v2-text-3)",
                textDecoration: "none",
                display: "flex",
                flexShrink: 0,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 20 }}
              >
                arrow_back
              </span>
            </Link>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--v2-text-1)",
                }}
              >
                Image QC Review
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--v2-text-3)",
                  fontFamily: "monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {jobId}
              </div>
            </div>
          </div>

          {/* Center: tolerance indicator */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 14px",
              borderRadius: 20,
              fontSize: 10,
              fontWeight: 700,
              border: `1px solid ${withinTolerance ? "rgba(var(--v2-success-rgb), 0.25)" : "rgba(var(--v2-error-rgb), 0.3)"}`,
              background: withinTolerance
                ? "rgba(var(--v2-success-rgb), 0.08)"
                : "rgba(var(--v2-error-rgb), 0.08)",
              color: withinTolerance
                ? "var(--v2-success)"
                : "var(--v2-error-soft)",
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: withinTolerance
                  ? "var(--v2-success)"
                  : "var(--v2-error-soft)",
                boxShadow: withinTolerance
                  ? "0 0 6px rgba(var(--v2-success-rgb), 0.6)"
                  : "0 0 6px rgba(var(--v2-error-rgb), 0.6)",
              }}
            />
            {missingCount}/{scenes.length} missing
            {withinTolerance
              ? ` · within ${tolerance}% ✓`
              : ` · exceeds ${tolerance}%`}
          </div>

          {/* Right: actions */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
            }}
          >
            {selectedBatch.size > 0 && (
              <>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--v2-text-3)",
                    fontWeight: 600,
                  }}
                >
                  {selectedBatch.size} selected
                </span>

                <V2Button
                  onClick={() => setSelectedBatch(new Set())}
                  variant="default"
                  size="sm"
                  title="Clear selection"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                  >
                    close
                  </span>
                </V2Button>

                <V2Button
                  onClick={handleRegenerateSelected}
                  disabled={regeneratingBatch}
                  variant="default"
                  size="sm"
                  title="Regenerate all selected images"
                >
                  {regeneratingBatch ? (
                    <span
                      className="material-symbols-outlined"
                      style={{
                        fontSize: 16,
                        animation: "spin 1s linear infinite",
                      }}
                    >
                      progress_activity
                    </span>
                  ) : (
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 16 }}
                    >
                      refresh
                    </span>
                  )}
                  Regenerate Selected
                </V2Button>

                <div
                  style={{
                    width: 1,
                    height: 20,
                    background: "rgba(75,68,85,0.3)",
                  }}
                />
              </>
            )}

            <V2Button
              onClick={selectAllMissing}
              variant="default"
              size="sm"
              title="Select all images without visual assets (Ctrl+A)"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                select_all
              </span>
              Missing
            </V2Button>

            <V2Button
              onClick={() => setShowHotkeys(true)}
              variant="default"
              size="sm"
              title="Keyboard shortcuts (?)"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                keyboard
              </span>
            </V2Button>

            {approveError && (
              <span style={{ fontSize: 11, color: "var(--v2-error-soft)" }}>
                {approveError}
              </span>
            )}

            <V2Button
              onClick={handleSkip}
              disabled={skipping || approving}
              variant="default"
              size="sm"
              title="Skip to next job (S)"
            >
              {skipping ? (
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16, animation: "spin 1s linear infinite" }}
                >
                  progress_activity
                </span>
              ) : (
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16 }}
                >
                  skip_next
                </span>
              )}
              Skip
              <kbd style={{ fontSize: 9, opacity: 0.5 }}>S</kbd>
            </V2Button>

            <V2Button
              onClick={handleApprove}
              disabled={approving || !withinTolerance}
              variant="accent"
              size="sm"
              title="Approve & Render (Ctrl+Enter)"
            >
              {approving ? (
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16, animation: "spin 1s linear infinite" }}
                >
                  progress_activity
                </span>
              ) : (
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16 }}
                >
                  check_circle
                </span>
              )}
              Approve & Render
              <kbd style={{ fontSize: 9, opacity: 0.5 }}>⌃↵</kbd>
            </V2Button>
          </div>
        </div>
      </div>

      {/* Scene grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 10,
        }}
      >
        {scenes.map((scene, idx) => {
          // Add cache buster query param to image URL
          const baseUrl = imageUrlMap[scene.scene_index];
          const isRegenerating = regeneratingScenes.has(scene.scene_index);
          const imageUrl =
            baseUrl && !isRegenerating ? `${baseUrl}?t=${Date.now()}` : baseUrl;

          return (
            <SceneQCCard
              key={scene.scene_index}
              jobId={jobId}
              scene={scene}
              imageUrl={imageUrl}
              isSelected={idx === selectedIndex}
              isBatchSelected={selectedBatch.has(idx)}
              isRegenerating={isRegenerating}
              onClick={(e) => toggleSceneSelection(idx, e)}
              onRegenerate={(sceneIndex) => {
                setRegeneratingScenes((prev) => new Set(prev).add(sceneIndex));
                regenerateSceneImage(jobId, sceneIndex).catch(() => {
                  setRegeneratingScenes((prev) => {
                    const next = new Set(prev);
                    next.delete(sceneIndex);
                    return next;
                  });
                });
              }}
              onUpload={(sceneIndex) => {
                // Remove from regenerating set when upload completes
                setRegeneratingScenes((prev) => {
                  const next = new Set(prev);
                  next.delete(sceneIndex);
                  return next;
                });
              }}
              onRegenerated={load}
              generationLog={job?.generation_log ?? []}
              onViewLogs={() => setDetailTab("logs")}
            />
          );
        })}
      </div>

      {scenes.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "80px 0",
            color: "var(--v2-text-3)",
            fontSize: 13,
          }}
        >
          No scenes found in assembly manifest.
        </div>
      )}

      {/* Selected scene detail panel */}
      {selectedScene && (
        <V2Card noPadding>
          {/* Panel header with tabs */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 20px",
              borderBottom: "1px solid var(--v2-border-1)",
              background: "var(--v2-surface-0)",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: "monospace",
                  fontWeight: 700,
                  color: "var(--v2-accent)",
                }}
              >
                Scene #{selectedScene.scene_index}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: "var(--v2-text-3)",
                }}
              >
                {selectedIndex + 1} / {scenes.length}
              </span>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setDetailTab("details")}
                style={{
                  fontSize: 10,
                  fontWeight: detailTab === "details" ? 700 : 500,
                  color:
                    detailTab === "details"
                      ? "var(--v2-accent)"
                      : "var(--v2-text-3)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 0",
                  borderBottom:
                    detailTab === "details"
                      ? "2px solid var(--v2-accent)"
                      : "transparent",
                  transition: "all 0.15s",
                }}
              >
                Details
              </button>
              <button
                onClick={() => setDetailTab("logs")}
                style={{
                  fontSize: 10,
                  fontWeight: detailTab === "logs" ? 700 : 500,
                  color:
                    detailTab === "logs"
                      ? "var(--v2-accent)"
                      : "var(--v2-text-3)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 0",
                  borderBottom:
                    detailTab === "logs"
                      ? "2px solid var(--v2-accent)"
                      : "transparent",
                  transition: "all 0.15s",
                }}
              >
                Logs
              </button>
            </div>
          </div>

          {detailTab === "details" && (
            <>
              {/* Panel body: image + text */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                {/* Image */}
                <div
                  style={{
                    padding: 20,
                    borderRight: "1px solid var(--v2-border-1)",
                  }}
                >
                  {selectedImageUrl ? (
                    <img
                      src={selectedImageUrl}
                      alt={`Scene ${selectedScene.scene_index} full`}
                      style={{
                        width: "100%",
                        borderRadius: 8,
                        objectFit: "contain",
                        maxHeight: 280,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: 160,
                        borderRadius: 8,
                        background: "rgba(var(--v2-error-rgb), 0.08)",
                        border: "1px solid rgba(var(--v2-error-rgb), 0.2)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 32, color: "var(--v2-error-soft)" }}
                      >
                        hide_image
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          color: "var(--v2-error-soft)",
                          fontWeight: 600,
                        }}
                      >
                        No image generated
                      </span>
                    </div>
                  )}
                </div>

                {/* Text */}
                <div
                  style={{
                    padding: 20,
                    display: "flex",
                    flexDirection: "column",
                    gap: 20,
                  }}
                >
                  <div>
                    <p
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: "var(--v2-text-3)",
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        marginBottom: 8,
                      }}
                    >
                      Paragraph
                    </p>
                    <p
                      style={{
                        fontSize: 12,
                        color: "var(--v2-text-1)",
                        lineHeight: 1.6,
                      }}
                    >
                      {selectedScene.paragraph}
                    </p>
                  </div>
                  {selectedScene.image_prompt && (
                    <div>
                      <p
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          color: "var(--v2-text-3)",
                          textTransform: "uppercase",
                          letterSpacing: "0.1em",
                          marginBottom: 8,
                        }}
                      >
                        Image Prompt
                      </p>
                      <p
                        style={{
                          fontSize: 11,
                          color: "var(--v2-text-2)",
                          lineHeight: 1.6,
                          fontFamily: "monospace",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {selectedScene.image_prompt}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {detailTab === "logs" && (
            <>
              {/* Generation errors section */}
              {job?.generation_log && job.generation_log.length > 0 && (
                <div
                  style={{
                    borderTop: "1px solid var(--v2-border-1)",
                  }}
                >
                  <div
                    style={{
                      padding: "12px 20px",
                      borderBottom: "1px solid var(--v2-border-1)",
                      background: "var(--v2-surface-0)",
                    }}
                  >
                    <p
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "var(--v2-text-1)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        margin: 0,
                      }}
                    >
                      Generation Log
                    </p>
                  </div>
                  <div style={{ padding: 20 }}>
                    <GenerationLogViewer generationLog={job.generation_log} />
                  </div>
                </div>
              )}
            </>
          )}
        </V2Card>
      )}

      {/* Hotkey modal */}
      {showHotkeys && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.7)",
            backdropFilter: "blur(8px)",
          }}
          onClick={() => setShowHotkeys(false)}
        >
          <V2Card noPadding>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: 24,
                marginBottom: 0,
                borderBottom: "1px solid var(--v2-border-1)",
              }}
            >
              <h2
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--v2-text-1)",
                  margin: 0,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Keyboard Shortcuts
              </h2>
              <button
                onClick={() => setShowHotkeys(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--v2-text-3)",
                  padding: 4,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 18 }}
                >
                  close
                </span>
              </button>
            </div>
            <div
              style={{
                padding: 24,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              {[
                ["← / K", "Previous scene"],
                ["→ / J", "Next scene"],
                ["1–9", "Jump to scene"],
                ["Click", "Select single scene"],
                ["Shift+Click", "Range select"],
                ["Ctrl/Cmd+Click", "Toggle selection"],
                ["Ctrl/Cmd+A", "Select all missing"],
                ["R", "Regenerate selected"],
                ["S", "Skip to next job"],
                ["Ctrl+Enter", "Approve & render"],
                ["?", "Toggle this panel"],
              ].map(([key, desc]) => (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <kbd
                    style={{
                      padding: "3px 8px",
                      background: "var(--v2-surface-0)",
                      border: "1px solid var(--v2-border-1)",
                      borderRadius: 4,
                      fontSize: 10,
                      fontFamily: "monospace",
                      color: "var(--v2-accent)",
                      fontWeight: 700,
                    }}
                  >
                    {key}
                  </kbd>
                  <span style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
                    {desc}
                  </span>
                </div>
              ))}
            </div>
          </V2Card>
        </div>
      )}
    </div>
  );
}
