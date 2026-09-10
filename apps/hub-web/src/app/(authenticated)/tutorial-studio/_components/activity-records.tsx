"use client";
import { useEffect, useState } from "react";
import { stageTimeLabel, type ActivityRecord } from "@/lib/tutorial/activity-records";

interface Data {
  scope: string; days: number; rows: ActivityRecord[];
  transitions: Array<{ stage: string; count: number }>; currentlyInRework: number;
  nextCursor: { beforeAt: string; beforeId: string } | null; note: string;
}
const control = { border: "1px solid var(--v2-border, #cbd5e1)", borderRadius: 6, padding: "7px 10px", color: "inherit", background: "var(--v2-surface, transparent)" };
const stages = ["QUEUED", "GENERATING_SCRIPT", "GENERATING_AUDIO", "READY_TO_RECORD", "AWAITING_UPLOAD", "AWAITING_THUMBNAILS", "SPLICING", "COMPLETED", "FAILED_SCRIPT", "FAILED_AUDIO", "FAILED_SPLICE", "CANCELLED"];
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");

function RecordDetail({ record }: { record: ActivityRecord }) {
  const [history, setHistory] = useState<Array<{ id: string; type: string; actorId: string | null; createdAt: string; payload: Record<string, unknown> }> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function loadHistory() {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/production/jobs/${record.id}/history`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load history");
      setHistory(result.events);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }
  return <div style={{ padding: 12, borderTop: "1px solid var(--v2-border, #cbd5e1)" }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
      {record.thumbnailId && <img src={`/api/thumbnails/image/${record.thumbnailId}`} width={160} height={90} alt={`${record.language} thumbnail`} style={{ objectFit: "contain" }} />}
      <div><strong>{record.language?.toUpperCase() ?? "Unknown locale"} · {record.title}</strong>
        <p>{label(record.status)} · {record.channel ?? "Channel missing"} · {record.producer ?? "Owner missing"}</p>
        <p>Voice: {record.voice} ({record.provider}) · Recording: {record.duration ? `${Math.round(Number(record.duration))}s` : "Not recorded"}</p>
        <p>{stageTimeLabel(record.status, record.stageSince)} · Review: {record.review ? label(record.review) : "Not approved"}</p>
        {record.error && <p role="status">Needs attention: {record.error}</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <a href={`/tutorial-studio?tab=studio&jobId=${record.sourceId ?? record.id}`}>Open Studio</a>
          <a href={`/thumbnails?jobId=${record.sourceId ?? record.id}`}>Edit thumbnail pack</a>
          {record.hasVideo && <a href={`/api/production/jobs/${record.id}/download?inline=1`} target="_blank" rel="noreferrer">View video</a>}
          <button style={control} type="button" disabled={loading} onClick={() => void loadHistory()}>{loading ? "Loading history…" : "Status history"}</button>
        </div>
      </div>
    </div>
    {error && <p role="alert">{error}</p>}
    {history && <ol>{history.length ? history.map((event) => <li key={event.id}>{new Date(event.createdAt).toLocaleString()} · {label(event.type)}{event.type === "stage_changed" ? `: ${String(event.payload.from)} → ${String(event.payload.to)}` : ""} · {event.actorId ? "Recorded operator action" : "System transition / no operator attribution"}</li>) : <li>No history recorded. Older activity is not inferred.</li>}</ol>}
  </div>;
}

/** Server-scoped full archive, not a leaderboard based on time between updates. */
export function ActivityRecords() {
  const [query, setQuery] = useState(""); const [stage, setStage] = useState(""); const [days, setDays] = useState("7");
  const [cursor, setCursor] = useState<Data["nextCursor"]>(null);
  const [data, setData] = useState<Data | null>(null); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, stage, days, ...cursor });
      void fetch(`/api/production/activity-records?${params}`, { signal: controller.signal }).then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load production records");
        if (!controller.signal.aborted) setData(result);
      }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, stage, days, cursor, refresh]);
  return <section aria-label="Production records and activity" style={{ marginTop: 24 }}>
    <h2>Production records &amp; activity</h2>
    <p>{data?.scope ?? "Authorized work"} · Recorded transitions, not a time tracker.</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
      <input style={control} aria-label="Search production records" placeholder="Title, keyword, producer or channel" value={query} onChange={(event) => { setCursor(null); setQuery(event.target.value); }} />
      <select style={control} aria-label="Filter source stage" value={stage} onChange={(event) => { setCursor(null); setStage(event.target.value); }}><option value="">All source stages</option>{stages.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select>
      <select style={control} aria-label="Activity history window" value={days} onChange={(event) => setDays(event.target.value)}><option value="1">Last day</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
      <button type="button" style={control} onClick={() => setRefresh((value) => value + 1)}>Refresh</button>
    </div>
    {data && <><p>{data.transitions.find((row) => row.stage === "COMPLETED")?.count ?? 0} completion transitions · {data.transitions.find((row) => row.stage === "READY_TO_RECORD")?.count ?? 0} entries into ready to record · {data.currentlyInRework} currently in rework</p>
      <details><summary>Stage throughput ({data.days} days)</summary><ul>{data.transitions.map((row) => <li key={row.stage}>{label(row.stage)}: {row.count} recorded transitions</li>)}</ul></details>
      <p style={{ fontSize: 12 }}>{data.note}</p></>}
    {error && <p role="alert">{error} <button style={control} type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button></p>}
    {loading && <p role="status">Loading records…</p>}
    {!loading && !error && data?.rows.length === 0 && <p>No source tutorials match this search.</p>}
    {!error && data?.rows.map((record) => <details key={record.id} style={{ border: "1px solid var(--v2-border, #cbd5e1)", borderRadius: 8, marginBottom: 8 }}>
      <summary style={{ padding: 12, cursor: "pointer" }}><strong>{record.title}</strong> · {label(record.status)} · {record.producer ?? "Unknown owner"} · {record.locales?.length ?? 0} language versions</summary>
      <RecordDetail record={record} />{record.locales?.map((locale) => <RecordDetail key={locale.id} record={locale} />)}
    </details>)}
    <div style={{ display: "flex", gap: 8 }}><button style={control} type="button" disabled={loading || !cursor} onClick={() => setCursor(null)}>Newest page</button><button style={control} type="button" disabled={loading || !data?.nextCursor} onClick={() => setCursor(data?.nextCursor ?? null)}>Older results</button><span>Up to 50 source tutorials per page; expand to inspect language versions.</span></div>
  </section>;
}
