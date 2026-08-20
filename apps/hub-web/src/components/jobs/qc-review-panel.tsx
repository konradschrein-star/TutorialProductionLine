"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  V2Card,
  V2Button,
  V2Label,
  V2Text,
  V2Heading,
} from "@/app/(authenticated)/_components";
import {
  approveQC,
  rejectQC,
  getNextQCJob,
  claimHITLJob,
  skipHITLJob,
  releaseHITLJob,
} from "@/app/actions/jobs";
import {
  HotkeyHelpButton,
  isTypingTarget,
  useHotkeyHelp,
} from "@/components/hitl/hotkey-help";

interface QCReviewPanelProps {
  jobId: string;
  finalVideoAssetKey: string | null;
  qcFeedback: string | null;
  errorMessage?: string | null;
  status?: string;
}

interface QCJobStats {
  awaitingQCCount: number;
  errorCount: number;
}

/**
 * Where a VA lands when the final-QC queue runs out. `needs-human` is a real
 * filter group in job-stage.ts, so this shows every remaining human gate rather
 * than an empty list.
 */
const QC_QUEUE_EXIT = "/jobs?status=needs-human&approved=1";

/** localStorage key for an in-progress rejection note. */
const draftKey = (jobId: string) => `qc-reject-draft:${jobId}`;

/**
 * Canned rejection reasons. Rejecting used to require free text before the
 * button would even enable, which on a 30-jobs-a-day queue is the difference
 * between one click and one sentence typed 30 times.
 */
const CANNED_REASONS: string[] = [
  "Audio out of sync with the visuals",
  "Wrong or missing images in one or more scenes",
  "Subtitles wrong / mistimed / overlapping",
  "Video is cut off or ends abruptly",
  "Audio quality bad (clipping, noise, volume)",
  "Visual glitch or artefact in the render",
  "Pacing is off — scenes too long or too short",
  "Branding / style does not match the channel",
];

