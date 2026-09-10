"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { GlassCard, V2Button } from "../../_components";
import { DispatchControl } from "./dispatch-control";
import { ChannelSchedules } from "./channel-schedules";
import { PublicationPlan } from "./publication-plan";
import { UploaderAssignments } from "./uploader-assignments";
import { ChannelDeliveryPolicy } from "./channel-delivery-policy";
import { summarizeDelivery, uploadStateLabel } from "@/lib/uploader/delivery-status";

interface UploaderDispatchView {
  id: string;
  state: string;
  latestMessage: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  youtubeVideoUrl: string | null;
  requestedAt: string;
  updatedAt: string;
}

interface TranslationDeliveryItem {
  finalReviewRecorded: boolean;
  id: string;
  sourceJobId: string;
  language: string;
  title: string;
  status: string;
  finalPath: string | null;
  isUploaded: boolean;
  uploadedAt: string | null;
  uploadedBy: string | null;
  youtubeUploadUrl: string | null;
  uploaderStatus: string | null;
  youtubeVisibility: string | null;
  scheduledFor: string | null;
  youtubePublishedAt: string | null;
  uploadVerifiedAt: string | null;
  driveFileId: string | null;
  driveUrl: string | null;
  completedAt: string | null;
  description: string | null;
  tags: string[] | null;
  deliveredToDrive: boolean;
  driveState: "uploaded" | "uploading" | "failed" | "held" | "pending";
  driveArtifactCount: number;
  driveFolderPath: string | null;
  driveError: string | null;
  thumbnailId: string | null;
  thumbnailKind: "none" | "automatic" | "ai";
  thumbnailApproved: boolean;
  dispatchBlockers: string[];
  uploader: UploaderDispatchView | null;
}

interface VideoDeliveryRow {
  finalReviewRecorded: boolean;
  id: string;
  title: string;
  keywordRef: string | null;
  ktUrl: string | null;
  channelName: string | null;
  creatorName: string | null;
  creatorEmail: string | null;
  status: string;
  finalPath: string | null;
  durationS: number | null;
  isUploaded: boolean;
  uploadedAt: string | null;
  uploadedBy: string | null;
  youtubeUploadUrl: string | null;
  uploaderStatus: string | null;
  youtubeVisibility: string | null;
  scheduledFor: string | null;
  youtubePublishedAt: string | null;
  uploadVerifiedAt: string | null;
  driveFileId: string | null;
  driveUrl: string | null;
  completedAt: string | null;
  createdAt: string;
  uploader: UploaderDispatchView | null;
  translations: TranslationDeliveryItem[];
  description: string | null;
  tags: string[] | null;
  deliveredToDrive: boolean;
  driveState: "uploaded" | "uploading" | "failed" | "held" | "pending";
  driveArtifactCount: number;
  driveFolderPath: string | null;
  driveError: string | null;
  thumbnailId: string | null;
  thumbnailKind: "none" | "automatic" | "ai";
  thumbnailApproved: boolean;
  dispatchBlockers: string[];
}

interface UploaderStatus {
  connected: boolean;
  error?: string;
  operationsUrl: string;
  channels: Array<{
    id: string;
    name: string;
    language: string;
    youtubeChannelId: string;
    isPrimary: boolean;
    uploaderChannelKey: string | null;
    channelUrl?: string | null;
    studioUrl?: string;
  }>;
  jobs: Array<{
    id: string;
    sourceJobId: string | null;
    channel: string | null;
    profile: string | null;
    title: string | null;
    state: string;
    progress: number;
    currentStep: string | null;
    videoId: string | null;
    updatedAt: string | null;
  }>;
}

interface UploadCalendarDay {
  date: string;
  channelId: string | null;
  channelName: string;
  language: string;
  count: number;
  latestUploadAt: string;
}

const LANGUAGE_FLAGS: Record<string, string> = {
  German: "🇩🇪",
  French: "🇫🇷",
  Spanish: "🇪🇸",
  Japanese: "🇯🇵",
  Korean: "🇰🇷",
  English: "🇺🇸",
  en: "🇺🇸",
  de: "🇩🇪",
  fr: "🇫🇷",
  it: "🇮🇹",
  nl: "🇳🇱",
  sv: "🇸🇪",
};

function videoIdFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      host !== "youtu.be" &&
      host !== "youtube.com" &&
      host !== "m.youtube.com" &&
      host !== "studio.youtube.com"
    ) {
      return null;
    }
    const id =
      host === "youtu.be"
        ? url.pathname.split("/").filter(Boolean)[0]
        : (url.searchParams.get("v") ??
          url.pathname.match(/\/(?:shorts|video)\/([^/?]+)/)?.[1]);
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function VideoPlatformLinks({
  url,
  compact = false,
}: {
  url: string | null;
  compact?: boolean;
}) {
  const videoId = videoIdFromUrl(url);
  if (!videoId) return null;

  const linkStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: compact ? "4px 7px" : "5px 9px",
    borderRadius: 6,
    border: "1px solid var(--v2-border-1)",
    background: "var(--v2-surface-2)",
    color: "var(--v2-text-1)",
    fontSize: compact ? 10 : 11,
    fontWeight: 700,
    textDecoration: "none",
    whiteSpace: "nowrap" as const,
  };

  return (
    <div
      style={{
        display: "inline-flex",
        flexWrap: "wrap",
        justifyContent: "flex-end",
        gap: 6,
      }}
    >
      <a
        href={`https://www.youtube.com/watch?v=${videoId}`}
        target="_blank"
        rel="noreferrer"
        style={{ ...linkStyle, borderColor: "rgba(248,113,113,0.35)" }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          smart_display
        </span>
        View on YouTube
      </a>
      <a
        href={`https://studio.youtube.com/video/${videoId}/edit`}
        target="_blank"
        rel="noreferrer"
        style={{ ...linkStyle, borderColor: "rgba(196,181,253,0.35)" }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          edit_square
        </span>
        View in YouTube Studio
      </a>
    </div>
  );
}

const CHANNEL_COLORS: Record<string, string> = {
  en: "#ef4444",
  english: "#ef4444",
  de: "#f59e0b",
  german: "#f59e0b",
  fr: "#3b82f6",
  french: "#3b82f6",
  it: "#22c55e",
  italian: "#22c55e",
  sv: "#06b6d4",
  swedish: "#06b6d4",
};

function channelColor(language: string): string {
  return CHANNEL_COLORS[language.toLowerCase()] ?? "#a78bfa";
}

function calendarDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function UploadCalendar({
  entries,
  channels,
}: {
  entries: UploadCalendarDay[];
  channels: UploaderStatus["channels"];
}) {
  const now = new Date();
  const [month, setMonth] = useState(
    () => new Date(now.getFullYear(), now.getMonth(), 1),
  );
  const earliestMonth = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const latestMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthPrefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const monthEntries = useMemo(
    () => entries.filter((entry) => entry.date.startsWith(monthPrefix)),
    [entries, monthPrefix],
  );
  const entriesByDate = useMemo(() => {
    const grouped = new Map<string, UploadCalendarDay[]>();
    for (const entry of monthEntries) {
      const day = grouped.get(entry.date) ?? [];
      day.push(entry);
      day.sort((a, b) => a.channelName.localeCompare(b.channelName));
      grouped.set(entry.date, day);
    }
    return grouped;
  }, [monthEntries]);
  const firstDayOffset = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: firstDayOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const totalUploads = monthEntries.reduce(
    (sum, entry) => sum + entry.count,
    0,
  );
  const legendChannels = channels.filter(
    (channel, index, all) =>
      all.findIndex((candidate) => candidate.language === channel.language) ===
      index,
  );
  const previousDisabled = month.getTime() <= earliestMonth.getTime();
  const nextDisabled = month.getTime() >= latestMonth.getTime();

  const moveMonth = (offset: number) => {
    setMonth(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + offset, 1),
    );
  };

  return (
    <GlassCard style={{ padding: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ color: "var(--v2-text-1)", fontSize: 13, fontWeight: 800 }}>
            Upload calendar
          </div>
          <div
            style={{ color: "var(--v2-text-2)", fontSize: 10, marginTop: 3 }}
          >
            {totalUploads} uploads across {entriesByDate.size} active days. A
            dot shows which channel uploaded; the number is that channel&apos;s
            daily total.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            aria-label="Previous month"
            disabled={previousDisabled}
            onClick={() => moveMonth(-1)}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "1px solid var(--v2-border-1)",
              background: "var(--v2-surface-2)",
              color: previousDisabled ? "var(--v2-text-3)" : "var(--v2-text-1)",
              cursor: previousDisabled ? "not-allowed" : "pointer",
            }}
          >
            &lsaquo;
          </button>
          <div
            style={{
              minWidth: 122,
              textAlign: "center",
              color: "var(--v2-text-1)",
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            {month.toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })}
          </div>
          <button
            type="button"
            aria-label="Next month"
            disabled={nextDisabled}
            onClick={() => moveMonth(1)}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "1px solid var(--v2-border-1)",
              background: "var(--v2-surface-2)",
              color: nextDisabled ? "var(--v2-text-3)" : "var(--v2-text-1)",
              cursor: nextDisabled ? "not-allowed" : "pointer",
            }}
          >
            &rsaquo;
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginTop: 10,
          marginBottom: 9,
        }}
      >
        {legendChannels.map((channel) => (
          <span
            key={channel.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              color: "var(--v2-text-2)",
              fontSize: 10,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: channelColor(channel.language),
                boxShadow: `0 0 7px ${channelColor(channel.language)}`,
              }}
            />
            {channel.name}
          </span>
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(82px, 1fr))",
            minWidth: 650,
            gap: 4,
          }}
        >
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
            <div
              key={label}
              style={{
                padding: "4px 6px",
                color: "var(--v2-text-3)",
                fontSize: 9,
                fontWeight: 800,
                textTransform: "uppercase",
              }}
            >
              {label}
            </div>
          ))}
          {cells.map((day, index) => {
            if (day === null) {
              return <div key={`empty-${index}`} style={{ minHeight: 78 }} />;
            }
            const date = new Date(month.getFullYear(), month.getMonth(), day);
            const dateKey = calendarDateKey(date);
            const dayEntries = entriesByDate.get(dateKey) ?? [];
            const isToday = dateKey === calendarDateKey(now);
            return (
              <div
                key={dateKey}
                style={{
                  minHeight: 78,
                  padding: 6,
                  borderRadius: 7,
                  border: isToday
                    ? "1px solid rgba(170,255,0,0.65)"
                    : "1px solid var(--v2-border-1)",
                  background: dayEntries.length
                    ? "var(--v2-surface-2)"
                    : "var(--v2-surface-2)",
                }}
              >
                <div
                  style={{
                    color: isToday ? "var(--v2-accent)" : "var(--v2-text-2)",
                    fontSize: 10,
                    fontWeight: 800,
                  }}
                >
                  {day}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    marginTop: 5,
                  }}
                >
                  {dayEntries.map((entry) => (
                    <div
                      key={`${dateKey}-${entry.channelId ?? entry.channelName}-${entry.language}`}
                      title={`${entry.channelName}: ${entry.count} upload${entry.count === 1 ? "" : "s"}; latest ${new Date(entry.latestUploadAt).toLocaleString()}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        minWidth: 0,
                        color: "var(--v2-text-2)",
                        fontSize: 9,
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          flexShrink: 0,
                          borderRadius: "50%",
                          background: channelColor(entry.language),
                        }}
                      />
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {entry.language.toUpperCase()}
                      </span>
                      <strong style={{ marginLeft: "auto", color: "var(--v2-text-1)" }}>
                        {entry.count}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </GlassCard>
  );
}

function ThumbnailPreview({
  jobId,
  thumbnailId,
  approved,
}: {
  jobId: string;
  thumbnailId: string | null;
  kind: string;
  approved: boolean;
}) {
  return (
    <a
      href={`/thumbnails?jobId=${jobId}`}
      title="Open this video in Thumbnail Studio"
      style={{
        display: "block",
        width: 144,
        aspectRatio: "16 / 9",
        borderRadius: 7,
        overflow: "hidden",
        flexShrink: 0,
        position: "relative",
        background: "rgba(0,0,0,.4)",
        border: "1px solid rgba(255,255,255,.12)",
      }}
    >
      {thumbnailId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/thumbnails/image/${thumbnailId}`}
          alt="Thumbnail"
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "#fca5a5",
            fontSize: 10,
          }}
        >
          No thumbnail
        </span>
      )}
      <span
        style={{
          position: "absolute",
          left: 5,
          bottom: 5,
          padding: "2px 5px",
          borderRadius: 4,
          background: "rgba(0,0,0,.78)",
          color: approved ? "#86efac" : "#fff",
          fontSize: 8,
          textTransform: "uppercase",
        }}
      >
        {approved ? "Approved" : thumbnailId ? "Needs review" : "Missing"}
      </span>
    </a>
  );
}

