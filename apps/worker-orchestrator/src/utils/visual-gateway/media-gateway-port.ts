/**
 * The visual gateway's single seam onto the unified media-gateway.
 *
 * Two reasons this indirection exists rather than importing
 * `../media-gateway/index.js` at the top of the generated adapter:
 *
 *  1. `media-gateway/index.ts` eagerly pulls in every provider client
 *     (veo-fleet, veoforge, vup, forge, fastgen, ai33) plus the spend reporter.
 *     Loading all of that inside a unit test that never generates anything is
 *     both slow and a live-API hazard. The dynamic import defers it to the
 *     first actual generation call.
 *  2. It keeps the "never call vup-client / fastgen-client / forge-client
 *     directly" rule enforceable by inspection: this file is the ONLY place in
 *     `visual-gateway/` that may name the media gateway at all.
 */
import type {
  GatewayFormat,
  ImageRequestOptions,
  MediaBackend,
  MediaRef,
} from "../media-gateway/types.js";

export interface GeneratedImage {
  ref: MediaRef;
  servedBy: string;
  fallbackUsed: boolean;
}

/**
 * Generate one image through the media-gateway.
 *
 * @throws whatever the media-gateway throws when every backend fails — the
 *         visual gateway records that as a provider failure and moves on.
 */
export async function generateImage(
  prompt: string,
  options: ImageRequestOptions,
): Promise<GeneratedImage> {
  const mod = await import("../media-gateway/index.js");
  const detailed = await mod.requestImageDetailed(prompt, options);
  return {
    ref: detailed.ref,
    servedBy: detailed.servedBy,
    fallbackUsed: detailed.fallbackUsed,
  };
}

/** What the media-gateway would do with an image request, without doing it. */
export interface ImageChainProbe {
  /** Every backend known to the gateway, in no particular order. */
  all: MediaBackend[];
  /** Those this request would actually be routed through, in order. */
  chain: MediaBackend[];
  /** The subset of `chain` that has credentials in this environment. */
  configured: MediaBackend[];
}

/**
 * Ask the media-gateway which backends WOULD serve an image request, spending
 * nothing. This is the pre-flight's only window onto routing: it must not
 * re-derive the chain itself, or the thing it checks and the thing that later
 * runs are two different pieces of logic that will drift apart.
 */
export async function probeImageChain(input: {
  format: GatewayFormat;
  refCount: number;
  aspectRatio?: ImageRequestOptions["aspectRatio"];
}): Promise<ImageChainProbe> {
  const mod = await import("../media-gateway/index.js");
  const types = await import("../media-gateway/types.js");
  const { chain, configured } = mod.resolveImageChain(input);
  return { all: [...types.MEDIA_BACKENDS], chain, configured };
}

/**
 * Narrow an operator-supplied backend name to a `MediaBackend`.
 *
 * `metadata.business_hub.image_backend` is free-form JSON, so it can say
 * anything. This THROWS on an unrecognised value rather than dropping the pin:
 * ignoring it would run the job on whatever the chain picked while the job
 * record claimed a backend had been chosen — and the point of the pin is to
 * know which backend drew the frame.
 *
 * Dynamically imported for the same reason as `probeImageChain`: the list of
 * backends is `MEDIA_BACKENDS`, and it must come from the gateway rather than
 * be restated here, where it would silently drift.
 */
export async function toImageBackend(raw: string): Promise<MediaBackend> {
  const types = await import("../media-gateway/types.js");
  const match = types.MEDIA_BACKENDS.find((backend) => backend === raw);
  if (match === undefined) {
    throw new Error(
      `unknown image backend "${raw}" — expected one of ${types.MEDIA_BACKENDS.join(", ")}`,
    );
  }
  return match;
}

/**
 * Resolve a media-gateway ref to bytes.
 *
 * @throws when the ref cannot be downloaded.
 */
export async function downloadGeneratedBytes(ref: MediaRef): Promise<Buffer> {
  const mod = await import("../media-gateway/index.js");
  return mod.downloadMediaBuffer(ref);
}
