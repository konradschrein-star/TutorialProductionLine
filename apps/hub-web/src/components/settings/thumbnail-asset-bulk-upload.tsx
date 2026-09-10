"use client";

import { useState } from "react";
import { toast } from "sonner";

type Category = "LOGOS" | "SYMBOLS" | "BGS" | "PERSONAS";

export function ThumbnailAssetBulkUpload() {
  const [category, setCategory] = useState<Category>("LOGOS");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number; failures: string[] } | null>(null);

  async function upload() {
    if (!files.length) return;
    setProgress({ done: 0, total: files.length, failures: [] });
    const failures: string[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      const body = new FormData();
      body.append("file", file);
      body.append("category", category);
      body.append("name", file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
      try {
        const response = await fetch("/api/thumbnails/assets", { method: "POST", body });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) failures.push(`${file.name}: ${result.error ?? `HTTP ${response.status}`}`);
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : "upload failed"}`);
      }
      setProgress({ done: index + 1, total: files.length, failures: [...failures] });
    }
    if (failures.length) toast.error(`${failures.length} asset${failures.length === 1 ? "" : "s"} could not be uploaded.`);
    else toast.success(`${files.length} assets added to the shared library.`);
    setFiles([]);
  }

  return <section aria-labelledby="asset-upload-title" style={{ display: "grid", gap: 12 }}>
    <div><h3 id="asset-upload-title" style={{ margin: 0, fontSize: 15 }}>Bulk asset intake</h3><p style={{ margin: "4px 0 0", color: "var(--v2-text-2)" }}>Add logos, symbols, backgrounds or host cut-outs to the reusable workspace library. Channel-specific rotation is configured separately.</p></div>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(170px,220px) minmax(260px,1fr) auto", gap: 10, alignItems: "end" }}>
      <label>Asset type<select value={category} onChange={(event) => setCategory(event.target.value as Category)}><option value="LOGOS">Software logos</option><option value="SYMBOLS">Symbols and arrows</option><option value="BGS">Backgrounds</option><option value="PERSONAS">Host cut-outs</option></select></label>
      <label>Image files<input type="file" multiple accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /></label>
      <button type="button" className="v2-btn v2-btn-primary" disabled={!files.length || Boolean(progress && progress.done < progress.total)} onClick={() => void upload()}>{progress && progress.done < progress.total ? `Uploading ${progress.done}/${progress.total}` : `Upload ${files.length || ""} file${files.length === 1 ? "" : "s"}`}</button>
    </div>
    {progress?.failures.length ? <div role="alert" tabIndex={-1} style={{ padding: 10, border: "1px solid var(--v2-error-soft)", borderRadius: 8 }}><strong>Some files need attention</strong><ul>{progress.failures.map((failure) => <li key={failure}>{failure}</li>)}</ul></div> : null}
  </section>;
}
