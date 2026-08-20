import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  real,
  integer,
  bigint,
  boolean,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Clip Forge schema.
 *
 * Reconstructed 2026-06-17 from the live production database (the original
 * Drizzle definitions were developed but never committed). Column types,
 * nullability, defaults and enum values mirror the existing `cf_*` tables
 * exactly, so this is a description of the live schema — NOT a migration.
 * Do not `drizzle-kit push` these against prod expecting changes.
 */

// ── Enums ────────────────────────────────────────────────────────────────
export const clipForgeSourceKind = pgEnum("clip_forge_source_kind", [
  "youtube_vod",
  "twitch_vod",
  "podcast_rss",
  "manual_upload",
  "other",
]);
export const clipForgeSourceStatus = pgEnum("clip_forge_source_status", [
  "ingested",
  "transcribed",
  "extracted",
  "duplicate",
  "failed",
]);
export const clipForgeRawClipStatus = pgEnum("clip_forge_raw_clip_status", [
  "detected",
  "rendering",
  "ready",
  "rejected",
  "cancelled",
]);
export const clipForgeCategory = pgEnum("clip_forge_category", [
  "wisdom",
  "funny",
  "controversial",
  "story",
  "educational",
  "hot_take",
  "hype",
  "insight",
  "reaction",
  "rant",
  "wholesome",
  "other",
]);
export const clipForgePlatform = pgEnum("clip_forge_platform", [
  "tiktok",
  "instagram",
  "youtube_shorts",
]);
export const clipForgeDistributionStatus = pgEnum(
  "clip_forge_distribution_status",
  [
    "pooled",
    "assigned",
    "rendered",
    "qc_pass",
    "qc_flag",
    "qc_fail",
    "queued",
    "uploaded",
    "live",
    "failed",
    "skipped",
    "cancelled",
  ],
);
export const clipForgeQcResult = pgEnum("clip_forge_qc_result", [
  "pass",
  "flag",
  "fail",
]);
export const clipForgeErrorClass = pgEnum("clip_forge_error_class", [
  "transient",
  "resource",
  "data",
  "platform",
  "logic",
]);
export const clipForgePayoutModel = pgEnum("clip_forge_payout_model", [
  "per_view",
  "per_clip",
  "flat",
]);

// ── Tables ───────────────────────────────────────────────────────────────
export const cfPersonas = pgTable("cf_personas", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name").notNull(),
  rights_confirmed: boolean("rights_confirmed").notNull().default(false),
  payout_model: clipForgePayoutModel("payout_model")
    .notNull()
    .default("per_view"),
  payout_rate: real("payout_rate").notNull().default(0),
  default_style_tokens: jsonb("default_style_tokens")
    .notNull()
    .default(sql`'{}'::jsonb`),
  face_detection_hints: jsonb("face_detection_hints")
    .notNull()
    .default(sql`'{}'::jsonb`),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  default_language: varchar("default_language").notNull().default("en"),
});

export const cfSources = pgTable("cf_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  persona_id: uuid("persona_id").notNull(),
  external_id: varchar("external_id").notNull(),
  source_kind: clipForgeSourceKind("source_kind").notNull(),
  source_url: text("source_url").notNull(),
  title: text("title").notNull(),
  duration_sec: real("duration_sec").notNull().default(0),
  resolution: varchar("resolution"),
  codec: varchar("codec"),
  fps: real("fps"),
  size_bytes: bigint("size_bytes", { mode: "number" }),
  transcript_key: text("transcript_key"),
  word_timings: jsonb("word_timings").default(sql`'[]'::jsonb`),
  audio_fingerprint: varchar("audio_fingerprint"),
  duplicate_of: uuid("duplicate_of"),
  status: clipForgeSourceStatus("status").notNull().default("ingested"),
  raw_video_deleted: boolean("raw_video_deleted").notNull().default(false),
  facecam_layout: jsonb("facecam_layout"),
  portrait_crops: jsonb("portrait_crops"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  language: varchar("language").notNull().default("en"),
  // Streaming phase / progress for the source-detail UI. Worker overwrites
  // during ingest + clip-detection; cleared (set NULL) when the pipeline
  // reaches a terminal state. See migration 0024 for shape.
  progress: jsonb("progress"),
  // V2 full-frame detection (YOLO11n + YuNet, all persons + faces). Drives
  // decideLayout() in the variant generator. See migration 0025.
  detection: jsonb("detection"),
});

