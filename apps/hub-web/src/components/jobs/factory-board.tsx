"use client";

/**
 * Dark Factory board — a kanban over REAL content jobs.
 *
 * The previous board was fed by the Hermes Control Plane daemon, whose job ids
 * are not content-job ids, so a card could never open anything. Every card here
 * is a real `content_jobs` row: clicking it opens the job, and the inline
 * actions call the existing validated endpoints (retry re-dispatches through the
 * retry strategy; the stage action deep-links to the human step that is actually
 * blocking it).
 *
 * State is never written directly from a card — transitions belong to the
 * domain layer, so only the actions that are legal from the job's current state
 * are offered.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  isRetryable,
  isStuck,
  shortDuration,
  stageFor,
  type StageGroup,
} from "@/app/(authenticated)/dashboard/_lib/job-stage";

export interface FactoryCard {
  id: string;
  title: string;
  status: string;
  format: string;
  channelName: string | null;
  statusUpdatedAt: string;
  errorMessage: string | null;
  hasVideo: boolean;
  thumbnailId: string | null;
}

const TEXT_1 = "#e5e2e1";
const TEXT_2 = "#cdc3d7";
const TEXT_3 = "rgba(205,195,215,0.45)";

/** Lanes, in pipeline order. */
const LANES: Array<{
  group: StageGroup;
  label: string;
  color: string;
  blurb: string;
}> = [
  {
    group: "queued",
    label: "Queued",
    color: "#9991a4",
    blurb: "Accepted, not started",
  },
  {
    group: "working",
    label: "Working",
    color: "var(--v2-accent)",
    blurb: "Automation is running",
  },
  {
    group: "needs-human",
    label: "Needs you",
    color: "#f97316",
    blurb: "Blocked on a person",
  },
  {
    group: "publishing",
    label: "Publishing",
    color: "#80ccff",
    blurb: "Rendered, heading to YouTube",
  },
  {
    group: "failed",
    label: "Failed",
    color: "#ffb4ab",
    blurb: "Needs a retry or a fix",
  },
  {
    group: "done",
    label: "Done",
    color: "#23decb",
    blurb: "Finished",
  },
];

function Icon({
  name,
  size = 14,
  color,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  return (
    <span
      className="material-symbols-outlined"
      style={{ fontSize: size, color, lineHeight: 1, flexShrink: 0 }}
    >
      {name}
    </span>
  );
}

function CardActions({ card }: { card: FactoryCard }) {
  const router = useRouter();
  const stage = stageFor(card.status);
  const [busy, setBusy] = useState<null | "retry" | "cancel">(null);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    async (kind: "retry" | "cancel") => {
      setBusy(kind);
      setError(null);
      try {
        const res = await fetch(`/api/jobs/${card.id}/${kind}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          ...(kind === "cancel"
            ? {
                body: JSON.stringify({ reason: "Cancelled from Dark Factory" }),
              }
            : {}),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setError(body.error ?? `Failed (${res.status})`);
          setBusy(null);
          return;
        }
        router.refresh();
        setBusy(null);
      } catch {
        setError("Network error");
        setBusy(null);
      }
    },
    [card.id, router],
  );

  const btn = (color: string): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    padding: "3px 7px",
    borderRadius: 4,
    fontSize: 9,
    fontWeight: 700,
    cursor: busy ? "wait" : "pointer",
    color,
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${color}33`,
    textDecoration: "none",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {isRetryable(card.status) && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void call("retry");
            }}
            disabled={busy !== null}
            style={btn("#ffb4ab")}
          >
            <Icon name="restart_alt" size={11} color="#ffb4ab" />
            {busy === "retry" ? "…" : "Retry"}
          </button>
        )}
        {stage.actionLabel && stage.actionPath && (
          <Link
            href={`/jobs/${card.id}${stage.actionPath}`}
            onClick={(e) => e.stopPropagation()}
            style={btn("var(--v2-accent)")}
          >
            {stage.actionLabel}
          </Link>
        )}
        {stage.group !== "done" && stage.group !== "failed" && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void call("cancel");
            }}
            disabled={busy !== null}
            style={btn("#9991a4")}
            title="Cancel this job"
          >
            {busy === "cancel" ? "…" : "Cancel"}
          </button>
        )}
      </div>
      {error && (
        <span style={{ fontSize: 9, color: "#ffb4ab" }} title={error}>
          {error}
        </span>
      )}
    </div>
  );
}

