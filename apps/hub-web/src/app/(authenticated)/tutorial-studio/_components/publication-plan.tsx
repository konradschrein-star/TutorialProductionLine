"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
type Row = { id: string; title: string; language: string; channelName: string | null; publishAt: string; uploaderStatus: string | null };
type Event = { id: string; type: string; actorId: string | null; payload: Record<string, unknown>; createdAt: string };
const fieldStyle = { padding: "9px 12px", color: "var(--v2-text-1)", background: "var(--v2-surface-2)", border: "1px solid var(--v2-border-1)", borderRadius: 6 };
export function PublicationPlan() {
  const [rows, setRows] = useState<Row[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [publishAt, setPublishAt] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Event[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const response = await fetch(`/api/production/publication-plan?q=${encodeURIComponent(query)}`);
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not load reservations");
      if (current !== generation.current) return;
      setRows(data.rows); setCanManage(data.canManage); setError("");
    } catch (err) { if (current === generation.current) setError(err instanceof Error ? err.message : "Could not load reservations"); }
  }, [query]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setHistory([]); setHistoryError("");
    if (!selected) return;
    const abort = new AbortController();
    fetch(`/api/production/jobs/${selected.id}/history`, { signal: abort.signal }).then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not load history");
      if (!abort.signal.aborted) setHistory(data.events);
    }).catch((err) => { if (!abort.signal.aborted) setHistoryError(err instanceof Error ? err.message : "Could not load history"); });
    return () => abort.abort();
  }, [selected]);
  function choose(row: Row) { setSelected(row); setPublishAt(row.publishAt); setReason(""); }
  async function save() {
    if (!selected) return;
    const date = new Date(publishAt);
    if (!/Z$/.test(publishAt) || !Number.isFinite(date.getTime()) || reason.trim().length < 5) { toast.error("Enter a UTC timestamp ending in Z and a reason of at least five characters."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/production/publication-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: selected.id, publishAt: date.toISOString(), reason }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not move reservation");
      toast.success("Studio reservation updated. No external schedule was changed.");
      setSelected({ ...selected, publishAt: data.publishAt }); await load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not move reservation"); }
    finally { setBusy(false); }
  }
  return <details style={{ padding: 16, border: "1px solid var(--v2-border-1)", borderRadius: 8 }}>
    <summary>Publication reservations · {rows.length}</summary>
    <p>First 100 matching undelivered reservations, earliest first. Search includes all reservations, not just loaded rows. These are Studio plans, not confirmation that YouTube has scheduled a video. Times below are UTC.</p>
    <form onSubmit={(event) => { event.preventDefault(); setSelected(null); if (query === search.trim()) void load(); else setQuery(search.trim()); }} style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "12px 0" }}>
      <input style={fieldStyle} aria-label="Search publication reservations" placeholder="Tutorial title or channel" maxLength={200} value={search} disabled={busy} onChange={(event) => setSearch(event.target.value)} />
      <button className="v2-btn" type="submit" disabled={busy}>Search reservations</button>
      <button className="v2-btn" type="button" disabled={busy} onClick={() => void load()}>Refresh reservations</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {!error && !rows.length && <p>No undelivered reservations.</p>}
    <div style={{ overflowX: "auto", maxHeight: 320 }}><table style={{ width: "100%", textAlign: "left" }}><thead><tr><th>Tutorial</th><th>Channel</th><th>Planned time (UTC)</th><th>Details</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id}><td>{row.title} · {row.language.toUpperCase()}</td><td>{row.channelName ?? "No channel"}</td><td>{new Date(row.publishAt).toISOString().replace("T", " ").replace(".000Z", " UTC")}</td><td><button className="v2-btn" type="button" disabled={busy} onClick={() => choose(row)}>View reservation</button></td></tr>)}
    </tbody></table></div>
    {selected && <section aria-label="Reservation details" style={{ marginTop: 16 }}>
      <h3>{selected.title} · {selected.language.toUpperCase()}</h3>
      {canManage && <div style={{ display: "grid", gap: 10, maxWidth: 620 }}>
        <p>Admin override keeps the assigned channel and daily capacity. It may use a time outside the normal window. Already handed-off work cannot be moved here.</p>
        <label>New time (UTC ISO, ending in Z)<input aria-label="Override publication time UTC" disabled={busy} value={publishAt} onChange={(event) => setPublishAt(event.target.value)} style={{ ...fieldStyle, display: "block", width: "100%" }} /></label>
        <label>Reason for override<textarea aria-label="Schedule override reason" disabled={busy} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} style={{ ...fieldStyle, display: "block", width: "100%" }} /></label>
        <button className="v2-btn" type="button" disabled={busy || reason.trim().length < 5} onClick={() => void save()}>{busy ? "Saving…" : "Move Studio reservation"}</button>
      </div>}
      <h4>Recent history</h4><p>Up to 100 events since tracking was enabled. Time in a stage is not VA working time.</p>
      {historyError && <p role="alert">{historyError}</p>}
      <ul>{history.map((event) => <li key={event.id}>{new Date(event.createdAt).toISOString()} · {event.type.replaceAll("_", " ")}{event.type === "schedule_overridden" ? ` · ${String(event.payload.previous ?? "unplanned")} → ${String(event.payload.publishAt)} · ${String(event.payload.reason)}` : event.type === "stage_changed" ? ` · ${String(event.payload.from)} → ${String(event.payload.to)}` : ""} · {event.actorId ? "Operator action" : "System event"}</li>)}</ul>
    </section>}
  </details>;
}
