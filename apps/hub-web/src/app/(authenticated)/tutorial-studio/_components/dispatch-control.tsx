"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export function DispatchControl() {
  const [control, setControl] = useState<{ paused: boolean; canManage: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/production/dispatch-control");
      if (!response.ok) throw new Error();
      setControl(await response.json()); setError(false);
    } catch { setError(true); }
  }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 15_000); return () => clearInterval(timer); }, [refresh]);
  async function toggle() {
    if (!control) return;
    setBusy(true);
    try {
      const response = await fetch("/api/production/dispatch-control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused: !control.paused }) });
      if (!response.ok) throw new Error("Could not change dispatch control. Refresh to check the current state.");
      const result = await response.json(); setControl(result);
      toast.success(result.paused ? "New dispatches paused. External uploads were not cancelled." : "New dispatches resumed.");
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); await refresh(); }
    finally { setBusy(false); }
  }
  return <section style={{ padding: 16, border: "1px solid var(--v2-border-1)", borderRadius: 8 }} aria-label="Dispatch safety control">
    <strong>{error ? "Dispatch control status unavailable" : !control ? "Checking dispatch control…" : control.paused ? "New uploader dispatches are paused" : "New uploader dispatches are allowed"}</strong>
    <p style={{ margin: "6px 0", color: "var(--v2-text-2)", fontSize: 13 }}>Pause stops new handoffs. Work already admitted may finish; uploads and publication schedules already with the external uploader are not cancelled. Receipt reconciliation continues.</p>
    {control?.canManage && <button type="button" disabled={busy || error} onClick={() => void toggle()} style={{ padding: "10px 14px", borderRadius: 6, border: "1px solid var(--v2-border-1)", background: control.paused ? "var(--v2-accent)" : "#b42318", color: "white" }}>{busy ? "Saving…" : control.paused ? "Resume new dispatches" : "Emergency pause new dispatches"}</button>}
    {error && <button onClick={() => void refresh()}>Retry status check</button>}
  </section>;
}
