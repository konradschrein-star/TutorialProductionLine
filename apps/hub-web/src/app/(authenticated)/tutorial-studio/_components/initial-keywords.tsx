"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { V2Button, V2Input, GlassCard } from "../../_components";
import { VERIFIED_37_SOFTWARES } from "@/lib/tutorial/seed-softwares";

type Status = "NEW" | "IN_PROGRESS" | "DONE";
type StatusTab = Status | "ALL";
type ViewMode = "APPS" | "LIST";

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

interface SoftwareAppSummary {
  software: string;
  total: number;
  toDo: number;
  inProgress: number;
  done: number;
  claimedBy: string | null;
}

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

const DEFAULT_APP_SUMMARIES: SoftwareAppSummary[] = VERIFIED_37_SOFTWARES.map((s) => ({
  software: s,
  total: 0,
  toDo: 0,
  inProgress: 0,
  done: 0,
  claimedBy: null,
}));

export function InitialKeywords({ onUseSeed }: InitialKeywordsProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("APPS");
  const [search, setSearch] = useState("");
  const [dSearch, setDSearch] = useState("");
  const [selectedSoftware, setSelectedSoftware] = useState("");
  const [lengths, setLengths] = useState<string[]>(["<3min"]);
  const [statusTab, setStatusTab] = useState<StatusTab>("NEW");

  // App Sections state
  const [apps, setApps] = useState<SoftwareAppSummary[]>(DEFAULT_APP_SUMMARIES);
  const [appsLoading, setAppsLoading] = useState(false);
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [appKeywords, setAppKeywords] = useState<Record<string, SeedKeyword[]>>({});
  const [claimingApp, setClaimingApp] = useState<string | null>(null);


  // List view state
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

  // Load App summaries
  const loadApps = useCallback(async () => {
    setAppsLoading(true);
    try {
      const res = await fetch("/api/production/keywords/seed/apps");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setApps(body.apps ?? []);
    } catch (e) {
      console.error("Could not load app sections:", e);
    } finally {
      setAppsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadApps();
  }, [loadApps]);


  // Load keywords for an expanded app
  const loadAppKeywords = useCallback(async (soft: string) => {
    try {
      const res = await fetch(`/api/production/keywords/seed?software=${encodeURIComponent(soft)}&limit=100`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as SeedResponse;
      setAppKeywords((prev) => ({ ...prev, [soft]: body.keywords }));
    } catch (e) {
      console.error("Could not load keywords for app:", soft, e);
    }
  }, []);

  const toggleExpandApp = (soft: string) => {
    if (expandedApp === soft) {
      setExpandedApp(null);
    } else {
      setExpandedApp(soft);
      if (!appKeywords[soft]) {
        void loadAppKeywords(soft);
      }
    }
  };

  const handleClaimEntireApp = async (soft: string, action: "claim" | "release") => {
    setClaimingApp(soft);
    try {
      const res = await fetch("/api/production/keywords/seed/claim-app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ software: soft, action }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      toast.success(
        action === "claim"
          ? `Claimed all '${soft}' tutorials for your workflow!`
          : `Released '${soft}' tutorials back to To Do.`,
      );
      void loadApps();
      void loadAppKeywords(soft);
      void loadFirst();
    } catch (e) {
      toast.error(`Could not ${action} app — ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setClaimingApp(null);
    }
  };

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

  const changeStatus = useCallback(
    async (id: number, next: Status, softwareName?: string | null) => {
      const row = rows.find((r) => r.id === id);
      const prevStatus = row ? row.status : "NEW";
      setBusyId(id);

      // Optimistic updates
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
      if (softwareName) {
        setAppKeywords((prev) => ({
          ...prev,
          [softwareName]: (prev[softwareName] ?? []).map((k) =>
            k.id === id ? { ...k, status: next } : k,
          ),
        }));
      }

      try {
        const res = await fetch(`/api/production/keywords/seed/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        void loadApps();
      } catch (e) {
        toast.error(`Could not update — ${e instanceof Error ? e.message : "error"}`);
        void loadFirst();
      } finally {
        setBusyId(null);
      }
    },
    [rows, statusTab, loadFirst, loadApps],
  );

  const deleteRow = useCallback(
    async (id: number, softwareName?: string | null) => {
      const row = rows.find((r) => r.id === id);
      setBusyId(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
      if (row) {
        setCounts((c) => ({
          ...c,
          [row.status]: Math.max(0, c[row.status] - 1),
          ALL: Math.max(0, c.ALL - 1),
        }));
      }
      setTotal((t) => Math.max(0, t - 1));
      if (softwareName) {
        setAppKeywords((prev) => ({
          ...prev,
          [softwareName]: (prev[softwareName] ?? []).filter((k) => k.id !== id),
        }));
      }
      try {
        const res = await fetch(`/api/production/keywords/seed/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast.success("Removed from the list");
        void loadApps();
      } catch (e) {
        toast.error(`Could not delete — ${e instanceof Error ? e.message : "error"}`);
        void loadFirst();
      } finally {
        setBusyId(null);
      }
    },
    [rows, loadFirst, loadApps],
  );

  const cycleStatus: Record<Status, Status> = {
    NEW: "IN_PROGRESS",
    IN_PROGRESS: "DONE",
    DONE: "NEW",
  };

  const [syncing, setSyncing] = useState(false);

  const handleForceResync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/production/keywords/seed", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      toast.success(
        `Purged outdated topics & synced ${data.totalSeeded} keywords across 37 software tools!`,
      );
      void loadApps();
      void loadFirst();
    } catch (e) {
      toast.error(`Sync failed: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header & Mode Switcher */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 12, color: "var(--v2-text-2)", lineHeight: 1.5, maxWidth: 650 }}>
          Curated starter keywords for the <strong>37 Verified High-Demand Business Software Tools</strong>. Claim entire app sections or individual tutorials to record and produce.
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <V2Button
            variant="outline"
            size="sm"
            disabled={syncing}
            onClick={handleForceResync}
            title="Purge all old non-business keywords and re-sync the 37 business software topics"
          >
            {syncing ? "Syncing…" : "Re-Sync 37 Softwares"}
          </V2Button>

          {/* View Mode Switch */}
          <div
            style={{
              display: "inline-flex",
              background: "rgba(255,255,255,0.06)",
              padding: 3,
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >

          <button
            type="button"
            onClick={() => setViewMode("APPS")}
            style={{
              padding: "5px 14px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              border: "none",
              background:
                viewMode === "APPS"
                  ? "var(--v2-accent, #aaff00)"
                  : "transparent",
              color: viewMode === "APPS" ? "#000" : "var(--v2-text-2)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
              grid_view
            </span>
            App Sections ({VERIFIED_37_SOFTWARES.length})
          </button>
          <button
            type="button"
            onClick={() => setViewMode("LIST")}
            style={{
              padding: "5px 14px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              border: "none",
              background:
                viewMode === "LIST"
                  ? "var(--v2-accent, #aaff00)"
                  : "transparent",
              color: viewMode === "LIST" ? "#000" : "var(--v2-text-2)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
              format_list_bulleted
            </span>
            All Keywords ({counts.ALL.toLocaleString("en-US")})
          </button>
        </div>
      </div>
    </div>

      {/* ─── APP SECTIONS VIEW ─── */}

      {viewMode === "APPS" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* App search filter */}
          <div style={{ maxWidth: 350 }}>
            <V2Input
              placeholder="Filter 37 software apps…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              fullWidth
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 12,
            }}
          >
            {apps
              .filter((a) =>
                dSearch ? a.software.toLowerCase().includes(dSearch.toLowerCase()) : true,
              )
              .map((app) => {
                const isExpanded = expandedApp === app.software;
                const isBusy = claimingApp === app.software;
                const hasTodo = app.toDo > 0;
                const hasInProgress = app.inProgress > 0;

                return (
                  <GlassCard
                    key={app.software}
                    style={{
                      padding: 16,
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                      border: isExpanded
                        ? "1px solid rgba(var(--v2-accent-rgb), 0.5)"
                        : "1px solid rgba(255,255,255,0.08)",
                      background: isExpanded
                        ? "rgba(var(--v2-accent-rgb), 0.04)"
                        : "rgba(255,255,255,0.02)",
                    }}
                  >
                    {/* Header: App Name, Total count, Claimed state */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 8,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>
                          {app.software}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--v2-text-2)", marginTop: 2 }}>
                          {app.total} tutorials in packet
                          {app.claimedBy ? ` · Claimed by ${app.claimedBy}` : ""}
                        </div>
                      </div>

                      {/* Status distribution badges */}
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {app.toDo > 0 && (
                          <span
                            style={{
                              padding: "2px 7px",
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 700,
                              background: "rgba(255,255,255,0.08)",
                              color: "var(--v2-text-2)",
                            }}
                          >
                            {app.toDo} to do
                          </span>
                        )}
                        {app.inProgress > 0 && (
                          <span
                            style={{
                              padding: "2px 7px",
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 700,
                              background: "rgba(234,179,8,0.15)",
                              color: "#facc15",
                            }}
                          >
                            {app.inProgress} in progress
                          </span>
                        )}
                        {app.done > 0 && (
                          <span
                            style={{
                              padding: "2px 7px",
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 700,
                              background: "rgba(34,197,94,0.15)",
                              color: "#4ade80",
                            }}
                          >
                            {app.done} done
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Progress mini bar */}
                    <div
                      style={{
                        width: "100%",
                        height: 4,
                        background: "rgba(255,255,255,0.06)",
                        borderRadius: 2,
                        overflow: "hidden",
                        display: "flex",
                      }}
                    >
                      <div
                        style={{
                          width: `${app.total ? (app.done / app.total) * 100 : 0}%`,
                          background: "#4ade80",
                        }}
                      />
                      <div
                        style={{
                          width: `${app.total ? (app.inProgress / app.total) * 100 : 0}%`,
                          background: "#facc15",
                        }}
                      />
                    </div>

                    {/* App Action Buttons: Claim Whole App, Release, View */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        paddingTop: 4,
                      }}
                    >
                      <div style={{ display: "flex", gap: 6 }}>
                        {hasTodo ? (
                          <V2Button
                            variant="accent"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => handleClaimEntireApp(app.software, "claim")}
                            title="Claim all To Do keywords in this software packet"
                          >
                            {isBusy ? "Claiming…" : `Claim Entire App (${app.toDo})`}
                          </V2Button>
                        ) : hasInProgress ? (
                          <V2Button
                            variant="outline"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => handleClaimEntireApp(app.software, "release")}
                            title="Release in-progress keywords back to To Do"
                          >
                            {isBusy ? "Releasing…" : "Release App"}
                          </V2Button>
                        ) : (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: "#4ade80",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                              check_circle
                            </span>
                            Completed
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleExpandApp(app.software)}
                        style={{
                          background: "transparent",
                          border: "1px solid rgba(255,255,255,0.12)",
                          borderRadius: 6,
                          padding: "4px 10px",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--v2-text-1)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span>{isExpanded ? "Hide" : "View"} ({app.total})</span>
                        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                          {isExpanded ? "expand_less" : "expand_more"}
                        </span>
                      </button>
                    </div>

                    {/* Expanded list of keywords for this specific app */}
                    {isExpanded && (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          paddingTop: 8,
                          borderTop: "1px solid rgba(255,255,255,0.08)",
                        }}
                      >
                        {(appKeywords[app.software] ?? []).map((k) => (
                          <div
                            key={k.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                              padding: "7px 10px",
                              borderRadius: 6,
                              background: "rgba(255,255,255,0.03)",
                              opacity: busyId === k.id ? 0.5 : 1,
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => changeStatus(k.id, cycleStatus[k.status], app.software)}
                              style={{
                                flexShrink: 0,
                                padding: "2px 6px",
                                borderRadius: 4,
                                fontSize: 9,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                cursor: "pointer",
                                border: "1px solid",
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

                            <div
                              style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: 12,
                                fontWeight: 500,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {k.title}
                            </div>

                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <V2Button
                                variant={k.status === "DONE" ? "outline" : "accent"}
                                size="sm"
                                onClick={() => onUseSeed({ id: k.id, title: k.title })}
                              >
                                {k.status === "DONE" ? "Make again" : "Create"}
                              </V2Button>
                              <button
                                type="button"
                                onClick={() => deleteRow(k.id, app.software)}
                                style={{
                                  background: "none",
                                  border: "none",
                                  color: "var(--v2-text-2)",
                                  cursor: "pointer",
                                  padding: 2,
                                  display: "grid",
                                  placeItems: "center",
                                }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                                  delete
                                </span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </GlassCard>
                );
              })}
          </div>
        </div>
      )}

      {/* ─── FLAT LIST VIEW ─── */}
      {viewMode === "LIST" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
            }}
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
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    marginTop: 8,
                  }}
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
      )}
    </div>
  );
}
