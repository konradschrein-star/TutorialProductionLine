/**
 * @repo/db - Database Layer
 *
 * Public exports for the database package.
 * Provides Drizzle schema definitions, client factory, and types.
 */

export * from "./schema/index.js";
export { createDrizzleClient } from "./client.js";
export type { DrizzleClient } from "./client.js";
export { tutorialSourceRevision } from "./tutorial-source-revision.js";

// Re-export commonly used drizzle-orm utilities
export {
  eq,
  and,
  or,
  sql,
  asc,
  desc,
  ne,
  isNull,
  isNotNull,
  inArray,
} from "drizzle-orm";

// Re-export repositories for convenience
export { createSystemEvent } from "./repositories/system-event-repository.js";
export { searchClips } from "./repositories/clip-search.js";
export type {
  ClipSearchParams,
  ClipSearchResult,
} from "./repositories/clip-search.js";
export {
  chainContinuous,
  chainThematic,
  chainForShot,
} from "./repositories/clip-chain.js";
export type { ChainClipRow, ChainResult } from "./repositories/clip-chain.js";
export { searchImages } from "./repositories/image-search.js";
export type {
  ImageSearchParams,
  ImageSearchResult,
} from "./repositories/image-search.js";
export { searchMedia } from "./repositories/media-search.js";
export type {
  MediaKind,
  MediaSearchParams,
  MediaSearchResult,
} from "./repositories/media-search.js";
// Per-channel narration voice (channels.voice_id → tts_voices), migration 0060.
export {
  getChannelVoice,
  type ChannelVoice,
} from "./repositories/channel-voice-repository.js";
// TTS voice registry (per-language native voices for localized audio).
export {
  listTTSVoices,
  getDefaultVoice,
  getVoiceForLanguage,
  getTTSVoiceByDatabaseId,
  getTTSVoiceById,
  createTTSVoice,
  updateTTSVoice,
  deleteTTSVoice,
  setDefaultVoice,
} from "./repositories/tts-voice-repository.js";
// Tutorial Production Engine repositories
export * from "./repositories/tutorial-job-repository.js";
export * from "./repositories/tutorial-prompt-repository.js";
export * from "./repositories/tutorial-settings-repository.js";
// The ONE secrets area accessor (Decision D3) + canonical crypto.
export * from "./repositories/secrets-accessor.js";
export {
  encryptSecret,
  decryptSecret,
  last4,
  type SecretBox,
} from "./crypto/secret-box.js";

// Thumbnail repository (hub-web-facing)
export {
  createThumbnailArchetype,
  updateThumbnailArchetype,
  listThumbnailArchetypes,
  getThumbnailArchetypeById,
  setChannelArchetypes,
  getChannelArchetypesForFormat,
  getChannelPersona,
  upsertChannelPersona,
  getChannelThumbnailProfile,
  getTutorialChannelProfile,
  upsertChannelThumbnailProfile,
  createThumbnailRecord,
  updateThumbnailRecord,
  getThumbnailById,
  listThumbnailsForSubject,
  selectThumbnail,
} from "./repositories/thumbnail-repository.js";
export type {
  ThumbnailArchetype,
  NewThumbnailArchetype,
  ChannelPersona,
  NewChannelPersona,
  ChannelThumbnailProfile,
  NewChannelThumbnailProfile,
  Thumbnail,
  NewThumbnail,
} from "./schema/thumbnails.js";

// Subtitle system v2 config schemas + defaults
export {
  RemotionConfigSchema,
  FfmpegConfigSchema,
  defaultRemotionConfig,
  defaultFfmpegConfig,
} from "./subtitles/config-schema.js";
export type {
  RemotionSubtitleConfig,
  FFmpegSubtitleConfig,
} from "./subtitles/config-schema.js";

export const DB_PACKAGE_VERSION = "0.1.0";
export { reserveTutorialPublicationSlot } from "./reserve-tutorial-slot.js";
export { inspectTutorialProductionBatch, loadTutorialProductionBatchInput, planTutorialProductionBatch, reserveTutorialProductionBatch, tutorialProductionBatchCsv } from "./tutorial-production-batch.js";
export type { TutorialProductionBatchInput, TutorialProductionBatchPlan, TutorialBatchExclusionReason } from "./tutorial-production-batch.js";
export { prepareLegacyTutorialArchive, assertArchivePayloadSafe } from "./legacy-archive-plan.js";
export { recordApprovedEnglishThumbnailFanout, englishThumbnailApprovalRevision, resolveThumbnailFanoutTargets, THUMBNAIL_FANOUT_LANGUAGES } from "./tutorial-thumbnail-fanout.js";
export type { ApprovedEnglishThumbnail } from "./tutorial-thumbnail-fanout.js";
