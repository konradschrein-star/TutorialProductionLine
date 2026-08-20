import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { extname } from "node:path";
import {
  generateImage as fastgenGenerateImage,
  generateVideoFromText as fastgenVideoFromText,
  generateVideoFromImage as fastgenVideoFromImage,
  waitForOperation as fastgenWaitForOperation,
  downloadResult as fastgenDownloadResult,
  downloadResultToBuffer as fastgenDownloadResultToBuffer,
} from "../fastgen-client.js";
import {
  forgeConfigured,
  forgeHealthyCached,
  submitForgeImage,
  submitForgeVideo,
  submitForgeImageToVideo,
  uploadForgeInput,
  waitForForgeJob,
  downloadForgeMedia,
  downloadForgeMediaBuffer,
} from "./forge-client.js";
import {
  vupConfigured,
  vupHealthyCached,
  submitVupImage,
  submitVupVideo,
  submitVupImageToVideo,
  waitForVupJob,
  downloadVupFile,
  downloadVupFileBuffer,
} from "./vup-client.js";
import {
  veoFleetConfigured,
  veoFleetHealthyCached,
  veoFleetStalled,
  veoFleetHealthSnapshot,
  veoFleetEffectiveConcurrency,
  submitVeoFleetImage,
  submitVeoFleetVideo,
  uploadVeoFleetImage,
  waitForVeoFleetJob,
  downloadVeoFleetFile,
  downloadVeoFleetFileBuffer,
} from "./veo-fleet-client.js";
import {
  veoforgeConfigured,
  veoforgeHealthyCached,
  veoforgeHealthSnapshot,
  veoforgeImagesEnabled,
  submitVeoForgeImage,
  submitVeoForgeVideo,
  waitForVeoForgeJob,
  downloadVeoForgeFile,
  downloadVeoForgeFileBuffer,
} from "./veoforge-client.js";
import { generateImage as ai33GenerateImage } from "../ai33-client.js";
import {
  reportSpend,
  estimateImageCostEur,
  estimateVideoCostEur,
} from "../spend-reporter.js";
import {
  isBackendBlocked,
  blockReason,
  reportProviderUse,
} from "./registry-bridge.js";
import {
  priorityFor,
  toGatewayFormat,
  type GatewayFormat,
  type ImageRequestOptions,
  type VideoRequestOptions,
  type MediaBackend,
  type MediaRef,
} from "./types.js";

export {
  toGatewayFormat,
  type GatewayFormat,
  type ImageRequestOptions,
  type VideoRequestOptions,
  type MediaBackend,
  type MediaRef,
} from "./types.js";

/**
 * Unified media generation gateway — the ONLY entry point for image and
 * video generation across all content formats.
 *
 *   1. One priority queue across all formats (TUTORIAL_STUDIO highest,
 *      STOCK_LIBRARY lowest; override via MEDIA_PRIORITY_<FORMAT>).
 *   2. Backend routing (rewritten 2026-07-30):
 *        image  veo_fleet → vup → forge → [veoforge] → ai33
 *        video  veo_fleet → veoforge → vup → forge
 *      veo_fleet (VEO Fleet Orchestrator, :8091) is PRIMARY for both. It is
 *      the operator's VEO wrapper as it exists today: a durable job queue on
 *      the VPS that VM workers pull from, which is why the legacy direct
 *      vup:5210 path reads dead while generation capacity is fine.
 *      veoforge (:5300) is the operator's own tool — video-capable, images
 *      inert pending an image-entitled lease. `MEDIA_VIDEO_PRIMARY=veoforge`
 *      promotes it to first for video without a deploy.
 *      fastgen is RETIRED (licence expired 2026-07-21) and is no longer in
 *      any default chain — only an explicit backend/provider pin reaches it.
 *      Routing is health-gated and capability-filtered (see structuralOrder
 *      below); a request that fails on one backend is retried once on the
 *      next compatible backend.
 *   3. Requests that need capabilities a backend lacks (reference images on
 *      forge, >1 reference on vup, 1:1 aspect on forge) skip that backend
 *      entirely rather than failing into it.
 *   4. Per-backend concurrency caps; veo_fleet, veoforge, forge-api and VUP
 *      all additionally queue server-side, so a brief overshoot during
 *      failover is harmless.
 *
 * No synthetic fallbacks: when no backend can serve a request the promise
 * rejects and BullMQ retry policy takes over.
 */

const VUP_MAX_CONCURRENT = Number(process.env["VUP_MAX_CONCURRENT"] ?? "6");
const FORGE_MAX_CONCURRENT = Number(process.env["FORGE_MAX_CONCURRENT"] ?? "4");
// Ceiling only. The fleet advertises `capacity.concurrent_max: 12`, but a
// worker can only run as many jobs as it holds upstream account slots
// (`assigned_apis`) — measured at 3 on 2026-07-31 while it still advertised
// 12. The live probe below narrows this; the env value is the cap that
// applies when the probe has not (yet) succeeded.
const VEO_FLEET_MAX_CONCURRENT = Number(
  process.env["VEO_FLEET_MAX_CONCURRENT"] ?? "12",
);

/**
 * Admission cap for the fleet: the live account-slot count when we have one,
 * otherwise the configured ceiling. Never exceeds the configured ceiling, so
 * setting VEO_FLEET_MAX_CONCURRENT lower always wins.
 *
 * This is what stops the gateway from holding a request against a backend
 * that has no free slot while a healthy provider sits idle — admitting 12
 * against 3 real slots does not speed anything up, it just hides the queue.
 */
function veoFleetAdmissionCap(): number {
  const live = veoFleetEffectiveConcurrency();
  if (live === null || live < 1) return VEO_FLEET_MAX_CONCURRENT;
  return Math.min(live, VEO_FLEET_MAX_CONCURRENT);
}
// VeoForge throughput is bounded by its live account pool, not by its 16
// configured workers. MEASURED 2026-07-31 with a healthy pool (25 accounts /
// 24 healthy / 16 sessions): 4 concurrent videos all completed. 6 is a
// deliberately conservative default — raise it once a burst above 4 has
// actually been observed to hold, since overshoot here burns account quota
// rather than queueing harmlessly.
const VEOFORGE_MAX_CONCURRENT = Number(
  process.env["VEOFORGE_MAX_CONCURRENT"] ?? "6",
);
const FASTGEN_MAX_CONCURRENT_IMAGE = Number(
  process.env["FASTGEN_MAX_CONCURRENT"] ?? "8",
);
const FASTGEN_MAX_CONCURRENT_VIDEO = Number(
  process.env["FASTGEN_MAX_CONCURRENT_VIDEO"] ??
    process.env["MEDIA_GEN_MAX_CONCURRENT_VIDEO"] ??
    "6",
);
const VUP_IMAGE_TIMEOUT_MS = Number(
  process.env["VUP_IMAGE_TIMEOUT_MS"] ?? String(15 * 60_000),
);
const VUP_VIDEO_TIMEOUT_MS = Number(
  process.env["VUP_VIDEO_TIMEOUT_MS"] ?? String(45 * 60_000),
);
const FORGE_IMAGE_TIMEOUT_MS = Number(
  process.env["FORGE_IMAGE_TIMEOUT_MS"] ?? String(15 * 60_000),
);
const FORGE_VIDEO_TIMEOUT_MS = Number(
  process.env["FORGE_VIDEO_TIMEOUT_MS"] ?? String(45 * 60_000),
);
// Measured 2026-07-30: a fleet image completes in ~26s. 10 min is a generous
// deadline that still fails fast enough to fail over while the job matters.
const VEO_FLEET_IMAGE_TIMEOUT_MS = Number(
  process.env["VEO_FLEET_IMAGE_TIMEOUT_MS"] ?? String(10 * 60_000),
);
const VEO_FLEET_VIDEO_TIMEOUT_MS = Number(
  process.env["VEO_FLEET_VIDEO_TIMEOUT_MS"] ?? String(45 * 60_000),
);
const VEOFORGE_IMAGE_TIMEOUT_MS = Number(
  process.env["VEOFORGE_IMAGE_TIMEOUT_MS"] ?? String(10 * 60_000),
);
const VEOFORGE_VIDEO_TIMEOUT_MS = Number(
  process.env["VEOFORGE_VIDEO_TIMEOUT_MS"] ?? String(45 * 60_000),
);

