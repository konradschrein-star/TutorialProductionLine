/**
 * Database Repositories
 *
 * Centralized data access layer for all database operations.
 * All application code should use these repositories instead of direct Drizzle calls.
 *
 * Usage:
 * ```ts
 * import { createJob, getJobById, updateJobStatus } from '@repo/db/repositories';
 * import { withTransaction } from '@repo/db/repositories';
 *
 * // Simple operation
 * const job = await getJobById('123');
 *
 * // Transactional operation
 * await withTransaction(async (tx) => {
 *   const job = await createJob(jobData, tx);
 *   await createSystemEvent(eventData, tx);
 * });
 * ```
 */

// Transaction utilities
export { withTransaction, isTransaction, getDbOrTx } from "./transaction.js";
export type { Transaction } from "./transaction.js";

// Job repository
export {
  createJob,
  getJobById,
  getJobsByIds,
  getJobsByStatus,
  getJobsByChannel,
  updateJob,
  updateJobStatus,
  updateJobAssetManifest,
  deleteJob,
  getJobCount,
  getStaleRenderJobs,
  assignProductionVA,
  assignUploaderVA,
} from "./job-repository.js";
export type { NewJob, Job, JobUpdate } from "./job-repository.js";

// Template repository
export {
  getTemplateById,
  getTemplateByName,
  getTemplatesByFormat,
  getActiveTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  setTemplateActive,
} from "./template-repository.js";
export type {
  NewTemplate,
  Template,
  TemplateUpdate,
} from "./template-repository.js";

// System event repository
export {
  createSystemEvent,
  getSystemEventById,
  getEventsByJobId,
  getEventsByType,
  getRecentEvents,
  getEventsSince,
  createJobStatusEvent,
  createJobErrorEvent,
} from "./system-event-repository.js";
export type { NewSystemEvent, SystemEvent } from "./system-event-repository.js";

// Asset repository
export {
  getAssetById,
  getAssetsByIds,
  getAssetsByType,
  getAssetsByChannel,
  getAssetsByArchetype,
  getUniversalAssets,
  searchAssetsByTags,
  createAsset,
  updateAsset,
  deleteAsset,
  updateAssetGenerationRecipe,
  getAssetCount,
} from "./asset-repository.js";
export type {
  NewAssetRepo,
  AssetRepo,
  AssetUpdate,
} from "./asset-repository.js";

// TTS Voice repository
export {
  listTTSVoices,
  getDefaultVoice,
  getTTSVoiceByDatabaseId,
  getTTSVoiceById,
  createTTSVoice,
  updateTTSVoice,
  deleteTTSVoice,
  setDefaultVoice,
} from "./tts-voice-repository.js";

// Music repository
export {
  getMusicPresetById,
  verifyMusicFileExists,
} from "./music-repository.js";

// Clip search repository
export { searchClips } from "./clip-search.js";
export type { ClipSearchParams, ClipSearchResult } from "./clip-search.js";

// Drama clips repository
export {
  insertDramaClips,
  getDramaClipsByJob,
  updateDramaClipPrompt,
  updateDramaClipImagePath,
  markDramaClipImageFailed,
  markDramaClipVeoSubmitted,
  updateDramaClipVideoPath,
  markDramaClipVideoFailed,
  updateDramaClipCharacterIds,
} from "./drama-clips.js";
export type {
  NewDramaClip,
  DramaClip,
  DramaClipUpdate,
  DramaClipSpec,
} from "./drama-clips.js";

// Clip libraries (drama stock-chain template, per-channel)
export {
  listClipLibraries,
  getClipLibraryById,
  createClipLibrary,
  updateClipLibrary,
} from "./clip-libraries.js";
export type {
  ClipLibrary,
  NewClipLibrary,
  ClipLibraryWithCounts,
} from "./clip-libraries.js";

// Reference scripts per clip library
export {
  listReferenceScripts,
  getReferenceScriptById,
  createReferenceScript,
  updateReferenceScript,
  deleteReferenceScript,
  pickNextReferenceScript,
} from "./clip-library-reference-scripts.js";
export type { ReferenceScript } from "./clip-library-reference-scripts.js";

// Stock clip library (drama stock-chain template)
export {
  reserveStockClip,
  markStockClipGenerating,
  markStockClipReady,
  markStockClipFailed,
  insertReadyStockClip,
  countReadyStockClips,
  pickStockClipChain,
  recordStockClipChainUse,
  takeQueuedStockClips,
  storeClipEmbedding,
  loadReadyEmbeddings,
} from "./stock-clips.js";
export type {
  NewStockClip,
  StockClip,
  StockClipWithEmbedding,
} from "./stock-clips.js";

// Drama characters repository
export {
  getDramaCharactersByIds,
  getDefaultCharactersForChannel,
  getAllPresetCharacters,
  updateCharacterThumbnailUrl,
  setCharacterThumbnailUrl,
  findPresetCharacterByName,
  createDramaCharacter,
} from "./drama-characters.js";
export type {
  DramaCharacter,
  ChannelDramaCharacter,
} from "./drama-characters.js";

// Thumbnail repository
export {
  createThumbnailArchetype,
  updateThumbnailArchetype,
  deleteThumbnailArchetype,
  listThumbnailArchetypes,
  getThumbnailArchetypeById,
  setChannelArchetypes,
  setChannelPrimaryArchetype,
  getChannelPrimaryArchetype,
  getChannelArchetypesForFormat,
  resolveChannelCuration,
  resolveArchetypeCandidates,
  getChannelPersona,
  upsertChannelPersona,
  getChannelThumbnailProfile,
  getTutorialChannelProfile,
  upsertChannelThumbnailProfile,
  createThumbnailRecord,
  updateThumbnailRecord,
  deleteThumbnailRecord,
  getThumbnailById,
  listThumbnailsForSubject,
  listThumbnailLibrary,
  countThumbnailLibrary,
  setThumbnailPinned,
  selectThumbnail,
  selectBestThumbnailForSubject,
  pickLeastRecentlyUsedArchetype,
  orderArchetypesByLeastRecentlyUsed,
  getThumbnailFormatRule,
  listThumbnailFormatRules,
  upsertThumbnailFormatRule,
  resolveAutopilotPolicy,
  listAutopilotPolicies,
  upsertAutopilotPolicy,
} from "./thumbnail-repository.js";
export type {
  TutorialDifficulty,
  ArchetypeCandidateResolution,
  ChannelCurationState,
} from "./thumbnail-repository.js";
export type { ThumbnailLibraryFilter } from "./thumbnail-repository.js";

// Character Library — the single source of truth for a channel's on-camera host
// (migration 0061). `channel_personas` is now a read-only view over this data.
export {
  resolveChannelHost,
  listCharacterImages,
  listCharactersForChannel,
  listCharacterLibrary,
  getCharacterWithImages,
  createCharacter,
  updateCharacter,
  addCharacterImage,
  setCharacterImageActive,
  deleteCharacterImage,
  setCharacterChannels,
} from "./character-library-repository.js";
export type {
  ChannelHost,
  CharacterWithImages,
} from "./character-library-repository.js";
