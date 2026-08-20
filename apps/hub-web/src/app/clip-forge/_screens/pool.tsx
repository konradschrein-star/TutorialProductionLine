"use client";

import { useMemo, useState } from "react";
import { PersonaChip, StatusPill } from "../_components/atoms";
import type { CfClip, CfData, ScreenId } from "../_lib/types";
import { personaMeta } from "../_lib/display";

interface Props {
  data: CfData;
  persona: string;
  onOpenClip: (clip: CfClip) => void;
  setScreen: (s: ScreenId) => void;
  /** Re-pull console data after a write so the pool reflects the change. */
  onChange: () => void;
}

export function PoolScreen({ data, persona, onOpenClip, onChange }: Props) {
  const [cat, setCat] = useState<string | null>(null);
  const [scoreMin, setScoreMin] = useState(0);
  const [undist, setUndist] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // The filter list comes from the same category vocabulary the rest of the
  // console uses. It used to be a hardcoded 9-item list that omitted three
  // categories the detector actually emits (story, educational, hot_take,
  // other), making those clips impossible to filter for.
  const categoryOptions = useMemo(() => ["all", ...data.CAT], [data.CAT]);

  /** Apply a PATCH to every selected clip, then refresh. */
  async function applyToSelection(
    body: Record<string, unknown>,
    describe: (n: number) => string,
  ) {
    const ids = data.clips
      .filter((c) => sel.has(c.id))
      .map((c) => c.fullId)
      .filter(Boolean);
    if (ids.length === 0) return;
    setBusy(true);
    setActionMsg(null);
    try {
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/v1/clip-forge/raw-clips/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
        ),
      );
      const failed = results.filter((r) => !r.ok).length;
      setActionMsg(
        failed > 0
          ? `${describe(ids.length - failed)} — ${failed} failed`
          : describe(ids.length),
      );
      setSel(new Set());
      onChange();
    } catch (e) {
      setActionMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    return data.clips.filter((c) => {
      if (cat && cat !== "all" && !c.cats.includes(cat)) return false;
      if (c.score * 100 < scoreMin) return false;
      if (undist && c.dist > 0) return false;
      if (persona !== "All personas" && c.persona !== persona) return false;
      return true;
    });
  }, [cat, scoreMin, undist, persona, data]);

  const toggleSel = (id: string) => {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "9px 16px",
          borderBottom: "1px solid #1d232a",
          background: "#0b0e12",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 9,
              letterSpacing: ".1em",
              color: "#59616a",
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            CATEGORY
          </span>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {categoryOptions.map((c) => {
              const active = (c === "all" && !cat) || cat === c;
              return (
                <button
                  key={c}
                  onClick={() => setCat(c === "all" ? null : c)}
                  style={{
                    fontSize: 10.5,
                    fontFamily: "'IBM Plex Mono', monospace",
                    border: `1px solid ${active ? "#3f4954" : "#2b333c"}`,
                    color: active ? "#eef1f4" : "#7d8893",
                    background: active ? "#1a212a" : "transparent",
                    borderRadius: 4,
                    padding: "2px 8px",
                    cursor: "pointer",
                  }}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ width: 1, height: 20, background: "#1d232a" }} />
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 9,
              letterSpacing: ".1em",
              color: "#59616a",
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            SCORE ≥
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={scoreMin}
            onChange={(e) => setScoreMin(+e.target.value)}
            style={{ width: 96 }}
          />
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: "#cfd4da",
              width: 30,
            }}
          >
            {(scoreMin / 100).toFixed(2)}
          </span>
        </label>
        <button
          onClick={() => setUndist(!undist)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            border: `1px solid ${undist ? "#3f4954" : "#2b333c"}`,
            background: undist ? "#1a212a" : "transparent",
            borderRadius: 4,
            padding: "3px 9px",
            cursor: "pointer",
            color: undist ? "#eef1f4" : "#7d8893",
            fontFamily: "inherit",
            fontSize: 11,
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: 2,
              border: `1px solid ${undist ? "#eef1f4" : "#7d8893"}`,
              background: undist ? "#eef1f4" : "transparent",
            }}
          />
          undistributed only
        </button>
        {/* A "DROP THRESHOLD" slider used to sit here. It was labelled like a
            pipeline setting but its only effect was row opacity — it never
            reached the backend. The SCORE ≥ filter above does the real job. */}
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: "#6b727b",
          }}
        >
          {filtered.length} / {data.clips.length} clips
        </span>
      </div>

      {sel.size > 0 && (
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "7px 16px",
            background: "#13181f",
            borderBottom: "1px solid #2b333c",
          }}
        >
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: "#eef1f4",
              fontWeight: 600,
            }}
          >
            {sel.size} selected
          </span>
          <div style={{ width: 1, height: 16, background: "#2b333c" }} />
          <button
            disabled={busy}
            onClick={() =>
              applyToSelection(
                { action: "depool" },
                (n) => `Depooled ${n} clip(s).`,
              )
            }
            title="Mark the selected clips rejected so they stop counting as available supply"
            style={{
              fontSize: 11,
              border: "1px solid #5a4654",
              color: "#d99a92",
              background: "rgba(207,116,104,.08)",
              borderRadius: 4,
              padding: "3px 11px",
              cursor: busy ? "default" : "pointer",
              fontFamily: "inherit",
            }}
          >
            depool
          </button>
          <button
            disabled={busy}
            onClick={() =>
              applyToSelection(
                { action: "repool" },
                (n) => `Restored ${n} clip(s) to the pool.`,
              )
            }
            title="Undo a depool — put the selected clips back to ready"
            style={{
              fontSize: 11,
              border: "1px solid #2b333c",
              color: "#cfd4da",
              background: "transparent",
              borderRadius: 4,
              padding: "3px 11px",
              cursor: busy ? "default" : "pointer",
              fontFamily: "inherit",
            }}
          >
            repool
          </button>
          {/* Category override. Replaces the detector's classification on
              every selected clip. The old "override category" and
              "re-classify" buttons had no handlers at all. */}
          <select
            disabled={busy}
            value=""
            onChange={(e) => {
              const next = e.target.value;
              e.currentTarget.value = "";
              if (!next) return;
              void applyToSelection(
                { categories: [next] },
                (n) => `Set ${n} clip(s) to “${next}”.`,
              );
            }}
            title="Replace the category on every selected clip"
            style={{
              fontSize: 11,
              border: "1px solid #2b333c",
              color: "#cfd4da",
              background: "#0f141a",
              borderRadius: 4,
              padding: "3px 8px",
              cursor: busy ? "default" : "pointer",
              fontFamily: "inherit",
            }}
          >
            <option value="">set category…</option>
            {data.CAT.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {actionMsg && (
            <span
              style={{
                fontSize: 11,
                color: actionMsg.includes("failed") ? "#dd8d83" : "#7fc79b",
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            >
              {actionMsg}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button
            onClick={() => setSel(new Set())}
            style={{
              fontSize: 11,
              border: 0,
              color: "#828a93",
              background: "transparent",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            clear ✕
          </button>
        </div>
      )}

      <div
        style={{
          flex: "0 0 auto",
          display: "grid",
          gridTemplateColumns:
            "34px 46px 116px 110px minmax(150px,1fr) 138px 104px 96px 64px",
          padding: "7px 16px",
          borderBottom: "1px solid #1d232a",
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 9,
          letterSpacing: ".07em",
          color: "#59616a",
          background: "#0b0e12",
        }}
      >
        <span />
        <span />
        <span>CLIP ID</span>
        <span>SCORE</span>
        <span>CATEGORIES</span>
        <span>PERSONA</span>
        <span>SOURCE</span>
        <span>STATUS</span>
        <span style={{ textAlign: "right" }}>DIST</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {filtered.map((c) => {
          const pm = personaMeta(c.persona);
          const scoreCol =
            c.score >= 0.7 ? "#57a578" : c.score >= 0.5 ? "#7b93d4" : "#b388c9";
          const distCol =
            c.dist === 0 ? "#7d8893" : c.dist >= 4 ? "#57a578" : "#7b93d4";
          const isSelected = sel.has(c.id);
          // Depooled clips are still listed (so they can be restored) but
          // read as inactive.
          const opacity = c.status === "depooled" ? 0.45 : 1;
          return (
            <div
              key={c.id}
              onClick={() => onOpenClip(c)}
              style={{
                display: "grid",
                gridTemplateColumns:
                  "34px 46px 116px 110px minmax(150px,1fr) 138px 104px 96px 64px",
                alignItems: "center",
                padding: "6px 16px 6px 14px",
                borderBottom: "1px solid #14181d",
                borderLeft: `2px solid ${pm.color}`,
                cursor: "pointer",
                opacity,
                background: isSelected ? "#13181f" : "transparent",
              }}
            >
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSel(c.id);
                }}
              >
                <span
                  style={{
                    width: 13,
                    height: 13,
                    border: `1px solid ${isSelected ? "#dfe3e8" : "#3a444f"}`,
                    background: isSelected ? "#dfe3e8" : "transparent",
                    borderRadius: 3,
                    display: "inline-block",
                  }}
                />
              </span>
              <div
                style={{
                  width: 30,
                  height: 40,
                  borderRadius: 3,
                  backgroundImage:
                    "repeating-linear-gradient(135deg,#1a1f26 0 4px,#141920 4px 8px)",
                  border: "1px solid #232a32",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    bottom: 1,
                    right: 1,
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 7,
                    color: "#7d8893",
                    background: "rgba(0,0,0,.5)",
                    padding: "0 2px",
                    borderRadius: 2,
                  }}
                >
                  {c.dur}s
                </span>
              </div>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11.5,
                  color: "#cfd4da",
                }}
              >
                {c.id}
              </span>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  paddingRight: 14,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    height: 5,
                    borderRadius: 3,
                    background: "#171c22",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: (c.score * 100).toFixed(0) + "%",
                      background: scoreCol,
                    }}
                  />
                </div>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10.5,
                    color: scoreCol,
                    width: 26,
                  }}
                >
                  {c.score.toFixed(2)}
                </span>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {c.cats.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    style={{
                      fontSize: 9.5,
                      fontFamily: "'IBM Plex Mono', monospace",
                      color: "#9aa1a9",
                      border: "1px solid #2b333c",
                      borderRadius: 3,
                      padding: "1px 6px",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                }}
              >
                <PersonaChip name={c.persona} size={20} />
                <span
                  style={{
                    fontSize: 11,
                    color: "#aeb4bb",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {c.persona}
                </span>
              </div>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10.5,
                  color: "#7d8893",
                }}
              >
                {c.source}
              </span>
              <span>
                <StatusPill status={c.status} />
              </span>
              <span
                style={{
                  textAlign: "right",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  color: distCol,
                }}
              >
                {c.dist === 0 ? "—" : c.dist + " accts"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
