"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChannelScheduleSchema, type ChannelDaySchedule, type ChannelSchedule } from "@repo/contracts";

type Channel = { id: string; name: string; language: string; schedule: ChannelSchedule | null; error: string | null };
const WEEKDAYS = [
  ["monday", "Monday"], ["tuesday", "Tuesday"], ["wednesday", "Wednesday"],
  ["thursday", "Thursday"], ["friday", "Friday"], ["saturday", "Saturday"], ["sunday", "Sunday"],
] as const;
type Weekday = (typeof WEEKDAYS)[number][0];
type WeeklyPlan = NonNullable<ChannelSchedule["weeklyPlan"]>;

function clock(minute: number) { return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`; }
function minutes(value: string) { const match = /^(\d{2}):(\d{2})$/.exec(value); return match && Number(match[1]) < 24 && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : NaN; }
function withWeeklyPlan(value?: ChannelSchedule | null): ChannelSchedule & { weeklyPlan: WeeklyPlan } {
  const schedule = ChannelScheduleSchema.parse(value ?? {});
  const dailyCapacity = Math.min(schedule.dailyCapacity, 30);
  const fallback: ChannelDaySchedule = { enabled: true, dailyCapacity, startMinute: schedule.startMinute, endMinute: schedule.endMinute };
  return {
    ...schedule,
    dailyCapacity,
    weeklyPlan: Object.fromEntries(WEEKDAYS.map(([key]) => {
      const day = schedule.weeklyPlan?.[key] ?? fallback;
      return [key, { ...day, dailyCapacity: Math.min(day.dailyCapacity, 30) }];
    })) as WeeklyPlan,
  };
}

const field = { minHeight: 40, padding: "7px 9px", background: "var(--v2-surface-2)", color: "var(--v2-text-1)", border: "1px solid var(--v2-border-1)", borderRadius: 6 };

export function ChannelSchedules({ channelId }: { channelId?: string } = {}) {
  const [rows, setRows] = useState<Channel[]>([]);
  const [selected, setSelected] = useState("");
  const [schedule, setSchedule] = useState(() => withWeeklyPlan());
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetch("/api/production/channel-schedules").then((response) => response.ok ? response.json() : null).then((data) => { if (data?.canManage) setRows(data.channels); }).catch(() => {}); }, []);
  const weeklyCapacity = useMemo(() => WEEKDAYS.reduce((sum, [key]) => sum + (schedule.weeklyPlan[key].enabled ? schedule.weeklyPlan[key].dailyCapacity : 0), 0), [schedule]);
  useEffect(() => { if(channelId && rows.some(row=>row.id===channelId)){setSelected(channelId);setSchedule(withWeeklyPlan(rows.find(row=>row.id===channelId)?.schedule));} },[channelId,rows]);

  function choose(id: string) {
    setSelected(id);
    setSchedule(withWeeklyPlan(rows.find((row) => row.id === id)?.schedule));
  }
  function updateDay(day: Weekday, patch: Partial<ChannelDaySchedule>) {
    setSchedule((current) => ({ ...current, weeklyPlan: { ...current.weeklyPlan, [day]: { ...current.weeklyPlan[day], ...patch } } }));
  }
  function applyStandardPlan() {
    setSchedule((current) => ({
      ...current,
      dailyCapacity: 30,
      startMinute: 480,
      endMinute: 1200,
      weeklyPlan: Object.fromEntries(WEEKDAYS.map(([key]) => [key, { enabled: true, dailyCapacity: 30, startMinute: 480, endMinute: 1200 }])) as WeeklyPlan,
    }));
  }
  async function save() {
    const parsed = ChannelScheduleSchema.safeParse(schedule);
    if (!parsed.success) { toast.error(parsed.error.issues.map((issue) => issue.message).join(" ")); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/production/channel-schedules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channelId: selected, schedule: parsed.data }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not save upload plan");
      const saved = withWeeklyPlan(result.schedule);
      setSchedule(saved);
      setRows((previous) => previous.map((row) => row.id === selected ? { ...row, schedule: saved, error: null } : row));
      toast.success("Weekly upload plan saved. Existing reservations were not moved.");
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  if (!rows.length) return null;

  return <details style={{ padding: 16, border: "1px solid var(--v2-border-1)", borderRadius: 8 }}>
    <summary style={{ cursor: "pointer", fontWeight: 700 }}>Admin · Weekly upload plan</summary>
    <p style={{ color: "var(--v2-text-2)", fontSize: 13 }}>Set the publishing days, capacity, and time window for each destination channel. New channels default to the safety maximum of 30 videos every day from 08:00 to 20:00.</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
      <label style={{ display: "grid", gap: 5, minWidth: 260 }}>Destination channel<select aria-label="Upload plan destination channel" value={selected} disabled={busy||Boolean(channelId)} onChange={(event) => choose(event.target.value)} style={field}><option value="">Choose a channel</option>{rows.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.language.toUpperCase()}</option>)}</select></label>
      {selected && <label style={{ display: "grid", gap: 5, minWidth: 210 }}>Channel timezone<input aria-label="Channel timezone" value={schedule.timezone} disabled={busy} onChange={(event) => setSchedule({ ...schedule, timezone: event.target.value })} style={field} /></label>}
    </div>
    {selected && <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
      {rows.find((row) => row.id === selected)?.error && <p role="alert" style={{ color: "var(--v2-error)" }}>{rows.find((row) => row.id === selected)?.error}</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
        <p style={{ margin: 0, fontSize: 13 }}><strong>{weeklyCapacity} videos/week</strong> at the configured maximum</p>
        <button className="v2-btn" type="button" disabled={busy} onClick={applyStandardPlan}>Reset to standard · 30/day</button>
      </div>
      <div role="region" aria-label="Weekly upload plan" tabIndex={0} style={{ overflowX: "auto", border: "1px solid var(--v2-border-1)", borderRadius: 6 }}>
        <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr><th scope="col" style={{ padding: 10, textAlign: "left" }}>Day</th><th scope="col" style={{ padding: 10, textAlign: "left" }}>Upload</th><th scope="col" style={{ padding: 10, textAlign: "left" }}>Videos</th><th scope="col" style={{ padding: 10, textAlign: "left" }}>First slot</th><th scope="col" style={{ padding: 10, textAlign: "left" }}>Window ends</th></tr></thead>
          <tbody>{WEEKDAYS.map(([key, label]) => { const plan = schedule.weeklyPlan[key]; return <tr key={key} style={{ borderTop: "1px solid var(--v2-border-1)", opacity: plan.enabled ? 1 : .62 }}>
            <th scope="row" style={{ padding: 10, textAlign: "left" }}>{label}</th>
            <td style={{ padding: 8 }}><label style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 40 }}><input type="checkbox" checked={plan.enabled} disabled={busy} onChange={(event) => updateDay(key, { enabled: event.target.checked })} /><span>{plan.enabled ? "Active" : "Closed"}</span></label></td>
            <td style={{ padding: 8 }}><label><span className="sr-only">{label} video capacity</span><input aria-label={`${label} video capacity`} type="number" min={1} max={30} value={Math.min(plan.dailyCapacity, 30)} disabled={busy || !plan.enabled} onChange={(event) => updateDay(key, { dailyCapacity: Math.min(30, Number(event.target.value)) })} style={{ ...field, width: 86 }} /></label></td>
            <td style={{ padding: 8 }}><label><span className="sr-only">{label} first upload time</span><input aria-label={`${label} first upload time`} type="time" value={clock(plan.startMinute)} disabled={busy || !plan.enabled} onChange={(event) => updateDay(key, { startMinute: minutes(event.target.value) })} style={{ ...field, width: 112 }} /></label></td>
            <td style={{ padding: 8 }}><label><span className="sr-only">{label} upload window end</span><input aria-label={`${label} upload window end`} type="time" value={clock(plan.endMinute)} disabled={busy || !plan.enabled} onChange={(event) => updateDay(key, { endMinute: minutes(event.target.value) })} style={{ ...field, width: 112 }} /></label></td>
          </tr>; })}</tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}><button className="v2-btn v2-btn-primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving upload plan…" : "Save weekly upload plan"}</button></div>
      <p style={{ margin: 0, color: "var(--v2-text-2)", fontSize: 12 }}>Changes apply only to new reservations. Existing Studio reservations and externally scheduled YouTube videos stay unchanged.</p>
    </div>}
  </details>;
}
