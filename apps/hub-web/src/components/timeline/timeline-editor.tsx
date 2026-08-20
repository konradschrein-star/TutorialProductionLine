'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TimelineContext, useRow, useTimelineMonitor, useTimelineContext } from 'dnd-timeline';
import type { OnRangeChanged, ResizeEndEvent } from 'dnd-timeline';
import type { DragEndEvent } from '@dnd-kit/core';
import { Music2, ChevronDown, ChevronUp, Undo2, Redo2, Film } from 'lucide-react';
import { useTimelineStore } from './use-timeline-store';
import { useSSE } from '@/hooks/use-sse';
import { TimelineRuler } from './timeline-ruler';
import { SceneBlockWithContext } from './scene-block';
import { Playhead } from './playhead';
import { ZoneStrip } from './zone-strip';
import { SceneInspector } from './scene-inspector';
import { CanvasCompositor } from './canvas-compositor';
import type { VideoTimeline } from '@repo/contracts';

// ─── Constants ────────────────────────────────────────────────────────────────

const SIDEBAR_WIDTH = 112;
const TRACK_HEIGHTS = { video: 80, pip: 36, text: 28, audio: 44 } as const;
const TOTAL_TRACKS_HEIGHT =
  TRACK_HEIGHTS.video + TRACK_HEIGHTS.pip + TRACK_HEIGHTS.text + TRACK_HEIGHTS.audio;

// ─── API helpers ─────────────────────────────────────────────────────────────

async function fetchTimeline(jobId: string): Promise<VideoTimeline> {
  const res = await fetch(`/api/timeline/${jobId}`);
  if (!res.ok) throw new Error(res.statusText);
  return (await res.json()).timeline as VideoTimeline;
}

