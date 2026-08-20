"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SceneQCCard } from "@/components/jobs/scene-qc-card";
import { SceneUploadCard } from "@/components/jobs/scene-upload-card";
import { HITLNavigation } from "@/components/hitl-navigation";
import {
  approveImageQC,
  regenerateSceneImage,
  getNextImageQCJob,
  claimHITLJob,
  skipHITLJob,
  releaseHITLJob,
} from "@/app/actions/jobs";
import {
  HotkeyHelpButton,
  isTypingTarget,
  useHotkeyHelp,
} from "@/components/hitl/hotkey-help";

/**
 * V2 Image QC Review Page
 *
 * VA reviews all generated scene images before the job proceeds to render.
 * Keyboard-first, on the shared HITL contract (components/hitl/hotkey-help):
 * J/→ and K/← move scenes, A or Ctrl+Enter approves, R regenerates, S skips
 * the job, ? shows every binding.
 */

/**
 * Where a VA lands when the image-QC queue is empty. `needs-human` is a real
 * filter group in job-stage.ts — the old `__va_queue__` value was not aliased
 * anywhere, so it fell through as a literal status and matched zero rows: every
 * last approval of the day ended on an empty list.
 */
const IMAGE_QC_QUEUE_EXIT = "/jobs?status=needs-human&approved=1";

interface Scene {
  scene_index: number;
  paragraph: string;
  visual_asset_key: string | null;
  image_prompt?: string | null;
}

interface ImageQCPageProps {
  params: Promise<{ id: string }>;
}

