"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CfData, ScreenId } from "../_lib/types";

interface NavDef {
  id: ScreenId;
  code: string;
  label: string;
  badge?: { count: number; tone: "amber" | "red" };
}

interface ScreenMetaEntry {
  code: string;
  title: string;
  sub: string;
}

const SCREEN_META: Record<ScreenId, ScreenMetaEntry> = {
  dashboard: {
    code: "S0 · OPERATIONS",
    title: "Operations Dashboard",
    sub: "Is the machine running?",
  },
  pipeline: {
    code: "S1 · PIPELINE",
    title: "Pipeline Monitor",
    sub: "Live flow across seven layers",
  },
  sources: {
    code: "S2 · INGEST",
    title: "Source Library",
    sub: "Incoming content & dedup",
  },
  source: {
    code: "S2.1 · INGEST",
    title: "Source Detail",
    sub: "Every clip mined from this source",
  },
  pool: {
    code: "S3 · CONTENT",
    title: "Clip Pool",
    sub: "All raw clips · classify · pool",
  },
  inspector: { code: "S4 · CONTENT", title: "Clip Inspector", sub: "" },
  studio: { code: "S5 · CONTENT", title: "Caption & Reframe Studio", sub: "" },
  distribution: {
    code: "S6 · LEDGER",
    title: "Distribution Board",
    sub: "What ran where, when",
  },
  accounts: {
    code: "S7 · FLEET",
    title: "Account Manager",
    sub: "Accounts & isolation identity",
  },
  presets: {
    code: "S12 · BRAND",
    title: "Caption & Style Presets",
    sub: "Per-persona subtitle design · preset library",
  },
  qc: {
    code: "S8 · QUALITY",
    title: "QC & Review Queue",
    sub: "Flagged clips · keyboard triage",
  },
  errors: {
    code: "S9 · RELIABILITY",
    title: "Error Console / DLQ",
    sub: "Failures · retries · dead-letter",
  },
  config: {
    code: "S10 · CONTROL",
    title: "Configuration",
    sub: "All toggles & thresholds",
  },
  analytics: {
    code: "S11 · INSIGHT",
    title: "Analytics",
    sub: "Views & performance",
  },
};

const NAV_ORDER: ScreenId[] = [
  "dashboard",
  "pipeline",
  "sources",
  "pool",
  "distribution",
  "accounts",
  "presets",
  "qc",
  "errors",
  "config",
  "analytics",
];

const NAV_CODE: Record<ScreenId, string> = {
  dashboard: "DASH",
  pipeline: "PIPE",
  sources: "SRC",
  source: "SRC+",
  pool: "POOL",
  inspector: "INSP",
  studio: "STDO",
  distribution: "DIST",
  accounts: "ACCT",
  presets: "CAPS",
  qc: "QC",
  errors: "ERR",
  config: "CFG",
  analytics: "ANLY",
};

interface Props {
  screen: ScreenId;
  setScreen: (s: ScreenId) => void;
  persona: string;
  cyclePersona: () => void;
  data: CfData;
  /** Open a specific clip in the Inspector. Palette results depend on this. */
  onSelectClip: (fullId: string) => void;
  /** Open a specific source in Source Detail. */
  onSelectSource: (fullId: string) => void;
  children: React.ReactNode;
}

/** Live host snapshot from /api/v1/clip-forge/system. */
interface SystemSnapshot {
  cpu_pct: number;
  mem_pct: number;
  disk_gb_free: number;
  queues: Record<string, { waiting: number; active: number }>;
}

