/**
 * Job stage semantics — shared by the Jobs list, the Dashboard and Dark Factory.
 *
 * Every status is classified into a lane, given a plain-English explanation of
 * what is happening or what is being waited on, and — crucially — a concrete
 * next action the operator can take. The whole point is that no piece of state
 * is displayed without also saying what it means and what you can do about it.
 *
 * Pure functions, no I/O. Safe on both server and client.
 */

export type StageGroup =
  | "queued"
  | "working"
  | "needs-human"
  | "publishing"
  | "done"
  | "failed"
  | "paused";

export interface StageInfo {
  group: StageGroup;
  /** Short label for chips/columns. */
  label: string;
  /**
   * What is actually happening, or what is being waited on. Written for a human
   * skimming at 7am who wants to know whether to worry.
   */
  meaning: string;
  /** Accent colour for this lane. */
  color: string;
  /** True when a person must do something before the job can move. */
  blocksOnHuman: boolean;
  /**
   * Route that lets the operator act on this job, relative to /jobs/<id>.
   * Empty string means the job detail page itself is the place to act.
   */
  actionPath: string;
  /** Label for that action, when there is a specific one. */
  actionLabel: string | null;
}

const LANE_COLOR: Record<StageGroup, string> = {
  queued: "#9991a4",
  working: "var(--v2-accent)",
  "needs-human": "#f97316",
  publishing: "#80ccff",
  done: "#23decb",
  failed: "#ffb4ab",
  paused: "#cdc3d7",
};

function info(
  group: StageGroup,
  label: string,
  meaning: string,
  opts: {
    actionPath?: string;
    actionLabel?: string | null;
  } = {},
): StageInfo {
  return {
    group,
    label,
    meaning,
    color: LANE_COLOR[group],
    blocksOnHuman: group === "needs-human",
    actionPath: opts.actionPath ?? "",
    actionLabel: opts.actionLabel ?? null,
  };
}

const STAGES: Record<string, StageInfo> = {
  // ── Automated pipeline ───────────────────────────────────────────────────
  IDEA_GENERATION: info("queued", "Idea", "Generating the topic idea."),
  SCRIPTING: info("working", "Scripting", "An LLM is writing the script.", {
    actionLabel: "Inject script",
  }),
  AWAITING_RESEARCH: info(
    "needs-human",
    "Needs research",
    "Waiting for you to upload research before the script can be written.",
    { actionLabel: "Upload research" },
  ),
  RESEARCH_UPLOADED: info(
    "working",
    "Research in",
    "Research received; the pipeline is picking it up.",
  ),
  TRANSLATING: info("working", "Translating", "Translating the script."),
  ASSET_COLLECTION: info(
    "working",
    "Assets",
    "Generating narration and scene images.",
  ),
  CLIP_SELECTION: info(
    "working",
    "Clip selection",
    "Choosing which clips cover each sentence.",
  ),
  AWAITING_CLIP_REVIEW: info(
    "needs-human",
    "Review clips",
    "The edit list is ready and needs a human to approve it.",
    { actionPath: "/edit-list", actionLabel: "Review edit list" },
  ),
  QMS_VALIDATING: info(
    "working",
    "Pre-flight",
    "Running pre-render validation checks.",
  ),
  ROUTING_RENDER: info(
    "working",
    "Routing",
    "Deciding which render engine to use.",
  ),
  RENDERING_FFMPEG: info("working", "Rendering", "Rendering with FFmpeg."),
  RENDERING_REMOTION: info("working", "Rendering", "Rendering with Remotion."),

  // ── Human-in-the-loop ────────────────────────────────────────────────────
  AWAITING_PRODUCTION_VA: info(
    "needs-human",
    "Needs VA",
    "Waiting on a production VA to upload footage.",
    { actionLabel: "Assign / upload" },
  ),
  AWAITING_IMAGE_QC: info(
    "needs-human",
    "Image QC",
    "Scene images are generated and need approving before the render starts.",
    { actionPath: "/image-qc", actionLabel: "Review images" },
  ),
  AWAITING_VA_REVIEW: info(
    "needs-human",
    "B-roll pick",
    "Parked before rendering until a VA picks and trims the B-roll.",
    { actionPath: "/va-review", actionLabel: "Open studio" },
  ),
  AWAITING_QC: info(
    "needs-human",
    "Final QC",
    "The video is rendered and waiting on a final quality check.",
    { actionLabel: "Review video" },
  ),
  AWAITING_UPLOADER: info(
    "publishing",
    "Ready to upload",
    "Rendered and approved — ready to be published to YouTube.",
    { actionLabel: "Open to upload" },
  ),
  UPLOADING: info("publishing", "Uploading", "Upload to YouTube in progress."),

  // ── Terminal ─────────────────────────────────────────────────────────────
  PUBLISHED: info("done", "Published", "Live on YouTube."),
  CANCELLED: info("done", "Cancelled", "Cancelled by an operator."),
  DELETED: info("done", "Deleted", "Deleted."),
  MARKED_FOR_DELETION: info(
    "done",
    "For deletion",
    "Flagged for deletion; its media may already have been cleaned up.",
  ),

  // ── Failures ─────────────────────────────────────────────────────────────
  FAILED_QMS: info(
    "failed",
    "Failed: pre-flight",
    "Pre-render validation rejected this job.",
    { actionLabel: "Retry" },
  ),
  FAILED_CLIP_SELECTION: info(
    "failed",
    "Failed: clips",
    "Clip selection failed.",
    { actionLabel: "Retry" },
  ),
  FAILED_RENDER: info("failed", "Failed: render", "The render failed.", {
    actionLabel: "Retry",
  }),
  FAILED_UPLOAD: info("failed", "Failed: upload", "The upload failed.", {
    actionLabel: "Retry",
  }),
  FAILED_GENERAL: info("failed", "Failed", "The job failed.", {
    actionLabel: "Retry",
  }),
  FAILED_IRRECOVERABLE: info(
    "failed",
    "Failed: fatal",
    "Cannot be retried automatically — needs a human to investigate.",
  ),
  FAILED_SPACE_PIPELINE: info(
    "failed",
    "Failed: space",
    "The retired space-video pipeline failed.",
  ),

  // ── Special ──────────────────────────────────────────────────────────────
  PAUSED: info("paused", "Paused", "Paused by an operator.", {
    actionLabel: "Resume",
  }),
};

