import {
  and,
  desc,
  eq,
  or,
  isNull,
  isNotNull,
  sql,
  inArray,
} from "drizzle-orm";
import type { DrizzleClient } from "../client.js";
import { tutorialChannelProfile, type TutorialChannelProfile } from "@repo/contracts";
import { channels } from "../schema/channels.js";
import {
  thumbnailArchetypes,
  channelThumbnailArchetypes,
  channelPersonas,
  channelThumbnailProfiles,
  thumbnails,
  thumbnailFormatRules,
  thumbnailAutopilotPolicies,
  DEFAULT_CHANNEL_ARCHETYPE_TIER,
} from "../schema/thumbnails.js";
import type { ChannelArchetypeTier } from "../schema/thumbnails.js";
import type {
  NewThumbnailArchetype,
  ThumbnailArchetype,
  ChannelPersona,
  NewChannelPersona,
  ChannelThumbnailProfile,
  NewChannelThumbnailProfile,
  Thumbnail,
  NewThumbnail,
  ThumbnailFormatRule,
  NewThumbnailFormatRule,
  ThumbnailAutopilotPolicy,
  NewThumbnailAutopilotPolicy,
} from "../schema/thumbnails.js";

/**
 * The difficulty of the tutorial a thumbnail is being made for.
 *
 * NOTHING IN THE PIPELINE PRODUCES THIS TODAY — it is always null at the call
 * site. `tutorial_jobs` has no difficulty/complexity/level column (verified on
 * prod, 2367 rows); `mode` is a script LENGTH shape, not a difficulty; and the
 * Keyword Tool's `length_class`/`duration_sec` are fetched at job-creation time
 * and discarded before insert (`keyword_ref` is populated on 3 of 2367 rows and
 * is unreachable from the worker anyway).
 *
 * It is threaded through as an explicit parameter so that the day a real signal
 * IS stored on the job, wiring it up is one line at the call site and no schema
 * change. Deriving it here from the title would be inventing a classifier, and
 * a guessed difficulty routing a thumbnail is worse than no difficulty at all.
 */
export type TutorialDifficulty = Extract<
  ChannelArchetypeTier,
  "advanced" | "beginner"
>;

export interface ArchetypeCandidateResolution {
  candidates: ThumbnailArchetype[];
  source: "curated" | "global";
  /** Which link tiers were pooled. */
  tiers: ChannelArchetypeTier[];
  difficulty: TutorialDifficulty | null;
  /** Why the difficulty tiers were NOT used. Null when a difficulty was given. */
  difficultyNote: string | null;
  /**
   * Set when a CURATED channel resolved to zero usable archetypes. The caller
   * must refuse with this as the reason. It is never a licence to fall back to
   * the global library — a curated channel's set is exhaustive.
   */
  emptyCurationReason: string | null;
}

// ── Archetypes ────────────────────────────────────────────────────────────

export async function createThumbnailArchetype(
  db: DrizzleClient,
  data: NewThumbnailArchetype,
): Promise<ThumbnailArchetype> {
  const [row] = await db.insert(thumbnailArchetypes).values(data).returning();
  if (!row) throw new Error("Failed to create thumbnail archetype");
  return row;
}

export async function updateThumbnailArchetype(
  db: DrizzleClient,
  id: string,
  patch: Partial<Omit<ThumbnailArchetype, "id" | "created_at">>,
): Promise<ThumbnailArchetype> {
  const [row] = await db
    .update(thumbnailArchetypes)
    .set({ ...patch, updated_at: new Date() })
    .where(eq(thumbnailArchetypes.id, id))
    .returning();
  if (!row) throw new Error(`Thumbnail archetype ${id} not found`);
  return row;
}

