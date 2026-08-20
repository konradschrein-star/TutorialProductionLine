import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  smallint,
  bigint,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  real,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  clipIngestStatusEnum,
  clipReviewStatusEnum,
  clipAudioClassEnum,
  clipShotScaleEnum,
  clipLabelingStepEnum,
  clipStorageStrategyEnum,
  clipTypeEnum,
  sourceKindEnum,
  storageBackendEnum,
} from "./clip-library-enums.js";

// ── clip_libraries ─────────────────────────────────────────────────────────
export const clipLibraries = pgTable("clip_libraries", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  description: text("description"),
  // { characters: string[], moods: string[], locations: string[], actions: string[] }
  // Values here are the ONLY valid tags in HITL review — strictly enforced
  tag_vocabulary: jsonb("tag_vocabulary")
    .$type<Record<string, string[]>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  // LM Studio connection + daemon settings for local VLM labeling pipeline
  vlm_labeling_config: jsonb("vlm_labeling_config")
    .$type<{
      enabled: boolean;
      lm_studio_url: string;
      lm_studio_token: string;
      lm_studio_model: string;
      concurrency: number;
      vps_host: string;
      vps_user: string;
      ssh_key_path: string;
      vps_media_root: string;
    }>()
    .notNull().default(sql`'{
      "enabled": false,
      "lm_studio_url": "",
      "lm_studio_token": "",
      "lm_studio_model": "",
      "concurrency": 1,
      "vps_host": "65.108.6.149",
      "vps_user": "root",
      "ssh_key_path": "~/.ssh/content-forge-key",
      "vps_media_root": "/opt/content-forge/media"
    }'::jsonb`),
  // inline: OffthreadVideo seeks into source; materialized: separate per-clip object
  clip_storage_strategy: clipStorageStrategyEnum("clip_storage_strategy")
    .notNull()
    .default("materialized"),
  clip_count: integer("clip_count").notNull().default(0),
  total_duration_ms: integer("total_duration_ms").notNull().default(0),
  is_active: boolean("is_active").notNull().default(true),
  // ── Drama stock-chain template settings ────────────────────────────
  // Added 2026-06-03. These columns are NULL/default for non-drama
  // libraries; the long-form-drama UI is the only consumer.
  // character_block: free-form description of who shows up in this
  // library's clips. Drives both the clip-generation prompts and
  // (optionally) the script-writer's narrative voice.
  character_block: text("character_block").notNull().default(""),
  // script_prompt: full system prompt for the LLM script writer when
  // auto-script is on. Per-library so different channels can ship
  // different story styles without code changes.
  script_prompt: text("script_prompt").notNull().default(""),
  // music_mode: 'generate' (fresh per video via the music API) |
  //             'library' (pick + stitch existing tracks).
  music_mode: varchar("music_mode", { length: 16 })
    .notNull()
    .default("generate"),
  // music_volume_db: target loudness of the music bed.
  music_volume_db: integer("music_volume_db").notNull().default(-28),
  // use_reference_scripts: when true, script-gen pulls one
  // clip_library_reference_scripts row per job (LRU rotation) and
  // hands it to the LLM as a stylistic guide. Off ⇒ system prompt
  // + topic only.
  use_reference_scripts: boolean("use_reference_scripts")
    .notNull()
    .default(true),
  // ── Global library: storage hook + per-library label cap ─────────────
  // Where re-encoded MP4 + MP3 sidecar physically live. 'local' = VPS
  // filesystem; 'nas'/'s3' reserved for later (resolveStoragePath will
  // throw NotImplementedError until wired).
  storage_backend: storageBackendEnum("storage_backend")
    .notNull()
    .default("local"),
  // Interpreted per backend. NULL falls back to env LOCAL_MEDIA_ROOT.
  storage_root: text("storage_root"),
  // In-process semaphore cap consumed by clip-label. Lets a fragile
  // library throttle without changing worker config.
  labeling_concurrency: smallint("labeling_concurrency").notNull().default(4),
  // Reserved for CLIP visual-embedding sidecar (separate PR). OFF by default;
  // turn on for Vidrush-style libraries where vibe matters most.
  use_visual_embedding: boolean("use_visual_embedding")
    .notNull()
    .default(false),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ── source_videos ──────────────────────────────────────────────────────────
export const sourceVideos = pgTable(
  "source_videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    library_id: uuid("library_id")
      .notNull()
      .references(() => clipLibraries.id, { onDelete: "restrict" }),
    ingest_status: clipIngestStatusEnum("ingest_status")
      .notNull()
      .default("pending"),
    source_url: text("source_url"),
    source_file_path: text("source_file_path"),
    // SHA-256 of raw video bytes — deduplication gate; duplicate hash = skip re-ingest
    content_hash: varchar("content_hash", { length: 64 }),
    storage_key: text("storage_key"),
    cdn_url: text("cdn_url"),
    title: varchar("title", { length: 500 }),
    duration_ms: integer("duration_ms"),
    width: smallint("width"),
    height: smallint("height"),
    fps: real("fps"),
    codec: varchar("codec", { length: 30 }),
    clip_count: integer("clip_count").notNull().default(0),
    error_message: text("error_message"),
    ingest_started_at: timestamp("ingest_started_at", { withTimezone: true }),
    ingest_completed_at: timestamp("ingest_completed_at", {
      withTimezone: true,
    }),
    // ── Structured source identity (added 2026-06-05) ─────────────────
    source_kind: sourceKindEnum("source_kind").notNull().default("other"),
    // kebab-case stable id: 'star-wars-episode-iv', 'the-clone-wars',
    // 'harry-potter-and-the-sorcerers-stone'.
    work_slug: varchar("work_slug", { length: 120 }),
    work_title: varchar("work_title", { length: 300 }),
    // Multi-part movie disc (LotR EE 1/2/3); NULL for single-file movies.
    work_part: smallint("work_part"),
    season: smallint("season"),
    episode: smallint("episode"),
    youtube_id: varchar("youtube_id", { length: 20 }),
    external_provider: varchar("external_provider", { length: 40 }),
    external_id: varchar("external_id", { length: 200 }),
    // Prefix that all clips inherit — composed in app code from source_kind.
    ref_base: varchar("ref_base", { length: 200 }),
    // Sidecar MP3 produced during re-encode.
    audio_storage_key: text("audio_storage_key"),
    // 64-bit dHash of source midpoint. Catches "same movie re-encoded".
    // mode: "bigint" so XOR/popcount preserves all 64 bits in JS BigInt.
    phash: bigint("phash", { mode: "bigint" }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    libraryIdx: index("source_videos_library_id_idx").on(t.library_id),
    statusIdx: index("source_videos_ingest_status_idx").on(t.ingest_status),
    contentHashIdx: uniqueIndex("source_videos_content_hash_idx").on(
      t.content_hash,
    ),
    libraryRefBaseIdx: uniqueIndex("source_videos_library_ref_base_idx").on(
      t.library_id,
      t.ref_base,
    ),
    sourceKindIdx: index("source_videos_source_kind_idx").on(t.source_kind),
    youtubeIdIdx: index("source_videos_youtube_id_idx").on(t.youtube_id),
  }),
);