type EntryKind = "image" | "video_text" | "video_image";

/**
 * Which backend actually served a request, the chain it was routed through
 * (position 0 = what we WANTED) and whether a fallback fired. This is the truth
 * the gateway already knows internally (it passes servedProvider to
 * reportProviderUse) but never returned to callers — the gap the thumbnail
 * engine needs to close for the §2.6 fallback-visibility guarantee.
 */
export interface ServedInfo {
  servedBy: MediaBackend;
  chain: MediaBackend[];
  fallbackUsed: boolean;
  attempts: number;
}

export interface DetailedMediaResult extends ServedInfo {
  ref: MediaRef;
}

interface QueueEntry {
  kind: EntryKind;
  prompt: string;
  /** video_image only: local path, data: URI, file:<hash>, forge:<id>, or vup:<url> */
  image?: string;
  options: ImageRequestOptions | VideoRequestOptions;
  priority: number;
  enqueuedAt: number;
  resolve: (ref: MediaRef) => void;
  reject: (err: Error) => void;
  /** Optional: populated with the served backend/chain before resolve(). */
  onServed?: (info: ServedInfo) => void;
}

/**
 * Which backend leads the video chain. VeoForge is the operator's own tool and
 * the strategic primary, but as of 2026-07-30 its account pool is dry (both
 * harvested sessions expired → 401/CHALLENGE) while veo_fleet has 254
 * successful video jobs behind it. Evidence wins by default; flip this env var
 * the moment a fresh session is imported, no deploy needed. Either way the
 * loser stays in the chain and is health-gated, so neither is a dead end.
 */
const VIDEO_PRIMARY: MediaBackend =
  process.env["MEDIA_VIDEO_PRIMARY"] === "veoforge" ? "veoforge" : "veo_fleet";

/**
 * Is AI33 allowed to appear in the DEFAULT image chain at all?
 *
 * Default: NO. AI33 is a third-party, metered, historically unreliable service.
 * It is acceptable as a deliberate "everything else is dead, throw it at AI33"
 * lever — it is NOT acceptable as something the system can drift onto while
 * appearing to work. A silent downgrade to AI33 is indistinguishable from
 * success at the call site, which is precisely the failure mode this gateway
 * exists to prevent.
 *
 * Why an env flag and not just the provider registry: the registry bridge is
 * deliberately FAIL-OPEN (a broken observability layer must never stop
 * production). That is the right policy for a *gate*, but it means a DB that is
 * down, unmigrated, or still loading leaves AI33 unblocked — and the registry
 * row is the only thing that was holding it back. Structural exclusion here
 * does not depend on the database being reachable.
 *
 * `backend: "ai33"` still reaches it as an explicit pin, which is the honest
 * way to ask for it: the caller named it, so nothing is silent.
 */
function ai33ImageFallbackEnabled(): boolean {
  return process.env["MEDIA_ALLOW_AI33_IMAGE"] === "1";
}

/**
 * AI33's default image model when the operator has not pinned one.
 *
 * Nano Banana 2. This is the same id `@repo/media-core` names as its own
 * `PRIMARY_MODEL`, and the two must agree: the gateway ALWAYS passes a model
 * override, so media-core's constant is unreachable and a disagreement here is
 * invisible until someone reads the logs and finds a model nobody selected.
 *
 * It was `gpt-image-2` until 2026-08-16. That value is BUSINESS_PLAN_HUB's
 * deliberate choice, not a host-wide one, and it now lives with that format in
 * `DEFAULT_BUSINESS_HUB_IMAGE_MODEL` where it belongs. Setting it here made
 * every other surface — tutorial scene images and thumbnails included — serve
 * from a model chosen for a different format.
 */
export const AI33_DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
/** AI33's default output resolution. */
export const AI33_DEFAULT_IMAGE_RESOLUTION = "2K";

/**
 * Which AI33 model serves an image, and at what resolution.
 *
 * WHY THIS IS NOT `undefined`. The ai33 branch used to pass no model override,
 * which drops through to `@repo/media-core`'s own PRIMARY_MODEL constant
 * (`gemini-3.1-flash-image-preview`). That made the model a property of a
 * library default two packages away instead of the operator's `AI33_IMAGE_MODEL`
 * setting — so the env var appeared to work while changing nothing, and every
 * format silently shared one hardcoded model. `GET /v1i/models` returns the
 * live list; pin with AI33_IMAGE_MODEL rather than editing this constant.
 */
export function ai33ImageModel(options?: {
  imageModel?: string;
  imageResolution?: string;
}): { id: string; resolution?: string } {
  const pinnedModel = options?.imageModel?.trim();
  const id =
    pinnedModel ||
    process.env["AI33_IMAGE_MODEL"]?.trim() ||
    AI33_DEFAULT_IMAGE_MODEL;

  const pinnedResolution = options?.imageResolution?.trim();
  if (pinnedResolution) return { id, resolution: pinnedResolution };

  // A per-request MODEL pin does NOT inherit the ambient resolution. Of the 20
  // models `GET /v1i/models` lists, seven declare no resolutions at all and
  // reject a task that carries one, and the others disagree about which values
  // exist (`512`/`1K`/`2K`/`3K`/`4K`/`720p`/`1080p`). `AI33_IMAGE_RESOLUTION`
  // was chosen for whatever model the env pinned, so applying it to a model the
  // caller picked in the UI is how a comparison run fails on a parameter nobody
  // selected. Absent stays absent; the caller states the resolution or AI33
  // uses that model's own default.
  if (pinnedModel) return { id };

  const resolution =
    process.env["AI33_IMAGE_RESOLUTION"]?.trim() ||
    AI33_DEFAULT_IMAGE_RESOLUTION;
  return { id, resolution };
}

/**
 * Bind uploaded reference images to the prompt for AI33.
 *
 * AI33 does NOT apply an uploaded asset just because it was attached: the
 * prompt must name it as `@img1`, `@img2`… (see `buildReferenceInjectedPrompt`
 * in `@repo/domain`, and the `prompt_has_placeholders` field media-core logs).
 * An unnamed asset is uploaded, billed, and ignored.
 *
 * That is a silent style failure of exactly the kind this gateway exists to
 * prevent: BUSINESS_PLAN_HUB passes its canonical style plate as
 * `options.referenceImages`, and without this binding the plate would be sent
 * on every generation while the frames drifted anyway — with nothing in any log
 * to say so. Callers that already inject their own placeholders are left alone.
 */
export function ai33PromptWithReferences(
  prompt: string,
  referenceCount: number,
): string {
  if (referenceCount <= 0) return prompt;
  if (/@img\d+/.test(prompt)) return prompt;
  const refs = Array.from(
    { length: referenceCount },
    (_, i) => `@img${i + 1}`,
  ).join(" ");
  return (
    `${refs} Copy the visual style of the reference image(s) above exactly — ` +
    `surface, colour palette, lighting direction and lens character. Do not ` +
    `copy their subject matter. ${prompt}`
  );
}

