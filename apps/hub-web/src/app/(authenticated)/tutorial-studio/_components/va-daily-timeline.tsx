"use client";

import { useEffect, useMemo, useState } from "react";

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

interface KnownVA {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Payload {
  jobs: TimelineJob[];
  vas: KnownVA[];
  windowDays: number;
}

type EventType = "created" | "recorded" | "completed";
const EVENT: Record<EventType, { label: string; color: string; bg: string }> = {
  created: { label: "Render / Script", color: "var(--v2-accent, #4ade80)", bg: "rgba(74,222,128,0.15)" },
  recorded: { label: "Screen Recording", color: "#f0a642", bg: "rgba(240,166,66,0.15)" },
  completed: { label: "Stitched / Final", color: "#38bdf8", bg: "rgba(56,189,248,0.15)" },
};

const WINDOWS = [7, 14, 28] as const;
const DAILY_TARGET = 40; // 40 videos / day target per VA

interface Ev {
  type: EventType;
  hour: number; // local fractional hour 0..24
  title: string;
  time: string; // local HH:MM
  jobId: string;
}

interface DaySummary {
  dateKey: string;
  dateLabel: string;
  events: Ev[];
  jobsCount: number;
  startHour: number | null;
  endHour: number | null;
  shiftHours: number;
  hourlyBuckets: number[]; // 24 numbers
  avgMinPerVideo: number;
}

interface VaSummary {
  name: string;
  role: string;
  email: string;
  totalVideos: number;
  activeDaysCount: number;
  dailyAvg: number;
  bestDayCount: number;
  todayCount: number;
  todayShiftHours: number;
  todayStart: string | null;
  todayEnd: string | null;
  todayAvgSpeedMin: number;
  lastActiveMinutesAgo: number | null;
  days: DaySummary[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const localHour = (d: Date) => d.getHours() + d.getMinutes() / 60;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtH = (h: number) => `${pad(Math.floor(h))}:${pad(Math.round((h % 1) * 60))}`;

export function VaDailyTimeline() {
  const [data, setData] = useState<Payload | null>(null);
  const [windowDays, setWindowDays] = useState<number>(14);
  const [selectedVa, setSelectedVa] = useState<string>("ALL_VAS");
  const [viewMode, setViewMode] = useState<"visual" | "table">("visual");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredEv, setHoveredEv] = useState<{ ev: Ev; x: number; y: number } | null>(null);

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

  const todayKey = useMemo(() => dayKey(new Date()), []);

  // Process data and ensure VA 1 and VA 2 always exist
  const vaSummaries = useMemo<VaSummary[]>(() => {
    const map = new Map<string, { role: string; email: string; jobs: TimelineJob[] }>();

    // Seed default expected VAs
    map.set("VA 1", { role: "PRODUCTION_VA", email: "va1@tutorialstudio.app", jobs: [] });
    map.set("VA 2", { role: "PRODUCTION_VA", email: "va2@tutorialstudio.app", jobs: [] });

    // Add any other known VAs from API
    for (const v of data?.vas ?? []) {
      const canonical = v.name === "Virtual Assistant 1" ? "VA 1" : v.name === "Virtual Assistant 2" ? "VA 2" : v.name;
      if (!map.has(canonical)) {
        map.set(canonical, { role: v.role, email: v.email, jobs: [] });
      }
    }

    // Distribute jobs
    for (const job of data?.jobs ?? []) {
      let vaName = job.va ?? "Unknown VA";
      if (vaName === "Virtual Assistant 1") vaName = "VA 1";
      if (vaName === "Virtual Assistant 2") vaName = "VA 2";

      if (!map.has(vaName)) {
        map.set(vaName, { role: "USER", email: "", jobs: [] });
      }
      map.get(vaName)!.jobs.push(job);
    }

    const summaries: VaSummary[] = [];

    map.forEach((val, name) => {
      const dayMap = new Map<string, Ev[]>();
      let latestTimestamp: Date | null = null;

      for (const job of val.jobs) {
        const push = (iso: string | null, type: EventType) => {
          if (!iso) return;
          const d = new Date(iso);
          if (Number.isNaN(d.getTime())) return;
          if (!latestTimestamp || d > latestTimestamp) latestTimestamp = d;

          const key = dayKey(d);
          const list = dayMap.get(key) ?? [];
          list.push({
            type,
            hour: localHour(d),
            title: job.title ?? "(untitled)",
            time: localTime(d),
            jobId: job.jobId,
          });
          dayMap.set(key, list);
        };
        push(job.createdAt, "created");
        push(job.recordedAt, "recorded");
        push(job.completedAt, "completed");
      }

      // Build sorted days
      const days: DaySummary[] = [];
      let totalVideos = val.jobs.length;
      let bestDayCount = 0;

      // Generate days list
      const sortedKeys = Array.from(dayMap.keys()).sort((a, b) => b.localeCompare(a));
      for (const k of sortedKeys) {
        const evs = dayMap.get(k) ?? [];
        const hours = evs.map((e) => e.hour);
        const start = hours.length ? Math.min(...hours) : null;
        const end = hours.length ? Math.max(...hours) : null;
        const shift = start != null && end != null ? Math.max(0.5, end - start) : 0;
        
        // Count completed or created
        const vidsInDay = evs.filter(e => e.type === "completed" || e.type === "created").length / (evs.some(e => e.type === "completed") ? 1 : 1);
        const distinctJobs = new Set(evs.map(e => e.jobId)).size;
        if (distinctJobs > bestDayCount) bestDayCount = distinctJobs;

        const buckets = new Array(24).fill(0);
        for (const e of evs) {
          const h = Math.min(23, Math.max(0, Math.floor(e.hour)));
          buckets[h]++;
        }

        const [y, m, d] = k.split("-").map(Number);
        const dateLabel = new Date(y, m - 1, d).toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        });

        const avgSpeed = shift > 0 && distinctJobs > 0 ? (shift * 60) / distinctJobs : 0;

        days.push({
          dateKey: k,
          dateLabel,
          events: evs,
          jobsCount: distinctJobs,
          startHour: start,
          endHour: end,
          shiftHours: shift,
          hourlyBuckets: buckets,
          avgMinPerVideo: avgSpeed,
        });
      }

      const activeDaysCount = days.length;
      const dailyAvg = activeDaysCount > 0 ? totalVideos / activeDaysCount : 0;

      // Today stats
      const todaySummary = days.find((d) => d.dateKey === todayKey);
      const todayCount = todaySummary ? todaySummary.jobsCount : 0;
      const todayShiftHours = todaySummary ? todaySummary.shiftHours : 0;
      const todayStart = todaySummary && todaySummary.startHour != null ? fmtH(todaySummary.startHour) : null;
      const todayEnd = todaySummary && todaySummary.endHour != null ? fmtH(todaySummary.endHour) : null;
      const todayAvgSpeedMin = todaySummary ? todaySummary.avgMinPerVideo : 0;

      const lastActiveMinutesAgo = latestTimestamp
        ? Math.max(0, Math.round((Date.now() - latestTimestamp.getTime()) / 60000))
        : null;

      summaries.push({
        name,
        role: val.role,
        email: val.email,
        totalVideos,
        activeDaysCount,
        dailyAvg,
        bestDayCount,
        todayCount,
        todayShiftHours,
        todayStart,
        todayEnd,
        todayAvgSpeedMin,
        lastActiveMinutesAgo,
        days,
      });
    });

    // Sort: VAs first (VA 1, VA 2), then others by total
    return summaries.sort((a, b) => {
      const aIsVa = a.name.startsWith("VA ");
      const bIsVa = b.name.startsWith("VA ");
      if (aIsVa && !bIsVa) return -1;
      if (!aIsVa && bIsVa) return 1;
      if (aIsVa && bIsVa) return a.name.localeCompare(b.name);
      return b.totalVideos - a.totalVideos;
    });
  }, [data, todayKey]);

