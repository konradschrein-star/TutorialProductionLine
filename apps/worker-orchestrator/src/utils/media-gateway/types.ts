import type { FastGenImageProvider } from "../fastgen-client.js";

/**
 * Shared types for the unified media gateway.
 *
 * GatewayFormat is the canonical format union used for prioritization by
 * this gateway AND the TTS gateway. Keep in sync with the formats that
 * actually generate media.
 */

export type GatewayFormat =
  | "CASUALLY_EXPLAINED"
  | "EXPLAINER"
  | "POLITICAL_COMMENTARY_REACTOR"
  | "TECH_COMPARISON"
  | "RANKING"
  | "LONG_FORM_DRAMA"
  | "DOCUMENTARY"
  | "VIDEO_ESSAY"
  | "BUNDESTAG"
  | "BUSINESS_PLAN_HUB"
  | "TUTORIAL_STUDIO"
  | "STOCK_LIBRARY"
  | "OTHER";

/**
 * Higher number = served first. TUTORIAL_STUDIO is top so VA production
 * never waits on background batches; CE next because the operator tunes
 * it hour-by-hour. Background bulk (drama, stock) sits at the bottom.
 */
const DEFAULT_PRIORITIES: Record<GatewayFormat, number> = {
  TUTORIAL_STUDIO: 120,
  CASUALLY_EXPLAINED: 100,
  EXPLAINER: 80,
  POLITICAL_COMMENTARY_REACTOR: 80,
  TECH_COMPARISON: 60,
  RANKING: 60,
  // Prop plates and b-roll stand-ins for the Business Plan Hub marketing
  // catalogue. Same rung as RANKING: a real production format, but a bulk
  // keyword-matrix one, so it must never outrank VA-facing work.
  BUSINESS_PLAN_HUB: 60,
  LONG_FORM_DRAMA: 50,
  DOCUMENTARY: 50,
  VIDEO_ESSAY: 50,
  BUNDESTAG: 50,
  STOCK_LIBRARY: 30,
  OTHER: 40,
};

/**
 * Resolve the effective priority for a format. Env override order:
 * MEDIA_PRIORITY_<FORMAT> (new), then the legacy FASTGEN_PRIORITY_<FORMAT>
 * / MEDIA_GEN_PRIORITY_<FORMAT> names so existing VPS env files keep
 * working, then the built-in default.
 */
export function priorityFor(format: GatewayFormat): number {
  for (const prefix of [
    "MEDIA_PRIORITY_",
    "FASTGEN_PRIORITY_",
    "MEDIA_GEN_PRIORITY_",
  ]) {
    const override = process.env[`${prefix}${format}`];
    if (override) {
      const n = Number(override);
      if (Number.isFinite(n)) return n;
    }
  }
  return DEFAULT_PRIORITIES[format];
}

export function toGatewayFormat(raw: string | null | undefined): GatewayFormat {
  if (!raw) return "OTHER";
  if (raw in DEFAULT_PRIORITIES) return raw as GatewayFormat;
  return "OTHER";
}

export type MediaAspect = "16:9" | "9:16" | "1:1";

/**
 * Which upstream service fulfils the request.
 *
 *   veo_fleet  VEO Fleet Orchestrator (:8091) — the operator's VEO wrapper as
 *              it exists today. PRIMARY for image and video.
 *   veoforge   VeoForge (:5300) — the operator's own tool. Video-capable;
 *              images are inert pending an image-entitled pooled lease.
 *   vup        legacy direct-to-VM VUP wrapper (:5210). Superseded by
 *              veo_fleet, which fronts the same capacity via the bridge.
 *   forge      forge-api (VEO Studio wrapper).
 *   fastgen    fast-gen.ai — RETIRED, licence expired 2026-07-21. Reachable
 *              only via an explicit `backend`/`provider` pin, never routed to.
 *   ai33       last-resort image fallback (nano-banana via AI33), opt-in.
 */
export type MediaBackend =
  | "veo_fleet"
  | "veoforge"
  | "vup"
  | "forge"
  | "fastgen"
  | "ai33";

/**
 * Every backend, enumerated. Built from a `Record<MediaBackend, true>` so the
 * COMPILER rejects this list the moment a backend is added to the union above
 * and not listed here — a hand-maintained array would silently under-report,
 * and this list is what the essential-provider pre-flight iterates when it has
 * to state "these are the backends we probed".
 */
const MEDIA_BACKEND_PRESENCE: Record<MediaBackend, true> = {
  veo_fleet: true,
  veoforge: true,
  vup: true,
  forge: true,
  fastgen: true,
  ai33: true,
};

export const MEDIA_BACKENDS = Object.keys(
  MEDIA_BACKEND_PRESENCE,
) as MediaBackend[];

export interface ImageRequestOptions {
  format: GatewayFormat;
  /** Stable operation identity for providers supporting deduplicated submits. */
  idempotencyKey?: string;
  priority?: number;
  aspectRatio?: MediaAspect;
  /** Reference images as data: URIs (or http(s) URLs). veo_fleet accepts any
   *  number (it uploads each one and passes the file ids as
   *  `reference_images`); VUP takes exactly one; forge takes none. */
  referenceImages?: string[];
  /** Pin a specific fastgen upstream (flower/grok/openai/flow). Setting this
   *  forces the fastgen backend, which is RETIRED — the request will fail at
   *  the transport unless the operator has deliberately re-enabled it. */
  provider?: FastGenImageProvider;
  /** Pin the backend explicitly; otherwise routing tries veo_fleet, then vup,
   *  then forge (health-gated, capability-filtered — see index.ts). */
  backend?: MediaBackend;
  /**
   * Pin the upstream image MODEL, e.g. `"gpt-image-2"`.
   *
   * ONLY the `ai33` backend passes a model id upstream (`model_id` on
   * `POST /v1i/task/generate-image`). veo_fleet posts a fixed
   * `VEO_FLEET_IMAGE_MODEL`, vup posts a fixed `mode: "nano-banana"`, and forge
   * posts no model at all — so when one of those serves a request that named a
   * model, the gateway WARNS rather than letting the caller believe the pin was
   * honoured. It is never silently substituted, and never silently ignored.
   */
  imageModel?: string;
  /**
   * The `resolution` to send alongside `imageModel` (ai33 only), e.g. `"2K"`.
   * Omit when the chosen model declares no resolutions — several AI33 models
   * reject a task that carries one. The gateway forwards absence as absence.
   */
  imageResolution?: string;
  seed?: number;
  context?: string;
}

export interface VideoRequestOptions {
  format: GatewayFormat;
  priority?: number;
  aspectRatio?: MediaAspect;
  /** forge: "1080p" or "Original (720p)". vup: "720p" (default) or "1080p"
   *  (auto-downgrades on the current pool entitlement). */
  resolution?: string;
  backend?: MediaBackend;
  context?: string;
  maxWaitMs?: number;
}

/**
 * MediaRef — opaque result reference returned by the gateway.
 *   fleet:<fileId>     VEO Fleet Orchestrator stored file (GET /files/{id})
 *   veoforge:<url>     VeoForge result url (usually relative, /files/{name})
 *   vup:<relativeUrl>  VUP wrapper result file (e.g. /v1/files/{job}/{name})
 *   forge:<mediaId>    forge-api result file
 *   file:<hash>        fastgen storage object
 *   data:...           inline data URI (fastgen / ai33)
 * Resolve with downloadMedia() / downloadMediaBuffer(); never parse
 * these outside the gateway.
 */
export type MediaRef = string;
