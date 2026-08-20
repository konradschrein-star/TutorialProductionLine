import { EnvSchema, type Env } from "./env-schema.js";
import { existsSync, accessSync, constants as fsConstants } from "fs";

/**
 * Configuration singleton
 *
 * Boot-time validation using Zod schemas with fail-fast design.
 * If any required variable is missing or invalid, the system throws
 * a descriptive error and refuses to start. No partial boot states.
 *
 * Usage:
 * ```typescript
 * // At application boot (in main entry point):
 * import { loadConfig } from "@repo/config";
 * loadConfig(); // Validates and caches config, throws on error
 *
 * // Later in application code:
 * import { getConfig } from "@repo/config";
 * const config = getConfig();
 * console.log(config.DATABASE_URL);
 * ```
 */

let cachedConfig: Env | null = null;

/**
 * Load and validate environment configuration
 *
 * Uses .safeParse() to collect ALL validation errors at once,
 * then formats them into a single descriptive message listing
 * all missing/invalid variables before throwing.
 *
 * Call this once at application boot.
 *
 * @throws {Error} If validation fails (lists all errors at once)
 */
export function loadConfig(): Env {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    // Collect all validation errors and format them clearly
    const errors = result.error.errors;
    const errorMessages = errors.map((err) => {
      const path = err.path.join(".");
      return `  - ${path}: ${err.message}`;
    });

    const errorSummary = [
      "❌ Environment validation failed:",
      "",
      ...errorMessages,
      "",
      "Required environment variables:",
      "  - DATABASE_URL (PostgreSQL connection string starting with postgresql://)",
      "  - REDIS_URL (Redis connection string starting with redis://)",
      "  - SECRETS_ENCRYPTION_KEY (base64, 32 bytes — unlocks encrypted_secrets)",
      "  - ELEVENLABS_API_KEY, AI33_API_KEY (+ optional AI33_API_KEY_2 for quota failover)",
      "  - LOCAL_MEDIA_ROOT (absolute path for archived videos, e.g., /opt/content-forge/media)",
      "  - NODE_ENV (development | production | test, default: development)",
      "  - PORT (number, default: 3000)",
      "  - LOG_LEVEL (optional): debug | info | warn | error (default: info)",
      "",
      "Setup guide:",
      "  1. Ensure LOCAL_MEDIA_ROOT directory exists: mkdir -p /opt/content-forge/media",
      "  2. Make sure it's readable and writable: chmod 755 /opt/content-forge/media",
      "  3. Set all API keys in .env file",
      "  4. Restart the application",
    ].join("\n");

    throw new Error(errorSummary);
  }

  // Post-parse validation for LOCAL_MEDIA_ROOT
  const config = result.data;

  // Validate LOCAL_MEDIA_ROOT directory exists and is accessible
  if (!existsSync(config.LOCAL_MEDIA_ROOT)) {
    throw new Error(
      `❌ LOCAL_MEDIA_ROOT directory does not exist: ${config.LOCAL_MEDIA_ROOT}\n\n` +
        `To fix this, create the directory:\n` +
        `  mkdir -p "${config.LOCAL_MEDIA_ROOT}"\n` +
        `  chmod 755 "${config.LOCAL_MEDIA_ROOT}"\n\n` +
        `Then restart the application.`,
    );
  }

  // Validate LOCAL_MEDIA_ROOT is readable and writable
  try {
    accessSync(config.LOCAL_MEDIA_ROOT, fsConstants.R_OK | fsConstants.W_OK);
  } catch {
    throw new Error(
      `❌ LOCAL_MEDIA_ROOT directory is not readable or writable: ${config.LOCAL_MEDIA_ROOT}\n\n` +
        `Fix permissions with:\n` +
        `  chmod 755 "${config.LOCAL_MEDIA_ROOT}"\n\n` +
        `Then restart the application.`,
    );
  }

  cachedConfig = config;
  return cachedConfig;
}

/**
 * Get cached configuration
 *
 * @throws {Error} If loadConfig() has not been called
 */
export function getConfig(): Env {
  if (!cachedConfig) {
    throw new Error(
      "Configuration not loaded. Call loadConfig() at application boot before using getConfig().",
    );
  }
  return cachedConfig;
}

/**
 * Reset cached configuration (for testing only)
 * @internal
 */
export function resetConfig(): void {
  cachedConfig = null;
}

// Re-export types
export type { Env } from "./env-schema.js";

// Gemini free-tier guard (§2.3) — owns the key; the only sanctioned key reader.
/**
 * The raw schema. Exported so consumers can derive a complete Env from it
 * (schema defaults + their own placeholders) instead of hand-maintaining a
 * parallel literal that silently rots every time a var is added — which is
 * exactly what happened to hub-web's build-time mockConfig.
 */
export { EnvSchema } from "./env-schema.js";

export {
  GEMINI_FREE_TIER_MODELS,
  assertGeminiFreeTierModel,
  isGeminiFreeTierModel,
  geminiFreeTierKey,
  type GeminiFreeTierModel,
} from "./gemini-free-tier.js";

export const CONFIG_PACKAGE_VERSION = "0.1.0";

/**
 * Check if running in test-agent mode
 *
 * Test-agent mode enables:
 * - Auto-skip QC stages
 * - Verbose logging
 * - Reduced watchdog timeouts (fail fast)
 * - Relaxed validation rules
 */
export function isTestAgentMode(): boolean {
  const config = getConfig();
  return config.NODE_ENV === "test-agent";
}
