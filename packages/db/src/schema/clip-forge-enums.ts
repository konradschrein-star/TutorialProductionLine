import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Clip Forge — 9:16 short-form clipping engine enums.
 *
 * Mirrors `02_SPEC.md §1.1`. Every clip on every account is tracked
 * through these state machines; the DB is the source of truth.
 */

export const clipForgePlatformEnum = pgEnum("clip_forge_platform", [
  "tiktok",
  "instagram",
  "youtube_shorts",
]);

export const clipForgeSourceStatusEnum = pgEnum("clip_forge_source_status", [
  "ingested",
  "transcribed",
  "extracted",
  "duplicate",
  "failed",
]);

export const clipForgeRawClipStatusEnum = pgEnum("clip_forge_raw_clip_status", [
  "detected",
  "rendering",
  "ready",
  "rejected",
  "cancelled",
]);

export const clipForgeCategoryEnum = pgEnum("clip_forge_category", [
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

export const clipForgeDistributionStatusEnum = pgEnum(
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

export const clipForgeQcResultEnum = pgEnum("clip_forge_qc_result", [
  "pass",
  "flag",
  "fail",
]);

export const clipForgeErrorClassEnum = pgEnum("clip_forge_error_class", [
  "transient",
  "resource",
  "data",
  "platform",
  "logic",
]);

export const clipForgeSourceKindEnum = pgEnum("clip_forge_source_kind", [
  "youtube_vod",
  "twitch_vod",
  "podcast_rss",
  "manual_upload",
  "other",
]);

export const clipForgePayoutModelEnum = pgEnum("clip_forge_payout_model", [
  "per_view",
  "per_clip",
  "flat",
]);