function MetadataBlock({
  description,
  tags,
}: {
  description: string | null;
  tags: string[] | null;
}) {
  return (
    <div
      style={{
        marginTop: 8,
        padding: 9,
        borderRadius: 7,
        background: "var(--v2-surface-2)",
        fontSize: 11,
        color: "var(--v2-text-2)",
        whiteSpace: "pre-wrap",
      }}
    >
      <strong style={{ color: "var(--v2-text-1)" }}>Description</strong>
      <div style={{ marginTop: 4 }}>{description || "Not generated"}</div>
      <strong style={{ color: "var(--v2-text-1)", display: "block", marginTop: 7 }}>
        Tags
      </strong>
      <div>{tags?.length ? tags.join(", ") : "Not generated"}</div>
    </div>
  );
}

type ApprovedDeliveryManifest = {
  approvalRevision: string;
  tutorialId: string;
  video: { url: string };
  thumbnail: { url: string };
};

function clickDownload(url: string, filename?: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  if (filename) anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function DeliveryDownloads({ jobId }: { jobId: string }) {
  const [busy, setBusy] = useState<"video" | "thumbnail" | "all" | null>(null);
  const download = async (kind: "video" | "thumbnail" | "all") => {
    if (busy) return;
    setBusy(kind);
    try {
      const response = await fetch(`/api/production/jobs/${jobId}/manual-delivery`);
      const manifest = (await response.json()) as ApprovedDeliveryManifest & { error?: string };
      if (!response.ok) throw new Error(manifest.error ?? "Approved delivery files are unavailable");
      if (kind === "video" || kind === "all") clickDownload(manifest.video.url);
      if (kind === "thumbnail" || kind === "all") clickDownload(manifest.thumbnail.url);
      if (kind === "all") {
        const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }));
        clickDownload(blobUrl, `tutorial-${jobId}-metadata.json`);
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Download failed");
    } finally {
      setBusy(null);
    }
  };
  const style = { minHeight: 32, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--v2-border-1)", background: "var(--v2-surface-2)", color: "var(--v2-text-1)", fontSize: 11, fontWeight: 700, cursor: busy ? "wait" : "pointer" } as const;
  return <div role="group" aria-label="Approved delivery downloads" style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
    <button type="button" style={style} disabled={Boolean(busy)} onClick={() => void download("video")}>{busy === "video" ? "Preparing…" : "Video"}</button>
    <button type="button" style={style} disabled={Boolean(busy)} onClick={() => void download("thumbnail")}>{busy === "thumbnail" ? "Preparing…" : "Thumbnail"}</button>
    <button type="button" style={style} disabled={Boolean(busy)} onClick={() => void download("all")}>{busy === "all" ? "Preparing…" : "All 3 files"}</button>
  </div>;
}

const FAILED_UPLOADER_STATES = new Set([
  "publish_failed",
  "failed",
  "uncertain",
  "rejected",
  "generic_uncertain",
  "generic_failed",
]);

function UploaderDispatchControl({
  dispatch,
  authorized,
  disabled,
  disabledReason,
  busy,
  onDispatch,
}: {
  dispatch: UploaderDispatchView | null;
  authorized: boolean;
  disabled: boolean;
  disabledReason?: string;
  busy: boolean;
  onDispatch: () => void;
}) {
  if (!dispatch && !authorized) return null;

  if (!dispatch) {
    return (
      <div style={{ maxWidth: 240 }}>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={onDispatch}
          title={
            disabled
              ? (disabledReason ??
                "Confirm audience, monetization, and any required ad suitability above first")
              : "Create one idempotent uploader request"
          }
          style={{
            padding: "5px 10px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 800,
            cursor: disabled || busy ? "not-allowed" : "pointer",
            border: "1px solid rgba(96,165,250,0.45)",
            background: "rgba(59,130,246,0.16)",
            color: disabled || busy ? "var(--v2-text-3)" : "var(--v2-text-1)",
            opacity: busy ? 0.65 : 1,
          }}
        >
          {busy ? "Queueing..." : "Queue uploader"}
        </button>
        {disabledReason && (
          <div style={{ marginTop: 4, color: "var(--v2-error)", fontSize: 9 }}>
            {disabledReason}
          </div>
        )}
      </div>
    );
  }

  const failed = FAILED_UPLOADER_STATES.has(dispatch.state);
  const succeeded = dispatch.state === "succeeded" || dispatch.state === "generic_published";
  const color = failed ? "var(--v2-error)" : "var(--v2-text-1)";
  const background = failed
    ? "rgba(239,68,68,0.14)"
    : succeeded
      ? "rgba(34,197,94,0.14)"
      : "rgba(234,179,8,0.14)";
  const statusLabel = ({ generic_queued: "Awaiting scheduled connector", generic_dispatched: "Dispatched — awaiting evidence", generic_uploading: "Uploading", generic_uploaded: "Uploaded — not public", generic_scheduled: "Externally scheduled", generic_published: "Verified published", generic_uncertain: "Uncertain — reconcile, do not retry", generic_failed: "Failed — reconciliation required", requested: "Queued in Studio", publishing: "Preparing handoff", published: "Handed off to uploader", succeeded: "Upload verified", uncertain: "Uncertain — reconcile before retry" } as Record<string, string>)[dispatch.state] ?? dispatch.state.replaceAll("_", " ");
  const stalled = ["generic_dispatched", "generic_uploading"].includes(dispatch.state) && Date.now() - Date.parse(dispatch.updatedAt) > 30 * 60_000;
  const detail = stalled ? "No recent connector evidence. Outcome is uncertain; reconcile this request rather than creating a second upload." : dispatch.errorMessage ?? dispatch.latestMessage ?? undefined;

  return (
    <div
      title={detail}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 9px",
        borderRadius: 6,
        border: "1px solid var(--v2-border-2)",
        background,
        color,
        fontSize: 10,
        fontWeight: 800,
        textTransform: "capitalize",
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
        {failed ? "error" : succeeded ? "check_circle" : "hourglass_top"}
      </span>
      Uploader: {stalled ? "No recent evidence — reconcile" : statusLabel}
    </div>
  );
}