/** Prefix-based fallbacks for the per-format pipeline states. */
function fallbackStage(status: string): StageInfo {
  if (status.startsWith("FAILED_")) {
    return info("failed", "Failed", `Failed at ${humanize(status)}.`, {
      actionLabel: "Retry",
    });
  }
  if (status.startsWith("AWAITING_")) {
    return info(
      "needs-human",
      humanize(status),
      `Waiting: ${humanize(status)}.`,
    );
  }
  if (status.startsWith("DRAMA_") || status.startsWith("SPACE_")) {
    return info(
      "working",
      humanize(status),
      `Pipeline stage: ${humanize(status)}.`,
    );
  }
  return info(
    "working",
    humanize(status),
    `Pipeline stage: ${humanize(status)}.`,
  );
}

function humanize(status: string): string {
  const s = status
    .replace(/^(DRAMA|SPACE)_/, "")
    .replace(/_/g, " ")
    .toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Look up the semantics of a job status. Always returns something usable. */
export function stageFor(status: string): StageInfo {
  return STAGES[status] ?? fallbackStage(status);
}

/** True when the job is in a state a manual retry can act on. */
export function isRetryable(status: string): boolean {
  return status.startsWith("FAILED_") && status !== "FAILED_IRRECOVERABLE";
}

// ── Named filter groups, shared by the list, dashboard and factory ─────────

export const STATUS_GROUPS = {
  "needs-human": [
    "AWAITING_RESEARCH",
    "AWAITING_PRODUCTION_VA",
    "AWAITING_IMAGE_QC",
    "AWAITING_CLIP_REVIEW",
    "AWAITING_VA_REVIEW",
    "AWAITING_QC",
  ],
  "upload-queue": [
    "AWAITING_UPLOADER",
    "UPLOADING",
    "PUBLISHED",
    "FAILED_UPLOAD",
  ],
  rendering: ["ROUTING_RENDER", "RENDERING_REMOTION", "RENDERING_FFMPEG"],
  failed: [
    "FAILED_QMS",
    "FAILED_CLIP_SELECTION",
    "FAILED_RENDER",
    "FAILED_UPLOAD",
    "FAILED_GENERAL",
    "FAILED_IRRECOVERABLE",
    "FAILED_SPACE_PIPELINE",
  ],
  working: [
    "IDEA_GENERATION",
    "SCRIPTING",
    "RESEARCH_UPLOADED",
    "TRANSLATING",
    "ASSET_COLLECTION",
    "CLIP_SELECTION",
    "QMS_VALIDATING",
    "ROUTING_RENDER",
    "RENDERING_FFMPEG",
    "RENDERING_REMOTION",
  ],
} as const;

export type StatusGroupKey = keyof typeof STATUS_GROUPS;

/** Resolve a `?status=` value into the concrete statuses to filter on. */
export function resolveStatusFilter(
  status: string | undefined,
): string | string[] | undefined {
  if (!status) return undefined;
  if (status in STATUS_GROUPS) {
    return [...STATUS_GROUPS[status as StatusGroupKey]];
  }
  // Legacy aliases kept so old bookmarks — and any links still emitting them —
  // keep working. `__va_queue__` is what the image-QC exit and the old
  // jobs-table "VA queue" link push; it was never aliased here, so it fell
  // through as a literal status value and matched zero rows.
  if (status === "va-queue" || status === "__va_queue__") {
    return [...STATUS_GROUPS["needs-human"]];
  }
  return status;
}

// ── Time formatting ───────────────────────────────────────────────────────

/**
 * Compact "how long has it been stuck here" string. Deliberately terse so it
 * fits in a dense table: 4m, 3h, 2d.
 */
export function shortDuration(since: Date | string | null): string | null {
  if (!since) return null;
  const ms = Date.now() - new Date(since).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Is a job worryingly old for its stage? Used to flag stuck work rather than
 * making the operator compare timestamps by eye.
 */
export function isStuck(status: string, since: Date | string | null): boolean {
  if (!since) return false;
  const stage = stageFor(status);
  if (stage.group === "done" || stage.group === "failed") return false;
  const hours = (Date.now() - new Date(since).getTime()) / 3_600_000;
  // Automated stages should never take hours; human stages get a day.
  if (stage.group === "working") return hours > 2;
  if (stage.group === "queued") return hours > 2;
  if (stage.group === "publishing") return hours > 24;
  if (stage.group === "needs-human") return hours > 24;
  return false;
}
