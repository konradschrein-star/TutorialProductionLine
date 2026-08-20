'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Star, ChevronDown, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AssetCardAsset } from './asset-card';

interface AssetEditModalProps {
  asset: AssetCardAsset | null;
  onClose: () => void;
  onUpdated: (asset: AssetCardAsset) => void;
}

const STATUS_OPTIONS = [
  { value: 'draft',      label: 'Draft' },
  { value: 'approved',   label: 'Approved' },
  { value: 'deprecated', label: 'Deprecated' },
];

export function AssetEditModal({ asset, onClose, onUpdated }: AssetEditModalProps) {
  const open = asset !== null;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('draft');
  const [qualityRating, setQualityRating] = useState<number>(0);
  const [tags, setTags] = useState('');
  const [bgRemoved, setBgRemoved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstFocusRef = useRef<HTMLInputElement>(null);

  // Populate fields when asset changes
  useEffect(() => {
    if (asset) {
      setName(asset.name);
      setDescription(asset.description);
      setStatus(asset.status);
      setQualityRating(asset.quality_rating ?? 0);
      setTags(asset.tags.join(', '));
      setBgRemoved(false); // not exposed on AssetCardAsset; keep unchanged
      setError(null);
      setTimeout(() => firstFocusRef.current?.focus(), 50);
    }
  }, [asset]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!asset) return;

    if (!name.trim()) { setError('Name is required.'); return; }
    if (!description.trim()) { setError('Description is required.'); return; }

    setError(null);
    setSubmitting(true);
    try {
      const tagArray = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        status,
        tags: tagArray,
      };
      if (qualityRating > 0) body.quality_rating = qualityRating;

      const res = await fetch(`/api/assets/${asset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? 'Update failed');
        return;
      }

      onUpdated(json.asset as AssetCardAsset);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSubmitting(false);
    }
  }, [asset, name, description, status, qualityRating, tags, onUpdated, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-background/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-[600px] glass-card rounded-2xl shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Edit Asset"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10">
          <h2 className="text-lg font-bold text-text">Edit Asset</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-bright transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
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
              rows={3}
              className="w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text placeholder-text-muted/50 focus:outline-none focus:border-primary/50 resize-none"
            />
          </div>

          {/* Status */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted">Status</label>
            <div className="relative">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text appearance-none focus:outline-none focus:border-primary/50 pr-9"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
            </div>
          </div>

          {/* Quality Rating */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-text-muted">Quality Rating</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setQualityRating(qualityRating === n ? 0 : n)}
                  className="p-1 hover:scale-110 transition-transform"
                  title={`${n} star${n > 1 ? 's' : ''}`}
                >
                  <Star
                    className={cn(
                      'w-5 h-5 transition-colors',
                      n <= qualityRating ? 'text-warning fill-warning' : 'text-text-muted/30 hover:text-warning/60'
                    )}
                  />
                </button>
              ))}
              {qualityRating > 0 && (
                <span className="text-xs text-text-muted ml-1 self-center">{qualityRating}/5</span>
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
              placeholder='e.g. #no-background, #state:happy, #character:main'
              className="w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text placeholder-text-muted/50 focus:outline-none focus:border-primary/50"
            />
            <p className="text-[11px] text-text-muted">Comma-separated.</p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-error/30 bg-error/10">
              <AlertTriangle className="w-4 h-4 text-error flex-shrink-0" />
              <p className="text-sm text-error">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-surface-bright text-text-muted text-sm font-medium hover:text-text hover:border-primary/30 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
