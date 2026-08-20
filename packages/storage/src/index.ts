/**
 * @repo/storage — finished-product storage.
 *
 * The VPS is and stays the primary store. Google Drive is an ADDITIONAL
 * destination for finished deliverables only (final video, thumbnail,
 * metadata sidecar) so that a human or the distribution engine can retrieve
 * them without SSH.
 *
 * Explicitly NOT in scope: temp files, per-scene images, TTS chunks, working
 * renders, scratch dirs, bulk backup. See docs/STORAGE.md.
 */

export {
  ArtifactStore,
  MIME_BY_KIND,
  type ArtifactStoreDeps,
  type PutFinalArtifactArgs,
  type PutFinalArtifactResult,
  type StorageEventSink,
} from "./artifact-store.js";

export {
  loadStorageConfig,
  type DriveAuthConfig,
  type DriveConfig,
  type StorageConfigResult,
} from "./config.js";

export {
  getDriveHealth,
  probeDriveHealth,
  type DriveHealth,
  type DriveStatus,
} from "./health.js";

export {
  checkBudget,
  getUsageBytes,
  recordUsage,
  utcDateKey,
  compareUploadPriority,
  UPLOAD_PRIORITY,
  type BudgetDecision,
} from "./daily-budget.js";

export {
  buildTranscriptDoc,
  transcriptToSrt,
  formatSrtTimestamp,
  wordCount,
  TranscriptUnavailableError,
  type TranscriptDoc,
  type TranscriptSource,
  type TranscriptWord,
  type TranscriptSentence,
  type BuildTranscriptInput,
} from "./transcript.js";

export {
  collectFinishedTutorialArtifacts,
  tutorialCompletionDate,
  isFinishedTutorialStatus,
  FINISHED_TUTORIAL_STATUSES,
  type FinishedTutorialRow,
  type FinishedTutorialArtifact,
} from "./finished-tutorial-jobs.js";

export {
  classifyHttpError,
  classifyThrown,
  isRetryable,
  parseRetryAfterMs,
  storageError,
  type StorageError,
  type StorageErrorKind,
} from "./errors.js";

export {
  ARTIFACT_FILENAMES,
  DEFAULT_ROOT_FOLDER_NAME,
  DEFAULT_TUTORIALS_FOLDER_NAME,
  DEFAULT_CLIPFORGE_ROOT_FOLDER_NAME,
  DEFAULT_COMPARISONS_FOLDER_NAME,
  DEFAULT_FORMAT_ROOT_FOLDERS,
  rootFolderForFormat,
  UNKNOWN_CHANNEL_FOLDER,
  buildMetadataSidecar,
  buildMetadataSidecarV2,
  buildUploadSheet,
  dayStamp,
  languageSegment,
  monthFolder,
  planJobFolder,
  planTutorialFolder,
  planTutorialArchiveFolder,
  TUTORIAL_ARCHIVE_FOLDER_NAME,
  planClipForgeFolder,
  sanitizeChannelFolder,
  shortJobId,
  slugifyTitle,
  type ArtifactMetadataSidecar,
  type ArtifactMetadataSidecarV2,
  type MetadataSidecarV2Input,
  type SidecarFileEntry,
  type FolderPlan,
  type JobFolderInput,
  type TutorialFolderInput,
  type UploadSheetInput,
  type ClipForgeFolderInput,
} from "./folder-scheme.js";

export {
  DEFAULT_BACKOFF,
  computeBackoffDelayMs,
  nextDelayMs,
  shouldRetry,
  withRetry,
  realRetryDeps,
  type Attempt,
  type BackoffOptions,
  type RetryDeps,
} from "./retry.js";

export {
  TokenBucketRateLimiter,
  type RateLimiterOptions,
} from "./rate-limiter.js";

export {
  DriveClient,
  DRIVE_FOLDER_MIME,
  APP_PROP_JOB_ID,
  APP_PROP_KIND,
  type DriveClientDeps,
  type DriveFile,
} from "./drive/client.js";

export {
  DriveTokenProvider,
  DRIVE_SCOPE,
  type AccessToken,
} from "./drive/auth.js";

export {
  resumableUpload,
  type ResumableUploadArgs,
} from "./drive/resumable-upload.js";

export {
  ensureArtifactRow,
  getArtifact,
  getArtifactById,
  listArtifactsByState,
  listArtifactsForJob,
  markFailed,
  markSkipped,
  markUploaded,
  markUploading,
  recordProgress,
  resetForRetry,
  type EnsureArtifactInput,
} from "./repository.js";

export {
  collectFinishedJobArtifacts,
  FINISHED_JOB_STATUSES,
  type FinishedJobArtifact,
  type FinishedJobRow,
} from "./finished-jobs.js";
