/**
 * @repo/cf-api — Content Forge API core.
 *
 * Pure server functions. No HTTP, no auth, no transport. Consumed by:
 *   - apps/hub-web /api/v1/* routes (browser + bearer-auth callers)
 *   - apps/cf-mcp-server (Hermes Workspace via MCP)
 *   - apps/worker-orchestrator (internal callers that need the same
 *     job-creation semantics as the HTTP surface)
 *
 * Every function takes a CfRuntime as its first arg and throws CfApiError
 * with a typed code on known failures. The HTTP layer maps codes to
 * statuses via errorCodeToHttpStatus.
 */
export { CfApiError, isCfApiError, errorCodeToHttpStatus } from "./errors.js";
export type { CfApiErrorCode } from "./errors.js";

export type { CfRuntime } from "./runtime.js";
export { noopLog } from "./runtime.js";

export type {
  CreatedJob,
  JobListItem,
  JobListFilter,
  JobArtifactKind,
} from "./types.js";
export { JobListFilterSchema } from "./types.js";

export * as jobs from "./jobs/index.js";
export * as drama from "./drama/index.js";
export * as formats from "./formats/index.js";
export * as channels from "./channels/index.js";
export { getHealth } from "./health.js";
