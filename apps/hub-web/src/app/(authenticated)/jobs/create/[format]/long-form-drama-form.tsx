"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GlassCard } from "../../../_components/glass-card";

interface Channel {
  id: string;
  name: string;
  clip_library_id: string | null;
}

interface ClipLibrary {
  id: string;
  name: string;
}

interface Props {
  channels: Channel[];
  libraries: ClipLibrary[];
}

interface CreatedJob {
  id: string;
  title: string;
  status: string;
  status_updated_at: string | null;
}

const STORAGE_KEY = "long-form-drama-form-settings-v2";

type RenderMode =
  | "KEN_BURNS"
  | "SLOW_VIDEO"
  | "DIRECT_T2V"
  | "STOCK_CHAIN_FULL"
  | "STOCK_CHAIN_HOOKED";

const TEMPLATES: { value: RenderMode; label: string; description: string }[] = [
  {
    value: "STOCK_CHAIN_HOOKED",
    label: "Stock chain + hook (recommended)",
    description:
      "First ~2 min uses fresh story-matched VEO clips; rest randomly pulls from the channel's clip library. Scales to 1h with low VEO cost.",
  },
  {
    value: "STOCK_CHAIN_FULL",
    label: "Stock chain only",
    description:
      "No hook. Whole video pulled from the clip library. Target ~1m30s. Fastest possible per video — zero new VEO calls.",
  },
  {
    value: "DIRECT_T2V",
    label: "Direct T2V (legacy)",
    description:
      "Per-scene VEO t2v. Story-matched throughout. Doesn't scale past ~10 min.",
  },
  {
    value: "SLOW_VIDEO",
    label: "Slow video (legacy)",
    description: "VEO i2v from generated images. Slow + expensive.",
  },
  {
    value: "KEN_BURNS",
    label: "Ken Burns (legacy)",
    description: "Animated stills, no VEO. Cheapest but static-looking.",
  },
];

function loadSettings() {
  if (typeof window === "undefined") {
    return {
      template: "STOCK_CHAIN_HOOKED" as RenderMode,
      autoScript: true,
      musicEnabled: true,
      targetMinutes: 60,
    };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        template: (p.template as RenderMode) ?? "STOCK_CHAIN_HOOKED",
        autoScript: p.autoScript !== false,
        musicEnabled: p.musicEnabled !== false,
        targetMinutes:
          typeof p.targetMinutes === "number" ? p.targetMinutes : 60,
      };
    }
  } catch {}
  return {
    template: "STOCK_CHAIN_HOOKED" as RenderMode,
    autoScript: true,
    musicEnabled: true,
    targetMinutes: 60,
  };
}

function persist(patch: Record<string, unknown>) {
  try {
    const cur = loadSettings();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch {}
}

function wordsForMinutes(minutes: number): number {
  // 130 wpm is the average drama TTS pacing in the existing pipeline.
  return Math.round(minutes * 130);
}

function timeAgoShort(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: 0,
        color: "#e5e2e1",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: 42,
          height: 22,
          background: checked
            ? "rgba(var(--v2-accent-rgb),0.45)"
            : "rgba(255,255,255,0.12)",
          borderRadius: 22,
          position: "relative",
          transition: "background 120ms",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 23 : 3,
            width: 16,
            height: 16,
            background: "#fff",
            borderRadius: "50%",
            transition: "left 120ms",
          }}
        />
      </span>
      {label}
    </button>
  );
}

