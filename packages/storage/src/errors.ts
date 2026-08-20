/**
 * Error taxonomy for external storage (Google Drive).
 *
 * Every failure lands in exactly one of these kinds. `retryable` is a
 * property of the kind, not a guess at the call site — that keeps the retry
 * policy in one place and makes it unit-testable without a network.
 */

export type StorageErrorKind =
  /** 429, or 403 with reason rateLimitExceeded / userRateLimitExceeded. Back off. */
  | "rate_limited"
  /** 403 storageQuotaExceeded — the Drive is full. Retrying will never help. */
  | "quota_exceeded"
  /** 401 / invalid_grant / missing credentials. Needs human reconfiguration. */
  | "auth"
  /** 404 — parent folder or resumable session gone. */
  | "not_found"
  /** 5xx or 308-session errors. Retry. */
  | "server"
  /** fetch() threw, socket reset, DNS. Retry. */
  | "network"
  /** Other 4xx. Our request is wrong; retrying is pointless. */
  | "bad_request"
  /** Local filesystem problem (source file missing/unreadable). */
  | "local_file"
  /** Anything we could not classify. Treated as non-retryable on purpose. */
  | "unknown";

export interface StorageError {
  kind: StorageErrorKind;
  message: string;
  /** HTTP status, when the failure came from an HTTP response. */
  status?: number;
  /** Google's machine-readable `errors[0].reason`, when present. */
  reason?: string;
  /** Server-suggested wait, from a Retry-After header (milliseconds). */
  retryAfterMs?: number;
}

const RETRYABLE: ReadonlySet<StorageErrorKind> = new Set<StorageErrorKind>([
  "rate_limited",
  "server",
  "network",
]);

export function isRetryable(kind: StorageErrorKind): boolean {
  return RETRYABLE.has(kind);
}

export function storageError(
  kind: StorageErrorKind,
  message: string,
  extra: Omit<StorageError, "kind" | "message"> = {},
): StorageError {
  return { kind, message, ...extra };
}

/** Google's JSON error envelope, as much of it as we rely on. */
interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
  /** OAuth token endpoint uses a flat shape. */
  error_description?: string;
}

function parseErrorBody(body: string): GoogleErrorBody | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as GoogleErrorBody;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Retry-After may be seconds ("30") or an HTTP-date. Returns ms, or undefined
 * when absent/unparseable. `now` is injectable so the HTTP-date branch is
 * testable.
 */
export function parseRetryAfterMs(
  header: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (header === null || header === undefined) return undefined;
  const trimmed = header.trim();
  if (trimmed === "") return undefined;

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return undefined;
  const delta = asDate - now;
  return delta > 0 ? delta : 0;
}

/**
 * Classify an HTTP response from the Drive / OAuth API.
 *
 * Pure: takes the already-read body text and the header lookup result, so it
 * can be exercised without a network or a Response object.
 */
export function classifyHttpError(args: {
  status: number;
  bodyText: string;
  retryAfterHeader?: string | null;
  now?: number;
}): StorageError {
  const { status, bodyText } = args;
  const parsed = parseErrorBody(bodyText);
  const reason = parsed?.error?.errors?.[0]?.reason;
  const message =
    parsed?.error?.message ??
    parsed?.error_description ??
    (bodyText.length > 0 ? bodyText.slice(0, 500) : `HTTP ${status}`);
  const retryAfterMs = parseRetryAfterMs(args.retryAfterHeader, args.now);

  const base = { status, reason, retryAfterMs } as const;

  if (status === 401) {
    return storageError("auth", message, base);
  }

  if (status === 403) {
    // 403 is overloaded by Google: it is BOTH "slow down" and "you are out of
    // space". Treating them the same would either hammer a full Drive forever
    // or give up on a transient rate limit. Split them explicitly.
    if (reason === "storageQuotaExceeded" || reason === "quotaExceeded") {
      return storageError("quota_exceeded", message, base);
    }
    if (
      reason === "rateLimitExceeded" ||
      reason === "userRateLimitExceeded" ||
      reason === "dailyLimitExceeded" ||
      reason === "sharingRateLimitExceeded"
    ) {
      return storageError("rate_limited", message, base);
    }
    // A 403 with no reason at all is, in practice, almost always throttling.
    if (reason === undefined) {
      return storageError("rate_limited", message, base);
    }
    return storageError("auth", message, base);
  }

  if (status === 404) {
    return storageError("not_found", message, base);
  }

  if (status === 429) {
    return storageError("rate_limited", message, base);
  }

  if (status >= 500) {
    return storageError("server", message, base);
  }

  if (status >= 400) {
    return storageError("bad_request", message, base);
  }

  return storageError("unknown", message, base);
}

/** Classify a thrown value from fetch() / fs. */
export function classifyThrown(err: unknown): StorageError {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (
      code === "ENOENT" ||
      code === "EACCES" ||
      code === "EISDIR" ||
      code === "EPERM"
    ) {
      return storageError("local_file", `${code}: ${err.message}`);
    }
    return storageError("network", err.message);
  }
  return storageError("unknown", String(err));
}
