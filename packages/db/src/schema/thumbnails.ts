import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  numeric,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { channels } from "./channels.js";
import {
  thumbnailSubjectKindEnum,
  thumbnailStatusEnum,
  thumbnailPromptModeEnum,
  thumbnailGenerationKindEnum,
  thumbnailReviewVerdictEnum,
} from "./thumbnail-enums.js";

/** Default aspect ratio for every archetype/generation unless overridden. */
export const DEFAULT_THUMBNAIL_ASPECT = "16:9";
/** Default output resolution. 1K is what the operator ships in practice. */
export const DEFAULT_THUMBNAIL_RESOLUTION = "1k";

/**
 * Thumbnail Archetypes — reusable reference-thumbnail "styles".
 * The reference image is attached to the model as an i2i reference; the model
 * copies its style/layout while replacing topic/text/character/logo.
 *
 * `channel_id` is NULLABLE and NULL means GLOBAL — usable by every channel.
 * This is the default: archetypes are a shared visual library, not channel
 * property. `channel_thumbnail_archetypes` still exists and means "this
 * channel curated this archetype", which narrows the auto-pick pool.
 *
 * `formats` is a text[] of content-format values (validated in the app layer,
 * NOT a pg enum — this keeps new formats migration-free). An EMPTY array means
 * "no format restriction", i.e. usable everywhere.
 */
export const thumbnailArchetypes = pgTable(
  "thumbnail_archetypes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    /** NULL = global archetype. */
    channel_id: uuid("channel_id").references(() => channels.id, {
      onDelete: "set null",
    }),
    description: text("description"),
    reference_image_path: text("reference_image_path").notNull(),
    /** Additional i2i references beyond the primary one. */
    extra_reference_paths: text("extra_reference_paths")
      .array()
      .notNull()
      .default([]),
    layout_instructions: text("layout_instructions"),
    base_prompt: text("base_prompt"),
    features_logo: boolean("features_logo").notNull().default(false),
    category: varchar("category", { length: 80 }).notNull().default("General"),
    formats: text("formats").array().notNull().default([]),
    /**
     * Curation vocabulary — how an operator FINDS the right reference.
     * Validated in the app layer, not a pg enum, so it grows migration-free
     * (same reasoning as `formats`). Four facets, see migration 0062:
     *   intent     search-intent | curiosity-gap
     *   bucket     full-guide, mobile-tutorial, criticism, rating-apps,
     *              comparison, feature-highlight, listicle, news, humor,
     *              beginner, integration
     *   structure  has-face, face-placeholder, no-person, screen-inset,
     *              phone-inset, flat-background, dark-background, logo,
     *              series-badge, arrow, template
     *   status     weak, garbled-text, person-specific, duplicate, junk
     * Backed by a GIN index created in 0062 (declared in SQL only — a plain
     * index() here would claim a btree that does not exist).
     */
    tags: text("tags").array().notNull().default([]),
    aspect_ratio: varchar("aspect_ratio", { length: 16 })
      .notNull()
      .default(DEFAULT_THUMBNAIL_ASPECT),
    resolution: varchar("resolution", { length: 16 })
      .notNull()
      .default(DEFAULT_THUMBNAIL_RESOLUTION),
    /** Import provenance + idempotency, e.g. "thumbnail-tool:<cuid>". */
    source_key: varchar("source_key", { length: 200 }),
    sort_order: integer("sort_order").notNull().default(0),
    is_active: boolean("is_active").notNull().default(true),
    /** Built-ins that must be cloned, not edited (subtitle-preset-lock idiom). */
    is_locked: boolean("is_locked").notNull().default(false),
    /** imported | manual | bookmark | promoted — backs D2's Unassigned filter. */
    origin: varchar("origin", { length: 24 }).notNull().default("manual"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    activeIdx: index("idx_thumbnail_archetypes_active").on(t.is_active),
    channelIdx: index("idx_thumbnail_archetypes_channel").on(t.channel_id),
    sourceKeyIdx: uniqueIndex("idx_thumbnail_archetypes_source_key").on(
      t.source_key,
    ),
  }),
);

