import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  boolean,
  real,
  timestamp,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

/**
 * Where a track came from. Closed set — mirrored by the
 * `music_library_source_check` constraint in migration 0039.
 *
 * Deliberately distinguishes generated-by-us from uploaded-by-a-human, because
 * the credits/attribution export downstream must never guess.
 */
export const MUSIC_SOURCES = [
  "suno_ai33",
  "minimax_ai33",
  "upload",
  "seed",
  "unknown",
] as const;
export type MusicSource = (typeof MUSIC_SOURCES)[number];

export const MUSIC_SELECTION_MODES = [
  "random",
  "sequential",
  "longest_first",
] as const;
export type MusicSelectionMode = (typeof MUSIC_SELECTION_MODES)[number];

/**
 * Music Library — the single global pool of background music and soundtracks.
 *
 * Every content format draws from this table, either directly (genre/format
 * filter) or via a `music_collections` assignment. Tracks arrive two ways:
 * uploaded (copyright-free music) or generated on demand (Suno via AI33).
 */
export const musicLibrary = pgTable(
  "music_library",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 200 }).notNull(),
    file_path: text("file_path").notNull(),
    duration_seconds: integer("duration_seconds").notNull(),
    genre: varchar("genre", { length: 100 }),
    // Which content format produced this track. Lets us filter the
    // music library to per-format buckets (LONG_FORM_DRAMA, etc.)
    // so each format only reuses music that matches its vibe.
    format: varchar("format", { length: 50 }),

    // --- Provenance & attribution (0039) ------------------------------------
    /** Who made it. 'Suno (AI33)' for generated, an artist name for uploads. */
    creator: varchar("creator", { length: 200 }),
    /** How it entered the library. */
    source: varchar("source", { length: 32 })
      .$type<MusicSource>()
      .notNull()
      .default("unknown"),
    /** Licence the track is used under, free text (e.g. 'CC BY 4.0'). */
    license: varchar("license", { length: 120 }),
    /** Where it came from — YouTube URL, artist page, etc. */
    source_url: text("source_url"),
    /** Whether the licence obliges us to credit the artist in the video. */
    attribution_required: boolean("attribution_required")
      .notNull()
      .default(false),
    /** Explicit credit line to use verbatim, when the licence dictates one. */
    attribution_text: text("attribution_text"),

    // --- Discovery ----------------------------------------------------------
    mood: text("mood").array().notNull().default([]),
    tags: text("tags").array().notNull().default([]),
    bpm: integer("bpm"),

    // --- File facts ---------------------------------------------------------
    original_filename: varchar("original_filename", { length: 255 }),
    file_bytes: bigint("file_bytes", { mode: "number" }),

    // --- Generation provenance ---------------------------------------------
    generation_prompt: text("generation_prompt"),
    /** e.g. 'ai33:suno'. */
    generation_provider: varchar("generation_provider", { length: 50 }),
    /** Provider-side task id, so a generation can be traced back. */
    generation_task_id: varchar("generation_task_id", { length: 100 }),

    is_active: boolean("is_active").notNull().default(true),

    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    sourceIdx: index("idx_music_library_source").on(t.source),
    creatorIdx: index("idx_music_library_creator").on(t.creator),
    activeIdx: index("idx_music_library_active").on(t.is_active),
    genreIdx: index("idx_music_library_genre").on(t.genre),
  }),
);

/**
 * A named, reusable bundle of tracks ("Drama beds", "Upbeat corporate").
 * Collections are what get assigned to formats/channels — assigning a bundle
 * rather than a single track means a format gets variety for free.
 */
export const musicCollections = pgTable("music_collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull().unique(),
  description: text("description"),
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const musicCollectionTracks = pgTable(
  "music_collection_tracks",
  {
    collection_id: uuid("collection_id")
      .notNull()
      .references(() => musicCollections.id, { onDelete: "cascade" }),
    track_id: uuid("track_id")
      .notNull()
      .references(() => musicLibrary.id, { onDelete: "cascade" }),
    sort_order: integer("sort_order"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.collection_id, t.track_id] }),
    trackIdx: index("idx_music_collection_tracks_track").on(t.track_id),
  }),
);

