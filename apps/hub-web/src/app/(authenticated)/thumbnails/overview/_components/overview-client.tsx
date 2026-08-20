"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { V2Listbox } from "@/components/thumbnails/v2-listbox";

/**
 * Cross-assistant thumbnail overview.
 *
 * Two questions, answered in this order because that is the order the owner
 * asked them in:
 *
 *   1. "am I seeing only my thumbnails or the VAs' too?" — stated in words at
 *      the top, not implied. Every surface in this app that lists thumbnails is
 *      unscoped; the reason that was unclear is that nothing ever said so.
 *   2. "an overview for the thumbnails that the virtual assistants generated" —
 *      the per-producer roll-up plus the grid below it.
 *
 * The grid is videos, not thumbnails, so a video with NO thumbnail is a visible
 * red tile rather than an absence. That absence is the bug the owner spotted.
 */

const TEXT_1 = "#e5e2e1";
const TEXT_2 = "#cdc3d7";
const TEXT_3 = "rgba(205,195,215,0.62)";

type ThumbnailState = "selected" | "generated" | "failed" | "missing";

interface OverviewItem {
  kind: "content_job" | "tutorial_job";
  id: string;
  title: string;
  status: string;
  channelName: string | null;
  producerId: string | null;
  producerName: string | null;
  producerRole: string | null;
  createdAt: string;
  lastThumbnailAt: string | null;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  state: ThumbnailState;
  previewThumbnailId: string | null;
  lastError: string | null;
  hasHostReference: boolean;
}

interface ProducerSummary {
  id: string;
  name: string;
  role: string;
  videos: number;
  selected: number;
  generated: number;
  failed: number;
  missing: number;
}

interface ChannelBranding {
  channelId: string;
  channelName: string;
  hostCharacterName: string | null;
  hostImageCount: number;
  contractApplies: boolean;
  ready: boolean;
}

interface OverviewResponse {
  scope: string;
  days: number;
  branding: ChannelBranding[];
  summary: {
    videos: number;
    selected: number;
    generated: number;
    failed: number;
    missing: number;
  };
  producers: ProducerSummary[];
  items: OverviewItem[];
}

const STATE_TONE: Record<
  ThumbnailState,
  { bg: string; fg: string; label: string }
> = {
  selected: { bg: "rgba(46,160,67,0.18)", fg: "#7ee787", label: "selected" },
  generated: {
    bg: "rgba(210,153,34,0.18)",
    fg: "#e3b341",
    label: "none selected",
  },
  failed: { bg: "rgba(248,81,73,0.18)", fg: "#ff7b72", label: "failed" },
  missing: { bg: "rgba(248,81,73,0.22)", fg: "#ff7b72", label: "no thumbnail" },
};

