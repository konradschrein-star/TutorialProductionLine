// Media processing layer
// FFmpeg wrappers, probes, composition helpers, render utilities
// Remotion composition templates
// No UI logic, no workflow state

// === Whisper ===
export { runWhisper } from "./whisper/runner.js";
export type { WhisperWord, WhisperOutput } from "./whisper/types.js";

// === Speaker Detection (Bundestag) ===
// NOTE: Temporarily commented out due to Next.js build issues with ffmpeg dynamic imports
// Import directly from "./speaker-detection.js" in Bundestag worker
// export { detectSpeakers } from "./speaker-detection.js";
export type {
  SpeakerDetectionInput,
  SpeakerDetectionOutput,
  SpeakerSegment,
  PartyAffiliation,
} from "./speaker-detection.js";

// === Party Overlays (Bundestag) ===
export {
  PARTY_OVERLAYS,
  generateOverlayFiltergraph,
  getPartyConfig,
  getAllPartyNames,
  isValidPartyName,
  getLogoPath,
} from "./overlays/party-overlays.js";
export type {
  PartyName,
  PartyOverlayConfig,
  OutputFormat,
  OverlayOptions,
} from "./overlays/party-overlays.js";

// === Audio Onset Detection ===
export {
  detectSilencePeriods,
  refineTimestampsWithOnsets,
  getPreciseSentenceStarts,
} from "./audio-onset-detection.js";
export type { SilencePeriod } from "./audio-onset-detection.js";

// === Audio Loudness Analysis ===
// Note: Exported below with other audio analysis functions
export type { LoudnessMeasurement } from "./audio-analysis.js";

// === Color Verification ===
export {
  getAverageColor,
  colorDistance,
  extractFrameAtTime,
  verifyCutColors,
  verifyCutTimingConsistency,
} from "./color-verification.js";
export type { RGB, ColorMatch } from "./color-verification.js";

// === FFmpeg ===
export { applyGistWash } from "./ffmpeg/gist-wash.js";
export { upscaleTo1440p } from "./ffmpeg/upscale.js";
export { applyGistWashAndUpscale } from "./ffmpeg/post-process.js";
export { injectMetadata } from "./ffmpeg/metadata.js";
export { probeMediaDuration, probeMediaDimensions } from "./ffmpeg/probe.js";
export { probeMedia, parseProbeOutput } from "./ffmpeg/full-probe.js";
export type {
  MediaProbeResult,
  VideoStreamInfo,
  AudioStreamInfo,
} from "./ffmpeg/full-probe.js";
export { generateASSFile } from "./ffmpeg/ass-generator.js";
export type {
  ASSCaptionOptions,
  SubtitleColorScheme,
} from "./ffmpeg/ass-generator.js";
export { renderV3 } from "./ffmpeg/render-v3.js";
export type { V3Scene, V3RenderParams } from "./ffmpeg/render-v3.js";
export { ffmpegAudioSubtitleMux } from "./ffmpeg/audio-subtitle-mux.js";
export type { AudioSubtitleMuxParams } from "./ffmpeg/audio-subtitle-mux.js";
export { ffmpegAudioMux } from "./ffmpeg/audio-mux.js";
export type { AudioMuxParams } from "./ffmpeg/audio-mux.js";
export {
  muxTtsOntoRecording,
  buildMuxArgs,
} from "./ffmpeg/mux-tts-onto-recording.js";
export type { MuxTtsParams } from "./ffmpeg/mux-tts-onto-recording.js";
export { detectLeadingSilence } from "./ffmpeg/detect-leading-silence.js";
export type { DetectLeadingSilenceOptions } from "./ffmpeg/detect-leading-silence.js";
export { detectTtsOffsetByAudioMatch } from "./ffmpeg/detect-tts-offset.js";
export { mixAudioWithMusic } from "./ffmpeg/audio-mix.js";
export type { AudioMixParams } from "./ffmpeg/audio-mix.js";
export { FFmpegProgressTracker } from "./ffmpeg/progress-tracker.js";
export type {
  ProgressTrackerConfig,
  ProgressUpdateFn,
} from "./ffmpeg/progress-tracker.js";
export {
  normalizeVideo,
  batchNormalizeVideos,
} from "./ffmpeg/normalize-video.js";
export type {
  NormalizeVideoConfig,
  NormalizeVideoResult,
} from "./ffmpeg/normalize-video.js";
export { timeStretchAudio } from "./ffmpeg/time-stretch-audio.js";
export type { TimeStretchAudioResult } from "./ffmpeg/time-stretch-audio.js";