  // Filtered list based on selector
  const displayedSummaries = useMemo(() => {
    if (selectedVa === "ALL_VAS") {
      return vaSummaries.filter((v) => v.name.startsWith("VA "));
    }
    if (selectedVa === "ALL_USERS") {
      return vaSummaries;
    }
    return vaSummaries.filter((v) => v.name === selectedVa);
  }, [vaSummaries, selectedVa]);

  return (
    <div
      style={{
        background: "var(--v2-surface-2, #111)",
        border: "1px solid var(--v2-border-1, #222)",
        borderRadius: 14,
        padding: 22,
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      {/* Top Header & Filter Toolbar */}
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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "var(--v2-accent, #4ade80)",
                boxShadow: "0 0 10px var(--v2-accent, #4ade80)",
              }}
            />
            <span
              style={{
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "#fff",
              }}
            >
              VA Production Intelligence &amp; Daily Rhythm
            </span>
          </div>
          <p style={{ fontSize: 11, color: "var(--v2-text-2, #888)", marginTop: 3 }}>
            Real working shift tracking, hourly video velocity, output pace, and target completion for VAs.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* VA Filter */}
          <div style={{ display: "flex", background: "rgba(255,255,255,0.05)", padding: 3, borderRadius: 8 }}>
            <button
              onClick={() => setSelectedVa("ALL_VAS")}
              style={{
                border: "none",
                cursor: "pointer",
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                background: selectedVa === "ALL_VAS" ? "var(--v2-accent, #4ade80)" : "transparent",
                color: selectedVa === "ALL_VAS" ? "#000" : "var(--v2-text-2, #888)",
              }}
            >
              Both VAs (VA 1 &amp; VA 2)
            </button>
            <button
              onClick={() => setSelectedVa("VA 1")}
              style={{
                border: "none",
                cursor: "pointer",
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                background: selectedVa === "VA 1" ? "var(--v2-accent, #4ade80)" : "transparent",
                color: selectedVa === "VA 1" ? "#000" : "var(--v2-text-2, #888)",
              }}
            >
              VA 1
            </button>
            <button
              onClick={() => setSelectedVa("VA 2")}
              style={{
                border: "none",
                cursor: "pointer",
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                background: selectedVa === "VA 2" ? "var(--v2-accent, #4ade80)" : "transparent",
                color: selectedVa === "VA 2" ? "#000" : "var(--v2-text-2, #888)",
              }}
            >
              VA 2
            </button>
            <button
              onClick={() => setSelectedVa("ALL_USERS")}
              style={{
                border: "none",
                cursor: "pointer",
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                background: selectedVa === "ALL_USERS" ? "var(--v2-accent, #4ade80)" : "transparent",
                color: selectedVa === "ALL_USERS" ? "#000" : "var(--v2-text-2, #888)",
              }}
            >
              All (incl. Admins)
            </button>
          </div>

