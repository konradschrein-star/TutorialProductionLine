/**
 * `google` provider — open image search for long-tail specifics.
 *
 * ## What this actually calls
 *
 * There is **no Google Images API configured in this repo**. There is no CSE
 * key, no SerpAPI account, nothing. What DOES exist is
 * `utils/duckduckgo-images.ts`, the repo's existing keyless image-search
 * mechanism, so this adapter drives that. No API key is invented here and
 * nothing is scraped beyond the search endpoint the repo already uses.
 *
 * The `VisualRef.provider` value stays `"google"` because that is the contract
 * enum F2 owns (`"google"` = open image search, as opposed to a licence-bearing
 * repository). The engine actually used is recorded in the candidate title so
 * an audit never has to guess.
 *
 * ## Capability flag
 *
 * `VISUAL_GATEWAY_IMAGE_SEARCH` — `"off"`/`"0"`/`"false"` disables the adapter,
 * which then returns `[]` (unconfigured, not an error). Any other value, or
 * absent, leaves it enabled. Web search results are always `needs-review`, so
 * an operator who wants a strictly-licensed catalogue turns it off here rather
 * than trusting the licence field.
 *
 * ## Licence
 *
 * Always `"unknown"`. A search index does not grant rights, and a host's page
 * footer is not a grant either. `licence.ts` therefore forces every result from
 * this provider to `needs-review`; it is usable, flagged, and QC clears it.
 */
import { createContextLogger } from "@repo/logger";
import { searchDDGImages } from "../../duckduckgo-images.js";
import { UNKNOWN_LICENCE } from "../licence.js";
import type {
  VisualCandidate,
  VisualProviderAdapter,
  VisualRequest,
} from "../types.js";

const logger = createContextLogger("visual-gateway:google");

const RESULT_LIMIT = 8;

export type ImageSearchCapability =
  | { kind: "duckduckgo" }
  | { kind: "unconfigured"; reason: string };

/**
 * Which search mechanism, if any, this box may use.
 *
 * Explicit rather than a boolean so a future Google CSE / SerpAPI integration
 * slots in as another variant instead of a second flag.
 */
export function imageSearchCapability(): ImageSearchCapability {
  const flag = (process.env["VISUAL_GATEWAY_IMAGE_SEARCH"] ?? "").toLowerCase();
  if (flag === "off" || flag === "0" || flag === "false" || flag === "no") {
    return {
      kind: "unconfigured",
      reason:
        "open image search disabled by VISUAL_GATEWAY_IMAGE_SEARCH — results " +
        "from it are always needs-review",
    };
  }
  return { kind: "duckduckgo" };
}

function extensionFromUrl(url: string): string {
  try {
    const match = /\.(jpe?g|png|gif|webp)(?:$|\?)/i.exec(new URL(url).pathname);
    return match ? match[1]!.toLowerCase().replace("jpeg", "jpg") : "jpg";
  } catch {
    return "jpg";
  }
}

async function fetchUrlBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(
      `visual-gateway: image-search download failed (${response.status}) for ${url}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Search the open image index.
 *
 * Returns `[]` when the capability flag is off. Throws when the search engine
 * itself fails or blocks us — the gateway records that and tries the next
 * provider.
 */
export const googleProvider: VisualProviderAdapter = {
  provider: "google",

  async search(req: VisualRequest): Promise<VisualCandidate[]> {
    const capability = imageSearchCapability();
    if (capability.kind === "unconfigured") {
      logger.info({ reason: capability.reason }, "image search unconfigured");
      return [];
    }

    const results = await searchDDGImages(req.query, RESULT_LIMIT);
    const retrievedAt = new Date().toISOString();

    const candidates: VisualCandidate[] = [];
    for (const result of results) {
      if (!/^https?:\/\//i.test(result.url)) continue;
      const declared = result.width > 0 && result.height > 0;
      candidates.push({
        mediaKind: "image",
        fileExtension: extensionFromUrl(result.url),
        dimensionsDeclared: declared,
        provenance: {
          provider: "google",
          // The image URL itself — that is what we fetched and what an auditor
          // must be able to re-check. The host page is recorded in the title.
          sourceUrl: result.url,
          licence: UNKNOWN_LICENCE,
          retrievedAt,
          width: declared ? result.width : 0,
          height: declared ? result.height : 0,
          title:
            `[duckduckgo image search] ` +
            `${result.title.length > 0 ? result.title : req.query}` +
            `${result.source.length > 0 ? ` — page: ${result.source}` : ""}`,
        },
        fetchBytes: () => fetchUrlBytes(result.url),
      });
    }

    logger.info(
      { query: req.query, candidates: candidates.length },
      "image-search candidates (all needs-review)",
    );
    return candidates;
  },
};