// === FFmpeg filtergraph builder ===
// Typed filter_complex construction: allocates every intermediate label,
// tracks production/consumption, throws on reuse/dangling/kind mismatch.
export {
  FilterGraph,
  FilterGraphError,
  labelRef,
  fmtNumber,
  escapeFilterValue,
} from "./ffmpeg/filtergraph.js";
export type {
  StreamKind,
  Label,
  FilterNode,
  ChannelMixerKey,
  ChannelMixerMatrix,
  ScaleOptions,
  OverlayNodeOptions,
  RotateOptions,
  EqOptions,
  BoxblurOptions,
  GblurOptions,
  FadeOptions,
  ConcatSegment,
  ConcatResult,
} from "./ffmpeg/filtergraph.js";

// === FFmpeg layer compositor ===
// Back-to-front layer stack -> ONE ffmpeg invocation (one -i per layer,
// one filter_complex, one encode). No intermediate files, no browser.
export {
  compositeLayers,
  buildCompositeLayersArgs,
  CompositeLayersError,
} from "./ffmpeg/composite-layers.js";
export type {
  LayerTransform,
  CompositeLayer,
  GradeSpec,
  CompositeLayersParams,
  CompositeLayersPlan,
} from "./ffmpeg/composite-layers.js";

// === Ken Burns GPU Renderer ===
export { renderKenBurnsVideo } from "./kenburns-gpu/index.js";
export type {
  KenBurnsScene,
  KenBurnsRenderParams,
} from "./kenburns-gpu/index.js";

// === Remotion ===
export {
  renderComposition,
  warmRemotionBrowser,
  shutdownRemotionBrowser,
} from "./remotion/render.js";
export type { RenderCompositionParams } from "./remotion/render.js";
export { parseRenderConfig } from "./remotion/config.js";
export type {
  RemotionRenderConfig,
  RenderSettings,
} from "./remotion/config.js";

// === R2 ===
export { downloadFromR2 } from "./r2/download.js";
export { uploadToR2 } from "./r2/upload.js";

// === Archive (Tier 2 local storage) ===
export {
  getLocalAssetPath,
  localAssetExists,
  localAssetExistsSync,
  saveLocalAsset,
  deleteLocalAssets,
  streamLocalAsset,
} from "./archive/local-storage.js";

// === Utils ===
export { mulberry32 } from "./utils/deterministic-random.js";
export { createTempDir, cleanupTempDir } from "./utils/temp-files.js";
export {
  ensureMediaDirectory,
  ensureMediaSubdirectory,
} from "./utils/directory-management.js";
export { retryFileOperation } from "./utils/retry-file-operation.js";

// === AI33 ===
export { generateImageAI33 } from "./ai33/image.js";

// === Google Gemini ===
// NOTE: generateImageGoogleDirect was DELETED (§2.3, Layer 1). Gemini image
// generation (Nano Banana) bills money and is forbidden on the free-tier key.
// Image generation goes through the media-gateway (VUP -> forge -> ...) only.

// === Background Removal ===
export { removeBackground } from "./background-removal.js";
export type { RemoveBackgroundOptions } from "./background-removal.js";

// === Validation ===
export {
  validateAspectRatio,
  validateResolution,
  validateFileType,
  validateDuration,
  validateAssetHealth,
} from "./validation/media-validators.js";
export type { AssetHealthParams } from "./validation/media-validators.js";

// === Video Analysis ===
export { detectBlackScreen, countScenes } from "./video-analysis.js";
export type {
  BlackScreenDetectionResult,
  SceneCountResult,
} from "./video-analysis.js";

// === Audio Analysis ===
export { measureLoudness, validateLoudness } from "./audio-analysis.js";
export type { LoudnessValidationResult } from "./audio-analysis.js";

// === Output QA gate (format-agnostic, runs on every finished render) ===
export {
  runVideoQaGate,
  measureVideoQa,
  evaluateVideoQa,
  logVideoQaResult,
  parseFreezeIntervals,
  parseBlackIntervals,
  parseVolumeDetect,
  parseIntegratedLufs,
  DEFAULT_VIDEO_QA_THRESHOLDS,
  SCREEN_RECORDING_QA_THRESHOLDS,
} from "./video-qa-gate.js";
export type {
  VideoQaResult,
  VideoQaMeasurements,
  VideoQaThresholds,
  VideoQaExpectations,
  QaCheck,
  QaCheckId,
  QaCheckStatus,
  QaInterval,
} from "./video-qa-gate.js";