/**
 * Backend precedence for a request, filtered to backends that can
 * structurally serve it.
 *
 * fastgen is deliberately NOT in any default chain any more — its licence
 * expired 2026-07-21 and routing to it produced the silent Nano-Banana-2 →
 * Seedream downgrade this system exists to prevent. It remains reachable only
 * through an explicit `backend: "fastgen"` or `provider` pin.
 */
/**
 * How many i2i reference images each backend can actually CARRY on an image
 * request. Read straight off `run()` below — this is not aspiration, it is
 * what the transport does with `options.referenceImages`:
 *
 *   veo_fleet  uploads every ref → VM worker → VUP             → 10
 *   ai33       forwards every decoded ref                      → unbounded
 *   fastgen    forwards referenceImages verbatim               → unbounded
 *   vup        sends `referenceImage: referenceImages[0]`      → 1
 *   forge      submitForgeImage takes prompt + aspect only     → 0
 *   veoforge   sends `reference_images[]` → Whisk referenceInputs → 3
 *
 * The veoforge cap is 3 because that is what its upstream (Google Whisk) has
 * slots for: CHARACTER / LOCATION / STYLE. Position is translated to slot in
 * veoforge-client (see VEOFORGE_REFERENCE_SLOTS); a 4th reference is a hard
 * error, not a drop. NOTE this describes the TRANSPORT only — VeoForge's image
 * path has never completed a single job (see the note in veoforge-client), so
 * this capability is what it will carry once entitlement lands, not evidence
 * that it works. Routing is gated separately on veoforgeImagesEnabled().
 *
 * A backend whose cap is below the request's reference count does NOT fail —
 * it succeeds while silently DROPPING references. That is the exact failure
 * mode that lost the channel persona on every thumbnail: the host's face was
 * attached, routed to a backend that ignores extra references, and the model
 * never saw it. Capability is therefore a routing filter, never a warning.
 *
 * veo_fleet's ceiling is NOT unbounded, and it is not set here (2026-08-02
 * investigation). The chain is CF → veo_fleet orchestrator (:8091) → VM
 * worker → the VeoUnlimited Pro app on the VM (:5100) — "VUP". The worker
 * base64s every reference into VUP's `nbiImages` array; VUP then applies them
 * according to `nbiImageMode`. Its "multi-ref" mode applies ALL references to
 * every prompt and its own UI refuses the 11th ("Max 10 images allowed"),
 * so 10 is the real upstream ceiling. Each reference must be ≤ 1 MB.
 * The worker used to hardcode `nbiImageMode: "single"`, which makes VUP use
 * `nbiImages[0]` ONLY — every extra reference was silently discarded, i.e.
 * veo_fleet's effective cap was 1, not ∞. Fixed in the worker on the VM
 * (`worker/agent.py::_build_body`, 2026-08-02); this table now matches it.
 *
 * `vup: 1` below is the LEGACY direct path (vup-client.ts → :5210). That
 * Python wrapper no longer runs anywhere — the port is closed on the VM — so
 * the hop is health-gated out in practice. Its 1-reference limit is a
 * property of that dead client, not of VUP itself.
 */
/** VUP nano-banana multi-ref ceiling; its UI rejects the 11th reference. */
const VUP_MAX_IMAGE_REFERENCES = 10;

const MAX_IMAGE_REFERENCES: Record<MediaBackend, number> = {
  veo_fleet: VUP_MAX_IMAGE_REFERENCES,
  ai33: Number.POSITIVE_INFINITY,
  fastgen: Number.POSITIVE_INFINITY,
  vup: 1,
  forge: 0,
  veoforge: 3,
};

/** How many i2i references `backend` can carry without dropping any. */
export function maxImageReferences(backend: MediaBackend): number {
  return MAX_IMAGE_REFERENCES[backend] ?? 0;
}

/**
 * Hard prompt ceiling per backend, read off each client's own
 * `assertPromptLength`. veo_fleet, veoforge and vup all REJECT above 2000
 * characters — they do not truncate. A caller that builds a longer prompt does
 * not get a worse image, it gets no image, which is how two of the most recent
 * production thumbnail failures read verbatim ("prompt exceeds 2000 char
 * limit (2095)"). Callers that compose prompts must budget against this.
 *
 * NOTE (2026-08-02): 2000 is OUR ceiling, not an upstream one. Neither VUP
 * (:5100) nor the veo_fleet orchestrator validates prompt length anywhere,
 * and Nano Banana / Flow imposes no 2000-character limit of its own — the
 * number originates in these three clients' `assertPromptLength`. Keep the
 * table and the asserts in lockstep: raising a value here without raising the
 * matching client assert would just move the rejection, not remove it.
 */
const MAX_PROMPT_CHARS_BY_BACKEND: Record<MediaBackend, number> = {
  veo_fleet: 2000,
  veoforge: 2000,
  vup: 2000,
  forge: Number.POSITIVE_INFINITY,
  ai33: Number.POSITIVE_INFINITY,
  fastgen: Number.POSITIVE_INFINITY,
};

/** Longest prompt `backend` accepts without rejecting the request. */
export function maxPromptChars(backend: MediaBackend): number {
  return MAX_PROMPT_CHARS_BY_BACKEND[backend] ?? Number.POSITIVE_INFINITY;
}

function structuralOrder(entry: QueueEntry): MediaBackend[] {
  if (entry.kind === "image") {
    const o = entry.options as ImageRequestOptions;
    const refCount = o.referenceImages?.length ?? 0;
    // An explicit fastgen upstream pin is honoured as a pin — nothing else can
    // serve "this specific fast-gen provider", so there is nothing to fall
    // back to. It will fail loudly at the transport while the licence is dead.
    if (o.provider) return ["fastgen"];
    // veo_fleet handles 0..10 references (it uploads each, and the VM worker
    // hands them all to VUP in multi-ref mode), any aspect, and is the only
    // backend that produced a real image today.
    const order: MediaBackend[] = ["veo_fleet"];
    // Legacy direct-VUP hop: its client sends referenceImages[0] only.
    if (refCount <= 1) order.push("vup");
    if (refCount === 0 && o.aspectRatio !== "1:1") order.push("forge");
    // VeoForge images are inert until an image-entitled lease exists; only
    // offer the hop once the operator has switched it on. It now carries up to
    // three references (Whisk's CHARACTER/LOCATION/STYLE slots), so it is no
    // longer restricted to reference-free requests — but a 4th reference would
    // be dropped, and a dropped persona is worse than a failover.
    if (veoforgeImagesEnabled() && refCount <= maxImageReferences("veoforge")) {
      order.push("veoforge");
    }
    // AI33 is NOT in the default chain. See ai33ImageFallbackEnabled().
    if (ai33ImageFallbackEnabled()) order.push("ai33");
    return order;
  }
  const o = entry.options as VideoRequestOptions;
  const order: MediaBackend[] =
    VIDEO_PRIMARY === "veoforge"
      ? ["veoforge", "veo_fleet"]
      : ["veo_fleet", "veoforge"];
  order.push("vup");
  if (o.aspectRatio !== "1:1") order.push("forge");
  return order;
}

function backendConfigured(backend: MediaBackend): boolean {
  if (backend === "veo_fleet") return veoFleetConfigured();
  if (backend === "veoforge") return veoforgeConfigured();
  if (backend === "vup") return vupConfigured();
  if (backend === "forge") return forgeConfigured();
  if (backend === "ai33") return !!process.env["AI33_API_KEY"];
  return true; // fastgen key optionality is handled inside fastgen-client
}

function backendHealthy(backend: MediaBackend): boolean {
  if (backend === "veo_fleet") return veoFleetHealthyCached();
  if (backend === "veoforge") return veoforgeHealthyCached();
  if (backend === "vup") return vupHealthyCached();
  if (backend === "forge") return forgeHealthyCached();
  return true;
}

