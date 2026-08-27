"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { V2Button, V2Input, GlassCard } from "../../_components";

/**
 * "Initial Keywords" — the hub-web-native fallback list of the ~2,150
 * guide-realm keywords carried over from the previous tutorial tool.
 *
 * Unlike the "Keyword Tool" sub-tab (an iframe into a separate app) and the
 * "My claimed keywords" queue (which calls that app's HTTP API), this reads
 * hub-web's OWN seed_keywords table. So it keeps working when the Keyword Tool
 * is down — the VA can still find a keyword, TRACK its state (To do → In
 * progress → Done), delete ones they don't want, and push straight into Create.
 *
 * Picking one hands (title, `seed:<id>`) up to the Create form via onUseSeed;
 * creating from it auto-advances the keyword to In progress server-side.
 */

type Status = "NEW" | "IN_PROGRESS" | "DONE";
type StatusTab = Status | "ALL";

interface SeedKeyword {
  id: number;
  title: string;
  software: string | null;
  contentType: string | null;
  lengthClass: string | null;
  durationSec: number | null;
  referenceUrl: string | null;
  status: Status;
}

interface Counts {
  NEW: number;
  IN_PROGRESS: number;
  DONE: number;
  ALL: number;
}

interface SeedResponse {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  counts: Counts;
  keywords: SeedKeyword[];
}

export const VERIFIED_37_SOFTWARES = [
  "Xero",
  "Dext",
  "Pipedrive",
  "Deel",
  "Remote.com",
  "Rippling",
  "TradingView",
  "Notion",
  "ClickUp",
  "Monday.com",
  "Zapier",
  "Make",
  "HubSpot",
  "Airtable",
  "Webflow",
  "Framer",
  "Canva",
  "Figma",
  "Miro",
  "Loom",
  "Slack",
  "Zoom",
  "Calendly",
  "Typeform",
  "n8n",
  "Hotjar",
  "Looker Studio",
  "Semrush",
  "Klaviyo",
  "Brevo",
  "DocuSign",
  "PandaDoc",
  "Gusto",
  "BambooHR",
  "Zendesk",
  "Intercom",
  "Webex",
];

const LENGTH_CLASSES = [
  "<3min",
  "3-6min",
  "6-10min",
  "10-20min",
  "20-40min",
  "40-60min",
  "1-2hr",
  "2hr+",
];

const STATUS_TABS: Array<{ id: StatusTab; label: string }> = [
  { id: "NEW", label: "To do" },
  { id: "IN_PROGRESS", label: "In progress" },
  { id: "DONE", label: "Done" },
  { id: "ALL", label: "All" },
];

