"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { V2Button } from "../../_components";
import styles from "./thumbnail-workspace.module.css";
import { ThumbnailPreviewImage } from "@/components/thumbnails/thumbnail-preview-image";
import { LanguageFlag } from "@/components/language-flag";
import { thumbnailPreviewStatus } from "@/lib/thumbnails/preview-status";
import { THUMBNAIL_LANGUAGE_NAMES as languageNames, THUMBNAIL_COLUMN_WIDTH, thumbnailEditorUrl, hasCompleteThumbnailPack } from "@/lib/thumbnails/workspace-model";

type Variant = { language: string; jobId: string | null; status: string; thumbnailId: string | null; approved: boolean; reasons: string[] };
type Row = { id: string; title: string; channelName: string | null; variants: Variant[]; approved: boolean };
type Cursor = { before: string; beforeId: string };

export function ThumbnailBatchGrid() {
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [previewSize, setPreviewSize] = useState<"compact" | "comfortable" | "large">("compact");
  const [pendingOnly, setPendingOnly] = useState(true);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [busy, setBusy] = useState(true);
  const [approving, setApproving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedPreviews, setFailedPreviews] = useState<Record<string, boolean>>({});
  const requestVersion = useRef(0);
  const load = useCallback(async (next?: Cursor) => {
    const version = ++requestVersion.current;
    setBusy(true); setError(null);
    if (!next) { setRows([]); setCursor(null); }
    try {
      const params = new URLSearchParams({ q: query, ...(next ?? {}) });
      const response = await fetch(`/api/production/thumbnail-batches?${params}`);
      const data = await response.json();
      if (version !== requestVersion.current) return;
      if (!response.ok) throw new Error(data.error ?? "Could not load thumbnail batches");
      setRows((previous) => next ? [...previous, ...data.rows.filter((row: Row) => !previous.some((item) => item.id === row.id))] : data.rows);
      setCursor(data.nextCursor);
    } catch (err) { if (version === requestVersion.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { if (version === requestVersion.current) setBusy(false); }
  }, [query]);
  useEffect(() => { const timer = setTimeout(() => void load(), 250); return () => { clearTimeout(timer); requestVersion.current++; }; }, [load]);
  const visible = rows.filter((row) => !pendingOnly || !row.approved);
  const languages = ["en", ...Array.from(new Set(visible.flatMap((row) => row.variants.map((variant) => variant.language)).filter((language) => language !== "en")))];
  const languageName = (language: string) => languageNames[language] ?? language.toUpperCase();
  async function approve(row: Row) {
    setApproving(row.id);
    try {
      const response = await fetch("/api/thumbnails/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thumbnailIds: row.variants.map((variant) => variant.thumbnailId) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not approve pack");
      setRows((previous) => previous.map((item) => item.id === row.id ? { ...item, approved: true, variants: item.variants.map((variant) => ({ ...variant, approved: true })) } : item));
      toast.success("Thumbnail pack approved. The worker will start localization when the source is ready.");
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
    finally { setApproving(null); }
  }
  return <section className={styles.workspace} aria-label="Language comparison">
    <div className={styles.toolbar}>
      <label className={styles.search}>Find a tutorial<input placeholder="Search software or tutorial title…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className={styles.sizes} role="group" aria-label="Thumbnail preview size">{(["compact", "comfortable", "large"] as const).map((size) => <button type="button" key={size} aria-pressed={previewSize === size} onClick={() => setPreviewSize(size)}>{size === "compact" ? "Overview" : size === "comfortable" ? "Detailed" : "Large"}</button>)}</div>
      <label><input type="checkbox" checked={pendingOnly} onChange={(event) => setPendingOnly(event.target.checked)} /> Pending only</label>
      <V2Button variant="outline" disabled={busy} onClick={() => void load()}>Refresh</V2Button>
    </div>
    {error && <p role="alert">{error} <button onClick={() => void load()}>Retry</button></p>}
    <p className={styles.hint} id="thumbnail-matrix-help">{visible.length} {visible.length === 1 ? "tutorial" : "tutorials"} · Compare the pack here; click an image to edit. Use Detailed for larger previews.</p>
    <div className={styles.viewport} tabIndex={0} role="region" aria-label="Tutorial thumbnails by language" aria-describedby="thumbnail-matrix-help">
      <table className={styles.matrix}>
        <thead><tr><th scope="col" className={styles.context}>Tutorial / approval</th>{languages.map((language) => <th scope="col" key={language} style={{ width: THUMBNAIL_COLUMN_WIDTH[previewSize], minWidth: THUMBNAIL_COLUMN_WIDTH[previewSize] }}><LanguageFlag language={language} /> {languageName(language)}</th>)}</tr></thead>
        <tbody>{visible.map((row) => <tr key={row.id}>
          <th scope="row" className={styles.context}><p className={styles.title}>{row.title}</p><p className={styles.channel}>{row.channelName ?? "Channel not assigned"}</p><a className={styles.link} href={thumbnailEditorUrl(row.id)}>Open full editor</a><p className={styles.hint}>{row.variants.filter((variant) => variant.approved).length} / {row.variants.length} approved</p><button className={styles.approve} type="button" disabled={approving !== null || row.approved || !hasCompleteThumbnailPack(row.variants, row.variants.map((variant) => variant.language))} onClick={() => void approve(row)}>{approving === row.id ? "Approving row…" : row.approved ? "Row approved" : "Approve language pack"}</button>{row.variants.some((variant) => !variant.thumbnailId) && <p className={styles.hint}>Prepare every configured language image before approving.</p>}</th>
          {languages.map((language) => { const variant = row.variants.find((item) => item.language === language); const editorUrl = thumbnailEditorUrl(row.id, language); return <td key={language}>
            <a className={styles.preview} href={editorUrl} aria-label={`Edit ${languageName(language)} thumbnail for ${row.title}`}>
              {variant?.thumbnailId ? <ThumbnailPreviewImage src={`/api/thumbnails/image/${variant.thumbnailId}`} alt={`${languageName(language)} thumbnail for ${row.title}`} width={THUMBNAIL_COLUMN_WIDTH[previewSize] - 22} height={(THUMBNAIL_COLUMN_WIDTH[previewSize] - 22) * 9 / 16} onAvailabilityChange={available => setFailedPreviews(previous => previous[variant.thumbnailId!] === !available ? previous : { ...previous, [variant.thumbnailId!]: !available })} /> : <div className={styles.placeholder}><strong>{language === "en" ? "Create source" : "Prepare language"}</strong><span className={styles.hint}>{language === "en" ? "Open thumbnail editor" : "Use the English layout"}</span></div>}
            </a><div className={styles.cellFooter}><span className={styles.status} role="status">{thumbnailPreviewStatus({ approved: Boolean(variant?.approved), hasThumbnail: Boolean(variant?.thumbnailId), previewFailed: Boolean(variant?.thumbnailId && failedPreviews[variant.thumbnailId]) })}</span><a className={styles.link} href={editorUrl}>Edit {languageName(language)}</a></div>
          </td>; })}
        </tr>)}</tbody>
      </table>
    </div>
    {!visible.length && <p>{busy ? "Loading thumbnail batches…" : cursor ? "No pending packs in the loaded rows. Load more to continue." : pendingOnly ? "No pending thumbnail packs in this search." : "No recorded tutorials in this search."}</p>}
    {cursor && <V2Button variant="outline" disabled={busy} onClick={() => void load(cursor)}>{busy ? "Loading…" : "Load more tutorials"}</V2Button>}
  </section>;
}