async function fetchJob(id: string) {
  const res = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

export default function V2ImageQCPage({ params }: ImageQCPageProps) {
  const { id: jobId } = use(params);
  const router = useRouter();

  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [approving, setApproving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [claimWarning, setClaimWarning] = useState(false);
  const help = useHotkeyHelp("Image QC shortcuts", [
    { keys: "J / →", description: "Next scene" },
    { keys: "K / ←", description: "Previous scene" },
    { keys: "1–9", description: "Jump to scene" },
    { keys: "R", description: "Regenerate selected scene" },
  ]);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const data = await fetchJob(jobId);
    setJob(data);
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    refreshTimerRef.current = setInterval(load, 8000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [load]);

  // Claim the job so the next-item handout routes other VAs around it.
  useEffect(() => {
    let cancelled = false;
    claimHITLJob("image-qc", jobId).then((claim) => {
      if (!cancelled) setClaimWarning(!claim.mine);
    });
    return () => {
      cancelled = true;
      // Best effort: leaving frees the job immediately instead of parking it
      // behind the full claim TTL.
      void releaseHITLJob(jobId);
    };
  }, [jobId]);

  const scenes: Scene[] = job?.assembly_manifest?.scenes ?? [];
  const r2Manifest: any[] = job?.r2_asset_manifest ?? [];
  const tolerance: number =
    job?.template?.render_config?.misgeneration_tolerance_pct ?? 15;
  const isManualMode = job?.image_generation_mode === "manual";

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
      if (isTypingTarget(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleApprove();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "ArrowLeft" || e.key === "k" || e.key === "K") {
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight" || e.key === "j" || e.key === "J") {
        setSelectedIndex((i) => Math.min(scenes.length - 1, i + 1));
      } else if (e.key === "a" || e.key === "A") {
        // Shared contract: A approves on every gate (Ctrl+Enter still works).
        handleApprove();
      } else if (e.key === "r" || e.key === "R") {
        const scene = scenes[selectedIndex];
        if (scene) regenerateSceneImage(jobId, scene.scene_index).then(load);
      } else if (e.key === "s" || e.key === "S") {
        handleSkip();
      } else if (e.key >= "1" && e.key <= "9") {
        setSelectedIndex(Math.min(Number(e.key) - 1, scenes.length - 1));
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
      router.push(IMAGE_QC_QUEUE_EXIT);
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

  /**
   * Skip: release our claim (so another VA can take this job), remember not to
   * hand it back to us for a while, and route on to the next FREE job.
   */
  async function handleSkip() {
    if (skipping) return;
    setSkipping(true);
    const result = await skipHITLJob("image-qc", jobId);
    if (result.jobId) {
      router.push(`/jobs/${result.jobId}/image-qc`);
      return;
    }
    if (result.allClaimed) {
      setApproveError(
        "Every other job in the image-QC queue is being reviewed right now.",
      );
      setSkipping(false);
      return;
    }
    router.push(IMAGE_QC_QUEUE_EXIT);
  }

  if (loading) {
    return (
      <div
        style={{
          minHeight: "60vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(205,195,215,0.5)",
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
          color: "#ffb4ab",
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
        <p style={{ fontSize: 13, color: "rgba(205,195,215,0.5)" }}>
          Job is not in AWAITING_IMAGE_QC (current:{" "}
          <strong style={{ color: "#e5e2e1" }}>{job.status}</strong>){" — "}
          somebody may have reviewed it already.
        </p>
        {/* Dead end otherwise: give the VA the next job instead of making them
            navigate back through the list by hand. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => navigateToNextImageQCJob()}
            className="v2-btn-accent"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              skip_next
            </span>
            Next image-QC job
          </button>
          <Link
            href={`/jobs/${jobId}`}
            style={{
              fontSize: 12,
              color: "var(--v2-accent, #aaff00)",
              textDecoration: "none",
            }}
          >
            ← Back to job
          </Link>
        </div>
      </div>
    );
  }

  const selectedScene = scenes[selectedIndex];
  const selectedImageUrl = selectedScene
    ? (imageUrlMap[selectedScene.scene_index] ?? null)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* HITL Navigation */}
      <HITLNavigation currentJobId={jobId} hitlType="image-qc" />

      {/* Another VA already holds the claim on this job. */}
      {claimWarning && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 11,
            color: "#ffb15c",
            background: "rgba(255,140,0,0.1)",
            border: "1px solid rgba(255,140,0,0.35)",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            group
          </span>
          Another VA is reviewing this job right now — press{" "}
          <kbd style={{ fontFamily: "monospace" }}>S</kbd> to take one nobody
          has claimed.
        </div>
      )}

      {/* Sticky top bar */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "#000",
          borderBottom: "1px solid rgba(var(--v2-accent-rgb, 170,255,0), 0.1)",
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
                color: "rgba(205,195,215,0.5)",
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
              <div style={{ fontSize: 13, fontWeight: 700, color: "#e5e2e1" }}>
                Image QC Review{isManualMode ? " (Manual Upload)" : ""}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(205,195,215,0.4)",
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
              border: `1px solid ${withinTolerance ? "rgba(35,222,203,0.25)" : "rgba(255,180,171,0.3)"}`,
              background: withinTolerance
                ? "rgba(35,222,203,0.08)"
                : "rgba(255,180,171,0.08)",
              color: withinTolerance ? "#23decb" : "#ffb4ab",
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: withinTolerance ? "#23decb" : "#ffb4ab",
                boxShadow: withinTolerance
                  ? "0 0 6px rgba(35,222,203,0.6)"
                  : "0 0 6px rgba(255,180,171,0.6)",
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
            <HotkeyHelpButton onClick={help.open} />

            {approveError && (
              <span style={{ fontSize: 11, color: "#ffb4ab" }}>
                {approveError}
              </span>
            )}

            <button
              onClick={handleSkip}
              disabled={skipping || approving}
              className="v2-btn"
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
            </button>

            <button
              onClick={handleApprove}
              disabled={approving || !withinTolerance}
              className="v2-btn-accent"
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
            </button>
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
        {scenes.map((scene, idx) =>
          isManualMode ? (
            <SceneUploadCard
              key={scene.scene_index}
              jobId={jobId}
              scene={scene}
              imageUrl={imageUrlMap[scene.scene_index] ?? null}
              isSelected={idx === selectedIndex}
              onClick={() => setSelectedIndex(idx)}
              onUploaded={load}
            />
          ) : (
            <SceneQCCard
              key={scene.scene_index}
              jobId={jobId}
              scene={scene}
              imageUrl={imageUrlMap[scene.scene_index] ?? null}
              isSelected={idx === selectedIndex}
              onClick={() => setSelectedIndex(idx)}
              onRegenerated={load}
            />
          ),
        )}
      </div>

      {scenes.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "80px 0",
            color: "rgba(205,195,215,0.4)",
            fontSize: 13,
          }}
        >
          No scenes found in assembly manifest.
        </div>
      )}

      {/* Selected scene detail panel */}
      {selectedScene && (
        <div
          style={{
            background: "#151515",
            border: "1px solid rgba(var(--v2-accent-rgb, 170,255,0), 0.2)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {/* Panel header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 20px",
              borderBottom: "1px solid rgba(75,68,85,0.2)",
              background: "#131313",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontFamily: "monospace",
                fontWeight: 700,
                color: "var(--v2-accent, #aaff00)",
              }}
            >
              Scene #{selectedScene.scene_index}
            </span>
            <span
              style={{
                fontSize: 10,
                color: "rgba(205,195,215,0.4)",
                marginLeft: "auto",
              }}
            >
              {selectedIndex + 1} / {scenes.length}
            </span>
          </div>

          {/* Panel body: image + text */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            {/* Image */}
            <div
              style={{
                padding: 20,
                borderRight: "1px solid rgba(75,68,85,0.15)",
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
                    background: "rgba(255,180,171,0.08)",
                    border: "1px solid rgba(255,180,171,0.2)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 32, color: "#ffb4ab" }}
                  >
                    hide_image
                  </span>
                  <span
                    style={{ fontSize: 12, color: "#ffb4ab", fontWeight: 600 }}
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
                    color: "rgba(205,195,215,0.4)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    marginBottom: 8,
                  }}
                >
                  Paragraph
                </p>
                <p style={{ fontSize: 12, color: "#e5e2e1", lineHeight: 1.6 }}>
                  {selectedScene.paragraph}
                </p>
              </div>
              {selectedScene.image_prompt && (
                <div>
                  <p
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: "rgba(205,195,215,0.4)",
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
                      color: "rgba(205,195,215,0.55)",
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
        </div>
      )}

      {/* Shared HITL hotkey overlay — one panel per page, merged rows. */}
      {help.overlay}
    </div>
  );
}
