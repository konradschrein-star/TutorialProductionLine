"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { X, Upload, Star, ChevronDown, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssetCardAsset } from "./asset-card";

interface Archetype {
  id: string;
  name: string;
}

interface Channel {
  id: string;
  name: string;
}

interface AssetUploadDrawerProps {
  open: boolean;
  archetypes: Archetype[];
  channels?: Channel[];
  onClose: () => void;
  onAssetCreated: (asset: AssetCardAsset) => void;
}

const ASSET_TYPES = [
  { value: "style_guide", label: "Style Guide" },
  { value: "character", label: "Character" },
  { value: "character_state", label: "Character State" },
  { value: "background", label: "Background" },
  { value: "object", label: "Object" },
  { value: "prompt_template", label: "Prompt Template" },
  { value: "color_palette", label: "Color Palette" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "image", label: "Image" },
];

const ORIGIN_OPTIONS = [
  { value: "real", label: "Real" },
  { value: "ai_generated", label: "AI Generated" },
];

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
];

export function AssetUploadDrawer({
  open,
  archetypes,
  channels = [],
  onClose,
  onAssetCreated,
}: AssetUploadDrawerProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [assetType, setAssetType] = useState("character");
  const [origin, setOrigin] = useState("ai_generated");
  const [archetypeId, setArchetypeId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [status, setStatus] = useState("draft");
  const [bgRemoved, setBgRemoved] = useState(false);
  const [qualityRating, setQualityRating] = useState<number>(0);
  const [tags, setTags] = useState("");
  const [promptTemplate, setPromptTemplate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const firstFocusRef = useRef<HTMLInputElement>(null);

  // Focus trap: focus first field when drawer opens
  useEffect(() => {
    if (open) {
      setTimeout(() => firstFocusRef.current?.focus(), 50);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const resetForm = useCallback(() => {
    setFile(null);
    setName("");
    setDescription("");
    setAssetType("character");
    setOrigin("ai_generated");
    setArchetypeId("");
    setChannelId("");
    setStatus("draft");
    setBgRemoved(false);
    setQualityRating(0);
    setTags("");
    setPromptTemplate("");
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) {
      if (dropped.size > 50 * 1024 * 1024) {
        setError("File too large (max 50 MB)");
        return;
      }
      setFile(dropped);
      setError(null);
    }
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = e.target.files?.[0] ?? null;
      if (picked) {
        if (picked.size > 50 * 1024 * 1024) {
          setError("File too large (max 50 MB)");
          return;
        }
        setFile(picked);
        setError(null);
      }
    },
    [],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (!file) {
        setError("Please select a file.");
        return;
      }
      if (!name.trim()) {
        setError("Name is required.");
        return;
      }
      if (!description.trim()) {
        setError("Description is required.");
        return;
      }
      if (!assetType) {
        setError("Asset type is required.");
        return;
      }

      setSubmitting(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("name", name.trim());
        fd.append("description", description.trim());
        fd.append("asset_type", assetType);
        fd.append("origin", origin);
        fd.append("status", status);
        fd.append("background_removed", String(bgRemoved));
        if (qualityRating > 0)
          fd.append("quality_rating", String(qualityRating));
        if (archetypeId) fd.append("archetype_id", archetypeId);
        if (channelId) fd.append("channel_id", channelId);
        if (tags.trim()) fd.append("tags", tags.trim());
        if (origin === "ai_generated" && promptTemplate.trim()) {
          fd.append(
            "generation_recipe",
            JSON.stringify({ prompt_template: promptTemplate.trim() }),
          );
        }

        const res = await fetch("/api/assets", { method: "POST", body: fd });
        const json = await res.json();

        if (!res.ok) {
          setError(json.error ?? "Upload failed");
          return;
        }

        onAssetCreated(json.asset as AssetCardAsset);
        handleClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setSubmitting(false);
      }
    },
    [
      file,
      name,
      description,
      assetType,
      origin,
      status,
      bgRemoved,
      qualityRating,
      archetypeId,
      channelId,
      tags,
      promptTemplate,
      onAssetCreated,
      handleClose,
    ],
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 bg-background/60 backdrop-blur-sm z-40 transition-opacity duration-300",
          open
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none",
        )}
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className={cn(
          "fixed top-0 right-0 h-full w-[480px] z-50 flex flex-col bg-background border-l border-primary/20 shadow-2xl transition-transform duration-300",
          open ? "translate-x-0" : "translate-x-full",
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Upload Asset"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10">
          <h2 className="text-lg font-bold text-text">Upload Asset</h2>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-bright transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
        >
          {/* Drop zone */}
          <div
            className={cn(
              "border-2 border-dashed rounded-xl p-6 flex flex-col items-center gap-3 cursor-pointer transition-colors",
              dragging
                ? "border-primary bg-primary/10"
                : file
                  ? "border-success/50 bg-success/5"
                  : "border-surface-bright hover:border-primary/40",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) =>
              e.key === "Enter" && fileInputRef.current?.click()
            }
          >
            <Upload
              className={cn(
                "w-8 h-8",
                file ? "text-success" : "text-text-muted/50",
              )}
            />
            {file ? (
              <div className="text-center">
                <p className="text-sm font-medium text-text">{file.name}</p>
                <p className="text-xs text-text-muted mt-1">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm font-medium text-text">Drop image here</p>
                <p className="text-xs text-text-muted mt-1">
                  or click to browse · max 50 MB
                </p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileInput}
            />
          </div>

          {/* Name */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted">
              Name <span className="text-error">*</span>
            </label>
            <input
              ref={firstFocusRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='e.g. "Main Character — Neutral"'
              className="w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text placeholder-text-muted/50 focus:outline-none focus:border-primary/50"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted flex items-center gap-2">
              Description <span className="text-error">*</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/20 text-primary uppercase tracking-wide">
                Injected into image prompts
              </span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the asset as art direction — this text is appended verbatim to image prompts."
              rows={3}
              className="w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text placeholder-text-muted/50 focus:outline-none focus:border-primary/50 resize-none"
            />
          </div>

          {/* Asset Type */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted">
              Asset Type <span className="text-error">*</span>
            </label>
            <div className="relative">
              <select
                value={assetType}
                onChange={(e) => setAssetType(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text appearance-none focus:outline-none focus:border-primary/50 pr-9"
              >
                {ASSET_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
            </div>
          </div>

          {/* Origin */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-text-muted">
              Origin
            </label>
            <div className="flex gap-3">
              {ORIGIN_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors",
                    origin === opt.value
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-surface-bright text-text-muted hover:border-primary/30",
                  )}
                >
                  <input
                    type="radio"
                    name="origin"
                    value={opt.value}
                    checked={origin === opt.value}
                    onChange={() => setOrigin(opt.value)}
                    className="hidden"
                  />
                  <span
                    className={cn(
                      "w-3 h-3 rounded-full border-2 flex-shrink-0",
                      origin === opt.value
                        ? "border-primary bg-primary"
                        : "border-text-muted/40",
                    )}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Archetype */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted">
              Archetype
            </label>
            <div className="relative">
              <select
                value={archetypeId}
                onChange={(e) => setArchetypeId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text appearance-none focus:outline-none focus:border-primary/50 pr-9"
              >
                <option value="">All archetypes (universal)</option>
                {archetypes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
            </div>
          </div>

          {/* Channel */}
          {channels.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted">
                Channel
              </label>
              <div className="relative">
                <select
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text appearance-none focus:outline-none focus:border-primary/50 pr-9"
                >
                  <option value="">All channels (universal)</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
              </div>
            </div>
          )}

          {/* Status */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted">
              Status
            </label>
            <div className="relative">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text appearance-none focus:outline-none focus:border-primary/50 pr-9"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
            </div>
          </div>

          {/* Background removed */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              className={cn(
                "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
                bgRemoved
                  ? "border-primary bg-primary"
                  : "border-surface-bright group-hover:border-primary/40",
              )}
            >
              {bgRemoved && (
                <span className="text-primary-foreground text-[10px] font-black">
                  ✓
                </span>
              )}
            </div>
            <input
              type="checkbox"
              checked={bgRemoved}
              onChange={(e) => setBgRemoved(e.target.checked)}
              className="hidden"
            />
            <span className="text-sm text-text-muted">Background removed</span>
          </label>

          {/* Quality Rating */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-text-muted">
              Quality Rating
            </label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setQualityRating(qualityRating === n ? 0 : n)}
                  className="p-1 hover:scale-110 transition-transform"
                  title={`${n} star${n > 1 ? "s" : ""}`}
                >
                  <Star
                    className={cn(
                      "w-5 h-5 transition-colors",
                      n <= qualityRating
                        ? "text-warning fill-warning"
                        : "text-text-muted/30 hover:text-warning/60",
                    )}
                  />
                </button>
              ))}
              {qualityRating > 0 && (
                <span className="text-xs text-text-muted ml-1 self-center">
                  {qualityRating}/5
                </span>
              )}
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted">Tags</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. #no-background, #state:happy, #character:main"
              className="w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text placeholder-text-muted/50 focus:outline-none focus:border-primary/50"
            />
            <p className="text-[11px] text-text-muted">
              Comma-separated. Use #state:name for character states.
            </p>
          </div>

          {/* Generation Prompt (AI-generated assets only) */}
          {origin === "ai_generated" && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted flex items-center gap-2">
                Generation Prompt
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/20 text-primary uppercase tracking-wide">
                  Auto-labels on save
                </span>
              </label>
              <textarea
                value={promptTemplate}
                onChange={(e) => setPromptTemplate(e.target.value)}
                placeholder="Paste the prompt used to generate this asset. The system will auto-generate description and tags from it."
                rows={4}
                className="w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text placeholder-text-muted/50 focus:outline-none focus:border-primary/50 resize-none font-mono"
              />
              <p className="text-[11px] text-text-muted">
                Optional. When provided, description and tags are generated
                automatically via the local LLM.
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-error/30 bg-error/10">
              <AlertTriangle className="w-4 h-4 text-error flex-shrink-0" />
              <p className="text-sm text-error">{error}</p>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-primary/10 flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 py-2.5 rounded-lg border border-surface-bright text-text-muted text-sm font-medium hover:text-text hover:border-primary/30 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form=""
            onClick={handleSubmit as any}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Upload className="w-4 h-4" />
            {submitting ? "Uploading…" : "Upload Asset"}
          </button>
        </div>
      </aside>
    </>
  );
}
