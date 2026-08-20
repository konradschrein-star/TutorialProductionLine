'use client';

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { VideoTimeline, TimelineScene } from '@repo/contracts';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_UNDO_DEPTH = 50;
const MIN_SCENE_DURATION_MS = 500;

// ─── Types ────────────────────────────────────────────────────────────────────

interface TimelineSnapshot {
  scenes: TimelineScene[];
  global_audio: VideoTimeline['global_audio'];
}

/**
 * Timeline Editor Store (Zustand + Immer)
 *
 * Central state for the timeline editor. Separate from server state
 * (TanStack Query) — this store owns the in-progress edit buffer.
 *
 * Pattern:
 * - On mount: copy fetched VideoTimeline into store (setTimeline)
 * - On edit: mutate store via actions (mutateScene, reorderScenes, etc.)
 * - On save: read store.timeline, POST to /api/timeline/[jobId]
 * - isDirty: true after any edit, false after save or initial load
 *
 * Undo/redo:
 * - Every content mutation calls checkpoint() first, pushing a snapshot to `past`
 *   and clearing `future`.
 * - undo() pops `past`, pushes current to `future`, restores the previous snapshot.
 * - redo() mirrors that in reverse.
 * - Max depth: 50 entries per stack.
 */
interface TimelineStore {
  // ─── Data ──────────────────────────────────────────────────────────────────
  timeline: VideoTimeline | null;

  // ─── Undo / Redo ──────────────────────────────────────────────────────────
  past: TimelineSnapshot[];
  future: TimelineSnapshot[];

  // ─── Playback ──────────────────────────────────────────────────────────────
  playheadMs: number;
  isPlaying: boolean;

  // ─── View ──────────────────────────────────────────────────────────────────
  /** Visible time window. start=0 end=total_duration_ms by default. */
  visibleRange: { start: number; end: number };

  // ─── Selection ─────────────────────────────────────────────────────────────
  /** Single scene inspected in the right panel */
  selectedSceneId: string | null;
  /** Multi-select set for batch operations */
  selectedSceneIds: Set<string>;

  // ─── Save state ────────────────────────────────────────────────────────────
  isDirty: boolean;
  isSaving: boolean;

  // ─── Actions ───────────────────────────────────────────────────────────────
  setTimeline: (t: VideoTimeline) => void;
  setPlayhead: (ms: number) => void;
  setPlaying: (v: boolean) => void;
  setVisibleRange: (range: { start: number; end: number }) => void;
  selectScene: (id: string | null) => void;
  toggleSceneSelection: (id: string) => void;
  clearSelection: () => void;
  selectAllScenes: () => void;
  setIsSaving: (v: boolean) => void;
  markClean: () => void;

  /** Undo the last content mutation */
  undo: () => void;
  /** Redo the last undone mutation */
  redo: () => void;

  /** Patch any fields on a single scene (identified by scene_id) */
  mutateScene: (sceneId: string, patch: Partial<TimelineScene>) => void;

  /** Reorder scenes — update scene_index and recompute start_ms */
  reorderScenes: (activeSceneId: string, overSceneId: string) => void;

  /** Resize a scene — update duration_ms and cascade subsequent start_ms */
  resizeScene: (sceneId: string, newDurationMs: number) => void;

  /** Update global audio settings */
  setGlobalAudio: (patch: Partial<VideoTimeline['global_audio']>) => void;

  /** Remove a scene and recompute start_ms for remaining */
  deleteScene: (sceneId: string) => void;

  /** Update voiceover offset for a scene */
  setVoiceoverOffset: (sceneId: string, offsetMs: number) => void;

  /** Update avatar PiP position for a scene */
  setPipPosition: (sceneId: string, position: 'bottom-right' | 'bottom-left' | 'hidden') => void;

  /** Update avatar PiP scale for a scene */
  setPipScale: (sceneId: string, scale: number) => void;

  /**
   * Apply a patch to multiple scenes at once.
   * Counts as a single undo step.
   */
  batchMutateScenes: (sceneIds: string[], patch: Partial<TimelineScene>) => void;

  /**
   * Delete multiple scenes at once.
   * Refuses if it would leave zero scenes.
   * Counts as a single undo step.
   */
  batchDeleteScenes: (sceneIds: string[]) => void;

