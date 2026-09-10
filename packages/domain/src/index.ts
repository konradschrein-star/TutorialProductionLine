/**
 * @repo/domain - Pure Business Logic
 *
 * Public exports for the domain package.
 * Provides state machine, transition logic, and domain rules.
 *
 * ZERO IO - Pure functions only.
 */

// State machine
export {
  transitionJob,
  getAvailableTransitions,
} from "./state-machine/transitions.js";
export type { Result } from "./state-machine/transitions.js";
export {
  isTerminalState,
  isFailureState,
  canRetry,
  canPause,
  isAwaitingHumanAction,
  isActivelyProcessing,
} from "./state-machine/state-queries.js";
export {
  TRANSITION_MAP,
  TERMINAL_STATES,
  FAILURE_STATES,
  PAUSABLE_STATES,
} from "./state-machine/transition-rules.js";

// Pacing
export {
  computeScenePacing,
  computeWordAlignedPacing,
  computeSentenceImageTimings,
  computeSentenceImageTimingsWithOnsets,
} from "./pacing.js";
export type {
  SceneTiming,
  PacingParams,
  SentenceSegmentTiming,
} from "./pacing.js";

// Errors
export { TransitionError, PauseError, ResumeError } from "./errors/index.js";
export {
  PipelineErrorCode,
  isRetryableCode,
  PipelineError,
  ConfigurationError,
  MediaValidationError,
  ExternalServiceError,
  AssetNotFoundError,
  RenderError,
  ValidationError as PipelineValidationError,
  MissingQueueError,
} from "./errors/index.js";
export type {
  MediaValidationErrorOptions,
  ExternalServiceErrorOptions,
  RenderErrorOptions,
} from "./errors/index.js";

// Visual Guidelines
export {
  BROADCAST_PHOTOGRAPHY_SPECS,
  SHOT_TYPES,
  CAMERA_ANGLES,
  recommendShotType,
  recommendCameraAngle,
  getCameraSpec,
  getLightingSpec,
  getCompositionRules,
  getRealismModifiers,
  getCameraAngleDescription,
  formatPhotographySpecsForPrompt,
  formatVisualGuidelinesForPrompt,
} from "./visual-guidelines.js";
export type { ShotType, CameraAngle } from "./visual-guidelines.js";

// Prompt Builder
export {
  buildEnrichedImagePrompt,
  buildIllustrationImagePrompt,
} from "./prompt-builder.js";
export type {
  VisualTheme,
  EnrichedPromptParams,
  IllustrationPromptParams,
} from "./prompt-builder.js";

// Prompt Sanitizer
export {
  sanitizePrompt,
  simplifyPrompt,
  extractCoreSubject,
} from "./prompt-sanitizer.js";

// Render Routing
export { decideRenderEngine } from "./render-routing.js";
export type {
  RenderRoutingInput,
  RenderEngine as RenderEngineDecision,
} from "./render-routing.js";

// Render Engine Detection (boolean helper for UI)
export { willUseRemotionRenderer } from "./render-engine-detection.js";
export type { RenderEngineInput } from "./render-engine-detection.js";

// Renderer Compatibility
export {
  RENDER_WORKFLOWS,
  RENDERER_METADATA,
  FORMAT_RENDERER_COMPATIBILITY,
  isRendererCompatible,
  getCompatibleRenderers,
  getPreferredRenderer,
  getRendererRequirements,
  getIncompatibleRenderers,
  getMatrixCoveredFormats,
  validateRendererCompatibility,
} from "./renderer-compatibility.js";
export type {
  RenderWorkflow,
  RendererRequirements,
} from "./renderer-compatibility.js";

// TECH_COMPARISON metadata normalization (single source of truth for the
// flat product_a_name/product_b_name ↔ products[{slot,name}] duality)
export {
  DEFAULT_COMPARISON_SUBFORMAT,
  extractComparison,
  normalizeComparison,
  normalizeComparisonMetadata,
  describeComparisonShape,
} from "./comparison-metadata.js";
export type {
  ComparisonProduct,
  NormalizedComparison,
} from "./comparison-metadata.js";

