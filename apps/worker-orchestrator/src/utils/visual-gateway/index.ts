/**
 * BUSINESS_PLAN_HUB visual sourcing gateway.
 *
 * `requestVisual()` is the only entry point the pipeline should use. Nothing in
 * this format is screen-recorded: every visual is generated through the
 * media-gateway or sourced from a licence-bearing provider, and every returned
 * asset carries `{ provider, sourceUrl, licence, retrievedAt }`.
 */
export {
  requestVisual,
  VisualSourcingError,
  DEFAULT_ADAPTERS,
} from "./gateway.js";
export type { RequestVisualDeps } from "./gateway.js";

export {
  ESSENTIAL_VISUAL_PROVIDERS,
  EssentialVisualProviderError,
  essentialProvidersFor,
  isEssentialProvider,
  preflightEssentialVisualProviders,
  probeGeneratedBackends,
} from "./essential-providers.js";
export type {
  BackendVerdict,
  EssentialPreflightReport,
  EssentialProviderPolicy,
} from "./essential-providers.js";

export {
  isPublishable,
  requiresAttribution,
  assessPosture,
  normaliseLicence,
  PROVIDER_LICENCE_AUTHORITY,
  GENERATED_LICENCE,
  UNKNOWN_LICENCE,
} from "./licence.js";

export {
  PROVIDER_ORDER_BY_INTENT,
  providerOrderFor,
  screenCandidates,
  validateProvenance,
  validateRequest,
} from "./policy.js";
export type {
  AcceptedCandidate,
  CandidateScreening,
  ProvenanceCheck,
} from "./policy.js";

export {
  contentHashOf,
  createFileSystemVisualStore,
  visualLibraryRoot,
} from "./store.js";

export { measureImageDimensions } from "./image-dimensions.js";
export type { PixelDimensions } from "./image-dimensions.js";

export {
  generatedProvider,
  composeGenerationPrompt,
  framingFor,
} from "./providers/generated.js";

export {
  ART_DIRECTION_STYLE,
  ART_DIRECTION_SURFACE,
  ART_DIRECTION_PALETTE,
  ART_DIRECTION_LIGHT,
  ART_DIRECTION_LENS,
  ART_DIRECTION_NEGATIVES,
  BUSINESS_HUB_PALETTE,
  STYLE_GUIDE_MAX_BYTES,
  STYLE_GUIDE_PATH_ENV,
  STYLE_GUIDE_PROMPT,
  composeArtDirectedPrompt,
  loadStyleReference,
  styleGuidePath,
} from "./art-direction.js";
export type { ArtDirectedPromptInput } from "./art-direction.js";
export { pexelsProvider } from "./providers/pexels.js";
export {
  wikimediaProvider,
  parseCommonsLicence,
} from "./providers/wikimedia.js";
export { googleProvider, imageSearchCapability } from "./providers/google.js";
export {
  webProvider,
  webHostAllowlist,
  PRIMARY_SOURCE_HOSTS,
} from "./providers/web.js";

export { VISUAL_INTENTS, VISUAL_PROVIDERS } from "./types.js";
export type {
  CandidateRejection,
  LicencePosture,
  ProviderAttempt,
  StoredVisual,
  VisualCandidate,
  VisualIntent,
  VisualMediaKind,
  VisualOrientation,
  VisualProvenance,
  VisualProvider,
  VisualProviderAdapter,
  VisualRequest,
  VisualResult,
  VisualStore,
} from "./types.js";