function Card({ card }: { card: FactoryCard }) {
  const stage = stageFor(card.status);
  const waited = shortDuration(card.statusUpdatedAt);
  const stuck = isStuck(card.status, card.statusUpdatedAt);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 10,
        borderRadius: 9,
        background: "rgba(255,255,255,0.03)",
        border: stuck
          ? "1px solid rgba(249,115,22,0.35)"
          : "1px solid rgba(var(--v2-accent-rgb), 0.09)",
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        {card.thumbnailId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/thumbnails/image/${card.thumbnailId}`}
            alt=""
            loading="lazy"
            style={{
              width: 44,
              height: 25,
              objectFit: "cover",
              borderRadius: 3,
              flexShrink: 0,
              border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
            }}
          />
        ) : null}
        <Link
          href={`/jobs/${card.id}`}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontWeight: 600,
            color: TEXT_1,
            textDecoration: "none",
            lineHeight: 1.35,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
          title={card.title}
        >
          {card.title}
        </Link>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: stage.color,
            padding: "2px 6px",
            borderRadius: 3,
            background: "rgba(255,255,255,0.04)",
          }}
        >
          {stage.label}
        </span>
        {waited && (
          <span
            style={{
              fontSize: 9,
              color: stuck ? "#f97316" : TEXT_3,
              fontWeight: stuck ? 700 : 400,
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
            }}
            title={
              stuck
                ? "Sitting here far longer than this stage should take"
                : "Time in this stage"
            }
          >
            {stuck && <Icon name="warning" size={10} color="#f97316" />}
            {waited}
          </span>
        )}
        {card.hasVideo && (
          <span title="A rendered video exists on disk">
            <Icon name="movie" size={11} color="#23decb" />
          </span>
        )}
      </div>

      <span
        style={{
          fontSize: 9,
          color: TEXT_3,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {card.format.replace(/_/g, " ")}
        {card.channelName ? ` · ${card.channelName}` : ""}
      </span>

      {card.errorMessage && (
        <span
          style={{
            fontSize: 9,
            color: "#ffb4ab",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={card.errorMessage}
        >
          {card.errorMessage}
        </span>
      )}

      <CardActions card={card} />
    </div>
  );
}

export function FactoryBoard({ cards }: { cards: FactoryCard[] }) {
  const [format, setFormat] = useState<string>("");

  const formats = useMemo(
    () => [...new Set(cards.map((c) => c.format))].sort(),
    [cards],
  );

  const visible = useMemo(
    () => (format ? cards.filter((c) => c.format === format) : cards),
    [cards, format],
  );

  const lanes = useMemo(
    () =>
      LANES.map((lane) => ({
        ...lane,
        cards: visible
          .filter((c) => stageFor(c.status).group === lane.group)
          .sort(
            (a, b) =>
              new Date(a.statusUpdatedAt).getTime() -
              new Date(b.statusUpdatedAt).getTime(),
          ),
      })),
    [visible],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Format filter — real values derived from the jobs on the board */}
      {formats.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            { label: "All formats", value: "" },
            ...formats.map((f) => ({ label: f.replace(/_/g, " "), value: f })),
          ].map((f) => {
            const active = format === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFormat(f.value)}
                style={{
                  padding: "4px 12px",
                  borderRadius: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  cursor: "pointer",
                  background: active
                    ? "rgba(var(--v2-accent-rgb), 0.1)"
                    : "rgba(255,255,255,0.03)",
                  border: active
                    ? "1px solid rgba(var(--v2-accent-rgb), 0.3)"
                    : "1px solid rgba(var(--v2-accent-rgb), 0.1)",
                  color: active ? "var(--v2-accent)" : TEXT_3,
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${LANES.length}, minmax(210px, 1fr))`,
          gap: 12,
          overflowX: "auto",
          alignItems: "start",
          paddingBottom: 8,
        }}
      >
        {lanes.map((lane) => (
          <div
            key={lane.group}
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                paddingBottom: 8,
                borderBottom: `2px solid ${lane.color}55`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: lane.color,
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: TEXT_1,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  {lane.label}
                </span>
                <span
                  style={{ fontSize: 10, fontWeight: 700, color: lane.color }}
                >
                  {lane.cards.length}
                </span>
              </div>
              <span style={{ fontSize: 9, color: TEXT_3 }}>{lane.blurb}</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {lane.cards.length === 0 ? (
                <span
                  style={{
                    fontSize: 10,
                    color: TEXT_3,
                    padding: "10px 4px",
                  }}
                >
                  Empty
                </span>
              ) : (
                lane.cards.map((c) => <Card key={c.id} card={c} />)
              )}
            </div>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 10, color: TEXT_2, margin: 0 }}>
        Cards are real jobs — click one to open it. Lanes reflect the state
        machine, so a card cannot be dragged between them; the actions offered
        on each card are the ones that are legal from its current state.
      </p>
    </div>
  );
}
