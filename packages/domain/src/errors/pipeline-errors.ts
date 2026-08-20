/**
 * Pipeline Error Taxonomy
 *
 * Structured, typed error classes for all pipeline failure modes.
 * These errors carry machine-readable codes and structured metadata
 * for dashboard display, retry decisions, and error triage.
 *
 * Design: Returned as Result.failure() values or attached to job
 * error_detail JSONB — not thrown for control flow.
 */

// ---------------------------------------------------------------------------
// Error Codes
// ---------------------------------------------------------------------------

export enum PipelineErrorCode {
  // Media validation
  INVALID_ASPECT_RATIO = "INVALID_ASPECT_RATIO",
  INVALID_RESOLUTION = "INVALID_RESOLUTION",
  INVALID_FILE_TYPE = "INVALID_FILE_TYPE",
  INVALID_CODEC = "INVALID_CODEC",
  INVALID_DURATION = "INVALID_DURATION",
  CORRUPT_FILE = "CORRUPT_FILE",
  ZERO_SIZE_ASSET = "ZERO_SIZE_ASSET",
  OVERSIZED_ASSET = "OVERSIZED_ASSET",

  // Asset
  ASSET_MISSING_FROM_R2 = "ASSET_MISSING_FROM_R2",
  ASSET_DOWNLOAD_FAILED = "ASSET_DOWNLOAD_FAILED",
  ASSET_UPLOAD_FAILED = "ASSET_UPLOAD_FAILED",
  MANIFEST_INCONSISTENT = "MANIFEST_INCONSISTENT",

  // External service
  EXTERNAL_API_TIMEOUT = "EXTERNAL_API_TIMEOUT",
  EXTERNAL_API_RATE_LIMITED = "EXTERNAL_API_RATE_LIMITED",
  EXTERNAL_API_AUTH_FAILED = "EXTERNAL_API_AUTH_FAILED",
  EXTERNAL_API_SERVER_ERROR = "EXTERNAL_API_SERVER_ERROR",
  EXTERNAL_API_BAD_RESPONSE = "EXTERNAL_API_BAD_RESPONSE",

  // Render
  FFMPEG_PROCESS_FAILED = "FFMPEG_PROCESS_FAILED",
  FFMPEG_BINARY_NOT_FOUND = "FFMPEG_BINARY_NOT_FOUND",
  REMOTION_BUNDLE_FAILED = "REMOTION_BUNDLE_FAILED",
  REMOTION_RENDER_FAILED = "REMOTION_RENDER_FAILED",
  WHISPER_FAILED = "WHISPER_FAILED",
  RENDER_OUTPUT_CORRUPT = "RENDER_OUTPUT_CORRUPT",

  // Pipeline
  INVALID_PAYLOAD = "INVALID_PAYLOAD",
  JOB_NOT_FOUND = "JOB_NOT_FOUND",
  TEMPLATE_NOT_FOUND = "TEMPLATE_NOT_FOUND",
  SCRIPT_MISSING = "SCRIPT_MISSING",
  ASSEMBLY_MANIFEST_INVALID = "ASSEMBLY_MANIFEST_INVALID",

  // Configuration & Infrastructure
  MISSING_QUEUE = "MISSING_QUEUE",
  INVALID_CONFIGURATION = "INVALID_CONFIGURATION",
  MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
  INVALID_JSON = "INVALID_JSON",

  // Unknown
  UNKNOWN = "UNKNOWN",
}

// ---------------------------------------------------------------------------
// Retryable classification
// ---------------------------------------------------------------------------

const RETRYABLE_CODES: ReadonlySet<PipelineErrorCode> = new Set([
  PipelineErrorCode.EXTERNAL_API_TIMEOUT,
  PipelineErrorCode.EXTERNAL_API_RATE_LIMITED,
  PipelineErrorCode.EXTERNAL_API_SERVER_ERROR,
  PipelineErrorCode.ASSET_DOWNLOAD_FAILED,
  PipelineErrorCode.ASSET_UPLOAD_FAILED,
]);

export function isRetryableCode(code: PipelineErrorCode): boolean {
  return RETRYABLE_CODES.has(code);
}

// ---------------------------------------------------------------------------
// Abstract base
// ---------------------------------------------------------------------------

export abstract class PipelineError extends Error {
  abstract readonly code: PipelineErrorCode;

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
    };
  }
}

// ---------------------------------------------------------------------------
// Media Validation Error
// ---------------------------------------------------------------------------

export interface MediaValidationErrorOptions {
  assetKey?: string;
  expected?: string;
  actual?: string;
}

export class MediaValidationError extends PipelineError {
  readonly code: PipelineErrorCode;
  readonly assetKey?: string;
  readonly expected?: string;
  readonly actual?: string;

  constructor(
    code: PipelineErrorCode,
    message: string,
    options?: MediaValidationErrorOptions,
  ) {
    super(message);
    this.name = "MediaValidationError";
    this.code = code;
    this.assetKey = options?.assetKey;
    this.expected = options?.expected;
    this.actual = options?.actual;
  }

