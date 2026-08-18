"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { V2Button, GlassCard } from "../../_components";
import {
  cancelUpload,
  enqueueUpload,
  onUploadComplete,
  onUploadError,
} from "@/lib/recording-uploads/manager";
import { useRecordingUploads } from "./upload-queue";
import type { TutorialJob, TutorialSettingsRow, Thumbnail } from "@repo/db";

interface StudioProps {
  jobs: TutorialJob[];
  settings: TutorialSettingsRow;
  onChange: () => void;
  /** Read-only sales demo — hides the destructive control on each job card. */
  isDemo?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  QUEUED: "#6366f1",
  GENERATING_SCRIPT: "#f59e0b",
  GENERATING_AUDIO: "#f59e0b",
  READY_TO_RECORD: "#22c55e",
  AWAITING_UPLOAD: "#3b82f6",
  SPLICING: "#f59e0b",
  COMPLETED: "#22c55e",
  FAILED_SCRIPT: "#ef4444",
  FAILED_AUDIO: "#ef4444",
  FAILED_SPLICE: "#ef4444",
  CANCELLED: "#6b7280",
  // LONG_FORM lifecycle
  AWAITING_RECORDINGS: "#f59e0b",
  RECORDED: "#22c55e",
  READY_TO_STITCH: "#3b82f6",
  SENT_TO_STITCHER: "#8b5cf6",
};

/**
 * Read-only Drive delivery indicator.
 *
 * Deliberately NOT a button. Until 2026-08-03 this was "Mark Uploaded to
 * Drive", which POSTed delivered_to_drive=true — the exact column
 * tutorial-drive-scanner filters on (delivered_to_drive=false). Pressing it
 * therefore did not record a delivery, it silently cancelled one and hid the
 * video from the uploader forever. That bug reached production three times and
 * stranded 145 tutorials on one occasion. Delivery is fully automatic; a human
 * must never be able to write this flag.
 */