export function UploadsTable() {
  const [deliveryMode, setDeliveryMode] = useState<"manual" | "private" | "scheduled">("manual");
  const [manualReportId, setManualReportId] = useState<string | null>(null);
  const [manualReportUrl, setManualReportUrl] = useState("");
  const manualReportRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (manualReportId) manualReportRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [manualReportId]);
  const [videos, setVideos] = useState<VideoDeliveryRow[]>([]);
  const [uploadCalendar, setUploadCalendar] = useState<UploadCalendarDay[]>([]);
  const [canDispatch, setCanDispatch] = useState(false);
  const [canViewPlan, setCanViewPlan] = useState(false);
  const [canInspectUploader, setCanInspectUploader] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [cursor, setCursor] = useState<{ beforeAt: string; beforeId: string } | null>(null);
  const [nextCursor, setNextCursor] = useState<{ beforeAt: string; beforeId: string } | null>(null);
  const requestGeneration = useRef(0);
  useEffect(() => { const timer = window.setTimeout(() => { setSearchQuery(search.trim()); setCursor(null); }, 300); return () => window.clearTimeout(timer); }, [search]);
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "UPLOADED">("ALL");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [uploader, setUploader] = useState<UploaderStatus | null>(null);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<"private" | "unlisted">(
    "unlisted",
  );
  const [monetization, setMonetization] = useState<"" | "on" | "off">("");
  const [audienceConfirmed, setAudienceConfirmed] = useState(false);
  const [adSuitabilityConfirmed, setAdSuitabilityConfirmed] = useState(false);

  const loadData = useCallback(async (silent = false) => {
    const generation = ++requestGeneration.current;
    if (!silent) setLoading(true);
    try {
      const query = new URLSearchParams({ q: searchQuery, filter, ...(cursor ?? {}) });
      const res = await fetch(`/api/production/uploads?${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (generation !== requestGeneration.current) return;
      setVideos(data.videos ?? []);
      setNextCursor(data.nextCursor ?? null);
      setUploadCalendar(data.uploadCalendar ?? []);
      setCanDispatch(Boolean(data.canDispatch));
      setCanViewPlan(Boolean(data.canViewPlan));
      setCanInspectUploader(Boolean(data.canInspectUploader));
    } catch (e) {
      if (!silent && generation === requestGeneration.current) {
        toast.error(
          `Failed to load uploads data: ${e instanceof Error ? e.message : "error"}`,
        );
      }
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [searchQuery, filter, cursor]);

  const loadUploader = useCallback(async () => {
    try {
      const res = await fetch("/api/production/uploader-status", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUploader((await res.json()) as UploaderStatus);
    } catch (error) {
      setUploader({
        connected: false,
        error: error instanceof Error ? error.message : "Uploader unavailable",
        operationsUrl: "/uploader-ops/",
        channels: [],
        jobs: [],
      });
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);
  useEffect(() => {
    if (deliveryMode === "manual" || !canInspectUploader) return;
    void loadUploader();
    const timer = setInterval(() => void loadUploader(), 15_000);
    return () => clearInterval(timer);
  }, [deliveryMode, canInspectUploader, loadUploader]);

  // The Drive bridge polls every 15 seconds. Follow it at the same cadence so
  // receipt progress appears without an operator repeatedly pressing Refresh.
  useEffect(() => {
    const timer = window.setInterval(() => void loadData(true), 15_000);
    return () => window.clearInterval(timer);
  }, [loadData]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      // One lightweight accordion row at a time. Keeping dozens of translated
      // metadata blocks mounted caused the severe full-page re-render lag.
      return prev.has(id) ? new Set() : new Set([id]);
    });
  };

  const handleToggleUploaded = async (
    jobId: string,
    currentStatus: boolean,
    isChildTranslation = false,
    parentId?: string,
  ) => {
    if (currentStatus) return;
    setManualReportId(jobId); setManualReportUrl("");
  };
  const submitManualReport = async () => {
    if (!manualReportId) return;
    setTogglingId(manualReportId);
    try {
      const res = await fetch("/api/production/uploads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: manualReportId, isUploaded: true, youtubeUrl: manualReportUrl }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? `HTTP ${res.status}`);
      toast.success("Manual upload reported. Publication has not been independently verified.");
      setManualReportId(null);
      void loadData();
    } catch (e) {
      toast.error(
        `Could not update upload status: ${e instanceof Error ? e.message : "error"}`,
      );
      void loadData();
    } finally {
      setTogglingId(null);
    }
  };

  const dispatchDeclarationsComplete =
    audienceConfirmed &&
    monetization !== "" &&
    (monetization === "off" || adSuitabilityConfirmed);

  const handleDispatch = async (jobId: string) => {
    if (!audienceConfirmed) {
      toast.error(
        "Confirm that the video is not made for kids before queueing.",
      );
      return;
    }
    if (!monetization) {
      toast.error("Choose an explicit monetization setting before queueing.");
      return;
    }
    if (monetization === "on" && !adSuitabilityConfirmed) {
      toast.error("Confirm ad suitability before enabling monetization.");
      return;
    }

    setDispatchingId(jobId);
    try {
      const res = await fetch(
        `/api/production/jobs/${jobId}/${deliveryMode === "scheduled" ? "scheduled-delivery" : "uploader-dispatch"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visibility: deliveryMode === "scheduled" ? "private" : visibility,
            made_for_kids: false,
            monetization,
            ...(monetization === "on"
              ? { ad_suitability_confirmed: true }
              : {}),
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        idempotent?: boolean;
      };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast.success(
        body.idempotent
          ? "This tutorial already has an uploader request."
          : "Uploader request queued.",
      );
      await loadData();
    } catch (error) {
      toast.error(
        `Could not queue uploader: ${error instanceof Error ? error.message : "error"}`,
      );
    } finally {
      setDispatchingId(null);
    }
  };

  const filteredVideos = videos;

  const deliveryCounts = summarizeDelivery(videos);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Header & Metrics */}
      {canInspectUploader && <><DispatchControl /><ChannelSchedules /><UploaderAssignments /><ChannelDeliveryPolicy /></>}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", padding: "8px 0", fontSize: 13 }}>
        <label>Delivery method <select aria-label="Delivery method" value={deliveryMode} onChange={event => setDeliveryMode(event.target.value as typeof deliveryMode)} style={{ padding: 8, color: "var(--v2-text-1)", background: "var(--v2-surface-2)", border: "1px solid var(--v2-border-1)", borderRadius: 6 }}>
          <option value="manual">Manual VA upload</option>
          {canDispatch && <option value="private">Connected uploader — private / unlisted</option>}
          {canDispatch && <option value="scheduled">Scheduled delivery — requires compatible connector</option>}
        </select></label>
        <details>
          <summary style={{ cursor: "pointer" }}>Drive files &amp; folders</summary>
          <p style={{ color: "var(--v2-text-2)", margin: "8px 0" }}>These are recorded Drive links for the tutorials you can access. A link alone does not prove that every artifact is backed up.</p>
          {videos.some(video => video.driveUrl) ? <ul style={{ margin: 0, paddingLeft: 20 }}>{videos.filter(video => video.driveUrl).slice(0, 15).map(video => <li key={video.id}><a href={video.driveUrl!} target="_blank" rel="noreferrer">{video.title || "Untitled tutorial"}</a> <span style={{ color: "var(--v2-text-2)" }}>· {video.driveState}</span></li>)}</ul> : <p style={{ color: "var(--v2-text-2)" }}>No Drive links are recorded for this loaded queue yet. Approved assets can still be downloaded directly below.</p>}
          {videos.filter(video => video.driveUrl).length > 15 && <p style={{ color: "var(--v2-text-2)" }}>More Drive links are available on each tutorial row below.</p>}
        </details>
        {deliveryMode === "manual" ? <>
          <details style={{ color: "var(--v2-text-2)", fontSize: 13 }}><summary style={{ cursor: "pointer" }}>Manual upload checklist</summary>
            <ol><li>Download the approved video, thumbnail and localized metadata.</li><li>Use the assigned channel and the Studio reservation when scheduling.</li><li>Do not manually upload a tutorial already handed to a connected uploader.</li><li>Save the YouTube link with “Report manual upload”. This is a VA report, not independently verified publication.</li></ol>
          </details>
        </> : <details><summary style={{ cursor: "pointer" }}>Connected delivery guidance</summary><p>{deliveryMode === "scheduled" ? "Uses the assigned channel and reserved publication time. A queued request does not mean YouTube has accepted the schedule." : "Verifies private/unlisted uploads; publication is not scheduled."} Confirm the declarations below before queueing.</p></details>}
        {canViewPlan && <details><summary style={{ cursor: "pointer" }}>Publication reservations</summary><PublicationPlan /></details>}
      </div>
      {manualReportId && <div ref={manualReportRef} style={{ padding: 16, border: "1px solid var(--v2-border-1)", borderRadius: 8 }}>
        <strong>Report a manual upload</strong>
        <p>This records your report, not verified publication. Check the correct channel and confirm no uploader request already exists.</p>
        <label>YouTube watch or share link <input aria-label="Manual upload YouTube link" type="url" value={manualReportUrl} onChange={(event) => setManualReportUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" style={{ width: "100%", padding: 10, margin: "8px 0", color: "var(--v2-text-1)", background: "var(--v2-surface-2)", border: "1px solid var(--v2-border-1)" }} /></label>
        <button type="button" disabled={Boolean(togglingId) || !manualReportUrl.trim()} onClick={() => void submitManualReport()}>Save manual report</button>{" "}
        <button type="button" disabled={Boolean(togglingId)} onClick={() => setManualReportId(null)}>Cancel</button>
      </div>}

      {/* Exact channel identities and uploader connection. These links are
          deliberately derived from immutable UC ids, never from handles. */}
      {deliveryMode !== "manual" && canInspectUploader && <GlassCard style={{ padding: 14 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--v2-text-1)" }}>
              YouTube channel network
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--v2-text-1)",
                marginTop: 3,
              }}
            >
              {uploader?.connected
                ? "Uploader connected · receipts sync automatically"
                : `Uploader disconnected${uploader?.error ? ` · ${uploader.error}` : ""}`}
            </div>
          </div>
          <a
            href={uploader?.operationsUrl ?? "/uploader-ops/"}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--v2-accent)", fontSize: 11, fontWeight: 700 }}
          >
            Open uploader operations ↗
          </a>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 8,
            marginTop: 12,
          }}
        >
          {(uploader?.channels ?? []).map((channel) => {
            const latest = channel.uploaderChannelKey
              ? uploader?.jobs.find(
                  (job) => job.channel === channel.uploaderChannelKey,
                )
              : undefined;
            return (
              <div
                key={channel.id}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: "var(--v2-surface-2)",
                  border: "1px solid var(--v2-border-1)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 6,
                  }}
                >
                  <span
                    style={{ fontSize: 12, fontWeight: 700, color: "var(--v2-text-1)" }}
                  >
                    {channel.name}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      color: "var(--v2-text-2)",
                      textTransform: "uppercase",
                    }}
                  >
                    {channel.language}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: "var(--v2-text-3)",
                    marginTop: 3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {channel.youtubeChannelId}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    marginTop: 8,
                    fontSize: 10,
                  }}
                >
                  {channel.channelUrl && (
                    <a
                      href={channel.channelUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "4px 7px",
                        borderRadius: 5,
                        border: "1px solid rgba(147,197,253,0.3)",
                        background: "rgba(59,130,246,0.1)",
                        color: "var(--v2-text-1)",
                        fontWeight: 700,
                        textDecoration: "none",
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 13 }}
                      >
                        smart_display
                      </span>
                      View channel
                    </a>
                  )}
                  <a
                    href={channel.studioUrl ?? "https://studio.youtube.com/"}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "4px 7px",
                      borderRadius: 5,
                      border: "1px solid rgba(196,181,253,0.3)",
                      background: "rgba(139,92,246,0.1)",
                      color: "var(--v2-text-1)",
                      fontWeight: 700,
                      textDecoration: "none",
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 13 }}
                    >
                      dashboard
                    </span>
                    YouTube Studio
                  </a>
                  <span
                    style={{
                      marginLeft: "auto",
                      color: latest ? "var(--v2-text-1)" : "var(--v2-text-3)",
                    }}
                  >
                    {channel.uploaderChannelKey
                      ? (latest?.state ?? "not verified")
                      : "archive only"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>}

      <details>
        <summary style={{ cursor: "pointer", color: "var(--v2-text-2)", fontSize: 13 }}>View upload history calendar</summary>
        <UploadCalendar entries={uploadCalendar} channels={uploader?.channels ?? []} />
      </details>

      {canDispatch && deliveryMode !== "manual" && (
        <GlassCard style={{ padding: 14 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "flex-end",
              gap: 16,
            }}
          >
            <div style={{ minWidth: 150 }}>
              <label
                htmlFor="uploader-visibility"
                style={{
                  display: "block",
                  fontSize: 10,
                  fontWeight: 800,
                  marginBottom: 5,
                }}
              >
                Visibility
              </label>
              <select
                id="uploader-visibility"
                value={deliveryMode === "scheduled" ? "private" : visibility}
                disabled={deliveryMode === "scheduled"}
                onChange={(event) =>
                  setVisibility(event.target.value as "private" | "unlisted")
                }
                style={{
                  width: "100%",
                  padding: "7px 9px",
                  borderRadius: 6,
                  border: "1px solid var(--v2-border-1)",
                  background: "var(--v2-surface-2)",
                  color: "var(--v2-text-1)",
                  fontSize: 12,
                }}
              >
                <option value="private">Private (default)</option>
                <option value="unlisted">Unlisted</option>
              </select>
            </div>

            <div style={{ minWidth: 190 }}>
              <label
                htmlFor="uploader-monetization"
                style={{
                  display: "block",
                  fontSize: 10,
                  fontWeight: 800,
                  marginBottom: 5,
                }}
              >
                Monetization (required)
              </label>
              <select
                id="uploader-monetization"
                value={monetization}
                onChange={(event) => {
                  const value = event.target.value as "" | "on" | "off";
                  setMonetization(value);
                  if (value !== "on") setAdSuitabilityConfirmed(false);
                }}
                style={{
                  width: "100%",
                  padding: "7px 9px",
                  borderRadius: 6,
                  border: "1px solid var(--v2-border-1)",
                  background: "var(--v2-surface-2)",
                  color: "var(--v2-text-1)",
                  fontSize: 12,
                }}
              >
                <option value="">Choose on or off...</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontSize: 11,
              }}
            >
              <input
                type="checkbox"
                checked={audienceConfirmed}
                onChange={(event) => setAudienceConfirmed(event.target.checked)}
              />
              I confirm: not made for kids
            </label>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontSize: 11,
                opacity: monetization === "on" ? 1 : 0.45,
              }}
            >
              <input
                type="checkbox"
                checked={adSuitabilityConfirmed}
                disabled={monetization !== "on"}
                onChange={(event) =>
                  setAdSuitabilityConfirmed(event.target.checked)
                }
              />
              I confirm: no ad-suitability issues (required when on)
            </label>
          </div>
          <div
            style={{ marginTop: 8, color: "var(--v2-text-2)", fontSize: 10 }}
          >
            Queueing is fail-closed: completed localized metadata, the final
            MP4, one exact selected thumbnail, and an explicit uploader channel
            mapping must all exist.
          </div>
        </GlassCard>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 240px", minWidth: 210, fontSize: 13 }}>
          Search <input id="tutorial-upload-search" type="search" aria-label="Search tutorials" placeholder="Title, keyword or VA…" value={search} onChange={event => setSearch(event.target.value)} maxLength={200} style={{ minWidth: 0, flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--v2-border-1)", color: "var(--v2-text-1)", background: "var(--v2-surface-2)" }} />
        </label>
        <div role="group" aria-label="Delivery filter" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {([["ALL", "All"], ["PENDING", "Awaiting delivery"], ["UPLOADED", "Upload reported"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setCursor(null); }} style={{ minHeight: 36, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--v2-border-1)", background: filter === value ? "var(--v2-surface-3)" : "transparent", color: filter === value ? "var(--v2-text-1)" : "var(--v2-text-2)", fontSize: 12, cursor: "pointer" }}>{label}</button>)}
        </div>
        <span style={{ color: "var(--v2-text-2)", fontSize: 12, overflowWrap: "anywhere" }}>Originals on this page: {deliveryCounts.pending} awaiting confirmation · {deliveryCounts.reported} reported, unverified · {deliveryCounts.transferred} uploaded, publication unconfirmed · {deliveryCounts.scheduled} externally scheduled · {deliveryCounts.published} verified published</span>
        <V2Button variant="outline" size="sm" disabled={loading} onClick={() => void loadData()}>Refresh</V2Button>
        <V2Button variant="outline" size="sm" disabled={loading || !cursor} onClick={() => setCursor(null)}>Newest</V2Button>
        <V2Button variant="outline" size="sm" disabled={loading || !nextCursor} onClick={() => { setCursor(nextCursor); setExpandedIds(new Set()); }}>Older</V2Button>
      </div>
      <GlassCard style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              textAlign: "left",
              fontSize: 13,
            }}
          >
            <thead>
              <tr
                style={{
                  background: "var(--v2-surface-2)",
                  borderBottom: "1px solid var(--v2-border-1)",
                  color: "var(--v2-text-2)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                <th style={{ padding: "12px 14px", width: 36 }}></th>
                <th style={{ padding: "12px 14px" }}>Video Title & Keyword</th>
                <th style={{ padding: "12px 14px", width: 140 }}>
                  Creator (VA)
                </th>
                <th style={{ padding: "12px 14px", width: 130 }}>Drive Link</th>
                <th style={{ padding: "12px 14px", width: 110 }}>Download</th>
                <th
                  style={{
                    padding: "12px 14px",
                    width: 180,
                    textAlign: "right",
                  }}
                >
                  Upload Status
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      padding: 32,
                      textAlign: "center",
                      color: "var(--v2-text-2)",
                    }}
                  >
                    Loading delivery and upload records…
                  </td>
                </tr>
              ) : filteredVideos.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      padding: 32,
                      textAlign: "center",
                      color: "var(--v2-text-2)",
                    }}
                  >
                    No completed videos found matching your filter.
                  </td>
                </tr>
              ) : (
                filteredVideos.map((v) => {
                  const isExpanded = expandedIds.has(v.id);
                  const isToggling = togglingId === v.id;
                  const hasTranslations = v.translations.length > 0;
                  const youtubeVideoUrl =
                    v.youtubeUploadUrl ?? v.uploader?.youtubeVideoUrl ?? null;

                  return (
                    <tr
                      key={v.id}
                      style={{
                        borderBottom: "1px solid var(--v2-border-1)",
                        background: v.isUploaded
                          ? "rgba(34,197,94,0.02)"
                          : "transparent",
                      }}
                    >
                      {/* Sub-table row wrapper using fragment */}
                      <td
                        style={{
                          verticalAlign: "top",
                          padding: "14px 10px 14px 14px",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleExpand(v.id)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: hasTranslations
                              ? "var(--v2-accent, #aaff00)"
                              : "var(--v2-text-3)",
                            cursor: hasTranslations ? "pointer" : "default",
                            padding: 0,
                            display: "grid",
                            placeItems: "center",
                          }}
                          title={
                            hasTranslations
                              ? "Toggle translations"
                              : "No translations available"
                          }
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: 18 }}
                          >
                            {isExpanded ? "expand_less" : "expand_more"}
                          </span>
                        </button>
                      </td>

                      {/* Video Title & details */}
                      <td
                        style={{ verticalAlign: "top", padding: "14px 14px" }}
                      >
                        <div
                          style={{
                            display: "flex",
                            gap: 12,
                            alignItems: "flex-start",
                          }}
                        >
                          <ThumbnailPreview
                            jobId={v.id}
                            thumbnailId={v.thumbnailId}
                            kind={v.thumbnailKind}
                            approved={v.thumbnailApproved}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 700,
                                color: "var(--v2-text-1)",
                                fontSize: 14,
                              }}
                            >
                              {v.title}
                            </div>
                            <a
                              href={`/thumbnails?jobId=${v.id}`}
                              style={{
                                color: "var(--v2-accent)",
                                fontSize: 10,
                              }}
                            >
                              Open in Thumbnail Studio ↗
                            </a>
                          </div>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 11,
                            color: "var(--v2-text-2)",
                            marginTop: 4,
                          }}
                        >
                          {v.durationS && (
                            <span>⏱️ {Math.round(v.durationS)}s</span>
                          )}
                          {v.channelName && <span>📺 {v.channelName}</span>}
                          {v.completedAt && (
                            <span>
                              📅{" "}
                              {new Date(v.completedAt).toLocaleDateString(
                                "en-US",
                                { month: "short", day: "numeric" },
                              )}
                            </span>
                          )}
                          {hasTranslations && (
                            <span
                              style={{
                                padding: "1px 6px",
                                borderRadius: 4,
                                background: "var(--v2-surface-2)",
                                color: "var(--v2-text-1)",
                                fontSize: 10,
                                fontWeight: 700,
                              }}
                            >
                              +{v.translations.length} Translations
                            </span>
                          )}
                        </div>

                        {/* Outfolded Translations list */}
                        {isExpanded && (
                          <div
                            style={{
                              marginTop: 12,
                              padding: "10px 14px",
                              borderRadius: 8,
                              background: "var(--v2-surface-2)",
                              border: "1px solid var(--v2-border-1)",
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.06em",
                                color: "var(--v2-accent, #aaff00)",
                                marginBottom: 2,
                              }}
                            >
                              Metadata & localized versions (
                              {v.translations.length} languages)
                            </div>
                            <MetadataBlock
                              description={v.description}
                              tags={v.tags}
                            />
                            {v.translations.map((t) => {
                              const isChildToggling = togglingId === t.id;
                              const flag = LANGUAGE_FLAGS[t.language] ?? "🌐";
                              const youtubeVideoUrl =
                                t.youtubeUploadUrl ??
                                t.uploader?.youtubeVideoUrl ??
                                null;

                              return (
                                <div
                                  key={t.id}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 10,
                                    padding: "6px 8px",
                                    borderRadius: 6,
                                    background: "var(--v2-surface-2)",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                      flex: 1,
                                      minWidth: 0,
                                    }}
                                  >
                                    <span style={{ fontSize: 16 }}>{flag}</span>
                                    <ThumbnailPreview
                                      jobId={t.id}
                                      thumbnailId={t.thumbnailId}
                                      kind={t.thumbnailKind}
                                      approved={t.thumbnailApproved}
                                    />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div
                                        style={{
                                          fontSize: 12,
                                          fontWeight: 600,
                                          color: "var(--v2-text-1)",
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        {t.title}
                                      </div>
                                      <div
                                        style={{
                                          fontSize: 10,
                                          color: "var(--v2-text-2)",
                                        }}
                                      >
                                        {t.language} · Drive: {t.driveState} (
                                        {t.driveArtifactCount} files) ·{" "}
                                        {uploadStateLabel(t)}
                                      </div>
                                      <MetadataBlock
                                        description={t.description}
                                        tags={t.tags}
                                      />
                                    </div>
                                  </div>

                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                    }}
                                  >
                                    <VideoPlatformLinks
                                      url={youtubeVideoUrl}
                                      compact
                                    />
                                    <UploaderDispatchControl
                                      dispatch={t.uploader}
                                      authorized={canDispatch && deliveryMode !== "manual"}
                                      disabled={
                                        !dispatchDeclarationsComplete ||
                                        t.dispatchBlockers.length > 0
                                      }
                                      disabledReason={t.dispatchBlockers[0]}
                                      busy={dispatchingId === t.id}
                                      onDispatch={() =>
                                        void handleDispatch(t.id)
                                      }
                                    />
                                    {/* Translation Drive Link */}
                                    {t.driveUrl ? (
                                      <a
                                        href={t.driveUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 4,
                                          padding: "3px 8px",
                                          borderRadius: 5,
                                          fontSize: 11,
                                          fontWeight: 600,
                                          background: "rgba(66,133,244,0.15)",
                                          border:
                                            "1px solid rgba(66,133,244,0.35)",
                                          color: "var(--v2-text-1)",
                                          textDecoration: "none",
                                        }}
                                      >
                                        <span
                                          className="material-symbols-outlined"
                                          style={{ fontSize: 14 }}
                                        >
                                          cloud
                                        </span>
                                        Drive
                                      </a>
                                    ) : (
                                      <span
                                        style={{
                                          fontSize: 10,
                                          color: "var(--v2-text-3)",
                                        }}
                                      >
                                        Local
                                      </span>
                                    )}

                                    {t.finalReviewRecorded ? <DeliveryDownloads jobId={t.id} /> : <span style={{ fontSize: 11, color: "var(--v2-text-2)" }}>Final review required</span>}

                                    {/* Legacy manual status is not another queue state. */}
                                    {deliveryMode === "manual" && !t.uploader && t.finalReviewRecorded && (
                                      <button
                                        type="button"
                                        disabled={isChildToggling || t.isUploaded}
                                        onClick={() =>
                                          handleToggleUploaded(
                                            t.id,
                                            t.isUploaded,
                                            true,
                                            v.id,
                                          )
                                        }
                                        style={{
                                          padding: "3px 8px",
                                          borderRadius: 5,
                                          fontSize: 11,
                                          fontWeight: 700,
                                          cursor: "pointer",
                                          border: "1px solid",
                                          background: t.isUploaded
                                            ? "rgba(34,197,94,0.15)"
                                            : "rgba(234,179,8,0.15)",
                                          borderColor: t.isUploaded
                                            ? "rgba(34,197,94,0.4)"
                                            : "rgba(234,179,8,0.4)",
                                          color: "var(--v2-text-1)",
                                        }}
                                      >
                                        {t.isUploaded
                                          ? "Upload reported"
                                          : "Report manual upload"}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </td>

                      {/* Creator VA */}
                      <td
                        style={{ verticalAlign: "top", padding: "14px 14px" }}
                      >
                        <div
                          style={{
                            fontWeight: 600,
                            color: "var(--v2-text-1)",
                            fontSize: 12,
                          }}
                        >
                          {v.creatorName}
                        </div>
                        {v.creatorEmail && (
                          <div
                            style={{ fontSize: 10, color: "var(--v2-text-2)" }}
                          >
                            {v.creatorEmail.split("@")[0]}
                          </div>
                        )}
                      </td>

                      {/* Drive Link */}
                      <td
                        style={{ verticalAlign: "top", padding: "14px 14px" }}
                      >
                        {v.driveState === "uploaded" && v.driveUrl ? (
                          <a
                            href={v.driveUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              padding: "5px 10px",
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 700,
                              background: "rgba(66,133,244,0.15)",
                              border: "1px solid rgba(66,133,244,0.35)",
                              color: "var(--v2-text-1)",
                              textDecoration: "none",
                            }}
                          >
                            <span
                              className="material-symbols-outlined"
                              style={{ fontSize: 15 }}
                            >
                              cloud
                            </span>
                            In Drive · {v.driveArtifactCount} files
                          </a>
                        ) : (
                          <span
                            title={v.driveError ?? undefined}
                            style={{
                              fontSize: 11,
                              color:
                                v.driveState === "held" ||
                                v.driveState === "failed"
                                  ? "var(--v2-error)"
                                  : "var(--v2-text-2)",
                            }}
                          >
                            {v.driveState === "held"
                              ? "Held by QA"
                              : v.driveState === "failed"
                                ? "Drive failed"
                                : v.driveState === "uploading"
                                  ? "Uploading to Drive…"
                                  : "Pending Drive"}
                          </span>
                        )}
                      </td>

                      {/* Direct Download Button */}
                      <td
                        style={{ verticalAlign: "top", padding: "14px 14px" }}
                      >
                        {v.finalReviewRecorded ? <DeliveryDownloads jobId={v.id} /> : <span style={{ fontSize: 11, color: "var(--v2-text-2)" }}>Final review required</span>}
                      </td>

                      {/* Upload Status & Action */}
                      <td
                        style={{
                          verticalAlign: "top",
                          padding: "14px 14px",
                          textAlign: "right",
                        }}
                      >
                        <div
                          style={{
                            marginBottom: 7,
                            fontSize: 10,
                            color:
                              v.uploaderStatus === "failed"
                                ? "#f87171"
                                : "var(--v2-text-2)",
                          }}
                        >
                          {uploadStateLabel(v)}
                        </div>
                        {youtubeVideoUrl && (
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "flex-end",
                              marginBottom: 7,
                            }}
                          >
                            <VideoPlatformLinks url={youtubeVideoUrl} compact />
                          </div>
                        )}
                        <div
                          style={{
                            display: "inline-flex",
                            flexDirection: "column",
                            alignItems: "flex-end",
                            gap: 7,
                          }}
                        >
                          <UploaderDispatchControl
                            dispatch={v.uploader}
                            authorized={canDispatch && deliveryMode !== "manual"}
                            disabled={
                              !dispatchDeclarationsComplete ||
                              v.dispatchBlockers.length > 0
                            }
                            disabledReason={v.dispatchBlockers[0]}
                            busy={dispatchingId === v.id}
                            onDispatch={() => void handleDispatch(v.id)}
                          />
                          {deliveryMode === "manual" && !v.uploader && v.finalReviewRecorded && (
                            <button
                              type="button"
                              disabled={isToggling || v.isUploaded}
                              onClick={() =>
                                handleToggleUploaded(v.id, v.isUploaded)
                              }
                              style={{
                                padding: "6px 12px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: "pointer",
                                border: "1px solid",
                                background: v.isUploaded
                                  ? "rgba(34,197,94,0.2)"
                                  : "linear-gradient(135deg, #aaff00, #7acc00)",
                                borderColor: v.isUploaded
                                  ? "rgba(34,197,94,0.45)"
                                  : "transparent",
                                color: v.isUploaded ? "var(--v2-text-1)" : "#000",
                                boxShadow: v.isUploaded
                                  ? "none"
                                  : "0 2px 10px rgba(170,255,0,0.2)",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                              }}
                            >
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: 15 }}
                              >
                                {v.isUploaded ? "check_circle" : "publish"}
                              </span>
                              {v.isUploaded ? "Upload reported" : "Report manual upload"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  );
}