export function ClipForgeShell({
  screen,
  setScreen,
  persona,
  cyclePersona,
  data,
  onSelectClip,
  onSelectSource,
  children,
}: Props) {
  const [clock, setClock] = useState(() =>
    new Date().toISOString().slice(11, 19),
  );
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [cmdkQuery, setCmdkQuery] = useState("");
  // Real host + queue stats. The header used to render `workerUp = 8` and
  // `disk = 78` as literals, so it reported a healthy 8/8 fleet and 78% disk
  // on a box that could have been on fire. Null until the first fetch lands —
  // the chips render "—" rather than inventing a number.
  const [system, setSystem] = useState<SystemSnapshot | null>(null);
  const [systemError, setSystemError] = useState(false);

  useEffect(() => {
    const ck = setInterval(
      () => setClock(new Date().toISOString().slice(11, 19)),
      1000,
    );
    return () => clearInterval(ck);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const res = await fetch("/api/v1/clip-forge/system", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as SystemSnapshot;
        if (!cancelled) {
          setSystem(json);
          setSystemError(false);
        }
      } catch {
        if (!cancelled) setSystemError(true);
      }
    }
    pull();
    const id = setInterval(pull, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setCmdkOpen((v) => !v);
        setCmdkQuery("");
      } else if (e.key === "Escape" && cmdkOpen) {
        setCmdkOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cmdkOpen]);

  const dlqCount = data.errors.filter((e) => e.dlq).length;
  const qcCount = data.dists.filter((d) => d.status === "qc_flag").length;
  // In-flight work across the four Clip Forge queues — the closest honest
  // answer to "is the machine doing anything right now".
  const queueEntries = Object.values(system?.queues ?? {});
  const active = queueEntries.reduce((s, q) => s + (q.active ?? 0), 0);
  const waiting = queueEntries.reduce((s, q) => s + (q.waiting ?? 0), 0);

  const navItems: NavDef[] = NAV_ORDER.map((id) => {
    const it: NavDef = { id, code: NAV_CODE[id], label: SCREEN_META[id].title };
    if (id === "errors" && dlqCount)
      it.badge = { count: dlqCount, tone: "red" };
    if (id === "qc" && qcCount) it.badge = { count: qcCount, tone: "amber" };
    return it;
  });

  const meta = SCREEN_META[screen];

  const cmdkResults = useMemo(() => {
    const q = cmdkQuery.toLowerCase().trim();
    const pool: Array<{
      kind: string;
      id: string;
      title: string;
      go: () => void;
    }> = [
      // Each result opens the entity it names. These used to only switch
      // screen, so searching for a specific clip and pressing enter showed
      // whichever clip happened to be active already.
      ...data.clips.map((c) => ({
        kind: "CLIP",
        id: c.id,
        title: c.reason.slice(0, 46),
        go: () => onSelectClip(c.fullId),
      })),
      ...data.accounts.map((a) => ({
        kind: "ACCT",
        id: a.id,
        title: a.handle + " · " + a.platform,
        go: () => setScreen("accounts"),
      })),
      ...data.sources.map((s) => ({
        kind: "SRC",
        id: s.id,
        title: s.title + " · " + s.persona,
        go: () => onSelectSource(s.fullId),
      })),
    ];
    const filtered = q
      ? pool.filter(
          (r) =>
            r.id.toLowerCase().includes(q) ||
            r.title.toLowerCase().includes(q) ||
            r.kind.toLowerCase().includes(q),
        )
      : pool;
    return filtered.slice(0, 8);
  }, [cmdkQuery, data, setScreen, onSelectClip, onSelectSource]);

  const cmdkInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (cmdkOpen) cmdkInputRef.current?.focus();
  }, [cmdkOpen]);

  const isPoolActive =
    screen === "pool" || screen === "inspector" || screen === "studio";
  const isSrcActive = screen === "sources" || screen === "source";

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <header
        style={{
          height: 46,
          flex: "0 0 46px",
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid #1d232a",
          background: "#0c0f13",
          position: "relative",
          zIndex: 30,
        }}
      >
        <div
          style={{
            width: 160,
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "0 14px",
            height: "100%",
            borderRight: "1px solid #1d232a",
          }}
        >
          <div
            style={{
              width: 13,
              height: 13,
              background: "#dfe3e8",
              transform: "rotate(45deg)",
            }}
          />
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontWeight: 600,
              letterSpacing: ".16em",
              fontSize: 12.5,
            }}
          >
            CLIP&nbsp;FORGE
          </span>
        </div>
        <button
          onClick={cyclePersona}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: "100%",
            padding: "0 14px",
            border: 0,
            borderRight: "1px solid #1d232a",
            background: "transparent",
            color: "#dfe3e8",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 12,
          }}
        >
          <span
            style={{
              fontSize: 9,
              letterSpacing: ".14em",
              color: "#59616a",
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            PERSONA
          </span>
          <span style={{ fontWeight: 500 }}>{persona}</span>
          <span style={{ color: "#59616a", fontSize: 10 }}>▾</span>
        </button>
        <button
          onClick={() => {
            setCmdkOpen(true);
            setCmdkQuery("");
          }}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 30,
            margin: "0 14px",
            padding: "0 12px",
            border: "1px solid #232a32",
            borderRadius: 5,
            background: "#10141a",
            color: "#6b727b",
            cursor: "text",
            fontFamily: "inherit",
            fontSize: 12,
            textAlign: "left",
          }}
        >
          <span style={{ fontSize: 12 }}>⌕</span>
          <span style={{ flex: 1 }}>
            Search clips, accounts, sources by ID or name…
          </span>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              border: "1px solid #2b333c",
              borderRadius: 3,
              padding: "1px 5px",
              color: "#828a93",
            }}
          >
            ⌘K
          </span>
        </button>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            height: "100%",
            padding: "0 6px",
            borderLeft: "1px solid #1d232a",
          }}
        >
          {[
            {
              label: "QUEUE",
              value: systemError
                ? "err"
                : system
                  ? `${active}▶ ${waiting}⋯`
                  : "—",
              color: systemError
                ? "#cf7468"
                : active > 0
                  ? "#b388c9"
                  : "#57a578",
            },
            {
              label: "DISK FREE",
              value:
                systemError || !system
                  ? "—"
                  : system.disk_gb_free < 0
                    ? "n/a"
                    : `${system.disk_gb_free}G`,
              color:
                system && system.disk_gb_free >= 0 && system.disk_gb_free < 20
                  ? "#cf7468"
                  : "#b388c9",
            },
            {
              label: "DLQ",
              value: String(dlqCount),
              color: dlqCount > 0 ? "#cf7468" : "#57a578",
            },
          ].map((h) => (
            <div
              key={h.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 11px",
                height: "100%",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: h.color,
                  boxShadow: `0 0 7px ${h.color}`,
                }}
              />
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  lineHeight: 1.1,
                }}
              >
                <span
                  style={{
                    fontSize: 8.5,
                    letterSpacing: ".12em",
                    color: "#59616a",
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
                  {h.label}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: "#cfd4da",
                  }}
                >
                  {h.value}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            lineHeight: 1.1,
            padding: "0 16px 0 12px",
            borderLeft: "1px solid #1d232a",
            height: "100%",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              color: "#cfd4da",
            }}
          >
            {clock}
          </span>
          <span
            style={{
              fontSize: 8.5,
              letterSpacing: ".1em",
              color: "#59616a",
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            UTC · LIVE
          </span>
        </div>
      </header>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Nav rail */}
        <nav
          style={{
            width: 64,
            flex: "0 0 64px",
            background: "#0c0f13",
            borderRight: "1px solid #1d232a",
            display: "flex",
            flexDirection: "column",
            padding: "8px 0",
            gap: 2,
            overflowY: "auto",
          }}
        >
          {navItems.map((n) => {
            const on =
              screen === n.id ||
              (n.id === "pool" && isPoolActive) ||
              (n.id === "sources" && isSrcActive);
            return (
              <button
                key={n.id}
                onClick={() => setScreen(n.id)}
                title={n.label}
                style={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 3,
                  height: 52,
                  margin: "0 6px",
                  border: 0,
                  borderRadius: 6,
                  background: on ? "#1a212a" : "transparent",
                  color: on ? "#eef1f4" : "#7d8893",
                  cursor: "pointer",
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    left: -6,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 2,
                    height: on ? 22 : 0,
                    background: on ? "#dfe3e8" : "transparent",
                    borderRadius: 2,
                  }}
                />
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: ".04em",
                    fontWeight: 600,
                  }}
                >
                  {n.code}
                </span>
                {n.badge && (
                  <span
                    style={{
                      fontSize: 8,
                      background:
                        n.badge.tone === "red"
                          ? "rgba(207,116,104,.18)"
                          : "rgba(179,136,201,.18)",
                      color: n.badge.tone === "red" ? "#cf7468" : "#b388c9",
                      borderRadius: 8,
                      padding: "0 4px",
                      minWidth: 14,
                      textAlign: "center",
                    }}
                  >
                    {n.badge.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Main */}
        <main
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: 38,
              flex: "0 0 38px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "0 16px",
              borderBottom: "1px solid #1d232a",
              background: "#0b0e12",
            }}
          >
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: "#59616a",
                letterSpacing: ".1em",
              }}
            >
              {meta.code}
            </span>
            <span style={{ color: "#2b333c" }}>/</span>
            <span
              style={{
                fontWeight: 600,
                fontSize: 13.5,
                letterSpacing: ".01em",
              }}
            >
              {meta.title}
            </span>
            <span style={{ fontSize: 11, color: "#6b727b" }}>{meta.sub}</span>
            <span style={{ flex: 1 }} />
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: "#59616a",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#57a578",
                  animation: "cf-blink 1.6s infinite",
                }}
              />
              {/* There is no SSE in Clip Forge. The console re-fetches
                  /api/v1/clip-forge/console on a 4s interval; say so. */}
              POLLING&nbsp;·&nbsp;4s
            </span>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            {children}
          </div>
        </main>
      </div>

      {/* Command palette */}
      {cmdkOpen && (
        <div
          onClick={() => setCmdkOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(4,6,8,.62)",
            backdropFilter: "blur(2px)",
            zIndex: 60,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "13vh",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 560,
              maxWidth: "92vw",
              background: "#0e1217",
              border: "1px solid #2b333c",
              borderRadius: 10,
              boxShadow: "0 24px 70px rgba(0,0,0,.6)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "13px 16px",
                borderBottom: "1px solid #1d232a",
              }}
            >
              <span style={{ fontSize: 15, color: "#6b727b" }}>⌕</span>
              <input
                ref={cmdkInputRef}
                value={cmdkQuery}
                onChange={(e) => setCmdkQuery(e.target.value)}
                placeholder="Jump to clip, account, source — by ID or name…"
                style={{
                  flex: 1,
                  background: "transparent",
                  border: 0,
                  outline: 0,
                  color: "#eef1f4",
                  fontFamily: "inherit",
                  fontSize: 15,
                }}
              />
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  border: "1px solid #2b333c",
                  borderRadius: 3,
                  padding: "2px 6px",
                  color: "#6b727b",
                }}
              >
                ESC
              </span>
            </div>
            <div style={{ maxHeight: 340, overflow: "auto", padding: 6 }}>
              {cmdkResults.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    r.go();
                    setCmdkOpen(false);
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "9px 11px",
                    border: 0,
                    borderRadius: 6,
                    background: "transparent",
                    color: "#dfe3e8",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                  }}
                >
                  <span
                    style={{
                      fontSize: 8.5,
                      letterSpacing: ".1em",
                      color: "#7d8893",
                      fontFamily: "'IBM Plex Mono', monospace",
                      border: "1px solid #2b333c",
                      borderRadius: 3,
                      padding: "2px 6px",
                      flex: "0 0 auto",
                    }}
                  >
                    {r.kind}
                  </span>
                  <span style={{ flex: 1, fontSize: 13 }}>{r.title}</span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10.5,
                      color: "#59616a",
                    }}
                  >
                    {r.id}
                  </span>
                </button>
              ))}
              {cmdkResults.length === 0 && (
                <div
                  style={{
                    padding: 24,
                    textAlign: "center",
                    color: "#59616a",
                    fontSize: 12,
                  }}
                >
                  No matches for &quot;{cmdkQuery}&quot;
                </div>
              )}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "8px 14px",
                borderTop: "1px solid #1d232a",
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 9.5,
                color: "#59616a",
              }}
            >
              {/* Only click-to-open and Escape are implemented; the arrow-key
                  and enter hints that used to sit here were decoration. */}
              <span>click to open</span>
              <span>esc close</span>
              <span style={{ flex: 1 }} />
              <span>{cmdkResults.length} results</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
