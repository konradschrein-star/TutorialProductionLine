"use client";

import { useCallback, useEffect, useState } from "react";
import { TARGET_LANGUAGES } from "@/lib/tutorial/languages";

/**
 * Localize tab — the "another upload path" for translations. Lists completed
 * English tutorials; each shows a chip per target language (de/fr/es/ja/ko).
 * Click a missing-language chip (or "Translate all") to enqueue a translation
 * job: the worker re-translates the script + metadata, re-voices the narration,
 * remuxes the recording, and delivers to that language's subchannel Drive folder.
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
  none: { background: "var(--v2-surface-3)", color: "var(--v2-text-3)", border: "1px dashed var(--v2-border-2)" },
  pending: { background: "rgba(240,166,66,0.14)", color: "#f0a642", border: "1px solid rgba(240,166,66,0.4)" },
  done: { background: "rgba(var(--v2-accent-rgb),0.16)", color: "var(--v2-accent)", border: "1px solid rgba(var(--v2-accent-rgb),0.5)" },
  failed: { background: "rgba(239,68,68,0.14)", color: "#ff8080", border: "1px solid rgba(239,68,68,0.4)" },
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

  const load = useCallback(() => {
    fetch("/api/production/tutorial-translate")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { sources: SourceRow[] }) => {
        setSources(d.sources);
        setError(null);
      })
      .catch((e) => setError(String(e.message || e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const enqueue = useCallback(
    async (sourceJobId: string, languages: string[]) => {
      if (languages.length === 0) return;
      const key = sourceJobId + languages.join(",");
      setBusy((b) => new Set(b).add(key));
      try {
        const res = await fetch("/api/production/tutorial-translate/enqueue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceJobId, languages }),
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--v2-text-1)" }}>Localization</div>
        <div style={{ fontSize: 13, color: "var(--v2-text-3)" }}>
          Turn a finished English tutorial into {TARGET_LANGUAGES.map((l) => l.name).join(", ")} — and more.
          Each language is re-voiced and delivered to its own subchannel.
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, color: "var(--v2-text-3)" }}>
        {(["done", "pending", "failed", "none"] as ChipState[]).map((s) => (
          <span key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, ...CHIP_STYLE[s] }} />
            {s === "none" ? "not started" : s === "pending" ? "in progress" : s}
          </span>
        ))}
      </div>

      {error && <div style={{ ...card, color: "#ff8080", fontSize: 13 }}>{error}</div>}

      {!sources && !error && <div style={{ ...card, color: "var(--v2-text-3)" }}>Loading…</div>}

      {sources && sources.length === 0 && (
        <div style={{ ...card, color: "var(--v2-text-3)", fontSize: 13 }}>
          No completed English tutorials yet. Produce one in the Create → Studio flow, then localize it here.
        </div>
      )}

      {sources && sources.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sources.map((s) => {
            const byLang = new Map(s.translations.map((t) => [t.language, t.status]));
            const missing = TARGET_LANGUAGES.filter((l) => !byLang.has(l.code)).map((l) => l.code);
            return (
              <div key={s.id} style={{ ...card, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--v2-text-1)" }}>{s.title ?? "Untitled"}</div>
                  <div style={{ fontSize: 11, color: "var(--v2-text-3)" }}>
                    source: {(s.language ?? "en").toUpperCase()} · {s.createdAt ? new Date(s.createdAt).toLocaleDateString() : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {TARGET_LANGUAGES.map((l) => {
                    const st = stateFor(byLang.get(l.code));
                    const clickable = st === "none" || st === "failed";
                    const key = s.id + [l.code].join(",");
                    return (
                      <button
                        key={l.code}
                        disabled={!clickable || busy.has(key)}
                        onClick={() => enqueue(s.id, [l.code])}
                        title={
                          st === "none"
                            ? `Translate to ${l.name}`
                            : st === "failed"
                              ? `Retry ${l.name}`
                              : `${l.name}: ${st}`
                        }
                        style={{
                          padding: "6px 11px",
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: clickable && !busy.has(key) ? "pointer" : "default",
                          opacity: busy.has(key) ? 0.5 : 1,
                          ...CHIP_STYLE[st],
                        }}
                      >
                        {l.code.toUpperCase()}
                        {st === "done" ? " ✓" : st === "pending" ? " …" : st === "failed" ? " ↻" : " +"}
                      </button>
                    );
                  })}
                </div>
                {missing.length > 0 && (
                  <button
                    onClick={() => enqueue(s.id, missing)}
                    disabled={busy.has(s.id + missing.join(","))}
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
                    Translate all ({missing.length})
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