/**
 * Binds a collection to a scope. Mirrors `subtitle_preset_assignments` on
 * purpose — same mental model, same resolution order:
 *
 *   format + channel  >  channel only  >  format only  >  global default
 *
 * NULL means "any". Uniqueness per scope is enforced by the expression index
 * `uq_music_assignments_scope` (see migration 0039) rather than a plain UNIQUE,
 * because Postgres treats NULLs as distinct and would allow duplicate globals.
 */
export const musicAssignments = pgTable(
  "music_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collection_id: uuid("collection_id")
      .notNull()
      .references(() => musicCollections.id, { onDelete: "cascade" }),
    format: varchar("format", { length: 50 }),
    channel_id: uuid("channel_id"),
    is_active: boolean("is_active").notNull().default(true),
    selection_mode: varchar("selection_mode", { length: 20 })
      .$type<MusicSelectionMode>()
      .notNull()
      .default("random"),
    /** Mix level for the bed under narration, in dB. */
    volume_db: real("volume_db").notNull().default(-18),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    collectionIdx: index("idx_music_assignments_collection").on(
      t.collection_id,
    ),
  }),
);

export const MUSIC_GENERATION_STATUSES = [
  "queued",
  "running",
  "done",
  "error",
] as const;
export type MusicGenerationStatus = (typeof MUSIC_GENERATION_STATUSES)[number];

/**
 * Machine-readable failure classes. The point is that the UI can say *why* a
 * generation died instead of leaving it looking like "still working".
 */
export const MUSIC_GENERATION_ERROR_CODES = [
  "rate_limited",
  "server_busy",
  "no_credits",
  "auth",
  "timeout",
  "no_audio",
  "download_failed",
  "probe_failed",
  "unknown",
] as const;
export type MusicGenerationErrorCode =
  (typeof MUSIC_GENERATION_ERROR_CODES)[number];

/**
 * Durable record of an on-demand generation (Suno via AI33).
 *
 * Suno takes minutes, so the request cannot be synchronous — which means the
 * outcome must be persisted somewhere queryable. Without this, a 429 or an
 * exhausted quota is indistinguishable from "still running".
 */
export const musicGenerations = pgTable(
  "music_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: varchar("provider", { length: 50 })
      .notNull()
      .default("ai33:suno"),
    provider_task_id: varchar("provider_task_id", { length: 100 }),
    prompt: text("prompt").notNull(),
    title: varchar("title", { length: 200 }),
    instrumental: boolean("instrumental").notNull().default(true),
    genre: varchar("genre", { length: 100 }),
    format: varchar("format", { length: 50 }),
    status: varchar("status", { length: 20 })
      .$type<MusicGenerationStatus>()
      .notNull()
      .default("queued"),
    error_code: varchar("error_code", {
      length: 50,
    }).$type<MusicGenerationErrorCode>(),
    error_message: text("error_message"),
    /** Suno returns TWO clips per task; both are ingested. */
    track_ids: uuid("track_ids").array().notNull().default([]),
    credit_cost: integer("credit_cost"),
    requested_by: uuid("requested_by"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    completed_at: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index("idx_music_generations_status").on(t.status),
  }),
);

export type MusicTrackRow = typeof musicLibrary.$inferSelect;
export type NewMusicTrackRow = typeof musicLibrary.$inferInsert;
export type MusicCollection = typeof musicCollections.$inferSelect;
export type NewMusicCollection = typeof musicCollections.$inferInsert;
export type MusicCollectionTrack = typeof musicCollectionTracks.$inferSelect;
export type MusicAssignment = typeof musicAssignments.$inferSelect;
export type NewMusicAssignment = typeof musicAssignments.$inferInsert;
export type MusicGeneration = typeof musicGenerations.$inferSelect;
export type NewMusicGeneration = typeof musicGenerations.$inferInsert;
