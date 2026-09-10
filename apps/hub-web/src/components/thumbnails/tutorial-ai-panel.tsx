"use client";
import { useEffect, useRef, useState } from "react";
import { ThumbnailPreviewImage } from "./thumbnail-preview-image";
type Candidate = { id: string; requestId?: string | null; status: string; selected: boolean; approved: boolean; error: string | null; imageUrl: string | null; score?: number | null; notes?: string | null; provider?: string | null; fallback?: boolean; resolution?: string; referenceKinds?: string[]; parentId?: string | null };
type BatchProgress = { requestId: string; count: number; completed: number; variants: Array<{ index: number; state: string }> };
export function TutorialAiPanel({ jobId, top, bottom, hasUnsavedEdits }: { jobId: string; top: string; bottom: string; hasUnsavedEdits: boolean }) {
  const [instructions, setInstructions] = useState("");
  const [resolution, setResolution] = useState("1k");
  const [parentId, setParentId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [language, setLanguage] = useState("");
  const [sourceId, setSourceId] = useState(jobId);
  const [provider, setProvider] = useState<{ ready: boolean | null; reason: string } | null>(null);
  const [localization, setLocalization] = useState<Array<{ language: string; state: string; error: string | null }>>([]);
  const [reconciliationCount, setReconciliationCount] = useState(0);
  const [quality, setQuality] = useState<Record<string, { status: string; issues: string[]; repairInstructions: string | null } | null>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fullView, setFullView] = useState<Candidate | null>(null);
  const [batches, setBatches] = useState<BatchProgress[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [localeIdentityVerified, setLocaleIdentityVerified] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const qualityRequested = useRef(new Set<string>());
  const requestId = useRef<string | null>(null);
  const localeRetryIds = useRef<Record<string, string>>({});
  const english = language.toLowerCase() === "en" && sourceId === jobId;
  useEffect(() => {
    setCandidates([]); setBatches([]); setProvider(null); setEnabled(false); setLanguage(""); setSourceId(jobId); setLocalization([]); setLocaleIdentityVerified(false); setQuality({}); setShowHistory(false); setFullView(null); qualityRequested.current.clear();
    const controller = new AbortController();
    const load = async () => { try { const response = await fetch(`/api/production/jobs/${jobId}/thumbnail/ai`, { signal: controller.signal }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not load candidates"); if (!controller.signal.aborted) { setCandidates(result.candidates); setEnabled(result.enabled); setLanguage(result.language); setSourceId(result.sourceJobId); setProvider(result.providerReadiness); setLocalization(result.localization ?? []); setBatches(result.batchProgress ?? []); setLocaleIdentityVerified(result.localizationIdentityVerified === true); setReconciliationCount(result.reconciliation?.length ?? 0); } } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Candidates unavailable"); } };
    void load(); const timer = setInterval(() => void load(), 5000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [jobId]);
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setFullView(null); }; window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape); }, []);
  useEffect(() => {
    if (!fullView) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLButtonElement>("button")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]'));
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { document.removeEventListener("keydown", trap); if (previous?.isConnected) previous.focus(); };
  }, [fullView]);
  useEffect(() => {
    const controller = new AbortController();
    for (const candidate of candidates.filter(item => item.imageUrl && !qualityRequested.current.has(`${jobId}:${item.id}`))) {
      qualityRequested.current.add(`${jobId}:${candidate.id}`);
      void fetch(`/api/production/jobs/${jobId}/thumbnail/ai?quality=${candidate.id}`, { signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error("Quality unavailable");
        const result = await response.json();
        if (!controller.signal.aborted) setQuality(previous => ({ ...previous, [candidate.id]: result.quality ?? null }));
      }).catch(() => { qualityRequested.current.delete(`${jobId}:${candidate.id}`); });
    }
    return () => controller.abort();
  }, [jobId, candidates]);
  async function generate(retryThumbnailId?: string) {
    setBusy(true); setMessage(null); requestId.current ??= crypto.randomUUID();
    try { const response = await fetch(`/api/production/jobs/${jobId}/thumbnail/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: requestId.current, instructions, top, bottom, resolution, ...(retryThumbnailId ? { retryThumbnailId } : parentId ? { parentThumbnailId: parentId } : {}) }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); requestId.current = null; setMessage(`${result.count} candidate(s) queued. Click the image you want to approve; previous approved images remain stored.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Request failed. Retry uses the same request identity."); }
    finally { setBusy(false); }
  }
  async function loadQuality(candidate: Candidate) {
    try { const response = await fetch(`/api/production/jobs/${jobId}/thumbnail/ai?quality=${candidate.id}`); const result = await response.json(); if (!response.ok) throw new Error(result.error); setQuality(previous => ({ ...previous, [candidate.id]: result.quality })); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Quality report unavailable"); }
  }
  async function retryLocale(locale: string) {
    if (busy) return;
    setBusy(true); setMessage(null);
    localeRetryIds.current[locale] ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/production/jobs/${sourceId}/thumbnail/ai/locales/${encodeURIComponent(locale)}/retry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: localeRetryIds.current[locale] }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Retry could not be recorded");
      delete localeRetryIds.current[locale];
      setLocalization(items => items.map(item => item.language === locale ? { ...item, state: result.state, error: null } : item));
      setMessage(`${locale.toUpperCase()} retry recorded (${result.state}). This may use provider credit; no additional attempts will be made automatically after an uncertain result.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Retry failed; retrying this action keeps its request identity."); }
    finally { setBusy(false); }
  }
  async function choose(candidate: Candidate) {
    if (hasUnsavedEdits && !window.confirm("Leave unsaved procedural edits and approve this AI image?")) return;
    setBusy(true); setMessage(null);
    try {
      if (english) { const prepared = await fetch(`/api/production/jobs/${sourceId}/thumbnail-drafts`, { method: "POST" }); if (!prepared.ok) { const error = await prepared.json(); throw new Error(error.error ?? "Language drafts could not be prepared."); } }
      const response = await fetch(`/api/production/jobs/${jobId}/thumbnail/ai/choose`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thumbnailId: candidate.id }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Approval failed");
      setCandidates(items => items.map(item => ({ ...item, selected: item.id === candidate.id, approved: item.id === candidate.id ? true : item.approved })));
      setMessage(result.localizationRecorded ? `English approved. Localization recorded for ${(result.languages ?? []).join(", ") || "no configured destinations"}.${result.blockedLocales?.length ? ` Blocked locales: ${result.blockedLocales.join(", ")}. Ask an Admin to resolve their channel mapping.` : " Review images as they finish."}` : "Localized image approved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not approve candidate"); }
    finally { setBusy(false); }
  }
  const buttonStyle = { display: "block", padding: 0, width: "100%", border: 0, background: "transparent", cursor: "pointer" };
  const currentBatch = english ? batches[0] : undefined;
  const displayedCandidates = currentBatch ? candidates.filter(candidate => showHistory ? candidate.requestId !== currentBatch.requestId : candidate.requestId === currentBatch.requestId) : candidates;
  return <section style={{ padding: 14, border: "1px solid var(--v2-border-2)", borderRadius: 8, background: "var(--v2-surface-1)" }}>
    <h2 style={{ margin: "0 0 8px", fontSize: 17 }}>{english ? "Choose your English master" : "Localized thumbnails"}</h2>
    <p style={{ fontSize: 13, color: "var(--v2-text-2)" }}>{english ? "Five English options → click one to approve → localize its exact image. Quality checks advise; you decide." : "These images derive from the approved English master. Click a completed image to approve this language."}</p>
    <p role="status" style={{ fontSize: 13 }}>{provider?.reason ?? "Checking provider availability…"} Saved images remain available for review; generation availability does not prove any queued request has finished.</p>
    {!localeIdentityVerified && <p style={{ fontSize: 13 }}>Current English image identity is not verified yet. Approve an English master or ask an Admin to restore its exact saved image; older localization receipts are not shown as current.</p>}
    {currentBatch && <div style={{ fontSize: 13 }}><p>Current {currentBatch.count === 1 ? "refinement" : "English batch"}: {currentBatch.completed} of {currentBatch.count} saved images completed.</p><p>{currentBatch.variants.map(item => `Option ${item.index + 1}: ${item.state.replaceAll("_", " ")}`).join(" · ")}</p>{currentBatch.variants.some(item => ["waiting_unknown", "reconciliation_required"].includes(item.state)) && <p>Progress is unconfirmed. Ask an Admin to inspect this saved request; do not submit another paid request for an unknown outcome. Elapsed time does not authorize a retry.</p>}<button type="button" className="v2-btn" onClick={() => setShowHistory(value => !value)}>{showHistory ? "Show current batch" : "Show previous candidate history"}</button>{showHistory && <p>Previous candidates — not current batch progress.</p>}</div>}
    {!english && sourceId !== jobId && <a className="v2-btn" href={`/thumbnails?tab=composer&jobId=${sourceId}&language=en`}>Open English master</a>}
    {english && <details open={!candidates.length}><summary>Generate or refine candidates</summary>
      <p style={{ fontSize: 13 }}>Copy: {[top, bottom].filter(Boolean).join(" / ") || "Headline missing"} · four words maximum</p>
      {parentId && <p style={{ fontSize: 13 }}>Using exact reference image. <button type="button" className="v2-btn" onClick={() => { setParentId(null); requestId.current = null; }}>Return to five new options</button></p>}
      <label style={{ display: "grid", gap: 6, fontSize: 13 }}>Instructions<textarea value={instructions} onChange={event => { setInstructions(event.target.value); requestId.current = null; }} rows={2} maxLength={2000} placeholder="Describe layout, imagery, or copy changes." style={{ padding: 10, background: "var(--v2-surface-2)", color: "var(--v2-text-1)", border: "1px solid var(--v2-border-2)", borderRadius: 6 }} /></label>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}><label>Resolution <select aria-label="AI output resolution" value={resolution} onChange={event => { setResolution(event.target.value); requestId.current = null; }}><option value="1k">1K</option><option value="2k">2K</option><option value="4k">4K</option></select></label><button className="v2-btn" type="button" disabled={busy || !enabled || provider?.ready === false || !top.trim() || `${top} ${bottom}`.trim().split(/\s+/).length > 4 || Boolean(parentId && !instructions.trim())} onClick={() => void generate()}>{busy ? "Working…" : parentId ? "Generate one refinement" : "Generate five English options"}</button></div>
      <p style={{ fontSize: 12, color: "var(--v2-text-2)" }}>Uses provider credit. {provider?.reason ?? "Checking provider availability…"}</p>
    </details>}
    {!enabled && <p style={{ fontSize: 13 }}>AI generation is disabled by Admin settings, or settings are loading.</p>}
    {message && <p role="status" style={{ fontSize: 13 }}>{message}</p>}
    {reconciliationCount > 0 && <p role="status" style={{ fontSize: 13 }}>{reconciliationCount} English attempt(s) admitted: awaiting result or reconciliation. No saved output is confirmed yet; this may still be in progress. If the worker has stopped, ask an Admin to reconcile the outcome. Do not submit a paid retry for an unknown result.</p>}
    {localization.length > 0 && <details open={localization.some(item => ["failed", "uncertain"].includes(item.state))}><summary>Localization progress</summary>{localization.filter((item, index, all) => all.findIndex(other => other.language === item.language) === index).map(item => <div key={item.language} style={{ fontSize: 13, marginBottom: 8 }}><p>{item.language.toUpperCase()}: {item.state}{item.error ? ` — ${item.error}` : ""}{item.state === "uncertain" ? " · Admin reconciliation required; another paid request is blocked." : ""}</p>{item.state === "failed" && <button type="button" className="v2-btn" disabled={busy || !enabled || provider?.ready === false} onClick={() => void retryLocale(item.language)}>Retry {item.language.toUpperCase()} once</button>}</div>)}</details>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: 12, marginTop: 12 }}>{displayedCandidates.map(candidate => <article key={candidate.id} style={{ border: candidate.selected ? "2px solid var(--v2-accent)" : "1px solid var(--v2-border-2)", borderRadius: 7, padding: 8 }}>
      <p style={{ fontSize: 13 }}>Saved quality check: {quality[candidate.id]?.status ?? "Unverified — inspect carefully"}. Human approval required.</p>
      {quality[candidate.id]?.issues.map(issue => <p key={issue} style={{ fontSize: 13, color: "var(--v2-warning, var(--v2-text-1))" }}>Quality warning: {issue}</p>)}
      <button type="button" aria-label={candidate.selected && candidate.approved ? "Approved thumbnail" : "Approve this thumbnail"} disabled={busy || candidate.status !== "completed" || !candidate.imageUrl || (candidate.selected && candidate.approved)} onClick={() => void choose(candidate)} style={buttonStyle}>{candidate.imageUrl ? <ThumbnailPreviewImage src={candidate.imageUrl} alt="Click to approve this thumbnail" style={{ display: "block", width: "100%", aspectRatio: "16/9", objectFit: "contain" }} /> : <span>{candidate.status === "failed" ? candidate.error ?? "Generation failed" : `${candidate.status}…`}</span>}</button>
      <p style={{ fontSize: 13, margin: "8px 0" }}>{candidate.selected && candidate.approved ? "Approved" : "Click image to approve"} · {candidate.resolution ?? "Resolution pending"} · {candidate.provider ?? "Provider pending"}{candidate.fallback ? " · Fallback used" : ""}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="v2-btn" type="button" disabled={!candidate.imageUrl} onClick={() => setFullView(candidate)}>View full size</button>{english && candidate.imageUrl && <button className="v2-btn" type="button" onClick={() => { setParentId(candidate.id); setInstructions(candidate.notes ?? ""); requestId.current = null; setMessage("Reference selected. Open Generate or refine candidates, describe changes, then generate one refinement."); }}>Refine this image</button>}</div>
      {english && candidate.status === "failed" && <p style={{ fontSize: 13 }}>Admin reconciliation required before retry: this failure does not establish whether the provider produced an image.</p>}
      <details><summary>Quality & references</summary><button type="button" className="v2-btn" disabled={!candidate.imageUrl} onClick={() => void loadQuality(candidate)}>Check saved quality report</button><p style={{ fontSize: 12 }}>Current-byte report: {quality[candidate.id]?.status ?? "Unverified"}. Human approval is always required.</p>{quality[candidate.id]?.issues.map(issue => <p key={issue} style={{ fontSize: 12 }}>{issue}</p>)}{quality[candidate.id]?.repairInstructions && english && <button type="button" className="v2-btn" onClick={() => { setParentId(candidate.id); setInstructions(quality[candidate.id]!.repairInstructions!); requestId.current = null; }}>Use suggested repair instructions</button>}<p style={{ fontSize: 12 }}>References: {candidate.referenceKinds?.join(", ") || "None recorded"}{candidate.parentId ? "; exact parent image" : ""}.</p></details>
    </article>)}</div>
    {fullView?.imageUrl && <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Full size thumbnail" style={{ position: "fixed", inset: 24, zIndex: 100, padding: 16, background: "var(--v2-surface-1)", border: "2px solid var(--v2-border-2)", overflow: "auto" }}><button type="button" className="v2-btn" onClick={() => setFullView(null)}>Close full size</button><ThumbnailPreviewImage src={fullView.imageUrl} alt="Full resolution candidate" style={{ display: "block", width: "100%", height: "calc(100dvh - 140px)", maxHeight: "calc(100dvh - 140px)", objectFit: "contain", marginTop: 12 }} /></div>}
  </section>;
}