export function QCReviewPanel({
  jobId,
  finalVideoAssetKey,
  qcFeedback,
  errorMessage,
  status,
}: QCReviewPanelProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  // Deliberately NOT seeded from qcFeedback: that is the previous reviewer's
  // note (rendered separately below) and pre-filling it would turn every open
  // into a "draft" and make rejections read like an echo of the last one.
  const [feedback, setFeedback] = useState("");
  const [reasons, setReasons] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [nextJobId, setNextJobId] = useState<string | null>(null);
  const [claimWarning, setClaimWarning] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [qcStats, setQcStats] = useState<QCJobStats>({
    awaitingQCCount: 0,
    errorCount: 0,
  });
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [copiedError, setCopiedError] = useState(false);
  const help = useHotkeyHelp("Final QC shortcuts", [
    { keys: "R", description: "Reject & re-render" },
    { keys: "S", description: "Skip this job (hands you the next one)" },
    { keys: "J / K", description: "Next / previous job in the queue" },
  ]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  // Read by the SSE handler, which must not blow away an unsaved rejection note
  // by calling router.refresh() underneath the VA.
  const draftDirtyRef = useRef(false);
  const pendingRefreshRef = useRef(false);

  const hasDraft = feedback.trim().length > 0 || reasons.length > 0;
  draftDirtyRef.current = showRejectForm && hasDraft;

  // ── Draft persistence ────────────────────────────────────────────────────
  // Restore any note this VA had typed for this job (survives the SSE refresh,
  // an accidental navigation, and a browser crash).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey(jobId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        feedback?: string;
        reasons?: string[];
      };
      const text = parsed.feedback ?? "";
      const picked = parsed.reasons ?? [];
      if (!text && picked.length === 0) return;
      setFeedback(text);
      setReasons(picked);
      setShowRejectForm(true);
      setDraftRestored(true);
    } catch {
      /* localStorage unavailable — nothing to restore */
    }
  }, [jobId]);

  // Only ever WRITES here. Clearing is explicit (submit / discard) so the very
  // first render — which still has empty state while the restore effect above
  // is landing — can never delete the draft it is about to restore.
  useEffect(() => {
    if (!hasDraft) return;
    try {
      localStorage.setItem(
        draftKey(jobId),
        JSON.stringify({ feedback, reasons }),
      );
    } catch {
      /* localStorage unavailable — draft simply isn't persisted */
    }
  }, [jobId, feedback, reasons, hasDraft]);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(draftKey(jobId));
    } catch {
      /* ignore */
    }
  }, [jobId]);

  // ── Real-time updates via SSE ────────────────────────────────────────────
  useEffect(() => {
    const connectSSE = () => {
      try {
        const es = new EventSource(`/api/jobs/qc-stream?job_id=${jobId}`);
        eventSourceRef.current = es;

        es.addEventListener("job-update", (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.status && data.status !== status) {
              // Never refresh out from under an unsaved rejection note; defer
              // it until the VA has submitted or discarded the draft.
              if (draftDirtyRef.current) {
                pendingRefreshRef.current = true;
              } else {
                router.refresh();
              }
            }
          } catch (err) {
            console.error("Failed to parse job-update event:", err);
          }
        });

        es.addEventListener("qc-stats", (event) => {
          try {
            const stats = JSON.parse(event.data);
            setQcStats(stats);
          } catch (err) {
            console.error("Failed to parse qc-stats event:", err);
          }
        });

        es.onerror = () => {
          console.error("SSE connection error, reconnecting...");
          es.close();
          eventSourceRef.current = null;
          setTimeout(connectSSE, 3000);
        };
      } catch (err) {
        console.error("Failed to connect to SSE:", err);
        setTimeout(connectSSE, 3000);
      }
    };

    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [jobId, status, router]);

  // Claim this job for the current VA and pre-resolve the next one, so two
  // people working the queue at the same time are never handed the same job.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const claim = await claimHITLJob("final-qc", jobId);
      if (!cancelled) setClaimWarning(!claim.mine);
      const result = await getNextQCJob(jobId);
      if (!cancelled) setNextJobId(result.jobId);
    })();
    return () => {
      cancelled = true;
      // Best effort: leaving the gate frees the job for the next VA rather than
      // parking it behind the full claim TTL. If the request is dropped mid
      // navigation the claim simply expires instead.
      void releaseHITLJob(jobId);
    };
  }, [jobId]);

  const goToNext = useCallback(
    (next: string | null) => {
      router.push(next ? `/jobs/${next}` : QC_QUEUE_EXIT);
    },
    [router],
  );

  const handleApprove = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await approveQC(jobId);
    if (result.success) {
      clearDraft();
      router.refresh();
    } else {
      setError(result.error || "Failed to approve");
    }
    setLoading(false);
  }, [jobId, router, clearDraft]);

  const handleApproveAndNext = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await approveQC(jobId);
    if (result.success) {
      clearDraft();
      // The QC panel is mounted INSIDE the job detail page (overview tab), so
      // the next job's review surface is /jobs/<id> — there is no /jobs/<id>/qc
      // route and never was; pushing one 404'd on every single approval.
      goToNext(nextJobId);
    } else {
      setError(result.error || "Failed to approve");
      setLoading(false);
    }
  }, [jobId, nextJobId, goToNext, clearDraft]);

  const handleSkip = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await skipHITLJob("final-qc", jobId);
    if (result.jobId) {
      goToNext(result.jobId);
      return;
    }
    if (result.allClaimed) {
      setError("Every other job in the QC queue is being reviewed right now.");
      setLoading(false);
      return;
    }
    goToNext(null);
  }, [jobId, goToNext]);

  const composedFeedback = useCallback(() => {
    const parts: string[] = [];
    if (reasons.length > 0) parts.push(reasons.map((r) => `• ${r}`).join("\n"));
    if (feedback.trim()) parts.push(feedback.trim());
    return parts.join("\n\n");
  }, [reasons, feedback]);

  const handleReject = useCallback(async () => {
    const body = composedFeedback();
    if (!body) {
      setError("Pick a reason or describe what needs to be fixed.");
      return;
    }
    setLoading(true);
    setError(null);
    const result = await rejectQC(jobId, body);
    if (result.success) {
      clearDraft();
      setFeedback("");
      setReasons([]);
      setShowRejectForm(false);
      setDraftRestored(false);
      pendingRefreshRef.current = false;
      router.refresh();
    } else {
      setError(result.error || "Failed to reject");
    }
    setLoading(false);
  }, [jobId, composedFeedback, router, clearDraft]);

  const openRejectForm = useCallback(() => {
    setShowRejectForm(true);
    setTimeout(() => feedbackRef.current?.focus(), 50);
  }, []);

  const toggleReason = useCallback((reason: string) => {
    setReasons((prev) =>
      prev.includes(reason)
        ? prev.filter((r) => r !== reason)
        : [...prev, reason],
    );
  }, []);

  const discardDraft = useCallback(() => {
    setShowRejectForm(false);
    setFeedback("");
    setReasons([]);
    setDraftRestored(false);
    setError(null);
    clearDraft();
    if (pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      router.refresh();
    }
  }, [clearDraft, router]);

  // ── Keyboard: the shared HITL contract (see components/hitl/hotkey-help) ──
  // A approve · Ctrl+Enter approve · R reject · S skip · Space play/pause ·
  // ? help. J/K move between jobs and are bound by HITLNavigation, which is
  // mounted above this panel on the job detail page.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (loading) return;

      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void (nextJobId ? handleApproveAndNext() : handleApprove());
      } else if (e.ctrlKey || e.metaKey || e.altKey) {
        // Leave every other modifier combo to the browser / HITLNavigation.
        return;
      } else if (e.key === "a" || e.key === "A") {
        void (nextJobId ? handleApproveAndNext() : handleApprove());
      } else if (e.key === "r" || e.key === "R") {
        if (!showRejectForm) openRejectForm();
      } else if (e.key === "s" || e.key === "S") {
        void handleSkip();
      } else if (e.key === " ") {
        e.preventDefault();
        const video = videoRef.current;
        if (video) {
          if (video.paused) video.play();
          else video.pause();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    loading,
    showRejectForm,
    nextJobId,
    handleApprove,
    handleApproveAndNext,
    handleSkip,
    openRejectForm,
  ]);

  const copyErrorToClipboard = async () => {
    if (errorMessage) {
      await navigator.clipboard.writeText(errorMessage);
      setCopiedError(true);
      setTimeout(() => setCopiedError(false), 2000);
    }
  };

  return (
    <V2Card>
      {help.overlay}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <V2Heading level={2}>QC Review</V2Heading>
          <div className="flex items-center gap-3">
            {qcStats.awaitingQCCount > 0 && (
              <div className="px-3 py-1.5 rounded-lg bg-[var(--v2-surface-2)] border border-[var(--v2-border-1)]">
                <V2Text variant="caption" muted>
                  Queue:{" "}
                  <span className="font-semibold text-[var(--v2-text-1)]">
                    {qcStats.awaitingQCCount}
                  </span>
                </V2Text>
              </div>
            )}
            <HotkeyHelpButton onClick={help.open} />
            <V2Button
              variant="ghost"
              size="sm"
              onClick={handleSkip}
              disabled={loading}
              title="Skip this job and take the next one (S)"
            >
              <span className="material-symbols-outlined text-[14px]">
                skip_next
              </span>
              Skip
            </V2Button>
            {nextJobId && (
              <V2Button
                variant="ghost"
                size="sm"
                onClick={() => goToNext(nextJobId)}
                disabled={loading}
                title="Navigate to next QC job"
              >
                <span className="material-symbols-outlined text-[14px]">
                  arrow_forward
                </span>
                Next Job
              </V2Button>
            )}
          </div>
        </div>

        {/* Somebody else is already reviewing this exact job. */}
        {claimWarning && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--v2-warning-light)] border border-[var(--v2-warning-light)]">
            <span className="material-symbols-outlined text-[var(--v2-warning)] flex-shrink-0 mt-0.5 text-[18px]">
              group
            </span>
            <V2Text variant="small">
              Another VA is reviewing this job right now. Press{" "}
              <kbd className="px-1 py-0.5 bg-[var(--v2-surface-2)] border border-[var(--v2-border-1)] rounded text-[10px] font-mono">
                S
              </kbd>{" "}
              to skip to one nobody has taken.
            </V2Text>
          </div>
        )}

        {/* Video Player */}
        {finalVideoAssetKey ? (
          <div className="space-y-3">
            <div className="rounded-lg overflow-hidden bg-black">
              <video
                ref={videoRef}
                controls
                preload="metadata"
                className="w-full max-h-[480px]"
                src={`/api/assets/${jobId}/${finalVideoAssetKey}`}
              >
                Your browser does not support video playback.
              </video>
            </div>
            <a
              href={`/api/assets/${jobId}/${finalVideoAssetKey}?download=1`}
              download
              className="inline-flex items-center gap-2"
            >
              <V2Button variant="accent" size="md">
                <span className="material-symbols-outlined text-[14px]">
                  download
                </span>
                Download Video
              </V2Button>
            </a>
          </div>
        ) : (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-[var(--v2-warning-light)] border border-[var(--v2-warning-light)]">
            <span className="material-symbols-outlined text-[var(--v2-warning)] flex-shrink-0 mt-0.5">
              play_arrow
            </span>
            <div>
              <V2Text variant="small" muted>
                No final video found in assets. The render may still be
                processing.
              </V2Text>
            </div>
          </div>
        )}

        {/* Render error display */}
        {errorMessage && (
          <div className="space-y-2">
            <div className="flex items-start justify-between p-4 rounded-lg bg-[var(--v2-error-light)] border border-[var(--v2-error)]">
              <div className="flex items-start gap-3 flex-1">
                <span className="material-symbols-outlined text-[var(--v2-error)] flex-shrink-0 mt-0.5">
                  warning
                </span>
                <div className="flex-1">
                  <V2Label className="text-[var(--v2-error)] mb-1">
                    Render Error
                  </V2Label>
                  <V2Text
                    variant="body"
                    className={`text-[var(--v2-text-1)] ${
                      showErrorDetails ? "" : "line-clamp-2"
                    }`}
                  >
                    {errorMessage}
                  </V2Text>
                </div>
              </div>
              <V2Button
                variant="ghost"
                size="sm"
                onClick={copyErrorToClipboard}
                title={copiedError ? "Copied!" : "Copy error message"}
                className="flex-shrink-0 ml-2"
              >
                <span className="material-symbols-outlined text-[14px]">
                  {copiedError ? "done" : "content_copy"}
                </span>
              </V2Button>
            </div>
            {errorMessage.length > 100 && (
              <button
                onClick={() => setShowErrorDetails(!showErrorDetails)}
                className="text-[12px] text-[var(--v2-accent)] hover:underline font-medium"
              >
                {showErrorDetails ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        )}

        {/* Previous QC feedback (if job was rejected before) */}
        {qcFeedback && !showRejectForm && (
          <div className="p-4 rounded-lg bg-[var(--v2-surface-2)] border border-[var(--v2-border-1)]">
            <V2Label className="mb-2">Previous QC Feedback</V2Label>
            <V2Text variant="body">{qcFeedback}</V2Text>
          </div>
        )}

        {/* Reject feedback form */}
        {showRejectForm && (
          <div className="space-y-3">
            {draftRestored && (
              <V2Text variant="caption" muted>
                Restored an unsent rejection note you had started on this job.
              </V2Text>
            )}
            <V2Label>Reason</V2Label>
            <div className="flex flex-wrap gap-2">
              {CANNED_REASONS.map((reason) => {
                const active = reasons.includes(reason);
                return (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => toggleReason(reason)}
                    className="text-[11px] px-2.5 py-1.5 rounded-full border transition-colors"
                    style={{
                      borderColor: active
                        ? "var(--v2-accent)"
                        : "var(--v2-border-1)",
                      background: active
                        ? "rgba(var(--v2-accent-rgb), 0.12)"
                        : "var(--v2-surface-2)",
                      color: active ? "var(--v2-accent)" : "var(--v2-text-2)",
                      fontWeight: active ? 700 : 500,
                    }}
                  >
                    {reason}
                  </button>
                );
              })}
            </div>
            <V2Label htmlFor="rejection-feedback">
              Extra detail (optional)
            </V2Label>
            <textarea
              id="rejection-feedback"
              ref={feedbackRef}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Anything the canned reasons don't cover…"
              rows={3}
              className="w-full px-3 py-2 bg-[var(--v2-surface-2)] border border-[var(--v2-border-1)] rounded-lg text-[var(--v2-text-1)] text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--v2-accent)]"
            />
            <V2Text variant="caption" muted>
              Saved as you type — an update to this job will not wipe it.
            </V2Text>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-[var(--v2-error-light)] border border-[var(--v2-error)]">
            <span className="material-symbols-outlined text-[var(--v2-error)] flex-shrink-0 mt-0.5">
              error
            </span>
            <V2Text variant="small">{error}</V2Text>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            {nextJobId ? (
              <V2Button
                variant="accent"
                size="md"
                onClick={handleApproveAndNext}
                disabled={loading}
                title="Approve and go to next job (A)"
              >
                <span className="material-symbols-outlined text-[14px]">
                  check_circle
                </span>
                Approve & Next
                <kbd className="text-[10px] opacity-60 hidden sm:inline ml-1 px-1 py-0.5 bg-[var(--v2-surface-2)] border border-[var(--v2-border-1)] rounded font-mono">
                  A
                </kbd>
              </V2Button>
            ) : (
              <V2Button
                variant="accent"
                size="md"
                onClick={handleApprove}
                disabled={loading}
                title="Approve (A)"
              >
                <span className="material-symbols-outlined text-[14px]">
                  check_circle
                </span>
                Approve
                <kbd className="text-[10px] opacity-60 hidden sm:inline ml-1 px-1 py-0.5 bg-[var(--v2-surface-2)] border border-[var(--v2-border-1)] rounded font-mono">
                  A
                </kbd>
              </V2Button>
            )}
          </div>

          {showRejectForm ? (
            <>
              <V2Button
                variant="danger"
                size="md"
                onClick={handleReject}
                disabled={loading || !hasDraft}
              >
                <span className="material-symbols-outlined text-[14px]">
                  cancel
                </span>
                Confirm Rejection
              </V2Button>
              <V2Button
                variant="ghost"
                size="md"
                onClick={discardDraft}
                disabled={loading}
              >
                Cancel
              </V2Button>
            </>
          ) : (
            <V2Button
              variant="default"
              size="md"
              onClick={openRejectForm}
              disabled={loading}
              title="Reject (R)"
            >
              <span className="material-symbols-outlined text-[14px]">
                cancel
              </span>
              Reject & Re-render
              <kbd className="text-[10px] opacity-60 hidden sm:inline ml-1 px-1 py-0.5 bg-[var(--v2-surface-2)] border border-[var(--v2-border-1)] rounded font-mono">
                R
              </kbd>
            </V2Button>
          )}
        </div>

        <V2Text variant="caption" muted>
          Shortcuts:{" "}
          <kbd className="px-1 py-0.5 bg-[var(--v2-surface-2)] border border-[var(--v2-border-1)] rounded text-[10px] font-mono inline-block">
            A
          </kbd>{" "}
          approve ·{" "}
          <kbd className="px-1 py-0.5 bg-[var(--v2-surface-2)] border border-[var(--v2-border-1)] rounded text-[10px] font-mono inline-block">
            R
          </kbd>{" "}
          reject ·{" "}
          <kbd className="px-1 py-0.5 bg-[var(--v2-surface-2)] border border-[var(--v2-border-1)] rounded text-[10px] font-mono inline-block">
            S
          </kbd>{" "}
          skip ·{" "}
          <kbd className="px-1 py-0.5 bg-[var(--v2-surface-2)] border border-[var(--v2-border-1)] rounded text-[10px] font-mono inline-block">
            Space
          </kbd>{" "}
          play/pause ·{" "}
          <kbd className="px-1 py-0.5 bg-[var(--v2-surface-2)] border border-[var(--v2-border-1)] rounded text-[10px] font-mono inline-block">
            ?
          </kbd>{" "}
          all shortcuts
        </V2Text>
      </div>
    </V2Card>
  );
}