// Scene Composition (V2 biome-based layout)
export {
  generateCompositionPlan,
  generateSentenceCompositionPlan,
  computeHookDurationSeconds,
  assignPreliminaryLayouts,
} from "./scene-composition.js";
export type {
  SceneInput as CompositionSceneInput,
  SentenceInput as CompositionSentenceInput,
  CompositionParams,
  SentenceCompositionParams,
  PreliminaryLayoutEntry,
} from "./scene-composition.js";

// Comparison Composition (comparison format specific)
export { generateComparisonCompositionPlan } from "./comparison-composition.js";
export type {
  ComparisonCompositionPlan,
  BlockCompositionPlan,
  SentenceLayoutAssignment,
  ComparisonCompositionParams,
  ComparisonSceneInput,
  ComparisonSentenceInput,
} from "./comparison-composition.js";

// Sentence Splitter
export { splitSentences, splitSubSentences } from "./sentence-splitter.js";

// Word alignment (canonical normalizer + two-tier policy docs)
export { normalizeWord } from "./alignment.js";

// Asset Resolution
export {
  REFERENCE_INJECTION_ORDER,
  resolveAssets,
  buildReferenceInjectedPrompt,
} from "./asset-resolution.js";
export type {
  ReferenceSlot,
  AssetResolutionContext,
  AssetResolutionQuery,
  ResolutionTier,
  AssetResolutionSpec,
  ReferenceInjectionInput,
  ReferenceInjectionResult,
} from "./asset-resolution.js";

// Timeline Hydration (manifest → VideoTimeline edit layer)
export { hydrateTimelineFromManifest } from "./timeline-hydration.js";
export type {
  HydrationParams,
  FrameSequenceInput,
} from "./timeline-hydration.js";

// Research Prompt Generation Templates
export { buildResearchPromptGenerationPrompt } from "./templates/comparison-research-prompts.js";
export type { ResearchPromptInput } from "./templates/comparison-research-prompts.js";

// Research File Parsing
export { parseResearchFiles } from "./research-parser.js";
export type {
  ResearchFile,
  ParsedResearchFile,
  ParsedResearch,
} from "./research-parser.js";

// Validation Harness
export {
  bootstrapValidation,
  validateStage,
  validateWith,
  success as validationSuccess,
  failure as validationFailure,
  validationError,
  combineResults,
  getValidationRegistry,
  resetValidationRegistry,
  IngestValidator,
} from "./validation/index.js";
export type {
  ValidationError,
  ValidationResult,
  ValidationContext,
  ValidationSeverity,
  Validator,
} from "./validation/index.js";

// Quality Assurance
export {
  checkPromptQuality,
  checkReferenceImageQuality,
  runPreflightChecks,
  createAPICallAuditLog,
  validateAPICallAuditLog,
} from "./quality-assurance.js";
export type { QACheckResult, APICallAuditLog } from "./quality-assurance.js";

// === Tutorial length judgement (shared by the worker and hub-web) ===
export {
  modeForMinutes,
  countSteps,
  stepCountAdvice,
  labelForMode,
  parseLengthBucket,
  planForMinutes,
  tutorialLengthPlan,
  SPOKEN_WORDS_PER_MINUTE,
  LONG_FORM_PART_MINUTES,
  MAX_TARGET_MINUTES,
} from "./tutorial-length.js";
export type {
  TutorialLengthMode,
  LengthAdvice,
  TutorialMode,
  LengthBucket,
  LengthEvidence,
  TutorialLengthPlan,
} from "./tutorial-length.js";

export { deriveLogoSubject } from "./tutorial-product-subject.js";

export const DOMAIN_PACKAGE_VERSION = "0.1.0";
export { TUTORIAL_TITLE_SUFFIXES_2026, buildGeneratedTutorialTitle, recommendTutorialTitleSuffix } from './tutorial-title-policy.js';
export type { TutorialTitleSuffix } from './tutorial-title-policy.js';