async function patchTimeline(timeline: VideoTimeline): Promise<VideoTimeline> {
  const res = await fetch(`/api/timeline/${timeline.job_id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(timeline),
  });
  if (!res.ok) throw new Error(res.statusText);
  return (await res.json()).timeline as VideoTimeline;
}

// ─── Video Track Row ─────────────────────────────────────────────────────────

function VideoTrackRow({ scenes }: { scenes: VideoTimeline['scenes'] }) {
  const { setNodeRef, rowStyle } = useRow({ id: 'video' });
  return (
    <div
      ref={setNodeRef}
      className="relative border-b border-[rgba(75,68,85,0.15)] bg-[#0d0d0d]"
      style={{ ...rowStyle, height: TRACK_HEIGHTS.video }}
    >
      {scenes.map((scene) => (
        <SceneBlockWithContext key={scene.scene_id} scene={scene} />
      ))}
    </div>
  );
}

// ─── PiP Track Row ───────────────────────────────────────────────────────────
// Positioned manually via valueToPixels from context (not draggable).

function PipTrackRowInner({ scenes }: { scenes: VideoTimeline['scenes'] }) {
  const { setNodeRef, rowStyle } = useRow({ id: 'pip' });
  const { valueToPixels, range } = useTimelineContext();

  const pipScenes = scenes.filter(
    (s) => s.avatar_pip && s.avatar_pip.position !== 'hidden'
  );

  return (
    <div
      ref={setNodeRef}
      className="relative border-b border-[rgba(75,68,85,0.15)] bg-[#0d0d0d]"
      style={{ ...rowStyle, height: TRACK_HEIGHTS.pip }}
    >
      {pipScenes.map((scene) => {
        const left = valueToPixels(scene.start_ms, range);
        const width = valueToPixels(scene.start_ms + scene.duration_ms, range) - left;
        return (
          <div
            key={scene.scene_id}
            className="absolute top-1 bottom-1 rounded bg-[rgba(170,255,0,0.15)] border border-[rgba(170,255,0,0.3)] flex items-center px-1.5 overflow-hidden"
            style={{ left, width: Math.max(0, width) }}
          >
            <span className="text-[8px] text-[rgba(170,255,0,0.8)] font-mono truncate">
              PiP · {scene.avatar_pip?.position?.replace('bottom-', '') ?? ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Audio Track Row ─────────────────────────────────────────────────────────

/**
 * Waveform bar chart rendered as an inline SVG.
 * peaks: normalised [0,1] amplitudes. w/h: pixel dimensions of the container.
 * sliceStart/sliceEnd: fraction of the full waveform to render (for zoom/pan).
 */
function WaveformSVG({
  peaks,
  w,
  h,
  sliceStart = 0,
  sliceEnd = 1,
}: {
  peaks: number[];
  w: number;
  h: number;
  sliceStart?: number;
  sliceEnd?: number;
}) {
  const start = Math.floor(peaks.length * sliceStart);
  const end   = Math.ceil(peaks.length * sliceEnd);
  const slice = peaks.slice(start, end);
  if (slice.length === 0 || w <= 0 || h <= 0) return null;

  const barW = w / slice.length;
  const midY = h / 2;

  return (
    <svg
      width={w}
      height={h}
      className="absolute inset-0 pointer-events-none"
      style={{ opacity: 0.55 }}
    >
      {slice.map((amp, i) => {
        const halfH = Math.max(1, (amp * midY * 0.9));
        return (
          <rect
            key={i}
            x={i * barW}
            y={midY - halfH}
            width={Math.max(0.5, barW - 0.5)}
            height={halfH * 2}
            fill="rgba(170,255,0,0.6)"
            rx={0.5}
          />
        );
      })}
    </svg>
  );
}

function AudioTrackRowInner({
  scenes,
  waveformPeaks,
  waveformDurationMs,
}: {
  scenes: VideoTimeline['scenes'];
  waveformPeaks: number[] | null;
  waveformDurationMs: number;
}) {
  const { setNodeRef, rowStyle } = useRow({ id: 'audio' });
  const { valueToPixels, range } = useTimelineContext();
  const trackH = TRACK_HEIGHTS.audio - 6; // inner height (minus padding)

  return (
    <div
      ref={setNodeRef}
      className="relative border-b border-[rgba(75,68,85,0.15)] bg-[#0d0d0d]"
      style={{ ...rowStyle, height: TRACK_HEIGHTS.audio }}
    >
      {scenes.map((scene) => {
        const left  = valueToPixels(scene.start_ms, range);
        const right = valueToPixels(scene.start_ms + scene.duration_ms, range);
        const width = Math.max(0, right - left);
        const offsetShift =
          valueToPixels(scene.voiceover.offset_ms, range) - valueToPixels(0, range);
        const hasOffset = scene.voiceover.offset_ms !== 0;
        const showSceneNum = width >= 44;
        const showText     = width >= 120;

        // Waveform slice: map this scene's time range onto the peaks array
        const sliceStart = waveformDurationMs > 0
          ? scene.start_ms / waveformDurationMs
          : 0;
        const sliceEnd = waveformDurationMs > 0
          ? (scene.start_ms + scene.duration_ms) / waveformDurationMs
          : 1;

        return (
          <div
            key={scene.scene_id}
            className="absolute top-1.5 bottom-1.5 rounded bg-[rgba(126,118,144,0.15)] border border-[rgba(126,118,144,0.3)] flex items-center gap-1 px-1.5 overflow-hidden"
            style={{ left: left + offsetShift, width }}
          >
            {/* Real waveform when available, static placeholder otherwise */}
            {waveformPeaks && width >= 24 ? (
              <WaveformSVG
                peaks={waveformPeaks}
                w={width - 4}
                h={trackH}
                sliceStart={sliceStart}
                sliceEnd={sliceEnd}
              />
            ) : width >= 28 ? (
              // Fallback static bars while waveform loads
              <div className="flex items-center gap-px shrink-0 h-4 z-10">
                {[3,5,7,6,8,5,4].map((bar, i) => (
                  <div key={i} className="w-px rounded-full bg-[rgba(170,255,0,0.55)]" style={{ height: bar * 2 }} />
                ))}
              </div>
            ) : null}

            {showSceneNum && (
              <span className="text-[9px] font-bold text-[rgba(205,195,215,0.6)] shrink-0 tabular-nums leading-none z-10 relative">
                #{scene.scene_index + 1}
              </span>
            )}

            {showText && (
              <span className="text-[8px] text-[rgba(205,195,215,0.4)] truncate leading-tight flex-1 min-w-0 z-10 relative">
                {scene.paragraph}
              </span>
            )}

            {hasOffset && (
              <span className="text-[7px] text-[rgba(205,195,215,0.35)] font-mono shrink-0 z-10 relative">
                {scene.voiceover.offset_ms > 0 ? '+' : ''}{scene.voiceover.offset_ms}ms
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Text Track Row ───────────────────────────────────────────────────────────

function TextTrackRowInner({ scenes }: { scenes: VideoTimeline['scenes'] }) {
  const { setNodeRef, rowStyle } = useRow({ id: 'text' });
  const { valueToPixels, range } = useTimelineContext();

  const overlayScenes = scenes.filter((s) => s.text_overlays.length > 0);

  return (
    <div
      ref={setNodeRef}
      className="relative border-b border-[rgba(75,68,85,0.15)] bg-[#0d0d0d]"
      style={{ ...rowStyle, height: TRACK_HEIGHTS.text }}
    >
      {overlayScenes.map((scene) => {
        const left = valueToPixels(scene.start_ms, range);
        const width = valueToPixels(scene.start_ms + scene.duration_ms, range) - left;
        return (
          <div
            key={scene.scene_id}
            className="absolute top-1 bottom-1 rounded bg-amber-500/20 border border-amber-400/25 flex items-center px-1.5 overflow-hidden"
            style={{ left, width: Math.max(0, width) }}
          >
            <span className="text-[7px] text-amber-300/70 truncate">
              {scene.text_overlays[0]?.text ?? ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── dnd-timeline monitor (inside context) ───────────────────────────────────

function TimelineMonitor() {
  const { reorderScenes } = useTimelineStore();

  useTimelineMonitor({
    onDragEnd: (event: DragEndEvent) => {
      if (!event.active || !event.over) return;
      const activeId = String(event.active.id);
      const overId   = String(event.over.id);
      if (activeId !== overId) reorderScenes(activeId, overId);
    },
  });

  return null;
}

// ─── Batch Action Bar ─────────────────────────────────────────────────────────

const BATCH_LAYOUT_OPTIONS = [
  { value: 'AVATAR_PIP',        label: 'Avatar PiP'   },
  { value: 'AVATAR_FULLSCREEN', label: 'Avatar Full'  },
  { value: 'AVATAR_SPLIT',      label: 'Avatar Split' },
  { value: 'QUOTE_CARD',        label: 'Quote Card'   },
  { value: 'IMAGE_FULLSCREEN',  label: 'Image Full'   },
] as const;

function BatchActionBar({ jobId }: { jobId: string }) {
  const { selectedSceneIds, clearSelection, batchMutateScenes, batchDeleteScenes } =
    useTimelineStore();
  const count = selectedSceneIds.size;
  const [isRegening, setIsRegening] = useState(false);

  if (count < 2) return null;

  const ids = Array.from(selectedSceneIds);

  function handleBatchLayout(layout: string) {
    batchMutateScenes(ids, { layout_type: layout as any });
    clearSelection();
  }

  function handleBatchDelete() {
    if (!confirm(`Delete ${count} scenes? This can be undone with Ctrl+Z.`)) return;
    batchDeleteScenes(ids);
  }

  async function handleBatchRegen() {
    if (isRegening) return;
    // Resolve scene_index for each selected scene_id
    const sceneIndices = useTimelineStore
      .getState()
      .timeline?.scenes
      .filter((s) => selectedSceneIds.has(s.scene_id))
      .map((s) => s.scene_index) ?? [];

    if (sceneIndices.length === 0) return;
    setIsRegening(true);
    try {
      await Promise.all(
        sceneIndices.map((idx) =>
          fetch(`/api/timeline/${jobId}/regenerate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scene_index: idx, action: 'full_regen' }),
          })
        )
      );
      clearSelection();
    } catch (err) {
      console.error('[batch-regen]', err);
    } finally {
      setIsRegening(false);
    }
  }

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 bg-lime-500/10 border-b border-lime-500/20 shrink-0">
      <span className="text-[11px] text-lime-300 font-semibold">
        {count} scenes selected
      </span>
      <span className="text-[rgba(205,195,215,0.2)]">·</span>

      {/* Layout picker */}
      <div className="relative">
        <select
          onChange={(e) => { if (e.target.value) handleBatchLayout(e.target.value); e.target.value = ''; }}
          defaultValue=""
          className="appearance-none bg-[#151515] border border-[rgba(75,68,85,0.25)] text-[rgba(205,195,215,0.7)] text-[10px] rounded px-2 py-1 pr-5 cursor-pointer focus:outline-none focus:border-lime-400/50"
        >
          <option value="" disabled>Apply Layout…</option>
          {BATCH_LAYOUT_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* Regen all */}
      <button
        onClick={handleBatchRegen}
        disabled={isRegening}
        className="px-2.5 py-1 rounded bg-[rgba(35,222,203,0.15)] border border-[rgba(35,222,203,0.25)] text-[#23decb] text-[10px] font-medium hover:bg-[rgba(35,222,203,0.25)] transition disabled:opacity-40"
      >
        {isRegening ? 'Dispatching…' : `Regen ${count}`}
      </button>

      <button
        onClick={handleBatchDelete}
        className="px-2.5 py-1 rounded bg-red-500/20 border border-red-500/25 text-red-400 text-[10px] font-medium hover:bg-red-500/30 transition"
      >
        Delete {count}
      </button>

      <button
        onClick={clearSelection}
        className="ml-auto px-2.5 py-1 rounded bg-[#151515] border border-[rgba(75,68,85,0.25)] text-[rgba(205,195,215,0.4)] text-[10px] hover:bg-[#1c1c1c] transition"
      >
        Clear
      </button>
    </div>
  );
}