// === Global Subtitle System ===
export { chunkWords } from "./subtitles/chunker.js";
export { selectKeywords } from "./subtitles/keyword-selector.js";
export { buildCaptionPlan } from "./subtitles/plan.js";
// ASS/libass engine (CaptionPlan -> ASS document).
export {
  buildAssFromPlan,
  hexToAss,
  assAlignment,
  escapeAssText,
  formatTime as formatAssTime,
  ENGINE_PARITY_NOTES,
} from "./subtitles/ass/index.js";
// Shared geometry / timing rules — the single numeric source of truth both
// caption engines derive from.
export {
  DESIGN_HEIGHT,
  computeCanvasScale,
  computeVerticalPlacement,
  computeSafeMaxWidthPercent,
  computeAssSideMargins,
  cssStrokeToAssOutline,
  activeWordIndex,
  activeWordRanges,
  MIN_CUE_SECONDS,
  MAX_CUE_SECONDS,
  MAX_CHARS_PER_LINE,
  estimateTextWidthEm,
  lineWidthBudgetEm,
} from "./subtitles/layout.js";
export type { FrameSize } from "./subtitles/layout.js";
// NOTE: the canonical RemotionSubtitleConfig/FFmpegSubtitleConfig live in
// @repo/db — import them from there. media-core exports only the v2
// segmentation-brain types below.
export type {
  WordTimestamp,
  CaptionWord,
  CaptionChunk,
  CaptionPlan,
  ChunkerOptions,
} from "./subtitles/types.js";

// === Content-addressed segment cache ===
// Deterministic cache key from canonical JSON + on-disk store with sidecars,
// integrity checks and LRU eviction. Used for Remotion MG island clips.
export {
  canonicalStringify,
  isJsonValue,
  CanonicalJsonError,
  computeCacheKey,
  createSegmentCache,
  getSegmentCache,
  selectEvictions,
  SegmentCache,
  SegmentCacheError,
  SegmentCacheIntegrityError,
} from "./cache/index.js";
export type {
  JsonPrimitive,
  JsonValue,
  EvictionPlan,
  ProducedSegment,
  SegmentCacheEntry,
  SegmentCacheListing,
  SegmentCacheOptions,
  SegmentCacheOrphans,
  SegmentCacheResult,
  SegmentCacheSpec,
  SegmentCacheStats,
  SegmentProduceContext,
  SegmentSidecar,
  SegmentStoreMeta,
} from "./cache/index.js";

// === Audio envelope (per-frame RMS) ===
// Per-frame narration loudness from raw s16le PCM. Drives the presenter
// head pump; measureLoudness/detectSilencePeriods cannot.
export {
  computeRmsEnvelope,
  computeRmsFrames,
  buildPcmDecodeArgs,
  decodePcmS16le,
  smoothEnvelope,
  normaliseEnvelope,
  percentileOf,
  DEFAULT_ENVELOPE_SAMPLE_RATE,
  DEFAULT_ENVELOPE_PERCENTILE,
  DEFAULT_SMOOTHING_TAPS,
} from "./audio-envelope.js";
export type {
  RmsEnvelope,
  PcmDecoder,
  ComputeRmsEnvelopeParams,
} from "./audio-envelope.js";

// === Presenter overlay track (browserless alpha compositing) ===
// Pose calibration guard + layout maths, head-mark theming, and the
// alpha presenter track built from quantised head-scale steps.
export {
  requireCalibratedPose,
  computePoseScale,
  resolvePresenterLayout,
  themeHeadMarkSvg,
  buildPresenterTrack,
  buildPresenterTrackArgs,
  buildHeadScaleSteps,
  quantiseEnvelopeToSteps,
  headStepFileName,
  buildHeadStepArgs,
  buildConcatListText,
  DEFAULT_HEAD_SCALE_RANGE,
  DEFAULT_HEAD_SCALE_STEPS,
} from "./presenter/index.js";
export type {
  PresenterSide,
  PresenterPlacement,
  PoseScale,
  PresenterLayout,
  HeadMarkTheme,
  HeadScaleRange,
  HeadMarkSource,
  SvgRasteriser,
  PresenterTrackParams,
  PresenterTrackResult,
} from "./presenter/index.js";

// === BUSINESS_PLAN_HUB plate baking ===
// Ground mats, copy plates, the watermark and the head mark, rasterised once
// and content-addressed. `bakePlates` produces `metadata.business_hub.assets`
// verbatim — the object the render workflow refuses to start without.
export {
  bakePlates,
  isGroundThemeSlug,
  themeForGround,
  resolvePresenterAssetRoot,
  resolveWatermarkSvgPath,
  PlateError,
  GROUND_THEME_SLUGS,
  HEAD_MARK_RELATIVE,
  PRESENTER_ASSETS_RELATIVE,
  WATERMARK_RELATIVE,
} from "./plates/index.js";
export type {
  BakePlatesParams,
  BakePlatesResult,
  GroundThemeSlug,
  HeadMarkInput,
  PlateSet,
  PresenterPlateAssets,
  PresenterPlateInput,
  TextPlateBox,
} from "./plates/index.js";

export const MEDIA_CORE_PACKAGE_VERSION = "0.1.0";
export { capturePublicationApproval, publicationApprovalMatches } from "./publication-approval.js";
export type { PublicationIdentity, ApprovedPublication } from "./publication-approval.js";
