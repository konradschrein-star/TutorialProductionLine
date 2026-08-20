'use client';

import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, RefreshCw, Layers, Trash2, Move, Scissors, GitMerge } from 'lucide-react';
import type { TimelineScene } from '@repo/contracts';
import { useTimelineStore } from './use-timeline-store';
import { useSSE } from '@/hooks/use-sse';

const LAYOUT_OPTIONS = [
  { value: 'AVATAR_PIP',        label: 'Avatar PiP',        hint: '~70%' },
  { value: 'AVATAR_FULLSCREEN', label: 'Avatar Full',        hint: '~20%' },
  { value: 'AVATAR_SPLIT',      label: 'Avatar Split',       hint: '~10%' },
  { value: 'QUOTE_CARD',        label: 'Quote Card',         hint: 'rare' },
  { value: 'IMAGE_FULLSCREEN',  label: 'Image Full',         hint: 'rare' },
] as const;

const TRANSITION_OPTIONS = [
  { value: 'CUT',         label: 'Cut',          hint: 'instant' },
  { value: 'CROSSFADE',   label: 'Crossfade',    hint: 'smooth'  },
  { value: 'DIP_TO_BLACK',label: 'Dip to Black', hint: 'dramatic'},
] as const;

const PIP_POSITIONS = [
  { value: 'bottom-right', label: 'Bottom Right' },
  { value: 'bottom-left',  label: 'Bottom Left'  },
  { value: 'hidden',       label: 'Hidden'       },
] as const;

interface SceneInspectorProps {
  scene: TimelineScene;
  jobId: string;
  onClose: () => void;
}

