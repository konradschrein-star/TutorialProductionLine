/**
 * BUILT-IN PROVIDER CATALOG — the code-defined truth about what external
 * services this monorepo can talk to.
 *
 * Rules for this file:
 *   1. Every entry must correspond to a real call site in the codebase.
 *      `usedBy` lists the modules that actually call it. If a provider is
 *      no longer called, mark it `deprecated` — do not delete it, because
 *      the operator needs to see that the code still references a dead
 *      service (that is literally the problem this registry exists to fix).
 *   2. NEVER store credentials here. Only the NAME of the env var that
 *      holds one. Presence is computed at runtime from the environment.
 *   3. `probe: null` is an honest answer. A provider with no cheap, safe
 *      probe stays "unknown" forever and says why. Never fake a green.
 *
 * DB rows in `providers` are an OVERLAY on this catalog (enable flag,
 * concurrency cap, plan state, notes). The catalog is authoritative for
 * identity, capabilities, env var names, and probe definitions.
 *
 * Source audit: docs/PROVIDER_INVENTORY.md (2026-07-28).
 */

import type {
  CapabilityPolicy,
  ProviderDefinition,
  ProviderExpiry,
  RoutedCapability,
} from "./types.js";
import { ROUTED_CAPABILITIES } from "./types.js";

