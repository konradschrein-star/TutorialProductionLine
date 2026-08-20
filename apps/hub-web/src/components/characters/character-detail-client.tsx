'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Upload,
  Plus,
  Trash2,
  RefreshCw,
  AlertTriangle,
  X,
  User2,
  Edit2,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CharacterWithStates } from '@/lib/repositories/character-repository';
import type { Archetype } from '@/lib/repositories/archetype-repository';

interface CharacterDetailClientProps {
  character: CharacterWithStates;
  archetypes: Archetype[];
}

// ---------- State Upload Modal ----------

interface StateUploadModalProps {
  characterId: string;
  stateName: string;
  onUploaded: (stateName: string, assetId: string) => void;
  onClose: () => void;
}

function StateUploadModal({ characterId, stateName, onUploaded, onClose }: StateUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) {
      setFile(dropped);
      setError(null);
    }
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!file) {
        setError('Please select a file.');
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('state_name', stateName);
        if (description.trim()) fd.append('description', description.trim());

        const res = await fetch(`/api/characters/${characterId}/states`, { method: 'POST', body: fd });
        const json = await res.json() as { asset?: { id: string }; error?: string };

        if (!res.ok) {
          setError(json.error ?? 'Upload failed');
          return;
        }

        onUploaded(stateName, json.asset!.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setSubmitting(false);
      }
    },
    [file, description, stateName, characterId, onUploaded]
  );

  return (
    <>
      <div
        className="fixed inset-0 bg-[rgba(0,0,0,0.6)] backdrop-blur-sm z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
      >
        <div className="w-full max-w-[440px] bg-[rgba(255,255,255,0.04)] backdrop-blur-[20px] border border-[rgba(170,255,0,0.15)] rounded-xl shadow-2xl">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(75,68,85,0.3)]">
            <h2 className="text-base font-bold text-[#e5e2e1]">
              Upload State —{' '}
              <span className="text-[#aaff00]">{stateName}</span>
            </h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[rgba(205,195,215,0.6)] hover:text-[#e5e2e1] hover:bg-[#1c1c1c] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            {/* Drop zone */}
            <div
              className={cn(
                'border-2 border-dashed rounded-xl p-6 flex flex-col items-center gap-2 cursor-pointer transition-colors',
                dragging
                  ? 'border-[#aaff00] bg-[rgba(170,255,0,0.1)]'
                  : file
                  ? 'border-[rgba(35,222,203,0.5)] bg-[rgba(35,222,203,0.05)]'
                  : 'border-[rgba(75,68,85,0.3)] hover:border-[rgba(170,255,0,0.4)]'
              )}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
            >
              <Upload className={cn('w-7 h-7', file ? 'text-[#23decb]' : 'text-[rgba(205,195,215,0.5)]')} />
              {file ? (
                <div className="text-center">
                  <p className="text-sm font-medium text-[#e5e2e1]">{file.name}</p>
                  <p className="text-xs text-[rgba(205,195,215,0.6)]">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              ) : (
                <div className="text-center">
                  <p className="text-sm font-medium text-[#e5e2e1]">Drop image here</p>
                  <p className="text-xs text-[rgba(205,195,215,0.6)]">or click to browse · max 20 MB</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { setFile(f); setError(null); }
                }}
              />
            </div>

            {/* Optional description */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-[rgba(205,195,215,0.6)]">Description (optional)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={`${stateName} state image`}
                className="w-full px-3 py-2 text-sm bg-[#151515] border border-[rgba(75,68,85,0.3)] rounded-lg text-[#e5e2e1] placeholder-[rgba(205,195,215,0.5)] focus:outline-none focus:border-[rgba(170,255,0,0.5)]"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)]">
                <AlertTriangle className="w-4 h-4 text-[#ef4444] flex-shrink-0" />
                <p className="text-sm text-[#ef4444]">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="v2-btn flex-1 py-2.5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !file}
                className="v2-btn-accent flex-1 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" />
                {submitting ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

// ---------- State Slot ----------

interface StateEntry {
  id: string;
  name: string;
  description: string | null;
  asset_id: string | null;
  asset_status: string | null;
  asset_file_path: string | null;
}

interface StateSlotProps {
  state: StateEntry;
  characterId: string;
  onUploaded: (stateName: string, assetId: string) => void;
  onDeleted: (stateName: string) => void;
}

function StateSlot({ state, characterId, onUploaded, onDeleted }: StateSlotProps) {
  const [showUpload, setShowUpload] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!state.asset_id) return;
    if (!confirm(`Delete state image for "${state.name}"?`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/assets/${state.asset_id}`, { method: 'DELETE' });
      onDeleted(state.name);
    } finally {
      setDeleting(false);
    }
  }, [state.asset_id, state.name, onDeleted]);

  const statusColor =
    state.asset_status === 'approved'
      ? 'text-[#23decb] bg-[rgba(35,222,203,0.15)]'
      : 'text-[#f97316] bg-[rgba(249,115,22,0.15)]';

  return (
    <>
      <div className="bg-[rgba(255,255,255,0.04)] backdrop-blur-[20px] rounded-xl border border-[rgba(75,68,85,0.3)] overflow-hidden group flex flex-col">
        {/* Label row */}
        <div className="px-3 py-2 flex items-center justify-between border-b border-[rgba(75,68,85,0.3)] bg-[rgba(13,13,13,0.5)]">
          <span className="text-[10px] font-semibold text-[rgba(205,195,215,0.6)] uppercase tracking-widest truncate">
            {state.name}
          </span>
          {state.asset_status && (
            <span
              className={cn(
                'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded',
                statusColor
              )}
            >
              {state.asset_status}
            </span>
          )}
        </div>

        {/* Image area */}
        {state.asset_id ? (
          <div className="relative flex-1 min-h-[100px] bg-[#151515]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/assets/${state.asset_id}`}
              alt={`${state.name} state`}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            {/* Hover overlay */}
            <div className="absolute inset-0 bg-[rgba(0,0,0,0.7)] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <button
                onClick={() => setShowUpload(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#1c1c1c] text-[#e5e2e1] text-xs font-medium hover:bg-[rgba(170,255,0,0.2)] hover:text-[#aaff00] transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Replace
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#1c1c1c] text-[rgba(239,68,68,0.7)] text-xs font-medium hover:bg-[rgba(239,68,68,0.2)] hover:text-[#ef4444] transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
                {deleting ? '…' : 'Delete'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowUpload(true)}
            className="flex-1 min-h-[100px] flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[rgba(75,68,85,0.3)] hover:border-[rgba(170,255,0,0.4)] transition-colors group/upload m-2 rounded-lg"
          >
            <Plus className="w-5 h-5 text-[rgba(205,195,215,0.4)] group-hover/upload:text-[#aaff00] transition-colors" />
            <span className="text-[10px] text-[rgba(205,195,215,0.6)] group-hover/upload:text-[#aaff00] transition-colors font-medium">
              Upload
            </span>
          </button>
        )}
      </div>

      {showUpload && (
        <StateUploadModal
          characterId={characterId}
          stateName={state.name}
          onUploaded={(name, assetId) => {
            onUploaded(name, assetId);
            setShowUpload(false);
          }}
          onClose={() => setShowUpload(false)}
        />
      )}
    </>
  );
}

