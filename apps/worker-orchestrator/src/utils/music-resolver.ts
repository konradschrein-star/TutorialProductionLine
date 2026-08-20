/**
 * Global music resolution for format processors.
 *
 * A format asks "what music should this job use?" and gets back the tracks
 * bound to its scope. The binding lives in `music_assignments`, which mirrors
 * the subtitle system's preset+assignment model:
 *
 *   format + channel  >  channel only  >  format only  >  global default
 *
 * Deliberate non-behaviours:
 *  - No silent fallback. When nothing is assigned, this returns
 *    `assignment: null`. A processor that wants to generate instead must say
 *    so explicitly. A format quietly receiving arbitrary music is the same
 *    class of bug as the provider-fallback incident that shipped bad
 *    thumbnails without anyone noticing.
 *  - No repeating tracks to pad out a target duration. A shortfall is
 *    reported as `short` so the caller can decide.
 */

import { and, eq } from "drizzle-orm";
import { stat } from "node:fs/promises";
import type { DrizzleClient } from "@repo/db";
import {
  musicAssignments,
  musicCollections,
  musicCollectionTracks,
  musicLibrary,
} from "@repo/db";

export interface ResolveScope {
  format?: string | null;
  channelId?: string | null;
}

export interface ResolvedAssignment {
  id: string;
  collectionId: string;
  selectionMode: string;
  volumeDb: number;
}

export interface ResolvedTrack {
  id: string;
  name: string;
  file_path: string;
  duration_seconds: number;
  creator: string | null;
  license: string | null;
  attribution_required: boolean;
}

export interface ResolvedMusic {
  assignment: ResolvedAssignment | null;
  tracks: ResolvedTrack[];
  totalSeconds: number;
  short: boolean;
  /** Rows whose audio file is missing from disk — visible, not fatal. */
  unavailableTrackIds: string[];
  reason?: string;
}

interface AssignmentRow {
  id: string;
  collection_id: string;
  format: string | null;
  channel_id: string | null;
  is_active: boolean;
  selection_mode: string;
  volume_db: number;
}

/** Higher wins. */
export function specificity(a: {
  format: string | null;
  channel_id: string | null;
}): number {
  const f = a.format !== null;
  const c = a.channel_id !== null;
  if (f && c) return 3;
  if (c) return 2;
  if (f) return 1;
  return 0;
}

export function matches(a: AssignmentRow, scope: ResolveScope): boolean {
  if (!a.is_active) return false;
  if (a.format !== null && a.format !== (scope.format ?? null)) return false;
  if (a.channel_id !== null && a.channel_id !== (scope.channelId ?? null)) {
    return false;
  }
  return true;
}

/** Most specific applicable assignment, ties broken deterministically by id. */
export function pickAssignment(
  assignments: AssignmentRow[],
  scope: ResolveScope,
): AssignmentRow | null {
  const applicable = assignments.filter((a) => matches(a, scope));
  if (applicable.length === 0) return null;
  return applicable.reduce((best, cur) => {
    const d = specificity(cur) - specificity(best);
    if (d > 0) return cur;
    if (d < 0) return best;
    return cur.id < best.id ? cur : best;
  });
}

/** Order a pool according to the assignment's selection mode. */
export function orderTracks<
  T extends { id: string; duration_seconds: number; sort_order: number | null },
>(tracks: T[], mode: string, rng: () => number = Math.random): T[] {
  const usable = tracks.filter((t) => t.duration_seconds > 0);

  if (mode === "sequential") {
    return [...usable].sort((a, b) => {
      const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }
  if (mode === "longest_first") {
    return [...usable].sort((a, b) => {
      if (b.duration_seconds !== a.duration_seconds) {
        return b.duration_seconds - a.duration_seconds;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  const out = [...usable];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/**
 * Resolve music for a job.
 *
 * @param targetSec how many seconds of music the job needs; 0 means "just tell
 *                  me the assignment".
 */
export async function resolveMusicForScope(
  db: DrizzleClient,
  scope: ResolveScope,
  targetSec: number,
): Promise<ResolvedMusic> {
  const assignmentRows = await db
    .select({
      id: musicAssignments.id,
      collection_id: musicAssignments.collection_id,
      format: musicAssignments.format,
      channel_id: musicAssignments.channel_id,
      is_active: musicAssignments.is_active,
      selection_mode: musicAssignments.selection_mode,
      volume_db: musicAssignments.volume_db,
    })
    .from(musicAssignments)
    .innerJoin(
      musicCollections,
      eq(musicCollections.id, musicAssignments.collection_id),
    )
    .where(eq(musicCollections.is_active, true));

  const assignment = pickAssignment(assignmentRows, scope);

  if (!assignment) {
    return {
      assignment: null,
      tracks: [],
      totalSeconds: 0,
      short: targetSec > 0,
      unavailableTrackIds: [],
      reason: `No music collection assigned to format=${scope.format ?? "*"}, channel=${scope.channelId ?? "*"}, and no global default exists.`,
    };
  }

  const rows = await db
    .select({
      id: musicLibrary.id,
      name: musicLibrary.name,
      file_path: musicLibrary.file_path,
      duration_seconds: musicLibrary.duration_seconds,
      creator: musicLibrary.creator,
      license: musicLibrary.license,
      attribution_required: musicLibrary.attribution_required,
      sort_order: musicCollectionTracks.sort_order,
    })
    .from(musicCollectionTracks)
    .innerJoin(musicLibrary, eq(musicLibrary.id, musicCollectionTracks.track_id))
    .where(
      and(
        eq(musicCollectionTracks.collection_id, assignment.collection_id),
        eq(musicLibrary.is_active, true),
      ),
    );

  // Skip rows whose audio was pruned from disk. Handing one to ffmpeg would
  // fail deep in the render instead of here, where it can be reported.
  const available: typeof rows = [];
  const unavailableTrackIds: string[] = [];
  for (const row of rows) {
    try {
      const s = await stat(row.file_path);
      if (s.isFile() && s.size > 0) available.push(row);
      else unavailableTrackIds.push(row.id);
    } catch {
      unavailableTrackIds.push(row.id);
    }
  }

  const ordered = orderTracks(available, assignment.selection_mode);
  const picked: ResolvedTrack[] = [];
  let total = 0;
  for (const t of ordered) {
    if (total >= targetSec) break;
    picked.push({
      id: t.id,
      name: t.name,
      file_path: t.file_path,
      duration_seconds: t.duration_seconds,
      creator: t.creator,
      license: t.license,
      attribution_required: t.attribution_required,
    });
    total += t.duration_seconds;
  }

  return {
    assignment: {
      id: assignment.id,
      collectionId: assignment.collection_id,
      selectionMode: assignment.selection_mode,
      volumeDb: assignment.volume_db,
    },
    tracks: picked,
    totalSeconds: total,
    short: total < targetSec,
    unavailableTrackIds,
  };
}
