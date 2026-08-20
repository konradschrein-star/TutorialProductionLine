'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, ChevronDown, AlertTriangle, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ArchetypeCardArchetype } from './archetype-card';

const IMAGE_STYLE_OPTIONS = [
  { value: 'stickman',       label: 'Stickman' },
  { value: 'illustration',   label: 'Illustration' },
  { value: 'photorealistic', label: 'Photorealistic' },
];

interface ArchetypeEditDrawerProps {
  mode: 'create' | 'edit';
  archetype?: ArchetypeCardArchetype | null;
  open: boolean;
  onClose: () => void;
  onSaved: (archetype: ArchetypeCardArchetype & { hasStyleGuide: boolean }) => void;
}

export function ArchetypeEditDrawer({
  mode,
  archetype,
  open,
  onClose,
  onSaved,
}: ArchetypeEditDrawerProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageStyle, setImageStyle] = useState('illustration');
  const [stylePrefix, setStylePrefix] = useState('');
  const [styleSuffix, setStyleSuffix] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstFocusRef = useRef<HTMLInputElement>(null);

  // Populate form when editing
  useEffect(() => {
    if (mode === 'edit' && archetype) {
      setName(archetype.name);
      setDescription(archetype.description ?? '');
      setImageStyle(archetype.image_style ?? 'illustration');
      setStylePrefix(archetype.style_prefix ?? '');
      setStyleSuffix(archetype.style_suffix ?? '');
      setIsActive(archetype.is_active);
    } else if (mode === 'create') {
      setName('');
      setDescription('');
      setImageStyle('illustration');
      setStylePrefix('');
      setStyleSuffix('');
      setIsActive(true);
    }
    setError(null);
  }, [mode, archetype, open]);

  // Focus first field on open
  useEffect(() => {
    if (open) {
      setTimeout(() => firstFocusRef.current?.focus(), 50);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (!name.trim()) {
        setError('Name is required.');
        return;
      }

      setSubmitting(true);
      try {
        const payload = {
          name: name.trim(),
          description: description.trim() || null,
          image_style: imageStyle,
          style_prefix: stylePrefix.trim() || null,
          style_suffix: styleSuffix.trim() || null,
          is_active: isActive,
        };

        let res: Response;
        if (mode === 'create') {
          res = await fetch('/api/archetypes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } else {
          res = await fetch(`/api/archetypes/${archetype!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        }

        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? 'Save failed');
          return;
        }

        // Preserve hasStyleGuide when editing; default false for creates
        const saved = {
          ...json.archetype,
          hasStyleGuide: mode === 'edit' ? (archetype?.hasStyleGuide ?? false) : false,
        };
        onSaved(saved);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed');
      } finally {
        setSubmitting(false);
      }
    },
    [name, description, imageStyle, stylePrefix, styleSuffix, isActive, mode, archetype, onSaved, onClose]
  );

  const title = mode === 'create' ? 'New Archetype' : 'Edit Archetype';

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-[rgba(0,0,0,0.6)] backdrop-blur-sm z-40 transition-opacity duration-300',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className={cn(
          'fixed top-0 right-0 h-full w-[480px] z-50 flex flex-col bg-[#000] border-l border-[rgba(170,255,0,0.15)] shadow-2xl transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(75,68,85,0.3)]">
          <h2 className="text-lg font-bold text-[#e5e2e1]">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[rgba(205,195,215,0.6)] hover:text-[#e5e2e1] hover:bg-[#1c1c1c] transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Name */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[rgba(205,195,215,0.6)]">
              Name <span className="text-[#ef4444]">*</span>
            </label>
            <input
              ref={firstFocusRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='e.g. "Casually Explained"'
              className="w-full px-3 py-2 text-sm bg-[#151515] border border-[rgba(75,68,85,0.3)] rounded-lg text-[#e5e2e1] placeholder-[rgba(205,195,215,0.5)] focus:outline-none focus:border-[rgba(170,255,0,0.5)]"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[rgba(205,195,215,0.6)]">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this visual style archetype…"
              rows={3}
              className="w-full px-3 py-2 text-sm bg-[#151515] border border-[rgba(75,68,85,0.3)] rounded-lg text-[#e5e2e1] placeholder-[rgba(205,195,215,0.5)] focus:outline-none focus:border-[rgba(170,255,0,0.5)] resize-none"
            />
          </div>

          {/* Image Style */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[rgba(205,195,215,0.6)]">Image Style</label>
            <div className="relative">
              <select
                value={imageStyle}
                onChange={(e) => setImageStyle(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#151515] border border-[rgba(75,68,85,0.3)] rounded-lg text-[#e5e2e1] appearance-none focus:outline-none focus:border-[rgba(170,255,0,0.5)] pr-9"
              >
                {IMAGE_STYLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[rgba(205,195,215,0.6)] pointer-events-none" />
            </div>
          </div>

          {/* Style Prefix */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[rgba(205,195,215,0.6)]">Style Prefix</label>
            <textarea
              value={stylePrefix}
              onChange={(e) => setStylePrefix(e.target.value)}
              placeholder='e.g. "Simple flat-design illustration, stick-figure art style,"'
              rows={3}
              className="w-full px-3 py-2 text-sm bg-[#151515] border border-[rgba(75,68,85,0.3)] rounded-lg text-[#e5e2e1] placeholder-[rgba(205,195,215,0.5)] focus:outline-none focus:border-[rgba(170,255,0,0.5)] resize-none font-mono"
            />
            <p className="text-[11px] text-[rgba(205,195,215,0.6)]">
              Prepended to every image generation prompt for this archetype.
            </p>
          </div>

          {/* Style Suffix */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[rgba(205,195,215,0.6)]">Style Suffix</label>
            <textarea
              value={styleSuffix}
              onChange={(e) => setStyleSuffix(e.target.value)}
              placeholder='e.g. "white background, clean lines, minimal shading"'
              rows={3}
              className="w-full px-3 py-2 text-sm bg-[#151515] border border-[rgba(75,68,85,0.3)] rounded-lg text-[#e5e2e1] placeholder-[rgba(205,195,215,0.5)] focus:outline-none focus:border-[rgba(170,255,0,0.5)] resize-none font-mono"
            />
            <p className="text-[11px] text-[rgba(205,195,215,0.6)]">
              Appended to every image generation prompt for this archetype.
            </p>
          </div>

          {/* Active toggle */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              className={cn(
                'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
                isActive
                  ? 'border-[#aaff00] bg-[#aaff00]'
                  : 'border-[rgba(75,68,85,0.4)] group-hover:border-[rgba(170,255,0,0.4)]'
              )}
            >
              {isActive && (
                <span className="text-[#000] text-[10px] font-black">✓</span>
              )}
            </div>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="hidden"
            />
            <span className="text-sm text-[rgba(205,195,215,0.6)]">Active</span>
          </label>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)]">
              <AlertTriangle className="w-4 h-4 text-[#ef4444] flex-shrink-0" />
              <p className="text-sm text-[#ef4444]">{error}</p>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[rgba(75,68,85,0.3)] flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="v2-btn flex-1 py-2.5"
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={handleSubmit as React.MouseEventHandler<HTMLButtonElement>}
            disabled={submitting}
            className="v2-btn-accent flex-1 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" />
            {submitting ? 'Saving…' : mode === 'create' ? 'Create Archetype' : 'Save Changes'}
          </button>
        </div>
      </aside>
    </>
  );
}
