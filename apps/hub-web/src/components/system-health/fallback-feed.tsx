"use client";

import { GlassCard } from "@/app/(authenticated)/_components/glass-card";
import { formatTimestamp } from "./status-visuals";

export interface FallbackEvent {
  id: string;
  capability: string;
  consumer: string;
  requestedProvider: string | null;
  servedProvider: string;
  fallbackDepth: number;
  outcome: string;
  context: string | null;
  jobId: string | null;
  createdAt: string;
}

/**
 * THE most important panel on this page.
 *
 * The Nano-Banana-2 → Seedream 4.5 incident happened because a fallback was
 * invisible: quality collapsed, no error was raised, and nobody knew a
 * substitution had taken place. Every substitution now lands here, in plain
 * language, at the top of the page.
 *
 * An empty feed is stated as "no substitutions recorded", never as success —
 * and when nothing has been recorded at all we say the gateways have not
 * reported yet, rather than implying a clean run.
 */
export function FallbackFeed({
  events,
  anyUsageRecorded,
}: {
  events: FallbackEvent[];
  anyUsageRecorded: boolean;
}) {
  const hasEvents = events.length > 0;

  return (
    <GlassCard
      style={{
        overflow: "hidden",
        border: hasEvents
          ? "1px solid rgba(249,115,22,0.35)"
          : "1px solid rgba(var(--v2-accent-rgb), 0.1)",
        background: hasEvents ? "rgba(249,115,22,0.04)" : undefined,
      }}
    >
      <div
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
          background: hasEvents ? "rgba(249,115,22,0.07)" : "#131313",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 22,
              color: hasEvents ? "#f97316" : "rgba(205,195,215,0.4)",
            }}
          >
            {hasEvents ? "swap_horiz" : "check_circle"}
          </span>
          <div>
            <h3
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#e5e2e1",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                margin: 0,
              }}
            >
              Substitutions — what you asked for vs what you got
            </h3>
            <p
              style={{
                fontSize: 10,
                color: "rgba(205,195,215,0.5)",
                marginTop: 4,
                marginBottom: 0,
              }}
            >
              Every time a request was served by something other than the chain
              primary.
            </p>
          </div>
        </div>
        {hasEvents && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#f97316",
              padding: "4px 12px",
              background: "rgba(249,115,22,0.12)",
              border: "1px solid rgba(249,115,22,0.3)",
              borderRadius: 20,
              whiteSpace: "nowrap",
            }}
          >
            {events.length} recent
          </span>
        )}
      </div>

      {!hasEvents ? (
        <div
          style={{
            padding: "28px 24px",
            color: "rgba(205,195,215,0.55)",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {anyUsageRecorded ? (
            <>
              No substitutions recorded. Every request in the window was served
              by its chain primary.
            </>
          ) : (
            <>
              <strong style={{ color: "#e5e2e1" }}>
                No gateway calls recorded yet.
              </strong>{" "}
              This is an empty log, not a clean bill of health. The worker
              records here on every image, video and TTS call — the feed fills
              once production runs against an instrumented worker.
            </>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {events.map((e, i) => (
            <div
              key={e.id}
              style={{
                padding: "14px 24px",
                display: "flex",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
                borderBottom:
                  i < events.length - 1
                    ? "1px solid rgba(75,68,85,0.12)"
                    : "none",
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontFamily: "monospace",
                  color: "rgba(205,195,215,0.4)",
                  width: 140,
                  flexShrink: 0,
                }}
              >
                {formatTimestamp(e.createdAt)}
              </span>

              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: "var(--v2-accent)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  padding: "2px 8px",
                  background: "rgba(var(--v2-accent-rgb), 0.1)",
                  borderRadius: 4,
                  flexShrink: 0,
                }}
              >
                {e.capability}
              </span>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flex: 1,
                  minWidth: 240,
                }}
              >
                <span style={{ fontSize: 11, color: "rgba(205,195,215,0.6)" }}>
                  wanted
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#cdc3d7",
                    textDecoration: "line-through",
                  }}
                >
                  {e.requestedProvider ?? "(none eligible)"}
                </span>
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16, color: "#f97316" }}
                >
                  arrow_forward
                </span>
                <span style={{ fontSize: 11, color: "rgba(205,195,215,0.6)" }}>
                  got
                </span>
                <span
                  style={{ fontSize: 11, fontWeight: 800, color: "#f97316" }}
                >
                  {e.servedProvider}
                </span>
                {e.outcome === "error" && (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: "#ffb4ab",
                      padding: "1px 6px",
                      background: "rgba(255,180,171,0.1)",
                      borderRadius: 3,
                    }}
                  >
                    AND FAILED
                  </span>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: 2,
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 10, color: "#cdc3d7" }}>
                  {e.consumer}
                </span>
                {e.context && (
                  <span
                    style={{
                      fontSize: 9,
                      color: "rgba(205,195,215,0.4)",
                      fontFamily: "monospace",
                    }}
                  >
                    {e.context}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