  toJSON(): Record<string, unknown> {
    const json: Record<string, unknown> = {
      name: this.name,
      code: this.code,
      message: this.message,
    };
    if (this.assetKey !== undefined) json.assetKey = this.assetKey;
    if (this.expected !== undefined) json.expected = this.expected;
    if (this.actual !== undefined) json.actual = this.actual;
    return json;
  }
}

// ---------------------------------------------------------------------------
// External Service Error
// ---------------------------------------------------------------------------

export interface ExternalServiceErrorOptions {
  statusCode?: number;
  retryable?: boolean;
}

export class ExternalServiceError extends PipelineError {
  readonly code: PipelineErrorCode;
  readonly service: string;
  readonly statusCode?: number;
  readonly retryable: boolean;

  constructor(
    code: PipelineErrorCode,
    service: string,
    message: string,
    options?: ExternalServiceErrorOptions,
  ) {
    super(message);
    this.name = "ExternalServiceError";
    this.code = code;
    this.service = service;
    this.statusCode = options?.statusCode;
    this.retryable = options?.retryable ?? isRetryableCode(code);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      service: this.service,
      statusCode: this.statusCode,
      retryable: this.retryable,
    };
  }
}

// ---------------------------------------------------------------------------
// Asset Not Found Error
// ---------------------------------------------------------------------------

export class AssetNotFoundError extends PipelineError {
  readonly code: PipelineErrorCode;
  readonly assetKey: string;
  readonly assetType: string;

  constructor(
    code: PipelineErrorCode,
    assetKey: string,
    assetType: string,
    message: string,
  ) {
    super(message);
    this.name = "AssetNotFoundError";
    this.code = code;
    this.assetKey = assetKey;
    this.assetType = assetType;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      assetKey: this.assetKey,
      assetType: this.assetType,
    };
  }
}

// ---------------------------------------------------------------------------
// Render Error
// ---------------------------------------------------------------------------

const STDERR_MAX_LENGTH = 2000;

export interface RenderErrorOptions {
  exitCode?: number;
  stderr?: string;
}

export class RenderError extends PipelineError {
  readonly code: PipelineErrorCode;
  readonly engine: "FFMPEG" | "REMOTION";
  readonly exitCode?: number;
  readonly stderr?: string;

  constructor(
    code: PipelineErrorCode,
    engine: "FFMPEG" | "REMOTION",
    message: string,
    options?: RenderErrorOptions,
  ) {
    super(message);
    this.name = "RenderError";
    this.code = code;
    this.engine = engine;
    this.exitCode = options?.exitCode;
    this.stderr = options?.stderr;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      engine: this.engine,
      exitCode: this.exitCode,
      stderr:
        this.stderr !== undefined && this.stderr.length > STDERR_MAX_LENGTH
          ? this.stderr.slice(0, STDERR_MAX_LENGTH)
          : this.stderr,
    };
  }
}

// ---------------------------------------------------------------------------
// Missing Queue Error
// ---------------------------------------------------------------------------

export class MissingQueueError extends PipelineError {
  readonly code = PipelineErrorCode.MISSING_QUEUE;
  readonly queueName: string;
  readonly jobId: string;
  readonly status: string;

  constructor(queueName: string, jobId: string, status: string) {
    super(
      `Required queue ${queueName} not available for job ${jobId} transitioning to ${status}`,
    );
    this.name = "MissingQueueError";
    this.queueName = queueName;
    this.jobId = jobId;
    this.status = status;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      queueName: this.queueName,
      jobId: this.jobId,
      status: this.status,
    };
  }
}

// ---------------------------------------------------------------------------
// Configuration Error
// ---------------------------------------------------------------------------

export class ConfigurationError extends PipelineError {
  readonly code = PipelineErrorCode.INVALID_CONFIGURATION;
  readonly configKey: string;
  readonly environment: string;

  constructor(configKey: string, environment: string) {
    super(
      `Configuration error: ${configKey} is missing or invalid in ${environment} environment`,
    );
    this.name = "ConfigurationError";
    this.configKey = configKey;
    this.environment = environment;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      configKey: this.configKey,
      environment: this.environment,
    };
  }
}

// ---------------------------------------------------------------------------
// Validation Error
// ---------------------------------------------------------------------------

export class ValidationError extends PipelineError {
  readonly code: PipelineErrorCode;
  readonly field?: string;
  readonly value?: unknown;

  constructor(
    code: PipelineErrorCode,
    message: string,
    field?: string,
    value?: unknown,
  ) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
    this.field = field;
    this.value = value;
  }

  toJSON(): Record<string, unknown> {
    const json: Record<string, unknown> = {
      name: this.name,
      code: this.code,
      message: this.message,
    };
    if (this.field !== undefined) json.field = this.field;
    if (this.value !== undefined) json.value = this.value;
    return json;
  }
}
