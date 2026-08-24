"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Per-VA daily production timeline — Tutorial Studio Dashboard.
 *
 * Plots every VA action (Render = job created, Upload = recording uploaded,
 * Finish = spliced) as a dot on a 24h-per-day axis. The point is raw legibility:
 * the owner's eye reads the real working window, the length of the noon pause,
 * whether steps were used earlier than allowed, and — the main goal — how many
 * videos a VA actually produces per day. No "claimed hours" are invented; the
 * system stores none, so this shows only what actually happened.
 *
 * Times render in the VIEWER's local timezone (labelled), because the DB stores
 * timestamptz and the API returns UTC.
 */

interface TimelineJob {
  userId: string | null;
  va: string | null;
  jobId: string;
  title: string | null;
  status: string;
  createdAt: string;
  recordedAt: string | null;
  completedAt: string | null;
}
interface Payload {
  jobs: TimelineJob[];
  windowDays: number;
}

type EventType = "created" | "recorded" | "completed";
const EVENT: Record<EventType, { label: string; color: string }> = {
  created: { label: "Render", color: "var(--v2-accent)" },
  recorded: { label: "Upload", color: "#f0a642" },
  completed: { label: "Finish", color: "#7ecb6a" },
};
const EVENT_ORDER: EventType[] = ["created", "recorded", "completed"];
const WINDOWS = [7, 14, 28] as const;

interface Ev {
  type: EventType;
  hour: number; // local fractional hour 0..24
  title: string;
  time: string; // local HH:MM
}

const card: React.CSSProperties = {
  background: "var(--v2-surface-2)",
  border: "1px solid var(--v2-border-1)",
  borderRadius: 14,
  padding: 20,
};
const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--v2-text-2)",
};

const pad = (n: number) => String(n).padStart(2, "0");
const localHour = (d: Date) => d.getHours() + d.getMinutes() / 60;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtH = (h: number) => `${pad(Math.floor(h))}:${pad(Math.round((h % 1) * 60))}`;

function HourAxis() {
  return (
    <div style={{ position: "relative", height: 12, marginBottom: 2 }}>
      {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
        <span
          key={h}
          style={{
            position: "absolute",
            left: `${(h / 24) * 100}%`,
            transform: "translateX(-50%)",
            fontSize: 9,
            color: "var(--v2-text-3)",
          }}
        >
          {h}h
        </span>
      ))}
    </div>
  );
}

