import { z } from "zod";
import { isAbsolute } from "path";

/**
 * Environment Variable Schema
 *
 * Boot-time validation for all required environment variables.
 * System refuses to start on missing or invalid credentials.
 *
 * Required variables:
 * - DATABASE_URL: PostgreSQL connection string
 * - REDIS_URL: Redis connection string
 * - SECRETS_ENCRYPTION_KEY: AES-256-GCM master key (base64, 32 bytes) for encrypted_secrets
 * - ELEVENLABS_API_KEY: ElevenLabs API key for TTS
 * - AI33_API_KEY: AI33 unified gateway for TTS and image generation
 * - LOCAL_MEDIA_ROOT: Local filesystem root for archived final videos (must be absolute path)
 * (HEYGEN removed §2.1; ANTHROPIC/GEMINI now optional secrets-area names.)
 * - NODE_ENV: Environment (development | production | test)
 * - PORT: Server port number
 *
 * Validation strategy:
 * - EnvSchema uses Zod .refine() for LOCAL_MEDIA_ROOT path validation
 * - loadConfig() uses .safeParse() to collect ALL errors at once
 * - Post-parse checks validate directory existence and permissions
 * - Formats them into a single descriptive message listing all missing/invalid variables
 * - Throws with full error context
 * - No partial boot states - fail fast and clearly
 */
