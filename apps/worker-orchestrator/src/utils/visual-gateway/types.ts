/**
 * Shared types for the BUSINESS_PLAN_HUB visual sourcing gateway.
 *
 * Nothing in this format is screen-recorded (design §3.2, §6.1): every frame is
 * either GENERATED (through the existing media-gateway) or SOURCED (Pexels,
 * Wikimedia Commons, image search, a named document on the open web).
 *
 * The gateway's contract with the rest of the pipeline is provenance:
 * `{ provider, sourceUrl, licence, retrievedAt }` on every returned asset, and
 * a hard failure when any of them is absent (design §8 rule 6). At a catalogue
 * of hundreds of published videos an unknown-provenance still is an unbounded
 * liability, so it is never patched, defaulted or guessed — it is discarded.
 */
import type { VisualRef } from "@repo/contracts";
import type { GatewayFormat } from "../media-gateway/types.js";

/**
 * The five providers, exactly as `VisualRefSchema` (F2) enumerates them.
 * Derived rather than re-declared so the two can never drift.
 */
export type VisualProvider = VisualRef["provider"];

export const VISUAL_PROVIDERS: readonly VisualProvider[] = [
  "generated",
  "pexels",
  "wikimedia",
  "google",
  "web",
] as const;

/**
 * What the visual is FOR. Intent picks the provider order (see `policy.ts`) —
 * a prop plate wants generation, a lender's form wants Wikimedia or the named
 * document itself, real-world b-roll wants Pexels.
 */
export type VisualIntent =
  | "prop-plate" // mat props: loan documents, a calculator, a pen
  | "abstract-subject" // non-literal imagery standing in for the topic
  | "thumbnail" // thumbnail plate
  | "broll" // real-world footage / photography
  | "document" // a form, a filing, a regulation page
  | "logo" // an organisation mark (SBA, USCIS, a lender)
  | "long-tail"; // a specific thing nothing else covers

export const VISUAL_INTENTS: readonly VisualIntent[] = [
  "prop-plate",
  "abstract-subject",
  "thumbnail",
  "broll",
  "document",
  "logo",
  "long-tail",
] as const;

export type VisualOrientation = "landscape" | "portrait" | "square";

export type VisualMediaKind = "image" | "video";

/**
 * A request for one visual.
 *
 * Every field except the explicitly-optional tail is REQUIRED: the caller
 * states the orientation and the minimum acceptable width rather than letting
 * the gateway invent one, because "whatever came back" is how a 480px stock
 * thumbnail ends up upscaled into a 1080p frame.
 */
export interface VisualRequest {
  intent: VisualIntent;
  /** Search phrase (sourced providers) / subject (generation). Non-empty. */
  query: string;
  orientation: VisualOrientation;
  /** Hard floor in pixels. A narrower candidate is discarded, never upscaled. */
  minWidth: number;
  /**
   * Prefer a moving clip over a still where the provider offers both. Motion
   * is routed through the footage gateway, which needs a target duration, so
   * `motionDurationSeconds` becomes REQUIRED when this is `true`.
   */
  preferMotion: boolean;
  /** Target clip length in seconds. Required when `preferMotion` is `true`. */
  motionDurationSeconds?: number;
  /** The video's topic — prompt context for generation, and log context. */
  topic: string;
  /**
   * Direct URL of a named document. REQUIRED before the `web` provider can
   * serve anything; the web adapter fetches exactly this URL and never crawls.
   */
  documentUrl?: string;
  /** Override the intent's default provider order. */
  providerOrder?: VisualProvider[];
  /**
   * Accept a candidate whose licence posture is `needs-review`. Default `true`
   * (the asset is FLAGGED for QC, not silently published — design §6.1). Set
   * `false` for a surface that may only ever carry publishable-licence assets.
   */
  allowNeedsReview?: boolean;
  /** Full generation prompt; when absent the generated adapter composes one. */
  generationPrompt?: string;
  /**
   * Which generated beat of this video this is (0-based). Selects the per-beat
   * camera/staging clause in `art-direction.ts::variationFor`, so a run of beats
   * inside one video does not come back as one picture repeated.
   *
   * Absent means "no variation", which is right for a one-off plate and wrong
   * for a sequence. Ignored entirely when `generationPrompt` is supplied — a
   * caller that wrote the whole prompt has already decided the staging — and
   * ignored by every SOURCED provider, which have no prompt to vary.
   */
  variationIndex?: number;
  /**
   * Which format this visual is for, which decides its ESSENTIAL providers
   * (`essential-providers.ts`). Defaults to `BUSINESS_PLAN_HUB` — this gateway
   * is that format's gateway, and defaulting FAIL-CLOSED means forgetting the
   * field cannot switch the essential-provider gate off. A caller reusing this
   * gateway for another format must say so.
   */
  format?: GatewayFormat;
  /**
   * Pin the media-gateway image BACKEND for the `generated` provider, e.g.
   * `"ai33"`. Absent means "do not pin" — the gateway runs its health-gated
   * chain, which is the only mode that keeps failover.
   *
   * Comes from `metadata.business_hub.image_backend` (create form). Typed as a
   * plain string here so `visual-gateway/` keeps its single dependency on the
   * media gateway (`media-gateway-port.ts`); the port narrows it.
   */
  imageBackend?: string;
  /**
   * Pin the image MODEL, e.g. `"gpt-image-2"`, from
   * `metadata.business_hub.image_model`. Only the `ai33` backend passes it
   * upstream — the media gateway warns when anything else serves a pinned
   * request rather than letting it look honoured.
   */
  imageModel?: string;
  /**
   * The `resolution` to send with `imageModel`, e.g. `"2K"`. Absent means the
   * chosen model declares none and the parameter must be omitted, not guessed.
   */
  imageResolution?: string;
}

