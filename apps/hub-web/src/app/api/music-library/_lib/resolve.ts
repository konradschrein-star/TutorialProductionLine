/**
 * Music assignment resolution.
 *
 * Deliberately mirrors the subtitle system: a named bundle (collection) is
 * bound to a scope, and the most specific active binding wins.
 *
 *   format + channel  >  channel only  >  format only  >  global default
 *
 * NULL means "any". A row with both NULL is the house default bed.
 */

export interface ResolvableAssignment {
  id: string;
  collection_id: string;
  format: string | null;
  channel_id: string | null;
  is_active: boolean;
  selection_mode: string;
  volume_db: number;
}

export interface ResolveScope {
  format?: string | null;
  channelId?: string | null;
}

/** Higher wins. Mirrors the precedence documented above. */
export function assignmentSpecificity(
  a: Pick<ResolvableAssignment, "format" | "channel_id">,
): number {
  const hasFormat = a.format !== null;
  const hasChannel = a.channel_id !== null;
  if (hasFormat && hasChannel) return 3;
  if (hasChannel) return 2;
  if (hasFormat) return 1;
  return 0;
}

/** Whether an assignment is applicable to the requested scope at all. */
export function assignmentMatches(
  a: ResolvableAssignment,
  scope: ResolveScope,
): boolean {
  if (!a.is_active) return false;
  if (a.format !== null && a.format !== (scope.format ?? null)) return false;
  if (a.channel_id !== null && a.channel_id !== (scope.channelId ?? null)) {
    return false;
  }
  return true;
}

/**
 * Pick the winning assignment for a scope, or null when nothing applies.
 *
 * Ties (which the DB's `uq_music_assignments_scope` index makes impossible)
 * are broken deterministically by id so behaviour never depends on row order.
 */
export function pickAssignment(
  assignments: ResolvableAssignment[],
  scope: ResolveScope,
): ResolvableAssignment | null {
  const applicable = assignments.filter((a) => assignmentMatches(a, scope));
  if (applicable.length === 0) return null;

  return applicable.reduce((best, cur) => {
    const d = assignmentSpecificity(cur) - assignmentSpecificity(best);
    if (d > 0) return cur;
    if (d < 0) return best;
    return cur.id < best.id ? cur : best;
  });
}

// ---------------------------------------------------------------------------
// Track selection within the resolved collection
// ---------------------------------------------------------------------------

export interface SelectableTrack {
  id: string;
  duration_seconds: number;
  sort_order: number | null;
}

/**
 * Choose tracks from a collection until they cover `targetSeconds`.
 *
 * Returns fewer seconds than requested when the pool is exhausted — the
 * caller decides whether to generate more or fail. This function never
 * fabricates or repeats content to hit the target silently.
 *
 * `rng` is injectable so 'random' mode is testable.
 */
export function selectTracks(args: {
  tracks: SelectableTrack[];
  targetSeconds: number;
  mode: string;
  rng?: () => number;
}): { tracks: SelectableTrack[]; totalSeconds: number; short: boolean } {
  const { tracks, targetSeconds, mode } = args;
  const rng = args.rng ?? Math.random;

  const usable = tracks.filter((t) => t.duration_seconds > 0);

  let ordered: SelectableTrack[];
  switch (mode) {
    case "sequential":
      ordered = [...usable].sort((a, b) => {
        const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
        const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      break;
    case "longest_first":
      ordered = [...usable].sort((a, b) => {
        if (b.duration_seconds !== a.duration_seconds) {
          return b.duration_seconds - a.duration_seconds;
        }
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      break;
    case "random":
    default:
      ordered = shuffle(usable, rng);
      break;
  }

  const picked: SelectableTrack[] = [];
  let total = 0;
  for (const t of ordered) {
    if (total >= targetSeconds) break;
    picked.push(t);
    total += t.duration_seconds;
  }

  return {
    tracks: picked,
    totalSeconds: total,
    short: total < targetSeconds,
  };
}

/** Fisher-Yates, using the injected rng. */
function shuffle<T>(input: T[], rng: () => number): T[] {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
