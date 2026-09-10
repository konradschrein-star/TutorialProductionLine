"use client";

import { useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { V2Button } from "../../_components";
import { keywordCsvTemplate, parseKeywordCsv, type KeywordCsvRow } from "@/lib/tutorial/keyword-csv";

type Row = KeywordCsvRow & { id: string };
type Channel = { id: string; name: string; language: string };
const emptyRow = (): Row => ({ id: crypto.randomUUID(), keyword: "", channel: "", steps: "", reference_url: "", mode: "THREE_MIN", source_mode: "" });
const input: CSSProperties = { width: "100%", minHeight: 40, border: "1px solid var(--v2-border-1)", borderRadius: 8, background: "var(--v2-surface-1)", color: "var(--v2-text-1)", padding: "8px 10px", fontSize: 13 };

export function KeywordDirectIntake({ channels }: { channels: Channel[] }) {
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [defaultChannelId, setDefaultChannelId] = useState(channels[0]?.id ?? "");
  const [errors, setErrors] = useState<Array<{ row: number; field: string; message: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Array<{ row: number; jobId: string; duplicate: boolean }>>([]);
  const [batchKey, setBatchKey] = useState(() => crypto.randomUUID());
  const errorRef = useRef<HTMLDivElement>(null);

  const patchRow = (id: string, patch: Partial<Row>) => setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row));
  const meaningful = rows.filter(row => row.keyword.trim());

  async function readFile(file: File) {
    if (file.size > 2_000_000) { toast.error("CSV files are limited to 2 MB."); return; }
    try {
      const parsed = parseKeywordCsv(await file.text());
      if (!parsed.length) throw new Error("The CSV has headers but no keyword rows.");
      if (parsed.length > 200) throw new Error("Import at most 200 keywords at a time.");
      setRows(parsed.map(row => ({ ...row, id: crypto.randomUUID() })));
      setErrors([]); setCreated([]); setBatchKey(crypto.randomUUID());
      toast.success(`${parsed.length} keyword${parsed.length === 1 ? "" : "s"} ready to review.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([keywordCsvTemplate()], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "tutorial-keywords-template.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  async function submit() {
    if (!defaultChannelId) { toast.error("Choose the default destination channel first."); return; }
    if (!meaningful.length) { toast.error("Add at least one keyword."); return; }
    setBusy(true); setErrors([]); setCreated([]);
    try {
      const response = await fetch("/api/production/keywords/bulk-intake", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ batchKey, defaultChannelId, rows: meaningful.map(({ id: _id, ...row }) => row) }),
      });
      const body = await response.json();
      if (!response.ok && response.status !== 207) {
        setErrors(body.errors ?? [{ row: 0, field: "file", message: body.error ?? "Import failed." }]);
        queueMicrotask(() => errorRef.current?.focus());
        return;
      }
      setCreated(body.created ?? []); setErrors(body.errors ?? []);
      if ((body.created?.length ?? 0) > 0) toast.success(`${body.created.length} tutorial${body.created.length === 1 ? "" : "s"} sent to script preparation.`);
      if (!(body.errors?.length)) { setRows([emptyRow()]); setBatchKey(crypto.randomUUID()); }
    } catch (error) {
      setErrors([{ row: 0, field: "connection", message: error instanceof Error ? error.message : String(error) }]);
      queueMicrotask(() => errorRef.current?.focus());
    } finally { setBusy(false); }
  }

  return <div style={{ display: "grid", gap: 16 }}>
    <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(280px,.8fr)", gap: 16, alignItems: "stretch" }}>
      <div style={{ padding: 20, border: "1px solid var(--v2-border-1)", borderRadius: 12, background: "var(--v2-surface-2)" }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Upload a keyword CSV</h2>
        <p style={{ margin: "6px 0 16px", color: "var(--v2-text-2)", fontSize: 13, lineHeight: 1.55 }}>Choose a file, review every row below, then send the valid batch into the same script pipeline used by Prepare scripts.</p>
        <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
          CSV file
          <input aria-label="Keyword CSV file" type="file" accept=".csv,text/csv" onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file); event.currentTarget.value = ""; }} style={{ ...input, padding: 7 }} />
        </label>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}><V2Button variant="outline" onClick={downloadTemplate}>Download CSV template</V2Button><V2Button variant="outline" onClick={() => setRows(current => [...current, emptyRow()])}>Add keyword manually</V2Button></div>
      </div>
      <aside style={{ padding: 20, border: "1px solid var(--v2-border-1)", borderRadius: 12, background: "var(--v2-surface-1)", fontSize: 12, lineHeight: 1.55 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 15 }}>CSV format</h2>
        <div><strong>Required:</strong> <code>keyword</code></div>
        <div style={{ marginTop: 6 }}><strong>Optional:</strong> <code>channel</code>, <code>steps</code>, <code>reference_url</code>, <code>mode</code>, <code>source_mode</code></div>
        <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: "var(--v2-text-2)" }}>
          <li>Use the exact channel name, or leave it blank to use the default.</li>
          <li>Modes: THREE_MIN, SIX_MIN, SHORT_MATCH, SHORT_PLUS.</li>
          <li>Source modes: FROM_SCRATCH or TRANSCRIPT_REWRITE.</li>
          <li>A reference URL automatically selects transcript rewrite; automatic transcript retrieval supports YouTube.</li>
          <li>Maximum 200 rows. Quoted commas and multiline cells are supported.</li>
        </ul>
      </aside>
    </section>

    <label style={{ display: "grid", gap: 6, maxWidth: 420, fontSize: 13, fontWeight: 700 }}>Default destination channel
      <select value={defaultChannelId} onChange={event => setDefaultChannelId(event.target.value)} style={input}>
        {channels.length === 0 && <option value="">No assigned channels</option>}
        {channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name} · {channel.language.toUpperCase()}</option>)}
      </select>
      <span style={{ color: "var(--v2-text-2)", fontSize: 12, fontWeight: 400 }}>A row-level channel overrides this choice.</span>
    </label>

    {errors.length > 0 && <div ref={errorRef} tabIndex={-1} role="alert" style={{ padding: 14, border: "1px solid var(--v2-error-soft)", borderRadius: 10, background: "color-mix(in srgb, var(--v2-error-soft) 8%, transparent)" }}>
      <strong>{created.length ? "Some rows still need attention." : "Nothing was imported. Fix these rows first."}</strong>
      <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>{errors.map((error, index) => <li key={`${error.row}-${error.field}-${index}`}>{error.row ? `CSV row ${error.row}, ` : ""}{error.field}: {error.message}</li>)}</ul>
    </div>}
    {created.length > 0 && <div role="status" style={{ padding: 14, border: "1px solid var(--v2-accent)", borderRadius: 10 }}><strong>{created.length} tutorials queued.</strong> <a href="/tutorial-studio?tab=create" style={{ color: "var(--v2-accent)" }}>Open Prepare scripts</a></div>}

    <div style={{ overflowX: "auto", border: "1px solid var(--v2-border-1)", borderRadius: 12 }}>
      <table style={{ width: "100%", minWidth: 1050, borderCollapse: "collapse", fontSize: 12 }}>
        <thead><tr style={{ textAlign: "left", background: "var(--v2-surface-2)" }}>{["#", "Keyword · required", "Channel override", "Steps", "Reference URL", "Mode", "Source", ""].map(label => <th key={label} style={{ padding: 10 }}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.id} style={{ borderTop: "1px solid var(--v2-border-1)" }}>
          <td style={{ padding: 8, color: "var(--v2-text-2)" }}>{index + 2}</td>
          <td style={{ padding: 8, minWidth: 260 }}><input aria-label={`Keyword row ${index + 2}`} value={row.keyword} onChange={event => patchRow(row.id, { keyword: event.target.value })} style={input} /></td>
          <td style={{ padding: 8, minWidth: 180 }}><input aria-label={`Channel row ${index + 2}`} value={row.channel} placeholder="Use default" onChange={event => patchRow(row.id, { channel: event.target.value })} style={input} /></td>
          <td style={{ padding: 8, minWidth: 220 }}><input aria-label={`Steps row ${index + 2}`} value={row.steps} placeholder="Optional" onChange={event => patchRow(row.id, { steps: event.target.value })} style={input} /></td>
          <td style={{ padding: 8, minWidth: 220 }}><input aria-label={`Reference URL row ${index + 2}`} type="url" value={row.reference_url} placeholder="Optional YouTube URL" onChange={event => patchRow(row.id, { reference_url: event.target.value })} style={input} /></td>
          <td style={{ padding: 8 }}><select aria-label={`Mode row ${index + 2}`} value={row.mode || "THREE_MIN"} onChange={event => patchRow(row.id, { mode: event.target.value })} style={input}>{["THREE_MIN", "SIX_MIN", "SHORT_MATCH", "SHORT_PLUS"].map(value => <option key={value}>{value}</option>)}</select></td>
          <td style={{ padding: 8 }}><select aria-label={`Source mode row ${index + 2}`} value={row.source_mode || (row.reference_url ? "TRANSCRIPT_REWRITE" : "FROM_SCRATCH")} onChange={event => patchRow(row.id, { source_mode: event.target.value })} style={input}><option>FROM_SCRATCH</option><option>TRANSCRIPT_REWRITE</option></select></td>
          <td style={{ padding: 8 }}><button type="button" aria-label={`Remove row ${index + 2}`} onClick={() => setRows(current => current.length === 1 ? [emptyRow()] : current.filter(item => item.id !== row.id))} style={{ minWidth: 40, minHeight: 40, borderRadius: 8, border: "1px solid var(--v2-border-1)", background: "transparent", color: "var(--v2-error-soft)", cursor: "pointer" }}>Remove</button></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}><span style={{ color: "var(--v2-text-2)", fontSize: 12 }}>{meaningful.length} keyword{meaningful.length === 1 ? "" : "s"} ready · all jobs are assigned to your account</span><V2Button variant="accent" disabled={busy || !meaningful.length || !defaultChannelId} onClick={() => void submit()}>{busy ? "Validating and importing…" : `Import ${meaningful.length || ""} keyword${meaningful.length === 1 ? "" : "s"}`}</V2Button></div>
  </div>;
}