// ---------- Main Detail Client ----------

export function CharacterDetailClient({
  character: initial,
  archetypes,
}: CharacterDetailClientProps) {
  const router = useRouter();
  const [character, setCharacter] = useState<CharacterWithStates>(initial);
  const [states, setStates] = useState<StateEntry[]>(initial.states);

  const present = states.filter((s) => s.asset_id !== null).length;
  const total = states.length > 0 ? states.length : 12;

  const archetypeMap = new Map(archetypes.map((a) => [a.id, a.name]));
  const archetypeName = character.archetype_id
    ? (archetypeMap.get(character.archetype_id) ?? null)
    : null;

  // Inline description editing
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState(character.description);
  const [savingDesc, setSavingDesc] = useState(false);

  const saveDescription = useCallback(async () => {
    if (descValue.trim() === character.description) {
      setEditingDesc(false);
      return;
    }
    setSavingDesc(true);
    try {
      const res = await fetch(`/api/characters/${character.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: descValue.trim() }),
      });
      if (res.ok) {
        setCharacter((prev) => ({ ...prev, description: descValue.trim() }));
        setEditingDesc(false);
      }
    } finally {
      setSavingDesc(false);
    }
  }, [character.id, character.description, descValue]);

  // Reference sheet upload
  const refSheetInputRef = useRef<HTMLInputElement>(null);
  const [uploadingRef, setUploadingRef] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);

  const handleRefSheetUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploadingRef(true);
      setRefError(null);
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('name', `${character.name} — Reference Sheet`);
        fd.append('description', `Reference sheet for ${character.name}`);
        fd.append('asset_type', 'character');
        if (character.archetype_id) fd.append('archetype_id', character.archetype_id);
        if (character.channel_id) fd.append('channel_id', character.channel_id);

        const uploadRes = await fetch('/api/assets', { method: 'POST', body: fd });
        const uploadJson = await uploadRes.json() as { asset?: { id: string }; error?: string };
        if (!uploadRes.ok) {
          setRefError(uploadJson.error ?? 'Upload failed');
          return;
        }

        const newAssetId = uploadJson.asset!.id;

        const patchRes = await fetch(`/api/characters/${character.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference_sheet_asset_id: newAssetId }),
        });
        const patchJson = await patchRes.json() as { error?: string };
        if (!patchRes.ok) {
          setRefError(patchJson.error ?? 'Failed to link reference sheet');
          return;
        }

        setCharacter((prev) => ({ ...prev, reference_sheet_asset_id: newAssetId }));
      } catch (err) {
        setRefError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setUploadingRef(false);
        if (refSheetInputRef.current) refSheetInputRef.current.value = '';
      }
    },
    [character]
  );

  const handleStateUploaded = useCallback((stateName: string, assetId: string) => {
    setStates((prev) =>
      prev.map((s) =>
        s.name === stateName ? { ...s, asset_id: assetId, asset_status: 'draft' } : s
      )
    );
  }, []);

  const handleStateDeleted = useCallback((stateName: string) => {
    setStates((prev) =>
      prev.map((s) =>
        s.name === stateName
          ? { ...s, asset_id: null, asset_status: null, asset_file_path: null }
          : s
      )
    );
  }, []);

  return (
    <div className="space-y-6">
      {/* Back link + header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <button
            onClick={() => router.push('/characters')}
            className="flex items-center gap-1.5 text-sm text-[rgba(205,195,215,0.6)] hover:text-[#e5e2e1] transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Characters
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-[#e5e2e1]">{character.name}</h1>
            {archetypeName && (
              <span className="px-2.5 py-1 rounded-full bg-[rgba(170,255,0,0.15)] text-[#aaff00] text-xs font-semibold">
                {archetypeName}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => router.push(`/characters/${character.id}`)}
          className="flex items-center gap-2 px-4 py-2 bg-[#1c1c1c] hover:bg-[rgba(28,28,28,0.8)] text-[#e5e2e1] text-sm font-medium rounded-lg border border-[rgba(75,68,85,0.3)] transition-colors"
        >
          <Edit2 className="w-4 h-4" />
          Edit Character
        </button>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: reference sheet + meta */}
        <div className="space-y-4">
          {/* Reference sheet card */}
          <div className="bg-[rgba(255,255,255,0.04)] backdrop-blur-[20px] border border-[rgba(255,255,255,0.09)] rounded-xl p-4 space-y-3">
            <p className="text-[10px] font-semibold text-[rgba(205,195,215,0.6)] uppercase tracking-widest">
              Reference Sheet
            </p>

            <div className="w-full aspect-[3/4] rounded-lg overflow-hidden bg-[#151515] flex items-center justify-center">
              {character.reference_sheet_asset_id ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/assets/${character.reference_sheet_asset_id}`}
                  alt={`${character.name} reference sheet`}
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <div className="flex flex-col items-center gap-3 text-[rgba(205,195,215,0.4)]">
                  <User2 className="w-16 h-16" />
                  <span className="text-xs uppercase tracking-widest font-semibold text-center leading-relaxed">
                    No reference sheet
                  </span>
                </div>
              )}
            </div>

            {refError && (
              <div className="flex items-center gap-2 text-xs text-[#ef4444]">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                {refError}
              </div>
            )}

            <button
              onClick={() => refSheetInputRef.current?.click()}
              disabled={uploadingRef}
              className="v2-btn w-full flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              {uploadingRef
                ? 'Uploading…'
                : character.reference_sheet_asset_id
                ? 'Replace Sheet'
                : 'Upload Reference Sheet'}
            </button>
            <input
              ref={refSheetInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleRefSheetUpload}
            />
          </div>

          {/* Description card */}
          <div className="bg-[rgba(255,255,255,0.04)] backdrop-blur-[20px] border border-[rgba(255,255,255,0.09)] rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold text-[rgba(205,195,215,0.6)] uppercase tracking-widest">
                Description
              </p>
              {!editingDesc && (
                <button
                  onClick={() => setEditingDesc(true)}
                  className="p-1 rounded text-[rgba(205,195,215,0.6)] hover:text-[#e5e2e1] transition-colors"
                  aria-label="Edit description"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {editingDesc ? (
              <div className="space-y-2">
                <textarea
                  value={descValue}
                  onChange={(e) => setDescValue(e.target.value)}
                  rows={5}
                  autoFocus
                  className="w-full px-3 py-2 text-sm bg-[#151515] border border-[rgba(75,68,85,0.3)] rounded-lg text-[#e5e2e1] focus:outline-none focus:border-[rgba(170,255,0,0.5)] resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={saveDescription}
                    disabled={savingDesc}
                    className="v2-btn-accent text-xs disabled:opacity-50 flex items-center gap-1.5 px-3 py-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {savingDesc ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setDescValue(character.description);
                      setEditingDesc(false);
                    }}
                    className="v2-btn text-xs px-3 py-1.5"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[rgba(205,195,215,0.6)] leading-relaxed whitespace-pre-wrap">
                {character.description || (
                  <span className="italic text-[rgba(205,195,215,0.5)]">No description</span>
                )}
              </p>
            )}
          </div>

          {/* Meta card */}
          <div className="bg-[rgba(255,255,255,0.04)] backdrop-blur-[20px] border border-[rgba(255,255,255,0.09)] rounded-xl p-4 space-y-3">
            <p className="text-[10px] font-semibold text-[rgba(205,195,215,0.6)] uppercase tracking-widest">
              Details
            </p>
            <dl className="space-y-2">
              <div>
                <dt className="text-xs text-[rgba(205,195,215,0.6)]">Archetype</dt>
                <dd className="text-sm text-[#e5e2e1]">
                  {archetypeName ?? (
                    <span className="text-[rgba(205,195,215,0.5)] italic">None</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[rgba(205,195,215,0.6)]">Status</dt>
                <dd
                  className={cn(
                    'text-sm font-medium',
                    character.is_active ? 'text-[#23decb]' : 'text-[rgba(205,195,215,0.6)]'
                  )}
                >
                  {character.is_active ? 'Active' : 'Inactive'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[rgba(205,195,215,0.6)]">Created</dt>
                <dd className="text-sm text-[#e5e2e1]">
                  {new Date(character.created_at).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Right: state grid */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-[#e5e2e1]">Emotional States</h2>
            <div className="flex items-center gap-2">
              <div className="h-2 w-32 bg-[rgba(75,68,85,0.3)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#aaff00] rounded-full transition-all duration-500"
                  style={{ width: total > 0 ? `${(present / total) * 100}%` : '0%' }}
                />
              </div>
              <span className="text-sm font-semibold text-[#e5e2e1]">
                <span className={cn(present === total ? 'text-[#23decb]' : 'text-[#aaff00]')}>
                  {present}
                </span>
                <span className="text-[rgba(205,195,215,0.6)]"> / {total} ready</span>
              </span>
            </div>
          </div>

          {states.length === 0 ? (
            <div className="bg-[rgba(255,255,255,0.04)] backdrop-blur-[20px] border border-[rgba(255,255,255,0.09)] rounded-xl p-10 flex flex-col items-center gap-3 text-[rgba(205,195,215,0.6)]">
              <p className="text-sm">No canonical states defined in the database yet.</p>
              <p className="text-xs">
                Insert rows into{' '}
                <code className="font-mono text-[#aaff00]">character_state_types</code> to unlock this
                grid.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {states.map((state) => (
                <StateSlot
                  key={state.id}
                  state={state}
                  characterId={character.id}
                  onUploaded={handleStateUploaded}
                  onDeleted={handleStateDeleted}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
