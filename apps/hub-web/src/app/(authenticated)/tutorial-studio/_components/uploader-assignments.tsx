"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
type Channel = { id: string; name: string; language: string; uploaderIds: string[] };
type Uploader = { id: string; name: string | null; email: string };
export function UploaderAssignments() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [uploaders, setUploaders] = useState<Uploader[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [selected, setSelected] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { void fetch("/api/production/uploader-assignments").then(response => response.json()).then(data => { setCanManage(Boolean(data.canManage)); setChannels(data.channels ?? []); setUploaders(data.uploaders ?? []); }).catch(() => { /* Optional Admin control does not block manual work. */ }); }, []);
  if (!canManage) return null;
  const selectChannel = (id: string) => { setSelected(id); setIds(channels.find(channel => channel.id === id)?.uploaderIds ?? []); };
  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/production/uploader-assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channelId: selected, uploaderIds: ids }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Assignment failed");
      setChannels(previous => previous.map(channel => channel.id === selected ? { ...channel, uploaderIds: ids } : channel));
      toast.success("Uploader assignments saved.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Assignment failed"); }
    finally { setSaving(false); }
  };
  return <details style={{ padding: 12, border: "1px solid var(--v2-border-1)", borderRadius: 8 }}>
    <summary>Admin · VA uploader channel access</summary>
    <p>Assign the primary channel and each language channel this VA should deliver. Unchecked users lose access to this channel; production ownership is unchanged.</p>
    <select aria-label="Uploader assignment channel" value={selected} disabled={saving} onChange={event => selectChannel(event.target.value)} style={{ padding: 8, background: "var(--v2-surface-2)", color: "var(--v2-text-1)" }}><option value="">Choose a channel</option>{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name} · {channel.language}</option>)}</select>
    {selected && <div style={{ display: "grid", gap: 8, marginTop: 12 }}>{uploaders.length === 0 && <p>No active uploader VA accounts. Create or migrate those accounts in user administration first.</p>}{uploaders.map(user => <label key={user.id}><input type="checkbox" disabled={saving} checked={ids.includes(user.id)} onChange={event => setIds(previous => event.target.checked ? [...previous, user.id] : previous.filter(id => id !== user.id))} /> {user.name ?? user.email}</label>)}<button type="button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save uploader access"}</button></div>}
  </details>;
}