function DriveDeliveryStatus({ delivered }: { delivered: boolean }) {
  return (
    <span
      title={
        delivered
          ? "Delivered to Google Drive automatically."
          : "Not yet delivered. The Drive uploader picks this up on its own — no action needed."
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "0 14px",
        height: 38,
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        border: `1px solid ${delivered ? "#22c55e55" : "#6b728055"}`,
        background: delivered ? "#22c55e14" : "transparent",
        color: delivered ? "#22c55e" : "#9ca3af",
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
        {delivered ? "cloud_done" : "cloud_sync"}
      </span>
      {delivered ? "In Google Drive" : "Delivering to Drive…"}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
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
        background: `${STATUS_COLORS[status] ?? "#6b7280"}22`,
        color: STATUS_COLORS[status] ?? "#6b7280",
        border: `1px solid ${STATUS_COLORS[status] ?? "#6b7280"}44`,
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

/** Whether a job is a SIX_MIN_STITCH parent (created via API, mode=SIX_MIN_STITCH, no parent). */
function isStitchParent(j: TutorialJob): boolean {
  return j.mode === "SIX_MIN_STITCH" && j.parent_job_id === null;
}

/** Whether a job is a LONG_FORM parent (mode=LONG_FORM, no parent). Its
 * parts are the LONG_FORM children whose parent_job_id === this job's id. */
function isLongFormParent(j: TutorialJob): boolean {
  return j.mode === "LONG_FORM" && j.parent_job_id === null;
}

/** Whether a job is a child segment (has a parent_job_id set). Covers both
 * SIX_MIN_STITCH segments and LONG_FORM parts — both are hidden from the
 * top-level job list and surfaced only inside their parent's detail view. */
function isSegmentChild(j: TutorialJob): boolean {
  return j.parent_job_id !== null;
}

/** Terminal statuses — a finished (or dead) job the VA no longer needs to act
 * on. Mirrors page-client.tsx's TERMINAL set. Hidden from the worklist by
 * default so completed/failed work doesn't clutter the VA's active queue. */
const TERMINAL_STATUSES = new Set([
  "COMPLETED",
  "FAILED_SCRIPT",
  "FAILED_AUDIO",
  "FAILED_SPLICE",
  "CANCELLED",
]);

/** Which pipeline stage a retry re-runs. */
type RetryTarget = "script" | "audio" | "splice";

/** "403s" means nothing at a glance; "6m 43s" does. */
function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * How long a job may legitimately sit in one status before the studio calls it
 * stuck. These are wall-clock budgets for the *whole* status, measured against
 * `updated_at`, and every one of them is grounded in production timings:
 *
 *  - QUEUED            the worker takes tutorials a few at a time, so a job can
 *                      legitimately wait behind others.
 *  - GENERATING_SCRIPT was 180s, which was simply wrong. The default provider
 *                      (deepseek-v4-pro) is a REASONING model with a 120s
 *                      per-call timeout, and SIX_MIN/LONG_FORM modes make an
 *                      outline call plus one expansion call per part — so a
 *                      healthy job routinely runs many minutes. That threshold
 *                      is what painted "LOOKS STUCK" over scripts that then
 *                      completed normally.
 *  - GENERATING_AUDIO  chunked TTS with per-provider fallback.
 *  - AWAITING_UPLOAD   queued for splice behind other splices (concurrency 2).
 *  - SPLICING          measured 345-505s per video on the VPS, and that is with
 *                      the GPU path dead so every mux runs on CPU.
 */
const STUCK_THRESHOLD_SEC: Record<string, number> = {
  QUEUED: 600,
  GENERATING_SCRIPT: 900,
  GENERATING_AUDIO: 900,
  AWAITING_UPLOAD: 1200,
  SPLICING: 1200,
};

/**
 * Playback-speed bounds.
 *
 * The slider used to be a permanent one-way lock (`speedLocked`), armed on the
 * first play and never released, because of a fear that a take recorded at
 * 1.3× would not be slowed back down to match the audio. That fear does not
 * match the code: processors/tutorial/splice.ts computes
 *
 *     factor = ttsDurationS / (recordingDurationS - leadInSeconds)
 *
 * from ffprobed durations, after subtracting a cross-correlated lead-in — and
 * `playback_speed` has no reader anywhere in worker-orchestrator. Sync is
 * MEASURED, not declared, so whatever speed the VA records at self-corrects.
 *
 * The real constraint is frame duplication. The mux time-scales the recording
 * by `factor`, so a take performed at S× yields (captureFps / S) UNIQUE frames
 * per second in the final video; the rest are duplicates:
 *
 *     1.00× → 30 unique fps   (OBS default capture, 30 fps)
 *     1.25× → 24 unique fps   (cinema rate — indistinguishable)
 *     1.50× → 20 unique fps   (floor for smooth cursor motion and scrolling)
 *     1.60× → 18.75 unique fps (accepted ceiling; slight judder on fast scroll)
 *     2.00× → 15 unique fps   (obvious strobing on any pan/scroll — rejected)
 *
 * Screen capture is the worst case for this because cursor movement and
 * scrolling are exactly the high-motion content duplicated frames betray. So:
 * hard cap 1.6, warn above 1.5. Below 1.0 is pointless for throughput (the VA
 * spends longer recording than the video runs), so the floor is 1.0.
 */
const SPEED_MIN = 1.0;
const SPEED_MAX = 1.6;
const SPEED_STEP = 0.05;
/** Above this, duplicated frames start being visible on scroll-heavy capture. */
const SPEED_WARN_ABOVE = 1.5;
/** Assumed OBS capture rate; only used for the unique-fps hint. */
const ASSUMED_CAPTURE_FPS = 30;
/** Per-VA default (per browser profile — see the "Set as my default" button). */
const SPEED_DEFAULT_KEY = "tutorial-default-speed";
/** Last speed this browser used, so a new job opens where the last one left. */
const SPEED_LAST_KEY = "tutorial-last-speed";

function clampSpeed(n: number): number {
  if (!Number.isFinite(n)) return SPEED_MIN;
  const snapped = Math.round(n / SPEED_STEP) * SPEED_STEP;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number(snapped.toFixed(2))));
}

function uniqueFps(speed: number): number {
  return ASSUMED_CAPTURE_FPS / speed;
}

/** Statuses that mean a recording file already exists for this job. */
const HAS_RECORDING_STATUSES = new Set([
  "RECORDED",
  "AWAITING_UPLOAD",
  "SPLICING",
  "COMPLETED",
  "FAILED_SPLICE",
  "READY_TO_STITCH",
  "SENT_TO_STITCHER",
]);

function jobHasRecording(j: TutorialJob | null): boolean {
  if (!j) return false;
  return Boolean(j.recording_path) || HAS_RECORDING_STATUSES.has(j.status);
}

/**
 * Compact audio-download + recording-upload control for a single LONG_FORM
 * part. Reuses the exact same endpoints/mechanism the single-clip flow uses
 * — `GET /api/production/jobs/<jobId>/audio` for download and
 * `uploadFileWithProgress(...)/api/production/jobs/<jobId>/recording` for the
 * upload — just parameterized by the child's job id instead of the selected
 * job. Upload is enabled while the part is READY_TO_RECORD.
 */
function PartRecordingControls({
  jobId,
  jobTitle,
  audioReady,
  partStatus,
  recorded,
  canModify,
  onChanged,
}: {
  jobId: string;
  jobTitle: string;
  audioReady: boolean;
  /** The part's real status — needed to tell "still working" from "dead". */
  partStatus: string;
  recorded: boolean;
  canModify: boolean;
  onChanged: () => void;
}) {
  const [removing, setRemoving] = useState(false);
  const [retrying, setRetrying] = useState(false);

  /**
   * Retry a dead part's audio.
   *
   * Until 2026-08-03 a part in FAILED_AUDIO rendered the literal text
   * "Audio generating…" forever: `audioReady` was false for every non-ready
   * status, LONG_FORM children are excluded from the job list so the child
   * could not be selected, and the single-clip retry UI was therefore
   * unreachable. One failed part blocked its parent permanently while the
   * interface claimed work was in progress — the VA's only recourse was to
   * ask a human. Same endpoint the single-clip flow uses.
   */
  async function retryAudio() {
    setRetrying(true);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 20_000);
    try {
      const res = await fetch(`/api/production/jobs/${jobId}/regenerate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "audio" }),
        signal: abort.signal,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Retrying audio for "${jobTitle}"…`);
      onChanged();
    } catch (e) {
      toast.error(
        `Audio retry failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      clearTimeout(timer);
      setRetrying(false);
    }
  }
  const [ver, setVer] = useState(0); // cache-bust the preview after re-upload

  // Upload state now lives in the background manager, not in this component —
  // a LONG_FORM parent's part list re-renders (and unmounts) constantly, and
  // an upload tied to it died on every tab switch.
  const uploads = useRecordingUploads();
  const mine = uploads.find((u) => u.jobId === jobId);
  const uploading = mine?.state === "uploading" || mine?.state === "queued";
  const progress =
    mine && mine.fileSize > 0
      ? Math.floor((mine.uploadedBytes / mine.fileSize) * 100)
      : null;
  const fileName = mine?.fileName ?? null;

  // Refresh the parent's part list the moment this part's upload lands.
  useEffect(() => {
    if (mine?.state !== "done") return;
    setVer((v) => v + 1);
    onChanged();
  }, [mine?.state, onChanged]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;
      try {
        enqueueUpload({ jobId, jobTitle, file });
        toast.success(
          `"${file.name}" is uploading in the background — you can keep working.`,
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    },
    [jobId, jobTitle],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "video/mp4": [".mp4"],
      "video/quicktime": [".mov"],
      "video/x-matroska": [".mkv"],
      "video/webm": [".webm"],
    },
    multiple: false,
    disabled: uploading,
  });

  const removeRecording = async () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Remove this recording? The part goes back to ready-to-record.",
      )
    )
      return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/production/jobs/${jobId}/recording`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      toast.success("Recording removed.");
      setVer((v) => v + 1);
      onChanged();
    } catch (e) {
      toast.error(
        `Remove failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      {/* TTS audio: inline player + download once the audio exists. */}
      {audioReady ? (
        <>
          <audio
            controls
            preload="none"
            src={`/api/production/jobs/${jobId}/audio`}
            style={{ height: 34, maxWidth: 220 }}
          />
          <a
            href={`/api/production/jobs/${jobId}/audio`}
            download
            style={{ textDecoration: "none" }}
            title="Download this part's audio"
          >
            <V2Button variant="outline" size="sm">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 15 }}
              >
                download
              </span>
              Audio
            </V2Button>
          </a>
        </>
      ) : partStatus === "FAILED_AUDIO" || partStatus === "FAILED_SCRIPT" ? (
        // A dead part must say so and offer a way out. Showing "generating…"
        // for a permanently failed job is the UI lying to the VA about a state
        // that will never change on its own.
        <V2Button
          variant="danger"
          size="sm"
          onClick={retryAudio}
          disabled={retrying}
          title={`This part failed (${partStatus}). Its parent cannot be stitched until it succeeds.`}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
            {retrying ? "hourglass_top" : "refresh"}
          </span>
          {retrying
            ? "Retrying…"
            : partStatus === "FAILED_AUDIO"
              ? "Audio failed — retry"
              : "Script failed — retry"}
        </V2Button>
      ) : (
        <span style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
          Audio generating…
        </span>
      )}

      {/* Recording: uploading → progress + cancel; recorded → preview + remove;
          otherwise → a proper drag-and-drop (or click) upload zone. */}
      {uploading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 12,
              color: "var(--v2-text-1)",
              maxWidth: 180,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {fileName ? `${fileName} — ` : ""}
            {progress ?? 0}%
          </span>
          <V2Button
            variant="outline"
            size="sm"
            onClick={() => void cancelUpload(jobId)}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 15 }}
            >
              close
            </span>
            Cancel
          </V2Button>
        </div>
      ) : recorded ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <video
            controls
            preload="metadata"
            src={`/api/production/jobs/${jobId}/recording?v=${ver}`}
            style={{ height: 56, borderRadius: 6, background: "#000" }}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              alignItems: "flex-start",
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: "var(--v2-text-2)",
                maxWidth: 160,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {fileName ?? "recording uploaded ✓"}
            </span>
            {canModify && (
              <V2Button
                variant="outline"
                size="sm"
                disabled={removing}
                onClick={removeRecording}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 15 }}
                >
                  delete
                </span>
                {removing ? "Removing…" : "Remove"}
              </V2Button>
            )}
          </div>
        </div>
      ) : canModify ? (
        <div
          {...getRootProps()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 12px",
            border: `1.5px dashed ${isDragActive ? "var(--v2-accent)" : "rgba(255,255,255,0.25)"}`,
            borderRadius: 8,
            cursor: "pointer",
            background: isDragActive
              ? "rgba(var(--v2-accent-rgb),0.08)"
              : "transparent",
          }}
        >
          <input {...getInputProps()} />
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            upload_file
          </span>
          <span style={{ fontSize: 12 }}>
            {isDragActive
              ? "Drop to upload"
              : "Drop or click to upload recording"}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Thumbnail panel for a COMPLETED tutorial job. Surfaces the thumbnail that is
 * auto-enqueued when the job finishes (processors/tutorial/{splice,stitch}.ts
 * write it with subject_kind "tutorial_job", subject_id = this job id), lets
 * the VA regenerate it, and links out to the full Thumbnail Studio — all
 * without leaving /tutorial-studio. Reads/writes the production-scoped
 * /api/production/jobs/[id]/thumbnail routes (gated view:production /
 * create:tutorial-job, so tutorial VAs can use them).
 */
function StudioThumbnailPanel({ jobId }: { jobId: string }) {
  const [thumbs, setThumbs] = useState<Thumbnail[] | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/production/jobs/${jobId}/thumbnail`);
      if (!res.ok) {
        setThumbs([]);
        return;
      }
      setThumbs((await res.json()) as Thumbnail[]);
    } catch {
      setThumbs([]);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while a thumbnail is still being generated so the image appears
  // without a manual refresh.
  const pending = (thumbs ?? []).some(
    (t) => t.status === "pending" || t.status === "generating",
  );
  useEffect(() => {
    if (!pending) return;
    const iv = setInterval(() => void load(), 4000);
    return () => clearInterval(iv);
  }, [pending, load]);

  const current =
    (thumbs ?? []).find((t) => t.is_selected && t.status === "completed") ??
    (thumbs ?? []).find((t) => t.status === "completed");

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/production/jobs/${jobId}/thumbnail`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success("Thumbnail generation queued…");
      await load();
    } catch (e) {
      toast.error(
        `Thumbnail failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <GlassCard style={{ padding: 20 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--v2-text-2)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          marginBottom: 12,
        }}
      >
        Thumbnail
      </div>

      {current ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/production/jobs/${jobId}/thumbnail/${current.id}`}
          alt="Generated thumbnail"
          style={{
            width: "100%",
            maxHeight: 260,
            objectFit: "contain",
            borderRadius: 8,
            background: "#000",
            marginBottom: 12,
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            aspectRatio: "16 / 9",
            borderRadius: 8,
            border: "1px dashed var(--v2-border, #333)",
            background:
              "repeating-linear-gradient(45deg, rgba(255,255,255,0.02) 0 10px, rgba(255,255,255,0.045) 10px 20px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            marginBottom: 12,
            padding: 16,
            textAlign: "center",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 32, color: "var(--v2-text-2)" }}
          >
            {thumbs === null
              ? "hourglass_empty"
              : pending
                ? "auto_awesome"
                : "construction"}
          </span>
          <div
            style={{
              fontSize: 12,
              color: "var(--v2-text-2)",
              lineHeight: 1.5,
              maxWidth: 340,
            }}
          >
            {thumbs === null
              ? "Loading…"
              : pending
                ? "Generating… this panel will update automatically."
                : "Thumbnails are in the workings — automatic generation is being set up. You can still try generating one manually below."}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <V2Button
          variant="outline"
          size="md"
          onClick={handleRegenerate}
          disabled={regenerating || pending}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            {current ? "refresh" : "auto_awesome"}
          </span>
          {regenerating || pending
            ? "Generating…"
            : current
              ? "Regenerate"
              : "Generate"}
        </V2Button>
        <a href="/thumbnails" style={{ textDecoration: "none" }}>
          <V2Button variant="ghost" size="md">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              open_in_new
            </span>
            Thumbnail Studio
          </V2Button>
        </a>
      </div>
    </GlassCard>
  );
}

export function ProductionStudio({
  jobs,
  settings,
  onChange,
  isDemo = false,
}: StudioProps) {
  // Top-level list shows single-clip jobs in ALL states, plus SIX_MIN_STITCH
  // and LONG_FORM parents. We explicitly include QUEUED/GENERATING_*/FAILED_*
  // too — otherwise a freshly-created job (or one that failed during script
  // gen) is invisible to the user, which looks like the system silently
  // dropped it. Segment CHILDREN (SIX_MIN_STITCH segments AND LONG_FORM parts,
  // i.e. anything with parent_job_id set) are hidden here and only surfaced
  // inside their parent's detail view.
  // Show finished/dead jobs in the worklist only when the VA opts in. Segment
  // children stay hidden regardless (they live inside their parent's detail).
  const [showCompleted, setShowCompleted] = useState(false);
  const topLevelJobs = jobs.filter((j) => !isSegmentChild(j));
  const hiddenCompletedCount = topLevelJobs.filter((j) =>
    TERMINAL_STATUSES.has(j.status),
  ).length;
  const readyJobs = showCompleted
    ? topLevelJobs
    : topLevelJobs.filter((j) => !TERMINAL_STATUSES.has(j.status));

  const [selected, setSelected] = useState<TutorialJob | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (job: TutorialJob) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete "${job.title}"? This cannot be undone.`)
    ) {
      return;
    }
    setDeletingId(job.id);
    try {
      const res = await fetch(`/api/production/jobs/${job.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success("Job deleted");
      setSelected((cur) => (cur?.id === job.id ? null : cur));
      onChange();
    } catch (err) {
      toast.error(
        `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setDeletingId(null);
    }
  };
  const [speed, setSpeed] = useState<number>(() =>
    clampSpeed(Number(settings?.default_playback_speed ?? SPEED_MIN)),
  );
  /** True once the VA has explicitly acknowledged that the stored take was
   *  performed at a different speed than the slider now shows. */
  const [takeSpeedMismatch, setTakeSpeedMismatch] = useState<number | null>(
    null,
  );
  const [regenerating, setRegenerating] = useState<RetryTarget | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hotkey = settings?.record_hotkey ?? "Space";

  // Keep selected in sync with latest job data
  const selectedJob = selected
    ? (jobs.find((j) => j.id === selected.id) ?? selected)
    : null;

  const [editedScript, setEditedScript] = useState<string>("");
  const [scriptDirty, setScriptDirty] = useState<boolean>(false);
  const [savingScript, setSavingScript] = useState<boolean>(false);

  useEffect(() => {
    if (selectedJob?.script_text) {
      setEditedScript(selectedJob.script_text);
      setScriptDirty(false);
    } else {
      setEditedScript("");
      setScriptDirty(false);
    }
  }, [selectedJob?.id, selectedJob?.script_text]);

  async function handleSaveScript(silent = false) {
    if (!selectedJob) return;
    setSavingScript(true);
    try {
      const res = await fetch(`/api/production/jobs/${selectedJob.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ script_text: editedScript }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setScriptDirty(false);
      if (!silent) toast.success("Script changes saved!");
      onChange();
    } catch (err) {
      toast.error(`Failed to save script: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingScript(false);
    }
  }

  async function handleSaveAndRegenerateAudio() {
    if (!selectedJob) return;
    if (scriptDirty) {
      await handleSaveScript(true);
    }
    await handleRegenerate("audio");
  }

  // Live view of the background upload queue (module singleton — it keeps
  // running when this component unmounts on a tab switch).
  const uploads = useRecordingUploads();
  const myUpload = selectedJob
    ? uploads.find((u) => u.jobId === selectedJob.id)
    : undefined;
  const uploading =
    myUpload?.state === "uploading" || myUpload?.state === "queued";
  const uploadProgress =
    myUpload && myUpload.fileSize > 0
      ? Math.floor((myUpload.uploadedBytes / myUpload.fileSize) * 100)
      : null;

  // A completed background upload has to refresh the job list — the VA may be
  // three jobs away by the time it lands.
  useEffect(() => {
    const offDone = onUploadComplete((_jobId, title) => {
      toast.success(`"${title}" uploaded — splicing queued.`);
      onChange();
    });
    const offErr = onUploadError((_jobId, title, error) => {
      toast.error(`Upload failed for "${title}": ${error}`, {
        duration: 12000,
      });
    });
    return () => {
      offDone();
      offErr();
    };
  }, [onChange]);

  // Reset speed when a new job is selected.
  //
  // Speed precedence: the speed this job's take was performed at >
  // this VA's own default (localStorage) > last speed this browser used >
  // workspace default in Settings > 1.0×.
  //
  // Everything is clamped into [SPEED_MIN, SPEED_MAX]: older jobs and older
  // workspace settings can hold 2.0×+, and we must not silently re-arm a
  // speed we now refuse to offer.
  useEffect(() => {
    setTakeSpeedMismatch(null);
    let resolved = SPEED_MIN;
    if (selected?.playback_speed != null) {
      resolved = Number(selected.playback_speed);
    } else if (typeof window !== "undefined") {
      const mine = Number(window.localStorage.getItem(SPEED_DEFAULT_KEY));
      const last = Number(window.localStorage.getItem(SPEED_LAST_KEY));
      if (Number.isFinite(mine) && mine > 0) resolved = mine;
      else if (Number.isFinite(last) && last > 0) resolved = last;
      else if (settings?.default_playback_speed != null) {
        resolved = Number(settings.default_playback_speed);
      }
    } else if (settings?.default_playback_speed != null) {
      resolved = Number(settings.default_playback_speed);
    }
    setSpeed(clampSpeed(resolved));
  }, [selected?.id]);

  // Persist every slider change to localStorage so the next job opens at
  // the same speed. Cheap write; no debounce needed.
  function setSpeedAndRemember(next: number) {
    const clamped = clampSpeed(next);
    setSpeed(clamped);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SPEED_LAST_KEY, String(clamped));
    }
    // Keep the live <audio> in step so the VA hears the change immediately
    // instead of only on the next play.
    if (audioRef.current) audioRef.current.playbackRate = clamped;
  }

  /**
   * Slider handler. Changing the speed is free BEFORE a take exists; once a
   * recording is on the server the change is explicit about what it does and
   * does not do — see the copy in the confirm below. It is deliberately not a
   * silent no-op and deliberately not a destructive auto-delete.
   */
  function handleSpeedChange(next: number) {
    const clamped = clampSpeed(next);
    if (clamped === speed) return;

    if (jobHasRecording(selectedJob) && typeof window !== "undefined") {
      const performedAt =
        selectedJob?.playback_speed != null
          ? Number(selectedJob.playback_speed)
          : speed;
      const ok = window.confirm(
        `This job already has a recording, performed at ${performedAt.toFixed(2)}×.\n\n` +
          `Changing the slider to ${clamped.toFixed(2)}× does NOT re-time that take — the splice ` +
          `measures the real durations either way, so the existing video stays in sync.\n\n` +
          `If you want a take at ${clamped.toFixed(2)}×, you must re-record it and upload again; ` +
          `the current recording will be replaced.\n\nChange the speed anyway?`,
      );
      if (!ok) return;
      setTakeSpeedMismatch(performedAt);
    }
    setSpeedAndRemember(clamped);
  }

  const [removingRecording, setRemovingRecording] = useState(false);

  /**
   * Explicit "that take is void" action. Deletes the uploaded file and sends
   * the job back to READY_TO_RECORD so the VA can shoot it again at the new
   * speed. Destructive, so it always confirms.
   */
  async function handleRemoveRecording() {
    if (!selectedJob) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Delete the uploaded recording for "${selectedJob.title}" and go back to ready-to-record?\n\nThe script and the TTS audio are kept. The video file is gone for good.`,
      )
    ) {
      return;
    }
    setRemovingRecording(true);
    try {
      const res = await fetch(
        `/api/production/jobs/${selectedJob.id}/recording`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success(
        "Recording removed — record the new take when you're ready.",
      );
      setTakeSpeedMismatch(null);
      onChange();
    } catch (e) {
      toast.error(
        `Could not remove the recording: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setRemovingRecording(false);
    }
  }

  /** Per-VA default (per browser profile — there is no per-user column). */
  function saveMyDefaultSpeed() {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SPEED_DEFAULT_KEY, String(speed));
    toast.success(
      `${speed.toFixed(2)}× is now your default for new jobs on this machine.`,
    );
  }

  // Countdown: seconds to wait after Start before audio actually plays.
  // Lets the VA Alt-Tab to OBS and hit Record before the TTS begins.
  // Persisted per browser via localStorage. Range 0-6.
  const [countdownDuration, setCountdownDuration] = useState<number>(() => {
    if (typeof window === "undefined") return 3;
    const stored = window.localStorage.getItem("tutorial-countdown-s");
    const parsed = stored ? Number(stored) : 3;
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 6 ? parsed : 3;
  });
  function setCountdownAndRemember(next: number) {
    setCountdownDuration(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("tutorial-countdown-s", String(next));
    }
  }

  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(
    null,
  );
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function cancelCountdown() {
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);
      countdownTimer.current = null;
    }
    setCountdownRemaining(null);
  }

  /**
   * Record which speed this take is being performed at.
   *
   * This is bookkeeping, NOT a control input: nothing in worker-orchestrator
   * reads `playback_speed` (grep it — the only hits are the Drizzle schema),
   * and splice.ts derives its time-scale factor from ffprobed durations. We
   * write it so the studio can tell the VA what the stored take was recorded
   * at, and so a speed change afterwards can be flagged honestly.
   */
  async function notePlaybackSpeed() {
    if (!selectedJob) return;
    if (
      selectedJob.playback_speed != null &&
      Number(selectedJob.playback_speed) === speed
    ) {
      return;
    }
    await fetch(`/api/production/jobs/${selectedJob.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playback_speed: speed }),
    }).catch(() => {});
  }

  function playFromStart() {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.playbackRate = speed;
    void audioRef.current.play();
    // setAudioPlaying is also set by the `play` event handler — but we
    // set it eagerly here so the UI flips immediately rather than waiting
    // for the event loop.
    setAudioPlaying(true);
  }

  async function startWithCountdown() {
    if (!audioRef.current || !selectedJob) return;
    void notePlaybackSpeed();
    setTakeSpeedMismatch(null);
    cancelCountdown();
    if (countdownDuration <= 0) {
      playFromStart();
      return;
    }
    setCountdownRemaining(countdownDuration);
    countdownTimer.current = setInterval(() => {
      setCountdownRemaining((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          if (countdownTimer.current) {
            clearInterval(countdownTimer.current);
            countdownTimer.current = null;
          }
          playFromStart();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function stopAudio() {
    cancelCountdown();
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setAudioPlaying(false);
  }

  function restartAudio() {
    cancelCountdown();
    playFromStart();
  }

  // Mirror the <audio> element's lifecycle into our local state.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => setAudioPlaying(true);
    const onPause = () => setAudioPlaying(false);
    const onEnd = () => setAudioPlaying(false);
    const onTimeUpdate = () => setAudioCurrentTime(el.currentTime ?? 0);
    const onLoadedMetadata = () => setAudioDuration(el.duration ?? 0);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnd);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    // Grab duration immediately if already loaded
    if (el.readyState >= 1 && el.duration) setAudioDuration(el.duration);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [selectedJob?.audio_path]);

  // Stop any running countdown when the user switches jobs.
  useEffect(() => {
    cancelCountdown();
    setAudioPlaying(false);
    setAudioCurrentTime(0);
    setAudioDuration(0);
  }, [selected?.id]);

  // Hotkey: Space (or configured key) toggles between idle/countdown/playing.
  //   - idle      → start countdown (or play immediately if countdown==0)
  //   - countdown → cancel
  //   - playing   → stop
  //
  // (Browsers can't capture global keystrokes when the tab isn't focused —
  // see the configurable countdown above for the "alt-tab to OBS" flow.)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const code = e.code === "Space" ? "Space" : e.key;
      const target = e.target as HTMLElement;
      if (
        !selectedJob ||
        code !== hotkey ||
        target.closest("input,textarea,select")
      ) {
        return;
      }
      e.preventDefault();
      if (countdownRemaining !== null) {
        cancelCountdown();
      } else if (audioPlaying) {
        stopAudio();
      } else {
        void startWithCountdown();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    selectedJob,
    speed,
    hotkey,
    audioPlaying,
    countdownRemaining,
    countdownDuration,
  ]);

  const RETRY_LABEL: Record<RetryTarget, string> = {
    script: "script",
    audio: "audio",
    splice: "splice",
  };

  async function handleRegenerate(target: RetryTarget, force = false) {
    if (!selectedJob) return;
    setRegenerating(target);
    // Never let a hung request leave the button spinning "Submitting…"
    // forever with no way back — the VA's only recourse was a page reload.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 20_000);
    try {
      const res = await fetch(
        `/api/production/jobs/${selectedJob.id}/regenerate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target, force }),
          signal: abort.signal,
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Retrying ${RETRY_LABEL[target]}…`);
      onChange();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(
        /abort/i.test(msg)
          ? "Retry timed out — the server did not respond. Check that hub-web and Redis are up, then try again."
          : `Failed: ${msg}`,
      );
    } finally {
      clearTimeout(timer);
      setRegenerating(null);
    }
  }

  // Hand the file to the background manager and return immediately. The VA is
  // free to pick the next job (or switch tabs entirely) while it uploads —
  // that hand-off is the whole point: a blocking multipart POST made them sit
  // and watch a progress bar, and lost the take outright if it died at 90%.
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file || !selectedJob) return;
      try {
        enqueueUpload({
          jobId: selectedJob.id,
          jobTitle: selectedJob.title,
          file,
        });
        toast.success(
          "Uploading in the background — pick your next job, it keeps going.",
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    },
    [selectedJob],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "video/mp4": [".mp4"],
      "video/quicktime": [".mov"],
      "video/x-matroska": [".mkv"],
      "video/webm": [".webm"],
    },
    multiple: false,
    disabled:
      uploading || !selectedJob || selectedJob.status !== "READY_TO_RECORD",
  });

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "280px 1fr",
        gap: 20,
        alignItems: "start",
        minHeight: 500,
      }}
    >
      {/* Left: job list */}
      <GlassCard style={{ padding: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--v2-text-2)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            Your Jobs
          </div>
          {hiddenCompletedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowCompleted((v) => !v)}
              title={
                showCompleted
                  ? "Hide finished jobs"
                  : "Show finished (completed/failed/cancelled) jobs"
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: showCompleted
                  ? "rgba(var(--v2-accent-rgb), 0.15)"
                  : "rgba(255,255,255,0.04)",
                border: showCompleted
                  ? "1px solid rgba(var(--v2-accent-rgb), 0.4)"
                  : "1px solid rgba(255,255,255,0.08)",
                borderRadius: 999,
                padding: "3px 9px",
                fontSize: 10,
                fontWeight: 600,
                color: "var(--v2-text-2)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 13 }}
              >
                {showCompleted ? "visibility_off" : "history"}
              </span>
              {showCompleted
                ? "Hide completed"
                : `Show completed (${hiddenCompletedCount})`}
            </button>
          )}
        </div>

        {readyJobs.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "24px 12px",
              color: "var(--v2-text-2)",
              fontSize: 12,
            }}
          >
            {hiddenCompletedCount > 0 ? (
              <>
                No active jobs.
                <br />
                <span style={{ fontSize: 11, opacity: 0.6 }}>
                  Toggle &ldquo;Show completed&rdquo; to see finished work.
                </span>
              </>
            ) : (
              <>
                No jobs yet.
                <br />
                <span style={{ fontSize: 11, opacity: 0.6 }}>
                  Create a job in the Create tab.
                </span>
              </>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {readyJobs.map((j) => (
              <div key={j.id} style={{ position: "relative" }}>
                <button
                  onClick={() => setSelected(j)}
                  style={{
                    background:
                      selectedJob?.id === j.id
                        ? "rgba(var(--v2-accent-rgb), 0.15)"
                        : "rgba(255,255,255,0.03)",
                    border:
                      selectedJob?.id === j.id
                        ? "1px solid rgba(var(--v2-accent-rgb), 0.4)"
                        : "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 8,
                    padding: "10px 36px 10px 12px",
                    textAlign: "left",
                    cursor: "pointer",
                    width: "100%",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--v2-text-1)",
                      marginBottom: 4,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {j.title}
                  </div>
                  <StatusBadge status={j.status} />
                  {(j.status === "QUEUED" ||
                    j.status === "GENERATING_SCRIPT" ||
                    j.status === "GENERATING_AUDIO" ||
                    j.status === "SPLICING") && (
                    <div
                      style={{
                        marginTop: 6,
                        height: 3,
                        background: "rgba(255,255,255,0.07)",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.min(100, Number(j.progress ?? 0))}%`,
                          background: "rgba(var(--v2-accent-rgb), 0.8)",
                          borderRadius: 2,
                          transition: "width 0.5s ease",
                        }}
                      />
                    </div>
                  )}
                </button>
                {/* The demo account is refused every mutation server-side,
                    so this only ever produced a 403 — but a red delete button
                    on every card invites a prospective buyer to click it and
                    watch something fail. */}
                {!isDemo && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(j);
                    }}
                    disabled={deletingId === j.id}
                    title="Delete job"
                    aria-label={`Delete ${j.title}`}
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      border: "1px solid rgba(239,68,68,0.25)",
                      background: "rgba(239,68,68,0.08)",
                      color: "#ef4444",
                      cursor: deletingId === j.id ? "wait" : "pointer",
                      opacity: deletingId === j.id ? 0.5 : 1,
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 15 }}
                    >
                      {deletingId === j.id ? "hourglass_empty" : "delete"}
                    </span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Right: guided flow */}
      {!selectedJob ? (
        <GlassCard style={{ padding: 40, textAlign: "center" }}>
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 48, color: "var(--v2-text-2)", opacity: 0.4 }}
          >
            smart_display
          </span>
          <p
            style={{
              fontSize: 14,
              color: "var(--v2-text-2)",
              marginTop: 12,
            }}
          >
            Select a job from the list to begin recording
          </p>
        </GlassCard>
      ) : isStitchParent(selectedJob) ? (
        // ── SIX_MIN_STITCH parent view ────────────────────────────────────
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Parent header */}
          <GlassCard style={{ padding: 16 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <h2
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: "var(--v2-text-1)",
                    margin: 0,
                  }}
                >
                  {selectedJob.title}
                </h2>
                <div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <StatusBadge status={selectedJob.status} />
                  <span style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
                    Long-Form Stitch
                    {selectedJob.target_minutes
                      ? ` · target ${selectedJob.target_minutes} min`
                      : ""}
                  </span>
                </div>
              </div>
            </div>
          </GlassCard>

          {/* Segments panel */}
          {(() => {
            const children = jobs
              .filter((j) => j.parent_job_id === selectedJob.id)
              .sort((a, b) => (a.segment_index ?? 0) - (b.segment_index ?? 0));
            const completedCount = children.filter(
              (c) => c.status === "COMPLETED",
            ).length;
            const totalCount = children.length;

            return (
              <GlassCard style={{ padding: 20 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--v2-accent)",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    Segments
                  </div>
                  {totalCount > 0 && (
                    <span style={{ fontSize: 12, color: "var(--v2-text-2)" }}>
                      {completedCount} / {totalCount} completed
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                {totalCount > 0 && (
                  <div
                    style={{
                      height: 4,
                      background: "rgba(255,255,255,0.08)",
                      borderRadius: 2,
                      marginBottom: 16,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.round((completedCount / totalCount) * 100)}%`,
                        height: "100%",
                        background: "var(--v2-accent)",
                        transition: "width 300ms",
                      }}
                    />
                  </div>
                )}

                {totalCount === 0 ? (
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--v2-text-2)",
                      margin: 0,
                    }}
                  >
                    Segments are being generated — check back in a moment.
                  </p>
                ) : (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    {children.map((child) => (
                      <div
                        key={child.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 14px",
                          background: "rgba(255,255,255,0.04)",
                          borderRadius: 8,
                          gap: 12,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--v2-text-1)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {child.title}
                          </div>
                          {child.audio_duration_s && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--v2-text-2)",
                                marginTop: 2,
                              }}
                            >
                              Audio: {Number(child.audio_duration_s).toFixed(1)}
                              s
                            </div>
                          )}
                        </div>
                        <StatusBadge status={child.status} />
                        {(child.status === "READY_TO_RECORD" ||
                          child.status === "AWAITING_UPLOAD" ||
                          child.status === "SPLICING" ||
                          child.status === "COMPLETED" ||
                          child.status === "FAILED_SPLICE") && (
                          <V2Button
                            variant={
                              child.status === "READY_TO_RECORD"
                                ? "accent"
                                : "outline"
                            }
                            size="sm"
                            onClick={() => setSelected(child)}
                          >
                            {child.status === "READY_TO_RECORD"
                              ? "Record"
                              : "View"}
                          </V2Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>
            );
          })()}

          {/* If parent COMPLETED, show stitched video */}
          {selectedJob.status === "COMPLETED" && (
            <GlassCard
              style={{
                padding: 20,
                border: "1px solid rgba(34, 197, 94, 0.3)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#22c55e",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 16,
                }}
              >
                Final Stitched Video
              </div>
              <video
                src={`/api/production/jobs/${selectedJob.id}/download`}
                controls
                style={{
                  width: "100%",
                  borderRadius: 8,
                  background: "#000",
                  marginBottom: 16,
                  maxHeight: 360,
                }}
              />
              <div style={{ display: "flex", gap: 12 }}>
                <a
                  href={`/api/production/jobs/${selectedJob.id}/download`}
                  download
                  style={{ textDecoration: "none" }}
                >
                  <V2Button variant="accent" size="md">
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 16 }}
                    >
                      download
                    </span>
                    Download Final MP4
                  </V2Button>
                </a>
                {/* READ-ONLY. This was a "Mark Uploaded to Drive" button until
                    2026-08-03. It wrote delivered_to_drive=true, which is the
                    exact flag tutorial-drive-scanner filters on
                    (delivered_to_drive=false) — so pressing it did not record a
                    delivery, it CANCELLED one, permanently hiding the video from
                    the uploader. It cost 145 tutorials once already. Delivery is
                    automatic; this is a status indicator, never a control. */}
                <DriveDeliveryStatus
                  delivered={selectedJob.delivered_to_drive ?? false}
                />
              </div>
            </GlassCard>
          )}

          {/* Thumbnail panel for the completed stitched video */}
          {selectedJob.status === "COMPLETED" && (
            <StudioThumbnailPanel jobId={selectedJob.id} />
          )}

          {/* Parent failed-stitch state */}
          {selectedJob.status === "FAILED_SPLICE" && (
            <GlassCard
              style={{
                padding: 20,
                border: "1px solid rgba(239, 68, 68, 0.3)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#ef4444",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 8,
                }}
              >
                Stitch Failed
              </div>
              {selectedJob.error_message && (
                <p
                  style={{ fontSize: 12, color: "var(--v2-text-2)", margin: 0 }}
                >
                  {selectedJob.error_message}
                </p>
              )}
            </GlassCard>
          )}
        </div>
      ) : isLongFormParent(selectedJob) ? (
        // ── LONG_FORM parent view ─────────────────────────────────────────
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Parent header */}
          <GlassCard style={{ padding: 16 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <h2
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: "var(--v2-text-1)",
                    margin: 0,
                  }}
                >
                  {selectedJob.title}
                </h2>
                <div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <StatusBadge status={selectedJob.status} />
                  <span style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
                    Long-Form
                    {selectedJob.target_minutes
                      ? ` · target ${selectedJob.target_minutes} min`
                      : ""}
                    {selectedJob.part_length_minutes
                      ? ` · ~${selectedJob.part_length_minutes} min/part`
                      : ""}
                  </span>
                </div>
              </div>
            </div>

            {/* Full-audio download action */}
            <div
              style={{
                marginTop: 14,
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              {selectedJob.long_audio_path && (
                <a
                  href={`/api/production/jobs/${selectedJob.id}/long-audio`}
                  download
                  style={{ textDecoration: "none" }}
                >
                  <V2Button variant="outline" size="md">
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 16 }}
                    >
                      download
                    </span>
                    Download full audio
                  </V2Button>
                </a>
              )}
            </div>
          </GlassCard>

          {/* Parts panel */}
          {(() => {
            const parts = jobs
              .filter((j) => j.parent_job_id === selectedJob.id)
              .sort((a, b) => (a.segment_index ?? 0) - (b.segment_index ?? 0));
            const recordedCount = parts.filter(
              (p) => p.status === "RECORDED",
            ).length;
            const totalCount = parts.length;

            return (
              <GlassCard style={{ padding: 20 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--v2-accent)",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    Parts
                  </div>
                  {totalCount > 0 && (
                    <span style={{ fontSize: 12, color: "var(--v2-text-2)" }}>
                      {recordedCount} / {totalCount} recorded
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                {totalCount > 0 && (
                  <div
                    style={{
                      height: 4,
                      background: "rgba(255,255,255,0.08)",
                      borderRadius: 2,
                      marginBottom: 16,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.round((recordedCount / totalCount) * 100)}%`,
                        height: "100%",
                        background: "var(--v2-accent)",
                        transition: "width 300ms",
                      }}
                    />
                  </div>
                )}

                {/* VA recording instruction: the screen recording's own audio
                    is what we align the video to the TTS track with, so it MUST
                    be captured. */}
                {totalCount > 0 && (
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                      padding: "10px 12px",
                      marginBottom: 16,
                      background: "rgba(245,158,11,0.10)",
                      border: "1px solid rgba(245,158,11,0.35)",
                      borderRadius: 8,
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 16, color: "#f59e0b", marginTop: 1 }}
                    >
                      info
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--v2-text-1)",
                        lineHeight: 1.45,
                      }}
                    >
                      Listen to each part&apos;s TTS, then record your screen{" "}
                      <strong>with the audio playing and captured</strong> — the
                      recording&apos;s own audio is matched against the TTS to
                      line your video up with the voice track. No screen audio
                      means we can&apos;t align it.
                    </span>
                  </div>
                )}

                {totalCount === 0 ? (
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--v2-text-2)",
                      margin: 0,
                    }}
                  >
                    Parts are being generated — check back in a moment.
                  </p>
                ) : (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    {parts.map((part) => (
                      <div
                        key={part.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 14px",
                          background: "rgba(255,255,255,0.04)",
                          borderRadius: 8,
                          gap: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--v2-text-1)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Part {(part.segment_index ?? 0) + 1}
                            <span
                              style={{
                                marginLeft: 8,
                                fontWeight: 400,
                                color: "var(--v2-text-2)",
                              }}
                            >
                              {part.title}
                            </span>
                          </div>
                          {part.audio_duration_s && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--v2-text-2)",
                                marginTop: 2,
                              }}
                            >
                              Audio: {Number(part.audio_duration_s).toFixed(1)}s
                            </div>
                          )}
                        </div>
                        <StatusBadge status={part.status} />
                        <PartRecordingControls
                          jobId={part.id}
                          jobTitle={part.title}
                          audioReady={
                            part.status === "READY_TO_RECORD" ||
                            part.status === "RECORDED" ||
                            part.status === "SENT_TO_STITCHER"
                          }
                          partStatus={part.status}
                          recorded={part.status === "RECORDED"}
                          canModify={
                            (part.status === "READY_TO_RECORD" ||
                              part.status === "RECORDED") &&
                            selectedJob.status !== "SENT_TO_STITCHER"
                          }
                          onChanged={onChange}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>
            );
          })()}
        </div>
      ) : (
        // ── Standard single-clip flow ────────────────────────────────────
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Job header */}
          <GlassCard style={{ padding: 16 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <h2
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: "var(--v2-text-1)",
                    margin: 0,
                  }}
                >
                  {selectedJob.title}
                </h2>
                <div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <StatusBadge status={selectedJob.status} />
                  {selectedJob.audio_duration_s && (
                    <span style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
                      Audio: {Number(selectedJob.audio_duration_s).toFixed(1)}s
                    </span>
                  )}
                </div>
                {/* Provider pills */}
                <div
                  style={{
                    marginTop: 8,
                    display: "flex",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 8px",
                      borderRadius: 9999,
                      background: "rgba(99,102,241,0.12)",
                      border: "1px solid rgba(99,102,241,0.25)",
                      fontSize: 11,
                      color: "#a5b4fc",
                      fontWeight: 500,
                    }}
                  >
                    LLM: {selectedJob.script_provider}
                    {selectedJob.script_model
                      ? ` / ${selectedJob.script_model}`
                      : ""}
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 8px",
                      borderRadius: 9999,
                      // Amber when the audio was NOT made by the requested
                      // provider. A fallback firing is something the operator
                      // has to SEE on the job — previously it existed only in a
                      // worker log line, so "was this video Fish or AI33?" was
                      // unanswerable. Green only when what ran is what was asked.
                      background:
                        selectedJob.tts_provider_used &&
                        selectedJob.tts_provider_used !==
                          selectedJob.tts_provider
                          ? "rgba(251,191,36,0.10)"
                          : "rgba(34,197,94,0.08)",
                      border:
                        selectedJob.tts_provider_used &&
                        selectedJob.tts_provider_used !==
                          selectedJob.tts_provider
                          ? "1px solid rgba(251,191,36,0.35)"
                          : "1px solid rgba(34,197,94,0.2)",
                      fontSize: 11,
                      color:
                        selectedJob.tts_provider_used &&
                        selectedJob.tts_provider_used !==
                          selectedJob.tts_provider
                          ? "#fcd34d"
                          : "#86efac",
                      fontWeight: 500,
                    }}
                    title={
                      selectedJob.tts_provider_used
                        ? `Audio generated by ${selectedJob.tts_provider_used}. Requested: ${selectedJob.tts_provider}.`
                        : `Requested ${selectedJob.tts_provider}. Which provider actually generated this audio was not recorded — this job predates provider tracking.`
                    }
                  >
                    TTS:{" "}
                    {selectedJob.tts_provider_used ?? selectedJob.tts_provider}
                    {selectedJob.tts_provider_used &&
                    selectedJob.tts_provider_used !== selectedJob.tts_provider
                      ? ` (fell back from ${selectedJob.tts_provider})`
                      : ""}
                    {!selectedJob.tts_provider_used && selectedJob.audio_path
                      ? " (unverified)"
                      : ""}{" "}
                    · {selectedJob.tts_voice}
                  </span>
                </div>
              </div>
            </div>
          </GlassCard>

          {/* In-progress states: nothing to record yet — show what we're
              waiting on, a live progress bar driven by job.progress, and
              a stuck-detector that fires when a status hasn't changed in
              much longer than expected (worker crashed, queue connection
              broken, etc.). */}
          {(selectedJob.status === "QUEUED" ||
            selectedJob.status === "GENERATING_SCRIPT" ||
            selectedJob.status === "GENERATING_AUDIO" ||
            selectedJob.status === "AWAITING_UPLOAD" ||
            selectedJob.status === "SPLICING") &&
            (() => {
              const updatedAt = selectedJob.updated_at
                ? new Date(selectedJob.updated_at).getTime()
                : Date.now();
              const ageSec = Math.round((Date.now() - updatedAt) / 1000);
              const stuckThresholdSec =
                STUCK_THRESHOLD_SEC[selectedJob.status] ?? 900;
              const isStuck = ageSec > stuckThresholdSec;
              // What a retry should actually re-run. A job wedged after the
              // recording was uploaded must re-run the SPLICE — retrying it as
              // "script" would wipe the script, the TTS and the VA's recording
              // and make them shoot the whole tutorial again.
              const retryTarget: RetryTarget =
                selectedJob.status === "AWAITING_UPLOAD" ||
                selectedJob.status === "SPLICING"
                  ? "splice"
                  : selectedJob.status === "GENERATING_AUDIO"
                    ? "audio"
                    : "script";
              return (
                <GlassCard
                  style={{
                    padding: 20,
                    border: isStuck
                      ? "1px solid rgba(239, 68, 68, 0.3)"
                      : "1px solid rgba(245, 158, 11, 0.3)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: isStuck ? "#ef4444" : "#f59e0b",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      marginBottom: 8,
                    }}
                  >
                    {isStuck
                      ? `${selectedJob.status.replace(/_/g, " ")} — looks stuck`
                      : selectedJob.status === "QUEUED"
                        ? "Queued"
                        : selectedJob.status === "GENERATING_SCRIPT"
                          ? "Generating Script"
                          : selectedJob.status === "GENERATING_AUDIO"
                            ? "Generating Audio"
                            : selectedJob.status === "AWAITING_UPLOAD"
                              ? "Queued for splicing"
                              : "Splicing"}
                  </div>
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--v2-text-1)",
                      margin: 0,
                    }}
                  >
                    {isStuck
                      ? `Status hasn't changed in ${formatDuration(ageSec)} — the worker may be down or disconnected from Redis. Check 'pm2 status worker-orchestrator' on the VPS, then click Force retry below.`
                      : selectedJob.status === "QUEUED"
                        ? `Waiting for the worker to pick this job up. The worker processes tutorials a few at a time, so if other jobs are running ahead of yours you may wait a few minutes — that's normal. Refreshes every 5s. (Waiting ${formatDuration(ageSec)})`
                        : selectedJob.status === "GENERATING_SCRIPT"
                          ? `${selectedJob.script_provider}${selectedJob.script_model ? ` / ${selectedJob.script_model}` : ""} is writing the tutorial. Reasoning models think before they answer, and longer formats are written chapter by chapter, so several minutes here is normal. (${formatDuration(ageSec)})`
                          : selectedJob.status === "GENERATING_AUDIO"
                            ? `Synthesising audio with ${selectedJob.tts_provider}. Runs 1–5 min per chunk; auto-falls-back to the next provider if it errors. (${formatDuration(ageSec)})`
                            : selectedJob.status === "AWAITING_UPLOAD"
                              ? `Recording received. Waiting for a splice slot — the server splices two videos at a time and each takes roughly 6–8 minutes, so yours may sit here a while. (${formatDuration(ageSec)})`
                              : `Splicing your recording with the clean TTS audio — auto-trims leading silence, time-scales video to match audio. This takes roughly 6–8 minutes. (${formatDuration(ageSec)})`}
                  </p>

                  {/* Live progress bar */}
                  {(() => {
                    const pct = Math.max(
                      0,
                      Math.min(100, Number(selectedJob.progress ?? 0)),
                    );
                    return (
                      <div style={{ marginTop: 14 }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "baseline",
                            marginBottom: 4,
                            fontSize: 10,
                            color: "var(--v2-text-2)",
                          }}
                        >
                          <span>Overall progress</span>
                          <span
                            style={{
                              fontVariantNumeric: "tabular-nums",
                              color: "var(--v2-text-1)",
                              fontWeight: 600,
                            }}
                          >
                            {pct}%
                          </span>
                        </div>
                        <div
                          style={{
                            height: 6,
                            background: "rgba(255,255,255,0.08)",
                            borderRadius: 3,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${pct}%`,
                              height: "100%",
                              background: isStuck
                                ? "#ef4444"
                                : "var(--v2-accent)",
                              transition: "width 600ms ease",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })()}
                  {isStuck && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        {/* force: true is required — this button only exists
                            while the job is in an in-progress status, and the
                            API refuses those outright without it. */}
                        <V2Button
                          variant="accent"
                          size="sm"
                          onClick={() => handleRegenerate(retryTarget, true)}
                          disabled={!!regenerating}
                        >
                          {regenerating ? "Submitting…" : "Force retry"}
                        </V2Button>
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--v2-text-2)",
                          marginTop: 6,
                        }}
                      >
                        {retryTarget === "splice"
                          ? "Re-runs the splice only — your script, audio and recording are kept."
                          : retryTarget === "audio"
                            ? "Re-runs text-to-speech. The script is kept."
                            : "Re-runs the script from scratch, then audio."}
                      </div>
                    </div>
                  )}
                </GlassCard>
              );
            })()}

          {/* Failed states: surface error_message so the user can see WHY.
              FAILED_SPLICE used to render nothing at all — the job just went
              quiet with no error and no way to retry. */}
          {(selectedJob.status === "FAILED_SCRIPT" ||
            selectedJob.status === "FAILED_AUDIO" ||
            selectedJob.status === "FAILED_SPLICE") && (
            <GlassCard
              style={{
                padding: 20,
                border: "1px solid rgba(239, 68, 68, 0.3)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#ef4444",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 8,
                }}
              >
                {selectedJob.status === "FAILED_SCRIPT"
                  ? "Script Generation Failed"
                  : selectedJob.status === "FAILED_AUDIO"
                    ? "Audio Generation Failed"
                    : "Splicing Failed"}
              </div>
              {selectedJob.error_message ? (
                <pre
                  style={{
                    fontSize: 12,
                    color: "var(--v2-text-1)",
                    background: "rgba(0,0,0,0.3)",
                    padding: 12,
                    borderRadius: 6,
                    whiteSpace: "pre-wrap",
                    fontFamily: "inherit",
                    margin: 0,
                  }}
                >
                  {selectedJob.error_message}
                </pre>
              ) : (
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--v2-text-2)",
                    margin: 0,
                  }}
                >
                  No error message was captured. Check the worker logs for
                  details.
                </p>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                {(() => {
                  // Retry the stage that actually failed. FAILED_SPLICE keeps
                  // the script, the TTS and the recording — only the mux is
                  // re-run, so the VA never has to re-record.
                  const stage: RetryTarget =
                    selectedJob.status === "FAILED_SCRIPT"
                      ? "script"
                      : selectedJob.status === "FAILED_AUDIO"
                        ? "audio"
                        : "splice";
                  const label =
                    stage === "script"
                      ? "Retry Script Generation"
                      : stage === "audio"
                        ? "Retry Audio Generation"
                        : "Retry Splicing";
                  return (
                    <V2Button
                      variant="accent"
                      size="sm"
                      onClick={() => handleRegenerate(stage)}
                      disabled={!!regenerating}
                    >
                      {regenerating ? "Submitting retry…" : label}
                    </V2Button>
                  );
                })()}
              </div>
            </GlassCard>
          )}

          {/* Step 1: Review Script */}
          <GlassCard style={{ padding: 20 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--v2-accent)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                }}
              >
                Step 1 — Review & Edit Script
              </div>
              {scriptDirty && (
                <span
                  style={{
                    fontSize: 11,
                    color: "#f59e0b",
                    fontWeight: 600,
                    background: "rgba(245, 158, 11, 0.15)",
                    padding: "2px 8px",
                    borderRadius: 4,
                    border: "1px solid rgba(245, 158, 11, 0.3)",
                  }}
                >
                  Unsaved edits
                </span>
              )}
            </div>

            {/* Steps the user typed in when creating the job */}
            {selectedJob.steps_input && selectedJob.steps_input.trim() && (
              <div style={{ marginBottom: 12 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--v2-text-2)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 6,
                  }}
                >
                  Steps entered
                </div>
                <pre
                  style={{
                    background: "rgba(99,102,241,0.06)",
                    border: "1px solid rgba(99,102,241,0.15)",
                    borderRadius: 6,
                    padding: "10px 12px",
                    fontSize: 11,
                    color: "var(--v2-text-1)",
                    whiteSpace: "pre-wrap",
                    fontFamily: "inherit",
                    margin: 0,
                  }}
                >
                  {selectedJob.steps_input}
                </pre>
              </div>
            )}

            {selectedJob.script_text || editedScript ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <textarea
                  value={editedScript}
                  onChange={(e) => {
                    setEditedScript(e.target.value);
                    setScriptDirty(true);
                  }}
                  placeholder="Click here to type or edit any words in the script..."
                  rows={8}
                  style={{
                    width: "100%",
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: "var(--v2-text-1)",
                    background: "rgba(0, 0, 0, 0.4)",
                    padding: 16,
                    borderRadius: 8,
                    border: scriptDirty
                      ? "2px solid var(--v2-accent, #6366f1)"
                      : "1px solid rgba(255, 255, 255, 0.12)",
                    fontFamily: "inherit",
                    resize: "vertical",
                    boxSizing: "border-box",
                    outline: "none",
                    minHeight: 160,
                  }}
                />
                <div style={{ fontSize: 11, color: "var(--v2-text-2)", opacity: 0.8 }}>
                  💡 You can freely edit or fix any words above, then click <strong>"Save & Regenerate Audio"</strong> below to synthesize the new voiceover.
                </div>
              </div>
            ) : (
              <p style={{ color: "var(--v2-text-2)", fontSize: 12 }}>
                Script not yet generated.
              </p>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <V2Button
                variant={scriptDirty ? "accent" : "outline"}
                size="sm"
                onClick={handleSaveAndRegenerateAudio}
                disabled={!!regenerating || savingScript || (!selectedJob.script_text && !editedScript)}
              >
                {regenerating === "audio"
                  ? "Synthesizing Audio…"
                  : savingScript
                    ? "Saving Script…"
                    : "⚡ Save & Regenerate Audio"}
              </V2Button>

              {scriptDirty && (
                <V2Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSaveScript(false)}
                  disabled={savingScript}
                >
                  {savingScript ? "Saving…" : "Save Script"}
                </V2Button>
              )}

              <V2Button
                variant="outline"
                size="sm"
                onClick={() => handleRegenerate("script")}
                disabled={!!regenerating}
              >
                {regenerating === "script"
                  ? "Regenerating…"
                  : "Regenerate Script (AI)"}
              </V2Button>
            </div>
          </GlassCard>

          {/* Step 2: Speed Control */}
          <GlassCard style={{ padding: 20 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--v2-accent)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 12,
              }}
            >
              Step 2 — Playback Speed
            </div>

            {/* The slider is only frozen WHILE a take is running (changing the
                rate mid-recording desyncs what the VA is performing right
                now). It is never permanently locked — see the SPEED_MIN /
                SPEED_MAX block at the top of this file for why that lock was
                unnecessary and what the real constraint is. */}
            {(() => {
              const midTake = audioPlaying || countdownRemaining !== null;
              const fps = uniqueFps(speed);
              const warn = speed > SPEED_WARN_ABOVE;
              return (
                <>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 16 }}
                  >
                    <input
                      type="range"
                      min={SPEED_MIN}
                      max={SPEED_MAX}
                      step={SPEED_STEP}
                      value={speed}
                      disabled={midTake}
                      onChange={(e) =>
                        handleSpeedChange(Number(e.target.value))
                      }
                      style={{
                        flex: 1,
                        accentColor: warn ? "#f59e0b" : "var(--v2-accent)",
                        opacity: midTake ? 0.5 : 1,
                        cursor: midTake ? "not-allowed" : "pointer",
                      }}
                    />
                    <span
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: midTake
                          ? "var(--v2-text-2)"
                          : warn
                            ? "#f59e0b"
                            : "var(--v2-accent)",
                        minWidth: 56,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {speed.toFixed(2)}×
                    </span>
                  </div>

                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
                      {midTake
                        ? "Frozen while a take is running — stop the audio to change it."
                        : `≈ ${fps.toFixed(1)} unique fps in the final video (from a 30 fps capture). Range ${SPEED_MIN.toFixed(2)}×–${SPEED_MAX.toFixed(2)}×.`}
                    </span>
                    {!midTake && (
                      <V2Button
                        variant="ghost"
                        size="sm"
                        onClick={saveMyDefaultSpeed}
                        title="Use this speed for every new job you open on this machine"
                      >
                        Set as my default
                      </V2Button>
                    )}
                  </div>

                  {warn && (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 11,
                        color: "#f59e0b",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 6,
                        background: "rgba(245,158,11,0.08)",
                        border: "1px solid rgba(245,158,11,0.25)",
                        borderRadius: 6,
                        padding: "6px 8px",
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 14 }}
                      >
                        warning
                      </span>
                      <span>
                        Above {SPEED_WARN_ABOVE.toFixed(2)}× the mux has to
                        duplicate frames to stretch your take back onto the
                        audio ({fps.toFixed(1)} unique fps here). Scrolling and
                        fast cursor moves will judder. Record at 60 fps in OBS
                        if you want to stay up here.
                      </span>
                    </div>
                  )}

                  {takeSpeedMismatch !== null && (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 11,
                        color: "#fca5a5",
                        background: "rgba(239,68,68,0.08)",
                        border: "1px solid rgba(239,68,68,0.25)",
                        borderRadius: 6,
                        padding: "8px 10px",
                      }}
                    >
                      The recording already on the server was performed at{" "}
                      {takeSpeedMismatch.toFixed(2)}×, not {speed.toFixed(2)}×.
                      That take is still in sync and will splice fine — but it
                      is not a {speed.toFixed(2)}× take. To actually get one,
                      remove the recording and shoot it again.
                      <div style={{ marginTop: 8 }}>
                        <V2Button
                          variant="outline"
                          size="sm"
                          disabled={removingRecording}
                          onClick={handleRemoveRecording}
                        >
                          {removingRecording
                            ? "Removing…"
                            : "Remove recording & re-record"}
                        </V2Button>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Audio progress bar — green → amber → red as playback nears end */}
            {selectedJob.audio_path &&
              (() => {
                const dur =
                  audioDuration > 0
                    ? audioDuration
                    : selectedJob.audio_duration_s
                      ? Number(selectedJob.audio_duration_s)
                      : 0;
                const progress = dur > 0 ? audioCurrentTime / dur : 0;
                const m = Math.floor(audioCurrentTime / 60);
                const s = Math.floor(audioCurrentTime % 60);
                const dm = Math.floor(dur / 60);
                const ds = Math.floor(dur % 60);
                const fmtTime = (mm: number, ss: number) =>
                  `${mm}:${ss.toString().padStart(2, "0")}`;

                // Green → amber → red interpolation
                let barColor = "rgb(34,197,94)"; // green
                if (progress >= 0.65 && progress < 0.8) {
                  const t = (progress - 0.65) / 0.15;
                  const r = Math.round(34 + t * (245 - 34));
                  const g = Math.round(197 + t * (158 - 197));
                  const b = Math.round(94 + t * (11 - 94));
                  barColor = `rgb(${r},${g},${b})`;
                } else if (progress >= 0.8 && progress < 0.92) {
                  const t = (progress - 0.8) / 0.12;
                  const r = Math.round(245 + t * (239 - 245));
                  const g = Math.round(158 + t * (68 - 158));
                  const b = Math.round(11 + t * (68 - 11));
                  barColor = `rgb(${r},${g},${b})`;
                } else if (progress >= 0.92) {
                  barColor = "rgb(239,68,68)"; // bright red
                }

                return (
                  <div style={{ marginTop: 20 }}>
                    {/* Time labels above the bar */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          fontVariantNumeric: "tabular-nums",
                          color:
                            progress > 0.85 ? barColor : "var(--v2-text-1)",
                          transition: "color 0.4s ease",
                        }}
                      >
                        {fmtTime(m, s)}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          fontVariantNumeric: "tabular-nums",
                          color: "var(--v2-text-2)",
                        }}
                      >
                        {dur > 0 ? fmtTime(dm, ds) : "—:——"}
                      </span>
                    </div>
                    {/* Track */}
                    <div
                      style={{
                        height: 10,
                        borderRadius: 5,
                        background: "rgba(255,255,255,0.12)",
                        overflow: "hidden",
                        position: "relative",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          right: `${(1 - progress) * 100}%`,
                          background: barColor,
                          borderRadius: 5,
                          transition: "background-color 0.4s ease",
                          minWidth: progress > 0 ? 10 : 0,
                        }}
                      />
                    </div>
                  </div>
                );
              })()}

            {/* Hidden audio element */}
            {selectedJob.audio_path && (
              <audio
                ref={audioRef}
                src={`/api/production/jobs/${selectedJob.id}/audio`}
                preload="metadata"
                style={{ display: "none" }}
              />
            )}
          </GlassCard>

          {/* Step 3: Record Instructions */}
          {selectedJob.status === "READY_TO_RECORD" && (
            <GlassCard
              style={{
                padding: 20,
                border: "1px solid rgba(34, 197, 94, 0.3)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#22c55e",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 12,
                }}
              >
                Step 3 — Record Your Screen
              </div>

              <ol
                style={{
                  margin: 0,
                  paddingLeft: 20,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <li style={{ fontSize: 13, color: "var(--v2-text-1)" }}>
                  Open OBS and set up your screen capture.
                </li>
                <li style={{ fontSize: 13, color: "var(--v2-text-1)" }}>
                  Press{" "}
                  <kbd
                    style={{
                      background: "rgba(255,255,255,0.1)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: 4,
                      padding: "1px 6px",
                      fontFamily: "monospace",
                      fontSize: 12,
                    }}
                  >
                    {hotkey}
                  </kbd>{" "}
                  to play the audio — it starts at {speed.toFixed(2)}× speed.
                </li>
                <li style={{ fontSize: 13, color: "var(--v2-text-1)" }}>
                  <strong style={{ color: "#22c55e" }}>
                    Record the WHOLE thing in ONE take
                  </strong>{" "}
                  from the very start.
                </li>
                <li style={{ fontSize: 13, color: "var(--v2-text-1)" }}>
                  Stop OBS and save the recording, then upload it below.
                </li>
              </ol>

              {/* Countdown config — lets the user alt-tab to OBS, hit
                  Record, then return here before TTS plays. Persisted per
                  browser. */}
              <div
                style={{
                  marginTop: 16,
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    color: "var(--v2-text-2)",
                  }}
                >
                  Countdown
                  <input
                    type="number"
                    min={0}
                    max={6}
                    step={1}
                    value={countdownDuration}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 0 && n <= 6) {
                        setCountdownAndRemember(n);
                      }
                    }}
                    disabled={countdownRemaining !== null || audioPlaying}
                    style={{
                      width: 56,
                      background: "var(--v2-surface-2)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      padding: "4px 8px",
                      color: "var(--v2-text-1)",
                      fontSize: 12,
                      textAlign: "right",
                    }}
                  />
                  s before audio starts
                </label>
                <span style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
                  Speed is frozen only while a take is running — stop the audio
                  to change it and go again. Leading silence in your recording
                  is auto-trimmed in splice, and the video is re-timed to the
                  audio from the measured durations.
                </span>
              </div>

              {/* Progress bar + duration — always visible once audio is ready */}
              {selectedJob.audio_path &&
                (() => {
                  const dur =
                    audioDuration > 0
                      ? audioDuration
                      : selectedJob.audio_duration_s
                        ? Number(selectedJob.audio_duration_s)
                        : 0;
                  const progress = dur > 0 ? audioCurrentTime / dur : 0;
                  const elapsed = audioCurrentTime;
                  const remaining = Math.max(0, dur - elapsed);
                  const fmt = (sec: number) => {
                    const m = Math.floor(sec / 60);
                    const s = Math.floor(sec % 60);
                    return `${m}:${s.toString().padStart(2, "0")}`;
                  };
                  let barColor = "#22c55e";
                  if (progress >= 0.65 && progress < 0.8) {
                    const t = (progress - 0.65) / 0.15;
                    barColor = `rgb(${Math.round(34 + t * 211)},${Math.round(197 - t * 39)},${Math.round(94 - t * 83)})`;
                  } else if (progress >= 0.8 && progress < 0.92) {
                    const t = (progress - 0.8) / 0.12;
                    barColor = `rgb(${Math.round(245 - t * 6)},${Math.round(158 - t * 90)},${Math.round(11 + t * 57)})`;
                  } else if (progress >= 0.92) {
                    barColor = "#ef4444";
                  }
                  return (
                    <div style={{ marginTop: 16 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 5,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            fontVariantNumeric: "tabular-nums",
                            color: barColor,
                            transition: "color 0.4s",
                          }}
                        >
                          {fmt(elapsed)}
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            fontVariantNumeric: "tabular-nums",
                            color: "var(--v2-text-2)",
                          }}
                        >
                          -{fmt(remaining)}
                        </span>
                      </div>
                      <div
                        style={{
                          height: 8,
                          borderRadius: 4,
                          background: "rgba(255,255,255,0.1)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${Math.min(100, progress * 100)}%`,
                            background: barColor,
                            borderRadius: 4,
                            transition: "width 0.25s linear, background 0.4s",
                          }}
                        />
                      </div>
                    </div>
                  );
                })()}

              <div
                style={{
                  marginTop: 16,
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                {countdownRemaining !== null ? (
                  <V2Button
                    variant="outline"
                    size="lg"
                    onClick={cancelCountdown}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 18 }}
                    >
                      hourglass_top
                    </span>
                    Starting in {countdownRemaining}… (cancel)
                  </V2Button>
                ) : audioPlaying ? (
                  <>
                    <V2Button variant="outline" size="lg" onClick={stopAudio}>
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 18 }}
                      >
                        stop
                      </span>
                      Stop ({hotkey})
                    </V2Button>
                    <V2Button variant="accent" size="lg" onClick={restartAudio}>
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 18 }}
                      >
                        restart_alt
                      </span>
                      Restart Audio
                    </V2Button>
                  </>
                ) : (
                  <V2Button
                    variant="accent"
                    size="lg"
                    onClick={startWithCountdown}
                    disabled={!selectedJob.audio_path}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 18 }}
                    >
                      play_arrow
                    </span>
                    Start Audio ({hotkey})
                  </V2Button>
                )}
              </div>
            </GlassCard>
          )}

          {/* Step 4: Upload Recording */}
          {selectedJob.status === "READY_TO_RECORD" && (
            <GlassCard style={{ padding: 20 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--v2-accent)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 12,
                }}
              >
                Step 4 — Upload Your Recording
              </div>

              <div
                {...getRootProps()}
                style={{
                  border: isDragActive
                    ? "2px dashed var(--v2-accent)"
                    : "2px dashed rgba(255,255,255,0.15)",
                  borderRadius: 12,
                  padding: "32px 24px",
                  textAlign: "center",
                  cursor: uploading ? "wait" : "pointer",
                  transition: "border-color 150ms, background 150ms",
                  background: isDragActive
                    ? "rgba(var(--v2-accent-rgb), 0.07)"
                    : "transparent",
                }}
              >
                <input {...getInputProps()} />
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 40,
                    color: "var(--v2-text-2)",
                    opacity: 0.5,
                    display: "block",
                    marginBottom: 8,
                  }}
                >
                  upload_file
                </span>
                {uploading ? (
                  <div>
                    <p
                      style={{
                        fontSize: 14,
                        color: "var(--v2-text-1)",
                        margin: 0,
                      }}
                    >
                      Uploading in the background… {uploadProgress ?? 0}%
                    </p>
                    <div
                      style={{
                        marginTop: 8,
                        height: 4,
                        background: "rgba(255,255,255,0.1)",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${uploadProgress ?? 0}%`,
                          height: "100%",
                          background: "var(--v2-accent)",
                          transition: "width 300ms",
                        }}
                      />
                    </div>
                    <p
                      style={{
                        fontSize: 11,
                        color: "var(--v2-text-2)",
                        margin: "8px 0 0 0",
                      }}
                    >
                      Go pick your next job — this keeps uploading, resumes
                      after a dropped connection, and survives a page reload.
                    </p>
                  </div>
                ) : (
                  <>
                    <p
                      style={{
                        fontSize: 14,
                        color: "var(--v2-text-1)",
                        margin: "0 0 4px 0",
                      }}
                    >
                      Drag & drop or click to upload
                    </p>
                    <p
                      style={{
                        fontSize: 11,
                        color: "var(--v2-text-2)",
                        margin: 0,
                      }}
                    >
                      .mp4 · .mov · .mkv · .webm — uploads in the background, in
                      resumable 8 MB chunks
                    </p>
                  </>
                )}
              </div>
            </GlassCard>
          )}

          {/* Step 5 (AWAITING_UPLOAD / SPLICING) is rendered by the shared
              in-progress card near the top — it shows elapsed time, a live
              progress bar and a working retry, instead of the flat
              "Your recording is being processed" placeholder that used to
              sit here and never changed. */}

          {/* Step 5: Completed — preview + download + drive */}
          {selectedJob.status === "COMPLETED" && (
            <GlassCard
              style={{
                padding: 20,
                border: "1px solid rgba(34, 197, 94, 0.3)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#22c55e",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 16,
                }}
              >
                Step 5 — Preview & Download
              </div>

              <video
                src={`/api/production/jobs/${selectedJob.id}/download`}
                controls
                style={{
                  width: "100%",
                  borderRadius: 8,
                  background: "#000",
                  marginBottom: 16,
                  maxHeight: 360,
                }}
              />

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <a
                  href={`/api/production/jobs/${selectedJob.id}/download`}
                  download
                  style={{ textDecoration: "none" }}
                >
                  <V2Button variant="accent" size="md">
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 16 }}
                    >
                      download
                    </span>
                    Download MP4
                  </V2Button>
                </a>

                {/* READ-ONLY — see the note on the other DriveDeliveryStatus. */}
                <DriveDeliveryStatus
                  delivered={selectedJob.delivered_to_drive ?? false}
                />

                {/* The "Auto-upload to Drive — Coming Soon" placeholder that
                    lived here was removed 2026-08-03: auto-upload is live and
                    has been delivering for weeks. A disabled "coming soon"
                    control for a shipped feature teaches VAs to do it by hand. */}
              </div>
            </GlassCard>
          )}

          {/* Thumbnail panel for the completed video */}
          {selectedJob.status === "COMPLETED" && (
            <StudioThumbnailPanel jobId={selectedJob.id} />
          )}

          {/* Failed state */}
          {selectedJob.status === "FAILED_SPLICE" && (
            <GlassCard
              style={{
                padding: 20,
                border: "1px solid rgba(239, 68, 68, 0.3)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#ef4444",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 8,
                }}
              >
                Splice Failed
              </div>
              {selectedJob.error_message && (
                <p
                  style={{ fontSize: 12, color: "var(--v2-text-2)", margin: 0 }}
                >
                  {selectedJob.error_message}
                </p>
              )}
            </GlassCard>
          )}
        </div>
      )}
    </div>
  );
}
