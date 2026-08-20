import { loadConfig, getConfig, EnvSchema, type Env } from "@repo/config";
import { join, normalize } from "node:path";
import { ConfigurationError } from "@repo/domain";

/**
 * Hub Web configuration wrapper
 * Re-exports the validated configuration from @repo/config
 *
 * All environment variables are validated at boot time via Zod schemas.
 * Required vars: DATABASE_URL, REDIS_URL, API keys, NODE_ENV
 *
 * During build time, returns mock config to allow Next.js build to proceed.
 */

let configLoaded = false;
let configCache: Env | null = null;

/**
 * Mock config for build time (when env validation fails).
 *
 * DERIVED from EnvSchema rather than hand-written. Only the vars that have no
 * schema default are listed here; everything else — every URL, concurrency cap
 * and feature flag — comes from the schema's own defaults. A hand-maintained
 * literal drifted the moment anyone added a var (it was missing 10 fields,
 * including all four media-backend base URLs, and broke hub-web's typecheck).
 * Deriving it means adding a var to the schema can never break this file again.
 */
const mockConfig: Env = EnvSchema.parse({
  DATABASE_URL: "postgresql://localhost:5432/mock",
  REDIS_URL: "redis://localhost:6379",
  // Build-time-only placeholder (32-byte base64). getHubConfig() throws in
  // production runtime, so this can never unlock real ciphertext on a server.
  SECRETS_ENCRYPTION_KEY: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
  ELEVENLABS_API_KEY: "mock",
  ANTHROPIC_API_KEY: "mock",
  AI33_API_KEY: "mock",
  DEFAULT_VOICE_EN: "mock-voice-en",
  DEFAULT_VOICE_DE: "mock-voice-de",
  REMOTION_SERVE_URL: "http://localhost:8000",
  // Must be >= 32 chars: the old hand-written literal was 30 and would have
  // FAILED EnvSchema — the bare `as Env` cast simply never validated it.
  JWT_SECRET: "mock-jwt-secret-for-build-time-only-not-a-real-secret",
  NODE_ENV: "development",
  LOCAL_MEDIA_ROOT: "/opt/content-forge/media",
});

// Export getter function that loads config on first access
export function getHubConfig(): Env {
  if (configLoaded && configCache) {
    return configCache;
  }

  try {
    loadConfig();
    configLoaded = true;
    configCache = getConfig();
    return configCache;
  } catch (error) {
    // NEXT_PHASE is set to 'phase-production-build' during `next build`.
    // NODE_ENV=production during both build and runtime, so we use NEXT_PHASE
    // to distinguish: throw only when actually running as a server, not building.
    const isBuildPhase =
      process.env.NEXT_PHASE === "phase-production-build" ||
      process.env.NEXT_PHASE === "phase-export";
    const isProductionRuntime =
      process.env.NODE_ENV === "production" && !isBuildPhase;

    if (isProductionRuntime) {
      console.error(
        "[config] FATAL: Configuration failed to load in production environment",
      );
      throw new ConfigurationError("environment variables", "production");
    }

    // Build time or development - allow mock config
    console.warn(
      "[config] Using mock config (build time or development):",
      error instanceof Error ? error.message : String(error),
    );
    configLoaded = true;
    configCache = mockConfig;
    return mockConfig;
  }
}

/**
 * Build a local file path for a job asset.
 * Convention: {LOCAL_MEDIA_ROOT}/{channel_id}/{job_id}/{asset_type}.{ext}
 *
 * IMPORTANT: Returns a normalized absolute path using node:path to ensure
 * cross-platform compatibility (prevents Windows path bugs).
 */
export function buildAssetKey(
  channelId: string,
  jobId: string,
  assetType: string,
  extension: string,
): string {
  const config = getHubConfig();
  return normalize(
    join(
      config.LOCAL_MEDIA_ROOT,
      channelId,
      jobId,
      `${assetType}.${extension}`,
    ),
  );
}