/**
 * Three-state health, because "we probed it and it answered" and "we have no
 * probe for this backend at all" are not the same claim.
 *
 * ai33 and fastgen have no health probe — backendHealthy() reports `true` for
 * them unconditionally. Collapsing that into the same boolean as a real green
 * probe caused a live routing bug (2026-07-31): for the first seconds after a
 * worker restart, veo_fleet's probe had not returned yet, so a first-healthy
 * scan skipped it and handed every image to ai33 — a paid, non-primary
 * backend sitting LAST in the chain and disabled in the registry. It was only
 * visible because AI33 was 401ing; with credits it would have quietly served
 * the wrong images on every restart.
 *
 * "unknown" means: no verdict yet. It must never outrank an earlier hop.
 */
type BackendHealthState = "healthy" | "unhealthy" | "unknown";

function backendHealthState(backend: MediaBackend): BackendHealthState {
  if (backend === "veo_fleet") {
    if (veoFleetHealthyCached()) return "healthy";
    // checkedAt === null → the boot probe has not come back yet.
    return veoFleetHealthSnapshot().checkedAt === null
      ? "unknown"
      : "unhealthy";
  }
  if (backend === "veoforge") {
    if (veoforgeHealthyCached()) return "healthy";
    return veoforgeHealthSnapshot().checkedAt === null
      ? "unknown"
      : "unhealthy";
  }
  if (backend === "vup") return vupHealthyCached() ? "healthy" : "unhealthy";
  if (backend === "forge")
    return forgeHealthyCached() ? "healthy" : "unhealthy";
  // ai33 / fastgen: no probe exists. Never claim green.
  return "unknown";
}

/**
 * A backend we have PROBED and which told us it cannot produce output right
 * now — as opposed to one we merely failed to reach, or have not asked yet.
 *
 * Only veo_fleet publishes throughput, so only veo_fleet can be measured
 * incapable rather than presumed so. This is the one thing allowed to override
 * the last-resort pass below: that pass exists because health is a cached
 * heuristic and the transport is the authority, but a fresh stall verdict IS a
 * reading of the transport. Submitting anyway does not produce an image, it
 * produces an eighth-minute wait and one more job in a queue that is already
 * not draining.
 */
function backendMeasuredUnable(backend: MediaBackend): boolean {
  return backend === "veo_fleet" && veoFleetStalled();
}

/** Which capability a queue entry consumes, in registry vocabulary. */
function capabilityOf(entry: QueueEntry): "image" | "video" {
  return entry.kind === "image" ? "image" : "video";
}

/**
 * The candidate backends for this request after BOTH filters:
 * structural capability (what a backend can physically do) and the provider
 * registry (what the operator has switched on, and what has not expired).
 *
 * When the registry is unavailable this is identical to structuralOrder() —
 * fail open, see registry-bridge.ts.
 *
 * A pinned backend is a chain of exactly itself: the caller asked for it by
 * name, so there is nothing to fall back to and nothing to flag.
 */
function candidateOrder(entry: QueueEntry): MediaBackend[] {
  if (entry.options.backend) return [entry.options.backend];
  const capability = capabilityOf(entry);
  const allowed: MediaBackend[] = [];
  for (const backend of structuralOrder(entry)) {
    if (!backendConfigured(backend)) continue;
    if (isBackendBlocked(capability, backend)) {
      const reason = blockReason(capability, backend);
      if (reason) {
        console.log(
          JSON.stringify({
            level: "info",
            message: "media-gateway skipping backend",
            backend,
            capability,
            reason,
            format: entry.options.format,
            context: entry.options.context,
          }),
        );
      }
      continue;
    }
    allowed.push(backend);
  }
  return allowed;
}

/**
 * Pick a backend, or null when nothing can serve the request.
 *
 * Returning null (rather than quietly picking a dead rung) is what makes the
 * "no synthetic fallbacks" rule enforceable: the caller turns it into an
 * explicit rejection naming every backend that was considered and why each was
 * ruled out. A request that cannot be served must fail loudly and legibly —
 * substituting placeholder media produces unuploadable videos.
 */
function routeFor(entry: QueueEntry): MediaBackend | null {
  if (entry.options.backend) return entry.options.backend;
  const candidates = candidateOrder(entry);

  // Pass 1 — the earliest hop we have actually confirmed is up.
  for (const backend of candidates) {
    if (backendHealthState(backend) === "healthy") return backend;
  }
  // Pass 2 — nothing is confirmed up. Prefer the earliest hop with no verdict
  // yet (probe still in flight, or a backend that has no probe) over a hop we
  // positively know is down. Chain order decides, so a pending primary still
  // beats an unprobed last-resort.
  for (const backend of candidates) {
    if (backendHealthState(backend) === "unknown") return backend;
  }
  // Pass 3 — everything is known-down. Try the first anyway: health is a
  // cached heuristic, the transport is the authority, and a stale-unhealthy
  // probe must not strand a live backend. The one exception is a backend we
  // have just MEASURED to be producing nothing — that is not a stale guess,
  // and "try it anyway" against a wedged queue is how 74 thumbnails each
  // burned 480s before failing on 2026-08-05.
  const lastResort = candidates.filter((b) => !backendMeasuredUnable(b));
  if (lastResort.length > 0) return lastResort[0]!;
  return null;
}

/**
 * Why each structurally-capable backend was ruled out. Never invented — every
 * clause is read back from the same predicates routing itself used.
 */
function noBackendError(entry: QueueEntry): Error {
  const capability = capabilityOf(entry);
  const reasons = structuralOrder(entry).map((backend) => {
    if (!backendConfigured(backend))
      return `${backend}: not configured (no key)`;
    if (isBackendBlocked(capability, backend)) {
      return `${backend}: ${blockReason(capability, backend) ?? "blocked by provider registry"}`;
    }
    if (!backendHealthy(backend)) {
      // "health probe not green" tells an operator nothing at 3am. When we
      // have a measured reason, it travels all the way into the rejection.
      const reason =
        backend === "veo_fleet" ? veoFleetHealthSnapshot().readyReason : null;
      return reason
        ? `${backend}: not ready — ${reason}`
        : `${backend}: health probe not green`;
    }
    return `${backend}: eligible`;
  });
  return new Error(
    `media-gateway: no backend can serve this ${capability} request ` +
      `(format=${entry.options.format}, context=${entry.options.context ?? "none"}). ` +
      `Backends tried — ${reasons.join("; ")}. ` +
      "Refusing to substitute placeholder media.",
  );
}

class MediaGateway {
  private queue: QueueEntry[] = [];
  private veoFleetInFlight = 0;
  private veoforgeInFlight = 0;
  private vupInFlight = 0;
  private forgeInFlight = 0;
  private fastgenImageInFlight = 0;
  private fastgenVideoInFlight = 0;
  private idleTickHandle: NodeJS.Immediate | null = null;