export async function listThumbnailArchetypes(
  db: DrizzleClient,
  opts: {
    /** "global" = channel_id IS NULL only. A uuid = that channel's own archetypes
     *  PLUS all global ones. Omitted = everything. */
    scope?: "all" | "global" | (string & {});
    activeOnly?: boolean;
  } = {},
): Promise<ThumbnailArchetype[]> {
  const filters = [];
  if (opts.activeOnly) filters.push(eq(thumbnailArchetypes.is_active, true));
  if (opts.scope === "global") {
    filters.push(isNull(thumbnailArchetypes.channel_id));
  } else if (opts.scope && opts.scope !== "all") {
    filters.push(
      or(
        isNull(thumbnailArchetypes.channel_id),
        eq(thumbnailArchetypes.channel_id, opts.scope),
      )!,
    );
  }
  const q = db.select().from(thumbnailArchetypes);
  const rows = filters.length ? await q.where(and(...filters)) : await q;
  return rows.sort(
    (a, b) =>
      a.sort_order - b.sort_order ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}

export async function deleteThumbnailArchetype(
  db: DrizzleClient,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(thumbnailArchetypes)
    .where(eq(thumbnailArchetypes.id, id))
    .returning({ id: thumbnailArchetypes.id });
  return rows.length > 0;
}

export async function getThumbnailArchetypeById(
  db: DrizzleClient,
  id: string,
): Promise<ThumbnailArchetype | undefined> {
  const [row] = await db
    .select()
    .from(thumbnailArchetypes)
    .where(eq(thumbnailArchetypes.id, id))
    .limit(1);
  return row;
}

// ── Channel ↔ archetype links ─────────────────────────────────────────────

/**
 * Replace the archetypes a channel cycles through IN ONE TIER.
 *
 * Scoped to `tier` on purpose. The previous version deleted every row for the
 * channel, so saving the base cycle from the UI would silently wipe the
 * advanced/beginner sets and the primary flag — the classic "one save clears
 * configuration you cannot see on this screen" bug.
 *
 * `is_primary` is carried across the rewrite for any archetype that stays in
 * the set: the operator chose a main template, and re-ordering the cycle is not
 * a statement about that choice.
 */
export async function setChannelArchetypes(
  db: DrizzleClient,
  channelId: string,
  archetypeIds: string[],
  tier: ChannelArchetypeTier = DEFAULT_CHANNEL_ARCHETYPE_TIER,
): Promise<void> {
  const existing = await db
    .select({
      archetype_id: channelThumbnailArchetypes.archetype_id,
      is_primary: channelThumbnailArchetypes.is_primary,
    })
    .from(channelThumbnailArchetypes)
    .where(
      and(
        eq(channelThumbnailArchetypes.channel_id, channelId),
        eq(channelThumbnailArchetypes.tier, tier),
      ),
    );
  const wasPrimary = new Set(
    existing.filter((r) => r.is_primary).map((r) => r.archetype_id),
  );

  await db
    .delete(channelThumbnailArchetypes)
    .where(
      and(
        eq(channelThumbnailArchetypes.channel_id, channelId),
        eq(channelThumbnailArchetypes.tier, tier),
      ),
    );
  if (archetypeIds.length > 0) {
    await db.insert(channelThumbnailArchetypes).values(
      archetypeIds.map((archetype_id, i) => ({
        channel_id: channelId,
        archetype_id,
        tier,
        is_primary: wasPrimary.has(archetype_id),
        // The caller's array order IS the cycle order.
        sort_order: i,
      })),
    );
  }
}

/**
 * Make one archetype the channel's primary/"main" template, clearing any
 * previous one. The archetype must already be linked to the channel — a
 * primary template that is not in the channel's set is not a thing.
 */
export async function setChannelPrimaryArchetype(
  db: DrizzleClient,
  channelId: string,
  archetypeId: string | null,
): Promise<void> {
  await db
    .update(channelThumbnailArchetypes)
    .set({ is_primary: false })
    .where(
      and(
        eq(channelThumbnailArchetypes.channel_id, channelId),
        eq(channelThumbnailArchetypes.is_primary, true),
      ),
    );
  if (!archetypeId) return;
  const rows = await db
    .update(channelThumbnailArchetypes)
    .set({ is_primary: true })
    .where(
      and(
        eq(channelThumbnailArchetypes.channel_id, channelId),
        eq(channelThumbnailArchetypes.archetype_id, archetypeId),
      ),
    )
    .returning({ id: channelThumbnailArchetypes.id });
  if (rows.length === 0) {
    throw new Error(
      `Archetype ${archetypeId} is not linked to channel ${channelId}, so it ` +
        `cannot be its primary template. Add it to the channel's cycle first.`,
    );
  }
}

/** The channel's primary/"main" template, if one is set. */
export async function getChannelPrimaryArchetype(
  db: DrizzleClient,
  channelId: string,
): Promise<ThumbnailArchetype | undefined> {
  const [link] = await db
    .select({ archetype_id: channelThumbnailArchetypes.archetype_id })
    .from(channelThumbnailArchetypes)
    .where(
      and(
        eq(channelThumbnailArchetypes.channel_id, channelId),
        eq(channelThumbnailArchetypes.is_primary, true),
      ),
    )
    .limit(1);
  if (!link) return undefined;
  return getThumbnailArchetypeById(db, link.archetype_id);
}

/**
 * Archetypes a channel cycles through, for a format, within a set of tiers.
 *
 * The link row's `sort_order` wins over the archetype's own, so the operator
 * orders a channel's rotation without renumbering the shared library.
 */
export async function getChannelArchetypesForFormat(
  db: DrizzleClient,
  channelId: string,
  format: string,
  tiers: readonly ChannelArchetypeTier[] = [DEFAULT_CHANNEL_ARCHETYPE_TIER],
): Promise<ThumbnailArchetype[]> {
  return (await resolveChannelCuration(db, channelId, format, tiers))
    .candidates;
}

/** What a channel's curation resolves to, and what it dropped on the way. */
export interface ChannelCurationState {
  /** True when the channel has curated ANY archetype, in any tier. */
  hasCuration: boolean;
  /** Links in the requested tiers, before the active/format filters. */
  linkedInTier: number;
  /** Usable archetypes, in the operator's ring order. */
  candidates: ThumbnailArchetype[];
  /** Curated but is_active = false. */
  droppedInactive: number;
  /** Curated and active, but restricted to other formats. */
  droppedFormat: number;
}

/**
 * Resolve a channel's curated archetypes AND why any were dropped.
 *
 * The diagnostics exist because an empty result used to be indistinguishable
 * from "this channel curated nothing", and the caller quietly widened to the
 * global library on both. An operator who deactivates the wrong row deserves
 * to be told that is what emptied his cycle.
 */
export async function resolveChannelCuration(
  db: DrizzleClient,
  channelId: string,
  format: string,
  tiers: readonly ChannelArchetypeTier[] = [DEFAULT_CHANNEL_ARCHETYPE_TIER],
): Promise<ChannelCurationState> {
  const links = await db
    .select({
      archetype_id: channelThumbnailArchetypes.archetype_id,
      tier: channelThumbnailArchetypes.tier,
      sort_order: channelThumbnailArchetypes.sort_order,
      weight: channelThumbnailArchetypes.weight,
    })
    .from(channelThumbnailArchetypes)
    .where(eq(channelThumbnailArchetypes.channel_id, channelId));

  const hasCuration = links.length > 0;
  const wanted = new Set<string>(tiers);
  const linkOrder = new Map<string, number>();
  // Selection frequency per archetype (migration 0070). Carried onto the
  // returned rows so the cycle can widen an archetype's slice of the hash
  // space without the picker needing another DB round-trip.
  const linkWeight = new Map<string, number>();
  for (const l of links) {
    if (wanted.has(l.tier)) {
      linkOrder.set(l.archetype_id, l.sort_order);
      linkWeight.set(l.archetype_id, l.weight ?? 1);
    }
  }
  const ids = [...linkOrder.keys()];
  const empty: ChannelCurationState = {
    hasCuration,
    linkedInTier: ids.length,
    candidates: [],
    droppedInactive: 0,
    droppedFormat: 0,
  };
  if (ids.length === 0) return empty;

  // Fetch WITHOUT the is_active filter so an inactive row is counted, not
  // silently absent — that count is the difference between "you deactivated
  // them" and "you never picked any".
  const rows = await db
    .select()
    .from(thumbnailArchetypes)
    .where(inArray(thumbnailArchetypes.id, ids));
  const active = rows.filter((r) => r.is_active);
  const candidates = active.filter((r) => matchesFormat(r, format));

  return {
    hasCuration,
    linkedInTier: ids.length,
    candidates: candidates
      .sort(
        (a, b) =>
          (linkOrder.get(a.id) ?? 0) - (linkOrder.get(b.id) ?? 0) ||
          archetypeRingOrder(a, b),
      )
      .map((a) => ({ ...a, weight: linkWeight.get(a.id) ?? 1 })),
    droppedInactive: rows.length - active.length,
    droppedFormat: active.length - candidates.length,
  };
}

/** An empty `formats` array means "no restriction" — usable by every format. */
function matchesFormat(a: ThumbnailArchetype, format: string): boolean {
  return a.formats.length === 0 || a.formats.includes(format);
}

/**
 * The canonical ring order for archetype cycling.
 *
 * Cycling is only meaningful if the candidate pool has a DEFINED order. Both
 * candidate queries used a bare `db.select()` with no ORDER BY, so with 43
 * never-used archetypes the "least recently used" pick collapsed to whatever
 * row Postgres happened to return first — stable-looking, undefined, and
 * silently re-shuffled by any VACUUM or update. Sorting here makes the cycle
 * reproducible and lets the operator control it via sort_order.
 */
function archetypeRingOrder(
  a: ThumbnailArchetype,
  b: ThumbnailArchetype,
): number {
  return (
    a.sort_order - b.sort_order ||
    a.name.localeCompare(b.name, undefined, { numeric: true }) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Resolve the candidate archetype pool for a generation, in priority order:
 *
 *   1. Archetypes the channel has explicitly CURATED (link table) — if a
 *      channel has curated any, that curation is respected exclusively.
 *   2. Otherwise, archetypes OWNED by the channel (channel_id = channelId)
 *      plus all GLOBAL archetypes (channel_id IS NULL).
 *
 * This is what makes the ~44 imported global archetypes usable without
 * assigning them to a channel. Returns [] only when nothing at all matches,
 * which the caller must surface as an explicit skip — never a silent
 * substitution.
 */
export async function resolveArchetypeCandidates(
  db: DrizzleClient,
  channelId: string | null,
  format: string,
  difficulty: TutorialDifficulty | null = null,
): Promise<ArchetypeCandidateResolution> {
  // ── Difficulty → tiers ───────────────────────────────────────────────────
  //
  // `advanced`/`beginner` ADD to the base cycle rather than replacing it. Two
  // reasons, both concrete:
  //   * the owner said the base five are what he uses "primarily, from now on",
  //     and named the difficulty sets as ones that are "good" for those cases —
  //     an addition, not a veto;
  //   * the advanced set is a SINGLE archetype today, so an exclusive tier would
  //     put the identical thumbnail on every advanced video. That is exactly the
  //     clumping this cycling mechanism exists to prevent.
  // Change the tier list here if he ever wants the sets to be exclusive.
  const tiers: ChannelArchetypeTier[] = difficulty
    ? [DEFAULT_CHANNEL_ARCHETYPE_TIER, difficulty]
    : [DEFAULT_CHANNEL_ARCHETYPE_TIER];

  // WHY a request can arrive with difficulty = null, ALWAYS, today:
  // nothing in the pipeline produces a difficulty. `tutorial_jobs` has no
  // difficulty/complexity/level column; `mode` is a script LENGTH shape;
  // `keyword_ref` is set on 3 of 2367 prod rows and the Keyword Tool's
  // `length_class`/`duration_sec` are dropped at job submit and never persisted.
  // So the advanced/beginner tiers are CONFIGURED BUT UNSELECTED until a real
  // signal is stored on the job. This is recorded on every resolution rather
  // than silently defaulting — see `difficultyNote`.
  const difficultyNote = difficulty
    ? null
    : "no difficulty signal: tutorial_jobs stores no difficulty/complexity " +
      "column, so only the base tier is selectable";

  if (channelId) {
    const curation = await resolveChannelCuration(db, channelId, format, tiers);
    /**
     * ── CURATION IS AUTHORITATIVE ────────────────────────────────────────
     * The owner, on the archetypes he picked for his three channels: "the
     * stuff that I named should be the ONLY cycle of reference thumbnails
     * that are used for each of the three channels. I did select them with
     * having something in my head."
     *
     * This used to be `if (curated.length > 0)`, which meant an EMPTY curated
     * pool fell through to the global library of ~29 archetypes. Every way of
     * emptying that pool — deactivating a row, a format restriction that
     * excludes the job's format, an empty tier — therefore ended with the
     * engine picking a template the owner had deliberately not chosen, and
     * nothing anywhere said so. That turns his selection into a suggestion.
     *
     * A channel that has curated ANYTHING now never widens to the global
     * library. If its pool resolves empty the caller gets zero candidates and
     * refuses with the diagnostics below — a visible `failed` row naming the
     * cause. Shipping no thumbnail is recoverable; shipping one built from a
     * template he rejected is not.
     */
    if (curation.hasCuration) {
      return {
        candidates: curation.candidates,
        source: "curated",
        tiers,
        difficulty,
        difficultyNote,
        emptyCurationReason:
          curation.candidates.length > 0
            ? null
            : `channel has ${curation.linkedInTier} curated archetype(s) in ` +
              `tier(s) ${tiers.join("+")} but none are usable ` +
              `(${curation.droppedInactive} inactive, ` +
              `${curation.droppedFormat} restricted to other formats). ` +
              `Refusing to substitute an archetype the channel did not ` +
              `curate — re-activate one, or widen its formats to include ` +
              `${format}.`,
      };
    }
  }

  const scopeFilter = channelId
    ? or(
        isNull(thumbnailArchetypes.channel_id),
        eq(thumbnailArchetypes.channel_id, channelId),
      )!
    : isNull(thumbnailArchetypes.channel_id);

  const rows = await db
    .select()
    .from(thumbnailArchetypes)
    .where(and(eq(thumbnailArchetypes.is_active, true), scopeFilter));

  return {
    candidates: rows
      .filter((r) => matchesFormat(r, format))
      .sort(archetypeRingOrder),
    source: "global",
    tiers,
    difficulty,
    difficultyNote,
    // Only a channel with NO curation at all reaches the global library.
    emptyCurationReason: null,
  };
}

// ── Channel personas — READ-ONLY COMPAT (migration 0061) ──────────────────
//
// `channel_personas` is a VIEW over the character library now. Reading it still
// works and returns the channel's primary host character. Writing it does not,
// and must not: a writable shadow copy of the character library is exactly the
// two-sources-of-truth failure this project has paid for before.

export async function getChannelPersona(
  db: DrizzleClient,
  channelId: string,
): Promise<ChannelPersona | undefined> {
  const [row] = await db
    .select()
    .from(channelPersonas)
    .where(eq(channelPersonas.channel_id, channelId))
    .limit(1);
  return row;
}

/**
 * REMOVED by migration 0061 — kept as an explicit throw so any caller that
 * slipped through the sweep fails with an instruction instead of a Postgres
 * "cannot insert into view" stack trace.
 */
export async function upsertChannelPersona(
  _db: DrizzleClient,
  _data: NewChannelPersona,
): Promise<never> {
  throw new Error(
    "channel_personas is a read-only view over the character library " +
      "(migration 0061). A channel's host is a CHARACTER with many images, not " +
      "a single image_path — that is what makes thumbnail cycling possible. " +
      "Create/edit the character in the Character Library (/characters) and " +
      "bind it to the channel with role='host'.",
  );
}

// ── Channel profiles ──────────────────────────────────────────────────────

export async function getChannelThumbnailProfile(
  db: DrizzleClient,
  channelId: string,
): Promise<ChannelThumbnailProfile | undefined> {
  const [row] = await db
    .select()
    .from(channelThumbnailProfiles)
    .where(eq(channelThumbnailProfiles.channel_id, channelId))
    .limit(1);
  return row;
}

/** Channel-owned tutorial thumbnail workflow and prompt overrides. Keeping the
 * lookup in the repository boundary lets workers use the same profile contract
 * without reaching through a mocked Drizzle client in engine tests. */
export async function getTutorialChannelProfile(
  db: DrizzleClient,
  channelId: string,
): Promise<TutorialChannelProfile> {
  const [row] = await db
    .select({ metadata: channels.metadata })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  return tutorialChannelProfile(row?.metadata);
}

export async function upsertChannelThumbnailProfile(
  db: DrizzleClient,
  data: NewChannelThumbnailProfile,
): Promise<ChannelThumbnailProfile> {
  const [row] = await db
    .insert(channelThumbnailProfiles)
    .values(data)
    .onConflictDoUpdate({
      target: channelThumbnailProfiles.channel_id,
      set: { ...data, updated_at: new Date() },
    })
    .returning();
  if (!row) throw new Error("Failed to upsert channel thumbnail profile");
  return row;
}

// ── Thumbnail records ─────────────────────────────────────────────────────

export async function createThumbnailRecord(
  db: DrizzleClient,
  data: NewThumbnail,
): Promise<Thumbnail> {
  const [row] = await db.insert(thumbnails).values(data).returning();
  if (!row) throw new Error("Failed to create thumbnail record");
  return row;
}

export async function updateThumbnailRecord(
  db: DrizzleClient,
  id: string,
  patch: Partial<Omit<Thumbnail, "id" | "created_at">>,
): Promise<Thumbnail> {
  const [row] = await db
    .update(thumbnails)
    .set(patch)
    .where(eq(thumbnails.id, id))
    .returning();
  if (!row) throw new Error(`Thumbnail ${id} not found`);
  return row;
}

export async function getThumbnailById(
  db: DrizzleClient,
  id: string,
): Promise<Thumbnail | undefined> {
  const [row] = await db
    .select()
    .from(thumbnails)
    .where(eq(thumbnails.id, id))
    .limit(1);
  return row;
}

export async function listThumbnailsForSubject(
  db: DrizzleClient,
  subjectKind: "content_job" | "tutorial_job" | "studio" | "test",
  subjectId: string,
): Promise<Thumbnail[]> {
  return db
    .select()
    .from(thumbnails)
    .where(
      and(
        eq(thumbnails.subject_kind, subjectKind),
        eq(thumbnails.subject_id, subjectId),
      ),
    )
    .orderBy(desc(thumbnails.created_at));
}

function normalizedThumbnailLanguageFilter(language: string) {
  const value = language.trim().toLowerCase();
  const normalized =
    (
      {
        english: "en",
        german: "de",
        french: "fr",
        italian: "it",
        dutch: "nl",
        swedish: "sv",
      } as Record<string, string>
    )[value] ?? value;
  return sql`case lower(trim(${thumbnails.language}))
      when 'english' then 'en'
      when 'german' then 'de'
      when 'french' then 'fr'
      when 'italian' then 'it'
      when 'dutch' then 'nl'
      when 'swedish' then 'sv'
      else lower(trim(${thumbnails.language}))
    end = ${normalized}`;
}

/** Marks one thumbnail selected and clears the flag on its siblings. */
export async function selectThumbnail(
  db: DrizzleClient,
  thumbnailId: string,
): Promise<Thumbnail> {
  const [target] = await db
    .select()
    .from(thumbnails)
    .where(eq(thumbnails.id, thumbnailId))
    .limit(1);
  if (!target) throw new Error(`Thumbnail ${thumbnailId} not found`);
  await db
    .update(thumbnails)
    .set({ is_selected: false })
    .where(
      and(
        eq(thumbnails.subject_kind, target.subject_kind),
        eq(thumbnails.subject_id, target.subject_id),
        normalizedThumbnailLanguageFilter(target.language),
      ),
    );
  return updateThumbnailRecord(db, thumbnailId, { is_selected: true });
}

/**
 * LRU archetype selection: from the given candidates, return the archetype
 * used longest ago for this channel (or never used). Returns undefined if no
 * candidates.
 *
 * `offset` steps forward in the SAME ordering, which is what makes a
 * multi-variant batch cycle instead of collapsing. Every variant of a batch is
 * enqueued at once and therefore reads an identical usage table, so without an
 * offset all three variants pick the same archetype and the "cycle 44
 * archetypes per channel" behaviour degenerates to "always the same one".
 * Pass `variantIndex` here.
 *
 * Ordering is fully deterministic: (last used asc, never-used first) then the
 * archetype ring order (sort_order, name, id). Ties are never left to the
 * database's row order.
 */
/**
 * NOT USED BY THE THUMBNAIL ENGINE ANY MORE (see
 * apps/worker-orchestrator/src/utils/thumbnail/archetype-cycle.ts).
 *
 * LRU is a function of global generation history, not of the job, so replaying
 * a job re-reads a usage table that has moved on and returns a different
 * archetype than the one recorded on the row. The engine now cycles
 * deterministically per subject. Kept because it is still the right primitive
 * for an operator-facing "what has this channel not used lately" view.
 */
export async function pickLeastRecentlyUsedArchetype(
  db: DrizzleClient,
  channelId: string | null,
  candidates: ThumbnailArchetype[],
  offset = 0,
): Promise<ThumbnailArchetype | undefined> {
  const ordered = await orderArchetypesByLeastRecentlyUsed(
    db,
    channelId,
    candidates,
  );
  if (ordered.length === 0) return undefined;
  const step = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
  return ordered[step % ordered.length];
}

/**
 * The full cycling order for a candidate pool — least-recently-used first.
 * Exposed so the UI can show the operator what the next picks WILL be, and so
 * the offset arithmetic above has one implementation.
 */
export async function orderArchetypesByLeastRecentlyUsed(
  db: DrizzleClient,
  channelId: string | null,
  candidates: ThumbnailArchetype[],
): Promise<ThumbnailArchetype[]> {
  if (candidates.length === 0) return [];
  const candidateIds = candidates.map((c) => c.id);
  const scopeFilter = channelId
    ? eq(thumbnails.channel_id, channelId)
    : isNull(thumbnails.channel_id);
  const usage = await db
    .select({
      archetype_id: thumbnails.archetype_id,
      last_used: sql<string>`max(${thumbnails.created_at})`.as("last_used"),
    })
    .from(thumbnails)
    .where(and(scopeFilter, inArray(thumbnails.archetype_id, candidateIds)))
    .groupBy(thumbnails.archetype_id);
  const lastUsedById = new Map<string, string>();
  for (const u of usage) {
    if (u.archetype_id) lastUsedById.set(u.archetype_id, u.last_used);
  }
  // never-used archetypes sort first (undefined last_used), then oldest, then
  // the deterministic ring order so equal timestamps never tie-break randomly.
  return [...candidates].sort((a, b) => {
    const la = lastUsedById.get(a.id);
    const lb = lastUsedById.get(b.id);
    if (la && lb && la !== lb) return la < lb ? -1 : 1;
    if (!la && lb) return -1;
    if (la && !lb) return 1;
    return archetypeRingOrder(a, b);
  });
}

// ── Library / history ─────────────────────────────────────────────────────

export interface ThumbnailLibraryFilter {
  /** "all" | "global" (channel_id IS NULL) | a channel uuid. */
  scope?: "all" | "global" | (string & {});
  archetypeId?: string;
  /** Only rows with a rendered file — what the reference picker needs. */
  completedOnly?: boolean;
  pinnedOnly?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Newest-first listing of generated thumbnails. Backs both the Studio history
 * view and the "reuse an existing thumbnail as a reference" picker.
 */
export async function listThumbnailLibrary(
  db: DrizzleClient,
  filter: ThumbnailLibraryFilter = {},
): Promise<Thumbnail[]> {
  const filters = [];
  if (filter.scope === "global") {
    filters.push(isNull(thumbnails.channel_id));
  } else if (filter.scope && filter.scope !== "all") {
    filters.push(eq(thumbnails.channel_id, filter.scope));
  }
  if (filter.archetypeId) {
    filters.push(eq(thumbnails.archetype_id, filter.archetypeId));
  }
  if (filter.completedOnly) {
    filters.push(eq(thumbnails.status, "completed"));
    filters.push(isNotNull(thumbnails.output_path));
  }
  if (filter.pinnedOnly) filters.push(eq(thumbnails.is_pinned, true));

  const base = db.select().from(thumbnails);
  const scoped = filters.length ? base.where(and(...filters)) : base;
  return scoped
    .orderBy(desc(thumbnails.created_at))
    .limit(Math.min(filter.limit ?? 60, 200))
    .offset(filter.offset ?? 0);
}

export async function countThumbnailLibrary(
  db: DrizzleClient,
  filter: Pick<ThumbnailLibraryFilter, "scope" | "completedOnly"> = {},
): Promise<number> {
  const filters = [];
  if (filter.scope === "global") {
    filters.push(isNull(thumbnails.channel_id));
  } else if (filter.scope && filter.scope !== "all") {
    filters.push(eq(thumbnails.channel_id, filter.scope));
  }
  if (filter.completedOnly) {
    filters.push(eq(thumbnails.status, "completed"));
    filters.push(isNotNull(thumbnails.output_path));
  }
  const base = db.select({ n: sql<number>`count(*)::int` }).from(thumbnails);
  const rows = await (filters.length ? base.where(and(...filters)) : base);
  return rows[0]?.n ?? 0;
}

/** Pin/unpin a thumbnail so it stays in the reusable reference library. */
export async function setThumbnailPinned(
  db: DrizzleClient,
  id: string,
  pinned: boolean,
): Promise<Thumbnail> {
  return updateThumbnailRecord(db, id, { is_pinned: pinned });
}

export async function deleteThumbnailRecord(
  db: DrizzleClient,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(thumbnails)
    .where(eq(thumbnails.id, id))
    .returning({ id: thumbnails.id });
  return rows.length > 0;
}

// ── Format rules (per-format design doctrine, §3.2.4) ──────────────────────

export async function getThumbnailFormatRule(
  db: DrizzleClient,
  format: string,
): Promise<ThumbnailFormatRule | undefined> {
  const [row] = await db
    .select()
    .from(thumbnailFormatRules)
    .where(eq(thumbnailFormatRules.format, format))
    .limit(1);
  return row;
}

export async function listThumbnailFormatRules(
  db: DrizzleClient,
): Promise<ThumbnailFormatRule[]> {
  return db
    .select()
    .from(thumbnailFormatRules)
    .orderBy(thumbnailFormatRules.format);
}

/** Idempotent on `format` — insert or update every field. */
export async function upsertThumbnailFormatRule(
  db: DrizzleClient,
  data: NewThumbnailFormatRule,
): Promise<ThumbnailFormatRule> {
  const [row] = await db
    .insert(thumbnailFormatRules)
    .values(data)
    .onConflictDoUpdate({
      target: thumbnailFormatRules.format,
      set: { ...data, updated_at: new Date() },
    })
    .returning();
  if (!row) throw new Error("Failed to upsert thumbnail format rule");
  return row;
}

// ── Auto-pilot policies (§3.2.8, §3.2.9, §2.6) ─────────────────────────────

/**
 * Resolve the effective policy for a (format, channel): the channel-specific
 * row if one exists, else the format default (channel_id IS NULL), else
 * undefined (caller applies code defaults). Never throws.
 */
export async function resolveAutopilotPolicy(
  db: DrizzleClient,
  format: string,
  channelId: string | null,
): Promise<ThumbnailAutopilotPolicy | undefined> {
  if (channelId) {
    const [specific] = await db
      .select()
      .from(thumbnailAutopilotPolicies)
      .where(
        and(
          eq(thumbnailAutopilotPolicies.format, format),
          eq(thumbnailAutopilotPolicies.channel_id, channelId),
        ),
      )
      .limit(1);
    if (specific) return specific;
  }
  const [dflt] = await db
    .select()
    .from(thumbnailAutopilotPolicies)
    .where(
      and(
        eq(thumbnailAutopilotPolicies.format, format),
        isNull(thumbnailAutopilotPolicies.channel_id),
      ),
    )
    .limit(1);
  return dflt;
}

export async function listAutopilotPolicies(
  db: DrizzleClient,
): Promise<ThumbnailAutopilotPolicy[]> {
  return db
    .select()
    .from(thumbnailAutopilotPolicies)
    .orderBy(thumbnailAutopilotPolicies.format);
}

/**
 * Upsert a policy keyed by (format, channel_id). Drizzle onConflict cannot key
 * on the two partial unique indexes, so we look up + update or insert manually.
 */
export async function upsertAutopilotPolicy(
  db: DrizzleClient,
  data: NewThumbnailAutopilotPolicy,
): Promise<ThumbnailAutopilotPolicy> {
  const channelFilter = data.channel_id
    ? eq(thumbnailAutopilotPolicies.channel_id, data.channel_id)
    : isNull(thumbnailAutopilotPolicies.channel_id);
  const [existing] = await db
    .select({ id: thumbnailAutopilotPolicies.id })
    .from(thumbnailAutopilotPolicies)
    .where(
      and(eq(thumbnailAutopilotPolicies.format, data.format), channelFilter),
    )
    .limit(1);
  if (existing) {
    const [row] = await db
      .update(thumbnailAutopilotPolicies)
      .set({ ...data, updated_at: new Date() })
      .where(eq(thumbnailAutopilotPolicies.id, existing.id))
      .returning();
    if (!row) throw new Error("Failed to update autopilot policy");
    return row;
  }
  const [row] = await db
    .insert(thumbnailAutopilotPolicies)
    .values(data)
    .returning();
  if (!row) throw new Error("Failed to insert autopilot policy");
  return row;
}

// ── Selection (§3.2.8) — is_selected written ONCE, by the rule, never as a
//    side effect of a generation completing (fixes the "last-to-finish ships"
//    bug, plan A2.12). ─────────────────────────────────────────────────────

/**
 * Choose the winning variant for a subject and set is_selected on it, clearing
 * every sibling. `rule`:
 *   qa_best_score  — highest review_score, ties broken by earliest completion
 *   first_completed — earliest completed row
 * Only completed rows with an output_path are eligible. Returns the selected
 * row, or undefined when nothing is eligible (the job proceeds without a
 * thumbnail; the caller must surface that loudly, never a placeholder).
 */
export async function selectBestThumbnailForSubject(
  db: DrizzleClient,
  subjectKind: "content_job" | "tutorial_job" | "studio" | "test",
  subjectId: string,
  rule: "qa_best_score" | "first_completed" = "qa_best_score",
  language?: string,
): Promise<Thumbnail | undefined> {
  const languageFilter = language
    ? normalizedThumbnailLanguageFilter(language)
    : undefined;
  const rows = await db
    .select()
    .from(thumbnails)
    .where(
      and(
        eq(thumbnails.subject_kind, subjectKind),
        eq(thumbnails.subject_id, subjectId),
        eq(thumbnails.status, "completed"),
        isNotNull(thumbnails.output_path),
        languageFilter,
      ),
    );
  if (rows.length === 0) return undefined;

  const byCompletion = (a: Thumbnail, b: Thumbnail) =>
    a.created_at.getTime() - b.created_at.getTime();

  const winner =
    rule === "qa_best_score"
      ? [...rows].sort(
          (a, b) =>
            (b.review_score ?? -1) - (a.review_score ?? -1) ||
            byCompletion(a, b),
        )[0]!
      : [...rows].sort(byCompletion)[0]!;

  await db
    .update(thumbnails)
    .set({ is_selected: false })
    .where(
      and(
        eq(thumbnails.subject_kind, subjectKind),
        eq(thumbnails.subject_id, subjectId),
        languageFilter,
      ),
    );
  return updateThumbnailRecord(db, winner.id, { is_selected: true });
}