export function LongFormDramaForm({ channels, libraries }: Props) {
  const router = useRouter();
  const saved = loadSettings();

  const [template, setTemplate] = useState<RenderMode>(saved.template);
  const [autoScript, setAutoScript] = useState<boolean>(saved.autoScript);
  const [topicsText, setTopicsText] = useState<string>("");
  const [pastedScripts, setPastedScripts] = useState<string>("");
  const [channelId, setChannelId] = useState<string>(channels[0]?.id ?? "");
  const [musicEnabled, setMusicEnabled] = useState<boolean>(saved.musicEnabled);
  const [musicMode, setMusicMode] = useState<"generate" | "library">(
    "generate",
  );
  const [musicVolumeDb, setMusicVolumeDb] = useState<number>(-28);

  // Reference scripts (loaded from the channel's library)
  const [useReference, setUseReference] = useState<boolean>(true);
  const [referenceId, setReferenceId] = useState<string>(""); // "" = auto-cycle
  const [referenceOptions, setReferenceOptions] = useState<
    {
      id: string;
      name: string;
      word_count: number;
      last_used_at: string | null;
      preview: string;
    }[]
  >([]);
  const [refPreviewId, setRefPreviewId] = useState<string | null>(null);
  const [refPreviewContent, setRefPreviewContent] = useState<string | null>(
    null,
  );
  const [targetMinutes, setTargetMinutes] = useState<number>(
    saved.targetMinutes,
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdBatch, setCreatedBatch] = useState<CreatedJob[]>([]);
  const [batchPolling, setBatchPolling] = useState(false);

  const channel = channels.find((c) => c.id === channelId);
  // Library resolution order:
  //   1. The channel's pinned library (set on the channels row).
  //   2. Any library whose name contains "Black Drama" (the seed default).
  //   3. The first library in the list.
  // This means a brand-new channel doesn't accidentally point at the
  // Star Wars clip-pipeline library just because it sorts first.
  const fallbackLibrary =
    libraries.find((l) => /black\s*drama/i.test(l.name)) ?? libraries[0];
  const channelLibraryId =
    channel?.clip_library_id ?? fallbackLibrary?.id ?? null;
  const channelLibraryName =
    libraries.find((l) => l.id === channelLibraryId)?.name ?? null;
  const targetWords = wordsForMinutes(targetMinutes);

  // Whenever the resolved library changes, refetch its reference list
  // so the dropdown matches what's actually available.
  useEffect(() => {
    if (!channelLibraryId) {
      setReferenceOptions([]);
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `/api/drama/clip-libraries/${channelLibraryId}/reference-scripts`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          scripts: {
            id: string;
            name: string;
            word_count: number;
            last_used_at: string | null;
            preview: string;
          }[];
        };
        setReferenceOptions(data.scripts);
      } catch {
        /* ignore */
      }
    })();
  }, [channelLibraryId]);

  const openReferencePreview = async (refId: string) => {
    if (!channelLibraryId) return;
    setRefPreviewId(refId);
    setRefPreviewContent(null);
    try {
      const res = await fetch(
        `/api/drama/clip-libraries/${channelLibraryId}/reference-scripts/${refId}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setRefPreviewContent(`Failed to load: HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { script: { content: string } };
      setRefPreviewContent(data.script.content);
    } catch (err) {
      setRefPreviewContent(err instanceof Error ? err.message : String(err));
    }
  };

  // Pull the current state of the just-created batch every 5s while
  // any of them are still in flight, so the dashboard below the form
  // stays live.
  const refreshBatch = useCallback(async () => {
    if (createdBatch.length === 0) return;
    try {
      const ids = createdBatch.map((j) => j.id).join(",");
      const res = await fetch(`/api/drama/active-jobs?ids=${ids}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as CreatedJob[];
      // Preserve creation order from createdBatch.
      const byId = new Map(data.map((j) => [j.id, j]));
      setCreatedBatch((prev) => prev.map((j) => byId.get(j.id) ?? j));
    } catch {
      /* ignore */
    }
  }, [createdBatch]);

  useEffect(() => {
    if (!batchPolling) return;
    const id = setInterval(refreshBatch, 5000);
    return () => clearInterval(id);
  }, [batchPolling, refreshBatch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let topics: string[] = [];
    let scripts: string[] = [];
    if (autoScript) {
      topics = topicsText
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (topics.length === 0) {
        setError("Add at least one topic (one per line).");
        return;
      }
    } else {
      // When auto-script is off we expect the user to have pasted one
      // or more scripts separated by --- on their own line.
      scripts = pastedScripts
        .split(/\n-{3,}\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (scripts.length === 0) {
        setError(
          "Paste at least one script (use a line of --- between scripts to split).",
        );
        return;
      }
    }

    if (!channelId) {
      setError("Pick a channel.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/formats/LONG_FORM_DRAMA/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId,
          template,
          autoScript,
          topics: autoScript ? topics : [],
          scripts: autoScript ? [] : scripts,
          targetMinutes,
          referenceScript: {
            enabled: useReference,
            referenceId: referenceId || null,
          },
          music: {
            enabled: musicEnabled,
            mode: musicMode,
            volumeDb: musicVolumeDb,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Job creation failed");
      }
      const jobs = (data.jobs as CreatedJob[]) ?? [];
      setCreatedBatch(
        jobs.map((j) => ({
          ...j,
          status_updated_at: j.status_updated_at ?? null,
        })),
      );
      setBatchPolling(true);
      persist({ template, autoScript, musicEnabled, targetMinutes });
      // Per the spec: after submit, navigate to the progress page.
      // If only one job was created, push the operator straight to the
      // detail view; otherwise the batch progress page where every
      // job in the batch is tracked at once.
      if (jobs.length === 1 && jobs[0]) {
        router.push(`/jobs/${jobs[0].id}`);
      } else if (jobs.length > 1) {
        const ids = jobs.map((j) => j.id).join(",");
        router.push(`/jobs/batch?ids=${ids}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        padding: 24,
        maxWidth: 980,
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 28, color: "var(--v2-accent)" }}
        >
          theater_comedy
        </span>
        <h1
          style={{ fontSize: 22, fontWeight: 700, color: "#e5e2e1", margin: 0 }}
        >
          Create Drama Video(s)
        </h1>
      </div>

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        {/* 1. Template / archetype */}
        <GlassCard
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#e5e2e1",
              margin: 0,
              letterSpacing: 0.5,
            }}
          >
            1. Template (archetype)
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {TEMPLATES.map((t) => {
              const active = template === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTemplate(t.value)}
                  style={{
                    textAlign: "left",
                    padding: 12,
                    background: active
                      ? "rgba(var(--v2-accent-rgb),0.12)"
                      : "rgba(255,255,255,0.03)",
                    border: active
                      ? "1px solid rgba(var(--v2-accent-rgb),0.45)"
                      : "1px solid rgba(var(--v2-accent-rgb),0.1)",
                    borderRadius: 8,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div
                    style={{ fontSize: 13, fontWeight: 700, color: "#e5e2e1" }}
                  >
                    {t.label}
                  </div>
                  <div style={{ fontSize: 12, color: "#cdc3d7" }}>
                    {t.description}
                  </div>
                </button>
              );
            })}
          </div>
        </GlassCard>

        {/* 2. Auto-script toggle + topics */}
        <GlassCard
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h2
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#e5e2e1",
                margin: 0,
                letterSpacing: 0.5,
              }}
            >
              2. Auto-script generation
            </h2>
            <Toggle
              checked={autoScript}
              onChange={setAutoScript}
              label={autoScript ? "ON" : "OFF"}
            />
          </div>
          {autoScript ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label
                style={{ fontSize: 11, color: "#cdc3d7", letterSpacing: 0.5 }}
              >
                TOPICS (one per line — one job per topic)
              </label>
              <textarea
                value={topicsText}
                onChange={(e) => setTopicsText(e.target.value)}
                rows={6}
                placeholder={
                  "Andrew finds out his wife has been cheating with a real-estate broker.\nMaya leaves her husband after twelve years and realises she's lost.\n…"
                }
                style={{
                  padding: "10px 12px",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
                  borderRadius: 6,
                  color: "#e5e2e1",
                  fontSize: 13,
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
              />
              <span style={{ fontSize: 11, color: "#cdc3d7" }}>
                {
                  topicsText.split("\n").filter((s) => s.trim().length > 0)
                    .length
                }{" "}
                topic(s) — one drama job will be queued per line.
              </span>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  paddingTop: 12,
                  borderTop: "1px solid rgba(var(--v2-accent-rgb),0.1)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <label
                    style={{
                      fontSize: 11,
                      color: "#cdc3d7",
                      letterSpacing: 0.5,
                    }}
                  >
                    USE REFERENCE SCRIPT AS STYLE GUIDE
                  </label>
                  <Toggle
                    checked={useReference}
                    onChange={setUseReference}
                    label={useReference ? "ON" : "OFF"}
                  />
                </div>
                {useReference && (
                  <>
                    {referenceOptions.length === 0 ? (
                      <span style={{ fontSize: 12, color: "#facc15" }}>
                        This library has no reference scripts. Add some on the
                        library page.
                      </span>
                    ) : (
                      <>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "repeat(auto-fill, minmax(220px, 1fr))",
                            gap: 10,
                          }}
                        >
                          {(() => {
                            // Auto-cycle: highlight the single LRU pick
                            // (oldest last_used_at, NULL first) so the user
                            // can see which one is "next up". When a
                            // specific ref is pinned, only that one is
                            // bright; the rest are in rotation but greyed.
                            const sorted = [...referenceOptions].sort(
                              (a, b) => {
                                const aT = a.last_used_at
                                  ? new Date(a.last_used_at).getTime()
                                  : 0;
                                const bT = b.last_used_at
                                  ? new Date(b.last_used_at).getTime()
                                  : 0;
                                return aT - bT;
                              },
                            );
                            const nextUp = sorted[0]?.id ?? null;
                            return referenceOptions.map((r) => {
                              const pinned = referenceId === r.id;
                              const autoNext = !referenceId && r.id === nextUp;
                              const inRotation = !referenceId;
                              const bright = pinned || autoNext;
                              return (
                                <div
                                  key={r.id}
                                  onClick={() =>
                                    setReferenceId(pinned ? "" : r.id)
                                  }
                                  style={{
                                    padding: 12,
                                    background: bright
                                      ? "rgba(74,222,128,0.08)"
                                      : inRotation
                                        ? "rgba(74,222,128,0.02)"
                                        : "rgba(255,255,255,0.03)",
                                    border: bright
                                      ? "2px solid #4ade80"
                                      : inRotation
                                        ? "1px solid rgba(74,222,128,0.3)"
                                        : "1px solid rgba(var(--v2-accent-rgb),0.1)",
                                    borderRadius: 8,
                                    cursor: "pointer",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 6,
                                    minHeight: 110,
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "flex-start",
                                      gap: 6,
                                    }}
                                  >
                                    <span
                                      style={{
                                        fontSize: 12,
                                        fontWeight: 700,
                                        color: "#e5e2e1",
                                        flex: 1,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {r.name}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openReferencePreview(r.id);
                                      }}
                                      title="Open full script"
                                      style={{
                                        padding: "2px 6px",
                                        background: "rgba(255,255,255,0.05)",
                                        border:
                                          "1px solid rgba(var(--v2-accent-rgb),0.25)",
                                        borderRadius: 4,
                                        color: "#cdc3d7",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                      }}
                                    >
                                      <span
                                        className="material-symbols-outlined"
                                        style={{ fontSize: 14 }}
                                      >
                                        open_in_new
                                      </span>
                                    </button>
                                  </div>
                                  <span
                                    style={{ fontSize: 10, color: "#cdc3d7" }}
                                  >
                                    {r.word_count.toLocaleString()} words ·{" "}
                                    {r.last_used_at
                                      ? `used ${timeAgoShort(r.last_used_at)}`
                                      : "never used"}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 10,
                                      color: "rgba(205,195,215,0.7)",
                                      overflow: "hidden",
                                      display: "-webkit-box",
                                      WebkitLineClamp: 2,
                                      WebkitBoxOrient: "vertical",
                                    }}
                                  >
                                    {r.preview}
                                  </span>
                                  {bright && (
                                    <span
                                      style={{
                                        fontSize: 9,
                                        fontWeight: 700,
                                        letterSpacing: 0.7,
                                        color: "#4ade80",
                                        marginTop: "auto",
                                      }}
                                    >
                                      {pinned
                                        ? "✓ PINNED FOR THIS BATCH"
                                        : "→ NEXT UP (AUTO)"}
                                    </span>
                                  )}
                                </div>
                              );
                            });
                          })()}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 12,
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setReferenceId("")}
                            disabled={!referenceId}
                            style={{
                              padding: "6px 12px",
                              background: !referenceId
                                ? "rgba(74,222,128,0.15)"
                                : "rgba(255,255,255,0.03)",
                              border: !referenceId
                                ? "1px solid #4ade80"
                                : "1px solid rgba(var(--v2-accent-rgb),0.2)",
                              borderRadius: 6,
                              color: "#e5e2e1",
                              fontSize: 11,
                              fontWeight: 600,
                              letterSpacing: 0.5,
                              cursor: !referenceId ? "default" : "pointer",
                            }}
                          >
                            ◇ AUTO-CYCLE
                          </button>
                          <span style={{ fontSize: 11, color: "#cdc3d7" }}>
                            {referenceId
                              ? "Pinned reference will be used for every job in this batch."
                              : `Auto-rotate across ${referenceOptions.length} references — each job picks the least-recently-used (highlighted green).`}
                          </span>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label
                style={{ fontSize: 11, color: "#cdc3d7", letterSpacing: 0.5 }}
              >
                PASTE SCRIPTS (separate multiple with a line of ---)
              </label>
              <textarea
                value={pastedScripts}
                onChange={(e) => setPastedScripts(e.target.value)}
                rows={10}
                style={{
                  padding: "10px 12px",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
                  borderRadius: 6,
                  color: "#e5e2e1",
                  fontSize: 13,
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
              />
            </div>
          )}
        </GlassCard>

        {/* 3. Channel */}
        <GlassCard
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#e5e2e1",
              margin: 0,
              letterSpacing: 0.5,
            }}
          >
            3. Channel
          </h2>
          <select
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            style={{
              padding: "8px 10px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
              borderRadius: 6,
              color: "#e5e2e1",
              fontSize: 14,
              maxWidth: 360,
            }}
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.clip_library_id ? "" : "  (no library assigned)"}
              </option>
            ))}
          </select>
        </GlassCard>

        {/* 4. Clip library link */}
        <GlassCard
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#e5e2e1",
              margin: 0,
              letterSpacing: 0.5,
            }}
          >
            4. Clip library
          </h2>
          <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
            Each channel has its own clip library — pre-generated stock clips,
            character description, the script-writer prompt, and music settings
            all live there. Tweak any of them on the library page.
          </p>
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {channelLibraryName ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
                  borderRadius: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    color: "#cdc3d7",
                    letterSpacing: 0.5,
                    textTransform: "uppercase",
                  }}
                >
                  Selected
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#e5e2e1",
                  }}
                >
                  {channelLibraryName}
                </span>
              </div>
            ) : null}
            {channelLibraryId ? (
              <Link
                href={`/jobs/create/long-form-drama/clip-library/${channelLibraryId}`}
                style={{
                  padding: "10px 18px",
                  background: "rgba(var(--v2-accent-rgb),0.18)",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.45)",
                  borderRadius: 6,
                  color: "#e5e2e1",
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: 0.5,
                  textDecoration: "none",
                }}
              >
                OPEN CLIP LIBRARY
              </Link>
            ) : (
              <span style={{ fontSize: 12, color: "#facc15" }}>
                No library set for this channel.
              </span>
            )}
            <Link
              href={`/jobs/create/long-form-drama/clip-library`}
              style={{
                padding: "10px 18px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
                borderRadius: 6,
                color: "#e5e2e1",
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: 0.5,
                textDecoration: "none",
              }}
            >
              ALL LIBRARIES
            </Link>
          </div>
        </GlassCard>

        {/* 5. Target length */}
        <GlassCard
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#e5e2e1",
              margin: 0,
              letterSpacing: 0.5,
            }}
          >
            5. Target length
          </h2>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label
                style={{ fontSize: 11, color: "#cdc3d7", letterSpacing: 0.5 }}
              >
                MINUTES
              </label>
              <input
                type="number"
                min={1}
                max={180}
                value={targetMinutes}
                onChange={(e) =>
                  setTargetMinutes(
                    Math.max(1, Math.min(180, Number(e.target.value) || 0)),
                  )
                }
                style={{
                  width: 100,
                  padding: "8px 10px",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
                  borderRadius: 6,
                  color: "#e5e2e1",
                  fontSize: 14,
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span
                style={{ fontSize: 11, color: "#cdc3d7", letterSpacing: 0.5 }}
              >
                ≈ {targetWords.toLocaleString()} WORDS
              </span>
              <span style={{ fontSize: 11, color: "#cdc3d7" }}>
                at 130 wpm (drama TTS pacing)
              </span>
            </div>
          </div>
        </GlassCard>

        {/* 6. Music */}
        <GlassCard
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h2
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#e5e2e1",
                margin: 0,
                letterSpacing: 0.5,
              }}
            >
              6. Music
            </h2>
            <Toggle
              checked={musicEnabled}
              onChange={setMusicEnabled}
              label={musicEnabled ? "ON" : "OFF"}
            />
          </div>
          {musicEnabled && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label
                  style={{ fontSize: 11, color: "#cdc3d7", letterSpacing: 0.5 }}
                >
                  MODE
                </label>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  {[
                    {
                      v: "generate" as const,
                      label: "Generate new (Suno)",
                    },
                    {
                      v: "library" as const,
                      label: "Reuse from library",
                    },
                  ].map((opt) => {
                    const active = musicMode === opt.v;
                    return (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => setMusicMode(opt.v)}
                        style={{
                          padding: "8px 14px",
                          background: active
                            ? "rgba(var(--v2-accent-rgb),0.18)"
                            : "rgba(255,255,255,0.03)",
                          border: active
                            ? "1px solid rgba(var(--v2-accent-rgb),0.45)"
                            : "1px solid rgba(var(--v2-accent-rgb),0.1)",
                          borderRadius: 6,
                          color: "#e5e2e1",
                          fontSize: 12,
                          fontWeight: 600,
                          letterSpacing: 0.5,
                          cursor: "pointer",
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                  <Link
                    href="/jobs/create/long-form-drama/music-library"
                    target="_blank"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "8px 14px",
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
                      borderRadius: 6,
                      color: "#e5e2e1",
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: 0.5,
                      textDecoration: "none",
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 14 }}
                    >
                      library_music
                    </span>
                    VIEW MUSIC LIBRARY
                  </Link>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label
                  style={{ fontSize: 11, color: "#cdc3d7", letterSpacing: 0.5 }}
                >
                  VOLUME (dB) — {musicVolumeDb}
                </label>
                <input
                  type="range"
                  min={-60}
                  max={0}
                  value={musicVolumeDb}
                  onChange={(e) => setMusicVolumeDb(Number(e.target.value))}
                  style={{ width: 280 }}
                />
                <span style={{ fontSize: 11, color: "#cdc3d7" }}>
                  −28 dB is the typical drama-bed level. Lower = quieter.
                </span>
              </div>
            </div>
          )}
        </GlassCard>

        {error && (
          <div
            style={{
              padding: 12,
              background: "rgba(248,113,113,0.12)",
              border: "1px solid rgba(248,113,113,0.35)",
              borderRadius: 6,
              color: "#f87171",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: "12px 24px",
            background: "rgba(var(--v2-accent-rgb),0.25)",
            border: "1px solid rgba(var(--v2-accent-rgb),0.55)",
            borderRadius: 8,
            color: "#e5e2e1",
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: 0.5,
            cursor: submitting ? "wait" : "pointer",
          }}
        >
          {submitting ? "CREATING…" : "CREATE DRAMA VIDEO(S)"}
        </button>
      </form>

      {refPreviewId && (
        <div
          onClick={() => {
            setRefPreviewId(null);
            setRefPreviewContent(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#1a1a1a",
              border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
              borderRadius: 12,
              padding: 20,
              maxWidth: 920,
              width: "100%",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: "#e5e2e1" }}>
                {referenceOptions.find((r) => r.id === refPreviewId)?.name ??
                  "Reference"}
              </span>
              <button
                type="button"
                onClick={() => {
                  setRefPreviewId(null);
                  setRefPreviewContent(null);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#cdc3d7",
                  cursor: "pointer",
                  fontSize: 18,
                  padding: 0,
                }}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                background: "rgba(0,0,0,0.3)",
                borderRadius: 6,
                padding: 16,
                fontSize: 13,
                color: "#cdc3d7",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {refPreviewContent ?? "Loading…"}
            </div>
          </div>
        </div>
      )}

      {/* Post-create batch dashboard */}
      {createdBatch.length > 0 && (
        <GlassCard
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#e5e2e1",
              margin: 0,
              letterSpacing: 0.5,
            }}
          >
            Just created ({createdBatch.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {createdBatch.map((j) => (
              <Link
                key={j.id}
                href={`/jobs/${j.id}`}
                style={{
                  textDecoration: "none",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: 12,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
                  borderRadius: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    color: "#e5e2e1",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                  }}
                >
                  {j.title}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--v2-accent)",
                    background: "rgba(var(--v2-accent-rgb),0.1)",
                    padding: "3px 10px",
                    borderRadius: 4,
                  }}
                >
                  {j.status}
                </span>
              </Link>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
