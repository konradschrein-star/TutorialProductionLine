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
  driveFileId: string | null;
  driveUrl: string | null;
  completedAt: string | null;
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
  driveFileId: string | null;
  driveUrl: string | null;
  completedAt: string | null;
  createdAt: string;
  translations: TranslationDeliveryItem[];
}

const LANGUAGE_FLAGS: Record<string, string> = {
  German: "🇩🇪",
  French: "🇫🇷",
  Spanish: "🇪🇸",
  Japanese: "🇯🇵",
  Korean: "🇰🇷",
  English: "🇺🇸",
};

export function UploadsTable() {
  const [videos, setVideos] = useState<VideoDeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "UPLOADED">("ALL");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [togglingId, setTogglingId] = useState<string | null>(null);

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

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleUploaded = async (
    jobId: string,
    currentStatus: boolean,
    isChildTranslation = false,
    parentId?: string,
  ) => {
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
                        <div style={{ fontWeight: 700, color: "#fff", fontSize: 14 }}>
                          {v.title}
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
                        {isExpanded && hasTranslations && (
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
                              Localized Translations ({v.translations.length} languages):
                            </div>
                            {v.translations.map((t) => {
                              const isChildToggling = togglingId === t.id;
                              const flag = LANGUAGE_FLAGS[t.language] ?? "🌐";

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
                                        {t.language} · {t.isUploaded ? "Uploaded" : "Pending Upload"}
                                      </div>
                                    </div>
                                  </div>

                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
                                      disabled={isChildToggling}
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
                                      {t.isUploaded ? "✓ Uploaded" : "Mark Uploaded"}
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
                        {v.driveUrl ? (
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
                            Drive File
                          </a>
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
                            Local Only
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
                        <button
                          type="button"
                          disabled={isToggling}
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
                          {v.isUploaded ? "Uploaded" : "Mark as Uploaded"}
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