/**
 * The tiers a channel↔archetype link can belong to (migration 0068).
 *
 * `base` is the everyday cycle. `advanced` / `beginner` are DIFFICULTY-SCOPED
 * ADDITIONS to it, not replacements — see `resolveArchetypeCandidates`.
 * Validated in the app layer rather than by a pg enum, for the same reason
 * `formats` and `tags` are text[]: a new tier must not need a migration.
 */
export const CHANNEL_ARCHETYPE_TIERS = [
  "base",
  "advanced",
  "beginner",
] as const;
export type ChannelArchetypeTier = (typeof CHANNEL_ARCHETYPE_TIERS)[number];
export const DEFAULT_CHANNEL_ARCHETYPE_TIER: ChannelArchetypeTier = "base";

export function isChannelArchetypeTier(v: string): v is ChannelArchetypeTier {
  return (CHANNEL_ARCHETYPE_TIERS as readonly string[]).includes(v);
}

/**
 * Many-to-many: which archetypes a channel CYCLES THROUGH.
 *
 * This is the table that expresses "this channel uses these five templates,
 * in rotation". `thumbnail_archetypes.channel_id` cannot: it is one nullable
 * column, so it can only ever say "owned by exactly one channel".
 *
 * Shape deliberately mirrors `character_channels` (migration 0061), which
 * solved the same problem for the channel's HOST — a link table with a
 * discriminator plus an `is_primary` flag guarded by a partial unique index.
 *
 * The UNIQUE (channel_id, archetype_id) means one archetype has exactly ONE
 * tier per channel. Intentional: an archetype that is simultaneously in the
 * base cycle and the advanced set is a configuration nobody can reason about.
 */
export const channelThumbnailArchetypes = pgTable(
  "channel_thumbnail_archetypes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channel_id: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    archetype_id: uuid("archetype_id")
      .notNull()
      .references(() => thumbnailArchetypes.id, { onDelete: "cascade" }),
    /** base | advanced | beginner — see CHANNEL_ARCHETYPE_TIERS. */
    tier: varchar("tier", { length: 24 })
      .notNull()
      .default(DEFAULT_CHANNEL_ARCHETYPE_TIER),
    /**
     * The channel's default/"main" template. At most one per channel — enforced
     * by the partial unique index `idx_channel_thumbnail_archetypes_primary`
     * declared in migration 0068 (SQL only; a plain uniqueIndex() here would
     * claim a total index that does not exist).
     */
    is_primary: boolean("is_primary").notNull().default(false),
    /** Stable ring order for cycling, so the operator controls the rotation. */
    sort_order: integer("sort_order").notNull().default(0),
    /**
     * Relative selection frequency inside the channel's ring (migration 0070).
     * 1 = baseline; a weight of 3 occupies three slots and so comes up three
     * times as often.
     *
     * This widens the archetype's slice of the DETERMINISTIC hash space — it
     * does not introduce randomness, so a regenerate still reproduces the same
     * archetype rather than re-rolling. The owner grades his curated set
     * ("give the tutorial #1 Best Archetype a higher RNG so that we use it more
     * often"); unweighted entries stay in the ring at 1 rather than being
     * dropped, because "use this more" is not "delete the rest".
     */
    weight: integer("weight").notNull().default(1),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueLink: uniqueIndex("idx_channel_thumbnail_archetypes_unique").on(
      t.channel_id,
      t.archetype_id,
    ),
    channelIdx: index("idx_channel_thumbnail_archetypes_channel").on(
      t.channel_id,
    ),
    archetypeIdx: index("idx_channel_thumbnail_archetypes_archetype").on(
      t.archetype_id,
    ),
    tierIdx: index("idx_channel_thumbnail_archetypes_tier").on(
      t.channel_id,
      t.tier,
      t.sort_order,
    ),
  }),
);

/**
 * Channel Personas — READ-ONLY COMPAT VIEW as of migration 0061.
 *
 * This used to be a table holding a channel's host as ONE `image_path`, which
 * (a) made thumbnail cycling impossible and (b) was a second, silently
 * divergable copy of the character library. It is now a VIEW projected out of
 * `characters` + `character_channels` + `character_images`:
 *
 *   name/description -> the channel's primary host character
 *   image_path       -> that character's FIRST image (preview only)
 *
 * SELECTs keep working exactly as before. INSERT/UPDATE now FAIL at the
 * database — deliberately. Write to the character library instead
 * (`characterRepository` in @repo/db, or the Character Library UI).
 *
 * It is declared as a pgTable because Drizzle reads views through the same
 * builder; only the SELECT side of this object is meaningful.
 */
