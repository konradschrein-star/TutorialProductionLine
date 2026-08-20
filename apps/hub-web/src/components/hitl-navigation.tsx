"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  getHITLJobsByStatus,
  getHITLStats,
  getNextImageQCJob,
  getNextQCJob,
  getNextProductionVAJob,
  getNextVAReviewJob,
} from "@/app/actions/jobs";
import {
  HotkeyHelpButton,
  isTypingTarget,
  useHotkeyHelp,
} from "@/components/hitl/hotkey-help";

interface HITLJob {
  id: string;
  title?: string;
  /** Another VA currently holds the soft claim on this job. */
  claimedByOther?: boolean;
  mine?: boolean;
}

type HITLType = "image-qc" | "final-qc" | "production-va" | "va-review";

interface HITLNavigationProps {
  currentJobId: string;
  hitlType: HITLType;
}

/** Queue refresh cadence while the tab is in the foreground. */
const POLL_INTERVAL_MS = 30_000;
/** Stop polling a tab nobody has touched for this long. */
const IDLE_TIMEOUT_MS = 5 * 60_000;

/**
 * Global HITL Navigation Component
 *
 * Features:
 * - Keyboard shortcuts: Ctrl+N (next job), Ctrl+P (previous job), ? (help).
 *   On final QC — where the job IS the item — plain J/K also move between jobs;
 *   on gates with items inside them J/K belong to the items, so they are not
 *   bound here.
 * - Job queue dropdown showing all HITL jobs in queue order, marking the ones
 *   another VA has already taken.
 * - Breadcrumbs showing position in queue
 *
 * Polling: foreground-only, every 30s, and suspended entirely once the tab has
 * been idle for 5 minutes (it used to hammer two server actions every 5s per
 * open tab, forever — VAs keep these tabs open all day).
 */
