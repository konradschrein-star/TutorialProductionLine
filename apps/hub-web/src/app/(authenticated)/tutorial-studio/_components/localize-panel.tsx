"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ALL_TARGET_LANGUAGES,
  DEFAULT_STANDARD_LANGUAGES,
  STANDARD_LANGUAGES,
  type TargetLanguage,
} from "@/lib/tutorial/languages";
import { FlagIcon } from "@/lib/tutorial/flag-icon";
import { toast } from "sonner";

/**
 * Localize tab — the "another upload path" for translations. Lists completed
 * English tutorials; each shows a chip per target language (with flag + code).
 *
 * Bulk actions ("Translate everything missing" & row "Translate standard") strictly
 * fan out translations only for the 5 active Standard Languages (German, French,
 * Spanish, Japanese, Korean) to prevent unintended token and compute explosion.
 *
 * Automatic fan-out is deliberately locked to those five languages. Additional
 * languages remain available as explicit, per-video actions.
 */

interface TranslationRef {
  language: string | null;
  status: string;
}
interface SourceRow {
  id: string;
  title: string | null;
  language: string | null;
  createdAt: string | null;
  translations: TranslationRef[];
}

type ChipState = "none" | "pending" | "done" | "failed";

function stateFor(status: string | undefined): ChipState {
  if (!status) return "none";
  if (status === "COMPLETED") return "done";
  if (status.startsWith("FAILED")) return "failed";
  return "pending";
}

const CHIP_STYLE: Record<ChipState, React.CSSProperties> = {
  none: {
    background: "var(--v2-surface-3)",
    color: "var(--v2-text-3)",
    border: "1px dashed var(--v2-border-2)",
  },
  pending: {
    background: "rgba(240,166,66,0.14)",
    color: "#f0a642",
    border: "1px solid rgba(240,166,66,0.4)",
  },
  done: {
    background: "rgba(var(--v2-accent-rgb),0.16)",
    color: "var(--v2-accent)",
    border: "1px solid rgba(var(--v2-accent-rgb),0.5)",
  },
  failed: {
    background: "rgba(239,68,68,0.14)",
    color: "#ff8080",
    border: "1px solid rgba(239,68,68,0.4)",
  },
};

const card: React.CSSProperties = {
  background: "var(--v2-surface-2)",
  border: "1px solid var(--v2-border-1)",
  borderRadius: 14,
  padding: 18,
};