          {/* Window Days */}
          <div style={{ display: "flex", background: "rgba(255,255,255,0.05)", padding: 3, borderRadius: 8 }}>
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setWindowDays(w)}
                style={{
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 10px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  background: windowDays === w ? "rgba(255,255,255,0.2)" : "transparent",
                  color: windowDays === w ? "#fff" : "var(--v2-text-2, #888)",
                }}
              >
                {w}d
              </button>
            ))}
          </div>

          {/* View Mode */}
          <div style={{ display: "flex", background: "rgba(255,255,255,0.05)", padding: 3, borderRadius: 8 }}>
            <button
              onClick={() => setViewMode("visual")}
              style={{
                border: "none",
                cursor: "pointer",
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                background: viewMode === "visual" ? "rgba(255,255,255,0.2)" : "transparent",
                color: viewMode === "visual" ? "#fff" : "var(--v2-text-2, #888)",
              }}
            >
              Visual Shift Board
            </button>
            <button
              onClick={() => setViewMode("table")}
              style={{
                border: "none",
                cursor: "pointer",
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                background: viewMode === "table" ? "rgba(255,255,255,0.2)" : "transparent",
                color: viewMode === "table" ? "#fff" : "var(--v2-text-2, #888)",
              }}
            >
              Shift Ledger Table
            </button>
          </div>
        </div>
      </div>

      {/* Legend & Timezone indicator */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          padding: "8px 14px",
          background: "rgba(255,255,255,0.02)",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--v2-text-3, #666)", fontWeight: 600 }}>EVENT TYPES:</span>
          {Object.entries(EVENT).map(([type, meta]) => (
            <span key={type} style={{ fontSize: 11, color: "var(--v2-text-2, #bbb)", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color }} />
              {meta.label}
            </span>
          ))}
          <span style={{ fontSize: 11, color: "var(--v2-text-2, #bbb)", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 12, height: 6, borderRadius: 2, background: "rgba(74,222,128,0.3)" }} />
            Active Working Shift Band
          </span>
          <span style={{ fontSize: 11, color: "var(--v2-text-2, #bbb)", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 10, borderRadius: 2, background: "var(--v2-accent, #4ade80)" }} />
            Hourly Video Velocity Bars
          </span>
        </div>
        <span style={{ fontSize: 11, color: "var(--v2-text-3, #666)" }}>
          Times local ({tz}) · Target: {DAILY_TARGET} vids/day
        </span>
      </div>

      {loading && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--v2-text-3, #666)", fontSize: 13 }}>
          Loading VA production timeline…
        </div>
      )}

      {error && (
        <div style={{ padding: 16, borderRadius: 8, background: "rgba(248,113,113,0.1)", color: "#f87171", fontSize: 13 }}>
          Could not load timeline metrics: {error}
        </div>
      )}

      {!loading && !error && displayedSummaries.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--v2-text-3, #666)", fontSize: 13 }}>
          No production activity found for selected filter.
        </div>
      )}

      {!loading && !error && displayedSummaries.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {displayedSummaries.map((va) => {
            const isOnline = va.lastActiveMinutesAgo !== null && va.lastActiveMinutesAgo < 45;
            const isIdleToday = va.lastActiveMinutesAgo !== null && va.lastActiveMinutesAgo >= 45 && va.todayCount > 0;
            const quotaPct = Math.min(100, Math.round((va.todayCount / DAILY_TARGET) * 100));

            return (
              <div
                key={va.name}
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 12,
                  padding: 18,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                {/* VA Profile & Executive Metrics Header */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: 14,
                    alignItems: "center",
                    paddingBottom: 14,
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  {/* Identity & Status */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 10,
                        background: "linear-gradient(135deg, #1f2937, #111827)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 16,
                        fontWeight: 900,
                        color: "var(--v2-accent, #4ade80)",
                      }}
                    >
                      {va.name.replace("VA ", "VA")}
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{va.name}</span>
                        {isOnline ? (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: "2px 7px",
                              borderRadius: 12,
                              background: "rgba(74,222,128,0.2)",
                              color: "#4ade80",
                              border: "1px solid rgba(74,222,128,0.4)",
                            }}
                          >
                            ● ACTIVE NOW
                          </span>
                        ) : isIdleToday ? (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: "2px 7px",
                              borderRadius: 12,
                              background: "rgba(240,166,66,0.2)",
                              color: "#f0a642",
                              border: "1px solid rgba(240,166,66,0.4)",
                            }}
                          >
                            ○ IDLE ({va.lastActiveMinutesAgo}m ago)
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: "2px 7px",
                              borderRadius: 12,
                              background: "rgba(255,255,255,0.06)",
                              color: "var(--v2-text-3, #666)",
                              border: "1px solid rgba(255,255,255,0.1)",
                            }}
                          >
                            STANDBY / OFFLINE
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--v2-text-3, #666)", marginTop: 2 }}>
                        {va.email || "Assigned Production Virtual Assistant"}
                      </div>
                    </div>
                  </div>

                  {/* Today's Quota & Shift */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                      <span style={{ color: "var(--v2-text-2, #888)" }}>Today's Output:</span>
                      <span style={{ fontWeight: 800, color: va.todayCount >= DAILY_TARGET ? "#4ade80" : "#fff" }}>
                        {va.todayCount} / {DAILY_TARGET} vids ({quotaPct}%)
                      </span>
                    </div>
                    <div
                      style={{
                        height: 6,
                        borderRadius: 3,
                        background: "rgba(255,255,255,0.08)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${quotaPct}%`,
                          background: va.todayCount >= DAILY_TARGET ? "#4ade80" : "var(--v2-accent, #4ade80)",
                          borderRadius: 3,
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 11, color: "var(--v2-text-3, #666)", display: "flex", justifyContent: "space-between" }}>
                      <span>Shift: {va.todayStart ? `${va.todayStart} – ${va.todayEnd} (${va.todayShiftHours.toFixed(1)}h)` : "Not started today"}</span>
                      {va.todayAvgSpeedMin > 0 && (
                        <span>~{va.todayAvgSpeedMin.toFixed(1)}m / vid</span>
                      )}
                    </div>
                  </div>

                  {/* Period Stats */}
                  <div style={{ display: "flex", gap: 14, justifyContent: "flex-end" }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: "#fff" }}>{va.totalVideos}</div>
                      <div style={{ fontSize: 10, color: "var(--v2-text-3, #666)", textTransform: "uppercase" }}>{windowDays}d Total</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: "var(--v2-accent, #4ade80)" }}>
                        {va.dailyAvg.toFixed(1)}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--v2-text-3, #666)", textTransform: "uppercase" }}>Avg / Day</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: "#f0a642" }}>{va.bestDayCount}</div>
                      <div style={{ fontSize: 10, color: "var(--v2-text-3, #666)", textTransform: "uppercase" }}>Best Day</div>
                    </div>
                  </div>
                </div>

                {/* Main Days View */}
                {va.days.length === 0 ? (
                  <div
                    style={{
                      padding: 28,
                      textAlign: "center",
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.01)",
                      border: "1px dashed rgba(255,255,255,0.08)",
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--v2-text-2, #888)" }}>
                      Awaiting First Production Shift
                    </div>
                    <div style={{ fontSize: 12, color: "var(--v2-text-3, #666)", marginTop: 4 }}>
                      {va.name} is on standby with {DAILY_TARGET} videos/day target. Production activity will map here automatically as videos are recorded.
                    </div>
                  </div>
                ) : viewMode === "visual" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {/* Hour Axis Header */}
                    <div style={{ position: "relative", height: 16, borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: 4 }}>
                      {[0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24].map((h) => (
                        <span
                          key={h}
                          style={{
                            position: "absolute",
                            left: `${(h / 24) * 100}%`,
                            transform: "translateX(-50%)",
                            fontSize: 9,
                            fontWeight: 700,
                            color: "var(--v2-text-3, #666)",
                          }}
                        >
                          {h}:00
                        </span>
                      ))}
                    </div>

                    {/* Day Rows */}
                    {va.days.map((d) => {
                      const maxHourly = Math.max(1, ...d.hourlyBuckets);
                      const isToday = d.dateKey === todayKey;

                      return (
                        <div
                          key={d.dateKey}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            padding: "6px 8px",
                            borderRadius: 8,
                            background: isToday ? "rgba(74,222,128,0.04)" : "transparent",
                            border: isToday ? "1px solid rgba(74,222,128,0.15)" : "1px solid transparent",
                          }}
                        >
                          {/* Date & Day Stats */}
                          <div style={{ width: 170, flexShrink: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: isToday ? "var(--v2-accent, #4ade80)" : "#fff" }}>
                                {d.dateLabel}
                              </span>
                              {isToday && (
                                <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 4, background: "var(--v2-accent, #4ade80)", color: "#000", fontWeight: 800 }}>
                                  TODAY
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 10, color: "var(--v2-text-3, #666)", marginTop: 2, display: "flex", gap: 6 }}>
                              <span style={{ fontWeight: 700, color: d.jobsCount >= DAILY_TARGET ? "#4ade80" : "var(--v2-text-2, #bbb)" }}>
                                {d.jobsCount} vids
                              </span>
                              {d.startHour != null && d.endHour != null && (
                                <span>· {fmtH(d.startHour)}–{fmtH(d.endHour)} ({d.shiftHours.toFixed(1)}h)</span>
                              )}
                            </div>
                          </div>

                          {/* 24h Lane with Velocity Bars & Event Dots */}
                          <div
                            style={{
                              flex: 1,
                              position: "relative",
                              height: 38,
                              background: "rgba(0,0,0,0.3)",
                              borderRadius: 6,
                              overflow: "hidden",
                              border: "1px solid rgba(255,255,255,0.05)",
                            }}
                          >
                            {/* Working shift band */}
                            {d.startHour != null && d.endHour != null && (
                              <div
                                style={{
                                  position: "absolute",
                                  left: `${(d.startHour / 24) * 100}%`,
                                  width: `${((d.endHour - d.startHour) / 24) * 100}%`,
                                  top: 0,
                                  bottom: 0,
                                  background: "rgba(74,222,128,0.10)",
                                  borderLeft: "2px solid rgba(74,222,128,0.4)",
                                  borderRight: "2px solid rgba(74,222,128,0.4)",
                                }}
                              />
                            )}

                            {/* Hour gridlines */}
                            {[4, 8, 12, 16, 20].map((h) => (
                              <div
                                key={h}
                                style={{
                                  position: "absolute",
                                  left: `${(h / 24) * 100}%`,
                                  top: 0,
                                  bottom: 0,
                                  width: 1,
                                  background: "rgba(255,255,255,0.03)",
                                }}
                              />
                            ))}

                            {/* Hourly Velocity Bars in Background */}
                            {d.hourlyBuckets.map((count, h) => {
                              if (count === 0) return null;
                              const barHeight = Math.max(4, (count / maxHourly) * 24);
                              return (
                                <div
                                  key={h}
                                  title={`${h}:00 – ${h + 1}:00: ${count} videos completed`}
                                  style={{
                                    position: "absolute",
                                    left: `${(h / 24) * 100 + 0.3}%`,
                                    width: `${100 / 24 - 0.6}%`,
                                    bottom: 0,
                                    height: barHeight,
                                    background: "rgba(74,222,128,0.35)",
                                    borderRadius: "2px 2px 0 0",
                                  }}
                                />
                              );
                            })}

                            {/* Individual Event Step Dots */}
                            {d.events.map((e, j) => (
                              <span
                                key={j}
                                onMouseEnter={(ev) => {
                                  const rect = (ev.target as HTMLElement).getBoundingClientRect();
                                  setHoveredEv({ ev: e, x: rect.left, y: rect.top - 40 });
                                }}
                                onMouseLeave={() => setHoveredEv(null)}
                                style={{
                                  position: "absolute",
                                  left: `${(e.hour / 24) * 100}%`,
                                  top: "50%",
                                  width: 8,
                                  height: 8,
                                  marginLeft: -4,
                                  marginTop: -4,
                                  borderRadius: "50%",
                                  background: EVENT[e.type].color,
                                  boxShadow: `0 0 6px ${EVENT[e.type].color}`,
                                  cursor: "pointer",
                                  zIndex: 2,
                                }}
                              />
                            ))}

                            {/* Center Baseline */}
                            <div
                              style={{
                                position: "absolute",
                                left: 0,
                                right: 0,
                                top: "50%",
                                height: 1,
                                background: "rgba(255,255,255,0.06)",
                                zIndex: 1,
                              }}
                            />
                          </div>

                          {/* Day Metric Pill */}
                          <div style={{ width: 80, textAlign: "right", flexShrink: 0 }}>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "2px 7px",
                                borderRadius: 6,
                                background: d.jobsCount >= DAILY_TARGET ? "rgba(74,222,128,0.15)" : "rgba(255,255,255,0.05)",
                                color: d.jobsCount >= DAILY_TARGET ? "#4ade80" : "var(--v2-text-2, #bbb)",
                                border: d.jobsCount >= DAILY_TARGET ? "1px solid rgba(74,222,128,0.3)" : "1px solid rgba(255,255,255,0.08)",
                              }}
                            >
                              {d.jobsCount >= DAILY_TARGET ? "100% Target" : `${Math.round((d.jobsCount / DAILY_TARGET) * 100)}%`}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Table Ledger View */
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", color: "var(--v2-text-3, #666)", textAlign: "left" }}>
                          <th style={{ padding: "8px 12px" }}>Date</th>
                          <th style={{ padding: "8px 12px" }}>Videos Done</th>
                          <th style={{ padding: "8px 12px" }}>Shift Window</th>
                          <th style={{ padding: "8px 12px" }}>Net Work Hours</th>
                          <th style={{ padding: "8px 12px" }}>Avg Speed</th>
                          <th style={{ padding: "8px 12px" }}>Hourly Velocity</th>
                          <th style={{ padding: "8px 12px", textAlign: "right" }}>Daily Quota</th>
                        </tr>
                      </thead>
                      <tbody>
                        {va.days.map((d) => (
                          <tr key={d.dateKey} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                            <td style={{ padding: "10px 12px", fontWeight: 700, color: d.dateKey === todayKey ? "var(--v2-accent, #4ade80)" : "#fff" }}>
                              {d.dateLabel}
                            </td>
                            <td style={{ padding: "10px 12px", fontWeight: 700, color: d.jobsCount >= DAILY_TARGET ? "#4ade80" : "#fff" }}>
                              {d.jobsCount} videos
                            </td>
                            <td style={{ padding: "10px 12px", color: "var(--v2-text-2, #bbb)" }}>
                              {d.startHour != null && d.endHour != null ? `${fmtH(d.startHour)} – ${fmtH(d.endHour)}` : "—"}
                            </td>
                            <td style={{ padding: "10px 12px", color: "var(--v2-text-2, #bbb)" }}>
                              {d.shiftHours > 0 ? `${d.shiftHours.toFixed(1)} hours` : "—"}
                            </td>
                            <td style={{ padding: "10px 12px", color: "var(--v2-text-2, #bbb)" }}>
                              {d.avgMinPerVideo > 0 ? `~${d.avgMinPerVideo.toFixed(1)} min / vid` : "—"}
                            </td>
                            <td style={{ padding: "10px 12px", color: "var(--v2-accent, #4ade80)", fontWeight: 600 }}>
                              {d.shiftHours > 0 ? `${(d.jobsCount / d.shiftHours).toFixed(1)} vids / hour` : "—"}
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "right" }}>
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  padding: "2px 8px",
                                  borderRadius: 4,
                                  background: d.jobsCount >= DAILY_TARGET ? "rgba(74,222,128,0.2)" : "rgba(240,166,66,0.15)",
                                  color: d.jobsCount >= DAILY_TARGET ? "#4ade80" : "#f0a642",
                                }}
                              >
                                {d.jobsCount >= DAILY_TARGET ? "40/40 Hit (100%)" : `${d.jobsCount}/${DAILY_TARGET} (${Math.round((d.jobsCount / DAILY_TARGET) * 100)}%)`}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Hover Tooltip */}
      {hoveredEv && (
        <div
          style={{
            position: "fixed",
            left: hoveredEv.x,
            top: hoveredEv.y,
            transform: "translate(-50%, -100%)",
            background: "#1e293b",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 11,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            pointerEvents: "none",
            zIndex: 9999,
            whiteSpace: "nowrap",
          }}
        >
          <div style={{ fontWeight: 700, color: EVENT[hoveredEv.ev.type].color }}>
            {EVENT[hoveredEv.ev.type].label} · {hoveredEv.ev.time}
          </div>
          <div style={{ color: "#e2e8f0", marginTop: 2 }}>{hoveredEv.ev.title}</div>
        </div>
      )}
    </div>
  );
}
