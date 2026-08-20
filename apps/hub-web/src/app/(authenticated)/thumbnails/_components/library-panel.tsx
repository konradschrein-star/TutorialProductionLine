"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassCard } from "@/app/(authenticated)/_components";
import { V2Listbox } from "@/components/thumbnails/v2-listbox";
import {
  aspectPadding,
  thumbnailImageUrl,
  type ChannelOption,
  type Thumbnail,
  type ThumbnailArchetype,
} from "@/components/thumbnails/types";

/**
 * Library / history of every generated thumbnail.
 *
 * Failed generations are shown by default and are visually loud. The previous
 * system accumulated 57 consecutive failures with no UI surface at all, which
 * is exactly how eleven days of broken thumbnails went unnoticed.
 */

const TEXT_1 = "#e5e2e1";
const TEXT_2 = "#cdc3d7";

interface Props {
  channels: ChannelOption[];
  archetypes: ThumbnailArchetype[];
}

export function LibraryPanel({ channels, archetypes }: Props) {
  const [scope, setScope] = useState("all");
  const [status, setStatus] = useState("all");
  const [rows, setRows] = useState<Thumbnail[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const archetypeName = useMemo(
    () => new Map(archetypes.map((a) => [a.id, a.name])),
    [archetypes],
  );
  const channelName = useMemo(
    () => new Map(channels.map((c) => [c.id, c.name])),
    [channels],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/thumbnails/library?scope=${encodeURIComponent(scope)}&limit=120`,
      );
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      setRows(json.thumbnails ?? []);
      setTotal(json.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load library");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = rows.filter((r) => status === "all" || r.status === status);
  const failedCount = rows.filter((r) => r.status === "failed").length;

  async function remove(id: string) {
    const res = await fetch(`/api/thumbnails/item/${id}`, { method: "DELETE" });
    if (res.ok) setRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function togglePin(row: Thumbnail) {
    const res = await fetch(`/api/thumbnails/item/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !row.is_pinned }),
    });
    if (res.ok) {
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id ? { ...r, is_pinned: !row.is_pinned } : r,
        ),
      );
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <GlassCard
        style={{
          padding: 12,
          display: "grid",
          gridTemplateColumns:
            "minmax(150px,220px) minmax(150px,220px) 1fr auto",
          gap: 10,
          alignItems: "end",
        }}
      >
        <V2Listbox
          label="Channel"
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: "All" },
            { value: "global", label: "No channel (ad-hoc)" },
            ...channels.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <V2Listbox
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "All statuses" },
            { value: "completed", label: "Completed" },
            { value: "failed", label: "Failed" },
            { value: "generating", label: "Generating" },
          ]}
        />
        <div style={{ fontSize: 11.5, color: TEXT_2, paddingBottom: 9 }}>
          {loading ? "Loading…" : `${visible.length} shown · ${total} total`}
          {failedCount > 0 && (
            <span style={{ color: "#ff9c9c", marginLeft: 8, fontWeight: 700 }}>
              {failedCount} failed
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "9px 12px",
            borderRadius: 8,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: TEXT_2,
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            cursor: "pointer",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
            refresh
          </span>
          Refresh
        </button>
      </GlassCard>

      {error && (
        <GlassCard style={{ padding: 14, color: "#ff9c9c", fontSize: 12 }}>
          {error}
        </GlassCard>
      )}

      {!loading && visible.length === 0 && (
        <GlassCard style={{ padding: 32, textAlign: "center" }}>
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 32, color: "var(--v2-accent)" }}
          >
            photo_library
          </span>
          <p style={{ color: TEXT_2, fontSize: 13, margin: "10px 0 0" }}>
            No thumbnails yet.
          </p>
        </GlassCard>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(232px, 1fr))",
          gap: 12,
        }}
      >
        {visible.map((row) => (
          <GlassCard
            key={row.id}
            style={{
              overflow: "hidden",
              border:
                row.status === "failed"
                  ? "1px solid rgba(255,90,90,0.4)"
                  : "1px solid rgba(255,255,255,0.09)",
            }}
          >
            <div
              style={{
                position: "relative",
                width: "100%",
                paddingTop: aspectPadding(row.aspect_ratio),
                background: "rgba(255,255,255,0.04)",
              }}
            >
              {row.status === "completed" && row.output_path ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumbnailImageUrl(row.id)}
                  alt={row.title ?? "Thumbnail"}
                  loading="lazy"
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              ) : (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                    color: row.status === "failed" ? "#ff9c9c" : TEXT_2,
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 26 }}
                  >
                    {row.status === "failed" ? "error" : "hourglass_top"}
                  </span>
                  <span style={{ fontSize: 10.5, fontWeight: 800 }}>
                    {row.status.toUpperCase()}
                  </span>
                </div>
              )}
              {row.is_pinned && (
                <span
                  className="material-symbols-outlined"
                  title="Pinned to the reference library"
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    fontSize: 16,
                    color: "var(--v2-accent)",
                    background: "rgba(0,0,0,0.6)",
                    borderRadius: 4,
                    padding: 2,
                  }}
                >
                  push_pin
                </span>
              )}
            </div>

            <div
              style={{
                padding: 9,
                display: "flex",
                flexDirection: "column",
                gap: 5,
              }}
            >
              <span
                title={row.title ?? ""}
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: TEXT_1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {row.title || row.headline_text || "Untitled"}
              </span>

              {row.status === "failed" && row.error_message && (
                <span
                  style={{
                    fontSize: 10,
                    color: "#ff9c9c",
                    lineHeight: 1.4,
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    wordBreak: "break-word",
                  }}
                >
                  {row.error_message}
                </span>
              )}

              <span
                style={{
                  fontSize: 9.5,
                  color: TEXT_2,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {row.channel_id
                  ? (channelName.get(row.channel_id) ?? "Channel")
                  : "Ad-hoc"}
                {" · "}
                {row.archetype_id
                  ? (archetypeName.get(row.archetype_id) ?? "Archetype")
                  : "No archetype"}
              </span>

              <div style={{ display: "flex", gap: 5 }}>
                <IconAction
                  icon={row.is_pinned ? "push_pin" : "push_pin"}
                  title={row.is_pinned ? "Unpin" : "Pin as reference"}
                  active={row.is_pinned}
                  onClick={() => void togglePin(row)}
                />
                {row.status === "completed" && (
                  <a
                    href={thumbnailImageUrl(row.id)}
                    download
                    title="Download"
                    style={iconLinkStyle}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 15 }}
                    >
                      download
                    </span>
                  </a>
                )}
                <IconAction
                  icon="delete"
                  title="Delete"
                  danger
                  onClick={() => void remove(row.id)}
                />
              </div>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}

const iconLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: 6,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#cdc3d7",
  cursor: "pointer",
  textDecoration: "none",
};

function IconAction({
  icon,
  title,
  onClick,
  active,
  danger,
}: {
  icon: string;
  title: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        ...iconLinkStyle,
        background: active
          ? "rgba(var(--v2-accent-rgb), 0.16)"
          : danger
            ? "rgba(255,90,90,0.1)"
            : "rgba(255,255,255,0.05)",
        border: `1px solid ${
          active
            ? "rgba(var(--v2-accent-rgb), 0.42)"
            : danger
              ? "rgba(255,90,90,0.3)"
              : "rgba(255,255,255,0.12)"
        }`,
        color: active ? "var(--v2-accent)" : danger ? "#ff9c9c" : TEXT_2,
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
        {icon}
      </span>
    </button>
  );
}
