/**
 * Typed error class for cf-api. Caller (HTTP layer / MCP layer) maps
 * `code` to the right transport-level status.
 *
 * Codes follow the same vocabulary as HTTP semantics so the mapping is
 * trivial: BAD_REQUEST → 400, FORBIDDEN → 403, NOT_FOUND → 404,
 * CONFLICT → 409, FAILED_PRECONDITION → 412, INTERNAL → 500.
 */
export type CfApiErrorCode =
  | "BAD_REQUEST"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FAILED_PRECONDITION"
  | "INTERNAL";

export class CfApiError extends Error {
  readonly code: CfApiErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: CfApiErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CfApiError";
    this.code = code;
    this.details = details;
  }
}

export function isCfApiError(err: unknown): err is CfApiError {
  return err instanceof CfApiError;
}

export const errorCodeToHttpStatus: Record<CfApiErrorCode, number> = {
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FAILED_PRECONDITION: 412,
  INTERNAL: 500,
};
