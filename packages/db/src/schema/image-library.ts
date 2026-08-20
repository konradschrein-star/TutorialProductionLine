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
import { clipLibraries } from "./clip-library.js";
import {
  clipIngestStatusEnum,
  clipReviewStatusEnum,
  clipShotScaleEnum,
  clipLabelingStepEnum,
  clipTypeEnum,
  sourceKindEnum,
} from "./clip-library-enums.js";

// ── source_images ─────────────────────────────────────────────────────────
// Mirrors source_videos but for stills. No fps/codec/duration — images are
// atemporal. Reuses source_kind / ingest_status enums. ref_base composed
// from the structured identity fields by the same buildRefBase helper that
// runs for videos.
export const sourceImages = pgTable(
  "source_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    library_id: uuid("library_id")
      .notNull()
      .references(() => clipLibraries.id, { onDelete: "restrict" }),
    ingest_status: clipIngestStatusEnum("ingest_status")
      .notNull()
      .default("pending"),
    // Identity
    source_kind: sourceKindEnum("source_kind").notNull().default("other"),
    source_url: text("source_url"),
    source_file_path: text("source_file_path"),
    work_slug: varchar("work_slug", { length: 120 }),
    work_title: varchar("work_title", { length: 300 }),
    external_provider: varchar("external_provider", { length: 40 }),
    external_id: varchar("external_id", { length: 200 }),
    ref_base: varchar("ref_base", { length: 200 }),
    // Storage
    content_hash: varchar("content_hash", { length: 64 }),
    storage_key: text("storage_key"),
    cdn_url: text("cdn_url"),
    width: smallint("width"),
    height: smallint("height"),
    format: varchar("format", { length: 20 }),
    bytes: integer("bytes"),
    // Aesthetic signals
    phash: bigint("phash", { mode: "bigint" }),
    palette_dominant_hex: text("palette_dominant_hex").array(),
    // Attribution
    license: jsonb("license"),
    attribution: jsonb("attribution"),
    // State + audit
    error_message: text("error_message"),
    ingest_started_at: timestamp("ingest_started_at", { withTimezone: true }),
    ingest_completed_at: timestamp("ingest_completed_at", {
      withTimezone: true,
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    libraryIdx: index("source_images_library_id_idx").on(t.library_id),
    statusIdx: index("source_images_ingest_status_idx").on(t.ingest_status),
    contentHashIdx: uniqueIndex("source_images_content_hash_idx").on(
      t.content_hash,
    ),
    libraryRefBaseIdx: uniqueIndex("source_images_library_ref_base_idx").on(
      t.library_id,
      t.ref_base,
    ),
    sourceKindIdx: index("source_images_source_kind_idx").on(t.source_kind),
    phashIdx: index("source_images_phash_idx").on(t.phash),
  }),
);

// ── images ────────────────────────────────────────────────────────────────
// 1:1 with source_images. Mirrors clips' label + embedding columns but
// drops temporal fields (start_ms/end_ms/prev/next/motion/transcript).
// embedding halfvec(384) + embedding_sparse jsonb + embedding_visual
// halfvec(512) added via raw SQL migration.
export const images = pgTable(
  "images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    library_id: uuid("library_id")
      .notNull()
      .references(() => clipLibraries.id, { onDelete: "restrict" }),
    source_image_id: uuid("source_image_id")
      .notNull()
      .references(() => sourceImages.id, { onDelete: "cascade" }),
    external_ref: varchar("external_ref", { length: 240 }),
    // Labeling state — reused enum; whisper/audio values unused for images.
    labeling_step: clipLabelingStepEnum("labeling_step"),
    review_status: clipReviewStatusEnum("review_status")
      .notNull()
      .default("pending"),
    reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
    reviewed_by: uuid("reviewed_by"),
    // AI labels
    ai_description: text("ai_description"),
    ai_confidence: real("ai_confidence"),
    shot_scale: clipShotScaleEnum("shot_scale"),
    clip_type: clipTypeEnum("clip_type").default("unknown"),
    dominant_mood: varchar("dominant_mood", { length: 60 }),
    lighting_style: varchar("lighting_style", { length: 30 }),
    color_temperature: varchar("color_temperature", { length: 30 }),
    face_count: smallint("face_count"),
    has_text_overlay: boolean("has_text_overlay"),
    source_episode: varchar("source_episode", { length: 120 }),
    scene_context: text("scene_context"),
    // Tags (shared vocabulary with clips)
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
    keywords: text("keywords")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Human review
    quality_score: smallint("quality_score"),
    manual_notes: text("manual_notes"),
    is_usable: boolean("is_usable"),
    // Dedup
    duplicate_of_id: uuid("duplicate_of_id"),
    // Usage tracking
    times_used: integer("times_used").notNull().default(0),
    last_used_at: timestamp("last_used_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    libraryIdx: index("images_library_id_idx").on(t.library_id),
    sourceIdx: index("images_source_image_id_idx").on(t.source_image_id),
    reviewStatusIdx: index("images_review_status_idx").on(t.review_status),
    labelingStepIdx: index("images_labeling_step_idx").on(t.labeling_step),
    libraryExternalRefIdx: uniqueIndex("images_library_external_ref_idx").on(
      t.library_id,
      t.external_ref,
    ),
    duplicateOfIdx: index("images_duplicate_of_idx").on(t.duplicate_of_id),
  }),
);