// ── clips ──────────────────────────────────────────────────────────────────
// One row per detected scene cut. Timing is ms, inclusive-start / exclusive-end.
// Vector column `embedding halfvec(1024)` added via raw SQL migration (Drizzle does not support halfvec).
export const clips = pgTable(
  "clips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    library_id: uuid("library_id")
      .notNull()
      .references(() => clipLibraries.id, { onDelete: "restrict" }),
    source_video_id: uuid("source_video_id")
      .notNull()
      .references(() => sourceVideos.id, { onDelete: "cascade" }),
    start_ms: integer("start_ms").notNull(),
    end_ms: integer("end_ms").notNull(),
    // Adjacent scene navigation — enables Lego-block stitching and UI prev/next
    prev_clip_id: uuid("prev_clip_id"),
    next_clip_id: uuid("next_clip_id"),
    // Narrative function within the scene (action/dialogue/establishing/reaction/montage/…)
    // Distinct from clip_type which tracks source material (live_action/animation/etc.)
    narrative_type: varchar("narrative_type", { length: 30 }),
    // Populated only when clip_storage_strategy = 'materialized'
    storage_key: text("storage_key"),
    cdn_url: text("cdn_url"),
    thumbnail_url: text("thumbnail_url"),
    // Idempotent label retry state — resume without repeating completed steps
    labeling_step: clipLabelingStepEnum("labeling_step"),
    review_status: clipReviewStatusEnum("review_status")
      .notNull()
      .default("pending"),
    reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
    reviewed_by: uuid("reviewed_by"),
    ai_description: text("ai_description"),
    ai_confidence: real("ai_confidence"),
    shot_scale: clipShotScaleEnum("shot_scale"),
    clip_type: clipTypeEnum("clip_type").default("unknown"),
    dominant_mood: varchar("dominant_mood", { length: 60 }),
    audio_class: clipAudioClassEnum("audio_class"),
    // All tag values MUST be present in clip_libraries.tag_vocabulary[group]
    tags_characters: text("tags_characters")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    tags_mood: text("tags_mood")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    tags_location: text("tags_location")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    tags_action: text("tags_action")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    tags_custom: text("tags_custom")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    characters_present: text("characters_present")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    transcript: text("transcript"),
    // TranscriptSchema JSON: { language, words: [{word, start, end, score}], speaker_segments? }
    transcript_json: jsonb("transcript_json"),
    width: smallint("width"),
    height: smallint("height"),
    fps: real("fps"),
    // ── Visual analysis (AI-populated) ───────────────────────────────────────
    // static | slow | medium | fast | chaotic
    motion_level: varchar("motion_level", { length: 20 }),
    // static | pan | tilt | zoom | dolly | handheld | crane
    camera_movement: varchar("camera_movement", { length: 30 }),
    // bright | dark | moody | high_key | low_key | silhouette
    lighting_style: varchar("lighting_style", { length: 30 }),
    // warm | cool | neutral | high_contrast | desaturated
    color_temperature: varchar("color_temperature", { length: 30 }),
    // Number of human faces detected (0 = no faces)
    face_count: smallint("face_count"),
    // True when hardcoded subtitles or title-card text is burned into the frame
    has_text_overlay: boolean("has_text_overlay"),
    // True when intelligible speech is present (derived from Whisper transcript)
    dialogue_present: boolean("dialogue_present"),
    // Source episode / film identifier — e.g. "Episode IV", "The Clone Wars S3E12"
    source_episode: varchar("source_episode", { length: 120 }),
    // Broader scene context — world-state, story arc, who is fighting / speaking
    scene_context: text("scene_context"),
    // Free-form keywords for search (in addition to tag arrays)
    keywords: text("keywords")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // ── Human review fields ──────────────────────────────────────────────────
    // 1 (unusable) – 5 (perfect)
    quality_score: smallint("quality_score"),
    // Reviewer free-form notes (reason for flag, editing instructions, etc.)
    manual_notes: text("manual_notes"),
    // Quick "ready for production use" flag set during review
    is_usable: boolean("is_usable"),
    times_used: integer("times_used").notNull().default(0),
    last_used_at: timestamp("last_used_at", { withTimezone: true }),
    // ── Global library: ordinal + external_ref + dedup + aesthetic ─────
    // 0-based ordinal within source_video_id, ascending by start_ms.
    clip_index: integer("clip_index").notNull().default(0),
    // ref_base || '/' || lpad(clip_index, 4, '0'). Human-readable, prompt-safe.
    external_ref: varchar("external_ref", { length: 240 }),
    // Set by clip-embed when cosine distance < 0.01 to an older sibling.
    duplicate_of_id: uuid("duplicate_of_id"),
    // 64-bit dHash of midpoint keyframe. SQL XOR + popcount = Hamming distance.
    phash: bigint("phash", { mode: "bigint" }),
    // 0.0 (static) to 1.0 (chaotic). Hard-filter target for selection.
    motion_score: real("motion_score"),
    // Top-3 dominant colors from midpoint frame, e.g. ['#1a2b3c','#cdefab',…].
    palette_dominant_hex: text("palette_dominant_hex").array(),
    // halfvec(512) — CLIP-L visual embedding. Added via raw SQL migration
    // (Drizzle has no halfvec type). Worker that populates this ships separately.
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    libraryIdx: index("clips_library_id_idx").on(t.library_id),
    sourceVideoIdx: index("clips_source_video_id_idx").on(t.source_video_id),
    reviewStatusIdx: index("clips_review_status_idx").on(t.review_status),
    labelingStepIdx: index("clips_labeling_step_idx").on(t.labeling_step),
    prevClipIdx: index("clips_prev_clip_id_idx").on(t.prev_clip_id),
    nextClipIdx: index("clips_next_clip_id_idx").on(t.next_clip_id),
    narrativeTypeIdx: index("clips_narrative_type_idx").on(t.narrative_type),
    libraryExternalRefIdx: uniqueIndex("clips_library_external_ref_idx").on(
      t.library_id,
      t.external_ref,
    ),
    phashIdx: index("clips_phash_idx").on(t.phash),
    duplicateOfIdx: index("clips_duplicate_of_idx").on(t.duplicate_of_id),
    sourceVideoClipIndexIdx: index("clips_source_video_clip_index_idx").on(
      t.source_video_id,
      t.clip_index,
    ),
    // GIN indexes added via raw SQL migration (Drizzle .using() not yet supported)
    // CREATE INDEX clips_tags_characters_gin ON clips USING gin (tags_characters);
    // CREATE INDEX clips_tags_mood_gin ON clips USING gin (tags_mood);
    // CREATE INDEX clips_tags_location_gin ON clips USING gin (tags_location);
    // CREATE INDEX clips_tags_action_gin ON clips USING gin (tags_action);
    // CREATE INDEX clips_characters_present_gin ON clips USING gin (characters_present);
  }),
);

