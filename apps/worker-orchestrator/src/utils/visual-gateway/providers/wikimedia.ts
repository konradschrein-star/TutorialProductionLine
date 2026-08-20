/**
 * `wikimedia` provider — Wikimedia Commons.
 *
 * The best-provenance SOURCED provider, and the reason is one API field:
 * Commons returns machine-readable `extmetadata` per file, including
 * `LicenseShortName`, `UsageTerms`, `Artist` and `AttributionRequired`. That is
 * an authoritative grant, not a guess, so a Commons file with a permissive
 * licence is `publishable` without human review.
 *
 * The licence is parsed properly and FAIL-CLOSED: if the API returns a file
 * with no usable licence field, the candidate is DISCARDED. It is never
 * defaulted to "unknown" and published — an image whose licence we invented is
 * exactly the liability design §6.1 exists to prevent.
 *
 * API: https://commons.wikimedia.org/w/api.php
 *   action=query&generator=search&gsrnamespace=6 (File: namespace)
 *   prop=imageinfo&iiprop=url|size|extmetadata|mime
 */
import { createContextLogger } from "@repo/logger";
import type {
  VisualCandidate,
  VisualProviderAdapter,
  VisualRequest,
} from "../types.js";

const logger = createContextLogger("visual-gateway:wikimedia");

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const RESULT_LIMIT = 8;
const USER_AGENT =
  "ContentForge-VisualGateway/1.0 (business-plan-hub; contact via repo)";

/** Raster formats we can measure and composite. SVG/PDF/TIFF are skipped. */
const ACCEPTED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

interface ExtMetadataField {
  value?: unknown;
}

interface CommonsImageInfo {
  url?: unknown;
  descriptionurl?: unknown;
  width?: unknown;
  height?: unknown;
  mime?: unknown;
  extmetadata?: Record<string, ExtMetadataField>;
}

interface CommonsPage {
  title?: unknown;
  imageinfo?: CommonsImageInfo[];
}

interface CommonsResponse {
  query?: { pages?: Record<string, CommonsPage> };
}

/** Commons `extmetadata` values arrive as HTML fragments. Strip to plain text. */
function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function field(
  meta: Record<string, ExtMetadataField> | undefined,
  key: string,
): string {
  if (!meta) return "";
  return plainText(meta[key]?.value);
}

/**
 * Extract the authoritative licence for a Commons file.
 *
 * Preference order — most specific identifier first:
 *   1. `LicenseShortName`  e.g. "CC BY-SA 4.0", "Public domain"
 *   2. `License`           the machine key, e.g. "cc-by-sa-4.0"
 *   3. `UsageTerms`        prose grant, e.g. "Creative Commons Attribution 4.0"
 *
 * Returns `null` when Commons published no licence at all — the caller must
 * DISCARD such a file, never stamp it "unknown" and carry on.
 */
export function parseCommonsLicence(
  meta: Record<string, ExtMetadataField> | undefined,
): string | null {
  const shortName = field(meta, "LicenseShortName");
  if (shortName.length > 0) return shortName;
  const key = field(meta, "License");
  if (key.length > 0) return key;
  const usageTerms = field(meta, "UsageTerms");
  if (usageTerms.length > 0) return usageTerms;
  return null;
}

/** Credit line Commons says we owe, when it says we owe one. */
export function parseCommonsAttribution(
  meta: Record<string, ExtMetadataField> | undefined,
): string | undefined {
  const credit = field(meta, "Attribution");
  if (credit.length > 0) return credit;
  const artist = field(meta, "Artist");
  if (artist.length > 0) return artist;
  return undefined;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function fetchUrlBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(
      `visual-gateway: wikimedia download failed (${response.status}) for ${url}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Search Commons for files matching the query.
 *
 * @throws when the Commons API returns a non-2xx or unparseable response.
 *         Returns `[]` when the search simply matched nothing.
 */
export const wikimediaProvider: VisualProviderAdapter = {
  provider: "wikimedia",

  async search(req: VisualRequest): Promise<VisualCandidate[]> {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "1",
      generator: "search",
      gsrsearch: `filetype:bitmap ${req.query}`,
      gsrnamespace: "6",
      gsrlimit: String(RESULT_LIMIT),
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      origin: "*",
    });

    const response = await fetch(`${COMMONS_API}?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(
        `visual-gateway: wikimedia search failed (${response.status}) for ` +
          `"${req.query}"`,
      );
    }

    const body = (await response.json()) as CommonsResponse;
    const pages = body.query?.pages;
    if (!pages) return [];

    const retrievedAt = new Date().toISOString();
    const candidates: VisualCandidate[] = [];
    let discardedForLicence = 0;

    for (const page of Object.values(pages)) {
      const info = page.imageinfo?.[0];
      if (!info) continue;

      const mime = typeof info.mime === "string" ? info.mime : "";
      const extension = ACCEPTED_MIME[mime];
      if (!extension) continue;

      const fileUrl = typeof info.url === "string" ? info.url : "";
      const descriptionUrl =
        typeof info.descriptionurl === "string" ? info.descriptionurl : "";
      if (fileUrl.length === 0 || descriptionUrl.length === 0) continue;

      const licence = parseCommonsLicence(info.extmetadata);
      if (licence === null) {
        // Fail closed: no licence published => the file does not exist for us.
        discardedForLicence += 1;
        continue;
      }

      const title =
        typeof page.title === "string" && page.title.length > 0
          ? page.title
          : fileUrl;
      const attribution = parseCommonsAttribution(info.extmetadata);

      candidates.push({
        mediaKind: "image",
        fileExtension: extension,
        dimensionsDeclared: true,
        provenance: {
          provider: "wikimedia",
          // The file description page is the citable origin; the raw upload URL
          // carries no licence context on its own.
          sourceUrl: descriptionUrl,
          licence,
          retrievedAt,
          width: asNumber(info.width),
          height: asNumber(info.height),
          title,
          ...(attribution ? { attribution } : {}),
        },
        fetchBytes: () => fetchUrlBytes(fileUrl),
      });
    }

    logger.info(
      {
        query: req.query,
        candidates: candidates.length,
        discarded_no_licence: discardedForLicence,
      },
      "wikimedia candidates",
    );
    return candidates;
  },
};