function numberish(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export const BUILT_IN_PROVIDERS: ProviderDefinition[] = [
  // ── Image / video ────────────────────────────────────────────────────────
  {
    key: "veo_fleet",
    displayName: "VEO Fleet Orchestrator",
    vendor: "self-hosted (VPS)",
    description:
      "The operator's VEO wrapper as it exists today, and the PRIMARY image + video backend since 2026-07-30. A durable FastAPI job queue on the VPS (/opt/veo-fleet, 0.0.0.0:8091): clients submit to /jobs/image or /jobs/video, VM-side workers PULL work via /bridge/claim and push results back, and the orchestrator stores the bytes itself and serves them from /files/{file_id}. VUP still does the generating, but behind the bridge — which is exactly why the legacy direct vup:5210 path reads dead while generation capacity is fine. Does t2v, i2v (`image`), first/end-frame (`start_image`+`end_image`) and MULTI-reference i2i (`reference_images` takes an array, unlike VUP's single ref). Supports Idempotency-Key on every submit endpoint.",
    capabilities: ["image", "video"],
    keyEnvVar: "VEO_FLEET_API_KEY",
    urlEnvVar: "VEO_FLEET_API_URL",
    concurrencyEnvVar: "VEO_FLEET_MAX_CONCURRENT",
    defaultBaseUrl: "http://127.0.0.1:8091",
    docsUrl: null,
    costTier: "free",
    planState: "self_hosted",
    defaultMaxConcurrent: 12,
    probe: {
      kind: "http",
      // /status, NOT /healthz. /healthz answers 200 whenever the FastAPI
      // process is up, INCLUDING with zero workers connected — a state in
      // which every submitted job sits `pending` forever. Worker liveness is
      // the only honest readiness signal.
      path: "/status",
      method: "GET",
      auth: "none",
      degradedAboveMs: 2000,
      timeoutMs: 8000,
      extractDetail: (body) => {
        if (typeof body !== "object" || body === null) return null;
        const b = body as Record<string, unknown>;
        const workers = b["workers"] as Record<string, unknown> | undefined;
        const capacity = b["capacity"] as Record<string, unknown> | undefined;
        const queue = b["queue"] as Record<string, unknown> | undefined;
        return {
          workers_online: numberish(workers?.["online"]),
          workers_total: numberish(workers?.["total"]),
          concurrent_max: numberish(capacity?.["concurrent_max"]),
          concurrent_now: numberish(capacity?.["concurrent_now"]),
          queue_pending: numberish(queue?.["pending"]),
          jobs_done: numberish(queue?.["done"]),
          jobs_error: numberish(queue?.["error"]),
        };
      },
      meaning:
        "Orchestrator is listening AND reports its worker/queue counts. Read workers_online: at 0, jobs are accepted but never claimed.",
    },
    usedBy: [
      "apps/worker-orchestrator/src/utils/media-gateway/veo-fleet-client.ts",
      "media-gateway: PRIMARY for image + video",
    ],
    hostProcess: "python: veo-fleet orchestrator (0.0.0.0:8091)",
    sortOrder: 5,
  },
  {
    key: "veoforge",
    displayName: "VeoForge",
    vendor: "self-hosted (VPS)",
    description:
      'The operator\'s own VEO tool. /opt/veoforge, systemd unit `veoforge`, uvicorn on 127.0.0.1:5300, public at veoforge.schreinercontentsystems.com. Auth is `Authorization: Bearer` — NOT the x-api-key scheme veo_fleet uses. Submit→poll: POST /generate (video) or POST /v1/jobs {mode}, GET /status/{id}, GET /result/{id}. Batch: count 1-20 coalesces into ONE upstream submit. Model tiers matter — `lite` is what harvested VUP-pool accounts are entitled to (they 403 on anything else), own accounts use `quality`, and a per-account Account.model OVERRIDES the requested tier. TWO traps: (1) a FAILED job keeps status:"queued" and only reports the failure via `error` + a frozen `updated`, so a naive poller burns its whole timeout; (2) throughput depends on a pool of harvested labs.google sessions that goes dry, and /health still answers ok:true in that state.',
    capabilities: ["image", "video"],
    keyEnvVar: "VEOFORGE_API_KEY",
    urlEnvVar: "VEOFORGE_API_URL",
    concurrencyEnvVar: "VEOFORGE_MAX_CONCURRENT",
    defaultBaseUrl: "http://127.0.0.1:5300",
    docsUrl: null,
    costTier: "free",
    planState: "self_hosted",
    defaultMaxConcurrent: 6,
    probe: {
      kind: "http",
      path: "/health",
      method: "GET",
      auth: "none",
      degradedAboveMs: 2000,
      timeoutMs: 8000,
      extractDetail: (body) => {
        if (typeof body !== "object" || body === null) return null;
        const b = body as Record<string, unknown>;
        return {
          accounts_total: numberish(b["accounts_total"]),
          accounts_healthy: numberish(b["accounts_healthy"]),
          queue_depth: numberish(b["queue_depth"]),
          active_sessions: numberish(b["active_sessions"]),
          workers_configured: numberish(b["workers_configured"]),
        };
      },
      meaning:
        "Process is listening. NOT proof it can generate: /health returns ok:true with an entirely dead account pool. The gateway's own gate reads /accounts usability instead (see veoforge-client.ts).",
    },
    usedBy: [
      "apps/worker-orchestrator/src/utils/media-gateway/veoforge-client.ts",
      "media-gateway: video secondary; images gated behind VEOFORGE_IMAGES_ENABLED",
    ],
    hostProcess: "systemd: veoforge (127.0.0.1:5300)",
    sortOrder: 7,
  },
  {
    key: "vup",
    displayName: "VUP — VEO Unlimited Pro",
    vendor: "self-hosted (Windows VM)",
    description:
      "Python wrapper on the Windows VM, addressed DIRECTLY on :5210. Nano-banana mode does images (incl. single-reference i2i); default mode does text→video and image→video. Jobs-based async. No delete endpoint — anything submitted WILL render. SUPERSEDED 2026-07-30 by `veo_fleet`: the same VM capacity is now reached through the VPS-side bridge orchestrator, and this direct port has been unreachable from the VPS (connect timeout) while generation itself was healthy. Kept as a health-gated fallback rung, not the primary.",
    capabilities: ["image", "video"],
    keyEnvVar: "VUP_API_KEY",
    urlEnvVar: "VUP_API_URL",
    concurrencyEnvVar: "VUP_MAX_CONCURRENT",
    defaultBaseUrl: "http://65.108.6.149:5210",
    docsUrl: null,
    costTier: "free",
    planState: "self_hosted",
    defaultMaxConcurrent: 6,
    probe: {
      kind: "http",
      path: "/health",
      method: "GET",
      auth: "none",
      degradedAboveMs: 2000,
      timeoutMs: 8000,
      meaning: "Wrapper process is listening and reports healthy.",
    },
    usedBy: [
      "apps/worker-orchestrator/src/utils/media-gateway/vup-client.ts",
      "media-gateway: PRIMARY for image + video",
    ],
    hostProcess: "libvirt VM win11 → VUP wrapper :5210",
    sortOrder: 10,
  },
  {
    key: "forge",
    displayName: "forge-api (VEO Studio wrapper)",
    vendor: "self-hosted",
    description:
      "Self-hosted VEO Studio browser wrapper. Images + t2v + i2v + start/end frame. Cannot do 1:1 aspect and takes no reference images. Runs as pm2 process `forge-api` on 127.0.0.1:8099 — it crash-looped for days in July 2026 (212+ restarts, missing package.json in the deploy) with nothing surfacing it. That is the failure class this page exists to catch.",
    capabilities: ["image", "video"],
    keyEnvVar: "FORGE_API_KEY",
    urlEnvVar: "FORGE_API_URL",
    concurrencyEnvVar: "FORGE_MAX_CONCURRENT",
    defaultBaseUrl: "https://forge-api.schreinercontentsystems.com",
    docsUrl: null,
    costTier: "free",
    planState: "self_hosted",
    defaultMaxConcurrent: 4,
    probe: {
      kind: "http",
      path: "/health",
      method: "GET",
      auth: "none",
      degradedAboveMs: 2000,
      timeoutMs: 8000,
    },
    usedBy: [
      "apps/worker-orchestrator/src/utils/media-gateway/forge-client.ts",
      "media-gateway: SECONDARY for image + video",
    ],
    hostProcess: "pm2: forge-api (127.0.0.1:8099)",
    sortOrder: 20,
  },
  {
    key: "fastgen",
    displayName: "fast-gen.ai",
    vendor: "fast-gen.ai",
    description:
      "v6 API. Nano Banana 2 / Seedream / OpenAI / Grok / Flow. Universal fallback: any reference count, any aspect, pinned upstream providers. ALSO used as an LLM ('prompt' tier) and by gemini-pool-client.",
    capabilities: ["image", "video", "llm"],
    keyEnvVar: "FASTGEN_API_KEY",
    urlEnvVar: "FASTGEN_API_URL",
    concurrencyEnvVar: "FASTGEN_MAX_CONCURRENT",
    defaultBaseUrl: "https://api.fast-gen.ai",
    docsUrl: null,
    costTier: "cheap",
    // ── The whole reason this registry exists. ──
    planState: "expired",
    planExpiresAt: "2026-07-21",
    planNote:
      "Licence expired ~2026-07-21 (confirmed by operator 2026-07-28). Must NOT be used. It was the silent Nano-Banana-2 → Seedream 4.5 downgrade path that shipped bad thumbnails unnoticed.",
    defaultMaxConcurrent: 8,
    probe: {
      kind: "http",
      path: "/api/v6/health",
      method: "GET",
      auth: "bearer",
      timeoutMs: 8000,
      okStatuses: [200, 401, 403],
    },
    usedBy: [
      "apps/worker-orchestrator/src/utils/fastgen-client.ts",
      "media-gateway: LAST-RESORT image/video fallback",
      "llm-client.ts: 'prompt' tier rung 1",
    ],
    sortOrder: 30,
  },
  {
    key: "ai33",
    displayName: "AI33",
    vendor: "api.ai33.pro",
    description:
      "Multi-service gateway: ElevenLabs TTS proxy (v3 — the v1 engine is marked DEPRECATED/unreliable in ai33-client.ts and the old /v1/text-to-speech path now errors), Minimax TTS + music, Suno music generation, nano-banana images, Edge TTS, dubbing, voice tools. Credit-based, with a dual-key failover (AI33_API_KEY / AI33_API_KEY_BACKUP). Its queue has saturated before (12/10 tasks, every /v1/* returning 429) — watch the credits detail on the probe.",
    capabilities: ["tts", "music", "image"],
    keyEnvVar: "AI33_API_KEY",
    urlEnvVar: null,
    concurrencyEnvVar: null,
    defaultBaseUrl: "https://api.ai33.pro",
    docsUrl: null,
    costTier: "standard",
    planState: "active",
    defaultMaxConcurrent: 10,
    probe: {
      kind: "http",
      path: "/v3/credits",
      method: "GET",
      auth: "raw",
      degradedAboveMs: 1500,
      timeoutMs: 10_000,
      extractDetail: (body) => {
        if (body && typeof body === "object" && "credits" in body) {
          const credits = numberish((body as { credits?: unknown }).credits);
          if (credits != null) return { credits };
        }
        return null;
      },
    },
    usedBy: [
      "apps/worker-orchestrator/src/utils/ai33-client.ts (+ ai33-suno, ai33-minimax-music, ai33-v3-speech, ai33-edge-tts, ai33-dubbing, ai33-management)",
      "tts-gateway: elevenlabs + minimax engines",
      "media-gateway: final image fallback",
      "music-engine: Suno generation",
    ],
    sortOrder: 40,
  },

  // ── TTS ──────────────────────────────────────────────────────────────────
  {
    key: "fish",
    displayName: "Fish Audio",
    vendor: "fish.audio",
    description:
      "Official Fish Audio API. Current DEFAULT TTS engine for every format (tts-gateway forces it unless TTS_FORCE_ENGINE says otherwise). Voices selected by 32-hex reference_id.",
    capabilities: ["tts"],
    keyEnvVar: "FISH_API_KEY",
    urlEnvVar: null,
    concurrencyEnvVar: null,
    defaultBaseUrl: "https://api.fish.audio",
    docsUrl: "https://docs.fish.audio",
    costTier: "cheap",
    planState: "active",
    defaultMaxConcurrent: 6,
    probe: {
      kind: "http",
      path: "/model?page_size=1",
      method: "GET",
      auth: "bearer",
      degradedAboveMs: 1500,
      timeoutMs: 10_000,
      okStatuses: [200, 401, 403],
    },
    usedBy: [
      "apps/worker-orchestrator/src/utils/fish-client.ts",
      "tts-gateway: 'fish' engine (forced default)",
      "tutorial tts-registry: FishAudioTTSProvider",
    ],
    sortOrder: 50,
  },
  {
    key: "elevenlabs_official",
    displayName: "ElevenLabs (official API)",
    vendor: "elevenlabs.io",
    description:
      "Direct ElevenLabs API. Used only by the Tutorial Studio TTS registry with per-VA encrypted keys — NOT via a global env var, so key presence cannot be checked from the environment.",
    capabilities: ["tts"],
    keyEnvVar: null,
    urlEnvVar: null,
    concurrencyEnvVar: null,
    defaultBaseUrl: "https://api.elevenlabs.io",
    docsUrl: "https://elevenlabs.io/docs",
    costTier: "premium",
    planState: "unknown",
    defaultMaxConcurrent: null,
    probe: null,
    probeUnavailableReason:
      "Credentials are per-VA and encrypted in tutorial_settings (secret-box). There is no global key to probe with.",
    usedBy: [
      "apps/worker-orchestrator/src/utils/tutorial/tts-registry.ts (ElevenLabsOfficialProvider)",
    ],
    // §2.1 "keep as notes only" — visible for reference, never routable, never red.
    role: "note",
    sortOrder: 60,
  },
  {
    key: "google_tts",
    displayName: "Google Cloud Text-to-Speech",
    vendor: "Google",
    description:
      "Tutorial Studio TTS option. Per-VA API key from encrypted settings.",
    capabilities: ["tts"],
    keyEnvVar: null,
    urlEnvVar: null,
    concurrencyEnvVar: null,
    defaultBaseUrl: "https://texttospeech.googleapis.com",
    docsUrl: null,
    costTier: "standard",
    planState: "unknown",
    defaultMaxConcurrent: null,
    probe: null,
    probeUnavailableReason:
      "Per-VA encrypted key, no global credential to probe with.",
    usedBy: [
      "apps/worker-orchestrator/src/utils/tutorial/tts-registry.ts (GoogleTTSProvider)",
    ],
    role: "note",
    sortOrder: 70,
  },
  {
    key: "inworld",
    displayName: "Inworld TTS",
    vendor: "inworld.ai",
    description: "Tutorial Studio TTS option. Per-VA encrypted key.",
    capabilities: ["tts"],
    keyEnvVar: null,
    urlEnvVar: null,
    concurrencyEnvVar: null,
    defaultBaseUrl: "https://api.inworld.ai",
    docsUrl: null,
    costTier: "standard",
    planState: "unknown",
    defaultMaxConcurrent: null,
    probe: null,
    probeUnavailableReason:
      "Per-VA encrypted key, no global credential to probe with.",
    usedBy: [
      "apps/worker-orchestrator/src/utils/tutorial/tts-registry.ts (InworldTTSProvider)",
    ],
    role: "note",
    sortOrder: 80,
  },
  {
    key: "edge_tts",
    displayName: "Edge TTS",
    vendor: "self-hosted (openai-edge-tts)",
    description:
      "Free Microsoft Edge voices via a self-hosted OpenAI-compatible shim. Runs as docker container `content-forge-edge-tts` on :5051. NEVER for production renders — operator directive.",
    capabilities: ["tts"],
    keyEnvVar: "EDGE_TTS_API_KEY",
    // The code reads EDGE_TTS_API_URL (edge-tts-provider.ts). Not EDGE_TTS_URL.
    urlEnvVar: "EDGE_TTS_API_URL",
    concurrencyEnvVar: null,
    defaultBaseUrl: "http://127.0.0.1:5051",
    docsUrl: "https://github.com/travisvn/openai-edge-tts",
    costTier: "free",
    planState: "self_hosted",
    defaultMaxConcurrent: null,
    probe: {
      kind: "http",
      path: "/v1/models",
      method: "GET",
      auth: "bearer",
      timeoutMs: 5000,
      okStatuses: [200, 401, 403, 404],
      meaning:
        "Only proves the container is listening — 404 counts as reachable because the shim does not implement /v1/models on every build.",
    },
    usedBy: [
      "apps/worker-orchestrator/src/utils/edge-tts-provider.ts",
      // NOTE: ai33-edge-tts.ts has zero importers (dead module, §1.5 drift).
    ],
    hostProcess: "docker: content-forge-edge-tts (:5051)",
    // §2.1 "get it back up, testing only" — never allowed as a production primary.
    productionForbidden: true,
    sortOrder: 90,
  },

  // ── LLM ──────────────────────────────────────────────────────────────────
  {
    key: "claude_pool",
    displayName: "Claude Pool (self-hosted)",
    vendor: "self-hosted",
    description:
      "Self-hosted Claude script API with FacelessOS prompts baked in. /v1/script for supported formats, /v1/run for free-form. Active 06:00–18:00 UTC by design. THE UNDERLYING CLAUDE SUBSCRIPTION EXPIRED 2026-06-29 — tutorial/llm-registry.ts already short-circuits it as a 'dead pool' (/v1/run verified returning 502 on 2026-07-04), yet llm-client.ts still lists it as rung 1 of the premium tier. That contradiction is exactly what this registry is for.",
    capabilities: ["llm"],
    keyEnvVar: "CLAUDE_POOL_API_KEY",
    urlEnvVar: "CLAUDE_POOL_URL",
    concurrencyEnvVar: null,
    defaultBaseUrl: "http://127.0.0.1:8092",
    docsUrl: null,
    costTier: "free",
    planState: "expired",
    planExpiresAt: "2026-06-29",
    planNote:
      "Claude subscription expired 2026-06-29. llm-registry.ts skips it; llm-client.ts does not. Resolve before relying on the premium tier.",
    defaultMaxConcurrent: null,
    probe: {
      kind: "http",
      path: "/health",
      method: "GET",
      auth: "bearer",
      timeoutMs: 8000,
      okStatuses: [200, 401, 403, 503],
    },
    usedBy: ["llm-client.ts: 'premium' tier rung 1"],
    hostProcess: "pm2: claude-pool (:8092)",
    sortOrder: 100,
  },
  {
    key: "deepseek",
    displayName: "DeepSeek",
    vendor: "deepseek.com",
    description:
      "deepseek-chat. The workhorse LLM for scripts, prompts and structured extraction. Rung 1 of the 'standard' tier.",
    capabilities: ["llm"],
    keyEnvVar: "DEEPSEEK_API_KEY",
    urlEnvVar: null,
    concurrencyEnvVar: null,
    defaultBaseUrl: "https://api.deepseek.com",
    docsUrl: "https://api-docs.deepseek.com",
    costTier: "cheap",
    planState: "active",
    defaultMaxConcurrent: null,
    probe: {
      kind: "http",
      path: "/models",
      method: "GET",
      auth: "bearer",
      degradedAboveMs: 2000,
      timeoutMs: 10_000,
    },
    usedBy: [
      "llm-client.ts: 'standard'/'premium'/'prompt' tiers",
      "thumbnail + ranking + tutorial prompt generation",
    ],
    sortOrder: 110,
  },
  {
    key: "anthropic",
    displayName: "Anthropic API",
    vendor: "anthropic.com",
    description:
      "Direct Anthropic Messages API (streamed). Configured but NOT on any tier ladder — only reachable by pinning provider: 'anthropic'.",
    capabilities: ["llm"],
    keyEnvVar: "ANTHROPIC_API_KEY",
    urlEnvVar: null,
    concurrencyEnvVar: null,
    defaultBaseUrl: "https://api.anthropic.com",
    docsUrl: "https://docs.anthropic.com",
    costTier: "premium",
    planState: "active",
    defaultMaxConcurrent: null,
    probe: {
      kind: "http",
      path: "/v1/models?limit=1",
      method: "GET",
      auth: "header:x-api-key",
      headers: { "anthropic-version": "2023-06-01" },
      degradedAboveMs: 2000,
      timeoutMs: 10_000,
    },
    usedBy: ["apps/worker-orchestrator/src/utils/anthropic-client.ts"],
    sortOrder: 120,
  },
  {
    key: "gemini_pool",
    displayName: "Gemini Pool (self-hosted)",
    vendor: "self-hosted",
    description:
      "5-slot self-hosted Gemini pool behind eduVPN egress. Referenced by llm-client but NOT on any tier ladder — pin-only. Direct Gemini API keys were phased out (operator directive).",
    capabilities: ["llm"],
    keyEnvVar: "GEMINI_POOL_API_KEY",
    urlEnvVar: "GEMINI_POOL_URL",
    concurrencyEnvVar: null,
    defaultBaseUrl: "https://hub.schreinercontentsystems.com/gemini",
    docsUrl: null,
    costTier: "free",
    planState: "unknown",
    defaultMaxConcurrent: null,
    probe: {
      kind: "http",
      path: "/health",
      method: "GET",
      auth: "bearer",
      timeoutMs: 8000,
      okStatuses: [200, 401, 403],
    },
    usedBy: [
      "apps/worker-orchestrator/src/utils/gemini-pool-client.ts",
      "llm-client.ts (pin-only, not on a tier ladder)",
    ],
    hostProcess: "pm2: gemini-multimodal-pool + docker: gemini-pool-api",
    deprecated: true,
    deprecationNote:
      "Not on any tier ladder — nothing routes here by default, even though the service is still running on the VPS. Decide: wire it in or retire it.",
    sortOrder: 130,
  },
  {
    key: "ollama",
    displayName: "Ollama (local)",
    vendor: "self-hosted",
    description:
      "Local model server, default gemma3:4b. Last rung of every LLM tier ladder — the always-available floor.",
    capabilities: ["llm"],
    keyEnvVar: null,
    urlEnvVar: "OLLAMA_URL",
    concurrencyEnvVar: null,
    defaultBaseUrl: "http://127.0.0.1:11434",
    docsUrl: null,
    costTier: "free",
    planState: "self_hosted",
    defaultMaxConcurrent: null,
    probe: {
      kind: "http",
      path: "/api/tags",
      method: "GET",
      auth: "none",
      timeoutMs: 5000,
    },
    usedBy: ["llm-client.ts: final rung of premium/standard/local tiers"],
    sortOrder: 140,
  },
  {
    key: "lmstudio",
    displayName: "LM Studio (local)",
    vendor: "self-hosted",
    description: "OpenAI-compatible local server. Rung 1 of the 'local' tier.",
    capabilities: ["llm"],
    keyEnvVar: null,
    urlEnvVar: "LMSTUDIO_URL",
    concurrencyEnvVar: null,
    defaultBaseUrl: "http://127.0.0.1:1234",
    docsUrl: null,
    costTier: "free",
    planState: "self_hosted",
    defaultMaxConcurrent: null,
    probe: {
      kind: "http",
      path: "/v1/models",
      method: "GET",
      auth: "none",
      timeoutMs: 5000,
    },
    usedBy: ["llm-client.ts: 'local' tier rung 1"],
    sortOrder: 150,
  },

  // ── Music ────────────────────────────────────────────────────────────────
  {
    key: "suno_automation",
    displayName: "Suno Automation (self-hosted)",
    vendor: "self-hosted",
    description:
      "Self-hosted Suno music automation service running as pm2 process `suno-automation` on the VPS. Distinct from AI33's Suno endpoint, which is what music-engine currently calls. Present in infra but NOT referenced by any Content Forge code path — decide whether to wire the music library to it or retire it.",
    capabilities: ["music"],
    keyEnvVar: "SUNO_AUTOMATION_API_KEY",
    urlEnvVar: "SUNO_AUTOMATION_URL",
    concurrencyEnvVar: null,
    defaultBaseUrl: null,
    docsUrl: null,
    costTier: "free",
    planState: "self_hosted",
    defaultMaxConcurrent: null,
    probe: {
      kind: "http",
      path: "/health",
      method: "GET",
      auth: "bearer",
      timeoutMs: 6000,
      okStatuses: [200, 401, 403, 404],
      meaning: "Only proves the service is listening.",
    },
    probeUnavailableReason: null,
    usedBy: ["(none in this repo — runs on the VPS, not called from here)"],
    hostProcess: "pm2: suno-automation",
    deprecated: true,
    deprecationNote:
      "Running on the VPS but unreferenced by Content Forge code. Music generation goes through AI33's Suno endpoint instead.",
    sortOrder: 155,
  },

  // ── LLM: per-VA Tutorial Studio providers ────────────────────────────────
  // These live in tutorial/llm-registry.ts and resolve an ENCRYPTED PER-VA key
  // from tutorial_settings, not an env var. Key presence is therefore per-user
  // and cannot be answered from the host environment — the UI must say so.
  {
    key: "openai",
    displayName: "OpenAI",
    vendor: "openai.com",
    description:
      "Chat completions, used only by the Tutorial Studio script generator with a per-VA key. Not on any global tier ladder.",
    capabilities: ["llm"],
    keyEnvVar: null,
    urlEnvVar: null,
    concurrencyEnvVar: null,
    defaultBaseUrl: "https://api.openai.com",
    docsUrl: "https://platform.openai.com/docs",
    costTier: "premium",
    planState: "unknown",
    defaultMaxConcurrent: null,
    probe: null,
    probeUnavailableReason:
      "Per-VA encrypted key in tutorial_settings — no global credential to probe with.",
    usedBy: [
      "apps/worker-orchestrator/src/utils/tutorial/llm-registry.ts (openaiChat)",
    ],
    // §2.1 "keep, no key" — a note, not a routable option.
    role: "note",
    sortOrder: 122,
  },
  {
    key: "minimax_llm",
    displayName: "Minimax (LLM, direct)",
    vendor: "minimax.io",
    description:
      "abab6.5s-chat via the direct Minimax API. Tutorial script generation only, per-VA key. Distinct from Minimax TTS, which goes through AI33.",
    capabilities: ["llm"],
    keyEnvVar: null,
    urlEnvVar: null,
    concurrencyEnvVar: null,
    defaultBaseUrl: "https://api.minimax.io/v1",
    docsUrl: null,
    costTier: "cheap",
    planState: "unknown",
    defaultMaxConcurrent: null,
    probe: null,
    probeUnavailableReason: "Per-VA encrypted key.",
    usedBy: [
      "apps/worker-orchestrator/src/utils/tutorial/llm-registry.ts (minimax_llm)",
    ],
    // §2.1 "phase out — never had a key". Dies with the per-VA key system.
    deprecated: true,
    deprecationNote:
      "Operator verdict: PHASE OUT — never had a key. Remove from the tutorial provider enum when the per-VA encrypted key system is abolished (§2.1).",
    sortOrder: 124,
  },
  {
    key: "qwen_dashscope",
    displayName: "Qwen (Alibaba DashScope)",
    vendor: "aliyun",
    description:
      "qwen-plus via DashScope's OpenAI-compatible endpoint. Tutorial script generation, per-VA key. The 'qwen_local' / 'qwen3_local' registry entries are stubs that throw 'coming soon'.",
    capabilities: ["llm"],
    keyEnvVar: null,
    urlEnvVar: null,
    concurrencyEnvVar: null,
    defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    docsUrl: null,
    costTier: "cheap",
    planState: "unknown",
    defaultMaxConcurrent: null,
    probe: null,
    probeUnavailableReason: "Per-VA encrypted key.",
    usedBy: [
      "apps/worker-orchestrator/src/utils/tutorial/llm-registry.ts (qwen_hosted)",
    ],
    // §2.5: it is qwen_dashscope (hosted Alibaba API, not local). RETIRE — dies
    // with the per-VA key system; nothing else routes to it.
    deprecated: true,
    deprecationNote:
      "RETIRE (§2.5): hosted Alibaba DashScope API reachable only from Tutorial Studio via a per-VA encrypted key. With per-VA keys abolished it has no means of auth. Remove from the tutorial provider enum. (Not 'local' — the qwen_local entries are 'coming soon' stubs that throw.)",
    sortOrder: 126,
  },
  {
    key: "gemini_direct",
    displayName: "Google Generative Language (Gemini, direct key)",
    vendor: "Google",
    description:
      "generativelanguage.googleapis.com called with a stored API key. The operator directive was to PHASE THESE OUT, but the code paths are still live: gemini-pool-client fallback B, cf-api/integrations/gemini-pool, hub-web stock-library/gemini, tutorial llm-registry (google_gemini), and media-core/google-gemini/image. Surfaced so the phase-out can actually be finished.",
    // §2.3 Layer 1: the `image` capability is REMOVED. Gemini image generation
    // (Nano Banana) bills money; the media-core image path was deleted. A
    // capability that does not exist cannot be routed to.
    capabilities: ["llm"],
    keyEnvVar: "GEMINI_API_KEY",
    urlEnvVar: null,
    concurrencyEnvVar: null,
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    docsUrl: null,
    // Free-tier key only — never billed. See @repo/config gemini-free-tier guard.
    costTier: "free",
    planState: "unknown",
    defaultMaxConcurrent: null,
    probe: {
      kind: "http",
      path: "/v1beta/models",
      method: "GET",
      auth: "header:x-goog-api-key",
      degradedAboveMs: 2000,
      timeoutMs: 10_000,
    },
    planNote:
      "FREE TIER ONLY (§2.3). Allowed models: gemini-3.5-flash, gemini-3.5-flash-lite, gemini-3.1-flash-lite, gemini-2.5-flash(-lite), Flash TTS. NEVER Pro / image / Veo / Lyria — those bill money and go through VUP/forge/media-gateway. Enforced by @repo/config assertGeminiFreeTierModel + geminiFreeTierKey (the only sanctioned key reader).",
    usedBy: [
      "apps/worker-orchestrator/src/utils/gemini-pool-client.ts (fallback B)",
      "packages/cf-api/src/integrations/gemini-pool.ts",
      "apps/hub-web/src/lib/stock-library/gemini.ts",
      "tutorial/llm-registry.ts (google_gemini)",
    ],
    // Konrad's §2.1 verdict is KEEP (new key), so it is no longer deprecated —
    // but it is constrained to free-tier fallback use (see planNote). The 5
    // call sites remain valid; the image/Pro paths need the allow-list enforced.
    sortOrder: 128,
  },
  {
    key: "gemini_multimodal_pool",
    displayName: "Gemini Multimodal Pool (browser automation)",
    vendor: "self-hosted",
    description:
      "Playwright-driven gemini.google.com sessions. Intended as the thumbnail-review backend, but utils/thumbnail/review.ts is an explicit SAFE STUB that makes no network calls — so nothing actually uses it today.",
    capabilities: ["llm", "other"],
    keyEnvVar: "GEMINI_MM_POOL_API_KEY",
    urlEnvVar: "GEMINI_MM_POOL_URL",
    concurrencyEnvVar: "GEMINI_MM_MAX_INSTANCES",
    defaultBaseUrl: null,
    docsUrl: null,
    costTier: "free",
    planState: "self_hosted",
    defaultMaxConcurrent: null,
    probe: {
      kind: "http",
      path: "/health",
      method: "GET",
      auth: "bearer",
      timeoutMs: 6000,
      okStatuses: [200, 401, 403, 404],
      meaning: "Only proves the pool service is listening.",
    },
    usedBy: [
      "apps/gemini-multimodal-pool/** (service)",
      "packages/validation-browser/src/gemini-video-validator.ts",
      "utils/thumbnail/review.ts — STUBBED, no calls",
    ],
    hostProcess: "pm2: gemini-multimodal-pool",
    deprecated: true,
    deprecationNote:
      "Service runs, consumer is a stub. Wire it up or retire it.",
    sortOrder: 132,
  },

  // ── Vision / speech sidecars ─────────────────────────────────────────────
  {
    key: "whisper_service",
    displayName: "Whisper GPU service",
    vendor: "self-hosted (remote laptop)",
    description:
      "Remote GPU transcription service, woken by Wake-on-LAN. Falls back to a local whisper binary when WHISPER_SERVICE_URL is unset. Word timings from this service underpin all sentence-anchored placement, so its health is load-bearing for render correctness.",
    capabilities: ["other"],
    keyEnvVar: "WHISPER_SERVICE_TOKEN",
    urlEnvVar: "WHISPER_SERVICE_URL",
    concurrencyEnvVar: "WHISPER_MAX_CONCURRENT",
    defaultBaseUrl: null,
    docsUrl: null,
    costTier: "free",
    planState: "self_hosted",
    defaultMaxConcurrent: null,
    probe: {
      kind: "http",
      path: "/health",
      method: "GET",
      auth: "bearer",
      timeoutMs: 6000,
      okStatuses: [200, 401, 403, 404],
      meaning:
        "Only proves the box is awake and listening — it is Wake-on-LAN gated, so a red here often just means asleep.",
    },
    usedBy: [
      "packages/media-core/src/whisper/runner.ts",
      "ai-generation, clip-label, clip-forge ingest, ranking narration anchoring, worker-render v2, worker-video-stitch",
    ],
    sortOrder: 182,
  },
  {
    key: "vlm_sidecar",
    displayName: "VLM sidecar",
    vendor: "self-hosted",
    description:
      "FastAPI wrapper (:8765) that pulls keyframes and asks a local Ollama qwen3-vl model to label a clip. SUPERSEDED by Gemini vision — labelClip() (the only /label caller) is imported by nothing, and every health-ping caller discards the `vlm` field. Dead code that still runs on the VPS.",
    capabilities: ["other"],
    keyEnvVar: null,
    urlEnvVar: "VLM_SIDECAR_URL",
    concurrencyEnvVar: null,
    defaultBaseUrl: "http://localhost:8765",
    docsUrl: null,
    costTier: "free",
    planState: "self_hosted",
    defaultMaxConcurrent: null,
    probe: {
      kind: "http",
      path: "/health",
      method: "GET",
      auth: "none",
      timeoutMs: 5000,
      okStatuses: [200, 404],
      meaning: "Only proves the sidecar is listening.",
    },
    // §1.5 drift fix: the four consumers previously listed here do NOT call it —
    // they health-check the URL and discard the result. Its only real caller,
    // labelClip(), is imported by nothing.
    usedBy: [
      "apps/worker-orchestrator/src/utils/sidecar-client.ts (labelClip — imported by nothing; health ping result discarded)",
    ],
    hostProcess: "pm2: vlm-sidecar (:8765)",
    // §2.2 RETIRE: replaced by Gemini vision. Stop the pm2 process; killing it
    // also removes the last vision consumer of Ollama.
    deprecated: true,
    deprecationNote:
      "RETIRE (§2.2): superseded by Gemini vision ('Gemini is the only VLM backend. No fallback to local model.'). Dead code — labelClip() has zero importers. Stop the pm2 process.",
    sortOrder: 184,
  },
  {
    key: "audio_face_sidecar",
    displayName: "Audio/face sidecar",
    vendor: "self-hosted",
    description:
      "LOAD-BEARING ML sidecar (:8766, apps/audio-face-sidecar). Bundles faster-whisper (word timestamps), InsightFace/ArcFace, BEATs audio-class, BGE-M3 embeddings, TransNetV2 scene detection. Clip Forge ingest, ALL clip/image labelling, all embeddings, and clip selection break without it — clip-selection.ts throws 'Cannot select clips without semantic search' when it is down. Largest memory tenant on the VPS (~3.6 GB) but not retirable.",
    capabilities: ["other"],
    keyEnvVar: null,
    urlEnvVar: "AUDIO_FACE_SIDECAR_URL",
    concurrencyEnvVar: null,
    defaultBaseUrl: "http://localhost:8766",
    docsUrl: null,
    costTier: "free",
    planState: "self_hosted",
    defaultMaxConcurrent: null,
    probe: {
      kind: "http",
      path: "/health",
      method: "GET",
      auth: "none",
      timeoutMs: 5000,
      okStatuses: [200, 404],
      meaning:
        "Proves the sidecar is listening and reports which of its five models loaded (see detail).",
      // Surface per-model load flags — /health returns them and the registry
      // previously threw the detail away (§2.1).
      extractDetail: (body) => {
        if (!body || typeof body !== "object") return null;
        const out: Record<string, unknown> = {};
        for (const k of [
          "whisper",
          "faces",
          "insightface",
          "audio",
          "beats",
          "embed",
          "bge",
          "scenes",
          "transnet",
          "models",
          "status",
        ]) {
          if (k in (body as Record<string, unknown>))
            out[k] = (body as Record<string, unknown>)[k];
        }
        return Object.keys(out).length > 0 ? out : null;
      },
    },
    usedBy: [
      "apps/worker-orchestrator/src/utils/sidecar-client.ts",
      "clip-ingest, clip-label, clip-embed, image-embed, image-label, clip-selection",
      "hub-web /api/clip-library/benchmark/[videoId]/*",
    ],
    hostProcess: "pm2: audio-face-sidecar (:8766)",
    sortOrder: 186,
  },

  // ── Footage ──────────────────────────────────────────────────────────────
  {
    key: "pexels",
    displayName: "Pexels",
    vendor: "pexels.com",
    description:
      "Stock photos + videos. Used for comparison images, clip-library stock footage and B-roll.",
    capabilities: ["footage", "image"],
    keyEnvVar: "PEXELS_API_KEY",
    urlEnvVar: null,
    concurrencyEnvVar: null,
    defaultBaseUrl: "https://api.pexels.com",
    docsUrl: "https://www.pexels.com/api/documentation/",
    costTier: "free",
    planState: "active",
    defaultMaxConcurrent: null,
    probe: {
      kind: "http",
      path: "/v1/search?query=test&per_page=1",
      method: "GET",
      auth: "raw",
      degradedAboveMs: 2000,
      timeoutMs: 10_000,
    },
    usedBy: [
      "apps/worker-orchestrator/src/utils/pexels-client.ts",
      "footage-gateway source 'pexels'",
    ],
    sortOrder: 160,
  },
  {
    key: "yt_dlp",
    displayName: "yt-dlp (YouTube footage)",
    vendor: "self-hosted tooling",
    description:
      "Footage mining via yt-dlp. Needs cookies (YT_DLP_COOKIES) plus a bgutil PO-token provider on the VPS — YouTube blocks the datacenter IP without them. Cookies are personal and expire.",
    capabilities: ["footage"],
    keyEnvVar: "YT_DLP_COOKIES",
    urlEnvVar: null,
    concurrencyEnvVar: null,
    defaultBaseUrl: null,
    docsUrl: null,
    costTier: "free",
    planState: "self_hosted",
    defaultMaxConcurrent: null,
    probe: null,
    probeUnavailableReason:
      "The DOWNLOAD path is a local binary — probing it means an actual download, which is neither cheap nor safe on a schedule. But the COOKIE FILE is probeable: see cookieFileEnvVar.",
    // C1: alert when cookies expire. Stat + parse the Netscape file for the
    // earliest non-zero expiry — never a download attempt.
    cookieFileEnvVar: "YT_DLP_COOKIES",
    usedBy: [
      "apps/worker-orchestrator/src/utils/yt-dlp-client.ts",
      "footage-gateway source 'yt-dlp'",
    ],
    hostProcess: "local binary + docker: bgutil-pot (127.0.0.1:4416)",
    sortOrder: 170,
  },
  {
    key: "bgutil_pot",
    displayName: "bgutil PO-token provider",
    vendor: "self-hosted",
    description:
      "Docker service on 127.0.0.1:4416 that mints YouTube PO tokens for yt-dlp. Not a content provider — an INFRASTRUCTURE DEPENDENCY of yt_dlp. When this is down, footage mining fails with opaque YouTube errors.",
    capabilities: ["other"],
    keyEnvVar: null,
    urlEnvVar: "BGUTIL_POT_URL",
    concurrencyEnvVar: null,
    defaultBaseUrl: "http://127.0.0.1:4416",
    docsUrl: null,
    costTier: "free",
    planState: "self_hosted",
    defaultMaxConcurrent: null,
    probe: {
      kind: "http",
      path: "/ping",
      method: "GET",
      auth: "none",
      timeoutMs: 5000,
      okStatuses: [200, 404],
      meaning: "Only proves the container is listening on :4416.",
    },
    usedBy: ["yt-dlp footage mining (VPS-side config, not in this repo)"],
    hostProcess: "docker: bgutil-pot (127.0.0.1:4416)",
    sortOrder: 175,
  },
  {
    key: "duckduckgo_images",
    displayName: "DuckDuckGo image search (scraped)",
    vendor: "duckduckgo.com",
    description:
      "Unofficial: scrapes a `vqd` token then hits /i.js. No API key, no contract, no SLA. Used as the Pexels fallback for comparison images and ranking footage — so a silent break here degrades those formats with no error.",
    capabilities: ["image", "footage"],
    keyEnvVar: null,
    urlEnvVar: null,
    concurrencyEnvVar: null,
    defaultBaseUrl: "https://duckduckgo.com",
    docsUrl: null,
    costTier: "free",
    planState: "none",
    planNote:
      "No agreement of any kind — this is scraping. Treat availability as untrustworthy.",
    defaultMaxConcurrent: null,
    probe: null,
    probeUnavailableReason:
      "Probing it means scraping it. Deliberately not automated — a green would be meaningless and the requests are unwelcome.",
    usedBy: [
      "apps/worker-orchestrator/src/utils/duckduckgo-images.ts",
      "comparison-image-fetcher.ts (Pexels fallback), ranking-footage-collection.ts",
    ],
    sortOrder: 172,
  },
  {
    key: "twitch_downloader",
    displayName: "Twitch (TwitchDownloaderCLI)",
    vendor: "self-hosted tooling",
    description:
      "CLI download of Twitch VODs and clips for Clip Forge ingest. Needs TWITCH_OAUTH for gated content.",
    capabilities: ["footage"],
    keyEnvVar: "TWITCH_OAUTH",
    urlEnvVar: null,
    concurrencyEnvVar: null,
    defaultBaseUrl: null,
    docsUrl: null,
    costTier: "free",
    planState: "self_hosted",
    defaultMaxConcurrent: null,
    probe: null,
    probeUnavailableReason:
      "A local binary, not an HTTP service. A real probe means an actual download.",
    usedBy: [
      "apps/worker-orchestrator/src/processors/clip-forge/ingest.ts (twitchDownload)",
    ],
    sortOrder: 174,
  },
  {
    key: "clip_library",
    displayName: "Clip Library (internal)",
    vendor: "internal",
    description:
      "Our own pre-ingested clip library in Postgres + local storage. Always available when the DB is.",
    capabilities: ["footage"],
    keyEnvVar: null,
    urlEnvVar: null,
    concurrencyEnvVar: null,
    defaultBaseUrl: null,
    docsUrl: null,
    costTier: "free",
    planState: "self_hosted",
    defaultMaxConcurrent: null,
    probe: null,
    probeUnavailableReason:
      "Internal database-backed source — its health is the database's health, already covered by the platform checks.",
    usedBy: ["footage-gateway source 'clip-library'"],
    sortOrder: 180,
  },

  // ── Storage / infra ──────────────────────────────────────────────────────
  // Cloudflare R2 REMOVED (§2.1 "not real"): no S3 SDK installed, all "R2
  // clients" are node:fs shims, all R2_* env vars deleted. The r2_asset_manifest
  // DB columns (the live LOCAL-FS manifest) are renamed in a later migration.
  {
    key: "hermes_control_plane",
    displayName: "Hermes Control Plane",
    vendor: "self-hosted",
    description:
      "Daemon on 127.0.0.1:8650 exposing /jobs. The Dark Factory page fetches from it. Health uncertain — it is an external dependency of a Content Forge page, so it belongs here rather than being invisible.",
    capabilities: ["other"],
    keyEnvVar: null,
    urlEnvVar: "HERMES_CONTROL_PLANE_URL",
    concurrencyEnvVar: null,
    defaultBaseUrl: "http://127.0.0.1:8650",
    docsUrl: null,
    costTier: "free",
    planState: "self_hosted",
    defaultMaxConcurrent: null,
    probe: {
      kind: "http",
      path: "/jobs",
      method: "GET",
      auth: "none",
      timeoutMs: 5000,
      meaning: "Proves the daemon answers the endpoint Dark Factory uses.",
    },
    usedBy: ["Dark Factory page (fetches /jobs)"],
    hostProcess: "pm2: hermes-control-plane (:8650)",
    sortOrder: 195,
  },

  // HeyGen REMOVED (§2.1 "too expensive"): the API provider never existed on
  // this branch (zero HTTP call sites). Only the manual avatar-footage UPLOAD
  // slot survives (RBAC 'upload:heygen-footage' + dropzone) — that is
  // infrastructure with an unfortunate name, NOT a provider, and is left intact.
];

export const PROVIDERS_BY_KEY: ReadonlyMap<string, ProviderDefinition> =
  new Map(BUILT_IN_PROVIDERS.map((p) => [p.key, p]));

/**
 * DEFAULT GLOBAL CHAINS — these mirror what the gateways do TODAY, so
 * seeding the registry changes nothing until an operator edits a chain.
 *
 * `enabled: false` means the hop is switched off and will never be used.
 * fastgen ships disabled everywhere because its licence expired.
 */
export interface DefaultChainSpec {
  capability: RoutedCapability;
  providerKey: string;
  position: number;
  enabled: boolean;
  note?: string;
}

export const DEFAULT_CHAINS: DefaultChainSpec[] = [
  // Image: veo_fleet → vup → forge → veoforge (not entitled, off) → ai33 (off)
  {
    capability: "image",
    providerKey: "veo_fleet",
    position: 1,
    enabled: true,
    note: "Re-verified 2026-07-31: 4/4 images, 1376x768 JPEG (865KB-1.0MB), 40-185s each under a concurrent 8-job burst. Still the ONLY backend producing real image bytes — VeoForge images 403 on the same day. Effective parallelism is ~3 (worker account slots), not the advertised 12.",
  },
  { capability: "image", providerKey: "vup", position: 2, enabled: true },
  { capability: "image", providerKey: "forge", position: 3, enabled: true },
  {
    capability: "image",
    providerKey: "veoforge",
    position: 4,
    enabled: false,
    note: "STILL inert as of 2026-07-31, and this is NOT an account-supply problem: retested with a healthy pool (25 accounts, 24 healthy, 16 live sessions) and all 4/4 images failed 'whisk:generateImage (auth/bot wall): HTTP 403'. The accounts are entitled to VIDEO but not to whisk/image. Refilling the pool will not fix this hop — it needs an image-entitled lease. Gateway also gates it behind VEOFORGE_IMAGES_ENABLED=1.",
  },
  {
    capability: "image",
    providerKey: "fastgen",
    position: 5,
    enabled: false,
    note: "RETIRED. Licence expired 2026-07-21. This is the hop that silently downgraded Nano Banana 2 → Seedream 4.5. Removed from the gateway's default chains entirely 2026-07-30 — only an explicit pin reaches it.",
  },
  {
    capability: "image",
    providerKey: "ai33",
    position: 6,
    enabled: false,
    note: "Opt-in only — costs credits. Turn on deliberately, not by accident.",
  },

  // Video: veo_fleet → veoforge → vup → forge → fastgen (RETIRED, off)
  {
    capability: "video",
    providerKey: "veo_fleet",
    position: 1,
    enabled: true,
    note: "Re-verified 2026-07-31: 4/4 videos, 1280x720 h264+aac 8.0s (2.4-6.5MB), 95-185s. Model veo-3.1-lite; veo-omni is not entitled on the current accounts. Faster and more reliable than VeoForge for video, but its parallelism ceiling is the LOWER of the two — see the effective-concurrency note.",
  },
  {
    capability: "video",
    providerKey: "veoforge",
    position: 2,
    enabled: true,
    note: "Pool is HEALTHY as of 2026-07-31 (25 accounts / 24 healthy / 16 sessions — the 2026-07-30 'dry pool' note is obsolete) and video is PROVEN: 4/4 at 1280x720 h264+aac 8.0s. Kept at position 2 on latency, not health — it ran 177-473s vs the fleet's 95-185s, and 3 of 4 jobs logged an intermediate 401 before an account rotation carried them to success. Its advantage is DEPTH: 16 workers over 24 accounts absorb bursts the fleet's ~3 slots cannot. Set MEDIA_VIDEO_PRIMARY=veoforge to promote it.",
  },
  { capability: "video", providerKey: "vup", position: 3, enabled: true },
  { capability: "video", providerKey: "forge", position: 4, enabled: true },
  {
    capability: "video",
    providerKey: "fastgen",
    position: 5,
    enabled: false,
    note: "RETIRED. Licence expired 2026-07-21.",
  },

  // TTS: Fish is the forced default; the AI33 engines are opt-in.
  { capability: "tts", providerKey: "fish", position: 1, enabled: true },
  {
    capability: "tts",
    providerKey: "ai33",
    position: 2,
    enabled: false,
    note: "ElevenLabs-proxy / Minimax via AI33. Opt-in — costs credits.",
  },
  {
    capability: "tts",
    providerKey: "edge_tts",
    position: 3,
    enabled: false,
    note: "NEVER for production renders (operator directive).",
  },

  // LLM: the 'standard' tier ladder, made explicit.
  {
    capability: "llm",
    providerKey: "claude_pool",
    position: 1,
    enabled: false,
    note: "Subscription expired 2026-06-29 — llm-client.ts still has it as premium rung 1. Switched off here so DeepSeek is the honest primary.",
  },
  { capability: "llm", providerKey: "deepseek", position: 2, enabled: true },
  { capability: "llm", providerKey: "ollama", position: 3, enabled: true },
  {
    capability: "llm",
    providerKey: "anthropic",
    position: 4,
    enabled: false,
    note: "Pin-only today. Premium cost — opt-in.",
  },

  // Music
  { capability: "music", providerKey: "ai33", position: 1, enabled: true },

  // Footage
  { capability: "footage", providerKey: "yt_dlp", position: 1, enabled: true },
  { capability: "footage", providerKey: "pexels", position: 2, enabled: true },
  {
    capability: "footage",
    providerKey: "clip_library",
    position: 3,
    enabled: true,
  },
];

/**
 * SEED EXPIRY CLOCKS (Phase C / C1).
 *
 * Every value here is from Konrad (DECISIONS §2.1 / C1) — the `source` is the
 * proof of where it came from, and it is NEVER "guessed". `expiresAt: null`
 * means "we do not know", which the UI must render as an explicit prompt.
 * syncCatalog() upserts these idempotently; operators can add/adjust rows in
 * the UI afterwards (the Settings agent owns credential editing).
 */
export const PROVIDER_EXPIRIES: ProviderExpiry[] = [
  {
    providerKey: "fish",
    kind: "api_key",
    label: "Fish Audio API key",
    // ⚠️ Already inside the 14-day warn window as of 2026-07-28.
    expiresAt: "2026-08-01T00:00:00.000Z",
    source: "manual",
    warnDaysBefore: 14,
    lastVerifiedAt: null,
    evidence: null,
    note: "Operator asked to be reminded. Fish is the PRIMARY TTS engine — if this lapses, every format loses its default voice.",
  },
  {
    providerKey: "fastgen",
    kind: "licence",
    label: "fast-gen.ai v6 licence",
    expiresAt: "2026-07-21T00:00:00.000Z",
    source: "manual",
    warnDaysBefore: 14,
    lastVerifiedAt: null,
    evidence: null,
    note: "Expired ~2026-07-21. May reactivate; keep the provider, links stay disabled.",
  },
  {
    providerKey: "claude_pool",
    kind: "subscription",
    label: "Claude Code subscription (pool)",
    expiresAt: "2026-06-29T00:00:00.000Z",
    source: "manual",
    warnDaysBefore: 14,
    lastVerifiedAt: null,
    evidence: null,
    note: "Subscription expired 2026-06-29. Being revived — until a new account lands, claude_pool must not be used even though :8092 answers 200.",
  },
  {
    providerKey: "forge",
    kind: "subscription",
    label: "Google Flow / VEO entitlement",
    // Unknown on purpose — there is no API to read it from. Ask Konrad.
    expiresAt: null,
    source: "manual",
    warnDaysBefore: 14,
    lastVerifiedAt: null,
    evidence: null,
    note: "Google account entitlement for Labs Flow / VEO. No API to read the renewal date — operator must supply it. (Separately, forge-api's July 2026 outage was a deploy bug (missing package.json → MODULE_NOT_FOUND, 2.1M restarts), NOT this clock — two independent clocks on one card.)",
  },
  {
    providerKey: "yt_dlp",
    kind: "cookie_file",
    label: "YouTube cookies (Netscape file)",
    // Auto-filled by the cookie-file probe (earliest non-zero expiry). VERIFIED
    // 2026-07-28: the file did not exist on the VPS at all — probe goes red.
    expiresAt: null,
    source: "cookie_parse",
    warnDaysBefore: 7,
    lastVerifiedAt: null,
    evidence: null,
    note: "Filled from $YT_DLP_COOKIES by the cookie-file probe. Missing/expired cookies break ALL YouTube footage mining. VERIFIED missing on the VPS 2026-07-28.",
  },
  {
    providerKey: "gemini_direct",
    kind: "credit_balance",
    label: "Free-tier grounded-prompt quota",
    expiresAt: null,
    source: "manual",
    warnDaysBefore: 0,
    lastVerifiedAt: null,
    evidence: { quota: "5000 grounded prompts / month (free tier)" },
    note: "Free-tier quota, not a dated expiry. Kept as a clock so the allow-list (free-tier only) is visible.",
  },
];

/**
 * DEFAULT CAPABILITY POLICIES (Phase B2).
 *
 * One permissive global policy per routed capability so the UI has a row to
 * toggle. strict=false everywhere means behaviour is UNCHANGED until an
 * operator turns strict on for a capability/consumer — at which point the
 * gateway throws with the full chain instead of silently degrading.
 */
export const DEFAULT_CAPABILITY_POLICIES: CapabilityPolicy[] =
  ROUTED_CAPABILITIES.map((capability) => ({
    capability,
    consumer: null,
    strict: false,
    maxFallbackDepth: null,
    requireAck: false,
  }));

/** Consumers the UI offers priority controls for. */
export const KNOWN_CONSUMERS = [
  "TUTORIAL_STUDIO",
  "THUMBNAILS",
  "CASUALLY_EXPLAINED",
  "EXPLAINER",
  "POLITICAL_COMMENTARY_REACTOR",
  "TECH_COMPARISON",
  "RANKING",
  "LONG_FORM_DRAMA",
  "DOCUMENTARY",
  "VIDEO_ESSAY",
  "BUNDESTAG",
  "CLIP_FORGE",
  "STOCK_LIBRARY",
  "OTHER",
] as const;
