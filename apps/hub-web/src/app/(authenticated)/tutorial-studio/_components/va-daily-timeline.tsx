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
const DAILY_VIDEO_TARGET = 40; // 40 videos / day target per VA
const DAILY_SHIFT_TARGET_HOURS = 8.0; // 8.0 hours / day standard shift

interface Ev {
  type: EventType;
  hour: number; // local fractional hour 0..24
  title: string;
  time: string; // local HH:MM
  jobId: string;
}

interface ShiftGap {
  startHour: number;
  endHour: number;
  durationHours: number;
}

interface DaySummary {
  dateKey: string;
  dateLabel: string;
  events: Ev[];
  jobsCount: number;
  startHour: number | null;
  endHour: number | null;
  grossShiftHours: number;
  netActiveHours: number;
  pauseHours: number;
  gaps: ShiftGap[];
  hourlyBuckets: number[]; // 24 numbers (velocity per hour)
  hourlyLineSvg: string;
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
  todayGrossHours: number;
  todayActiveHours: number;
  todayStart: string | null;
  todayEnd: string | null;
  todayAvgSpeedMin: number;
  lastActiveMinutesAgo: number | null;
  days: DaySummary[];
}

/** Short badge for a VA avatar: initials of a real name ("Nalu" → "NA",
 * "Anna Lee" → "AL"), or a "VA 1"-style label collapsed to "VA1". */
function vaInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.replace(/\s+/g, "").slice(0, 2).toUpperCase();
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
  const [hoveredInfo, setHoveredInfo] = useState<{ text: string; sub?: string; x: number; y: number } | null>(null);

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

  // The real, active VA accounts (from the DB via getKnownVAs), by name — e.g.
  // "Nalu", "Lorraine". These are the operators we always show a card for and
  // that the "All VAs" filter and per-VA buttons are built from.
  const knownVaNames = useMemo(
    () => (data?.vas ?? []).map((v) => v.name),
    [data],
  );

  // Process data — one card per known VA (always rendered), plus any other
  // non-admin producer that shows up in the job data.
  const vaSummaries = useMemo<VaSummary[]>(() => {
    const map = new Map<string, { role: string; email: string; jobs: TimelineJob[] }>();

    // Seed every known active VA so their card always renders, even at 0 videos.
    for (const v of data?.vas ?? []) {
      if (!map.has(v.name)) {
        map.set(v.name, { role: v.role, email: v.email, jobs: [] });
      }
    }

    // Distribute jobs by their real producer name (admins are already excluded
    // server-side, and every account is now a single canonical identity).
    for (const job of data?.jobs ?? []) {
      const vaName = job.va ?? "Unknown VA";
      if (!map.has(vaName)) {
        map.set(vaName, { role: "USER", email: "", jobs: [] });
      }
      map.get(vaName)!.jobs.push(job);
    }

    const summaries: VaSummary[] = [];

    map.forEach((val, name) => {
      const dayMap = new Map<string, Ev[]>();
      let latestMs = 0;

      for (const job of val.jobs) {
        const push = (iso: string | null, type: EventType) => {
          if (!iso) return;
          const d = new Date(iso);
          if (Number.isNaN(d.getTime())) return;
          if (d.getTime() > latestMs) latestMs = d.getTime();

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
        // Only the VA's hands-on actions count toward the shift window and
        // hourly rate: creating/rendering the job and uploading the recording.
        // "completed" (splice/stitch) is the automated stitcher — the VA spends
        // no time on it — so it is NOT plotted as VA activity (it used to
        // inflate the shift window and active hours).
        push(job.createdAt, "created");
        push(job.recordedAt, "recorded");
      }

      // Build sorted days
      const days: DaySummary[] = [];
      let totalVideos = val.jobs.length;
      let bestDayCount = 0;

      // Generate days list
      const sortedKeys = Array.from(dayMap.keys()).sort((a, b) => b.localeCompare(a));
      for (const k of sortedKeys) {
        const evs = dayMap.get(k) ?? [];
        const distinctHours = [...evs.map((e) => e.hour)].sort((a, b) => a - b);
        const start = distinctHours.length ? distinctHours[0] : null;
        const end = distinctHours.length ? distinctHours[distinctHours.length - 1] : null;
        const grossShift = start != null && end != null ? Math.max(0.2, end - start) : 0;
        
        // Compute idle pauses / drop-offs (> 45 min gap with 0 events)
        const gaps: ShiftGap[] = [];
        let pauseTime = 0;
        for (let i = 1; i < distinctHours.length; i++) {
          const diff = distinctHours[i] - distinctHours[i - 1];
          if (diff >= 0.75) { // 45+ minute pause
            gaps.push({
              startHour: distinctHours[i - 1],
              endHour: distinctHours[i],
              durationHours: diff,
            });
            pauseTime += diff;
          }
        }

        const netActive = Math.max(0.1, grossShift - pauseTime);
        const distinctJobs = new Set(evs.map(e => e.jobId)).size;
        if (distinctJobs > bestDayCount) bestDayCount = distinctJobs;

        // Hourly velocity histogram (0..23)
        const buckets = new Array(24).fill(0);
        for (const e of evs) {
          const h = Math.min(23, Math.max(0, Math.floor(e.hour)));
          buckets[h]++;
        }

        // Build SVG sparkline polyline string for production rate
        const maxBucket = Math.max(1, ...buckets);
        const svgPoints = buckets
          .map((cnt, h) => {
            const x = ((h + 0.5) / 24) * 100;
            const y = 36 - (cnt / maxBucket) * 30; // 0..36 height
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ");

        const [y, m, d] = k.split("-").map(Number);
        const dateLabel = new Date(y, m - 1, d).toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        });

        const avgSpeed = netActive > 0 && distinctJobs > 0 ? (netActive * 60) / distinctJobs : 0;

        days.push({
          dateKey: k,
          dateLabel,
          events: evs,
          jobsCount: distinctJobs,
          startHour: start,
          endHour: end,
          grossShiftHours: grossShift,
          netActiveHours: netActive,
          pauseHours: pauseTime,
          gaps,
          hourlyBuckets: buckets,
          hourlyLineSvg: svgPoints,
          avgMinPerVideo: avgSpeed,
        });
      }

      const activeDaysCount = days.length;
      const dailyAvg = activeDaysCount > 0 ? totalVideos / activeDaysCount : 0;

      // Today stats
      const todaySummary = days.find((d) => d.dateKey === todayKey);
      const todayCount = todaySummary ? todaySummary.jobsCount : 0;
      const todayGrossHours = todaySummary ? todaySummary.grossShiftHours : 0;
      const todayActiveHours = todaySummary ? todaySummary.netActiveHours : 0;
      const todayStart = todaySummary && todaySummary.startHour != null ? fmtH(todaySummary.startHour) : null;
      const todayEnd = todaySummary && todaySummary.endHour != null ? fmtH(todaySummary.endHour) : null;
      const todayAvgSpeedMin = todaySummary ? todaySummary.avgMinPerVideo : 0;

      const lastActiveMinutesAgo =
        latestMs > 0
          ? Math.max(0, Math.round((Date.now() - latestMs) / 60000))
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
        todayGrossHours,
        todayActiveHours,
        todayStart,
        todayEnd,
        todayAvgSpeedMin,
        lastActiveMinutesAgo,
        days,
      });
    });

    // Sort: known VAs first (in getKnownVAs order), then any other producer by
    // volume.
    const rank = (n: string) => {
      const i = knownVaNames.indexOf(n);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return summaries.sort((a, b) => {
      const ra = rank(a.name);
      const rb = rank(b.name);
      if (ra !== rb) return ra - rb;
      return b.totalVideos - a.totalVideos;
    });
  }, [data, todayKey, knownVaNames]);

  const displayedSummaries = useMemo(() => {
    if (selectedVa === "ALL_VAS") {
      return vaSummaries.filter((v) => knownVaNames.includes(v.name));
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
              VA Production Intelligence · Shift Tracking &amp; Rate Graph
            </span>
          </div>
          <p style={{ fontSize: 11, color: "var(--v2-text-2, #888)", marginTop: 3 }}>
            Inspect full 8h shift compliance, hourly output curves, lunch drop-offs, and speed per video.
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
              {knownVaNames.length > 0
                ? `All VAs (${knownVaNames.join(" & ")})`
                : "All VAs"}
            </button>
            {knownVaNames.map((name) => (
              <button
                key={name}
                onClick={() => setSelectedVa(name)}
                style={{
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 10px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  background: selectedVa === name ? "var(--v2-accent, #4ade80)" : "transparent",
                  color: selectedVa === name ? "#000" : "var(--v2-text-2, #888)",
                }}
              >
                {name}
              </button>
            ))}
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
              All Producers
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
              Velocity Graph
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
              Shift Ledger
            </button>
          </div>
        </div>
      </div>

      {/* Legend & 8h Shift Guide */}
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
          <span style={{ fontSize: 11, color: "var(--v2-text-3, #666)", fontWeight: 600 }}>METRIC VISUALS:</span>
          <span style={{ fontSize: 11, color: "var(--v2-text-2, #bbb)", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 14, height: 10, borderRadius: 2, background: "rgba(74,222,128,0.4)" }} />
            Hourly Rate Graph (vids/hr)
          </span>
          <span style={{ fontSize: 11, color: "var(--v2-text-2, #bbb)", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 12, height: 6, borderRadius: 2, background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.4)" }} />
            Active Shift Block
          </span>
          <span style={{ fontSize: 11, color: "var(--v2-text-2, #bbb)", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 12, height: 6, borderRadius: 2, background: "rgba(248,113,113,0.15)", border: "1px dashed rgba(248,113,113,0.4)" }} />
            Pause / Drop-off Valley
          </span>
          <span style={{ fontSize: 11, color: "var(--v2-text-2, #bbb)", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#4ade80" }} />
            Micro Video Dot (Hover for Title)
          </span>
        </div>
        <span style={{ fontSize: 11, color: "var(--v2-text-3, #666)" }}>
          Times shown in {tz} · Standard Shift: {DAILY_SHIFT_TARGET_HOURS}h / {DAILY_VIDEO_TARGET} vids
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

      {!loading && !error && displayedSummaries.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {displayedSummaries.map((va) => {
            const isOnline = va.lastActiveMinutesAgo !== null && va.lastActiveMinutesAgo < 45;
            const isIdleToday = va.lastActiveMinutesAgo !== null && va.lastActiveMinutesAgo >= 45 && va.todayCount > 0;
            const quotaPct = Math.min(100, Math.round((va.todayCount / DAILY_VIDEO_TARGET) * 100));
            const shiftPct = Math.min(100, Math.round((va.todayActiveHours / DAILY_SHIFT_TARGET_HOURS) * 100));

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
                {/* VA Header KPI Summary */}
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
                  {/* Identity */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 10,
                        background: "linear-gradient(135deg, #1f2937, #0f172a)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 15,
                        fontWeight: 900,
                        color: "var(--v2-accent, #4ade80)",
                        letterSpacing: "0.02em",
                      }}
                    >
                      {vaInitials(va.name)}
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{va.name}</span>
                        {isOnline ? (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 12, background: "rgba(74,222,128,0.2)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.4)" }}>
                            ● ACTIVE NOW
                          </span>
                        ) : isIdleToday ? (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 12, background: "rgba(240,166,66,0.2)", color: "#f0a642", border: "1px solid rgba(240,166,66,0.4)" }}>
                            ○ IDLE ({va.lastActiveMinutesAgo}m ago)
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 12, background: "rgba(255,255,255,0.06)", color: "var(--v2-text-3, #666)", border: "1px solid rgba(255,255,255,0.1)" }}>
                            STANDBY / OFFLINE
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--v2-text-3, #666)", marginTop: 2 }}>
                        {va.email || "Assigned Virtual Assistant"}
                      </div>
                    </div>
                  </div>

                  {/* Shift Hours Tracking */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                      <span style={{ color: "var(--v2-text-2, #888)" }}>Today's 8h Shift:</span>
                      <span style={{ fontWeight: 800, color: va.todayActiveHours >= 7.5 ? "#4ade80" : "#fff" }}>
                        {va.todayActiveHours.toFixed(1)}h / {DAILY_SHIFT_TARGET_HOURS}h ({shiftPct}%)
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${shiftPct}%`, background: va.todayActiveHours >= 7.5 ? "#4ade80" : "var(--v2-accent, #4ade80)", borderRadius: 3 }} />
                    </div>
                    <div style={{ fontSize: 10, color: "var(--v2-text-3, #666)", display: "flex", justifyContent: "space-between" }}>
                      <span>Window: {va.todayStart ? `${va.todayStart} – ${va.todayEnd} (${va.todayGrossHours.toFixed(1)}h)` : "No shift logged today"}</span>
                      {va.todayAvgSpeedMin > 0 && <span>~{va.todayAvgSpeedMin.toFixed(1)}m / vid</span>}
                    </div>
                  </div>

                  {/* Quota Progress */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                      <span style={{ color: "var(--v2-text-2, #888)" }}>Daily 40-Video Quota:</span>
                      <span style={{ fontWeight: 800, color: va.todayCount >= DAILY_VIDEO_TARGET ? "#4ade80" : "#fff" }}>
                        {va.todayCount} / {DAILY_VIDEO_TARGET} ({quotaPct}%)
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${quotaPct}%`, background: va.todayCount >= DAILY_VIDEO_TARGET ? "#4ade80" : "#f0a642", borderRadius: 3 }} />
                    </div>
                    <div style={{ fontSize: 10, color: "var(--v2-text-3, #666)", textAlign: "right" }}>
                      {va.todayCount >= DAILY_VIDEO_TARGET ? "✅ Quota Met" : `${DAILY_VIDEO_TARGET - va.todayCount} remaining`}
                    </div>
                  </div>

                  {/* Period Stats */}
                  <div style={{ display: "flex", gap: 14, justifyContent: "flex-end" }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: "#fff" }}>{va.totalVideos}</div>
                      <div style={{ fontSize: 10, color: "var(--v2-text-3, #666)", textTransform: "uppercase" }}>{windowDays}d Total</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: "var(--v2-accent, #4ade80)" }}>{va.dailyAvg.toFixed(1)}</div>
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
                      Awaiting Production Shift
                    </div>
                    <div style={{ fontSize: 12, color: "var(--v2-text-3, #666)", marginTop: 4 }}>
                      {va.name} is on standby with 8h shift / {DAILY_VIDEO_TARGET} videos quota. Production curves and drop-offs will populate as videos are submitted.
                    </div>
                  </div>
                ) : viewMode === "visual" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {/* Hour Axis */}
                    <div style={{ position: "relative", height: 16, borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: 2 }}>
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
                      const isToday = d.dateKey === todayKey;
                      const maxRate = Math.max(1, ...d.hourlyBuckets);
                      const is8hComplete = d.grossShiftHours >= 7.5;

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
                          {/* Date & Shift Info */}
                          <div style={{ width: 190, flexShrink: 0 }}>
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
                            <div style={{ fontSize: 10, color: "var(--v2-text-3, #666)", marginTop: 2 }}>
                              <span style={{ fontWeight: 700, color: d.jobsCount >= DAILY_VIDEO_TARGET ? "#4ade80" : "var(--v2-text-2, #bbb)" }}>
                                {d.jobsCount} vids
                              </span>
                              {d.startHour != null && d.endHour != null && (
                                <span> · {fmtH(d.startHour)}–{fmtH(d.endHour)} ({d.grossShiftHours.toFixed(1)}h shift)</span>
                              )}
                            </div>
                            <div style={{ fontSize: 9, color: is8hComplete ? "#4ade80" : "#f0a642", marginTop: 1, fontWeight: 600 }}>
                              {is8hComplete ? `✓ 8h Target Met (${d.netActiveHours.toFixed(1)}h active)` : `⚠ ${d.grossShiftHours.toFixed(1)}h / 8h (${d.pauseHours > 0.5 ? `${d.pauseHours.toFixed(1)}h pause` : "short shift"})`}
                            </div>
                          </div>

                          {/* 24h Interactive Graph & Shift Lane */}
                          <div
                            style={{
                              flex: 1,
                              position: "relative",
                              height: 42,
                              background: "rgba(0,0,0,0.35)",
                              borderRadius: 6,
                              overflow: "hidden",
                              border: "1px solid rgba(255,255,255,0.06)",
                            }}
                          >
                            {/* Active working shift band */}
                            {d.startHour != null && d.endHour != null && (
                              <div
                                style={{
                                  position: "absolute",
                                  left: `${(d.startHour / 24) * 100}%`,
                                  width: `${((d.endHour - d.startHour) / 24) * 100}%`,
                                  top: 0,
                                  bottom: 0,
                                  background: "rgba(74,222,128,0.07)",
                                  borderLeft: "2px solid rgba(74,222,128,0.5)",
                                  borderRight: "2px solid rgba(74,222,128,0.5)",
                                }}
                              />
                            )}

                            {/* Drop-off / Lunch pause valleys */}
                            {d.gaps.map((gap, gIdx) => (
                              <div
                                key={gIdx}
                                onMouseEnter={(ev) => {
                                  const rect = (ev.target as HTMLElement).getBoundingClientRect();
                                  setHoveredInfo({
                                    text: `Pause / Production Drop-off: ${gap.durationHours.toFixed(1)} hours`,
                                    sub: `${fmtH(gap.startHour)} – ${fmtH(gap.endHour)} (No videos submitted)`,
                                    x: rect.left + rect.width / 2,
                                    y: rect.top - 10,
                                  });
                                }}
                                onMouseLeave={() => setHoveredInfo(null)}
                                style={{
                                  position: "absolute",
                                  left: `${(gap.startHour / 24) * 100}%`,
                                  width: `${(gap.durationHours / 24) * 100}%`,
                                  top: 0,
                                  bottom: 0,
                                  background: "rgba(248,113,113,0.12)",
                                  borderLeft: "1px dashed rgba(248,113,113,0.4)",
                                  borderRight: "1px dashed rgba(248,113,113,0.4)",
                                  cursor: "help",
                                }}
                              />
                            ))}

                            {/* Gridlines */}
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

                            {/* Hourly Velocity Histogram Columns */}
                            {d.hourlyBuckets.map((count, h) => {
                              if (count === 0) return null;
                              const barHeight = Math.max(4, (count / maxRate) * 26);
                              return (
                                <div
                                  key={h}
                                  onMouseEnter={(ev) => {
                                    const rect = (ev.target as HTMLElement).getBoundingClientRect();
                                    setHoveredInfo({
                                      text: `${h}:00 – ${h + 1}:00: ${count} videos produced`,
                                      sub: `Rate: ${(count).toFixed(1)} vids/hour`,
                                      x: rect.left + rect.width / 2,
                                      y: rect.top - 10,
                                    });
                                  }}
                                  onMouseLeave={() => setHoveredInfo(null)}
                                  style={{
                                    position: "absolute",
                                    left: `${(h / 24) * 100 + 0.2}%`,
                                    width: `${100 / 24 - 0.4}%`,
                                    bottom: 0,
                                    height: barHeight,
                                    background: "rgba(74,222,128,0.4)",
                                    borderRadius: "2px 2px 0 0",
                                    cursor: "help",
                                  }}
                                />
                              );
                            })}

                            {/* Hourly Rate Sparkline Wave */}
                            <svg
                              viewBox="0 0 100 36"
                              preserveAspectRatio="none"
                              style={{
                                position: "absolute",
                                inset: 0,
                                width: "100%",
                                height: "100%",
                                pointerEvents: "none",
                              }}
                            >
                              <polyline
                                points={d.hourlyLineSvg}
                                fill="none"
                                stroke="rgba(74,222,128,0.85)"
                                strokeWidth="1"
                                vectorEffect="non-scaling-stroke"
                              />
                            </svg>

                            {/* Small Micro Event Dots */}
                            {d.events.map((e, j) => (
                              <span
                                key={j}
                                onMouseEnter={(ev) => {
                                  const rect = (ev.target as HTMLElement).getBoundingClientRect();
                                  setHoveredInfo({
                                    text: `${EVENT[e.type].label} at ${e.time}`,
                                    sub: e.title,
                                    x: rect.left,
                                    y: rect.top - 10,
                                  });
                                }}
                                onMouseLeave={() => setHoveredInfo(null)}
                                style={{
                                  position: "absolute",
                                  left: `${(e.hour / 24) * 100}%`,
                                  top: "50%",
                                  width: 4,
                                  height: 4,
                                  marginLeft: -2,
                                  marginTop: -2,
                                  borderRadius: "50%",
                                  background: EVENT[e.type].color,
                                  boxShadow: `0 0 4px ${EVENT[e.type].color}`,
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

                          {/* 8h Shift & Quota Badges */}
                          <div style={{ width: 110, textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: is8hComplete ? "rgba(74,222,128,0.15)" : "rgba(240,166,66,0.15)",
                                color: is8hComplete ? "#4ade80" : "#f0a642",
                                border: is8hComplete ? "1px solid rgba(74,222,128,0.3)" : "1px solid rgba(240,166,66,0.3)",
                              }}
                            >
                              {is8hComplete ? "8h Shift ✓" : `${d.grossShiftHours.toFixed(1)}h / 8h`}
                            </span>
                            <span style={{ fontSize: 9, color: "var(--v2-text-3, #666)" }}>
                              {d.jobsCount >= DAILY_VIDEO_TARGET ? "40/40 Quota Hit" : `${d.jobsCount}/${DAILY_VIDEO_TARGET} vids`}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Table Shift Ledger View */
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", color: "var(--v2-text-3, #666)", textAlign: "left" }}>
                          <th style={{ padding: "8px 12px" }}>Date</th>
                          <th style={{ padding: "8px 12px" }}>Shift Window</th>
                          <th style={{ padding: "8px 12px" }}>Gross Hours</th>
                          <th style={{ padding: "8px 12px" }}>Pause / Lunch</th>
                          <th style={{ padding: "8px 12px" }}>8h Compliance</th>
                          <th style={{ padding: "8px 12px" }}>Videos Done</th>
                          <th style={{ padding: "8px 12px" }}>Avg Speed</th>
                          <th style={{ padding: "8px 12px", textAlign: "right" }}>Daily Quota</th>
                        </tr>
                      </thead>
                      <tbody>
                        {va.days.map((d) => {
                          const is8h = d.grossShiftHours >= 7.5;
                          return (
                            <tr key={d.dateKey} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                              <td style={{ padding: "10px 12px", fontWeight: 700, color: d.dateKey === todayKey ? "var(--v2-accent, #4ade80)" : "#fff" }}>
                                {d.dateLabel}
                              </td>
                              <td style={{ padding: "10px 12px", color: "var(--v2-text-2, #bbb)" }}>
                                {d.startHour != null && d.endHour != null ? `${fmtH(d.startHour)} – ${fmtH(d.endHour)}` : "—"}
                              </td>
                              <td style={{ padding: "10px 12px", fontWeight: 600, color: is8h ? "#4ade80" : "#fff" }}>
                                {d.grossShiftHours > 0 ? `${d.grossShiftHours.toFixed(1)}h` : "—"}
                              </td>
                              <td style={{ padding: "10px 12px", color: d.pauseHours > 0.5 ? "#f0a642" : "var(--v2-text-3, #666)" }}>
                                {d.pauseHours > 0.5 ? `${d.pauseHours.toFixed(1)}h pause` : "Continuous"}
                              </td>
                              <td style={{ padding: "10px 12px" }}>
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    padding: "2px 6px",
                                    borderRadius: 4,
                                    background: is8h ? "rgba(74,222,128,0.2)" : "rgba(240,166,66,0.15)",
                                    color: is8h ? "#4ade80" : "#f0a642",
                                  }}
                                >
                                  {is8h ? "FULL 8H SHIFT" : "SHORT SHIFT"}
                                </span>
                              </td>
                              <td style={{ padding: "10px 12px", fontWeight: 700, color: d.jobsCount >= DAILY_VIDEO_TARGET ? "#4ade80" : "#fff" }}>
                                {d.jobsCount} videos
                              </td>
                              <td style={{ padding: "10px 12px", color: "var(--v2-text-2, #bbb)" }}>
                                {d.avgMinPerVideo > 0 ? `~${d.avgMinPerVideo.toFixed(1)}m / vid` : "—"}
                              </td>
                              <td style={{ padding: "10px 12px", textAlign: "right" }}>
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    padding: "2px 8px",
                                    borderRadius: 4,
                                    background: d.jobsCount >= DAILY_VIDEO_TARGET ? "rgba(74,222,128,0.2)" : "rgba(255,255,255,0.05)",
                                    color: d.jobsCount >= DAILY_VIDEO_TARGET ? "#4ade80" : "var(--v2-text-2, #bbb)",
                                  }}
                                >
                                  {d.jobsCount >= DAILY_VIDEO_TARGET ? "40/40 Hit" : `${d.jobsCount}/${DAILY_VIDEO_TARGET}`}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
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
      {hoveredInfo && (
        <div
          style={{
            position: "fixed",
            left: hoveredInfo.x,
            top: hoveredInfo.y,
            transform: "translate(-50%, -100%)",
            background: "#0f172a",
            color: "#fff",
            border: "1px solid rgba(74,222,128,0.4)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 11,
            boxShadow: "0 10px 30px rgba(0,0,0,0.8)",
            pointerEvents: "none",
            zIndex: 9999,
            whiteSpace: "nowrap",
          }}
        >
          <div style={{ fontWeight: 800, color: "var(--v2-accent, #4ade80)" }}>
            {hoveredInfo.text}
          </div>
          {hoveredInfo.sub && (
            <div style={{ color: "#cbd5e1", marginTop: 3, fontSize: 10 }}>
              {hoveredInfo.sub}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
