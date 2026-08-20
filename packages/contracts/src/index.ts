// Boundary validation contracts
// Zod schemas, DTOs, queue payloads, API contracts
// No business logic allowed

// === Enums ===
export { JobStatus } from "./enums/job-status.js";
export type { JobStatus as JobStatusType } from "./enums/job-status.js";

export { ContentFormat } from "./enums/content-format.js";
export type { ContentFormat as ContentFormatType } from "./enums/content-format.js";

// The format-lifecycle API. These were held back until the definitions landed in
// ./enums/content-format.js (they were once pushed ahead of them and broke
// @repo/contracts#build on main). The definitions are now there — FormatLifecycle
// at line 103, FORMAT_LIFECYCLE at 105, getFormatLifecycle/isFormatActive/
// isFormatIdle at 133-143, the derived arrays at 147-155 — and hub-web's
// src/lib/format-lifecycle.ts imports them from this barrel.
export {
  FORMAT_LIFECYCLE,
  ACTIVE_FORMATS,
  IDLE_FORMATS,
  RETIRED_FORMATS,
  getFormatLifecycle,
  isFormatActive,
  isFormatIdle,
} from "./enums/content-format.js";
export type { FormatLifecycle } from "./enums/content-format.js";

export { RenderEngine } from "./enums/render-engine.js";
export type { RenderEngine as RenderEngineType } from "./enums/render-engine.js";

export { OperatorRole } from "./enums/operator-role.js";
export type { OperatorRole as OperatorRoleType } from "./enums/operator-role.js";

export { AssetType } from "./enums/asset-type.js";
export type { AssetType as AssetTypeType } from "./enums/asset-type.js";

export { ProductionVersion } from "./enums/production-version.js";
export type { ProductionVersion as ProductionVersionType } from "./enums/production-version.js";

// === Schemas ===
export { Result } from "./schemas/result.js";
export type {
  Success,
  Failure,
  Result as ResultType,
} from "./schemas/result.js";

export {
  AssetManifestEntrySchema,
  AssetManifestSchema,
} from "./schemas/asset-manifest.js";
export type {
  AssetManifestEntry,
  AssetManifest,
} from "./schemas/asset-manifest.js";

export {
  VisualTypeSchema,
  SceneSchema,
  WordTimestampSchema,
  TickerItemSchema,
  AssemblyManifestSchema,
} from "./schemas/assembly-manifest.js";
export type {
  VisualType,
  Scene,
  SceneInput,
  WordTimestamp,
  TickerItem,
  AssemblyManifest,
} from "./schemas/assembly-manifest.js";

export { ContentJobSchema } from "./schemas/content-job.js";
export type { ContentJob } from "./schemas/content-job.js";

export { ContentTemplateSchema } from "./schemas/content-template.js";
export type { ContentTemplate } from "./schemas/content-template.js";

export { SystemEventSchema } from "./schemas/system-event.js";
export type { SystemEvent } from "./schemas/system-event.js";

// === Queue Payloads ===
export { IngestPayloadSchema } from "./queue-payloads/ingest-payload.js";
export type { IngestPayload } from "./queue-payloads/ingest-payload.js";

export { AIGenerationPayloadSchema } from "./queue-payloads/ai-generation-payload.js";
export type {
  AIGenerationPayload,
  TTSPayload,
  ScriptPayload,
  SceneImagePayload,
  SentenceImagePayload,
  YouTubeMetadataPayload,
} from "./queue-payloads/ai-generation-payload.js";

export { QMSValidationPayloadSchema } from "./queue-payloads/qms-validation-payload.js";
export type { QMSValidationPayload } from "./queue-payloads/qms-validation-payload.js";

export { RenderHeavyPayloadSchema } from "./queue-payloads/render-heavy-payload.js";
export type { RenderHeavyPayload } from "./queue-payloads/render-heavy-payload.js";

export { GarbageCollectionPayloadSchema } from "./queue-payloads/garbage-collection-payload.js";
export type { GarbageCollectionPayload } from "./queue-payloads/garbage-collection-payload.js";

export { SceneAnalysisPayloadSchema } from "./queue-payloads/scene-analysis-payload.js";
export type { SceneAnalysisPayload } from "./queue-payloads/scene-analysis-payload.js";

export { ThumbnailPayloadSchema } from "./queue-payloads/thumbnail-payload.js";
export type { ThumbnailPayload } from "./queue-payloads/thumbnail-payload.js";