export function LocalizePanel() {
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [showAllLanguages, setShowAllLanguages] = useState(false);

  const load = useCallback(() => {
    fetch("/api/production/tutorial-translate")
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((d: { sources: SourceRow[] }) => {
        setSources(d.sources);
        setError(null);
      })
      .catch((e) => setError(String(e.message || e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeStandardLanguages: TargetLanguage[] = STANDARD_LANGUAGES;

  // Aggregate progress strictly across every source × standard target language.
  const stats = useMemo(() => {
    const total = (sources?.length ?? 0) * activeStandardLanguages.length;
    let done = 0;
    let pending = 0;
    let failed = 0;
    let missing = 0;
    for (const s of sources ?? []) {
      const byLang = new Map(s.translations.map((t) => [t.language, t.status]));
      for (const l of activeStandardLanguages) {
        const st = stateFor(byLang.get(l.code));
        if (st === "done") done++;
        else if (st === "pending") pending++;
        else if (st === "failed") failed++;
        else missing++;
      }
    }
    return { total, done, pending, failed, missing };
  }, [sources, activeStandardLanguages]);

  // Auto-refresh while anything is still in flight.
  useEffect(() => {
    if (stats.pending === 0) return;
    const id = setTimeout(load, 5000);
    return () => clearTimeout(id);
  }, [stats.pending, load]);

  const enqueue = useCallback(
    async (
      sourceJobId: string,
      languages: string[],
      mode: "automatic" | "manual" = "manual",
    ) => {
      if (languages.length === 0) return;
      const key = sourceJobId + languages.join(",");
      setBusy((b) => new Set(b).add(key));
      try {
        const res = await fetch("/api/production/tutorial-translate/enqueue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceJobId, languages, mode }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        load();
      } catch (e) {
        setError(String((e as Error).message));
      } finally {
        setBusy((b) => {
          const n = new Set(b);
          n.delete(key);
          return n;
        });
      }
    },
    [load],
  );

  // One click → strictly fan out only missing STANDARD languages (5 core languages by default).
  const translateAllMissingStandard = useCallback(async () => {
    if (!sources || sources.length === 0) return;
    setBulkRunning(true);
    try {
      for (const s of sources) {
        const byLang = new Map(
          s.translations.map((t) => [t.language, t.status]),
        );
        const missing = activeStandardLanguages
          .filter((l) => !byLang.has(l.code))
          .map((l) => l.code);
        if (missing.length) await enqueue(s.id, missing, "automatic");
      }
      toast.success(
        `Enqueued standard translations (${activeStandardLanguages.map((l) => l.code.toUpperCase()).join(", ")}).`,
      );
    } finally {
      setBulkRunning(false);
      load();
    }
  }, [sources, activeStandardLanguages, enqueue, load]);

  const pct =
    stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header with the fixed five-language automatic set. */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{ fontSize: 18, fontWeight: 700, color: "var(--v2-text-1)" }}
          >
            Localization Factory
          </div>
          <div
            style={{ fontSize: 13, color: "var(--v2-text-3)", marginTop: 2 }}
          >
            Auto-translating into{" "}
            <strong>
              {activeStandardLanguages.length} standard languages:
            </strong>{" "}
            {activeStandardLanguages.map((l, i) => (
              <span
                key={l.code}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  marginRight: 4,
                  fontWeight: 600,
                  color: "var(--v2-text-1)",
                }}
              >
                <FlagIcon code={l.code} /> {l.name}
                {i < activeStandardLanguages.length - 1 ? "," : ""}
              </span>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => setShowAllLanguages((v) => !v)}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              background: showAllLanguages
                ? "rgba(var(--v2-accent-rgb),0.18)"
                : "var(--v2-surface-3)",
              color: showAllLanguages ? "var(--v2-accent)" : "var(--v2-text-2)",
              border: "1px solid var(--v2-border-1)",
              cursor: "pointer",
            }}
          >
            {showAllLanguages
              ? "Hide Extra Languages"
              : "Show All 17 Languages"}
          </button>
        </div>
      </div>

      {/* Progress summary + global standard translation action */}
      {sources && sources.length > 0 && (
        <div
          style={{
            ...card,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 13, color: "var(--v2-text-2)" }}>
              <strong style={{ color: "var(--v2-text-1)" }}>
                {stats.done}/{stats.total}
              </strong>{" "}
              standard translations complete ({activeStandardLanguages.length}{" "}
              target languages × {sources.length} videos)
              {stats.pending > 0 && (
                <span style={{ color: "#f0a642" }}>
                  {" "}
                  · {stats.pending} in progress
                </span>
              )}
              {stats.failed > 0 && (
                <span style={{ color: "#ff8080" }}>
                  {" "}
                  · {stats.failed} failed
                </span>
              )}
            </div>
            <button
              onClick={translateAllMissingStandard}
              disabled={bulkRunning || stats.missing === 0}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                fontSize: 12.5,
                fontWeight: 700,
                background:
                  stats.missing === 0
                    ? "var(--v2-surface-3)"
                    : "var(--v2-accent)",
                color: stats.missing === 0 ? "var(--v2-text-3)" : "#000",
                border: "none",
                cursor:
                  bulkRunning || stats.missing === 0 ? "default" : "pointer",
                opacity: bulkRunning ? 0.6 : 1,
              }}
            >
              {bulkRunning
                ? "Enqueuing standard languages…"
                : stats.missing === 0
                  ? "All standard languages queued ✓"
                  : `Translate standard missing (${stats.missing})`}
            </button>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 3,
              background: "var(--v2-surface-3)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: "var(--v2-accent)",
                transition: "width 0.4s",
              }}
            />
          </div>
        </div>
      )}

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          fontSize: 11,
          color: "var(--v2-text-3)",
        }}
      >
        {(["done", "pending", "failed", "none"] as ChipState[]).map((s) => (
          <span
            key={s}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                ...CHIP_STYLE[s],
              }}
            />
            {s === "none" ? "not started" : s === "pending" ? "in progress" : s}
          </span>
        ))}
      </div>

      {error && (
        <div style={{ ...card, color: "#ff8080", fontSize: 13 }}>{error}</div>
      )}

      {!sources && !error && (
        <div style={{ ...card, color: "var(--v2-text-3)" }}>Loading…</div>
      )}

      {sources && sources.length === 0 && (
        <div style={{ ...card, color: "var(--v2-text-3)", fontSize: 13 }}>
          No completed English tutorials yet. Produce one in the Create → Studio
          flow, then localize it here.
        </div>
      )}

      {/* Sources List */}
      {sources && sources.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sources.map((s) => {
            const byLang = new Map(
              s.translations.map((t) => [t.language, t.status]),
            );
            const missingStandard = activeStandardLanguages
              .filter((l) => !byLang.has(l.code))
              .map((l) => l.code);

            const displayedLanguages = showAllLanguages
              ? ALL_TARGET_LANGUAGES
              : activeStandardLanguages;

            return (
              <div
                key={s.id}
                style={{
                  ...card,
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--v2-text-1)",
                    }}
                  >
                    {s.title ?? "Untitled"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--v2-text-3)" }}>
                    source: {(s.language ?? "en").toUpperCase()} ·{" "}
                    {s.createdAt
                      ? new Date(s.createdAt).toLocaleDateString()
                      : ""}
                  </div>
                </div>

                {/* Language Chips */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {displayedLanguages.map((l) => {
                    const st = stateFor(byLang.get(l.code));
                    const clickable = st === "none" || st === "failed";
                    const key = s.id + [l.code].join(",");
                    const isStandard = DEFAULT_STANDARD_LANGUAGES.includes(
                      l.code,
                    );

                    return (
                      <button
                        key={l.code}
                        disabled={!clickable || busy.has(key)}
                        onClick={() => enqueue(s.id, [l.code])}
                        title={
                          st === "none"
                            ? `Translate to ${l.name} (${l.native})${isStandard ? " [Standard]" : ""}`
                            : st === "failed"
                              ? `Retry ${l.name}`
                              : `${l.name}: ${st}`
                        }
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          padding: "6px 11px",
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor:
                            clickable && !busy.has(key) ? "pointer" : "default",
                          opacity: busy.has(key) ? 0.5 : 1,
                          ...CHIP_STYLE[st],
                          ...(isStandard
                            ? {}
                            : { opacity: st === "none" ? 0.65 : 1 }),
                        }}
                      >
                        <FlagIcon code={l.code} />
                        {l.code.toUpperCase()}
                        {st === "done"
                          ? " ✓"
                          : st === "pending"
                            ? " …"
                            : st === "failed"
                              ? " ↻"
                              : " +"}
                      </button>
                    );
                  })}
                </div>

                {/* Row Standard Translate Button */}
                {missingStandard.length > 0 && (
                  <button
                    onClick={() => enqueue(s.id, missingStandard, "automatic")}
                    disabled={busy.has(s.id + missingStandard.join(","))}
                    style={{
                      padding: "7px 14px",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      background: "var(--v2-accent)",
                      color: "#000",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    Translate standard ({missingStandard.length})
                  </button>
                )}
                <a
                  href={`/thumbnails?tutorialJobId=${encodeURIComponent(s.id)}`}
                  style={{
                    padding: "7px 14px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--v2-accent)",
                    border: "1px solid rgba(var(--v2-accent-rgb),0.4)",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  Thumbnail pack
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
