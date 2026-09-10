"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
type Destination = { id: string; name: string; producerIds: string[] };
export function ChannelAssignments() {
  const [channels, setChannels] = useState<Destination[]>([]);
  const [producers, setProducers] = useState<{ id: string; name: string; is_active: boolean }[]>([]);
  const [selected, setSelected] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/production/channel-assignments").then(async (response) => {
    if (!response.ok) throw new Error("Could not load channel assignments");
    const data = await response.json(); setChannels(data.channels); setProducers(data.producers);
  }).catch((error) => toast.error(error.message)); }, []);
  async function save() {
    setBusy(true);
    try {
      const response = await fetch("/api/production/channel-assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channelId: selected, producerIds: ids }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setChannels((previous) => previous.map((channel) => channel.id === selected ? { ...channel, producerIds: data.producerIds } : channel));
      toast.success("Assignments saved. Existing work stays with its owner.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save assignments"); }
    finally { setBusy(false); }
  }
  return <details style={{ padding: 16, border: "1px solid var(--v2-border-1)", borderRadius: 8 }}>
    <summary>Admin · Producer channel assignments</summary>
    <p>Control who can start tutorials on each primary channel. This does not move existing work or change voices.</p>
    <select aria-label="Producer assignment channel" value={selected} disabled={busy} onChange={(event) => { setSelected(event.target.value); setIds(channels.find((channel) => channel.id === event.target.value)?.producerIds ?? []); }}>
      <option value="">Choose a channel</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
    </select>
    {selected && <fieldset disabled={busy} style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 12 }}><legend>Assigned producers</legend>
      {producers.filter((producer) => producer.is_active).map((producer) => <label key={producer.id}><input type="checkbox" checked={ids.includes(producer.id)} onChange={(event) => setIds((previous) => event.target.checked ? [...previous, producer.id] : previous.filter((id) => id !== producer.id))} /> {producer.name}</label>)}
      <button type="button" className="v2-btn" onClick={() => void save()}>Save assignments</button>
    </fieldset>}
  </details>;
}