export function HITLNavigation({
  currentJobId,
  hitlType,
}: HITLNavigationProps) {
  const router = useRouter();

  const [jobs, setJobs] = useState<HITLJob[]>([]);
  const [stats, setStats] = useState({
    imageQCCount: 0,
    finalQCCount: 0,
    productionVACount: 0,
    vaReviewCount: 0,
  });
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  // Registers no rows of its own: Ctrl+N / Ctrl+P are already in the shared
  // contract, and the gate mounted alongside this bar owns the gate-specific
  // keys. Registering here keeps `?` working on gates that are nothing but this
  // bar (production VA).
  const help = useHotkeyHelp("Queue shortcuts", []);
  const lastActivityRef = useRef<number>(Date.now());

  const statusMap: Record<
    HITLType,
    | "AWAITING_IMAGE_QC"
    | "AWAITING_QC"
    | "AWAITING_PRODUCTION_VA"
    | "AWAITING_VA_REVIEW"
  > = {
    "image-qc": "AWAITING_IMAGE_QC",
    "final-qc": "AWAITING_QC",
    "production-va": "AWAITING_PRODUCTION_VA",
    "va-review": "AWAITING_VA_REVIEW",
  };

  const labelMap: Record<HITLType, string> = {
    "image-qc": "Image QC",
    "final-qc": "Final QC",
    "production-va": "Production VA",
    "va-review": "B-Roll Studio",
  };

  const iconMap: Record<HITLType, string> = {
    "image-qc": "image",
    "final-qc": "video_camera",
    "production-va": "person",
    "va-review": "movie_edit",
  };

  const loadJobs = useCallback(async () => {
    try {
      const [jobsData, statsData] = await Promise.all([
        getHITLJobsByStatus(statusMap[hitlType]),
        getHITLStats(),
      ]);
      setJobs(jobsData);
      setStats(statsData);
    } catch (error) {
      console.error("Failed to load HITL jobs:", error);
    }
    // statusMap is a literal rebuilt every render; hitlType is the real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitlType]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // Track real activity so an abandoned tab stops polling.
  useEffect(() => {
    const bump = () => {
      lastActivityRef.current = Date.now();
    };
    const events: Array<keyof WindowEventMap> = [
      "keydown",
      "pointerdown",
      "focus",
    ];
    for (const ev of events) window.addEventListener(ev, bump);
    return () => {
      for (const ev of events) window.removeEventListener(ev, bump);
    };
  }, []);

  // Foreground-only polling, refreshed immediately when the tab is re-focused
  // so a VA coming back to the tab never acts on a stale queue.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActivityRef.current > IDLE_TIMEOUT_MS) return;
      loadJobs();
    };
    const timer = setInterval(tick, POLL_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        lastActivityRef.current = Date.now();
        loadJobs();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadJobs]);

  const currentIndex = jobs.findIndex((j) => j.id === currentJobId);
  const totalJobs = jobs.length;
  const queuePosition = currentIndex >= 0 ? currentIndex + 1 : 0;

  const getNextJobId = async () => {
    try {
      const result =
        hitlType === "image-qc"
          ? await getNextImageQCJob(currentJobId)
          : hitlType === "final-qc"
            ? await getNextQCJob(currentJobId)
            : hitlType === "va-review"
              ? await getNextVAReviewJob(currentJobId)
              : await getNextProductionVAJob(currentJobId);

      return result.jobId;
    } catch (error) {
      console.error("Failed to get next job:", error);
      return null;
    }
  };

  const getPreviousJobId = () => {
    if (currentIndex > 0) {
      return jobs[currentIndex - 1].id;
    }
    return null;
  };

  const navigateToJob = async (jobId: string) => {
    setLoading(true);
    try {
      const pathMap: Record<HITLType, string> = {
        "image-qc": `/jobs/${jobId}/image-qc`,
        // The final-QC panel is mounted on the job detail page itself; there is
        // no /jobs/<id>/qc route.
        "final-qc": `/jobs/${jobId}`,
        "production-va": `/jobs/${jobId}`,
        "va-review": `/jobs/${jobId}/va-review`,
      };
      router.push(pathMap[hitlType]);
    } catch (error) {
      console.error("Navigation failed:", error);
    } finally {
      setLoading(false);
      setShowDropdown(false);
    }
  };

  const handleNextJob = async () => {
    setLoading(true);
    try {
      const nextId = await getNextJobId();
      if (nextId) {
        await navigateToJob(nextId);
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePreviousJob = () => {
    const prevId = getPreviousJobId();
    if (prevId) {
      navigateToJob(prevId);
    }
  };

  // Global keyboard shortcuts — Ctrl+N / Ctrl+P everywhere; plain J/K only on
  // gates whose item IS the job (final QC), where nothing else claims them.
  useEffect(() => {
    const jobIsTheItem = hitlType === "final-qc";

    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      if ((e.key === "n" || e.key === "N") && e.ctrlKey) {
        e.preventDefault();
        handleNextJob();
      } else if ((e.key === "p" || e.key === "P") && e.ctrlKey) {
        e.preventDefault();
        handlePreviousJob();
      } else if (jobIsTheItem && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === "j" || e.key === "J") {
          e.preventDefault();
          handleNextJob();
        } else if (e.key === "k" || e.key === "K") {
          e.preventDefault();
          handlePreviousJob();
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentJobId, jobs, hitlType]);

  const statCount =
    hitlType === "image-qc"
      ? stats.imageQCCount
      : hitlType === "final-qc"
        ? stats.finalQCCount
        : hitlType === "va-review"
          ? stats.vaReviewCount
          : stats.productionVACount;

  const takenCount = jobs.filter((j) => j.claimedByOther).length;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 12px",
        background: "rgba(170,255,0,0.04)",
        border: "1px solid rgba(170,255,0,0.1)",
        borderRadius: 8,
        fontSize: 12,
      }}
    >
      {/* HITL Type Badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 6,
          background: "rgba(170,255,0,0.08)",
          border: "1px solid rgba(170,255,0,0.2)",
          color: "var(--v2-accent, #aaff00)",
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          {iconMap[hitlType]}
        </span>
        {labelMap[hitlType]}
      </div>

      {/* Position Breadcrumbs */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
          color: "rgba(205,195,215,0.6)",
        }}
      >
        <span>{queuePosition}</span>
        <span>/</span>
        <span>{totalJobs}</span>
      </div>

      {/* Progress Bar */}
      <div
        style={{
          flex: 1,
          height: 4,
          background: "rgba(75,68,85,0.2)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${totalJobs > 0 ? (queuePosition / totalJobs) * 100 : 0}%`,
            background: "var(--v2-accent, #aaff00)",
            transition: "width 0.2s ease",
          }}
        />
      </div>

      {/* Queue Count — with how many of them somebody else is already on. */}
      <div
        style={{
          padding: "4px 8px",
          borderRadius: 4,
          background: "rgba(75,68,85,0.2)",
          fontSize: 10,
          fontWeight: 700,
          color: "rgba(205,195,215,0.7)",
          flexShrink: 0,
        }}
        title={
          takenCount > 0
            ? `${takenCount} of these are being worked on by another VA right now`
            : undefined
        }
      >
        {statCount} in queue
        {takenCount > 0 ? ` · ${takenCount} taken` : ""}
      </div>

      <HotkeyHelpButton onClick={help.open} />
      {help.overlay}

      {/* Dropdown Button */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid rgba(170,255,0,0.2)",
            background: "rgba(170,255,0,0.08)",
            color: "rgba(205,195,215,0.7)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor =
              "rgba(170,255,0,0.4)";
            (e.currentTarget as HTMLElement).style.background =
              "rgba(170,255,0,0.12)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor =
              "rgba(170,255,0,0.2)";
            (e.currentTarget as HTMLElement).style.background =
              "rgba(170,255,0,0.08)";
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            {showDropdown ? "unfold_less" : "unfold_more"}
          </span>
          Queue
        </button>

        {/* Dropdown Menu */}
        {showDropdown && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              right: 0,
              marginTop: 8,
              minWidth: 300,
              maxHeight: 400,
              borderRadius: 8,
              background: "#151515",
              border: "1px solid rgba(170,255,0,0.2)",
              boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
              zIndex: 50,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid rgba(75,68,85,0.2)",
                background: "#0e0e0e",
                fontSize: 11,
                fontWeight: 700,
                color: "rgba(205,195,215,0.5)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              {labelMap[hitlType]} Queue
            </div>

            {/* Job List */}
            <div
              style={{
                overflowY: "auto",
                maxHeight: 320,
              }}
            >
              {jobs.length === 0 ? (
                <div
                  style={{
                    padding: "24px 16px",
                    textAlign: "center",
                    color: "rgba(205,195,215,0.4)",
                    fontSize: 12,
                  }}
                >
                  No jobs in queue
                </div>
              ) : (
                jobs.map((job, idx) => (
                  <button
                    key={job.id}
                    onClick={() => navigateToJob(job.id)}
                    disabled={loading}
                    style={{
                      width: "100%",
                      padding: "12px 16px",
                      borderBottom:
                        idx < jobs.length - 1
                          ? "1px solid rgba(75,68,85,0.1)"
                          : "none",
                      background:
                        job.id === currentJobId
                          ? "rgba(170,255,0,0.1)"
                          : "transparent",
                      border: "none",
                      color:
                        job.id === currentJobId
                          ? "var(--v2-accent, #aaff00)"
                          : "rgba(205,195,215,0.7)",
                      cursor: loading ? "not-allowed" : "pointer",
                      textAlign: "left",
                      fontSize: 12,
                      transition: "all 0.15s ease",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      opacity: loading ? 0.5 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (!loading) {
                        (e.currentTarget as HTMLElement).style.background =
                          "rgba(170,255,0,0.08)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        job.id === currentJobId
                          ? "rgba(170,255,0,0.1)"
                          : "transparent";
                    }}
                  >
                    {/* Index badge */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 24,
                        height: 24,
                        borderRadius: 4,
                        background:
                          job.id === currentJobId
                            ? "rgba(170,255,0,0.2)"
                            : "rgba(75,68,85,0.2)",
                        color:
                          job.id === currentJobId
                            ? "var(--v2-accent, #aaff00)"
                            : "rgba(205,195,215,0.5)",
                        fontSize: 10,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {idx + 1}
                    </div>

                    {/* Job info */}
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {job.title || "Untitled"}
                      </div>
                      <div
                        style={{
                          fontSize: 9,
                          color: "rgba(205,195,215,0.4)",
                          fontFamily: "monospace",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {job.id}
                      </div>
                    </div>

                    {/* Somebody else is on it */}
                    {job.claimedByOther && job.id !== currentJobId && (
                      <span
                        title="Another VA is working this job"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                          padding: "2px 6px",
                          borderRadius: 4,
                          fontSize: 9,
                          fontWeight: 700,
                          color: "#f97316",
                          background: "rgba(249,115,22,0.12)",
                          border: "1px solid rgba(249,115,22,0.3)",
                          flexShrink: 0,
                        }}
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 11 }}
                        >
                          group
                        </span>
                        taken
                      </span>
                    )}

                    {/* Current indicator */}
                    {job.id === currentJobId && (
                      <span
                        className="material-symbols-outlined"
                        style={{
                          fontSize: 14,
                          color: "var(--v2-accent, #aaff00)",
                          flexShrink: 0,
                        }}
                      >
                        check_circle
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Navigation Buttons */}
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        <button
          onClick={handlePreviousJob}
          disabled={currentIndex <= 0 || loading}
          title="Previous job (Ctrl+P)"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 6,
            border: "1px solid rgba(170,255,0,0.2)",
            background: "rgba(170,255,0,0.08)",
            color: "rgba(205,195,215,0.7)",
            cursor: currentIndex <= 0 || loading ? "not-allowed" : "pointer",
            opacity: currentIndex <= 0 || loading ? 0.5 : 1,
            transition: "all 0.2s ease",
            fontSize: 16,
          }}
          onMouseEnter={(e) => {
            if (currentIndex > 0 && !loading) {
              (e.currentTarget as HTMLElement).style.borderColor =
                "rgba(170,255,0,0.4)";
              (e.currentTarget as HTMLElement).style.background =
                "rgba(170,255,0,0.12)";
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor =
              "rgba(170,255,0,0.2)";
            (e.currentTarget as HTMLElement).style.background =
              "rgba(170,255,0,0.08)";
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            arrow_back
          </span>
        </button>

        <button
          onClick={handleNextJob}
          disabled={currentIndex >= jobs.length - 1 || loading}
          title="Next job (Ctrl+N)"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 6,
            border: "1px solid rgba(170,255,0,0.2)",
            background: "rgba(170,255,0,0.08)",
            color: "rgba(205,195,215,0.7)",
            cursor:
              currentIndex >= jobs.length - 1 || loading
                ? "not-allowed"
                : "pointer",
            opacity: currentIndex >= jobs.length - 1 || loading ? 0.5 : 1,
            transition: "all 0.2s ease",
            fontSize: 16,
          }}
          onMouseEnter={(e) => {
            if (currentIndex < jobs.length - 1 && !loading) {
              (e.currentTarget as HTMLElement).style.borderColor =
                "rgba(170,255,0,0.4)";
              (e.currentTarget as HTMLElement).style.background =
                "rgba(170,255,0,0.12)";
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor =
              "rgba(170,255,0,0.2)";
            (e.currentTarget as HTMLElement).style.background =
              "rgba(170,255,0,0.08)";
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            arrow_forward
          </span>
        </button>
      </div>
    </div>
  );
}