  enqueue(
    kind: EntryKind,
    prompt: string,
    options: ImageRequestOptions | VideoRequestOptions,
    image?: string,
    onServed?: (info: ServedInfo) => void,
  ): Promise<MediaRef> {
    const priority = options.priority ?? priorityFor(options.format);
    return new Promise((resolve, reject) => {
      this.queue.push({
        kind,
        prompt,
        image,
        options,
        priority,
        enqueuedAt: Date.now(),
        resolve,
        reject,
        ...(onServed ? { onServed } : {}),
      });
      this.queue.sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.enqueuedAt - b.enqueuedAt;
      });
      this.scheduleTick();
    });
  }

  private scheduleTick(): void {
    if (this.idleTickHandle != null) return;
    this.idleTickHandle = setImmediate(() => {
      this.idleTickHandle = null;
      this.drain();
    });
  }

  private hasCapacity(backend: MediaBackend, kind: EntryKind): boolean {
    if (backend === "veo_fleet") {
      return this.veoFleetInFlight < veoFleetAdmissionCap();
    }
    if (backend === "veoforge") {
      return this.veoforgeInFlight < VEOFORGE_MAX_CONCURRENT;
    }
    if (backend === "vup") return this.vupInFlight < VUP_MAX_CONCURRENT;
    if (backend === "forge") return this.forgeInFlight < FORGE_MAX_CONCURRENT;
    return kind === "image"
      ? this.fastgenImageInFlight < FASTGEN_MAX_CONCURRENT_IMAGE
      : this.fastgenVideoInFlight < FASTGEN_MAX_CONCURRENT_VIDEO;
  }

  private acquire(backend: MediaBackend, kind: EntryKind): void {
    if (backend === "veo_fleet") this.veoFleetInFlight++;
    else if (backend === "veoforge") this.veoforgeInFlight++;
    else if (backend === "vup") this.vupInFlight++;
    else if (backend === "forge") this.forgeInFlight++;
    else if (kind === "image") this.fastgenImageInFlight++;
    else this.fastgenVideoInFlight++;
  }

  private release(backend: MediaBackend, kind: EntryKind): void {
    if (backend === "veo_fleet") this.veoFleetInFlight--;
    else if (backend === "veoforge") this.veoforgeInFlight--;
    else if (backend === "vup") this.vupInFlight--;
    else if (backend === "forge") this.forgeInFlight--;
    else if (kind === "image") this.fastgenImageInFlight--;
    else this.fastgenVideoInFlight--;
  }

  private drain(): void {
    // Scan in priority order; an entry whose backend pool is full doesn't
    // block entries behind it that target the other backend.
    for (let i = 0; i < this.queue.length; ) {
      const entry = this.queue[i]!;
      const backend = routeFor(entry);
      if (backend === null) {
        // Nothing can serve it. Reject now with a full diagnosis rather than
        // dispatching into a backend we already know is unusable.
        this.queue.splice(i, 1);
        entry.reject(noBackendError(entry));
        continue;
      }
      if (!this.hasCapacity(backend, entry.kind)) {
        i++;
        continue;
      }
      this.queue.splice(i, 1);
      this.acquire(backend, entry.kind);
      void this.process(entry, backend).finally(() => {
        this.release(backend, entry.kind);
        this.scheduleTick();
      });
    }
  }

  private async process(
    entry: QueueEntry,
    backend: MediaBackend,
  ): Promise<void> {
    const waited = Date.now() - entry.enqueuedAt;
    console.log(
      JSON.stringify({
        level: "info",
        message: "media-gateway dispatching",
        kind: entry.kind,
        backend,
        format: entry.options.format,
        priority: entry.priority,
        queued_ms: waited,
        context: entry.options.context,
      }),
    );
    // The candidate chain this request was routed through. Position 0 is what
    // we WANTED; anything else that ends up serving it is a fallback and is
    // recorded as one.
    const chain = candidateOrder(entry);
    const capability = capabilityOf(entry);
    const pinned = Boolean(entry.options.backend);
    const consumer = entry.options.format;

    const started = Date.now();
    try {
      const result = await this.run(entry, backend);
      reportProviderUse({
        capability,
        consumer,
        chain,
        servedProvider: backend,
        pinned,
        outcome: "success",
        latencyMs: Date.now() - started,
        context: entry.options.context ?? null,
      });
      entry.onServed?.({
        servedBy: backend,
        chain,
        fallbackUsed: chain.length > 0 && backend !== chain[0],
        attempts: 1,
      });
      entry.resolve(result);
    } catch (firstErr) {
      reportProviderUse({
        capability,
        consumer,
        chain,
        servedProvider: backend,
        pinned,
        outcome: "error",
        latencyMs: Date.now() - started,
        context: entry.options.context ?? null,
        error:
          firstErr instanceof Error
            ? firstErr.message.slice(0, 300)
            : String(firstErr),
      });
      const alt = this.alternateBackend(entry, backend);
      if (!alt) {
        entry.reject(
          firstErr instanceof Error ? firstErr : new Error(String(firstErr)),
        );
        return;
      }
      console.warn(
        JSON.stringify({
          level: "warn",
          message: `media-gateway ${backend} failed, retrying on ${alt}`,
          kind: entry.kind,
          format: entry.options.format,
          context: entry.options.context,
          error:
            firstErr instanceof Error
              ? firstErr.message.slice(0, 300)
              : String(firstErr),
        }),
      );
      const retryStarted = Date.now();
      try {
        const result = await this.run(entry, alt);
        reportProviderUse({
          capability,
          consumer,
          chain,
          servedProvider: alt,
          pinned,
          outcome: "success",
          latencyMs: Date.now() - retryStarted,
          context: entry.options.context ?? null,
        });
        entry.onServed?.({
          servedBy: alt,
          chain,
          fallbackUsed: true, // a retry on a different backend is by definition a fallback
          attempts: 2,
        });
        entry.resolve(result);
      } catch (secondErr) {
        reportProviderUse({
          capability,
          consumer,
          chain,
          servedProvider: alt,
          pinned,
          outcome: "error",
          latencyMs: Date.now() - retryStarted,
          context: entry.options.context ?? null,
          error:
            secondErr instanceof Error
              ? secondErr.message.slice(0, 300)
              : String(secondErr),
        });
        entry.reject(
          secondErr instanceof Error ? secondErr : new Error(String(secondErr)),
        );
      }
    }
  }

  private alternateBackend(
    entry: QueueEntry,
    failed: MediaBackend,
  ): MediaBackend | null {
    if (entry.options.backend) return null; // pinned — no failover
    // Retry only within the REGISTRY-APPROVED candidates. Without this, a
    // failure on the primary could still land on a backend the operator
    // switched off (or whose licence expired) — the exact silent downgrade
    // this registry exists to prevent.
    const order = candidateOrder(entry);
    const idx = order.indexOf(failed);
    const rest = idx === -1 ? order : order.slice(idx + 1);
    return rest.find((backend) => backendConfigured(backend)) ?? null;
  }

  private async run(
    entry: QueueEntry,
    backend: MediaBackend,
  ): Promise<MediaRef> {
    if (entry.kind === "image") {
      const o = entry.options as ImageRequestOptions;
      // A model pin only reaches ai33 (see ImageRequestOptions.imageModel).
      // Say so out loud when anything else is about to serve: the operator who
      // set the model is comparing models, so a frame drawn by a different one
      // than he asked for must never be indistinguishable from one that was.
      if (o.imageModel !== undefined && backend !== "ai33") {
        console.warn(
          JSON.stringify({
            level: "warn",
            message:
              "media-gateway: image model pin NOT honoured — this backend posts a fixed model",
            requested_model: o.imageModel,
            served_by: backend,
            format: o.format,
            context: o.context,
          }),
        );
      }
      if (backend === "veo_fleet") {
        // Reference images are uploaded first; the fleet takes file ids, and
        // unlike VUP it accepts any number of them.
        const referenceImageIds = await Promise.all(
          (o.referenceImages ?? []).map(async (ref, i) =>
            uploadVeoFleetImage(
              await resolveImageBytes(ref),
              `ref${i}${inputFilename(ref) === "input.jpg" ? ".jpg" : ".png"}`,
            ),
          ),
        );
        const [jobId] = await submitVeoFleetImage(entry.prompt, {
          aspectRatio: o.aspectRatio,
          referenceImageIds,
        });
        const [fileId] = await waitForVeoFleetJob(jobId!, {
          timeoutMs: VEO_FLEET_IMAGE_TIMEOUT_MS,
        });
        this.spend("veo_fleet", "image", o);
        return `fleet:${fileId}`;
      }
      if (backend === "veoforge") {
        // Throws a clear not-entitled error unless VEOFORGE_IMAGES_ENABLED=1.
        // Same positional contract as veo_fleet above: [0] archetype/style,
        // [1] channel persona, [2] extra. veoforge-client maps position to
        // Whisk's named slots.
        const veoforgeRefs = await Promise.all(
          (o.referenceImages ?? []).map((ref) => resolveImageBytes(ref)),
        );
        const jobId = await submitVeoForgeImage(entry.prompt, {
          aspectRatio: o.aspectRatio,
          referenceImages: veoforgeRefs,
        });
        const [url] = await waitForVeoForgeJob(jobId, {
          timeoutMs: VEOFORGE_IMAGE_TIMEOUT_MS,
        });
        this.spend("veoforge", "image", o);
        return `veoforge:${url}`;
      }
      if (backend === "vup") {
        const jobId = await submitVupImage(entry.prompt, {
          aspectRatio: o.aspectRatio,
          referenceImage: o.referenceImages?.[0],
        });
        const [url] = await waitForVupJob(jobId, {
          timeoutMs: VUP_IMAGE_TIMEOUT_MS,
        });
        this.spend("vup", "image", o);
        return `vup:${url}`;
      }
      if (backend === "forge") {
        const jobId = await submitForgeImage(entry.prompt, {
          aspectRatio: o.aspectRatio,
        });
        const [fileId] = await waitForForgeJob(jobId, {
          timeoutMs: FORGE_IMAGE_TIMEOUT_MS,
        });
        this.spend("forge-api", "image", o);
        return `forge:${fileId}`;
      }
      if (backend === "ai33") {
        // Last-resort image fallback: nano-banana via AI33 (dual-key failover
        // handled inside ai33-client). Returns a Buffer, so encode it as a
        // data: URI MediaRef (downloadMedia* already resolve data: refs).
        const apiKey = process.env["AI33_API_KEY"];
        if (!apiKey) {
          throw new Error(
            "media-gateway: AI33_API_KEY not set for ai33 image fallback",
          );
        }
        // AI33 serving a request is an EVENT, not a routine hop. It is
        // third-party, metered and historically unreliable, so it must never
        // be something you discover afterwards by reading a bill or a
        // downgraded asset. warn-level, with how it was reached.
        console.warn(
          JSON.stringify({
            level: "warn",
            message:
              "media-gateway: serving an image from AI33 — third-party last resort, not one of the self-hosted APIs",
            format: o.format,
            context: o.context,
            reached_via:
              o.backend === "ai33" ? "explicit pin" : "chain fallback",
            note: "If this was not deliberate, every self-hosted image backend was unavailable. Check veo_fleet first.",
          }),
        );
        const refs = await decodeReferenceImages(o.referenceImages);
        // Per-request pin wins, then AI33_IMAGE_MODEL, then the default.
        const model = ai33ImageModel({
          ...(o.imageModel !== undefined ? { imageModel: o.imageModel } : {}),
          ...(o.imageResolution !== undefined
            ? { imageResolution: o.imageResolution }
            : {}),
        });
        // References must be NAMED in the prompt or AI33 ignores them.
        const prompt = ai33PromptWithReferences(entry.prompt, refs?.length ?? 0);
        console.warn(
          JSON.stringify({
            level: "warn",
            message: "media-gateway: AI33 image parameters",
            model_id: model.id,
            // `null` = no resolution is sent, so AI33 applies the model's own
            // default. Not the same as a resolution we chose.
            resolution: model.resolution ?? null,
            reference_images: refs?.length ?? 0,
            references_bound_to_prompt: /@img\d+/.test(prompt),
          }),
        );
        const buf = await ai33GenerateImage(
          apiKey,
          prompt,
          o.aspectRatio ?? "16:9",
          model,
          refs,
          o.seed,
        );
        this.spend("ai33", "image", o);
        return `data:image/png;base64,${buf.toString("base64")}`;
      }
      const { ref, provider } = await fastgenGenerateImage(entry.prompt, {
        aspectRatio: o.aspectRatio,
        referenceImages: o.referenceImages,
        provider: o.provider,
        seed: o.seed,
      });
      this.spend(provider ?? "fastgen", "image", o);
      return ref;
    }

    const o = entry.options as VideoRequestOptions;
    if (backend === "veo_fleet") {
      const timeoutMs = o.maxWaitMs ?? VEO_FLEET_VIDEO_TIMEOUT_MS;
      const imageId =
        entry.kind === "video_image"
          ? await uploadVeoFleetImage(
              await resolveImageBytes(entry.image!),
              inputFilename(entry.image!),
            )
          : undefined;
      const [jobId] = await submitVeoFleetVideo(entry.prompt, {
        aspectRatio: o.aspectRatio,
        resolution: o.resolution,
        ...(imageId ? { imageId } : {}),
      });
      const [fileId] = await waitForVeoFleetJob(jobId!, { timeoutMs });
      this.spend("veo_fleet", "video", o);
      return `fleet:${fileId}`;
    }
    if (backend === "veoforge") {
      const timeoutMs = o.maxWaitMs ?? VEOFORGE_VIDEO_TIMEOUT_MS;
      const imageB64 =
        entry.kind === "video_image"
          ? (await resolveImageBytes(entry.image!)).toString("base64")
          : undefined;
      const jobId = await submitVeoForgeVideo(entry.prompt, {
        aspectRatio: o.aspectRatio,
        resolution: o.resolution,
        ...(imageB64 ? { imageB64 } : {}),
      });
      const [url] = await waitForVeoForgeJob(jobId, { timeoutMs });
      this.spend("veoforge", "video", o);
      return `veoforge:${url}`;
    }
    if (backend === "vup") {
      const timeoutMs = o.maxWaitMs ?? VUP_VIDEO_TIMEOUT_MS;
      const jobId =
        entry.kind === "video_text"
          ? await submitVupVideo(entry.prompt, {
              aspectRatio: o.aspectRatio,
              resolution: o.resolution,
            })
          : await submitVupImageToVideo(
              entry.prompt,
              await toVupImageRef(entry.image!),
              { aspectRatio: o.aspectRatio, resolution: o.resolution },
            );
      const [url] = await waitForVupJob(jobId, { timeoutMs });
      this.spend("vup", "video", o);
      return `vup:${url}`;
    }
    if (backend === "forge") {
      const timeoutMs = o.maxWaitMs ?? FORGE_VIDEO_TIMEOUT_MS;
      let jobId: string;
      if (entry.kind === "video_text") {
        jobId = await submitForgeVideo(entry.prompt, {
          aspectRatio: o.aspectRatio,
          resolution: o.resolution,
        });
      } else {
        const buf = await resolveImageBytes(entry.image!);
        const inputId = await uploadForgeInput(
          buf,
          inputFilename(entry.image!),
        );
        jobId = await submitForgeImageToVideo(entry.prompt, [inputId], {
          aspectRatio: o.aspectRatio,
          resolution: o.resolution,
        });
      }
      const [fileId] = await waitForForgeJob(jobId, { timeoutMs });
      this.spend("forge-api", "video", o);
      return `forge:${fileId}`;
    }

    const operationId =
      entry.kind === "video_text"
        ? await fastgenVideoFromText(entry.prompt)
        : await fastgenVideoFromImage(await toFastgenImageRef(entry.image!), {
            prompt: entry.prompt,
          });
    const result = await fastgenWaitForOperation(operationId, {
      maxWaitMs: o.maxWaitMs,
    });
    if (result.status === "error") {
      throw new Error(`fast-gen video generation failed: ${result.error}`);
    }
    if (!result.result?.video) {
      throw new Error(
        "fast-gen video generation completed but no video in result",
      );
    }
    this.spend("fastgen", "video", o);
    return result.result.video;
  }

  private spend(
    provider: string,
    kind: "image" | "video",
    options: ImageRequestOptions | VideoRequestOptions,
  ): void {
    reportSpend({
      provider,
      kind,
      amount_eur:
        kind === "image"
          ? estimateImageCostEur(provider)
          : estimateVideoCostEur(provider),
      units: 1,
      meta: { format: options.format, context: options.context ?? null },
    });
  }

  stats(): {
    veoFleetInFlight: number;
    veoforgeInFlight: number;
    vupInFlight: number;
    forgeInFlight: number;
    fastgenImageInFlight: number;
    fastgenVideoInFlight: number;
    queued: number;
    byFormat: Record<string, number>;
    backends: MediaBackendStats[];
  } {
    const byFormat: Record<string, number> = {};
    for (const entry of this.queue) {
      byFormat[entry.options.format] =
        (byFormat[entry.options.format] ?? 0) + 1;
    }
    return {
      veoFleetInFlight: this.veoFleetInFlight,
      veoforgeInFlight: this.veoforgeInFlight,
      vupInFlight: this.vupInFlight,
      forgeInFlight: this.forgeInFlight,
      fastgenImageInFlight: this.fastgenImageInFlight,
      fastgenVideoInFlight: this.fastgenVideoInFlight,
      queued: this.queue.length,
      byFormat,
      backends: this.backendStats(),
    };
  }

  /**
   * Per-backend concurrency + health, in the shape the provider registry /
   * System Health surface consumes. `providerKey` matches the registry catalog
   * key exactly so the observability layer can join on it without a mapping
   * table. `detail` is backend-specific and may be null — never invented.
   */
  private backendStats(): MediaBackendStats[] {
    const fleet = veoFleetHealthSnapshot();
    const forge = veoforgeHealthSnapshot();
    return [
      {
        providerKey: "veo_fleet",
        inFlight: this.veoFleetInFlight,
        // The cap actually being enforced right now, not the configured
        // ceiling — otherwise System Health shows 12 while the gateway is
        // admitting 3 and the board looks idle when it is saturated.
        maxConcurrent: veoFleetAdmissionCap(),
        configured: veoFleetConfigured(),
        healthy: veoFleetConfigured() ? veoFleetHealthyCached() : false,
        lastCheckedAt: fleet.checkedAt,
        lastError: fleet.lastError,
        detail: {
          workersOnline: fleet.workersOnline,
          // `stalled` is the whole point of the 2026-08-05 gate change:
          // workersOnline can be 1 while the fleet produces nothing, so a
          // health board must show both or it repeats the same lie.
          stalled: fleet.stalled,
          readyReason: fleet.readyReason,
          upstreamConcurrentMax: fleet.concurrentMax,
          effectiveConcurrency: fleet.effectiveConcurrency,
          configuredCeiling: VEO_FLEET_MAX_CONCURRENT,
          upstreamConcurrentNow: fleet.concurrentNow,
          upstreamQueuePending: fleet.queuePending,
        },
      },
      {
        providerKey: "veoforge",
        inFlight: this.veoforgeInFlight,
        maxConcurrent: VEOFORGE_MAX_CONCURRENT,
        configured: veoforgeConfigured(),
        healthy: veoforgeConfigured() ? veoforgeHealthyCached() : false,
        lastCheckedAt: forge.checkedAt,
        lastError: forge.lastError,
        detail: {
          usableAccounts: forge.usableAccounts,
          totalAccounts: forge.totalAccounts,
          imagesEnabled: forge.imagesEnabled,
        },
      },
      {
        providerKey: "vup",
        inFlight: this.vupInFlight,
        maxConcurrent: VUP_MAX_CONCURRENT,
        configured: vupConfigured(),
        healthy: vupConfigured() ? vupHealthyCached() : false,
        lastCheckedAt: null,
        lastError: null,
        detail: null,
      },
      {
        providerKey: "forge",
        inFlight: this.forgeInFlight,
        maxConcurrent: FORGE_MAX_CONCURRENT,
        configured: forgeConfigured(),
        healthy: forgeConfigured() ? forgeHealthyCached() : false,
        lastCheckedAt: null,
        lastError: null,
        detail: null,
      },
      {
        providerKey: "fastgen",
        inFlight: this.fastgenImageInFlight + this.fastgenVideoInFlight,
        maxConcurrent:
          FASTGEN_MAX_CONCURRENT_IMAGE + FASTGEN_MAX_CONCURRENT_VIDEO,
        configured: Boolean(process.env["FASTGEN_API_KEY"]),
        healthy: false,
        lastCheckedAt: null,
        lastError:
          "retired — licence expired 2026-07-21, removed from all default chains",
        detail: { retired: true },
      },
    ];
  }
}

