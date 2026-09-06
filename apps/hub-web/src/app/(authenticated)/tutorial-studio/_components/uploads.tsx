"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { GlassCard, V2Button, V2Input } from "../../_components";

interface TranslationDeliveryItem {
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
}

interface VideoDeliveryRow {
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

function uploadStateLabel(item: {
  uploaderStatus: string | null;
  youtubeVisibility: string | null;
  scheduledFor: string | null;
  isUploaded: boolean;
}): string {
  if (item.uploaderStatus === "scheduled" && item.scheduledFor) {
    return `Scheduled ${new Date(item.scheduledFor).toLocaleString()}`;
  }
  if (item.uploaderStatus === "uploading") return "Uploading";
  if (item.uploaderStatus === "waiting_to_be_uploaded") return "Waiting for uploader";
  if (item.uploaderStatus === "failed") return "Uploader failed";
  if (item.uploaderStatus === "uploaded" || item.isUploaded) {
    return item.youtubeVisibility === "public" ? "Public · verified" : "Uploaded";
  }
  return "Not queued";
}

const UPLOADER_CHANNEL_BY_LANGUAGE: Record<string, string> = {
  en: "tutorial_usa",
  de: "tutorial_german",
  fr: "tutorial_french",
  it: "tutorial_italian",
  nl: "tutorial_dutch",
  sv: "tutorial_swedish",
};

function videoIdFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const id = url.hostname === "youtu.be"
      ? url.pathname.split("/").filter(Boolean)[0]
      : url.searchParams.get("v") ?? url.pathname.match(/\/shorts\/([^/?]+)/)?.[1];
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function ThumbnailPreview({ jobId, thumbnailId, kind, approved }: { jobId: string; thumbnailId: string | null; kind: string; approved: boolean }) {
  return (
    <a
      href={`/thumbnails?jobId=${jobId}`}
      title="Open this video in Thumbnail Studio"
      style={{ display: "block", width: 144, aspectRatio: "16 / 9", borderRadius: 7, overflow: "hidden", flexShrink: 0, position: "relative", background: "rgba(0,0,0,.4)", border: "1px solid rgba(255,255,255,.12)" }}
    >
      {thumbnailId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/thumbnails/image/${thumbnailId}`} alt="Thumbnail" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#fca5a5", fontSize: 10 }}>No thumbnail</span>
      )}
      <span style={{ position: "absolute", left: 5, bottom: 5, padding: "2px 5px", borderRadius: 4, background: "rgba(0,0,0,.78)", color: approved ? "#86efac" : "#fff", fontSize: 8, textTransform: "uppercase" }}>
        {kind}{approved ? " · approved" : ""}
      </span>
    </a>
  );
}

function MetadataBlock({ description, tags }: { description: string | null; tags: string[] | null }) {
  return (
    <div style={{ marginTop: 8, padding: 9, borderRadius: 7, background: "rgba(0,0,0,.24)", fontSize: 11, color: "var(--v2-text-2)", whiteSpace: "pre-wrap" }}>
      <strong style={{ color: "#fff" }}>Description</strong>
      <div style={{ marginTop: 4 }}>{description || "Not generated"}</div>
      <strong style={{ color: "#fff", display: "block", marginTop: 7 }}>Tags</strong>
      <div>{tags?.length ? tags.join(", ") : "Not generated"}</div>
    </div>
  );
}

export function UploadsTable() {
  const [videos, setVideos] = useState<VideoDeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "UPLOADED">("ALL");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [uploader, setUploader] = useState<UploaderStatus | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/production/uploads");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVideos(data.videos ?? []);
    } catch (e) {
      toast.error(`Failed to load uploads data: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUploader = useCallback(async () => {
    try {
      const res = await fetch("/api/production/uploader-status", { cache: "no-store" });
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
    void (async () => {
      // Receipt reconciliation runs in uploader-status; fetch the table after
      // it so newly proven uploads are visible immediately.
      await loadUploader();
      await loadData();
    })();
    const timer = setInterval(() => void loadUploader(), 15_000);
    return () => clearInterval(timer);
  }, [loadData, loadUploader]);

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
    const newStatus = !currentStatus;
    setTogglingId(jobId);

    // Optimistic UI update
    setVideos((prev) =>
      prev.map((v) => {
        if (!isChildTranslation && v.id === jobId) {
          return {
            ...v,
            isUploaded: newStatus,
            uploadedAt: newStatus ? new Date().toISOString() : null,
          };
        }
        if (isChildTranslation && v.id === parentId) {
          return {
            ...v,
            translations: v.translations.map((t) =>
              t.id === jobId
                ? {
                    ...t,
                    isUploaded: newStatus,
                    uploadedAt: newStatus ? new Date().toISOString() : null,
                  }
                : t,
            ),
          };
        }
        return v;
      }),
    );

    try {
      const res = await fetch("/api/production/uploads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, isUploaded: newStatus }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(
        newStatus
          ? "Marked as Uploaded to YouTube! 🎉"
          : "Reverted status to Ready to Upload.",
      );
    } catch (e) {
      toast.error(`Could not update upload status: ${e instanceof Error ? e.message : "error"}`);
      void loadData();
    } finally {
      setTogglingId(null);
    }
  };

  const filteredVideos = videos.filter((v) => {
    if (filter === "PENDING" && v.isUploaded) return false;
    if (filter === "UPLOADED" && !v.isUploaded) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchParent =
        v.title.toLowerCase().includes(q) ||
        (v.creatorName ?? "").toLowerCase().includes(q) ||
        (v.creatorEmail ?? "").toLowerCase().includes(q);
      const matchChild = v.translations.some((t) => t.title.toLowerCase().includes(q));
      if (!matchParent && !matchChild) return false;
    }
    return true;
  });

  const totalCount = videos.length;
  const totalUploaded = videos.filter((v) => v.isUploaded).length;
  const totalPending = totalCount - totalUploaded;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header & Metrics */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fff", margin: 0 }}>
            Delivery & Uploads Overview
          </h2>
          <div style={{ fontSize: 12, color: "var(--v2-text-2)", marginTop: 4 }}>
            Master table for manual uploaders. Download MP4s, view Google Drive folders, and mark published videos across all languages.
          </div>
        </div>

        {/* Counter Badges */}
        <div style={{ display: "flex", gap: 8 }}>
          <div
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              background: "rgba(234,179,8,0.12)",
              border: "1px solid rgba(234,179,8,0.3)",
              color: "#facc15",
              fontSize: 12,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              pending_actions
            </span>
            {totalPending} Ready to Upload
          </div>

          <div
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              background: "rgba(34,197,94,0.12)",
              border: "1px solid rgba(34,197,94,0.3)",
              color: "#4ade80",
              fontSize: 12,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              check_circle
            </span>
            {totalUploaded} Uploaded
          </div>

          <V2Button variant="outline" size="sm" onClick={() => void loadData()}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              refresh
            </span>
            Refresh
          </V2Button>
        </div>
      </div>

      {/* Exact channel identities and uploader connection. These links are
          deliberately derived from immutable UC ids, never from handles. */}
      <GlassCard style={{ padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>
              YouTube channel network
            </div>
            <div style={{ fontSize: 11, color: uploader?.connected ? "#4ade80" : "#facc15", marginTop: 3 }}>
              {uploader?.connected
                ? "Uploader connected · receipts sync automatically"
                : `Uploader disconnected${uploader?.error ? ` · ${uploader.error}` : ""}`}
            </div>
          </div>
          <a href={uploader?.operationsUrl ?? "/uploader-ops/"} target="_blank" rel="noreferrer" style={{ color: "var(--v2-accent)", fontSize: 11, fontWeight: 700 }}>
            Open uploader operations ↗
          </a>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginTop: 12 }}>
          {(uploader?.channels ?? []).map((channel) => {
            const latest = uploader?.jobs.find(
              (job) => job.channel === UPLOADER_CHANNEL_BY_LANGUAGE[channel.language],
            );
            return (
              <div key={channel.id} style={{ padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{channel.name}</span>
                  <span style={{ fontSize: 9, color: "var(--v2-text-2)", textTransform: "uppercase" }}>{channel.language}</span>
                </div>
                <div style={{ fontSize: 9, color: "var(--v2-text-3)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis" }}>{channel.youtubeChannelId}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 7, fontSize: 10 }}>
                  {channel.channelUrl && <a href={channel.channelUrl} target="_blank" rel="noreferrer" style={{ color: "#93c5fd" }}>Channel ↗</a>}
                  <a href={channel.studioUrl ?? "https://studio.youtube.com/"} target="_blank" rel="noreferrer" style={{ color: "#c4b5fd" }}>Studio ↗</a>
                  <span style={{ marginLeft: "auto", color: latest?.state === "succeeded" ? "#4ade80" : latest ? "#facc15" : "var(--v2-text-3)" }}>
                    {latest?.state ?? "not verified"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>

      {/* Filters & Search */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 240px", minWidth: 200 }}>
          <V2Input
            placeholder="Search by video title, keyword, or VA name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            fullWidth
          />
        </div>

        <div
          style={{
            display: "inline-flex",
            background: "rgba(255,255,255,0.06)",
            padding: 3,
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <button
            type="button"
            onClick={() => setFilter("ALL")}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              border: "none",
              background: filter === "ALL" ? "var(--v2-accent, #aaff00)" : "transparent",
              color: filter === "ALL" ? "#000" : "var(--v2-text-2)",
            }}
          >
            All Videos ({totalCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter("PENDING")}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              border: "none",
              background: filter === "PENDING" ? "#facc15" : "transparent",
              color: filter === "PENDING" ? "#000" : "var(--v2-text-2)",
            }}
          >
            Ready to Upload ({totalPending})
          </button>
          <button
            type="button"
            onClick={() => setFilter("UPLOADED")}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              border: "none",
              background: filter === "UPLOADED" ? "#4ade80" : "transparent",
              color: filter === "UPLOADED" ? "#000" : "var(--v2-text-2)",
            }}
          >
            Uploaded ({totalUploaded})
          </button>
        </div>
      </div>

      {/* Table Container */}
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
                  background: "rgba(255,255,255,0.04)",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                  color: "var(--v2-text-2)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                <th style={{ padding: "12px 14px", width: 36 }}></th>
                <th style={{ padding: "12px 14px" }}>Video Title & Keyword</th>
                <th style={{ padding: "12px 14px", width: 140 }}>Creator (VA)</th>
                <th style={{ padding: "12px 14px", width: 130 }}>Drive Link</th>
                <th style={{ padding: "12px 14px", width: 110 }}>Download</th>
                <th style={{ padding: "12px 14px", width: 180, textAlign: "right" }}>
                  Upload Status
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: 32, textAlign: "center", color: "var(--v2-text-2)" }}>
                    Loading delivery and upload records…
                  </td>
                </tr>
              ) : filteredVideos.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 32, textAlign: "center", color: "var(--v2-text-2)" }}>
                    No completed videos found matching your filter.
                  </td>
                </tr>
              ) : (
                filteredVideos.map((v) => {
                  const isExpanded = expandedIds.has(v.id);
                  const isToggling = togglingId === v.id;
                  const hasTranslations = v.translations.length > 0;

                  return (
                    <tr
                      key={v.id}
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                        background: v.isUploaded
                          ? "rgba(34,197,94,0.02)"
                          : "transparent",
                      }}
                    >
                      {/* Sub-table row wrapper using fragment */}
                      <td style={{ verticalAlign: "top", padding: "14px 10px 14px 14px" }}>
                        <button
                          type="button"
                          onClick={() => toggleExpand(v.id)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: hasTranslations ? "var(--v2-accent, #aaff00)" : "rgba(255,255,255,0.2)",
                            cursor: hasTranslations ? "pointer" : "default",
                            padding: 0,
                            display: "grid",
                            placeItems: "center",
                          }}
                          title={hasTranslations ? "Toggle translations" : "No translations available"}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                            {isExpanded ? "expand_less" : "expand_more"}
                          </span>
                        </button>
                      </td>

                      {/* Video Title & details */}
                      <td style={{ verticalAlign: "top", padding: "14px 14px" }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                          <ThumbnailPreview jobId={v.id} thumbnailId={v.thumbnailId} kind={v.thumbnailKind} approved={v.thumbnailApproved} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, color: "#fff", fontSize: 14 }}>{v.title}</div>
                            <a href={`/thumbnails?jobId=${v.id}`} style={{ color: "var(--v2-accent)", fontSize: 10 }}>Open in Thumbnail Studio ↗</a>
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
                          {v.durationS && <span>⏱️ {Math.round(v.durationS)}s</span>}
                          {v.channelName && <span>📺 {v.channelName}</span>}
                          {v.completedAt && (
                            <span>
                              📅 {new Date(v.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                          )}
                          {hasTranslations && (
                            <span
                              style={{
                                padding: "1px 6px",
                                borderRadius: 4,
                                background: "rgba(255,255,255,0.08)",
                                color: "#fff",
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
                              background: "rgba(0,0,0,0.3)",
                              border: "1px solid rgba(255,255,255,0.08)",
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
                              Metadata & localized versions ({v.translations.length} languages)
                            </div>
                            <MetadataBlock description={v.description} tags={v.tags} />
                            {v.translations.map((t) => {
                              const isChildToggling = togglingId === t.id;
                              const flag = LANGUAGE_FLAGS[t.language] ?? "🌐";
                              const videoId = videoIdFromUrl(t.youtubeUploadUrl);

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
                                    background: "rgba(255,255,255,0.03)",
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                                    <span style={{ fontSize: 16 }}>{flag}</span>
                                    <ThumbnailPreview jobId={t.id} thumbnailId={t.thumbnailId} kind={t.thumbnailKind} approved={t.thumbnailApproved} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div
                                        style={{
                                          fontSize: 12,
                                          fontWeight: 600,
                                          color: "#eceae6",
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        {t.title}
                                      </div>
                                      <div style={{ fontSize: 10, color: "var(--v2-text-2)" }}>
                                        {t.language} · Drive: {t.driveState} ({t.driveArtifactCount} files) · {uploadStateLabel(t)}
                                      </div>
                                      <MetadataBlock description={t.description} tags={t.tags} />
                                    </div>
                                  </div>

                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    {t.youtubeUploadUrl && (
                                      <a href={t.youtubeUploadUrl} target="_blank" rel="noreferrer" style={{ color: "#93c5fd", fontSize: 11 }}>
                                        YouTube ↗
                                      </a>
                                    )}
                                    {videoId && (
                                      <a href={`https://studio.youtube.com/video/${videoId}/edit`} target="_blank" rel="noreferrer" style={{ color: "#c4b5fd", fontSize: 11 }}>
                                        Studio ↗
                                      </a>
                                    )}
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
                                          border: "1px solid rgba(66,133,244,0.35)",
                                          color: "#93c5fd",
                                          textDecoration: "none",
                                        }}
                                      >
                                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                                          cloud
                                        </span>
                                        Drive
                                      </a>
                                    ) : (
                                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                                        Local
                                      </span>
                                    )}

                                    {/* Translation Download Button */}
                                    <a
                                      href={`/api/production/jobs/${t.id}/download`}
                                      download
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 4,
                                        padding: "3px 8px",
                                        borderRadius: 5,
                                        fontSize: 11,
                                        fontWeight: 600,
                                        background: "rgba(255,255,255,0.06)",
                                        border: "1px solid rgba(255,255,255,0.15)",
                                        color: "#fff",
                                        textDecoration: "none",
                                      }}
                                    >
                                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                                        download
                                      </span>
                                      MP4
                                    </a>

                                    {/* Translation Mark as Uploaded Toggle */}
                                    <button
                                      type="button"
                                      disabled={isChildToggling || t.isUploaded}
                                      onClick={() => handleToggleUploaded(t.id, t.isUploaded, true, v.id)}
                                      style={{
                                        padding: "3px 8px",
                                        borderRadius: 5,
                                        fontSize: 11,
                                        fontWeight: 700,
                                        cursor: "pointer",
                                        border: "1px solid",
                                        background: t.isUploaded ? "rgba(34,197,94,0.15)" : "rgba(234,179,8,0.15)",
                                        borderColor: t.isUploaded ? "rgba(34,197,94,0.4)" : "rgba(234,179,8,0.4)",
                                        color: t.isUploaded ? "#4ade80" : "#facc15",
                                      }}
                                    >
                                      {t.isUploaded ? "✓ Already uploaded" : "Mark Uploaded"}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </td>

                      {/* Creator VA */}
                      <td style={{ verticalAlign: "top", padding: "14px 14px" }}>
                        <div style={{ fontWeight: 600, color: "#eceae6", fontSize: 12 }}>
                          {v.creatorName}
                        </div>
                        {v.creatorEmail && (
                          <div style={{ fontSize: 10, color: "var(--v2-text-2)" }}>
                            {v.creatorEmail.split("@")[0]}
                          </div>
                        )}
                      </td>

                      {/* Drive Link */}
                      <td style={{ verticalAlign: "top", padding: "14px 14px" }}>
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
                              color: "#93c5fd",
                              textDecoration: "none",
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                              cloud
                            </span>
                            In Drive · {v.driveArtifactCount} files
                          </a>
                        ) : (
                          <span title={v.driveError ?? undefined} style={{ fontSize: 11, color: v.driveState === "held" || v.driveState === "failed" ? "#fca5a5" : "var(--v2-text-2)" }}>
                            {v.driveState === "held" ? "Held by QA" : v.driveState === "failed" ? "Drive failed" : v.driveState === "uploading" ? "Uploading to Drive…" : "Pending Drive"}
                          </span>
                        )}
                      </td>

                      {/* Direct Download Button */}
                      <td style={{ verticalAlign: "top", padding: "14px 14px" }}>
                        <a
                          href={`/api/production/jobs/${v.id}/download`}
                          download
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "5px 10px",
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            background: "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.15)",
                            color: "#fff",
                            textDecoration: "none",
                          }}
                          title="Download high-res rendered MP4 file"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                            download
                          </span>
                          MP4
                        </a>
                      </td>

                      {/* Upload Status & Action */}
                      <td style={{ verticalAlign: "top", padding: "14px 14px", textAlign: "right" }}>
                        <div style={{ marginBottom: 7, fontSize: 10, color: v.uploaderStatus === "failed" ? "#f87171" : "var(--v2-text-2)" }}>
                          {uploadStateLabel(v)}
                        </div>
                        {v.youtubeUploadUrl && (
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 7, fontSize: 10 }}>
                            <a href={v.youtubeUploadUrl} target="_blank" rel="noreferrer" style={{ color: "#93c5fd" }}>YouTube ↗</a>
                            {videoIdFromUrl(v.youtubeUploadUrl) && (
                              <a href={`https://studio.youtube.com/video/${videoIdFromUrl(v.youtubeUploadUrl)}/edit`} target="_blank" rel="noreferrer" style={{ color: "#c4b5fd" }}>Studio ↗</a>
                            )}
                          </div>
                        )}
                        <button
                          type="button"
                          disabled={isToggling || v.isUploaded}
                          onClick={() => handleToggleUploaded(v.id, v.isUploaded)}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 800,
                            cursor: "pointer",
                            border: "1px solid",
                            background: v.isUploaded ? "rgba(34,197,94,0.2)" : "linear-gradient(135deg, #aaff00, #7acc00)",
                            borderColor: v.isUploaded ? "rgba(34,197,94,0.45)" : "transparent",
                            color: v.isUploaded ? "#4ade80" : "#000",
                            boxShadow: v.isUploaded ? "none" : "0 2px 10px rgba(170,255,0,0.2)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                            {v.isUploaded ? "check_circle" : "publish"}
                          </span>
                          {v.isUploaded ? "Already uploaded" : "Mark as Uploaded"}
                        </button>
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