export const channelPersonas = pgTable("channel_personas", {
  channel_id: uuid("channel_id")
    .primaryKey()
    .references(() => channels.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description").notNull(),
  image_path: text("image_path"),
  notes: text("notes"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Per-channel thumbnail branding (1:1 with channels). Persona lives in
 * channel_personas, NOT here.
 */
export const channelThumbnailProfiles = pgTable("channel_thumbnail_profiles", {
  channel_id: uuid("channel_id")
    .primaryKey()
    .references(() => channels.id, { onDelete: "cascade" }),
  logo_image_path: text("logo_image_path"),
  primary_color: varchar("primary_color", { length: 16 }),
  secondary_color: varchar("secondary_color", { length: 16 }),
  default_prompt_mode: thumbnailPromptModeEnum("default_prompt_mode")
    .notNull()
    .default("programmatic"),
  extra_prompt_notes: text("extra_prompt_notes"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** One row per generated thumbnail image (gallery + regeneration history). */
export const thumbnails = pgTable(
  "thumbnails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subject_kind: thumbnailSubjectKindEnum("subject_kind").notNull(),
    subject_id: uuid("subject_id").notNull(),
    /** NULL for ad-hoc Studio renders that belong to no channel. */
    channel_id: uuid("channel_id").references(() => channels.id, {
      onDelete: "cascade",
    }),
    archetype_id: uuid("archetype_id").references(
      () => thumbnailArchetypes.id,
      { onDelete: "set null" },
    ),
    // Free-form language names/codes from the localize flow (e.g. "Portuguese
    // (Brazil)"), not just ISO codes — must hold the longer strings.
    language: varchar("language", { length: 64 }).notNull().default("en"),
    prompt_mode: thumbnailPromptModeEnum("prompt_mode").notNull(),
    prompt_used: text("prompt_used").notNull(),
    reference_paths: jsonb("reference_paths")
      .$type<{
        archetype?: string;
        persona?: string;
        logo?: string;
        base?: string;
      }>()
      .notNull()
      .default({}),
    /** Reference images supplied for THIS generation, on top of the archetype's. */
    extra_reference_paths: text("extra_reference_paths")
      .array()
      .notNull()
      .default([]),
    aspect_ratio: varchar("aspect_ratio", { length: 16 })
      .notNull()
      .default(DEFAULT_THUMBNAIL_ASPECT),
    resolution: varchar("resolution", { length: 16 })
      .notNull()
      .default(DEFAULT_THUMBNAIL_RESOLUTION),
    /** Operator-facing inputs, kept so a generation can be replayed. */
    title: varchar("title", { length: 300 }),
    headline_text: varchar("headline_text", { length: 300 }),
    topic: text("topic"),
    /** Iteration lineage — "regenerate this one with a tweak". */
    parent_thumbnail_id: uuid("parent_thumbnail_id"),
    /**
     * How this row was produced. Distinguishes Iterate (reference = parent
     * output) from Regenerate (reference = original archetype) — the DECISIONS
     * §3.2.5 semantics the old single code path could not express.
     */
    generation_kind: thumbnailGenerationKindEnum("generation_kind")
      .notNull()
      .default("original"),
    /** Groups the variants of one submission so the UI can render "2 of 3". */
    request_group_id: uuid("request_group_id"),
    /** Set when this generation was seeded from a bookmarked reference (FK in SQL). */
    from_bookmark_id: uuid("from_bookmark_id"),
    variant_index: integer("variant_index").notNull().default(0),
    /** The compiled ThumbnailBrief — makes iteration history explainable. */
    brief: jsonb("brief").$type<Record<string, unknown>>(),
    rules_version: varchar("rules_version", { length: 32 }),
    /** operator | derived | title_fallback | none — a title_fallback is visible. */
    headline_source: varchar("headline_source", { length: 24 }),
    output_path: text("output_path"),
    /** What the caller ASKED for. */
    requested_backend: varchar("requested_backend", { length: 32 }),
    /** What actually served it. A mismatch is a visible downgrade, never silent. */
    provider_used: varchar("provider_used", { length: 32 }),
    /** The real routing chain reported by the gateway (position 0 = wanted). */
    backend_chain: text("backend_chain").array().notNull().default([]),
    /** True when a fallback provider served this — surfaced as an amber badge. */
    fallback_used: boolean("fallback_used").notNull().default(false),
    /** Optional QA gate (§3.2.9, default OFF). */
    review_score: integer("review_score"),
    review_verdict: thumbnailReviewVerdictEnum("review_verdict")
      .notNull()
      .default("not_reviewed"),
    review_notes: text("review_notes"),
    reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
    status: thumbnailStatusEnum("status").notNull().default("pending"),
    error_message: text("error_message"),
    is_selected: boolean("is_selected").notNull().default(false),
    /** Kept in the reusable reference library. */
    is_pinned: boolean("is_pinned").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    subjectIdx: index("idx_thumbnails_subject").on(
      t.subject_kind,
      t.subject_id,
    ),
    channelArchetypeIdx: index("idx_thumbnails_channel_archetype").on(
      t.channel_id,
      t.archetype_id,
      t.created_at,
    ),
    createdAtIdx: index("idx_thumbnails_created_at").on(t.created_at),
    parentIdx: index("idx_thumbnails_parent").on(t.parent_thumbnail_id),
    requestGroupIdx: index("idx_thumbnails_request_group").on(
      t.request_group_id,
    ),
    subjectSelectedIdx: index("idx_thumbnails_subject_selected").on(
      t.subject_kind,
      t.subject_id,
      t.is_selected,
    ),
  }),
);

/**
 * Per-format thumbnail design doctrine (DECISIONS §3.2.4) — the quality lever.
 * One row per FORMAT STRING (varchar, not the content_format enum, so new
 * formats need no migration). Seeded from the research in the plan §A5;
 * `evidence_note` records WHY a directive exists so it can be overruled.
 */
export const thumbnailFormatRules = pgTable("thumbnail_format_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  format: varchar("format", { length: 64 }).notNull().unique(),
  display_name: varchar("display_name", { length: 120 }).notNull(),
  is_active: boolean("is_active").notNull().default(true),
  layout_archetype: varchar("layout_archetype", { length: 48 }),
  composition: text("composition").array().notNull().default([]),
  subject_scale_min: numeric("subject_scale_min", { precision: 4, scale: 3 }),
  subject_scale_max: numeric("subject_scale_max", { precision: 4, scale: 3 }),
  /** 0 IS LEGAL and correct for VS / tier / before-after (§A5.2). */
  text_max_words: integer("text_max_words").notNull().default(5),
  /** true = generate text-free, composite type after (§A5.2, B7). */
  composite_text: boolean("composite_text").notNull().default(false),
  text_policy: text("text_policy"),
  subject_policy: text("subject_policy"),
  palette_policy: text("palette_policy"),
  /** NEVER 'shocked' (§A5.1). */
  emotion_register: varchar("emotion_register", { length: 80 })
    .notNull()
    .default("authentic"),
  gaze_policy: varchar("gaze_policy", { length: 24 })
    .notNull()
    .default("direct"),
  signature_element: text("signature_element"),
  negatives: text("negatives").array().notNull().default([]),
  authoring_notes: text("authoring_notes"),
  example_good_paths: text("example_good_paths").array().notNull().default([]),
  example_bad_paths: text("example_bad_paths").array().notNull().default([]),
  default_archetype_id: uuid("default_archetype_id").references(
    () => thumbnailArchetypes.id,
    { onDelete: "set null" },
  ),
  rules_version: varchar("rules_version", { length: 32 })
    .notNull()
    .default("v1"),
  evidence_note: text("evidence_note"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Per-(format, channel) automation policy (DECISIONS §3.2.8, §3.2.9, §2.6).
 * channel_id NULL = the format default. Partial unique indexes (in SQL) enforce
 * one default row per format and one row per (format, channel).
 */
export const thumbnailAutopilotPolicies = pgTable(
  "thumbnail_autopilot_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    format: varchar("format", { length: 64 }).notNull(),
    channel_id: uuid("channel_id").references(() => channels.id, {
      onDelete: "cascade",
    }),
    enabled: boolean("enabled").notNull().default(true),
    /** 3 = YouTube Test & Compare cap (§A5.4). */
    variant_count: integer("variant_count").notNull().default(3),
    qa_enabled: boolean("qa_enabled").notNull().default(false),
    qa_min_score: integer("qa_min_score").notNull().default(60),
    qa_max_retries: integer("qa_max_retries").notNull().default(1),
    /** qa_best_score | first_completed. */
    selection_rule: varchar("selection_rule", { length: 32 })
      .notNull()
      .default("qa_best_score"),
    /** allow | warn | fail (§2.6). */
    on_fallback: varchar("on_fallback", { length: 16 })
      .notNull()
      .default("warn"),
    prompt_mode: thumbnailPromptModeEnum("prompt_mode")
      .notNull()
      .default("programmatic"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    formatIdx: index("idx_thumbnail_autopilot_format").on(t.format),
  }),
);

/**
 * Deterministic overlay edit document (§3.2.7, plan B7). Rendered by
 * Sharp/node-canvas into a derived generation_kind='edit' row. Reserved —
 * not wired into the automatic pipeline yet.
 */
export const thumbnailEdits = pgTable(
  "thumbnail_edits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    thumbnail_id: uuid("thumbnail_id")
      .notNull()
      .references(() => thumbnails.id, { onDelete: "cascade" }),
    doc: jsonb("doc").$type<Record<string, unknown>>().notNull(),
    output_path: text("output_path"),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    created_by: varchar("created_by", { length: 120 }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    thumbnailIdx: index("idx_thumbnail_edits_thumbnail").on(t.thumbnail_id),
  }),
);

/**
 * Outlier thumbnails captured from YouTube (§3.2.10, plan B9) — the front half
 * of the 1of10 research->reference->generate loop. Reserved for phase 4.
 */
export const thumbnailBookmarks = pgTable(
  "thumbnail_bookmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source_url: text("source_url").notNull(),
    video_id: varchar("video_id", { length: 32 }),
    channel_name: varchar("channel_name", { length: 200 }),
    title: text("title"),
    image_path: text("image_path").notNull(),
    notes: text("notes"),
    tags: text("tags").array().notNull().default([]),
    captured_by: varchar("captured_by", { length: 120 }),
    captured_at: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    videoIdx: index("idx_thumbnail_bookmarks_video").on(t.video_id),
  }),
);

export type ThumbnailArchetype = typeof thumbnailArchetypes.$inferSelect;
export type NewThumbnailArchetype = typeof thumbnailArchetypes.$inferInsert;
export type ChannelThumbnailArchetype =
  typeof channelThumbnailArchetypes.$inferSelect;
export type NewChannelThumbnailArchetype =
  typeof channelThumbnailArchetypes.$inferInsert;
export type ChannelPersona = typeof channelPersonas.$inferSelect;
export type NewChannelPersona = typeof channelPersonas.$inferInsert;
export type ChannelThumbnailProfile =
  typeof channelThumbnailProfiles.$inferSelect;
export type NewChannelThumbnailProfile =
  typeof channelThumbnailProfiles.$inferInsert;
export type Thumbnail = typeof thumbnails.$inferSelect;
export type NewThumbnail = typeof thumbnails.$inferInsert;
export type ThumbnailFormatRule = typeof thumbnailFormatRules.$inferSelect;
export type NewThumbnailFormatRule = typeof thumbnailFormatRules.$inferInsert;
export type ThumbnailAutopilotPolicy =
  typeof thumbnailAutopilotPolicies.$inferSelect;
export type NewThumbnailAutopilotPolicy =
  typeof thumbnailAutopilotPolicies.$inferInsert;
export type ThumbnailEdit = typeof thumbnailEdits.$inferSelect;
export type NewThumbnailEdit = typeof thumbnailEdits.$inferInsert;
export type ThumbnailBookmark = typeof thumbnailBookmarks.$inferSelect;
export type NewThumbnailBookmark = typeof thumbnailBookmarks.$inferInsert;
