/**
 * `pexels` provider — real-world photography and stock footage.
 *
 * Two paths, and the split is not arbitrary:
 *
 *   STILLS  `searchPexelsPhotos` from the existing `utils/pexels-client.ts`.
 *           Photo search is image acquisition and is unrestricted.
 *   MOTION  `requestFootage()` from `utils/footage-gateway.ts`. Pexels VIDEO
 *           search is gateway-only in this repo (there is an eslint
 *           `no-restricted-imports` rule enforcing it), because the footage
 *           gateway owns the per-format priority queue, the download directory
 *           and the ffprobe quality gate.
 *
 * Pexels grants one blanket licence for everything it serves, which is why it
 * counts as an authoritative licence source in `licence.ts` and can produce
 * `publishable` assets without human review.
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createContextLogger } from "@repo/logger";
import { searchPexelsPhotos } from "../../pexels-client.js";
import { requestFootage } from "../../footage-gateway.js";
import type {
  VisualCandidate,
  VisualProviderAdapter,
  VisualRequest,
} from "../types.js";

const logger = createContextLogger("visual-gateway:pexels");

const PEXELS_LICENCE = "Pexels License";
const PER_PAGE = 8;

async function fetchUrlBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(
      `visual-gateway: pexels download failed (${response.status}) for ${url}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

function extensionFromUrl(url: string, fallback: string): string {
  try {
    const path = new URL(url).pathname;
    const match = /\.([a-z0-9]{2,5})$/i.exec(path);
    return match ? match[1]!.toLowerCase() : fallback;
  } catch {
    return fallback;
  }
}

function readString(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Ask the footage gateway for one clip. Returns `null` when nothing usable
 * came back; the still path then runs as normal.
 *
 * @throws when the footage gateway itself fails.
 */
async function motionCandidate(
  req: VisualRequest,
): Promise<VisualCandidate | null> {
  const durationSeconds = req.motionDurationSeconds;
  if (durationSeconds === undefined || durationSeconds <= 0) {
    // validateRequest already rejects this; belt and braces so a direct caller
    // of the adapter cannot smuggle a bad duration into the footage gateway.
    throw new Error(
      "visual-gateway: preferMotion requires a positive motionDurationSeconds",
    );
  }

  const footage = await requestFootage({
    query: req.query,
    format: "BUSINESS_PLAN_HUB",
    durationSeconds,
    sources: ["pexels"],
    context: `business-hub:${req.intent}`,
  });
  if (!footage) return null;

  const sourceUrl = readString(footage.providerMeta, "source_url");
  if (sourceUrl === null) {
    // Fail closed: a clip whose origin the footage gateway did not record
    // cannot carry provenance, so it does not exist for us.
    logger.warn(
      { ref: footage.ref },
      "footage result carries no source_url — discarding",
    );
    return null;
  }

  const isVideo = readString(footage.providerMeta, "kind") !== "photo";
  const extension = extname(footage.localPath).replace(/^\./, "").toLowerCase();

  return {
    mediaKind: isVideo ? "video" : "image",
    fileExtension: extension.length > 0 ? extension : isVideo ? "mp4" : "jpg",
    // The footage gateway ffprobes what it downloaded, so these are measured.
    dimensionsDeclared: footage.width > 0 && footage.height > 0,
    provenance: {
      provider: "pexels",
      sourceUrl,
      licence: PEXELS_LICENCE,
      retrievedAt: new Date().toISOString(),
      width: footage.width,
      height: footage.height,
      // ffprobed by the footage gateway. Carried so the caller can check the
      // clip actually covers the scene it asked for a clip of.
      ...(isVideo && footage.durationSeconds > 0
        ? { durationSeconds: footage.durationSeconds }
        : {}),
      title: `Pexels ${isVideo ? "video" : "photo"}: ${req.query}`,
      ...(footage.attribution ? { attribution: footage.attribution } : {}),
    },
    fetchBytes: () => readFile(footage.localPath),
  };
}

/**
 * Search Pexels and return lazily-fetchable candidates, motion first when the
 * request prefers it.
 *
 * Returns `[]` when `PEXELS_API_KEY` is unset — an unconfigured provider has
 * nothing to offer, which is not an error, and the gateway records it as such.
 *
 * @throws when the Pexels API or the footage gateway fails (non-2xx, timeout).
 */
export const pexelsProvider: VisualProviderAdapter = {
  provider: "pexels",

  async search(req: VisualRequest): Promise<VisualCandidate[]> {
    const apiKey = process.env["PEXELS_API_KEY"] ?? "";
    if (apiKey.length === 0) {
      logger.info({ query: req.query }, "pexels unconfigured — skipping");
      return [];
    }

    const candidates: VisualCandidate[] = [];

    if (req.preferMotion) {
      const motion = await motionCandidate(req);
      if (motion) candidates.push(motion);
    }

    const retrievedAt = new Date().toISOString();
    const photos = await searchPexelsPhotos(req.query, apiKey, {
      perPage: PER_PAGE,
      orientation: req.orientation,
    });
    for (const photo of photos) {
      candidates.push({
        mediaKind: "image",
        fileExtension: extensionFromUrl(photo.download_url, "jpg"),
        dimensionsDeclared: true,
        provenance: {
          provider: "pexels",
          sourceUrl: photo.attribution.source_url,
          licence: PEXELS_LICENCE,
          retrievedAt,
          width: photo.width,
          height: photo.height,
          title:
            photo.alt && photo.alt.length > 0
              ? photo.alt
              : `Pexels photo ${photo.id} by ${photo.attribution.photographer}`,
          attribution: `${photo.attribution.photographer} (Pexels)`,
        },
        fetchBytes: () => fetchUrlBytes(photo.download_url),
      });
    }

    logger.info(
      { query: req.query, candidates: candidates.length },
      "pexels candidates",
    );
    return candidates;
  },
};