export const cfRawClips = pgTable("cf_raw_clips", {
  id: uuid("id").primaryKey().defaultRandom(),
  source_id: uuid("source_id").notNull(),
  persona_id: uuid("persona_id").notNull(),
  start_sec: real("start_sec").notNull(),
  end_sec: real("end_sec").notNull(),
  clip_score: real("clip_score").notNull(),
  score_reason: text("score_reason").notNull().default(""),
  categories: jsonb("categories")
    .notNull()
    .default(sql`'[]'::jsonb`),
  suggested_caption: text("suggested_caption"),
  reframe_recipe: jsonb("reframe_recipe")
    .notNull()
    .default(sql`'{}'::jsonb`),
  raw_mp4_key: text("raw_mp4_key"),
  status: clipForgeRawClipStatus("status").notNull().default("detected"),
  cancel_requested: boolean("cancel_requested").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cfAccounts = pgTable("cf_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  persona_id: uuid("persona_id").notNull(),
  platform: clipForgePlatform("platform").notNull(),
  handle: varchar("handle").notNull(),
  variant_seed: integer("variant_seed").notNull(),
  posts_per_day: integer("posts_per_day").notNull().default(1),
  jitter_hours_override: integer("jitter_hours_override"),
  daily_slots: integer("daily_slots").notNull().default(3),
  niche: clipForgeCategory("niche"),
  category_mix: jsonb("category_mix")
    .notNull()
    .default(sql`'{}'::jsonb`),
  active: boolean("active").notNull().default(true),
  proxy_endpoint: text("proxy_endpoint"),
  browser_profile_id: varchar("browser_profile_id"),
  caption_preset_id: uuid("caption_preset_id"),
  flagged_at: timestamp("flagged_at", { withTimezone: true }),
  last_activity_at: timestamp("last_activity_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cfCaptionPool = pgTable("cf_caption_pool", {
  id: uuid("id").primaryKey().defaultRandom(),
  persona_id: uuid("persona_id").notNull(),
  text: text("text").notNull(),
  category: clipForgeCategory("category"),
  uses: integer("uses").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cfCaptionPresets = pgTable("cf_caption_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name").notNull(),
  text_color: varchar("text_color").notNull().default("#ffffff"),
  highlight_color: varchar("highlight_color").notNull().default("#57a578"),
  all_caps: boolean("all_caps").notNull().default(true),
  outline: boolean("outline").notNull().default(true),
  font_size: integer("font_size").notNull().default(38),
  position_pct: integer("position_pct").notNull().default(74),
  animation: varchar("animation").notNull().default("word-pop"),
  emoji_set: varchar("emoji_set").notNull().default("minimal"),
  assigned_personas: jsonb("assigned_personas")
    .notNull()
    .default(sql`'[]'::jsonb`),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cfConfig = pgTable("cf_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  persona_id: uuid("persona_id"),
  settings: jsonb("settings")
    .notNull()
    .default(sql`'{}'::jsonb`),
  edited_by: varchar("edited_by"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cfDistributions = pgTable("cf_distributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  raw_clip_id: uuid("raw_clip_id").notNull(),
  variant_id: uuid("variant_id"),
  account_id: uuid("account_id").notNull(),
  platform: clipForgePlatform("platform").notNull(),
  status: clipForgeDistributionStatus("status").notNull().default("pooled"),
  qc_result: clipForgeQcResult("qc_result"),
  qc_report: jsonb("qc_report"),
  scheduled_for: timestamp("scheduled_for", { withTimezone: true }),
  uploaded_at: timestamp("uploaded_at", { withTimezone: true }),
  post_url: text("post_url"),
  view_count: integer("view_count").notNull().default(0),
  view_history: jsonb("view_history")
    .notNull()
    .default(sql`'[]'::jsonb`),
  last_error: text("last_error"),
  error_class: clipForgeErrorClass("error_class"),
  retry_count: integer("retry_count").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cfFinishingVariants = pgTable("cf_finishing_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  raw_clip_id: uuid("raw_clip_id").notNull(),
  platform: clipForgePlatform("platform").notNull(),
  caption_text: text("caption_text"),
  subtitle_style: jsonb("subtitle_style")
    .notNull()
    .default(sql`'{}'::jsonb`),
  duration_delta_sec: real("duration_delta_sec").notNull().default(0),
  variant_seed: integer("variant_seed").notNull(),
  layout_preset: varchar("layout_preset", { length: 32 }),
  subtitle_style_id: varchar("subtitle_style_id", { length: 64 }),
  caption_style_id: varchar("caption_style_id", { length: 64 }),
  layout_options: jsonb("layout_options")
    .notNull()
    .default(sql`'{}'::jsonb`),
  rendered_mp4_key: text("rendered_mp4_key"),
  rendered_hash: varchar("rendered_hash"),
  expires_at: timestamp("expires_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cfJobFailures = pgTable("cf_job_failures", {
  id: uuid("id").primaryKey().defaultRandom(),
  job_id: varchar("job_id").notNull(),
  queue: varchar("queue").notNull(),
  error_class: clipForgeErrorClass("error_class")
    .notNull()
    .default("transient"),
  correlation_id: varchar("correlation_id"),
  payload: jsonb("payload")
    .notNull()
    .default(sql`'{}'::jsonb`),
  last_error: text("last_error"),
  stacktrace: text("stacktrace"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cfStylePresets = pgTable("cf_style_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 128 }).notNull(),
  persona_id: uuid("persona_id"),
  // Optional reference to a hardcoded registry preset. If subtitle_style /
  // caption_style is set, the inline value wins.
  subtitle_style_id: varchar("subtitle_style_id", { length: 64 }),
  caption_style_id: varchar("caption_style_id", { length: 64 }),
  // Inline CaptionStyle overrides. Free-form because the schema is owned by
  // packages/contracts and Drizzle doesn't want to track that here.
  subtitle_style: jsonb("subtitle_style"),
  caption_style: jsonb("caption_style"),
  layout_options: jsonb("layout_options")
    .notNull()
    .default(sql`'{}'::jsonb`),
  // Per-layoutKind position overrides:
  //   { "fullscreen-single": { subtitle_y, caption_y }, ... }
  safe_zones: jsonb("safe_zones")
    .notNull()
    .default(sql`'{}'::jsonb`),
  phrase_length_ms: integer("phrase_length_ms"),
  caption_y: integer("caption_y"),
  subtitle_y: integer("subtitle_y"),
  caption_size: integer("caption_size"),
  subtitle_size: integer("subtitle_size"),
  notes: text("notes"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export type CfStylePreset = typeof cfStylePresets.$inferSelect;
export type NewCfStylePreset = typeof cfStylePresets.$inferInsert;

export type CfPersona = typeof cfPersonas.$inferSelect;
export type CfSource = typeof cfSources.$inferSelect;
export type NewCfSource = typeof cfSources.$inferInsert;
export type CfRawClip = typeof cfRawClips.$inferSelect;
export type NewCfRawClip = typeof cfRawClips.$inferInsert;
export type CfAccount = typeof cfAccounts.$inferSelect;
export type CfDistribution = typeof cfDistributions.$inferSelect;