/** One horizontal 24h lane with event dots. */
function Lane({ events, height = 26 }: { events: Ev[]; height?: number }) {
  const hours = events.map((e) => e.hour);
  const lo = hours.length ? Math.min(...hours) : 0;
  const hi = hours.length ? Math.max(...hours) : 0;
  return (
    <div
      style={{
        position: "relative",
        height,
        background: "var(--v2-surface-3)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      {/* active-window band (first → last event) */}
      {events.length > 1 && (
        <div
          style={{
            position: "absolute",
            left: `${(lo / 24) * 100}%`,
            width: `${((hi - lo) / 24) * 100}%`,
            top: 0,
            bottom: 0,
            background: "var(--v2-text-3)",
            opacity: 0.08,
          }}
        />
      )}
      {[6, 12, 18].map((h) => (
        <div
          key={h}
          style={{
            position: "absolute",
            left: `${(h / 24) * 100}%`,
            top: 0,
            bottom: 0,
            width: 1,
            background: "var(--v2-border-0)",
          }}
        />
      ))}
      {events.map((e, j) => (
        <span
          key={j}
          title={`${EVENT[e.type].label} · ${e.time} · ${e.title}`}
          style={{
            position: "absolute",
            left: `${(e.hour / 24) * 100}%`,
            top: "50%",
            width: 7,
            height: 7,
            marginLeft: -3.5,
            marginTop: -3.5,
            borderRadius: "50%",
            background: EVENT[e.type].color,
            opacity: 0.85,
            cursor: "default",
          }}
        />
      ))}
    </div>
  );
}

export function VaDailyTimeline() {
  const [data, setData] = useState<Payload | null>(null);
  const [windowDays, setWindowDays] = useState<number>(14);
  const [overlay, setOverlay] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/production/tutorial-metrics/timeline?window=${windowDays}`)
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((d: Payload) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => alive && setError(String(e.message || e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [windowDays]);

  const tz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );

  // Group into VA → day → events. Each event sits on its OWN local day, so a job
  // rendered at 23:50 and uploaded after midnight shows on the two real days.
  const byVa = useMemo(() => {
    const vas = new Map<
      string,
      { total: number; days: Map<string, Ev[]> }
    >();
    for (const job of data?.jobs ?? []) {
      const vaName = job.va ?? "Unknown VA";
      let entry = vas.get(vaName);
      if (!entry) {
        entry = { total: 0, days: new Map() };
        vas.set(vaName, entry);
      }
      entry.total++; // one job = one produced video (created is always present)
      const push = (iso: string | null, type: EventType) => {
        if (!iso) return;
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return;
        const key = dayKey(d);
        const list = entry!.days.get(key) ?? [];
        list.push({
          type,
          hour: localHour(d),
          title: job.title ?? "(untitled)",
          time: localTime(d),
        });
        entry!.days.set(key, list);
      };
      push(job.createdAt, "created");
      push(job.recordedAt, "recorded");
      push(job.completedAt, "completed");
    }
    return Array.from(vas.entries()).sort((a, b) => b[1].total - a[1].total);
  }, [data]);

  const dayLabel = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 6,
        }}
      >
        <div style={sectionTitle}>VA Daily Production Timeline</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => setOverlay((v) => !v)}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 6,
              cursor: "pointer",
              background: overlay
                ? "rgba(var(--v2-accent-rgb), 0.15)"
                : "var(--v2-surface-3)",
              color: overlay ? "var(--v2-accent)" : "var(--v2-text-2)",
              border: overlay
                ? "1px solid var(--v2-accent)"
                : "1px solid var(--v2-border-1)",
            }}
          >
            {overlay ? "Overlay: on" : "Overlay days"}
          </button>
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWindowDays(w)}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "3px 10px",
                borderRadius: 6,
                cursor: "pointer",
                background:
                  windowDays === w
                    ? "rgba(var(--v2-accent-rgb), 0.15)"
                    : "var(--v2-surface-3)",
                color: windowDays === w ? "var(--v2-accent)" : "var(--v2-text-2)",
                border:
                  windowDays === w
                    ? "1px solid var(--v2-accent)"
                    : "1px solid var(--v2-border-1)",
              }}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {/* legend + tz */}
      <div
        style={{
          display: "flex",
          gap: 14,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        {EVENT_ORDER.map((t) => (
          <span
            key={t}
            style={{
              fontSize: 11,
              color: "var(--v2-text-2)",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: EVENT[t].color,
              }}
            />
            {EVENT[t].label}
          </span>
        ))}
        <span style={{ fontSize: 10, color: "var(--v2-text-3)", marginLeft: "auto" }}>
          times shown in {tz}
        </span>
      </div>

      {loading && (
        <div style={{ fontSize: 12, color: "var(--v2-text-3)" }}>Loading…</div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: "#f87171" }}>
          Could not load timeline — {error}
        </div>
      )}
      {!loading && !error && byVa.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--v2-text-3)" }}>
          No production activity in this window yet.
        </div>
      )}

      {!loading && !error && byVa.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {byVa.map(([va, entry]) => {
            const days = Array.from(entry.days.entries()).sort((a, b) =>
              a[0] < b[0] ? 1 : -1,
            ); // newest day first
            const activeDays = days.length;
            const best = days.reduce(
              (mx, [, evs]) =>
                Math.max(mx, evs.filter((e) => e.type === "created").length),
              0,
            );
            const avg = activeDays ? entry.total / activeDays : 0;
            const overlayEvents = overlay
              ? days.flatMap(([, evs]) => evs)
              : [];
            return (
              <div key={va}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    flexWrap: "wrap",
                    gap: 6,
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--v2-text-1)",
                    }}
                  >
                    {va}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--v2-text-3)" }}>
                    {entry.total} videos · {activeDays} active day
                    {activeDays === 1 ? "" : "s"} ·{" "}
                    <span style={{ color: "var(--v2-text-1)" }}>
                      avg {avg.toFixed(1)}/day
                    </span>{" "}
                    · best{" "}
                    <span style={{ color: "var(--v2-accent)", fontWeight: 700 }}>
                      {best}
                    </span>
                  </span>
                </div>
                <HourAxis />
                {overlay ? (
                  <Lane events={overlayEvents} height={34} />
                ) : (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    {days.map(([key, evs]) => {
                      const sorted = [...evs].sort((a, b) => a.hour - b.hour);
                      const lo = sorted[0]?.hour ?? 0;
                      const hi = sorted[sorted.length - 1]?.hour ?? 0;
                      const nCreated = evs.filter(
                        (e) => e.type === "created",
                      ).length;
                      return (
                        <div
                          key={key}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "128px 1fr",
                            gap: 10,
                            alignItems: "center",
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: "var(--v2-text-1)",
                              }}
                            >
                              {dayLabel(key)}
                            </div>
                            <div
                              style={{ fontSize: 10, color: "var(--v2-text-3)" }}
                            >
                              {nCreated} vid · {fmtH(lo)}–{fmtH(hi)}
                            </div>
                          </div>
                          <Lane events={evs} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