function Badge({
  children,
  bg,
  fg,
}: {
  children: React.ReactNode;
  bg: string;
  fg: string;
}) {
  return (
    <span
      style={{
        background: bg,
        color: fg,
        borderRadius: 9999,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        padding: "2px 7px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: string;
}) {
  return (
    <div style={{ minWidth: 74 }}>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: tone ?? TEXT_1,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          color: TEXT_3,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${Math.max(mins, 0)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function ThumbnailOverviewClient() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState("30");
  const [producer, setProducer] = useState("all");
  const [state, setState] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ days, producer, state });
      const res = await fetch(`/api/thumbnails/overview?${qs.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      setData((await res.json()) as OverviewResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [days, producer, state]);

  useEffect(() => {
    void load();
  }, [load]);

  const producerOptions = [
    { value: "all", label: "All producers" },
    ...(data?.producers ?? []).map((p) => ({
      value: p.id,
      label: p.name,
      hint: `${p.role} · ${p.videos} videos`,
    })),
  ];

  return (
    <div style={{ maxWidth: 1440, margin: "0 auto", padding: "20px 0 48px" }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <a
          href="/thumbnails"
          style={{
            fontSize: 11,
            color: TEXT_3,
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            marginBottom: 8,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            arrow_back
          </span>
          Thumbnail Studio
        </a>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: TEXT_1,
            margin: 0,
            marginBottom: 5,
          }}
        >
          Thumbnail Overview
        </h1>
        {/* The literal answer to "am I seeing only mine?". */}
        <p style={{ fontSize: 12.5, color: TEXT_2, margin: 0 }}>
          Every finished video from <strong>every producer</strong> — yours and
          the assistants&rsquo;. Thumbnail search elsewhere in the app has never
          been filtered by who made the video; this page states it and shows the
          attribution.
        </p>
      </div>

      {/* Filters */}
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: TEXT_3,
            }}
          >
            Window
          </span>
          <V2Listbox
            value={days}
            onChange={setDays}
            options={[
              { value: "7", label: "Last 7 days" },
              { value: "30", label: "Last 30 days" },
              { value: "90", label: "Last 90 days" },
              { value: "365", label: "Last year" },
            ]}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: TEXT_3,
            }}
          >
            Producer
          </span>
          <V2Listbox
            value={producer}
            onChange={setProducer}
            searchable
            options={producerOptions}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: TEXT_3,
            }}
          >
            Thumbnail state
          </span>
          <V2Listbox
            value={state}
            onChange={setState}
            options={[
              { value: "all", label: "All" },
              { value: "missing", label: "No thumbnail at all" },
              { value: "failed", label: "Generation failed" },
              { value: "generated", label: "Generated, none selected" },
              { value: "unselected", label: "Anything not selected" },
              { value: "selected", label: "Selected" },
            ]}
          />
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: "#ff7b72", marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Totals */}
      {data && (
        <div
          style={{
            display: "flex",
            gap: 22,
            flexWrap: "wrap",
            padding: "14px 16px",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.14)",
            borderRadius: 10,
            marginBottom: 16,
          }}
        >
          <Stat value={data.summary.videos} label="Videos" />
          <Stat value={data.summary.selected} label="Selected" tone="#7ee787" />
          <Stat
            value={data.summary.generated}
            label="Unselected"
            tone="#e3b341"
          />
          <Stat value={data.summary.failed} label="Failed" tone="#ff7b72" />
          <Stat value={data.summary.missing} label="Missing" tone="#ff7b72" />
        </div>
      )}

      {/* Branding readiness. Sits ABOVE the per-producer numbers because a
          channel with no host character cannot produce a thumbnail at all now —
          it is refused — so this is the first thing that explains a column of
          failures, and it is where the channel-to-character assignment is
          visible. */}
      {data && data.branding.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              color: TEXT_3,
              marginBottom: 8,
            }}
          >
            Channel branding — which character each channel puts on its
            thumbnails
          </div>
          <div
            style={{
              display: "grid",
              gap: 8,
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            }}
          >
            {data.branding
              .filter((b) => b.contractApplies || b.ready)
              .map((b) => (
                <div
                  key={b.channelId}
                  style={{
                    border: `1px solid ${
                      b.contractApplies && !b.ready
                        ? "rgba(248,81,73,0.45)"
                        : "rgba(var(--v2-accent-rgb),0.14)"
                    }`,
                    borderRadius: 9,
                    padding: "10px 12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <span
                    style={{ fontSize: 12, fontWeight: 600, color: TEXT_1 }}
                  >
                    {b.channelName}
                  </span>
                  <span style={{ fontSize: 11, color: TEXT_2 }}>
                    {b.hostCharacterName ?? "no host character bound"}
                    {b.hostCharacterName
                      ? ` · ${b.hostImageCount} image${
                          b.hostImageCount === 1 ? "" : "s"
                        }`
                      : ""}
                  </span>
                  {b.hostCharacterName && b.hostImageCount === 1 && (
                    <span style={{ fontSize: 10, color: "#e3b341" }}>
                      Only one image — every thumbnail shows the same pose. Add
                      more in the Character Library to get variation.
                    </span>
                  )}
                  {b.contractApplies && !b.ready && (
                    <span style={{ fontSize: 10, color: "#ff7b72" }}>
                      Tutorial thumbnails for this channel are REFUSED until a
                      host character with an image is bound.
                    </span>
                  )}
                  <Link
                    href="/characters"
                    style={{
                      fontSize: 10,
                      color: "var(--v2-accent)",
                      textDecoration: "none",
                    }}
                  >
                    Change assignment →
                  </Link>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Per-producer roll-up */}
      {data && data.producers.length > 0 && (
        <div style={{ marginBottom: 18, overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              minWidth: 620,
              borderCollapse: "collapse",
              fontSize: 12,
              color: TEXT_2,
            }}
          >
            <thead>
              <tr>
                {[
                  "Producer",
                  "Role",
                  "Videos",
                  "Selected",
                  "Unselected",
                  "Failed",
                  "Missing",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign:
                        h === "Producer" || h === "Role" ? "left" : "right",
                      padding: "7px 10px",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.07em",
                      textTransform: "uppercase",
                      color: TEXT_3,
                      borderBottom: "1px solid rgba(var(--v2-accent-rgb),0.14)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.producers.map((p) => (
                <tr key={p.id}>
                  <td style={{ padding: "7px 10px", color: TEXT_1 }}>
                    {p.name}
                  </td>
                  <td style={{ padding: "7px 10px" }}>{p.role}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>
                    {p.videos}
                  </td>
                  <td
                    style={{
                      padding: "7px 10px",
                      textAlign: "right",
                      color: "#7ee787",
                    }}
                  >
                    {p.selected}
                  </td>
                  <td
                    style={{
                      padding: "7px 10px",
                      textAlign: "right",
                      color: "#e3b341",
                    }}
                  >
                    {p.generated}
                  </td>
                  <td
                    style={{
                      padding: "7px 10px",
                      textAlign: "right",
                      color: "#ff7b72",
                    }}
                  >
                    {p.failed}
                  </td>
                  <td
                    style={{
                      padding: "7px 10px",
                      textAlign: "right",
                      color: "#ff7b72",
                    }}
                  >
                    {p.missing}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* The grid */}
      {loading && !data && (
        <div style={{ fontSize: 12, color: TEXT_2 }}>Loading…</div>
      )}
      {data && data.items.length === 0 && (
        <div style={{ fontSize: 12, color: TEXT_2 }}>
          No videos match those filters in the last {data.days} days.
        </div>
      )}
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fill, minmax(228px, 1fr))",
        }}
      >
        {(data?.items ?? []).map((item) => {
          const tone = STATE_TONE[item.state];
          return (
            <div
              key={`${item.kind}:${item.id}`}
              style={{
                border: "1px solid rgba(var(--v2-accent-rgb),0.14)",
                borderRadius: 10,
                overflow: "hidden",
                background: "rgba(255,255,255,0.02)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  aspectRatio: "16 / 9",
                  background: "rgba(0,0,0,0.35)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                }}
              >
                {item.previewThumbnailId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/thumbnails/image/${item.previewThumbnailId}`}
                    alt=""
                    loading="lazy"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <span
                    style={{
                      fontSize: 11,
                      color: "#ff7b72",
                      padding: 10,
                      textAlign: "center",
                    }}
                  >
                    {item.state === "failed"
                      ? "generation failed"
                      : "no thumbnail"}
                  </span>
                )}
                <span style={{ position: "absolute", left: 6, top: 6 }}>
                  <Badge bg={tone.bg} fg={tone.fg}>
                    {tone.label}
                  </Badge>
                </span>
              </div>
              <div
                style={{
                  padding: "9px 10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 5,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: TEXT_1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={item.title}
                >
                  {item.title}
                </span>
                <span style={{ fontSize: 10, color: TEXT_3 }}>
                  {item.producerName ?? "unattributed"}
                  {item.producerRole ? ` · ${item.producerRole}` : ""}
                </span>
                <span style={{ fontSize: 10, color: TEXT_3 }}>
                  {item.channelName ?? "no channel"} ·{" "}
                  {relative(item.createdAt)}
                </span>
                <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {item.completedCount > 0 && (
                    <Badge bg="rgba(255,255,255,0.07)" fg={TEXT_2}>
                      {item.completedCount} ready
                    </Badge>
                  )}
                  {item.failedCount > 0 && (
                    <Badge bg="rgba(248,81,73,0.18)" fg="#ff7b72">
                      {item.failedCount} failed
                    </Badge>
                  )}
                  {/* Whether the channel's host actually made it onto the
                      picture — the whole point of the character library. */}
                  {item.previewThumbnailId && (
                    <Badge
                      bg={
                        item.hasHostReference
                          ? "rgba(46,160,67,0.18)"
                          : "rgba(210,153,34,0.18)"
                      }
                      fg={item.hasHostReference ? "#7ee787" : "#e3b341"}
                    >
                      {item.hasHostReference ? "host ref" : "no host ref"}
                    </Badge>
                  )}
                </span>
                {item.lastError && (
                  <span
                    style={{
                      fontSize: 10,
                      color: "#ff7b72",
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                    title={item.lastError}
                  >
                    {item.lastError}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