export {
  BundestagClipAnalysisPayloadSchema,
  BundestagPlaybookGenerationPayloadSchema,
  BundestagRenderPayloadSchema,
} from "./queue-payloads/bundestag-payloads.js";
export type {
  BundestagClipAnalysisPayload,
  BundestagPlaybookGenerationPayload,
  BundestagRenderPayload,
} from "./queue-payloads/bundestag-payloads.js";

export { VideoStitchPayloadSchema } from "./queue-payloads/video-stitch-payload.js";
export type { VideoStitchPayload } from "./queue-payloads/video-stitch-payload.js";

export * from "./queue-payloads/long-form-drama-payloads.js";
export * from "./queue-payloads/stock-library-payload.js";
export * from "./queue-payloads/reactor-payloads.js";
export * from "./queue-payloads/tech-footage-payloads.js";
export * from "./clip-forge.js";

export {
  BundestagPlaybookSegmentSchema,
  BundestagPlaybookSchema,
  formatZodValidationError,
  formatBusinessRuleValidationError,
} from "./bundestag-playbook-schema.js";
export type {
  BundestagPlaybookSegment,
  BundestagPlaybook,
  PlaybookValidationError,
} from "./bundestag-playbook-schema.js";

// === System Settings === (reworked §3.3 — only Storage + Alerts survive)
export {
  StorageSettingsSchema,
  DEFAULT_MAX_UPLOAD_BYTES,
  AlertsSettingsSchema,
  NotificationsSettingsSchema,
  SETTINGS_SECTION_IDS,
  SETTINGS_SECTIONS,
  getSchemaForSection,
} from "./schemas/system-settings.js";
export type {
  StorageSettings,
  AlertsSettings,
  NotificationsSettings,
  SettingsSectionId,
} from "./schemas/system-settings.js";

// === Composition Plan (V2) ===
export {
  LayoutTypeSchema,
  TransitionTypeSchema,
  BiomeEntrySchema,
  CompositionPlanEntrySchema,
  CompositionPlanSchema,
} from "./schemas/composition-plan.js";
export type {
  LayoutType,
  TransitionType,
  BiomeEntry,
  CompositionPlanEntry,
  CompositionPlan,
} from "./schemas/composition-plan.js";

// === Pacing Config ===
export { getPacingConfig, getPacingZone } from "./schemas/pacing-config.js";
export type { PacingConfig } from "./schemas/pacing-config.js";

// === Style Presets ===
export {
  StylePresetSchema,
  ColorPaletteSchema,
  LowerThirdStyleSchema,
  TickerStyleSchema,
  CaptionStyleSchema,
  SUBTITLE_STYLE_PRESETS,
  CAPTION_PILL_PRESETS,
} from "./schemas/style-preset.js";
export type {
  StylePreset,
  ColorPalette,
  LowerThirdStyle,
  TickerStyle,
  CaptionStyle,
  SubtitleStyleId,
  CaptionPillId,
} from "./schemas/style-preset.js";

// === Sentence Image ===
export type { SentenceImage } from "./schemas/sentence-image.js";

// === RANKING ===
export {
  RankingItemSchema,
  RankingTierSchema,
  RankingTierConfigSchema,
  RankingPlacementSchema,
  RankingPlanItemSchema,
  RankingPlanSchema,
  RankingUserMediaSchema,
  RankingMetadataSchema,
  FootageCandidateSchema,
  BRollSegmentSchema,
  BRollSelectionSchema,
  HeroSelectionSchema,
  DEFAULT_TIER_CONFIG,
} from "./schemas/ranking-metadata.js";
export type {
  RankingItem,
  RankingTier,
  RankingTierConfig,
  RankingPlacement,
  RankingPlanItem,
  RankingPlan,
  RankingUserMedia,
  RankingMetadata,
  FootageCandidate,
  BRollSegment,
  BRollSelection,
  HeroSelection,
} from "./schemas/ranking-metadata.js";

// === RANKING shot timing (single source of truth for render + studio) ===
export {
  INTRO_SHOT_SECONDS,
  TIER_LIST_SHOT_SECONDS,
  BROLL_SHOT_SECONDS,
  REVEAL_SHOT_SECONDS,
  OUTRO_SHOT_SECONDS,
  MAX_OUTRO_HOLD_SECONDS,
  PER_ITEM_SHOT_SECONDS,
  BLOCK_DURATION_MS,
  TIER_BEAT_MS,
  REVEAL_BEAT_MS,
  MIN_BROLL_MS,
  MAX_TILE_SIZE,
  REVEAL_HERO_PREVIEW_SIZE,
  computeItemWindow,
  allItemsAnchored,
  blockNarrationStartMs,
  computeRankingTotalFrames,
  computeRankingAnchoredFrames,
  computeOutroHold,
  getTierBoardGeometry,
  getSlotCoords,
} from "./schemas/ranking-timing.js";
export type {
  OutroHold,
  ItemWindow,
  TierBoardGeometry,
} from "./schemas/ranking-timing.js";

