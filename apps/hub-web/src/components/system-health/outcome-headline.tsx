import { GlassCard } from "@/app/(authenticated)/_components/glass-card";
import type { OutcomeSignal } from "@/app/(authenticated)/system-health/_lib/production-outcomes";

/**
 * Outcomes, above provider status, on purpose.
 *
 * A provider can answer every health check while every real generation
 * fails — that is exactly what happened when all 57 thumbnails failed for
 * weeks behind a wall of green dots. So the first thing this page says is
 * "did the work come out", and only then "are the services reachable".
 */
export function OutcomeHeadline({ signals }: { signals: OutcomeSignal[] }) {
  const alarms = signals.filter((s) => s.available && s.sustainedFailure);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {alarms.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "14px 18px",
            background: "rgba(255,180,171,0.09)",
            border: "1px solid rgba(255,180,171,0.4)",
            borderRadius: 12,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 24, color: "#ffb4ab", flexShrink: 0 }}
          >
            error
          </span>
          <div>
            <p
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: "#ffb4ab",
                margin: 0,
              }}
            >
              Total failure detected
            </p>
            <p
              style={{
                fontSize: 11,
                color: "#cdc3d7",
                margin: "4px 0 0 0",
                lineHeight: 1.6,
              }}
            >
              {alarms
                .map(
                  (a) =>
                    `${a.label}: 0 of ${a.succeeded + a.failed} attempts succeeded`,
                )
                .join(" · ")}
              . Provider health checks can be green through this — reachability
              is not the same as output.
            </p>
          </div>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 14,
        }}
      >
        {signals.map((s) => {
          const rate = s.successRate;
          const color =
            !s.available || rate === null
              ? "#9aa0a6"
              : rate === 0
                ? "#ffb4ab"
                : rate < 0.8
                  ? "#f5c26b"
                  : "#23decb";
          return (
            <GlassCard
              key={s.key}
              style={{
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                border:
                  s.available && s.sustainedFailure
                    ? "1px solid rgba(255,180,171,0.35)"
                    : undefined,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#cdc3d7",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                {s.label}
              </span>

              {!s.available ? (
                <span
                  style={{
                    fontSize: 11,
                    color: "rgba(205,195,215,0.5)",
                    lineHeight: 1.5,
                  }}
                >
                  {s.detail}
                </span>
              ) : (
                <>
                  <div
                    style={{ display: "flex", alignItems: "baseline", gap: 8 }}
                  >
                    <span style={{ fontSize: 28, fontWeight: 900, color }}>
                      {rate === null ? "—" : `${Math.round(rate * 100)}%`}
                    </span>
                    <span
                      style={{ fontSize: 10, color: "rgba(205,195,215,0.5)" }}
                    >
                      {rate === null
                        ? "nothing attempted yet"
                        : `${s.succeeded}/${s.succeeded + s.failed} succeeded`}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 4,
                      background: "#0e0e0e",
                      borderRadius: 9999,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${rate === null ? 0 : Math.max(2, rate * 100)}%`,
                        background: color,
                        borderRadius: 9999,
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 9, color: "rgba(205,195,215,0.4)" }}>
                    {s.total} total
                    {s.pending > 0 ? ` · ${s.pending} still pending` : ""}
                    {s.detail ? ` · ${s.detail}` : ""}
                  </span>
                </>
              )}
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}
