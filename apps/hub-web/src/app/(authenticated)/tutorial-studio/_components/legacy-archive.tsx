"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
type Row = {
  id: string;
  sourceSystem: string;
  sourceTable: string;
  sourceId: string;
  sourceParentId: string | null;
  ownerLabel: string;
  routingBlocker: string | null;
  title: string;
  language: string | null;
  status: string;
  needsRouting: boolean;
  assignedChannelId: string | null;
  runtimeJobId: string | null;
  routingState: string;
  channelOptions: Array<{ id: string; name: string; language: string }>;
};
export function LegacyArchive() {
  const [rows, setRows] = useState<Row[]>([]);
  const [canRoute, setCanRoute] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [after, setAfter] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [channelId, setChannelId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        q,
        filter,
        ...(after ? { after } : {}),
      });
      const response = await fetch(`/api/production/legacy-archive?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Archive unavailable");
      setRows(data.rows ?? []);
      setCanRoute(Boolean(data.canRoute));
      setNext(data.nextCursor ?? null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Archive unavailable");
    }
  }, [q, filter, after]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);
  const assign = async (archiveId: string) => {
    setSaving(true);
    try {
      const response = await fetch("/api/production/legacy-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archiveId, channelId, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Routing failed");
      toast.success("Assigned for migration; no job was resumed or enqueued.");
      setEditing(null);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Routing failed");
    } finally {
      setSaving(false);
    }
  };
  return (
    <details
      style={{
        padding: 16,
        border: "1px solid var(--v2-border-1)",
        borderRadius: 10,
      }}
    >
      <summary>Imported history & migration routing</summary>
      <p>
        Historical source status is preserved, not proof of final review or
        publication. Raw source data and credentials are never shown here.
        Assigned archive records still need migration/resume checks; routing
        does not start processing.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          aria-label="Search imported history"
          value={q}
          maxLength={200}
          placeholder="Search title or source status"
          onChange={(event) => {
            setQ(event.target.value);
            setAfter(null);
          }}
        />
        <select
          aria-label="Imported history filter"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setAfter(null);
          }}
        >
          <option value="all">All authorized history</option>
          <option value="unrouted">Needs Admin routing</option>
        </select>
        <button type="button" onClick={() => void load()}>
          Refresh history
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!error && rows.length === 0 && (
        <p>No imported records match this view.</p>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", textAlign: "left", fontSize: 12 }}>
          <thead>
            <tr>
              <th>Tutorial / source</th>
              <th>Original status</th>
              <th>Migration state</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={{ padding: 10 }}>
                  <strong>{row.title}</strong>
                  <div>{row.ownerLabel}</div>
                  <div>
                    {row.sourceSystem} · {row.sourceTable} ·{" "}
                    {row.language ?? "Unknown language"}
                  </div>
                  <small>
                    Source ID: {row.sourceId}
                    {row.sourceParentId
                      ? ` · Source parent: ${row.sourceParentId}`
                      : ""}
                  </small>
                </td>
                <td>{row.status}</td>
                <td>
                  {row.assignedChannelId
                    ? "Assigned for migration; not resumed"
                    : row.needsRouting
                      ? "Admin routing required"
                      : "Read-only historical record"}
                  {canRoute && row.needsRouting && !row.assignedChannelId && (
                    <div>
                      {editing !== row.id ? (
                        <button
                          type="button"
                          disabled={
                            saving ||
                            row.channelOptions.length === 0 ||
                            Boolean(row.sourceParentId)
                          }
                          onClick={() => {
                            setEditing(row.id);
                            setChannelId("");
                            setReason("");
                          }}
                        >
                          Assign migration channel
                        </button>
                      ) : (
                        <div>
                          <select
                            aria-label="Migration destination channel"
                            value={channelId}
                            disabled={saving}
                            onChange={(event) =>
                              setChannelId(event.target.value)
                            }
                          >
                            <option value="">
                              Choose producer's assigned channel
                            </option>
                            {row.channelOptions.map((channel) => (
                              <option key={channel.id} value={channel.id}>
                                {channel.name} · {channel.language}
                              </option>
                            ))}
                          </select>
                          <input
                            aria-label="Migration routing reason"
                            value={reason}
                            maxLength={1000}
                            disabled={saving}
                            placeholder="Why this destination is correct"
                            onChange={(event) => setReason(event.target.value)}
                          />
                          <button
                            type="button"
                            disabled={
                              saving || !channelId || reason.trim().length < 5
                            }
                            onClick={() => void assign(row.id)}
                          >
                            Save assignment only
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                      {row.channelOptions.length === 0 && !row.routingBlocker && (
                        <small>
                          Import/activate the original producer and assign an
                          enabled primary channel first.
                        </small>
                      )}
                      {row.routingBlocker && (
                        <small>{row.routingBlocker}</small>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        {rows.length} records on this page{" "}
        <button type="button" disabled={!after} onClick={() => setAfter(null)}>
          First page
        </button>{" "}
        <button type="button" disabled={!next} onClick={() => setAfter(next)}>
          Next page
        </button>
      </div>
    </details>
  );
}
