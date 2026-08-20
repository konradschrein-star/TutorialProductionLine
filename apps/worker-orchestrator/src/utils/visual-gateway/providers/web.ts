/**
 * `web` provider — one named document, fetched directly.
 *
 * This is NOT a crawler and NOT a search. It fetches exactly the URL the caller
 * named in `VisualRequest.documentUrl` — an SBA form image, a filing page's
 * scan, a regulation excerpt someone already located. If the caller did not
 * name one, the provider has nothing to offer and says so; it never goes
 * looking.
 *
 * Licence is always `"unknown"`: a page serving an image is not a grant. Every
 * result is therefore `needs-review` (see `licence.ts`) and QC clears it before
 * publication. That gate is the point — design §6.1 treats unknown provenance
 * at this volume as an unbounded liability, not a soft warning.
 *
 * An allowlist gate applies on top: `VISUAL_GATEWAY_WEB_HOSTS` (comma-separated
 * hostnames) restricts what may be fetched. Unset means "no host restriction",
 * which is safe only because the caller had to name the exact URL anyway. The
 * primary-source domains from the format design are pre-trusted for logging.
 */
import { createContextLogger } from "@repo/logger";
import { UNKNOWN_LICENCE } from "../licence.js";
import type {
  VisualCandidate,
  VisualProviderAdapter,
  VisualRequest,
} from "../types.js";

const logger = createContextLogger("visual-gateway:web");

/** Design §4: the primary-source allowlist the format already trusts. */
export const PRIMARY_SOURCE_HOSTS: readonly string[] = [
  "uscis.gov",
  "sba.gov",
  "govinfo.gov",
  "ecfr.gov",
  "federalregister.gov",
  "irs.gov",
];

const ACCEPTED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Host allowlist from env, or `null` when no restriction is configured. */
export function webHostAllowlist(): string[] | null {
  const raw = process.env["VISUAL_GATEWAY_WEB_HOSTS"];
  if (!raw || raw.trim().length === 0) return null;
  const hosts = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
  return hosts.length > 0 ? hosts : null;
}

function hostAllowed(host: string, allowlist: string[] | null): boolean {
  if (allowlist === null) return true;
  return allowlist.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

/**
 * Fetch the named document.
 *
 * @throws Error when `documentUrl` is not an http(s) URL, when its host is not
 *         on a configured allowlist, or when the fetch fails or returns a
 *         content type we cannot composite. Returns `[]` only when no
 *         `documentUrl` was supplied at all.
 */
export const webProvider: VisualProviderAdapter = {
  provider: "web",

  async search(req: VisualRequest): Promise<VisualCandidate[]> {
    const documentUrl = req.documentUrl?.trim();
    if (!documentUrl || documentUrl.length === 0) {
      logger.info(
        { query: req.query },
        "web provider skipped — no documentUrl named",
      );
      return [];
    }
    if (!/^https?:\/\//i.test(documentUrl)) {
      throw new Error(
        `visual-gateway: documentUrl "${documentUrl}" is not an http(s) URL`,
      );
    }

    const host = hostOf(documentUrl);
    if (host === null) {
      throw new Error(
        `visual-gateway: documentUrl "${documentUrl}" is not parseable`,
      );
    }
    const allowlist = webHostAllowlist();
    if (!hostAllowed(host, allowlist)) {
      throw new Error(
        `visual-gateway: host "${host}" is not on VISUAL_GATEWAY_WEB_HOSTS ` +
          `(${allowlist?.join(", ") ?? "<unset>"}) — refusing to fetch it`,
      );
    }

    // A HEAD first so an HTML page or a PDF is rejected before we pull bytes.
    const head = await fetch(documentUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(20_000),
    });
    if (!head.ok) {
      throw new Error(
        `visual-gateway: web document HEAD failed (${head.status}) for ${documentUrl}`,
      );
    }
    const mime = (head.headers.get("content-type") ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    const extension = ACCEPTED_MIME[mime];
    if (!extension) {
      throw new Error(
        `visual-gateway: web document ${documentUrl} is "${mime}", not a ` +
          `raster image (accepted: ${Object.keys(ACCEPTED_MIME).join(", ")})`,
      );
    }

    const isPrimary = PRIMARY_SOURCE_HOSTS.some(
      (h) => host === h || host.endsWith(`.${h}`),
    );
    logger.info(
      { host, primary_source: isPrimary, mime },
      "web document candidate (needs-review)",
    );

    return [
      {
        mediaKind: "image",
        fileExtension: extension,
        // Nothing declares dimensions on a bare HTTP fetch; the gateway
        // measures the bytes.
        dimensionsDeclared: false,
        provenance: {
          provider: "web",
          sourceUrl: documentUrl,
          licence: UNKNOWN_LICENCE,
          retrievedAt: new Date().toISOString(),
          width: 0,
          height: 0,
          title:
            `named document (${host}${isPrimary ? ", primary source" : ""}): ` +
            `${req.query}`,
        },
        fetchBytes: async (): Promise<Buffer> => {
          const response = await fetch(documentUrl, {
            signal: AbortSignal.timeout(60_000),
          });
          if (!response.ok) {
            throw new Error(
              `visual-gateway: web document download failed ` +
                `(${response.status}) for ${documentUrl}`,
            );
          }
          return Buffer.from(await response.arrayBuffer());
        },
      },
    ];
  },
};