// === BUSINESS_PLAN_HUB — scene plan ===
export {
  SceneKindSchema,
  LayoutSchema,
  BusinessHubFamilySchema,
  SourceRefSchema,
  VisualRefSchema,
  ScenePresenterSchema,
  SceneTextSchema,
  MgSceneSchema,
  BrollSceneSchema,
  TitleSceneSchema,
  ChapterSceneSchema,
  PresenterSoloSceneSchema,
  BusinessHubSceneSchema,
  BusinessHubPlanSchema,
  PRIMARY_SOURCE_DOMAINS,
  SOURCED_ELEMENT_KINDS,
  ELEMENT_SOURCE_KIND,
  HEADLINE_MAX_CHARS,
  extractSourceHost,
  isAllowlistedPrimarySource,
  sourceKindForElement,
  requiresSource,
} from "./schemas/business-hub-scene.js";
export type {
  SceneKind,
  Layout,
  BusinessHubFamily,
  SourceRef,
  PrimarySourceDomain,
  VisualRef,
  ScenePresenter,
  SceneText,
  SourcedElementKind,
  BusinessHubScene,
  BusinessHubPlan,
} from "./schemas/business-hub-scene.js";

// === BUSINESS_PLAN_HUB — image backend + model selection ===
export {
  BUSINESS_HUB_IMAGE_BACKENDS,
  BUSINESS_HUB_IMAGE_BACKEND_LABELS,
  BusinessHubImageBackendSchema,
  AI33_IMAGE_MODEL_CATALOGUE,
  NANO_BANANA_MODELS,
  NANO_BANANA_2_MODEL_ID,
  NANO_BANANA_PRO_MODEL_ID,
  DEFAULT_BUSINESS_HUB_IMAGE_MODEL,
  backendHonoursImageModel,
  fallbackModelsForBackend,
  defaultModelForBackend,
  modelSupportsAspect,
  resolutionForModel,
  findAI33ImageModel,
} from "./schemas/business-hub-image-model.js";
export type {
  BusinessHubImageBackend,
  ImageModelSpec,
} from "./schemas/business-hub-image-model.js";

// === BUSINESS_PLAN_HUB — motion-graphic element names ===
export {
  BUSINESS_HUB_MG_ELEMENT_NAMES,
  BusinessHubMgElementNameSchema,
  isBusinessHubMgElementName,
} from "./schemas/business-hub-elements.js";
export type { BusinessHubMgElementName } from "./schemas/business-hub-elements.js";

// === BUSINESS_PLAN_HUB — presenter pose hitboxes ===
export {
  NormPointSchema,
  NormVectorSchema,
  NormRectSchema,
  HeadHitboxSchema,
  CollarHitboxSchema,
  PoseHitboxesSchema,
  PixelSizeSchema,
  PixelRectSchema,
  AnchorStatusSchema,
  PoseSchema,
  CalibratedPoseSchema,
  PoseManifestSchema,
  CalibratedPoseManifestSchema,
} from "./schemas/business-hub-hitbox.js";
export type {
  NormPoint,
  NormVector,
  NormRect,
  HeadHitbox,
  CollarHitbox,
  PoseHitboxes,
  PixelSize,
  PixelRect,
  AnchorStatus,
  Pose,
  CalibratedPose,
  PoseManifest,
  CalibratedPoseManifest,
} from "./schemas/business-hub-hitbox.js";

// === BUSINESS_PLAN_HUB — finance-kit outputs ===
export {
  AmortizationRowSchema,
  AmortizationScheduleSchema,
  DscrResultSchema,
  BreakEvenResultSchema,
  ProjectionYearSchema,
  ProjectionSchema,
  SbaFeeResultSchema,
  Eb5JobsResultSchema,
  ChartSeriesSchema,
} from "./schemas/business-hub-finance.js";
export type {
  AmortizationRow,
  AmortizationSchedule,
  DscrResult,
  BreakEvenResult,
  ProjectionYear,
  Projection,
  SbaFeeResult,
  Eb5JobsResult,
  ChartSeries,
} from "./schemas/business-hub-finance.js";