/** Per-backend snapshot for the provider registry / System Health surface. */
export interface MediaBackendStats {
  /** Matches the @repo/provider-registry catalog key. */
  providerKey: MediaBackend;
  inFlight: number;
  maxConcurrent: number;
  configured: boolean;
  healthy: boolean;
  /** Epoch ms of the last health probe, or null if never probed. */
  lastCheckedAt: number | null;
  lastError: string | null;
  detail: Record<string, unknown> | null;
}

/**
 * Decode ImageRequestOptions.referenceImages (data: URIs or http(s) URLs)
 * into raw byte arrays for the ai33 image client, preserving order so they
 * still line up with @img1, @img2… placeholders in the prompt.
 */
async function decodeReferenceImages(
  refs: string[] | undefined,
): Promise<Uint8Array[] | undefined> {
  if (!refs?.length) return undefined;
  return Promise.all(
    refs.map(async (ref) => {
      if (ref.startsWith("data:")) {
        const commaIdx = ref.indexOf(",");
        if (commaIdx < 0) {
          throw new Error("media-gateway: malformed reference data URI");
        }
        return new Uint8Array(Buffer.from(ref.slice(commaIdx + 1), "base64"));
      }
      if (ref.startsWith("http://") || ref.startsWith("https://")) {
        const res = await fetch(ref);
        if (!res.ok) {
          throw new Error(
            `media-gateway: reference image fetch failed (${res.status})`,
          );
        }
        return new Uint8Array(await res.arrayBuffer());
      }
      throw new Error(
        `media-gateway: unsupported reference image ref: ${ref.slice(0, 24)}…`,
      );
    }),
  );
}