  /**
   * Split a scene at splitAtMs (offset from scene start).
   * Both halves must be >= MIN_SCENE_DURATION_MS.
   * Paragraph is split at the nearest word boundary at the time ratio.
   */
  splitScene: (sceneId: string, splitAtMs: number) => void;

  /**
   * Merge two adjacent scenes into one.
   * Validates adjacency — non-adjacent IDs are rejected silently.
   */
  mergeScenes: (sceneIdA: string, sceneIdB: string) => void;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Recompute start_ms for all scenes based on their order and duration_ms.
 * Scenes must be in scene_index order.
 */
function recomputeStartMs(scenes: TimelineScene[]): TimelineScene[] {
  let cursor = 0;
  return scenes.map((s) => {
    const updated = { ...s, start_ms: cursor };
    cursor += s.duration_ms;
    return updated;
  });
}

/**
 * Deep-clone the content portions of a timeline for an undo snapshot.
 * Uses JSON round-trip which is safe for fully-serialisable timeline data
 * and works correctly on Immer draft proxies.
 */
function snapshotContent(
  scenes: unknown,
  global_audio: unknown
): TimelineSnapshot {
  return {
    scenes: JSON.parse(JSON.stringify(scenes)) as TimelineScene[],
    global_audio: JSON.parse(JSON.stringify(global_audio)) as VideoTimeline['global_audio'],
  };
}

/**
 * Push a snapshot of the current timeline onto the past stack and clear future.
 * Must be called inside an Immer `set` callback, before any mutations.
 */
function checkpoint(
  past: TimelineSnapshot[],
  future: TimelineSnapshot[],
  scenes: unknown,
  global_audio: unknown
): void {
  past.push(snapshotContent(scenes, global_audio));
  if (past.length > MAX_UNDO_DEPTH) past.shift();
  // Splice in-place to avoid Immer reference replacement
  future.splice(0, future.length);
}

/**
 * Split a paragraph at approximately `ratio` of its length,
 * breaking at the nearest whitespace boundary.
 */
function splitParagraphAtRatio(
  text: string,
  ratio: number
): { firstPart: string; secondPart: string } {
  const clampedRatio = Math.max(0.1, Math.min(0.9, ratio));
  const targetIdx = Math.floor(text.length * clampedRatio);
  // Find the next space at or after targetIdx
  let splitIdx = text.indexOf(' ', targetIdx);
  if (splitIdx === -1) splitIdx = targetIdx; // no space found — hard cut
  const firstPart = text.slice(0, splitIdx).trim();
  const secondPart = text.slice(splitIdx).trim();
  return {
    firstPart: firstPart || text,
    secondPart: secondPart || '',
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useTimelineStore = create<TimelineStore>()(
  immer((set) => ({
    timeline: null,
    past: [],
    future: [],
    playheadMs: 0,
    isPlaying: false,
    visibleRange: { start: 0, end: 0 },
    selectedSceneId: null,
    selectedSceneIds: new Set<string>(),
    isDirty: false,
    isSaving: false,

    // ── Non-undoable setup actions ─────────────────────────────────────────

    setTimeline: (t) =>
      set((state) => {
        state.timeline = t;
        state.playheadMs = 0;
        state.visibleRange = { start: 0, end: t.total_duration_ms };
        state.isDirty = false;
        state.isSaving = false;
        // Clear undo/redo on fresh load
        state.past.splice(0, state.past.length);
        state.future.splice(0, state.future.length);
      }),

    setPlayhead: (ms) =>
      set((state) => {
        state.playheadMs = ms;
      }),

    setPlaying: (v) =>
      set((state) => {
        state.isPlaying = v;
      }),

    setVisibleRange: (range) =>
      set((state) => {
        state.visibleRange = range;
      }),

    selectScene: (id) =>
      set((state) => {
        state.selectedSceneId = id;
      }),

    toggleSceneSelection: (id) =>
      set((state) => {
        if (state.selectedSceneIds.has(id)) {
          state.selectedSceneIds.delete(id);
        } else {
          state.selectedSceneIds.add(id);
        }
      }),

    clearSelection: () =>
      set((state) => {
        state.selectedSceneIds.clear();
      }),

    selectAllScenes: () =>
      set((state) => {
        if (!state.timeline) return;
        for (const scene of state.timeline.scenes) {
          state.selectedSceneIds.add(scene.scene_id);
        }
      }),

    setIsSaving: (v) =>
      set((state) => {
        state.isSaving = v;
      }),

    markClean: () =>
      set((state) => {
        state.isDirty = false;
      }),

    // ── Undo / Redo ───────────────────────────────────────────────────────

    undo: () =>
      set((state) => {
        if (state.past.length === 0 || !state.timeline) return;
        const prev = state.past[state.past.length - 1]!;
        // Save current state into future before restoring
        state.future.push(
          snapshotContent(state.timeline.scenes, state.timeline.global_audio)
        );
        if (state.future.length > MAX_UNDO_DEPTH) state.future.shift();
        state.past.pop();
        // Restore snapshot
        state.timeline.scenes = prev.scenes as typeof state.timeline.scenes;
        state.timeline.global_audio = prev.global_audio;
        const last = state.timeline.scenes[state.timeline.scenes.length - 1]!;
        state.timeline.total_duration_ms = last.start_ms + last.duration_ms;
        state.visibleRange.end = state.timeline.total_duration_ms;
        state.isDirty = true;
      }),

    redo: () =>
      set((state) => {
        if (state.future.length === 0 || !state.timeline) return;
        const next = state.future[state.future.length - 1]!;
        // Save current state into past before advancing
        state.past.push(
          snapshotContent(state.timeline.scenes, state.timeline.global_audio)
        );
        if (state.past.length > MAX_UNDO_DEPTH) state.past.shift();
        state.future.pop();
        // Apply snapshot
        state.timeline.scenes = next.scenes as typeof state.timeline.scenes;
        state.timeline.global_audio = next.global_audio;
        const last = state.timeline.scenes[state.timeline.scenes.length - 1]!;
        state.timeline.total_duration_ms = last.start_ms + last.duration_ms;
        state.visibleRange.end = state.timeline.total_duration_ms;
        state.isDirty = true;
      }),

    // ── Content mutations (all checkpointed) ──────────────────────────────

    mutateScene: (sceneId, patch) =>
      set((state) => {
        if (!state.timeline) return;
        const idx = state.timeline.scenes.findIndex((s) => s.scene_id === sceneId);
        if (idx === -1) return;
        checkpoint(state.past, state.future, state.timeline.scenes, state.timeline.global_audio);
        Object.assign(state.timeline.scenes[idx], patch);
        const last = state.timeline.scenes[state.timeline.scenes.length - 1]!;
        state.timeline.total_duration_ms = last.start_ms + last.duration_ms;
        state.isDirty = true;
      }),

    reorderScenes: (activeSceneId, overSceneId) =>
      set((state) => {
        if (!state.timeline) return;
        const scenes = state.timeline.scenes;
        const fromIdx = scenes.findIndex((s) => s.scene_id === activeSceneId);
        const toIdx = scenes.findIndex((s) => s.scene_id === overSceneId);
        if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
        checkpoint(state.past, state.future, scenes, state.timeline.global_audio);
        const [moved] = scenes.splice(fromIdx, 1);
        scenes.splice(toIdx, 0, moved!);
        const reindexed = (scenes as TimelineScene[]).map((s, i) => ({ ...s, scene_index: i }));
        state.timeline.scenes = recomputeStartMs(reindexed) as typeof scenes;
        const last = state.timeline.scenes[state.timeline.scenes.length - 1]!;
        state.timeline.total_duration_ms = last.start_ms + last.duration_ms;
        state.isDirty = true;
      }),

    resizeScene: (sceneId, newDurationMs) =>
      set((state) => {
        if (!state.timeline) return;
        const scenes = state.timeline.scenes;
        const idx = scenes.findIndex((s) => s.scene_id === sceneId);
        if (idx === -1) return;
        checkpoint(state.past, state.future, scenes, state.timeline.global_audio);
        scenes[idx]!.duration_ms = Math.max(MIN_SCENE_DURATION_MS, Math.round(newDurationMs));
        let cursor = 0;
        for (let i = 0; i < scenes.length; i++) {
          scenes[i]!.start_ms = cursor;
          cursor += scenes[i]!.duration_ms;
        }
        state.timeline.total_duration_ms = cursor;
        state.visibleRange.end = cursor;
        state.isDirty = true;
      }),

    setGlobalAudio: (patch) =>
      set((state) => {
        if (!state.timeline) return;
        checkpoint(state.past, state.future, state.timeline.scenes, state.timeline.global_audio);
        Object.assign(state.timeline.global_audio, patch);
        state.isDirty = true;
      }),

    deleteScene: (sceneId) =>
      set((state) => {
        if (!state.timeline) return;
        const remaining = (state.timeline.scenes as TimelineScene[]).filter(
          (s) => s.scene_id !== sceneId
        );
        if (remaining.length === 0) return; // refuse to delete last scene
        checkpoint(state.past, state.future, state.timeline.scenes, state.timeline.global_audio);
        const reindexed = remaining.map((s, i) => ({ ...s, scene_index: i }));
        state.timeline.scenes = recomputeStartMs(reindexed) as typeof state.timeline.scenes;
        const last = state.timeline.scenes[state.timeline.scenes.length - 1]!;
        state.timeline.total_duration_ms = last.start_ms + last.duration_ms;
        state.visibleRange.end = state.timeline.total_duration_ms;
        if (state.selectedSceneId === sceneId) state.selectedSceneId = null;
        state.selectedSceneIds.delete(sceneId);
        state.isDirty = true;
      }),

    setVoiceoverOffset: (sceneId, offsetMs) =>
      set((state) => {
        if (!state.timeline) return;
        const scene = state.timeline.scenes.find((s) => s.scene_id === sceneId);
        if (!scene) return;
        checkpoint(state.past, state.future, state.timeline.scenes, state.timeline.global_audio);
        scene.voiceover.offset_ms = offsetMs;
        state.isDirty = true;
      }),

    setPipPosition: (sceneId, position) =>
      set((state) => {
        if (!state.timeline) return;
        const scene = state.timeline.scenes.find((s) => s.scene_id === sceneId);
        if (!scene || !scene.avatar_pip) return;
        checkpoint(state.past, state.future, state.timeline.scenes, state.timeline.global_audio);
        scene.avatar_pip.position = position;
        state.isDirty = true;
      }),

    setPipScale: (sceneId, scale) =>
      set((state) => {
        if (!state.timeline) return;
        const scene = state.timeline.scenes.find((s) => s.scene_id === sceneId);
        if (!scene || !scene.avatar_pip) return;
        checkpoint(state.past, state.future, state.timeline.scenes, state.timeline.global_audio);
        scene.avatar_pip.scale = scale;
        state.isDirty = true;
      }),

    // ── Batch operations ──────────────────────────────────────────────────

    batchMutateScenes: (sceneIds, patch) =>
      set((state) => {
        if (!state.timeline) return;
        checkpoint(state.past, state.future, state.timeline.scenes, state.timeline.global_audio);
        for (const sceneId of sceneIds) {
          const idx = state.timeline.scenes.findIndex((s) => s.scene_id === sceneId);
          if (idx !== -1) Object.assign(state.timeline.scenes[idx], patch);
        }
        const last = state.timeline.scenes[state.timeline.scenes.length - 1]!;
        state.timeline.total_duration_ms = last.start_ms + last.duration_ms;
        state.isDirty = true;
      }),

    batchDeleteScenes: (sceneIds) =>
      set((state) => {
        if (!state.timeline) return;
        const toDelete = new Set(sceneIds);
        const remaining = (state.timeline.scenes as TimelineScene[]).filter(
          (s) => !toDelete.has(s.scene_id)
        );
        if (remaining.length === 0) return; // refuse to delete all scenes
        checkpoint(state.past, state.future, state.timeline.scenes, state.timeline.global_audio);
        const reindexed = remaining.map((s, i) => ({ ...s, scene_index: i }));
        state.timeline.scenes = recomputeStartMs(reindexed) as typeof state.timeline.scenes;
        const last = state.timeline.scenes[state.timeline.scenes.length - 1]!;
        state.timeline.total_duration_ms = last.start_ms + last.duration_ms;
        state.visibleRange.end = state.timeline.total_duration_ms;
        for (const id of sceneIds) state.selectedSceneIds.delete(id);
        if (state.selectedSceneId && toDelete.has(state.selectedSceneId)) {
          state.selectedSceneId = null;
        }
        state.isDirty = true;
      }),

    // ── Split / Merge ─────────────────────────────────────────────────────

    splitScene: (sceneId, splitAtMs) =>
      set((state) => {
        if (!state.timeline) return;
        const idx = state.timeline.scenes.findIndex((s) => s.scene_id === sceneId);
        if (idx === -1) return;
        const scene = state.timeline.scenes[idx]!;
        // Clamp: both halves must meet minimum duration
        const firstDuration = Math.max(
          MIN_SCENE_DURATION_MS,
          Math.min(Math.round(splitAtMs), scene.duration_ms - MIN_SCENE_DURATION_MS)
        );
        const secondDuration = scene.duration_ms - firstDuration;
        if (secondDuration < MIN_SCENE_DURATION_MS) return;

        checkpoint(state.past, state.future, state.timeline.scenes, state.timeline.global_audio);

        const { firstPart, secondPart } = splitParagraphAtRatio(
          scene.paragraph,
          firstDuration / scene.duration_ms
        );

        // Update first scene in-place
        state.timeline.scenes[idx]!.duration_ms = firstDuration;
        state.timeline.scenes[idx]!.paragraph = firstPart;

        // Build second scene from a plain copy of the (now-modified) first
        const firstPlain = JSON.parse(
          JSON.stringify(state.timeline.scenes[idx])
        ) as TimelineScene;
        const newScene: TimelineScene = {
          ...firstPlain,
          scene_id: `${state.timeline.job_id}:scene_split_${Date.now()}`,
          duration_ms: secondDuration,
          paragraph: secondPart,
          regeneration_requests: [],
          video_frames: [],
          preview_r2_key: null,
        };

        // Insert after the current scene
        (state.timeline.scenes as TimelineScene[]).splice(idx + 1, 0, newScene);

        // Reindex and recompute timing
        const reindexed = (state.timeline.scenes as TimelineScene[]).map((s, i) => ({
          ...s,
          scene_index: i,
        }));
        state.timeline.scenes = recomputeStartMs(reindexed) as typeof state.timeline.scenes;
        const last = state.timeline.scenes[state.timeline.scenes.length - 1]!;
        state.timeline.total_duration_ms = last.start_ms + last.duration_ms;
        state.visibleRange.end = state.timeline.total_duration_ms;
        state.isDirty = true;
      }),

    mergeScenes: (sceneIdA, sceneIdB) =>
      set((state) => {
        if (!state.timeline) return;
        const scenes = state.timeline.scenes as TimelineScene[];
        const idxA = scenes.findIndex((s) => s.scene_id === sceneIdA);
        const idxB = scenes.findIndex((s) => s.scene_id === sceneIdB);
        if (idxA === -1 || idxB === -1) return;
        // Must be adjacent
        if (Math.abs(idxA - idxB) !== 1) return;

        checkpoint(state.past, state.future, state.timeline.scenes, state.timeline.global_audio);

        const [firstIdx, secondIdx] = idxA < idxB ? [idxA, idxB] : [idxB, idxA] as [number, number];
        const first = scenes[firstIdx]!;
        const second = scenes[secondIdx]!;

        // Merge duration and paragraph into first scene
        state.timeline.scenes[firstIdx]!.duration_ms = first.duration_ms + second.duration_ms;
        state.timeline.scenes[firstIdx]!.paragraph =
          `${first.paragraph} ${second.paragraph}`.trim();

        // Remove second scene
        state.timeline.scenes.splice(secondIdx, 1);

        // Reindex and recompute timing
        const reindexed = (state.timeline.scenes as TimelineScene[]).map((s, i) => ({
          ...s,
          scene_index: i,
        }));
        state.timeline.scenes = recomputeStartMs(reindexed) as typeof state.timeline.scenes;
        const last = state.timeline.scenes[state.timeline.scenes.length - 1]!;
        state.timeline.total_duration_ms = last.start_ms + last.duration_ms;
        state.visibleRange.end = state.timeline.total_duration_ms;
        if (state.selectedSceneId === sceneIdB) state.selectedSceneId = sceneIdA;
        state.selectedSceneIds.delete(sceneIdB);
        state.isDirty = true;
      }),
  }))
);