// === Error Detail ===
export { ErrorDetailSchema, buildErrorDetail } from "./schemas/error-detail.js";
export type { ErrorDetail } from "./schemas/error-detail.js";

// === Video Timeline (edit layer above assembly_manifest) ===
export {
  TimelineFrameSchema,
  TextOverlaySchema,
  AvatarPipSchema,
  VoiceoverSchema,
  RegenerationActionSchema,
  RegenerationRequestSchema,
  TimelineSceneSchema,
  VideoTimelineSchema,
} from "./schemas/video-timeline.js";
export type {
  TimelineFrame,
  TextOverlay,
  AvatarPip,
  Voiceover,
  RegenerationAction,
  RegenerationRequest,
  TimelineScene,
  VideoTimeline,
} from "./schemas/video-timeline.js";

// === Clip Library ===
export {
  TranscriptWordSchema,
  TranscriptSchema,
  SentenceTimingSchema,
  SentenceTimingArraySchema,
  ClauseTimingSchema,
  ClauseTimingArraySchema,
  ClipSegmentSchema,
  EditListEntrySchema,
  EditListSchema,
  ShotListEntrySchema,
  ShotListSchema,
  FormatPlaybookSchema,
  ClipIngestPayloadSchema,
  CreateSourceVideoPayloadSchema,
  ClipLabelPayloadSchema,
  ClipLabelBatchPayloadSchema,
  ClipEmbedPayloadSchema,
  ClipSelectionPayloadSchema,
  ClipRetagPayloadSchema,
  ClipExtractPayloadSchema,
  ImageIngestPayloadSchema,
  ImageLabelPayloadSchema,
  ImageEmbedPayloadSchema,
  CreateSourceImagePayloadSchema,
  FaceResultSchema,
  AudioClassResultSchema,
  SparseEmbeddingSchema,
  EmbeddingResultSchema,
  SceneDetectionResultSchema,
} from "./clip-library.js";
export type {
  TranscriptWord,
  Transcript,
  SentenceTiming,
  ClauseTiming,
  ClipSegment,
  EditListEntry,
  EditList,
  ShotListEntry,
  ShotList,
  FormatPlaybook,
  ClipIngestPayload,
  CreateSourceVideoPayload,
  ClipLabelPayload,
  ClipLabelBatchPayload,
  ClipEmbedPayload,
  ClipSelectionPayload,
  ClipRetagPayload,
  ClipExtractPayload,
  ImageIngestPayload,
  ImageLabelPayload,
  ImageEmbedPayload,
  CreateSourceImagePayload,
  FaceResult,
  AudioClassResult,
  EmbeddingResult,
  SceneDetectionResult,
} from "./clip-library.js";

export {
  buildRefBase,
  composeExternalRef,
  parseYoutubeId,
} from "./clip-ref.js";
export type { RefBaseSource } from "./clip-ref.js";

export const CONTRACTS_PACKAGE_VERSION = "0.1.0";

// Re-export zod's z so that internal packages can import it through a
// project-reference that reliably resolves zod in all environments.
export { z } from "zod";

// === Tutorial Production Engine ===
export { TutorialJobStatus } from "./enums/tutorial-job-status.js";
export type { TutorialJobStatus as TutorialJobStatusType } from "./enums/tutorial-job-status.js";
export { TutorialMode } from "./enums/tutorial-mode.js";
export type { TutorialMode as TutorialModeType } from "./enums/tutorial-mode.js";
export { TutorialPromptCategory } from "./enums/tutorial-prompt-category.js";
export type { TutorialPromptCategory as TutorialPromptCategoryType } from "./enums/tutorial-prompt-category.js";
export { SecretCapability } from "./enums/secret-capability.js";
export type { SecretCapability as SecretCapabilityType } from "./enums/secret-capability.js";
export {
  LLMProviderId,
  TTSProviderId,
  TUTORIAL_PROVIDERS,
} from "./schemas/tutorial-provider.js";
export type { ProviderMeta } from "./schemas/tutorial-provider.js";
// === Voice Settings ===
export { VoiceSettingsSchema } from "./schemas/voice-settings.js";
export type { VoiceSettings } from "./schemas/voice-settings.js";

export {
  TutorialGeneratePayloadSchema,
  TutorialSplicePayloadSchema,
  TutorialStitchPayloadSchema,
  TutorialTranslatePayloadSchema,
} from "./queue-payloads/tutorial-payloads.js";
export type {
  TutorialGeneratePayload,
  TutorialSplicePayload,
  TutorialStitchPayload,
  TutorialTranslatePayload,
} from "./queue-payloads/tutorial-payloads.js";