/** Resolve any accepted image reference to raw bytes. */
async function resolveImageBytes(image: string): Promise<Buffer> {
  if (image.startsWith("fleet:")) {
    return downloadVeoFleetFileBuffer(image.slice("fleet:".length));
  }
  if (image.startsWith("veoforge:")) {
    return downloadVeoForgeFileBuffer(image.slice("veoforge:".length));
  }
  if (image.startsWith("http://") || image.startsWith("https://")) {
    const res = await fetch(image);
    if (!res.ok) {
      throw new Error(`media-gateway: image fetch failed (${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  if (image.startsWith("vup:")) {
    return downloadVupFileBuffer(image.slice("vup:".length));
  }
  if (image.startsWith("forge:")) {
    return downloadForgeMediaBuffer(image.slice("forge:".length));
  }
  if (image.startsWith("file:")) {
    return fastgenDownloadResultToBuffer(image);
  }
  if (image.startsWith("data:")) {
    const commaIdx = image.indexOf(",");
    if (commaIdx < 0) throw new Error("media-gateway: malformed data URI");
    return Buffer.from(image.slice(commaIdx + 1), "base64");
  }
  return readFile(image); // local path
}

function inputFilename(image: string): string {
  if (
    image.startsWith("data:") ||
    image.startsWith("file:") ||
    image.startsWith("forge:") ||
    image.startsWith("vup:") ||
    image.startsWith("fleet:") ||
    image.startsWith("veoforge:")
  ) {
    return "input.png";
  }
  const ext = extname(image).toLowerCase();
  return ext === ".jpg" || ext === ".jpeg" ? "input.jpg" : "input.png";
}

/** fastgen i2v accepts data: URIs and file: refs; convert anything else. */
async function toFastgenImageRef(image: string): Promise<string> {
  if (image.startsWith("data:") || image.startsWith("file:")) return image;
  const buf = await resolveImageBytes(image);
  const mime =
    inputFilename(image) === "input.jpg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** VUP i2v accepts data: URIs and http(s) URLs; convert anything else. */
async function toVupImageRef(image: string): Promise<string> {
  if (
    image.startsWith("data:") ||
    image.startsWith("http://") ||
    image.startsWith("https://")
  ) {
    return image;
  }
  const buf = await resolveImageBytes(image);
  const mime =
    inputFilename(image) === "input.jpg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

const gateway = new MediaGateway();

// ── Public API ──────────────────────────────────────────────────────────────

export async function requestImage(
  prompt: string,
  options: ImageRequestOptions,
): Promise<MediaRef> {
  return gateway.enqueue("image", prompt, options);
}

/**
 * Like requestImage, but returns WHICH backend served it, the routing chain,
 * and whether a fallback fired. Consumed by the thumbnail engine so a provider
 * downgrade is recorded on the row and surfaced in the UI, never silent (§2.6).
 */
export async function requestImageDetailed(
  prompt: string,
  options: ImageRequestOptions,
): Promise<DetailedMediaResult> {
  let served: ServedInfo | undefined;
  const ref = await gateway.enqueue(
    "image",
    prompt,
    options,
    undefined,
    (i) => {
      served = i;
    },
  );
  if (!served) {
    // The onServed hook fires on every success path; if it did not, routing is
    // in an unexpected state — surface it rather than reporting a false chain.
    throw new Error(
      "media-gateway: requestImageDetailed resolved without served info",
    );
  }
  return { ref, ...served };
}

/**
 * Capability pre-flight (plan A2.11): the registry-filtered backend chain that
 * WOULD serve an image request with the given reference count / aspect, without
 * spending anything. `refCount` is the EFFECTIVE reference count (archetype +
 * extras). Empty chain => no configured backend can serve it; the Studio must
 * refuse before submit rather than enqueue a doomed request.
 */
export function resolveImageChain(input: {
  format: GatewayFormat;
  refCount: number;
  aspectRatio?: ImageRequestOptions["aspectRatio"];
  backend?: MediaBackend;
  provider?: ImageRequestOptions["provider"];
}): { chain: MediaBackend[]; configured: MediaBackend[] } {
  const probe: QueueEntry = {
    kind: "image",
    prompt: "",
    options: {
      format: input.format,
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
      ...(input.backend ? { backend: input.backend } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      referenceImages: Array.from({ length: input.refCount }, () => ""),
    } as ImageRequestOptions,
    priority: 0,
    enqueuedAt: Date.now(),
    resolve: () => {},
    reject: () => {},
  };
  const chain = candidateOrder(probe);
  return { chain, configured: chain.filter((b) => backendConfigured(b)) };
}

export async function requestImageToFile(
  prompt: string,
  destPath: string,
  options: ImageRequestOptions,
): Promise<MediaRef> {
  const ref = await gateway.enqueue("image", prompt, options);
  await downloadMedia(ref, destPath);
  return ref;
}

export async function requestImageBuffer(
  prompt: string,
  options: ImageRequestOptions,
): Promise<Buffer> {
  const ref = await gateway.enqueue("image", prompt, options);
  return downloadMediaBuffer(ref);
}

export async function requestImagesBatch(
  items: Array<{
    prompt: string;
    destPath: string;
    aspectRatio?: ImageRequestOptions["aspectRatio"];
    referenceImages?: string[];
    provider?: ImageRequestOptions["provider"];
    context?: string;
  }>,
  shared: { format: GatewayFormat; priority?: number },
): Promise<MediaRef[]> {
  return Promise.all(
    items.map((item) =>
      requestImageToFile(item.prompt, item.destPath, {
        format: shared.format,
        priority: shared.priority,
        aspectRatio: item.aspectRatio,
        referenceImages: item.referenceImages,
        provider: item.provider,
        context: item.context,
      }),
    ),
  );
}

export async function requestVideoFromText(
  prompt: string,
  options: VideoRequestOptions,
): Promise<MediaRef> {
  return gateway.enqueue("video_text", prompt, options);
}

/**
 * Animate an image. `image` may be a local file path, a data: URI, a
 * fastgen file:<hash> ref, a forge:<id> ref, or a vup:<url> ref.
 */
export async function requestVideoFromImage(
  image: string,
  options: VideoRequestOptions & { prompt?: string },
): Promise<MediaRef> {
  return gateway.enqueue("video_image", options.prompt ?? "", options, image);
}

/** Download any MediaRef (forge:, file:, data:, http[s]:) to a local file. */
export async function downloadMedia(
  ref: MediaRef,
  destPath: string,
): Promise<void> {
  if (ref.startsWith("fleet:")) {
    await downloadVeoFleetFile(ref.slice("fleet:".length), destPath);
    return;
  }
  if (ref.startsWith("veoforge:")) {
    await downloadVeoForgeFile(ref.slice("veoforge:".length), destPath);
    return;
  }
  if (ref.startsWith("vup:")) {
    await downloadVupFile(ref.slice("vup:".length), destPath);
    return;
  }
  if (ref.startsWith("forge:")) {
    await downloadForgeMedia(ref.slice("forge:".length), destPath);
    return;
  }
  if (ref.startsWith("file:") || ref.startsWith("data:")) {
    await fastgenDownloadResult(ref, destPath);
    return;
  }
  if (ref.startsWith("http://") || ref.startsWith("https://")) {
    const res = await fetch(ref);
    if (!res.ok) {
      throw new Error(`media download failed (${res.status}): ${ref}`);
    }
    if (!res.body) throw new Error("media download response has no body");
    const dest = createWriteStream(destPath);
    await pipeline(res.body as unknown as NodeJS.ReadableStream, dest);
    return;
  }
  throw new Error(
    `media-gateway: unknown media ref format: ${ref.slice(0, 32)}…`,
  );
}

export async function downloadMediaBuffer(ref: MediaRef): Promise<Buffer> {
  if (ref.startsWith("fleet:")) {
    return downloadVeoFleetFileBuffer(ref.slice("fleet:".length));
  }
  if (ref.startsWith("veoforge:")) {
    return downloadVeoForgeFileBuffer(ref.slice("veoforge:".length));
  }
  if (ref.startsWith("vup:")) {
    return downloadVupFileBuffer(ref.slice("vup:".length));
  }
  if (ref.startsWith("forge:")) {
    return downloadForgeMediaBuffer(ref.slice("forge:".length));
  }
  if (ref.startsWith("file:") || ref.startsWith("data:")) {
    return fastgenDownloadResultToBuffer(ref);
  }
  if (ref.startsWith("http://") || ref.startsWith("https://")) {
    const res = await fetch(ref);
    if (!res.ok) {
      throw new Error(`media download failed (${res.status}): ${ref}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error(
    `media-gateway: unknown media ref format: ${ref.slice(0, 32)}…`,
  );
}

export function mediaGatewayStats() {
  return gateway.stats();
}
