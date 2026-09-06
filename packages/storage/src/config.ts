import { readFileSync } from "node:fs";
import {
  DEFAULT_ROOT_FOLDER_NAME,
  DEFAULT_TUTORIALS_FOLDER_NAME,
  DEFAULT_CLIPFORGE_ROOT_FOLDER_NAME,
  DEFAULT_COMPARISONS_FOLDER_NAME,
  DEFAULT_FORMAT_ROOT_FOLDERS,
} from "./folder-scheme.js";

/**
 * Storage configuration.
 *
 * Read straight from `process.env` rather than `@repo/config` on purpose:
 * this package must be importable from hub-web (Next.js), the orchestrator,
 * and a standalone script, and `@repo/config` throws at import time when a
 * *required* var is missing. Storage is optional infrastructure — it must
 * never take down a process just by being unconfigured.
 *
 * OFF BY DEFAULT. `STORAGE_DRIVE_ENABLED=true` is required to do anything.
 *
 * Auth is OAuth-refresh-token ONLY. A service account has no storage quota
 * against a *consumer* My Drive (it fails with storageQuotaExceeded), and this
 * archive is explicitly Konrad's consumer account — so the service-account
 * mode that 0.1 shipped was a trap and was removed (GD-0f).
 */

export interface DriveAuthConfig {
  mode: "oauth_refresh_token";
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface DriveConfig {
  auth: DriveAuthConfig;
  rootFolderName: string;
  /** Top-level folder for tutorial archives (kept out of the content tree). */
  tutorialsFolderName: string;
  /** Wholly separate root for Clip Forge — never nested in the content root. */
  clipForgeRootFolderName: string;
  /**
   * Per-format Drive root overrides, keyed by `content_jobs.format`. Formats
   * absent from this map land in `rootFolderName`. Built from
   * `DEFAULT_FORMAT_ROOT_FOLDERS` plus env overrides.
   */
  formatRootFolderNames: Readonly<Record<string, string>>;
  /** Pre-existing folder id to use as the root instead of creating one. */
  rootFolderId?: string;
  requestsPerSecond: number;
  burst: number;
  /** Resumable chunk size in bytes. MUST be a multiple of 256 KiB. */
  chunkSizeBytes: number;
  maxAttempts: number;
  /** Skip files bigger than this (guard against a runaway artefact). */
  maxFileBytes: number;
  /**
   * Daily upload budget in bytes, shared across all subsystems (one Drive
   * account, one 750 GB/day ceiling). Default 500 GB leaves headroom for
   * Konrad's manual use. When exhausted the scanner pauses visibly.
   */
  dailyByteBudget: number;
}

export type StorageConfigResult =
  { enabled: true; drive: DriveConfig } | { enabled: false; reason: string };

const KIB_256 = 256 * 1024;
const GIB = 1024 * 1024 * 1024;

export type StorageEnv = Record<string, string | undefined>;

function readInt(env: StorageEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function readStr(env: StorageEnv, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Read a secret from a file path env var, trimmed. Returns undefined when the
 * var is unset; returns an error string when the var IS set but the file can't
 * be read — a misconfiguration we want surfaced, not silently ignored.
 */
function readSecretFile(
  env: StorageEnv,
  name: string,
): string | undefined | { error: string } {
  const path = readStr(env, name);
  if (path === undefined) return undefined;
  try {
    const text = readFileSync(path, "utf8").trim();
    return text === "" ? { error: `${name} points at an empty file` } : text;
  } catch (err) {
    return {
      error: `${name} could not be read: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

interface OAuthClientJson {
  web?: { client_id?: string; client_secret?: string };
  installed?: { client_id?: string; client_secret?: string };
  client_id?: string;
  client_secret?: string;
}

/**
 * Extract client_id / client_secret from a Google OAuth client JSON. Handles
 * both the `web` and `installed` (Desktop app) shapes, and a flat shape. Never
 * prints or returns the secret except inside the returned struct.
 */
function parseOAuthClientJson(
  raw: string,
): { clientId: string; clientSecret: string } | { error: string } {
  let json: OAuthClientJson;
  try {
    json = JSON.parse(raw) as OAuthClientJson;
  } catch (err) {
    return {
      error: `GOOGLE_OAUTH_CLIENT_SECRET_FILE is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  const node = json.web ?? json.installed ?? json;
  const clientId = node.client_id;
  const clientSecret = node.client_secret;
  if (typeof clientId !== "string" || typeof clientSecret !== "string") {
    return {
      error:
        "GOOGLE_OAUTH_CLIENT_SECRET_FILE is missing client_id/client_secret " +
        "(looked at .web, .installed, and top level)",
    };
  }
  return { clientId, clientSecret };
}

/**
 * Resolve OAuth credentials. Precedence:
 *   1. GOOGLE_DRIVE_CLIENT_ID / _SECRET / _REFRESH_TOKEN (explicit envs)
 *   2. GOOGLE_OAUTH_CLIENT_SECRET_FILE (client JSON) +
 *      GOOGLE_DRIVE_REFRESH_TOKEN_FILE / _REFRESH_TOKEN
 *
 * The file-based path is what the supplied credentials use: `.env` already has
 * GOOGLE_OAUTH_CLIENT_SECRET_FILE, and the loopback consent helper writes the
 * refresh token to a gitignored file.
 */
function resolveAuth(env: StorageEnv): DriveAuthConfig | { error: string } {
  let clientId = readStr(env, "GOOGLE_DRIVE_CLIENT_ID");
  let clientSecret = readStr(env, "GOOGLE_DRIVE_CLIENT_SECRET");

  if (clientId === undefined || clientSecret === undefined) {
    const fileRaw = readSecretFile(env, "GOOGLE_OAUTH_CLIENT_SECRET_FILE");
    if (typeof fileRaw === "object" && fileRaw !== null && "error" in fileRaw) {
      return fileRaw;
    }
    if (typeof fileRaw === "string") {
      const parsed = parseOAuthClientJson(fileRaw);
      if ("error" in parsed) return parsed;
      clientId = clientId ?? parsed.clientId;
      clientSecret = clientSecret ?? parsed.clientSecret;
    }
  }

  let refreshToken = readStr(env, "GOOGLE_DRIVE_REFRESH_TOKEN");
  if (refreshToken === undefined) {
    const fileTok = readSecretFile(env, "GOOGLE_DRIVE_REFRESH_TOKEN_FILE");
    if (typeof fileTok === "object" && fileTok !== null && "error" in fileTok) {
      return fileTok;
    }
    if (typeof fileTok === "string") refreshToken = fileTok;
  }

  if (
    clientId !== undefined &&
    clientSecret !== undefined &&
    refreshToken !== undefined
  ) {
    return {
      mode: "oauth_refresh_token",
      clientId,
      clientSecret,
      refreshToken,
    };
  }

  const missing = [
    clientId === undefined
      ? "client id (GOOGLE_OAUTH_CLIENT_SECRET_FILE)"
      : null,
    clientSecret === undefined
      ? "client secret (GOOGLE_OAUTH_CLIENT_SECRET_FILE)"
      : null,
    refreshToken === undefined
      ? "refresh token (GOOGLE_DRIVE_REFRESH_TOKEN_FILE — run scripts/drive-authorize.mjs)"
      : null,
  ].filter((x): x is string => x !== null);

  return {
    error: `Google Drive OAuth is incomplete: missing ${missing.join(", ")}`,
  };
}

/**
 * Per-format Drive roots. Starts from the compiled-in defaults (currently just
 * TECH_COMPARISON -> `_Comparisons`) and lets the operator retarget any format
 * without a deploy:
 *
 *   GOOGLE_DRIVE_COMPARISONS_FOLDER_NAME=Comparisons
 *   GOOGLE_DRIVE_FORMAT_ROOTS=RANKING=_Rankings,DRAMA=_Drama
 *
 * A malformed GOOGLE_DRIVE_FORMAT_ROOTS pair is ignored rather than throwing —
 * storage must never take down a host process over cosmetic config.
 */
function resolveFormatRootFolders(
  env: StorageEnv,
): Readonly<Record<string, string>> {
  const map: Record<string, string> = { ...DEFAULT_FORMAT_ROOT_FOLDERS };

  const comparisons = readStr(env, "GOOGLE_DRIVE_COMPARISONS_FOLDER_NAME");
  map["TECH_COMPARISON"] = comparisons ?? DEFAULT_COMPARISONS_FOLDER_NAME;

  const extra = readStr(env, "GOOGLE_DRIVE_FORMAT_ROOTS");
  if (extra !== undefined) {
    for (const pair of extra.split(",")) {
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const format = pair.slice(0, eq).trim().toUpperCase();
      const folder = pair.slice(eq + 1).trim();
      if (format === "" || folder === "") continue;
      map[format] = folder;
    }
  }

  return Object.freeze(map);
}

/**
 * Resolve config from the environment. Never throws — an unconfigured or
 * misconfigured storage subsystem reports `enabled: false` with a reason that
 * gets logged and surfaced, it does not crash the host process.
 */
export function loadStorageConfig(
  env: StorageEnv = process.env,
): StorageConfigResult {
  if (env["STORAGE_DRIVE_ENABLED"] !== "true") {
    return {
      enabled: false,
      reason:
        "STORAGE_DRIVE_ENABLED is not 'true' (Drive upload is off by default)",
    };
  }

  const auth = resolveAuth(env);
  if ("error" in auth) {
    return { enabled: false, reason: auth.error };
  }

  const rawChunk = readInt(env, "STORAGE_DRIVE_CHUNK_BYTES", 8 * KIB_256 * 4); // 8 MiB
  // Google requires resumable chunks to be a multiple of 256 KiB (except the
  // last one). Round down rather than reject — a wrong value here would only
  // show up as a cryptic 400 half way through a 400 MB upload.
  const chunkSizeBytes = Math.max(
    KIB_256,
    Math.floor(rawChunk / KIB_256) * KIB_256,
  );

  const rootFolderId = readStr(env, "GOOGLE_DRIVE_ROOT_FOLDER_ID");

  return {
    enabled: true,
    drive: {
      auth,
      rootFolderName:
        readStr(env, "GOOGLE_DRIVE_ROOT_FOLDER_NAME") ??
        DEFAULT_ROOT_FOLDER_NAME,
      tutorialsFolderName:
        readStr(env, "GOOGLE_DRIVE_TUTORIALS_FOLDER_NAME") ??
        DEFAULT_TUTORIALS_FOLDER_NAME,
      clipForgeRootFolderName:
        readStr(env, "GOOGLE_DRIVE_CLIPFORGE_ROOT_FOLDER_NAME") ??
        DEFAULT_CLIPFORGE_ROOT_FOLDER_NAME,
      formatRootFolderNames: resolveFormatRootFolders(env),
      ...(rootFolderId !== undefined ? { rootFolderId } : {}),
      requestsPerSecond: readInt(env, "STORAGE_DRIVE_RPS", 4),
      burst: readInt(env, "STORAGE_DRIVE_BURST", 8),
      chunkSizeBytes,
      maxAttempts: readInt(env, "STORAGE_DRIVE_MAX_ATTEMPTS", 5),
      maxFileBytes: readInt(env, "STORAGE_DRIVE_MAX_FILE_BYTES", 20 * GIB),
      dailyByteBudget: readInt(
        env,
        "STORAGE_DRIVE_DAILY_BYTE_BUDGET",
        500 * GIB,
      ),
    },
  };
}