// ── character_registry ─────────────────────────────────────────────────────
// Known characters per library with ArcFace embedding centroids for recognition.
// Column `face_centroid halfvec(512)` added via raw SQL migration.
export const characterRegistry = pgTable(
  "character_registry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    library_id: uuid("library_id")
      .notNull()
      .references(() => clipLibraries.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    aliases: text("aliases")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // face_centroid: halfvec(512) — running mean of last 100 identified embeddings
    reference_clip_ids: uuid("reference_clip_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    face_sample_count: integer("face_sample_count").notNull().default(0),
    // Faces with cosine similarity below this threshold become 'unknown_face_N'
    confidence_threshold: real("confidence_threshold").notNull().default(0.65),
    clip_count: integer("clip_count").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    libraryNameIdx: uniqueIndex("character_registry_library_name_idx").on(
      t.library_id,
      t.name,
    ),
  }),
);

// ── clip_label_history ─────────────────────────────────────────────────────
// Append-only audit log of every label change. Never overwritten.
export const clipLabelHistory = pgTable(
  "clip_label_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clip_id: uuid("clip_id")
      .notNull()
      .references(() => clips.id, { onDelete: "cascade" }),
    // 'ai' for automated labeling, user UUID for human edits
    changed_by: varchar("changed_by", { length: 60 }).notNull(),
    changed_at: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    before: jsonb("before").notNull(),
    after: jsonb("after").notNull(),
    change_reason: text("change_reason"),
  },
  (t) => ({
    clipIdx: index("clip_label_history_clip_id_idx").on(t.clip_id),
  }),
);