/**
 * Full provenance for one candidate. A candidate missing `provider`,
 * `sourceUrl`, `licence` or `retrievedAt` is DISCARDED by `validateProvenance`
 * — the gateway never fills a blank in.
 */
export interface VisualProvenance {
  provider: VisualProvider;
  /** Canonical page/asset URL, or the media-gateway ref for `generated`. */
  sourceUrl: string;
  /** Licence identifier or full terms. Never blank. May be `"unknown"`. */
  licence: string;
  /** ISO-8601 instant of retrieval/generation. */
  retrievedAt: string;
  /** Provider-declared pixel width. `0` means "provider did not declare". */
  width: number;
  /** Provider-declared pixel height. `0` means "provider did not declare". */
  height: number;
  /**
   * Clip length in seconds for a `video` asset, as MEASURED by whatever
   * produced it (the footage gateway ffprobes every clip it downloads).
   * `undefined` for stills and for a video whose length nothing measured.
   *
   * Recorded because the caller states `motionDurationSeconds` on the request
   * and the scene it is destined for is exactly that long. Without this the one
   * number the scene actually needs is requested, discarded, and never checked
   * — and a clip shorter than its scene does not fail at render, it freezes on
   * its last frame for the remainder (see the `tpad=stop_mode=clone` note in
   * apps/worker-render/src/workflows/business-hub.ts).
   */
  durationSeconds?: number;
  /** Human label — photographer, file name, page title. Never blank. */
  title: string;
  /** Attribution line the renderer must carry, when the licence demands one. */
  attribution?: string;
}

/**
 * A candidate is provenance plus a way to materialise the bytes. Adapters do
 * NOT download during search: the gateway fetches only the candidate it picks,
 * and skips the fetch entirely on a `sourceUrl` dedup hit.
 */
export interface VisualCandidate {
  provenance: VisualProvenance;
  mediaKind: VisualMediaKind;
  /** Lower-case, no dot: `"png"`, `"jpg"`, `"mp4"`. */
  fileExtension: string;
  /**
   * `true` when `provenance.width/height` are provider-declared and may be
   * used to reject an undersized candidate BEFORE downloading it.
   *
   * They are a pre-filter, not the truth: Pexels declares the original upload's
   * size while serving a resized derivative, so for IMAGE candidates the
   * gateway re-measures the downloaded bytes and overwrites these values.
   * Video bytes cannot be measured here, so a video candidate that does not
   * declare its dimensions is rejected rather than assumed.
   */
  dimensionsDeclared: boolean;
  /** Materialise the bytes. Throws on transport failure. */
  fetchBytes: () => Promise<Buffer>;
}

/**
 * One provider adapter.
 *
 * `search` returns `[]` for "nothing matched" and for "not configured on this
 * box". It THROWS on a transport or contract failure. Either way the gateway
 * records the reason and moves to the next provider; a request only fails once
 * every provider in the order has been tried.
 */
export interface VisualProviderAdapter {
  readonly provider: VisualProvider;
  search(req: VisualRequest): Promise<VisualCandidate[]>;
}

/**
 * Licence posture.
 *
 *   publishable   the licence is on the documented allowlist AND the provider
 *                 is one whose licence metadata is authoritative.
 *   needs-review  everything else. The asset is usable but MUST be reviewed by
 *                 QC before the video is published.
 */
export type LicencePosture = "publishable" | "needs-review";

/** A visual that exists in the local content-addressed library. */
export interface StoredVisual {
  /** SHA-256 of the bytes, lower-case hex. The dedup key. */
  contentHash: string;
  /** Storage key relative to the library root. Becomes `VisualRef.assetKey`. */
  assetKey: string;
  /** Absolute path on this box. */
  storagePath: string;
  bytes: number;
  mediaKind: VisualMediaKind;
  provenance: VisualProvenance;
  posture: LicencePosture;
}

/**
 * The content-addressed store the gateway writes through, and the dedup index
 * it consults first. Injectable so tests can run without a filesystem and so
 * the pipeline (O5) can layer a DB-backed `source_images` lookup on top.
 */
export interface VisualStore {
  /** Exact-bytes dedup. */
  lookupByHash(contentHash: string): Promise<StoredVisual | null>;
  /**
   * Fetch-once dedup: has this exact `sourceUrl` already been pulled into the
   * library by any earlier video in the catalogue?
   */
  lookupBySourceUrl(sourceUrl: string): Promise<StoredVisual | null>;
  save(input: {
    bytes: Buffer;
    contentHash: string;
    fileExtension: string;
    mediaKind: VisualMediaKind;
    provenance: VisualProvenance;
    posture: LicencePosture;
  }): Promise<StoredVisual>;
}

/** What `requestVisual` resolves to. */
export interface VisualResult {
  /** The contracts-shaped ref that goes onto the scene. */
  visual: VisualRef;
  provenance: VisualProvenance;
  posture: LicencePosture;
  /** Why QC must look at this, or `null` when the posture is publishable. */
  reviewReason: string | null;
  contentHash: string;
  storagePath: string;
  bytes: number;
  mediaKind: VisualMediaKind;
  /** `true` when the library already held this asset and nothing was fetched. */
  deduplicated: boolean;
  /** Providers tried and rejected before this one won, for the job log. */
  rejected: ProviderAttempt[];
}

/** Why one provider did not produce the winning candidate. */
export interface ProviderAttempt {
  provider: VisualProvider;
  outcome:
    | "no-adapter"
    | "unconfigured"
    | "no-results"
    | "all-candidates-rejected"
    | "error";
  reason: string;
}

/** A candidate rejected during validation, with the reason, for diagnostics. */
export interface CandidateRejection {
  provider: VisualProvider;
  sourceUrl: string;
  reason: string;
}