const STATUS_LABEL: Record<Status, string> = {
  NEW: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

const PAGE = 40;

export interface InitialKeywordsProps {
  /** Load a seed keyword into the Create form and switch to that tab. */
  onUseSeed: (seed: { id: number; title: string }) => void;
}

export function InitialKeywords({ onUseSeed }: InitialKeywordsProps) {
  const [search, setSearch] = useState("");
  const [dSearch, setDSearch] = useState("");
  const [selectedSoftware, setSelectedSoftware] = useState("");
  // Standard filter: default to "under 3 minutes" — tutorials are short-form.
  const [lengths, setLengths] = useState<string[]>(["<3min"]);
  const [statusTab, setStatusTab] = useState<StatusTab>("NEW");

  const [rows, setRows] = useState<SeedKeyword[]>([]);
  const [counts, setCounts] = useState<Counts>({
    NEW: 0,
    IN_PROGRESS: 0,
    DONE: 0,
    ALL: 0,
  });
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const buildQuery = useCallback(
    (offset: number) => {
      const q = new URLSearchParams({
        offset: String(offset),
        limit: String(PAGE),
      });
      if (dSearch) q.set("search", dSearch);
      if (selectedSoftware) q.set("software", selectedSoftware);
      if (lengths.length) q.set("length", lengths.join(","));
      if (statusTab !== "ALL") q.set("status", statusTab);
      return q.toString();
    },
    [dSearch, selectedSoftware, lengths, statusTab],
  );


  const loadFirst = useCallback(async () => {
    const my = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/production/keywords/seed?${buildQuery(0)}`);
      const body = (await res.json()) as SeedResponse & { error?: string };
      if (my !== reqId.current) return;
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setRows(body.keywords);
      setCounts(body.counts);
      setTotal(body.total);
      setHasMore(body.hasMore);
    } catch (e) {
      if (my === reqId.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const my = reqId.current;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/production/keywords/seed?${buildQuery(rows.length)}`,
      );
      const body = (await res.json()) as SeedResponse & { error?: string };
      if (my !== reqId.current) return;
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setRows((prev) => {
        const seen = new Set(prev.map((k) => k.id));
        return [...prev, ...body.keywords.filter((k) => !seen.has(k.id))];
      });
      setHasMore(body.hasMore);
    } catch {
      // keep what we have
    } finally {
      setLoadingMore(false);
    }
  }, [buildQuery, hasMore, loadingMore, rows.length]);

  const toggleLength = (lc: string) =>
    setLengths((prev) =>
      prev.includes(lc) ? prev.filter((x) => x !== lc) : [...prev, lc],
    );

  // ── mutations (optimistic) ─────────────────────────────────────────────────
  const changeStatus = useCallback(
    async (id: number, next: Status) => {
      const row = rows.find((r) => r.id === id);
      if (!row || row.status === next) return;
      const prevStatus = row.status;
      setBusyId(id);
      // Optimistic: move counts, and drop the row if it no longer matches the
      // selected tab.
      setCounts((c) => ({
        ...c,
        [prevStatus]: Math.max(0, c[prevStatus] - 1),
        [next]: c[next] + 1,
      }));
      setRows((prev) =>
        statusTab !== "ALL" && next !== statusTab
          ? prev.filter((r) => r.id !== id)
          : prev.map((r) => (r.id === id ? { ...r, status: next } : r)),
      );
      try {
        const res = await fetch(`/api/production/keywords/seed/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        toast.error(
          `Could not update — ${e instanceof Error ? e.message : "error"}`,
        );
        void loadFirst(); // resync on failure
      } finally {
        setBusyId(null);
      }
    },
    [rows, statusTab, loadFirst],
  );

  const deleteRow = useCallback(
    async (id: number) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      setBusyId(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
      setCounts((c) => ({
        ...c,
        [row.status]: Math.max(0, c[row.status] - 1),
        ALL: Math.max(0, c.ALL - 1),
      }));
      setTotal((t) => Math.max(0, t - 1));
      try {
        const res = await fetch(`/api/production/keywords/seed/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast.success("Removed from the list");
      } catch (e) {
        toast.error(
          `Could not delete — ${e instanceof Error ? e.message : "error"}`,
        );
        void loadFirst();
      } finally {
        setBusyId(null);
      }
    },
    [rows, loadFirst],
  );

  const cycleStatus: Record<Status, Status> = {
    NEW: "IN_PROGRESS",
    IN_PROGRESS: "DONE",
    DONE: "NEW",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 12, color: "var(--v2-text-2)", lineHeight: 1.6 }}>
        Curated starter keywords for the <strong>37 Verified High-Demand Business Software Tools</strong> (e.g. Xero, Pipedrive, Zapier, Make, Notion, Airtable, Framer, Klaviyo, Hotjar). Track each one To&nbsp;do → In&nbsp;progress → Done, or click &quot;Create tutorial&quot; to send it directly into production.
      </div>

      {/* Status tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {STATUS_TABS.map((t) => {
          const on = statusTab === t.id;
          const n = counts[t.id];
          return (
            <button
              key={t.id}
              onClick={() => setStatusTab(t.id)}
              style={{
                padding: "5px 12px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                border: "1px solid",
                background: on
                  ? "rgba(var(--v2-accent-rgb), 0.15)"
                  : "transparent",
                borderColor: on
                  ? "rgba(var(--v2-accent-rgb), 0.45)"
                  : "rgba(255,255,255,0.12)",
                color: on ? "var(--v2-accent)" : "var(--v2-text-2)",
              }}
            >
              {t.label}
              <span style={{ marginLeft: 6, opacity: 0.7 }}>
                {n.toLocaleString("en-US")}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search + Software Selector + length filters */}
      <div
        style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
      >
        <div style={{ flex: "1 1 200px", minWidth: 180 }}>
          <V2Input
            placeholder="Search keywords or topics…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            fullWidth
          />
        </div>

        <div style={{ minWidth: 160 }}>
          <select
            value={selectedSoftware}
            onChange={(e) => setSelectedSoftware(e.target.value)}
            style={{
              width: "100%",
              padding: "7px 12px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 500,
              background: "var(--v2-surface-2, rgba(255,255,255,0.06))",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "var(--v2-text-1, #fff)",
              cursor: "pointer",
              outline: "none",
            }}
          >
            <option value="" style={{ background: "#18181b", color: "#fff" }}>
              All 37 Softwares
            </option>
            {VERIFIED_37_SOFTWARES.map((s) => (
              <option key={s} value={s} style={{ background: "#18181b", color: "#fff" }}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {LENGTH_CLASSES.map((lc) => {
            const on = lengths.includes(lc);
            return (
              <button
                key={lc}
                onClick={() => toggleLength(lc)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: "1px solid",
                  background: on
                    ? "rgba(var(--v2-accent-rgb), 0.15)"
                    : "transparent",
                  borderColor: on
                    ? "rgba(var(--v2-accent-rgb), 0.45)"
                    : "rgba(255,255,255,0.12)",
                  color: on ? "var(--v2-accent)" : "var(--v2-text-2)",
                }}
              >
                {lc}
              </button>
            );
          })}
        </div>
      </div>


      {error && (
        <GlassCard style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: "#f87171" }}>
            Could not load initial keywords — {error}
          </div>
          <div style={{ marginTop: 10 }}>
            <V2Button variant="outline" onClick={() => void loadFirst()}>
              Try again
            </V2Button>
          </div>
        </GlassCard>
      )}

      {!error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((k) => (
            <div
              key={k.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 12px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid transparent",
                opacity: busyId === k.id ? 0.5 : 1,
              }}
            >
              {/* status pill — click to advance To do → In progress → Done */}
              <button
                onClick={() => changeStatus(k.id, cycleStatus[k.status])}
                disabled={busyId === k.id}
                title="Click to advance status"
                style={{
                  flexShrink: 0,
                  padding: "3px 9px",
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  cursor: "pointer",
                  border: "1px solid",
                  minWidth: 92,
                  textAlign: "center",
                  background:
                    k.status === "DONE"
                      ? "rgba(34,197,94,0.15)"
                      : k.status === "IN_PROGRESS"
                        ? "rgba(234,179,8,0.15)"
                        : "rgba(255,255,255,0.05)",
                  borderColor:
                    k.status === "DONE"
                      ? "rgba(34,197,94,0.45)"
                      : k.status === "IN_PROGRESS"
                        ? "rgba(234,179,8,0.45)"
                        : "rgba(255,255,255,0.15)",
                  color:
                    k.status === "DONE"
                      ? "#4ade80"
                      : k.status === "IN_PROGRESS"
                        ? "#facc15"
                        : "var(--v2-text-2)",
                }}
              >
                {STATUS_LABEL[k.status]}
              </button>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {k.title}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    color: "var(--v2-text-2)",
                    marginTop: 3,
                  }}
                >
                  {k.software && (
                    <span
                      style={{
                        padding: "1px 6px",
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        background: "rgba(var(--v2-accent-rgb), 0.15)",
                        color: "var(--v2-accent)",
                      }}
                    >
                      {k.software}
                    </span>
                  )}
                  {k.lengthClass && <span>{k.lengthClass}</span>}
                  {k.contentType && <span>· {k.contentType}</span>}
                </div>

              </div>

              {k.referenceUrl && (
                <a
                  href={k.referenceUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: 10,
                    color: "var(--v2-text-2)",
                    textDecoration: "underline",
                    whiteSpace: "nowrap",
                  }}
                >
                  reference
                </a>
              )}

              <V2Button
                variant={k.status === "DONE" ? "outline" : "accent"}
                onClick={() => onUseSeed({ id: k.id, title: k.title })}
                title="Load this keyword into Create"
              >
                {k.status === "DONE" ? "Make again" : "Create tutorial"}
              </V2Button>

              <button
                onClick={() => deleteRow(k.id)}
                disabled={busyId === k.id}
                title="Delete — remove this keyword from the list"
                aria-label="Delete keyword"
                style={{
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  cursor: "pointer",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "var(--v2-text-2)",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 17 }}
                >
                  delete
                </span>
              </button>
            </div>
          ))}

          {!loading && rows.length === 0 && (
            <div
              style={{
                fontSize: 12,
                color: "var(--v2-text-2)",
                padding: "24px 0",
                textAlign: "center",
              }}
            >
              {statusTab === "NEW"
                ? "Nothing left to do with these filters. 🎉"
                : "No keywords match your filters."}
            </div>
          )}

          {hasMore && (
            <div
              style={{ display: "flex", justifyContent: "center", marginTop: 8 }}
            >
              <V2Button
                variant="outline"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </V2Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