export const EnvSchema = z.object({
  // === Database ===
  DATABASE_URL: z
    .string()
    .url()
    .startsWith(
      "postgresql://",
      "DATABASE_URL must be a PostgreSQL connection string",
    )
    .describe("PostgreSQL connection string"),

  // === Redis ===
  REDIS_URL: z
    .string()
    .url()
    .startsWith("redis://", "REDIS_URL must be a Redis connection string")
    .describe("Redis connection string"),

  // === Secrets master key (H1) ===
  // Unlocks encrypted_secrets (the ONE secrets area). Making the whole platform
  // depend on this key without booting on it is unacceptable — a missing/rotated
  // key must fail at boot, not at 3am inside a job. Must base64-decode to 32 bytes.
  SECRETS_ENCRYPTION_KEY: z
    .string()
    .min(1)
    .refine(
      (v) => {
        try {
          return Buffer.from(v, "base64").length === 32;
        } catch {
          return false;
        }
      },
      {
        message:
          "SECRETS_ENCRYPTION_KEY must base64-decode to exactly 32 bytes",
      },
    )
    .describe(
      "AES-256-GCM master key for encrypted_secrets (base64, 32 bytes)",
    ),

  // === External AI Services ===
  // HeyGen ABOLISHED (§2.1) — provider surface removed entirely; the avatar
  // asset-upload slot (unfortunately named after it) survives elsewhere.
  ELEVENLABS_API_KEY: z.string().min(1).describe("ElevenLabs API key (TTS)"),
  // Anthropic: KEEP the key but wire it in NOWHERE (§2.1, "expensive as fuck").
  // Optional so a provider we deliberately never route to cannot block boot.
  ANTHROPIC_API_KEY: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Anthropic API key (present in registry, deliberately not routed)",
    ),
  // Gemini: FREE-TIER ONLY (§2.3). Obtained only via geminiFreeTierKey(model).
  // Optional so it is a secrets-area name, not a boot-blocking requirement.
  GEMINI_API_KEY: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Google Gemini free-tier key (LLM/TTS fallback only — never paid)",
    ),
  AI33_API_KEY: z
    .string()
    .min(1)
    .describe("AI33 API key (unified AI gateway for TTS and images)"),
  AI33_API_KEY_2: z
    .string()
    .min(1)
    .optional()
    .describe("AI33 secondary API key (backup account for quota failover)"),
  DEFAULT_VOICE_EN: z
    .string()
    .min(1)
    .describe("Default TTS voice UUID (tts_voices row ID) for English content"),
  DEFAULT_VOICE_DE: z
    .string()
    .min(1)
    .describe(
      "Default TTS voice UUID (tts_voices row ID) for German content. Required if German content formats are enabled.",
    ),
  GOOGLE_IMAGEN_API_KEY: z
    .string()
    .min(1)
    .optional()
    .describe("Google Cloud API key for Imagen 3 image generation"),

  // === VEO Fleet Orchestrator (PRIMARY media generation backend) ===
  // The operator's VEO wrapper as it exists today: a durable job queue on the
  // VPS (/opt/veo-fleet, :8091) that VM-side workers pull from. It fronts the
  // same VUP capacity the legacy VUP_API_URL used to address directly, which
  // is why that direct :5210 path can read dead while generation is healthy.
  VEO_FLEET_API_URL: z
    .string()
    .url()
    .default("http://127.0.0.1:8091")
    .describe(
      "VEO Fleet Orchestrator base URL. Bound to 0.0.0.0:8091 on the VPS but firewalled from the public internet — use the loopback address.",
    ),
  VEO_FLEET_API_KEY: z
    .string()
    .min(1)
    .optional()
    .describe(
      "VEO Fleet Orchestrator key (x-api-key header). Unset = gateway skips it.",
    ),

  // === VeoForge (the operator's own VEO tool) ===
  VEOFORGE_API_URL: z
    .string()
    .url()
    .default("http://127.0.0.1:5300")
    .describe("VeoForge base URL (systemd unit `veoforge`)."),
  VEOFORGE_API_KEY: z
    .string()
    .min(1)
    .optional()
    .describe(
      "VeoForge token (Authorization: Bearer — NOT x-api-key). Unset = gateway skips it.",
    ),
  VEOFORGE_IMAGES_ENABLED: z
    .string()
    .optional()
    .describe(
      "Set to '1' only once an image-entitled pooled lease exists. Until then every VeoForge image job returns HTTP 401 UNAUTHENTICATED from the whisk backend, so the gateway does not route images there.",
    ),

  // === VUP / VEO Unlimited Pro (legacy direct-to-VM path, now a fallback) ===
  // The unified media gateway (worker-orchestrator utils/media-gateway/)
  // routes all image + video generation here first, health-gated, with
  // forge-api then fastgen as fallbacks. Runs on the Windows VM — from the
  // VPS itself use the VM's internal address (192.168.122.93:5210), not
  // the public DNAT host:port (PREROUTING-only, doesn't apply to
  // VPS-originated traffic).
  VUP_API_URL: z
    .string()
    .url()
    .default("http://65.108.6.149:5210")
    .describe(
      "VUP (VEO Unlimited Pro) wrapper base URL. On the VPS, set to http://192.168.122.93:5210.",
    ),
  VUP_API_KEY: z
    .string()
    .min(1)
    .optional()
    .describe(
      "VUP API key (x-api-key header). Unset = gateway skips VUP, routes to forge/fastgen.",
    ),

  // === forge-api (VEO Studio — SECONDARY media generation backend) ===
  FORGE_API_URL: z
    .string()
    .url()
    .default("https://forge-api.schreinercontentsystems.com")
    .describe("forge-api base URL (self-hosted VEO Studio wrapper)"),
  FORGE_API_KEY: z
    .string()
    .min(1)
    .optional()
    .describe(
      "forge-api key (x-api-key header). Unset = gateway routes to fastgen only.",
    ),

  // === fast-gen.ai (FALLBACK media backend — plan expires early July 2026) ===
  FASTGEN_API_URL: z
    .string()
    .url()
    .default("https://api.fast-gen.ai")
    .describe("fast-gen.ai API base URL"),
  FASTGEN_STORAGE_URL: z
    .string()
    .url()
    .default("https://storage.fast-gen.ai")
    .describe("fast-gen.ai storage server base URL (for file:hash downloads)"),
  FASTGEN_API_KEY: z
    .string()
    .min(1)
    .optional()
    .describe(
      "fast-gen.ai API key (X-API-Key header). Optional — the plan expires early July 2026.",
    ),
  NIM_API_KEY: z
    .string()
    .min(1)
    .optional()
    .describe("NVIDIA NIM API key (stepfun-ai/step-3.7-flash for prompt gen)"),

  // === LLM router (utils/llm-client.ts) ===
  DEEPSEEK_API_KEY: z
    .string()
    .min(1)
    .optional()
    .describe("DeepSeek API key — standard LLM tier + clip-forge detection"),
  LMSTUDIO_URL: z
    .string()
    .url()
    .optional()
    .describe("LM Studio server base URL (local LLM tier), default :1234"),
  LMSTUDIO_MODEL: z
    .string()
    .optional()
    .describe("LM Studio model name for the local LLM tier"),

  // Legacy names for the same fast-gen.ai service — still read by
  // gemini-pool-client's LLM fallback path. Remove with the LLM router.
  MEDIA_GEN_API_URL: z
    .string()
    .url()
    .default("https://api.fast-gen.ai")
    .describe("Legacy alias for FASTGEN_API_URL (gemini-pool LLM fallback)"),
  MEDIA_GEN_API_KEY: z
    .string()
    .min(1)
    .optional()
    .describe("Legacy alias for FASTGEN_API_KEY"),

  // === Ollama (Local LLM for image prompts) ===
  OLLAMA_URL: z
    .string()
    .url()
    .default("http://localhost:11434")
    .describe("Ollama API base URL for local LLM inference"),
  OLLAMA_MODEL: z
    .string()
    .default("gemma3:4b")
    .describe(
      "Ollama model name for text generation (e.g. gemma3:4b, llama3:8b)",
    ),

  // === Edge TTS (Free TTS for testing/development) ===
  EDGE_TTS_API_URL: z
    .string()
    .url()
    .optional()
    .describe(
      "Edge TTS API base URL (OpenAI-compatible). Optional - only for testing/development.",
    ),
  EDGE_TTS_API_KEY: z
    .string()
    .min(1)
    .optional()
    .describe("Edge TTS API key. Optional - only for testing/development."),

  // === Stock Media ===
  PEXELS_API_KEY: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Pexels API key for stock photo/video search (comparison hero images, clip library B-roll)",
    ),

  // === Remotion ===
  REMOTION_SERVE_URL: z
    .string()
    .refine(
      (val) => {
        try {
          const url = new URL(val);
          return ["http:", "https:", "file:"].includes(url.protocol);
        } catch {
          return false;
        }
      },
      { message: "REMOTION_SERVE_URL must be a valid HTTP(S) or file:// URL" },
    )
    .default("http://localhost:8000")
    .describe(
      "Remotion composition serve URL (dev server or bundle path). Dev: http://localhost:8000, Production: file:///opt/content-forge/apps/worker-render/remotion-bundle",
    ),

  // === Application ===
  NODE_ENV: z
    .enum(["development", "production", "test", "test-agent"])
    .default("development")
    .describe(
      "Node environment (use 'test-agent' for fast-fail agent testing with auto-skip QC)",
    ),

  PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive())
    .default("3000")
    .describe("Server port"),

  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"])
    .default("info")
    .describe("Logging level (debug | info | warn | error)"),

  // === Authentication ===
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters for security")
    .describe("JWT signing secret (generate with: openssl rand -base64 32)"),

  // === Local Storage (Tier 2 — finished video archive) ===
  LOCAL_MEDIA_ROOT: z
    .string()
    .min(1)
    .refine(
      (val) => isAbsolute(val),
      "LOCAL_MEDIA_ROOT must be an absolute path (starting with / on Unix or C:\\ on Windows)",
    )
    .default("/opt/content-forge/media")
    .describe(
      "Local filesystem root for archived final videos (Tier 2 storage). Must be an absolute path.",
    ),

  /**
   * Optional absolute path where fetched footage clips land. When unset,
   * defaults to `${LOCAL_MEDIA_ROOT}/footage`. All footage sources write here;
   * `requestFootage()` returns a `ref` relative to this dir.
   */
  FOOTAGE_DATA_DIR: z
    .string()
    .optional()
    .describe(
      "Optional absolute path where fetched footage clips land. Defaults to ${LOCAL_MEDIA_ROOT}/footage when unset.",
    ),

  /**
   * Global concurrency cap for footage downloads across all sources.
   * Lower numbers protect yt-dlp / Pexels from rate-limit shaping.
   */
  FOOTAGE_MAX_CONCURRENT: z.coerce
    .number()
    .int()
    .positive()
    .default(4)
    .describe(
      "Global concurrency cap for footage downloads across all sources (default: 4)",
    ),

  // === GPU Ken Burns Renderer ===
  KENBURNS_GPU_ENABLED: z
    .enum(["auto", "true", "false"])
    .default("auto")
    .describe(
      "GPU Ken Burns renderer: auto-detect GPU, or force enable/disable (auto | true | false)",
    ),

  PYTHON_PATH: z
    .string()
    .default("python3")
    .describe("Python executable path for GPU renderer scripts"),

  // === Cloudflare R2 — REMOVED (§2.1 "not real") ===
  // R2 was never real: no S3 SDK is installed and all three "R2 clients" are
  // node:fs copies writing to the local filesystem. The four R2_* env vars had
  // zero process.env reads. Config surface deleted. NOTE: the r2_asset_manifest
  // DB columns are the live LOCAL-FS manifest and are renamed in a later,
  // separate migration — NOT here.

  // === AIOS / HCP interface ===
  // CF_API_TOKEN is the static bearer for /api/v1 machine callers
  // (cf-mcp-server, AIOS, smoke tests). When missing, only browser
  // sessions are accepted on /api/v1.
  CF_API_TOKEN: z
    .string()
    .min(16)
    .optional()
    .describe(
      "Static bearer token accepted by /api/v1. Generate with openssl rand -hex 32.",
    ),
  CF_API_TOKEN_LABEL: z
    .string()
    .optional()
    .describe("Friendly label for the CF_API_TOKEN, recorded on audit lines."),
  // CF_AIOS_TOKEN is the token CF's worker-orchestrator uses when
  // pushing events to HCP /cf/ingest/event. When missing, CF→HCP push
  // is silently disabled (HCP isn't reachable / not deployed).
  CF_AIOS_TOKEN: z
    .string()
    .min(16)
    .optional()
    .describe("Bearer token CF uses to authenticate to HCP /cf/ingest."),
  HCP_INGEST_URL: z
    .string()
    .url()
    .optional()
    .describe(
      "Base URL of the Hermes Control Plane, e.g. http://127.0.0.1:8650.",
    ),
});

export type Env = z.infer<typeof EnvSchema>;
