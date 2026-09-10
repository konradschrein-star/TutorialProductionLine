"use client";
import { useState } from "react";
import { assetIsInCollection, eligibleBackgrounds } from "@/lib/thumbnails/asset-preferences";
export type CollectionAsset = { key: string; name: string; url: string; category: string; language?: string };
export type AssetPreferences = Record<string, { hidden?: boolean; includeInRotation?: boolean }>;
export function AssetCollection({ assets, preferences, category, onSelect, onPreference, currentBackground }: { assets: CollectionAsset[]; preferences: AssetPreferences; category: string; onSelect: (asset: CollectionAsset) => void; onPreference: (key: string, patch: { hidden?: boolean; includeInRotation?: boolean }) => Promise<void>; currentBackground?: string }) {
  const [global, setGlobal] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = assets.filter(asset => global || assetIsInCollection(asset.key, preferences));
  const backgroundPool = eligibleBackgrounds(assets.filter(asset => asset.category === "BGS"), preferences);
  async function update(key: string, patch: { hidden?: boolean; includeInRotation?: boolean }) { setPending(key); setError(null); try { await onPreference(key, patch); } catch (error) { setError(error instanceof Error ? error.message : "Preference could not be saved"); } finally { setPending(null); } }
  return <div style={{ display: "grid", gap: 10 }}>
    <div style={{ display: "flex", gap: 6 }} role="group" aria-label="Asset collection"><button type="button" className="v2-btn" aria-pressed={!global} onClick={() => setGlobal(false)}>My collection</button><button type="button" className="v2-btn" aria-pressed={global} onClick={() => setGlobal(true)}>Global</button></div>
    {error && <p role="alert" style={{ color: "var(--v2-error-soft)", fontSize: 13 }}>{error}</p>}
    {category === "BGS" && <><button type="button" className="v2-btn" disabled={!backgroundPool.length} onClick={() => { const index = backgroundPool.findIndex(asset => asset.url === currentBackground); const next = backgroundPool[(index + 1) % backgroundPool.length]; if (next) onSelect(next); }}>Use next background ({backgroundPool.length})</button><span style={{ fontSize: 12, color: "var(--v2-text-2)" }}>Only checked backgrounds are in your rotation pool.</span></>}
    {!shown.length && <p style={{ fontSize: 13, color: "var(--v2-text-2)" }}>No assets here. Upload one or restore it from Global.</p>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>{shown.map(asset => <div key={asset.key} style={{ position: "relative", border: "1px solid var(--v2-border-2)", borderRadius: 7, background: "var(--v2-surface-2)", overflow: "hidden" }}>
      <button type="button" aria-label={`Use ${asset.name}`} onClick={() => onSelect(asset)} style={{ display: "grid", width: "100%", gap: 4, padding: 8, background: "transparent", border: 0, color: "var(--v2-text-1)", cursor: "pointer", textAlign: "left" }}><img src={asset.url} alt="" loading="lazy" style={{ width: "100%", height: 78, objectFit: "contain" }} /><span style={{ fontSize: 12, lineHeight: 1.4, overflowWrap: "anywhere" }}>{asset.name}</span></button>
      <button type="button" disabled={pending === asset.key} aria-label={`${preferences[asset.key]?.hidden ? "Restore" : "Hide"} ${asset.name} ${preferences[asset.key]?.hidden ? "in" : "from"} my collection`} title={preferences[asset.key]?.hidden ? "Restore to my collection" : "Hide from my collection — shared file stays available"} onClick={() => void update(asset.key, { hidden: !preferences[asset.key]?.hidden })} style={{ position: "absolute", top: 3, right: 3, width: 28, height: 28, border: "1px solid var(--v2-border-2)", borderRadius: 5, background: "var(--v2-surface-1)", color: "var(--v2-text-1)", cursor: "pointer", fontSize: 18 }}>{preferences[asset.key]?.hidden ? "+" : "×"}</button>
      {asset.category === "BGS" && <label style={{ display: "flex", gap: 6, padding: 8, fontSize: 12 }}><input type="checkbox" disabled={pending === asset.key} checked={!preferences[asset.key]?.hidden && preferences[asset.key]?.includeInRotation !== false} onChange={event => void update(asset.key, { includeInRotation: event.target.checked, ...(event.target.checked ? { hidden: false } : {}) })} />In rotation</label>}
    </div>)}</div>
  </div>;
}
