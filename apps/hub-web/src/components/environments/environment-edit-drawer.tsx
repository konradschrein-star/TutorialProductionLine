'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, ChevronDown, AlertTriangle, Save, Image as ImageIcon, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EnvironmentCardEnvironment } from './environment-card';

interface ArchetypeOption {
  id: string;
  name: string;
}

interface BackgroundAsset {
  id: string;
  name: string;
}

interface EnvironmentEditDrawerProps {
  mode: 'create' | 'edit';
  environment?: EnvironmentCardEnvironment | null;
  archetypes: ArchetypeOption[];
  backgroundAssets: BackgroundAsset[];
  open: boolean;
  onClose: () => void;
  onSaved: (environment: EnvironmentCardEnvironment) => void;
}

export function EnvironmentEditDrawer({
  mode,
  environment,
  archetypes,
  backgroundAssets,
  open,
  onClose,
  onSaved,
}: EnvironmentEditDrawerProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [archetypeId, setArchetypeId] = useState('');
  const [backgroundAssetId, setBackgroundAssetId] = useState('');
  const [safeZoneRight, setSafeZoneRight] = useState<string>('');
  const [characterXPercent, setCharacterXPercent] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstFocusRef = useRef<HTMLInputElement>(null);

  // Populate form when editing
  useEffect(() => {
    if (mode === 'edit' && environment) {
      setName(environment.name);
      setDescription(environment.description);
      setArchetypeId(environment.archetype_id ?? '');
      setBackgroundAssetId(environment.background_asset_id ?? '');
      setSafeZoneRight(
        environment.spatial_hints?.safe_zone_right_percent !== undefined
          ? String(environment.spatial_hints.safe_zone_right_percent)
          : ''
      );
      setCharacterXPercent(
        environment.spatial_hints?.character_x_percent !== undefined
          ? String(environment.spatial_hints.character_x_percent)
          : ''
      );
    } else if (mode === 'create') {
      setName('');
      setDescription('');
      setArchetypeId('');
      setBackgroundAssetId('');
      setSafeZoneRight('');
      setCharacterXPercent('');
    }
    setError(null);
  }, [mode, environment, open]);

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
      if (!description.trim()) {
        setError('Description is required.');
        return;
      }
      if (!backgroundAssetId) {
        setError('Please select a background asset.');
        return;
      }

      const safeZoneNum = safeZoneRight !== '' ? Number(safeZoneRight) : undefined;
      const charXNum = characterXPercent !== '' ? Number(characterXPercent) : undefined;

      const spatial_hints =
        safeZoneNum !== undefined || charXNum !== undefined
          ? {
              ...(safeZoneNum !== undefined ? { safe_zone_right_percent: safeZoneNum } : {}),
              ...(charXNum !== undefined ? { character_x_percent: charXNum } : {}),
            }
          : null;

      setSubmitting(true);
      try {
        const payload = {
          name: name.trim(),
          description: description.trim(),
          archetype_id: archetypeId || null,
          background_asset_id: backgroundAssetId,
          spatial_hints,
        };

        let res: Response;
        if (mode === 'create') {
          res = await fetch('/api/environments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } else {
          res = await fetch(`/api/environments/${environment!.id}`, {
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

        onSaved(json.environment as EnvironmentCardEnvironment);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed');
      } finally {
        setSubmitting(false);
      }
    },
    [
      name, description, archetypeId, backgroundAssetId,
      safeZoneRight, characterXPercent, mode, environment, onSaved, onClose,
    ]
  );

  const title = mode === 'create' ? 'New Environment' : 'Edit Environment';
  const selectedBg = backgroundAssets.find((a) => a.id === backgroundAssetId);

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-background/60 backdrop-blur-sm z-40 transition-opacity duration-300',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className={cn(
          'fixed top-0 right-0 h-full w-[480px] z-50 flex flex-col bg-background border-l border-primary/20 shadow-2xl transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10">
          <h2 className="text-lg font-bold text-text">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-bright transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
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
              placeholder='e.g. "The Office"'
              className="w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text placeholder-text-muted/50 focus:outline-none focus:border-primary/50"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted">
              Description <span className="text-error">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this environment's visual setting…"
              rows={3}
              className="w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text placeholder-text-muted/50 focus:outline-none focus:border-primary/50 resize-none"
            />
          </div>

          {/* Archetype */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted">Archetype</label>
            <div className="relative">
              <select
                value={archetypeId}
                onChange={(e) => setArchetypeId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text appearance-none focus:outline-none focus:border-primary/50 pr-9"
              >
                <option value="">No archetype (universal)</option>
                {archetypes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
            </div>
          </div>

          {/* Background asset picker */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-text-muted">
              Background Asset <span className="text-error">*</span>
            </label>

            {selectedBg && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/10 border border-success/20 text-xs text-success">
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
                Selected: <span className="font-medium">{selectedBg.name}</span>
              </div>
            )}

            {backgroundAssets.length === 0 ? (
              <div className="px-3 py-4 rounded-lg bg-surface-container border border-surface-bright text-xs text-text-muted text-center">
                No approved background assets found. Upload and approve backgrounds in the Asset Library first.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto rounded-lg border border-surface-bright p-2 bg-surface-container">
                {backgroundAssets.map((asset) => {
                  const selected = asset.id === backgroundAssetId;
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => setBackgroundAssetId(asset.id)}
                      className={cn(
                        'relative rounded-lg overflow-hidden border-2 transition-all aspect-video flex items-center justify-center bg-surface-bright',
                        selected
                          ? 'border-primary shadow-[0_0_8px_hsl(var(--primary)/0.4)]'
                          : 'border-transparent hover:border-primary/30'
                      )}
                      title={asset.name}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/assets/${asset.id}`}
                        alt={asset.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      <ImageIcon className="absolute w-5 h-5 text-text-muted/30" />
                      {selected && (
                        <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                          <Check className="w-4 h-4 text-primary" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Spatial hints */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">
              Spatial Hints
            </p>

            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted">
                Right % reserved for avatar PIP overlay
              </label>
              <input
                type="number"
                min={0}
                max={50}
                value={safeZoneRight}
                onChange={(e) => setSafeZoneRight(e.target.value)}
                placeholder="e.g. 30"
                className="w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text placeholder-text-muted/50 focus:outline-none focus:border-primary/50"
              />
              <p className="text-[11px] text-text-muted">
                Keeps this % of the right edge clear of generated scene content.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted">
                Character X position %
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={characterXPercent}
                onChange={(e) => setCharacterXPercent(e.target.value)}
                placeholder="e.g. 30"
                className="w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text placeholder-text-muted/50 focus:outline-none focus:border-primary/50"
              />
              <p className="text-[11px] text-text-muted">
                Horizontal position of the character (0 = left edge).
              </p>
            </div>
          </div>

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
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-surface-bright text-text-muted text-sm font-medium hover:text-text hover:border-primary/30 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={handleSubmit as React.MouseEventHandler<HTMLButtonElement>}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" />
            {submitting ? 'Saving…' : mode === 'create' ? 'Create Environment' : 'Save Changes'}
          </button>
        </div>
      </aside>
    </>
  );
}