export function SceneInspector({ scene, jobId, onClose }: SceneInspectorProps) {
  const {
    timeline,
    mutateScene,
    deleteScene,
    setVoiceoverOffset,
    setPipPosition,
    setPipScale,
    selectScene,
    splitScene,
    mergeScenes,
    playheadMs,
  } = useTimelineStore();

  const queryClient = useQueryClient();

  const [isRegening, setIsRegening] = useState(false);
  const [promptDelta, setPromptDelta] = useState('');
  const [showPromptEdit, setShowPromptEdit] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'meta' | 'audio' | 'pip'>('meta');

  // ─── Regen completion feedback via SSE ────────────────────────────────────
  // Listens for scene_image_complete events emitted by the worker after image
  // upload. When the event matches this job + scene, invalidate the timeline
  // query so the editor re-fetches the updated preview_r2_key and regen status.
  const { data: sseEvent } = useSSE('scene_image_complete');
  useEffect(() => {
    if (!sseEvent) return;
    if (sseEvent.job_id !== jobId) return;
    if (sseEvent.payload?.scene_index !== scene.scene_index) return;
    // Invalidate timeline query — re-fetch will bring in updated preview_r2_key
    // and the flipped regeneration_request status.
    queryClient.invalidateQueries({ queryKey: ['timeline', jobId] });
  }, [sseEvent, jobId, scene.scene_index, queryClient]);

  // ─── AI Regen ─────────────────────────────────────────────────────────────

  async function dispatchRegen(
    action: 'full_regen' | 'prompt_delta' | 'swap_layout',
    extra?: object
  ) {
    setIsRegening(true);
    setRegenError(null);
    try {
      const res = await fetch(`/api/timeline/${jobId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene_index: scene.scene_index, action, ...extra }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setRegenError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsRegening(false);
    }
  }

  function handleSwapLayout(newLayout: TimelineScene['layout_type']) {
    mutateScene(scene.scene_id, { layout_type: newLayout });
    dispatchRegen('swap_layout', { new_layout_type: newLayout });
  }

  function handleDelete() {
    if (!confirm(`Delete scene ${scene.scene_index + 1}? This can be undone with Ctrl+Z.`)) return;
    deleteScene(scene.scene_id);
    selectScene(null);
  }

  // ─── Split / Merge ────────────────────────────────────────────────────────

  // Split at current playhead position (offset within this scene)
  const splitOffsetMs = playheadMs - scene.start_ms;
  const canSplit = splitOffsetMs >= 500 && splitOffsetMs <= scene.duration_ms - 500;

  function handleSplit() {
    splitScene(scene.scene_id, splitOffsetMs);
    selectScene(null);
  }

  // Merge with next adjacent scene
  const nextScene = timeline?.scenes.find((s) => s.scene_index === scene.scene_index + 1) ?? null;

  function handleMergeWithNext() {
    if (!nextScene) return;
    mergeScenes(scene.scene_id, nextScene.scene_id);
    selectScene(null);
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="w-72 shrink-0 border-l border-[rgba(75,68,85,0.25)] flex flex-col bg-black/50 overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[rgba(75,68,85,0.25)] shrink-0">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-sm ${
              scene.layout_type === 'AVATAR_PIP'        ? 'bg-lime-400'   :
              scene.layout_type === 'AVATAR_FULLSCREEN' ? 'bg-[#23decb]'  :
              scene.layout_type === 'AVATAR_SPLIT'      ? 'bg-purple-400' :
              scene.layout_type === 'QUOTE_CARD'        ? 'bg-amber-400'  :
              'bg-[#ef4444]'
            }`}
          />
          <div>
            <p className="text-[10px] text-[rgba(205,195,215,0.35)] font-mono leading-none">
              Scene {scene.scene_index + 1} · {(scene.duration_ms / 1000).toFixed(1)}s
            </p>
            <p className="text-xs font-semibold text-[rgba(236,234,230,0.95)] leading-tight">
              {scene.layout_type.replace('AVATAR_', 'Avt ').replace('_', ' ')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleDelete}
            className="p-1.5 rounded hover:bg-red-500/20 transition text-[rgba(205,195,215,0.3)] hover:text-red-400"
            title="Delete scene"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-[#151515] transition text-[rgba(205,195,215,0.35)]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="flex border-b border-[rgba(75,68,85,0.25)] shrink-0">
        {(['meta', 'audio', 'pip'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              'flex-1 py-1.5 text-[10px] font-medium tracking-wider uppercase transition',
              activeTab === tab
                ? 'text-lime-400 border-b border-lime-400'
                : 'text-[rgba(205,195,215,0.3)] hover:text-[rgba(205,195,215,0.6)]',
            ].join(' ')}
          >
            {tab === 'meta' ? 'Content' : tab === 'audio' ? 'Audio' : 'PiP'}
          </button>
        ))}
      </div>

      {/* ── Tab Content ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">

        {/* ══ CONTENT TAB ══ */}
        {activeTab === 'meta' && (
          <>
            {/* Scene metadata */}
            <div className="grid grid-cols-2 gap-1.5 text-[10px]">
              <MetaCell label="Start">{formatMs(scene.start_ms)}</MetaCell>
              <MetaCell label="Zone">{scene.is_hook ? 'Hook' : 'Body'}</MetaCell>
              <MetaCell label="Frames">
                {scene.video_frames.length > 0 ? `${scene.video_frames.length}` : 'Still'}
              </MetaCell>
              <MetaCell label="Duration">{(scene.duration_ms / 1000).toFixed(1)}s</MetaCell>
            </div>

            {/* Transition — editable */}
            <div>
              <SectionLabel>Transition In</SectionLabel>
              <div className="grid grid-cols-1 gap-1">
                {TRANSITION_OPTIONS.map(({ value, label, hint }) => (
                  <button
                    key={value}
                    onClick={() => mutateScene(scene.scene_id, { transition_in: value })}
                    className={[
                      'flex items-center justify-between px-2.5 py-1.5 rounded border text-left transition',
                      scene.transition_in === value
                        ? 'bg-lime-500/15 border-lime-500/30 text-lime-300 cursor-default'
                        : 'bg-[#151515] border-[rgba(75,68,85,0.25)] text-[rgba(205,195,215,0.55)] hover:bg-[#1c1c1c] hover:text-[rgba(236,234,230,0.8)]',
                    ].join(' ')}
                  >
                    <span className="text-[10px] font-medium">{label}</span>
                    <span className="text-[9px] text-[rgba(205,195,215,0.3)]">{hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <Divider />

            {/* Script */}
            <div>
              <SectionLabel>Script</SectionLabel>
              <p className="text-[11px] text-[rgba(205,195,215,0.65)] leading-relaxed bg-[#151515] rounded p-2">
                {scene.paragraph}
              </p>
            </div>

            {/* Image prompt */}
            {scene.image_prompt && (
              <div>
                <SectionLabel>Image Prompt</SectionLabel>
                <p className="text-[10px] text-[rgba(205,195,215,0.45)] leading-relaxed bg-[#151515] rounded p-2 font-mono break-words">
                  {scene.image_prompt}
                </p>
              </div>
            )}

            {/* Shot metadata chips */}
            {(scene.shot_type || scene.camera_angle) && (
              <div className="flex flex-wrap gap-1">
                {scene.shot_type && <Chip>{scene.shot_type}</Chip>}
                {scene.camera_angle && <Chip>{scene.camera_angle}</Chip>}
              </div>
            )}

            <Divider />

            {/* Split / Merge */}
            <div className="space-y-1.5">
              <SectionLabel>Edit Scene</SectionLabel>

              <button
                onClick={handleSplit}
                disabled={!canSplit}
                title={
                  canSplit
                    ? `Split at ${((splitOffsetMs) / 1000).toFixed(1)}s into scene`
                    : 'Move playhead inside this scene (≥0.5s from edges) to split'
                }
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded bg-[#1c1c1c] hover:bg-[rgba(28,28,28,0.9)] border border-[rgba(75,68,85,0.25)] transition text-[11px] text-[rgba(205,195,215,0.7)] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Scissors className="w-3 h-3 shrink-0" />
                <span>
                  {canSplit
                    ? `Split at ${((splitOffsetMs) / 1000).toFixed(1)}s`
                    : 'Split here (place playhead)'}
                </span>
              </button>

              <button
                onClick={handleMergeWithNext}
                disabled={!nextScene}
                title={nextScene ? `Merge with scene ${nextScene.scene_index + 1}` : 'No next scene'}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded bg-[#1c1c1c] hover:bg-[rgba(28,28,28,0.9)] border border-[rgba(75,68,85,0.25)] transition text-[11px] text-[rgba(205,195,215,0.7)] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <GitMerge className="w-3 h-3 shrink-0" />
                <span>
                  {nextScene
                    ? `Merge with scene ${nextScene.scene_index + 1}`
                    : 'Merge with next (last scene)'}
                </span>
              </button>
            </div>

            <Divider />

            {/* Layout swap */}
            <div>
              <SectionLabel>Layout</SectionLabel>
              <div className="grid grid-cols-1 gap-1">
                {LAYOUT_OPTIONS.map(({ value, label, hint }) => (
                  <button
                    key={value}
                    onClick={() => handleSwapLayout(value)}
                    disabled={value === scene.layout_type || isRegening}
                    className={[
                      'flex items-center justify-between px-2.5 py-1.5 rounded border text-left transition',
                      value === scene.layout_type
                        ? 'bg-lime-500/15 border-lime-500/30 text-lime-300 cursor-default'
                        : 'bg-[#151515] border-[rgba(75,68,85,0.25)] text-[rgba(205,195,215,0.55)] hover:bg-[#1c1c1c] hover:text-[rgba(236,234,230,0.8)]',
                    ].join(' ')}
                  >
                    <span className="text-[10px] font-medium">{label}</span>
                    <span className="text-[9px] text-[rgba(205,195,215,0.3)]">{hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <Divider />

            {/* AI Actions */}
            <div className="space-y-1.5">
              <SectionLabel>AI Regeneration</SectionLabel>

              <button
                onClick={() => dispatchRegen('full_regen')}
                disabled={isRegening}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded bg-[#1c1c1c] hover:bg-[rgba(28,28,28,0.9)] border border-[rgba(75,68,85,0.25)] transition text-[11px] text-[rgba(205,195,215,0.7)] disabled:opacity-40"
              >
                <RefreshCw className={`w-3 h-3 ${isRegening ? 'animate-spin' : ''}`} />
                Regenerate Scene Image
              </button>

              <button
                onClick={() => setShowPromptEdit((v) => !v)}
                disabled={isRegening}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded bg-[#1c1c1c] hover:bg-[rgba(28,28,28,0.9)] border border-[rgba(75,68,85,0.25)] transition text-[11px] text-[rgba(205,195,215,0.7)] disabled:opacity-40"
              >
                <Layers className="w-3 h-3" />
                {showPromptEdit ? 'Cancel Prompt Edit' : 'Edit Prompt Delta'}
              </button>

              {showPromptEdit && (
                <div className="space-y-1.5">
                  <textarea
                    value={promptDelta}
                    onChange={(e) => setPromptDelta(e.target.value)}
                    placeholder="Describe what should change…"
                    className="w-full text-[11px] bg-[#151515] border border-[rgba(75,68,85,0.25)] rounded p-2 text-[rgba(205,195,215,0.75)] placeholder-[rgba(205,195,215,0.25)] resize-none focus:outline-none focus:border-lime-500/40"
                    rows={3}
                  />
                  <button
                    onClick={() => {
                      if (promptDelta.trim()) {
                        dispatchRegen('prompt_delta', { new_prompt_delta: promptDelta });
                        setShowPromptEdit(false);
                        setPromptDelta('');
                      }
                    }}
                    disabled={!promptDelta.trim() || isRegening}
                    className="w-full px-3 py-1.5 rounded bg-lime-500/80 hover:bg-lime-400 text-black text-[11px] font-semibold transition disabled:opacity-40"
                  >
                    Apply & Regenerate
                  </button>
                </div>
              )}

              {regenError && (
                <p className="text-[10px] text-red-400 bg-red-400/10 rounded p-2">{regenError}</p>
              )}
            </div>

            {/* Regen history */}
            {scene.regeneration_requests.length > 0 && (
              <div>
                <SectionLabel>History</SectionLabel>
                <div className="space-y-1">
                  {scene.regeneration_requests.slice(-4).map((r, i) => (
                    <div key={i} className="flex items-center justify-between text-[9px] py-0.5">
                      <span className="text-[rgba(205,195,215,0.35)]">{r.action.replace('_', ' ')}</span>
                      <span className={
                        r.status === 'complete'   ? 'text-[#23decb]' :
                        r.status === 'failed'     ? 'text-red-400'   :
                        r.status === 'dispatched' ? 'text-[#f97316]' :
                        'text-[rgba(205,195,215,0.3)]'
                      }>
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ══ AUDIO TAB ══ */}
        {activeTab === 'audio' && (
          <>
            <div>
              <SectionLabel>Voiceover Timing</SectionLabel>
              <p className="text-[10px] text-[rgba(205,195,215,0.35)] mb-2">
                Nudge the voiceover audio relative to this scene&apos;s start.
              </p>
              <SliderControl
                label="Offset"
                value={scene.voiceover.offset_ms}
                min={-2000}
                max={2000}
                step={50}
                unit="ms"
                formatVal={(v) => `${v > 0 ? '+' : ''}${v}ms`}
                onChange={(v) => setVoiceoverOffset(scene.scene_id, v)}
              />
            </div>

            <Divider />

            <div>
              <SectionLabel>Trim</SectionLabel>
              <SliderControl
                label="Trim start"
                value={scene.voiceover.trim_start_ms}
                min={0}
                max={Math.max(0, scene.duration_ms - 100)}
                step={50}
                unit="ms"
                formatVal={(v) => `${v}ms`}
                onChange={(v) =>
                  mutateScene(scene.scene_id, {
                    voiceover: { ...scene.voiceover, trim_start_ms: v },
                  })
                }
              />
            </div>

            <Divider />

            <div className="p-2.5 rounded bg-[#151515] border border-[rgba(75,68,85,0.25)]">
              <p className="text-[10px] text-[rgba(205,195,215,0.35)] leading-relaxed">
                Global music duck and voiceover gain are in the toolbar&apos;s audio panel.
              </p>
            </div>
          </>
        )}

        {/* ══ PiP TAB ══ */}
        {activeTab === 'pip' && (
          <>
            {scene.avatar_pip ? (
              <>
                <div>
                  <SectionLabel>Position</SectionLabel>
                  <div className="grid grid-cols-1 gap-1">
                    {PIP_POSITIONS.map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => setPipPosition(scene.scene_id, value)}
                        className={[
                          'flex items-center justify-between px-2.5 py-1.5 rounded border transition text-[10px]',
                          scene.avatar_pip?.position === value
                            ? 'bg-lime-500/15 border-lime-500/30 text-lime-300'
                            : 'bg-[#151515] border-[rgba(75,68,85,0.25)] text-[rgba(205,195,215,0.55)] hover:bg-[#1c1c1c]',
                        ].join(' ')}
                      >
                        <span>{label}</span>
                        {value === 'bottom-right' && <span className="text-[rgba(205,195,215,0.3)]">⌟</span>}
                        {value === 'bottom-left'  && <span className="text-[rgba(205,195,215,0.3)]">⌞</span>}
                      </button>
                    ))}
                  </div>
                </div>

                <Divider />

                <div>
                  <SectionLabel>Scale</SectionLabel>
                  <SliderControl
                    label="Size"
                    value={Math.round((scene.avatar_pip.scale ?? 0.3) * 100)}
                    min={15}
                    max={60}
                    step={5}
                    unit="%"
                    formatVal={(v) => `${v}%`}
                    onChange={(v) => setPipScale(scene.scene_id, v / 100)}
                  />
                </div>

                <Divider />

                <div>
                  <SectionLabel>Trim</SectionLabel>
                  <SliderControl
                    label="Trim start"
                    value={scene.avatar_pip.trim_start_ms}
                    min={0}
                    max={5000}
                    step={100}
                    unit="ms"
                    formatVal={(v) => `${v}ms`}
                    onChange={(v) =>
                      mutateScene(scene.scene_id, {
                        avatar_pip: { ...scene.avatar_pip!, trim_start_ms: v },
                      })
                    }
                  />
                </div>
              </>
            ) : (
              <div className="p-3 rounded bg-[#151515] border border-[rgba(75,68,85,0.25)] text-center">
                <Move className="w-5 h-5 text-[rgba(205,195,215,0.2)] mx-auto mb-2" />
                <p className="text-[11px] text-[rgba(205,195,215,0.35)]">
                  No PiP for this layout type.
                  <br />
                  Switch to Avatar PiP to enable it.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Small Reusable Atoms ─────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9px] font-semibold tracking-widest uppercase text-[rgba(205,195,215,0.3)] mb-1.5">
      {children}
    </p>
  );
}

function Divider() {
  return <div className="border-t border-[rgba(75,68,85,0.2)]" />;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9px] bg-[#1c1c1c] text-[rgba(205,195,215,0.5)] px-1.5 py-0.5 rounded font-mono">
      {children}
    </span>
  );
}

function MetaCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#151515] rounded p-1.5">
      <p className="text-[8px] text-[rgba(205,195,215,0.3)] uppercase tracking-wider leading-none mb-0.5">{label}</p>
      <p className="text-[10px] text-[rgba(205,195,215,0.7)] font-mono leading-none">{children}</p>
    </div>
  );
}

interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  formatVal: (v: number) => string;
  onChange: (v: number) => void;
}

function SliderControl({ label, value, min, max, step, formatVal, onChange }: SliderControlProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[rgba(205,195,215,0.5)]">{label}</span>
        <span className="text-[10px] text-[rgba(205,195,215,0.7)] font-mono tabular-nums">{formatVal(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 accent-lime-400 bg-[rgba(75,68,85,0.3)] rounded-full appearance-none cursor-pointer"
      />
    </div>
  );
}

function formatMs(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