// ─── Global Audio Panel ───────────────────────────────────────────────────────

function GlobalAudioPanel({ timeline }: { timeline: VideoTimeline }) {
  const { setGlobalAudio } = useTimelineStore();
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-[rgba(75,68,85,0.25)] shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-[#151515] transition text-xs text-[rgba(205,195,215,0.5)]"
      >
        <span className="flex items-center gap-2">
          <Music2 className="w-3.5 h-3.5 text-[rgba(205,195,215,0.5)]" />
          Global Audio
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-3 bg-[#0d0d0d]">
          <AudioSlider
            label="Music duck"
            value={timeline.global_audio.music_duck_db}
            min={-30}
            max={0}
            step={1}
            format={(v) => `${v} dB`}
            onChange={(v) => setGlobalAudio({ music_duck_db: v })}
          />
          <AudioSlider
            label="Voiceover gain"
            value={timeline.global_audio.voiceover_gain_db}
            min={-12}
            max={6}
            step={0.5}
            format={(v) => `${v > 0 ? '+' : ''}${v} dB`}
            onChange={(v) => setGlobalAudio({ voiceover_gain_db: v })}
          />
        </div>
      )}
    </div>
  );
}

function AudioSlider({
  label, value, min, max, step, format, onChange,
}: {
  label: string; value: number; min: number; max: number;
  step: number; format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-[rgba(205,195,215,0.35)]">{label}</span>
        <span className="text-[rgba(205,195,215,0.65)] font-mono tabular-nums">{format(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 accent-lime-400 bg-[rgba(75,68,85,0.3)] rounded-full appearance-none cursor-pointer"
      />
    </div>
  );
}

// ─── Main Editor ─────────────────────────────────────────────────────────────

export function TimelineEditor({ jobId, jobTitle }: { jobId: string; jobTitle: string }) {
  const {
    timeline, setTimeline, visibleRange, setVisibleRange,
    playheadMs, setPlayhead, isPlaying, setPlaying,
    isDirty, isSaving, setIsSaving, markClean,
    selectedSceneId, selectScene,
    selectedSceneIds, clearSelection, batchMutateScenes, batchDeleteScenes,
    undo, redo, past, future,
  } = useTimelineStore();

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  const [renderState, setRenderState] = useState<'idle' | 'saving' | 'queued' | 'complete' | 'error'>('idle');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const simIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSyncingRef = useRef(false); // prevent feedback loop between audio timeupdate and setPlayhead
  const editorRef = useRef<HTMLDivElement>(null);

  // ── Fetch timeline ─────────────────────────────────────────────────────────
  const { data, isLoading, error } = useQuery({
    queryKey: ['timeline', jobId],
    queryFn: () => fetchTimeline(jobId),
    retry: false,
  });

  useEffect(() => { if (data) setTimeline(data); }, [data, setTimeline]);

  // ── Fetch waveform peaks ───────────────────────────────────────────────────
  const { data: waveformData } = useQuery({
    queryKey: ['waveform', jobId],
    queryFn: async () => {
      const res = await fetch(`/api/timeline/${jobId}/waveform`);
      if (!res.ok) return null;
      return res.json() as Promise<{ peaks: number[]; duration_ms: number }>;
    },
    retry: false,
    staleTime: 600_000, // 10 min — waveform doesn't change once TTS is done
  });

  // ── Audio element setup ───────────────────────────────────────────────────
  // Create a single hidden <audio> element on mount and tear it down on unmount.
  useEffect(() => {
    const audio = new Audio(`/api/timeline/${jobId}/audio`);
    audio.preload = 'metadata';

    // When audio time changes during playback, push playhead position to store.
    audio.ontimeupdate = () => {
      if (isSyncingRef.current) return;
      const ms = Math.round(audio.currentTime * 1000);
      setPlayhead(ms);
    };

    // When audio ends, stop playback and reset to start.
    audio.onended = () => {
      setPlaying(false);
      setPlayhead(0);
    };

    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, [jobId, setPlayhead, setPlaying]);

  // ── Play / Pause ──────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      // Clear any stale simulation before starting real audio
      if (simIntervalRef.current !== null) {
        clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
      }
      // Sync currentTime before playing in case playhead was moved manually
      const targetSec = useTimelineStore.getState().playheadMs / 1000;
      if (Math.abs(audio.currentTime - targetSec) > 0.2) {
        audio.currentTime = targetSec;
      }
      audio.play().catch(() => {
        // Audio not available (job has no TTS yet) — simulate playback via interval
        const TICK_MS = 100;
        simIntervalRef.current = setInterval(() => {
          const store = useTimelineStore.getState();
          const next = store.playheadMs + TICK_MS;
          const totalMs = store.timeline?.total_duration_ms ?? 0;
          if (next >= totalMs) {
            store.setPlayhead(totalMs);
            store.setPlaying(false);
            if (simIntervalRef.current !== null) {
              clearInterval(simIntervalRef.current);
              simIntervalRef.current = null;
            }
          } else {
            store.setPlayhead(next);
          }
        }, TICK_MS);
      });
    } else {
      audio.pause();
      if (simIntervalRef.current !== null) {
        clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
      }
    }
    return () => {
      if (simIntervalRef.current !== null) {
        clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
      }
    };
  }, [isPlaying, setPlaying]);

  // ── Sync playhead scrub → audio currentTime ───────────────────────────────
  // When the operator moves the playhead manually (not from audio.timeupdate),
  // seek the audio element to match.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || isPlaying) return; // during playback audio drives playhead, not vice versa
    const targetSec = playheadMs / 1000;
    if (Math.abs(audio.currentTime - targetSec) > 0.05) {
      isSyncingRef.current = true;
      audio.currentTime = targetSec;
      // Reset flag after a tick
      setTimeout(() => { isSyncingRef.current = false; }, 50);
    }
  }, [playheadMs, isPlaying]);

  // ── Render completion SSE feedback ───────────────────────────────────────
  const { data: renderCompleteEvent } = useSSE('render_complete');
  const { data: renderFailedEvent  } = useSSE('render_failed');

  useEffect(() => {
    if (!renderCompleteEvent) return;
    if (renderCompleteEvent.job_id !== jobId && renderCompleteEvent.payload?.['job_id'] !== jobId) return;
    setRenderState('complete');
    setTimeout(() => setRenderState('idle'), 8_000);
  }, [renderCompleteEvent, jobId]);

  useEffect(() => {
    if (!renderFailedEvent) return;
    if (renderFailedEvent.job_id !== jobId && renderFailedEvent.payload?.['job_id'] !== jobId) return;
    setRenderState('error');
  }, [renderFailedEvent, jobId]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const tl = useTimelineStore.getState().timeline;
    if (!tl || isSaving) return;
    setIsSaving(true);
    try {
      const saved = await patchTimeline(tl);
      setTimeline(saved);
      markClean();
    } catch (err) {
      console.error('[timeline] save failed:', err);
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, setIsSaving, setTimeline, markClean]);

  // ── Queue Render ──────────────────────────────────────────────────────────
  const handleQueueRender = useCallback(async () => {
    if (renderState !== 'idle' && renderState !== 'error') return;
    // Force-save unsaved changes before dispatching
    if (isDirty) {
      setRenderState('saving');
      await handleSave();
    }
    setRenderState('saving');
    try {
      const res = await fetch(`/api/timeline/${jobId}/render`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as Record<string, unknown>;
        console.error('[timeline] render dispatch failed:', data);
        setRenderState('error');
        return;
      }
      setRenderState('queued');
      // Reset after 5s so the button can be re-used
      setTimeout(() => setRenderState('idle'), 5_000);
    } catch (err) {
      console.error('[timeline] render dispatch error:', err);
      setRenderState('error');
    }
  }, [renderState, isDirty, handleSave, jobId]);

  // ── Keyboard shortcuts (unified handler) ──────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const inInput = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName);
      const mod = e.ctrlKey || e.metaKey;

      // Modifier shortcuts fire even inside inputs
      if (mod) {
        if (e.code === 'KeyS') { e.preventDefault(); handleSave(); return; }
        if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if (e.code === 'KeyZ' &&  e.shiftKey) { e.preventDefault(); redo(); return; }
        if (e.code === 'KeyY')                { e.preventDefault(); redo(); return; }
      }

      // Non-modifier shortcuts are blocked when typing
      if (inInput) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying(!useTimelineStore.getState().isPlaying);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        const cur = useTimelineStore.getState().playheadMs;
        setPlayhead(Math.max(0, cur - (e.shiftKey ? 1000 : 100)));
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        const cur = useTimelineStore.getState().playheadMs;
        const total = useTimelineStore.getState().timeline?.total_duration_ms ?? 0;
        setPlayhead(Math.min(total, cur + (e.shiftKey ? 1000 : 100)));
      } else if (e.code === 'Escape') {
        selectScene(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPlaying, setPlayhead, selectScene, handleSave, undo, redo]);

  // ── Zoom ──────────────────────────────────────────────────────────────────
  const zoomIn = useCallback(() => {
    if (!timeline) return;
    const mid = (visibleRange.start + visibleRange.end) / 2;
    const half = (visibleRange.end - visibleRange.start) / 4;
    setVisibleRange({
      start: Math.max(0, mid - half),
      end:   Math.min(timeline.total_duration_ms, mid + half),
    });
  }, [visibleRange, timeline, setVisibleRange]);

  const zoomOut = useCallback(() => {
    if (!timeline) return;
    const mid = (visibleRange.start + visibleRange.end) / 2;
    const half = visibleRange.end - visibleRange.start;
    setVisibleRange({
      start: Math.max(0, mid - half),
      end:   Math.min(timeline.total_duration_ms, mid + half),
    });
  }, [visibleRange, timeline, setVisibleRange]);

  const zoomFit = useCallback(() => {
    if (!timeline) return;
    setVisibleRange({ start: 0, end: timeline.total_duration_ms });
  }, [timeline, setVisibleRange]);

  const handleRangeChanged: OnRangeChanged = useCallback(
    (fn) => setVisibleRange(fn(visibleRange)),
    [visibleRange, setVisibleRange]
  );

  // ── States ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-[rgba(205,195,215,0.35)]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-5 h-5 rounded-full border-2 border-[rgba(75,68,85,0.3)] border-t-[rgba(205,195,215,0.7)] animate-spin" />
          <p className="text-xs">Loading timeline…</p>
        </div>
      </div>
    );
  }

  if (error || (!timeline && !isLoading)) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="bg-[#151515] rounded-xl p-6 border border-red-500/20 text-center max-w-sm space-y-2">
          <p className="text-sm font-semibold text-red-400">Timeline unavailable</p>
          <p className="text-xs text-[rgba(205,195,215,0.35)]">
            {error instanceof Error
              ? error.message
              : 'Job has not completed scene analysis yet.'}
          </p>
        </div>
      </div>
    );
  }

  if (!timeline) return null;

  const selectedScene = selectedSceneId
    ? timeline.scenes.find((s) => s.scene_id === selectedSceneId) ?? null
    : null;

  // Pixels per ms — fills ~1200px for the full duration
  const rangeMs  = Math.max(1, visibleRange.end - visibleRange.start);
  const pxPerMs  = 1200 / rangeMs;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div ref={editorRef} className="flex flex-col h-full bg-black text-white select-none">

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[rgba(75,68,85,0.25)] bg-black/50 shrink-0">

        {/* Playback */}
        <button
          onClick={() => setPlaying(!isPlaying)}
          className="flex items-center gap-1.5 w-20 justify-center px-3 py-1.5 rounded-lg bg-[#151515] hover:bg-[#1c1c1c] transition text-xs font-medium"
          title="Space"
        >
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>

        {/* Time display */}
        <span className="font-mono text-[11px] text-[rgba(205,195,215,0.35)] tabular-nums w-28">
          {fmtMs(playheadMs)} / {fmtMs(timeline.total_duration_ms)}
        </span>

        {/* Undo / Redo */}
        <div className="flex items-center rounded-lg overflow-hidden border border-[rgba(75,68,85,0.25)] text-xs">
          <button
            onClick={undo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            className="px-2 py-1.5 hover:bg-[#151515] transition border-r border-[rgba(75,68,85,0.25)] disabled:opacity-25 disabled:cursor-not-allowed"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title="Redo (⌘⇧Z)"
            className="px-2 py-1.5 hover:bg-[#151515] transition disabled:opacity-25 disabled:cursor-not-allowed"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Zoom */}
        <div className="flex items-center rounded-lg overflow-hidden border border-[rgba(75,68,85,0.25)] text-xs">
          <button onClick={zoomOut} className="px-2.5 py-1.5 hover:bg-[#151515] transition border-r border-[rgba(75,68,85,0.25)]">−</button>
          <button onClick={zoomFit} className="px-2.5 py-1.5 hover:bg-[#151515] transition text-[10px]">Fit</button>
          <button onClick={zoomIn}  className="px-2.5 py-1.5 hover:bg-[#151515] transition border-l border-[rgba(75,68,85,0.25)]">+</button>
        </div>

        <span className="text-[9px] text-[rgba(205,195,215,0.2)] hidden sm:block">
          ← → scrub · Space play · ⌘Z/⌘⇧Z undo/redo · ⌘S save · ⌘-click multi-select
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Scene count */}
        <span className="text-[10px] text-[rgba(205,195,215,0.3)] font-mono">
          {timeline.scenes.length} scenes
        </span>

        {isDirty && (
          <span className="text-[10px] text-amber-400/80 animate-pulse">Unsaved</span>
        )}

        {/* Queue Render */}
        <button
          onClick={handleQueueRender}
          disabled={renderState === 'saving' || renderState === 'queued' || renderState === 'complete'}
          title="Save and dispatch to render queue"
          className={[
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition',
            renderState === 'queued'
              ? 'bg-green-600/30 text-green-300 border border-green-500/30 cursor-default'
              : renderState === 'complete'
              ? 'bg-lime-600/30 text-lime-300 border border-lime-500/30 cursor-default'
              : renderState === 'error'
              ? 'bg-red-600/30 text-red-300 border border-red-500/30 hover:bg-red-600/40'
              : renderState === 'saving'
              ? 'bg-[#151515] text-[rgba(205,195,215,0.25)] cursor-not-allowed'
              : 'bg-[#151515] text-[rgba(205,195,215,0.7)] hover:bg-[#1c1c1c] border border-[rgba(75,68,85,0.25)]',
          ].join(' ')}
        >
          <Film className={`w-3 h-3 ${renderState === 'saving' ? 'animate-spin' : ''}`} />
          {renderState === 'complete' ? 'Done!' : renderState === 'queued' ? 'Queued!' : renderState === 'saving' ? 'Saving…' : renderState === 'error' ? 'Retry Render' : 'Queue Render'}
        </button>

        <button
          onClick={handleSave}
          disabled={!isDirty || isSaving}
          className={[
            'px-4 py-1.5 rounded-lg text-xs font-semibold transition',
            isDirty && !isSaving
              ? 'bg-lime-500 text-black hover:bg-lime-400'
              : 'bg-[#151515] text-[rgba(205,195,215,0.25)] cursor-not-allowed',
          ].join(' ')}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* ── Batch action bar (visible when ≥2 scenes selected) ─────────── */}
      <BatchActionBar jobId={jobId} />

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Track area ──────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

          {/* Track body: labels + scroll area */}
          <div className="flex flex-1 min-h-0 overflow-hidden">

            {/* Track labels */}
            <div
              className="shrink-0 border-r border-[rgba(75,68,85,0.2)] flex flex-col bg-[#0d0d0d]"
              style={{ width: SIDEBAR_WIDTH }}
            >
              {/* offset for ruler + zone strip */}
              <div style={{ height: 32 + 16 }} />
              <TLabel label="Video"  h={TRACK_HEIGHTS.video}  color="text-lime-400"   />
              <TLabel label="PiP"    h={TRACK_HEIGHTS.pip}    color="text-[#aaff00]"  />
              <TLabel label="Text"   h={TRACK_HEIGHTS.text}   color="text-amber-400"  />
              <TLabel label="Audio"  h={TRACK_HEIGHTS.audio}  color="text-[rgba(205,195,215,0.5)]" />
            </div>

            {/* Scrollable track area */}
            <div className="flex-1 overflow-x-auto overflow-y-hidden relative">
              <TimelineContext
                range={visibleRange}
                onRangeChanged={handleRangeChanged}
                sidebarWidth={0}
                onResizeEnd={() => {}}
              >
                <TimelineMonitor />
                <TimelineRuler pxPerMs={pxPerMs} />
                <ZoneStrip timeline={timeline} pxPerMs={pxPerMs} />

                {/* Track rows */}
                <div className="relative">
                  <Playhead tracksTotalHeight={TOTAL_TRACKS_HEIGHT} />
                  <VideoTrackRow    scenes={timeline.scenes} />
                  <PipTrackRowInner scenes={timeline.scenes} />
                  <TextTrackRowInner  scenes={timeline.scenes} />
                  <AudioTrackRowInner
                    scenes={timeline.scenes}
                    waveformPeaks={waveformData?.peaks ?? null}
                    waveformDurationMs={waveformData?.duration_ms ?? timeline.total_duration_ms}
                  />
                </div>
              </TimelineContext>
            </div>
          </div>

          {/* Global audio panel at bottom */}
          <GlobalAudioPanel timeline={timeline} />
        </div>

        {/* ── Right panel: inspector or preview ───────────────────────── */}
        {selectedScene ? (
          <SceneInspector
            scene={selectedScene}
            jobId={jobId}
            onClose={() => selectScene(null)}
          />
        ) : (
          <div className="w-72 shrink-0 border-l border-[rgba(75,68,85,0.25)] flex flex-col bg-[#0d0d0d]">
            <div className="flex-1 flex items-center justify-center p-4">
              <CanvasCompositor
                timeline={timeline}
                aspectRatio="16:9"
                className="w-full"
              />
            </div>
            <div className="px-3 py-2 border-t border-[rgba(75,68,85,0.2)]">
              <p className="text-[9px] text-[rgba(205,195,215,0.25)] text-center">
                Click a scene block to inspect it
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function TLabel({ label, h, color }: { label: string; h: number; color: string }) {
  return (
    <div
      className={`flex items-center px-3 border-b border-[rgba(75,68,85,0.15)] ${color}`}
      style={{ height: h }}
    >
      <span className="text-[9px] font-semibold tracking-widest uppercase">{label}</span>
    </div>
  );
}

function fmtMs(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const t = Math.floor((s % 1) * 10);
  return `${m}:${String(sec).padStart(2, '0')}.${t}`;
}
