import type { DriveAuthConfig } from "../config.js";
import {
  classifyHttpError,
  classifyThrown,
  storageError,
  type StorageError,
} from "../errors.js";
import type { Attempt } from "../retry.js";

/**
 * Access-token acquisition for Google Drive.
 *
 * OAuth refresh-token flow only (a service account has no quota against a
 * consumer My Drive). The refresh token is exchanged at the OAuth2 token
 * endpoint for a short-lived bearer token, cached until just before expiry.
 *
 * Scope is `drive.file` — the app can only see and modify files it created
 * itself. It cannot read, list, or delete anything else in the user's Drive.
 * That is a deliberate blast-radius choice: this thing runs unattended.
 */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
/** Refresh this long before actual expiry, so a long upload never dies mid-chunk. */
const EXPIRY_SKEW_MS = 120_000;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

export interface AccessToken {
  token: string;
  expiresAtMs: number;
}

export type FetchLike = typeof fetch;

function tokenRequestBody(auth: DriveAuthConfig): URLSearchParams {
  return new URLSearchParams({
    client_id: auth.clientId,
    client_secret: auth.clientSecret,
    refresh_token: auth.refreshToken,
    grant_type: "refresh_token",
  });
}

/**
 * Caches an access token and refreshes it on demand.
 *
 * Concurrent callers share a single in-flight refresh — otherwise ten parallel
 * chunk uploads would each mint their own token and burn quota.
 */
export class DriveTokenProvider {
  private cached: AccessToken | null = null;
  private inFlight: Promise<Attempt<AccessToken>> | null = null;

  constructor(
    private readonly auth: DriveAuthConfig,
    private readonly deps: { fetch?: FetchLike; now?: () => number } = {},
  ) {}

  private get fetchImpl(): FetchLike {
    return this.deps.fetch ?? globalThis.fetch;
  }

  private get nowMs(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** Drop the cached token — call this after a 401 so the next try re-mints. */
  invalidate(): void {
    this.cached = null;
  }

  async getToken(): Promise<Attempt<AccessToken>> {
    const now = this.nowMs;
    if (
      this.cached !== null &&
      this.cached.expiresAtMs - EXPIRY_SKEW_MS > now
    ) {
      return { ok: true, value: this.cached };
    }
    if (this.inFlight !== null) return this.inFlight;

    const promise = this.refresh();
    this.inFlight = promise;
    try {
      return await promise;
    } finally {
      this.inFlight = null;
    }
  }

  private async refresh(): Promise<Attempt<AccessToken>> {
    const body = tokenRequestBody(this.auth);

    let response: Response;
    try {
      response = await this.fetchImpl(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    } catch (err) {
      return { ok: false, error: classifyThrown(err) };
    }

    const text = await response.text();

    if (!response.ok) {
      const classified = classifyHttpError({
        status: response.status,
        bodyText: text,
        retryAfterHeader: response.headers.get("retry-after"),
        now: this.nowMs,
      });
      // An expired/revoked refresh token comes back as 400 invalid_grant.
      // Classify it as `auth` so we stop retrying and surface it loudly.
      const error: StorageError = text.includes("invalid_grant")
        ? storageError(
            "auth",
            "Google refused the refresh token (invalid_grant) - it was revoked, expired, or the OAuth client changed. Re-run the consent flow.",
            { status: response.status },
          )
        : classified;
      return { ok: false, error };
    }

    let parsed: TokenResponse;
    try {
      parsed = JSON.parse(text) as TokenResponse;
    } catch {
      return {
        ok: false,
        error: storageError("unknown", "token endpoint returned non-JSON"),
      };
    }

    if (typeof parsed.access_token !== "string") {
      return {
        ok: false,
        error: storageError("auth", "token response had no access_token"),
      };
    }

    const expiresInSec =
      typeof parsed.expires_in === "number" ? parsed.expires_in : 3600;
    const token: AccessToken = {
      token: parsed.access_token,
      expiresAtMs: this.nowMs + expiresInSec * 1000,
    };
    this.cached = token;
    return { ok: true, value: token };
  }
}
