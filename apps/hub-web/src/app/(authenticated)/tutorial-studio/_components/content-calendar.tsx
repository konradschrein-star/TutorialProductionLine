"use client";
import { useCallback, useEffect, useState } from "react";
import { calendarDays, calendarCell, type CalendarChannel, type CalendarEntry } from "@/lib/tutorial/content-calendar";
import { uploadStateLabel } from "@/lib/uploader/delivery-status";
import { DispatchControl } from "./dispatch-control";
import { ChannelSchedules } from "./channel-schedules";
type CalendarData = { days: string[]; channels: CalendarChannel[]; rows: CalendarEntry[]; scope: "own" | "installation"; canManage: boolean; truncated: boolean };
const field = { padding: "8px 10px", color: "var(--v2-text-1)", background: "var(--v2-surface-2)", border: "1px solid var(--v2-border-1)", borderRadius: 6 };
export function ContentCalendar() {
  const [start, setStart] = useState(new Date().toISOString().slice(0,10));
  const [data, setData] = useState<CalendarData | null>(null);
  const [channelId, setChannelId] = useState("");
  const [day, setDay] = useState(start);
  const [selected, setSelected] = useState<CalendarEntry | null>(null);
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError(""); setSelected(null);
    fetch(`/api/production/content-calendar?start=${encodeURIComponent(start)}`, { signal: abort.signal }).then(async response => {
      const result = await response.json(); if (!response.ok) throw Error(result.error ?? "Calendar unavailable");
      if (!abort.signal.aborted) { setData(result); setDay(start); }
    }).catch(err => { if (!abort.signal.aborted) setError(err instanceof Error ? err.message : "Calendar unavailable"); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [start, refresh]);
  const moveWeek = (direction: number) => { setStart(new Date(Date.parse(`${start}T00:00:00Z`) + direction * 7 * 86400000).toISOString().slice(0,10)); };
  const choose = (row: CalendarEntry) => { setSelected(row); setTime(new Date(row.publishAt).toISOString().slice(0,16)); setReason(""); setNotice(""); };
  const save = useCallback(async () => {
    if (!selected || !time || reason.trim().length < 5) return;
    const at = new Date(`${time}:00Z`); if (!Number.isFinite(at.getTime())) { setNotice("Choose a valid UTC time."); return; }
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/production/publication-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: selected.id, publishAt: at.toISOString(), reason: reason.trim() }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error ?? "Could not move reservation");
      setNotice("Studio reservation moved. Assigned channel unchanged; no external schedule was changed."); setRefresh(value => value + 1);
    } catch (err) { setNotice(err instanceof Error ? err.message : "Could not move reservation"); }
    finally { setSaving(false); }
  }, [selected, time, reason]);
  const visibleChannels = data?.channels.filter(channel => !channelId || channel.id === channelId) ?? [];
  const agenda = visibleChannels.flatMap(channel => calendarCell(data?.rows ?? [], channel, day).rows.map(row => ({ row, channel }))).sort((a,b) => a.row.publishAt.localeCompare(b.row.publishAt));
  return <section aria-label="Content calendar" style={{ display: "grid", gap: 14 }}>
    <p style={{ margin: 0, color: "var(--v2-text-2)", fontSize: 13 }}>Final approval reserves the next available slot on the tutorial’s assigned channel. Each language channel has its own capacity (default 30/day). These are Studio reservations, not proof of YouTube scheduling.</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
      <button className="v2-btn" disabled={loading || saving} onClick={() => moveWeek(-1)}>Previous week</button>
      <label style={{ display: "grid", gap: 4 }}>Week starting<input type="date" style={field} value={start} disabled={saving} onChange={event => { try { calendarDays(event.target.value); setStart(event.target.value); } catch { /* retain last valid window */ } }} /></label>
      <button className="v2-btn" disabled={loading || saving} onClick={() => moveWeek(1)}>Next week</button>
      <label style={{ display: "grid", gap: 4 }}>Channel / language<select style={field} value={channelId} disabled={saving} onChange={event => setChannelId(event.target.value)}><option value="">All visible channels</option>{data?.channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name} · {channel.language}</option>)}</select></label>
      <button className="v2-btn" disabled={loading || saving} onClick={() => setRefresh(value => value + 1)}>Refresh</button>
    </div>
    {loading && <p role="status">Loading reservations…</p>}{error && <p role="alert">{error} <button className="v2-btn" onClick={() => setRefresh(value => value + 1)}>Retry</button></p>}
    {notice && <p role="status">{notice}</p>}
    {data && !loading && !error && <>
      <p style={{ margin: 0, fontSize: 13 }}>{data.scope === "own" ? "Your reservations only. Counts do not include teammates and do not show remaining channel capacity." : "Installation reservations. Each cell shows reserved slots / configured daily capacity."}{data.truncated && " Partial results: 5,000-row limit reached. Counts are lower bounds, not remaining capacity."}</p>
      <div className="calendar-week" role="region" aria-label="Weekly channel reservations" tabIndex={0} style={{ overflowX: "auto", border: "1px solid var(--v2-border-1)", borderRadius: 6 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 800, textAlign: "left", fontSize: 13 }}><caption style={{ textAlign: "left", padding: 10 }}>Channel-local dates · select a cell to open its agenda below</caption><thead><tr><th style={{ padding: 10 }}>Assigned channel</th>{data.days.map(date => <th key={date} scope="col" style={{ padding: 8 }}>{new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined,{ weekday:"short", month:"short", day:"numeric", timeZone:"UTC" })}</th>)}</tr></thead><tbody>{visibleChannels.map(channel => <tr key={channel.id}><th scope="row" style={{ padding: 10, borderTop: "1px solid var(--v2-border-1)" }}>{channel.name}<div style={{ fontWeight: 400, color: "var(--v2-text-2)" }}>{channel.language.toUpperCase()} · {channel.schedule?.timezone ?? "Invalid schedule"}</div></th>{data.days.map(date => { const cell = calendarCell(data.rows, channel, date); return <td key={date} style={{ padding: 5, borderTop: "1px solid var(--v2-border-1)" }}><button className="v2-btn" aria-label={`${channel.name}, ${date}: ${cell.enabled === false ? "closed" : `${cell.count} visible reservations, capacity ${cell.capacity ?? "unknown"}`}`} aria-pressed={day === date && channelId === channel.id} onClick={() => { setDay(date); setChannelId(channel.id); setSelected(null); }} style={{ width: "100%", minHeight: 44 }}>{cell.enabled === false ? "Closed" : <>{cell.count}{data.scope === "installation" ? ` / ${cell.capacity ?? "?"}` : " yours"}</>}</button></td>; })}</tr>)}</tbody></table>
      </div>
      {!visibleChannels.length && <p>No assigned channels with reservations in this view. Final review creates reservations; the calendar does not invent channel assignments.</p>}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}><h2 style={{ margin: 0, fontSize: 17 }}>Daily agenda</h2><label>Local date <select style={field} value={day} onChange={event => { setDay(event.target.value); setSelected(null); }}>{data.days.map(date => <option key={date}>{date}</option>)}</select></label><span>{agenda.length} visible reservations</span></div>
      <p className="calendar-mobile-capacity" style={{ margin: 0, fontSize: 13 }}>{visibleChannels.map(channel => { const cell = calendarCell(data.rows, channel, day); return `${channel.name} (${channel.language.toUpperCase()}, ${channel.schedule?.timezone ?? "schedule invalid"}): ${cell.enabled === false ? "closed" : `${cell.count} visible / ${cell.capacity ?? "unknown"} capacity`}`; }).join(" · ")}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 16 }}>
        <div>{agenda.length ? <ul style={{ padding: 0, margin: 0, listStyle: "none" }}>{agenda.map(({row,channel}) => <li key={row.id} style={{ borderBottom: "1px solid var(--v2-border-1)", padding: "10px 0" }}><button onClick={() => choose(row)} style={{ width: "100%", background: "transparent", color: "var(--v2-text-1)", border: 0, textAlign: "left", cursor: "pointer", padding: 4 }}><strong>{new Date(row.publishAt).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit",timeZone:channel.schedule?.timezone ?? "UTC"})} · {row.title}</strong><div style={{ marginTop: 4, fontSize: 13 }}>{channel.name} · {row.language.toUpperCase()} · {uploadStateLabel({ ...row, scheduledFor: row.publishAt })}</div></button></li>)}</ul> : <p>No reservations for this day and channel filter.</p>}</div>
        {selected && <section aria-label="Selected reservation" style={{ borderLeft: "3px solid var(--v2-accent)", paddingLeft: 14 }}><h3 style={{ marginTop: 0 }}>{selected.title}</h3><p>{selected.language.toUpperCase()} · {new Date(selected.publishAt).toISOString()} (UTC)</p><a className="v2-btn" href={`/tutorial-studio?tab=uploads&jobId=${selected.id}`}>Open delivery</a>{data.canManage ? <fieldset disabled={saving || Boolean(selected.uploaderStatus) || selected.isUploaded} style={{ display: "grid", gap: 10, marginTop: 14, border: 0, padding: 0 }}><legend>Admin reservation override</legend><p>Keep the assigned channel. Capacity and approval are rechecked on save; work already handed off must be reconciled externally.</p><label style={{ display:"grid",gap:4 }}>New date and time (UTC)<input type="datetime-local" style={field} value={time} onChange={event => setTime(event.target.value)} /></label><label style={{ display:"grid",gap:4 }}>Reason<textarea style={field} rows={2} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label><button className="v2-btn" disabled={saving || reason.trim().length < 5 || !time} onClick={() => void save()}>{saving ? "Saving…" : "Move Studio reservation"}</button></fieldset> : <p>Ask an Admin to change this reservation. Channel assignment is preserved.</p>}</section>}
      </div>
      {data.canManage && <><DispatchControl /><ChannelSchedules /></>}
    </>}
    <style>{`.calendar-mobile-capacity { display: none; } @media (max-width: 700px) { .calendar-week { display: none; } .calendar-mobile-capacity { display: block; } }`}</style>
  </section>;
}
