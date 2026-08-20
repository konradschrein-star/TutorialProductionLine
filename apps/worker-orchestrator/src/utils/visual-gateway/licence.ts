/**
 * Licence policy for the visual gateway.
 *
 * This file is the single documented answer to "may this asset appear in a
 * published video?". It is deliberately a pure, dependency-free predicate over
 * a licence string so it can be unit-tested, quoted in a QC UI, and audited
 * later against whatever actually shipped.
 *
 * Publishing posture is decided by TWO things, never one:
 *
 *   1. the licence string itself   -> `isPublishable(licence)`
 *   2. who told us that licence    -> `PROVIDER_LICENCE_AUTHORITY`
 *
 * Wikimedia Commons publishes a machine-readable, authoritative licence field
 * per file, and Pexels grants a single blanket licence, so those two can be
 * trusted at face value. An image-search result or an arbitrary web document
 * carries whatever the host says, which is not evidence — those are ALWAYS
 * `needs-review`, however permissive their licence string looks.
 */
import type { LicencePosture, VisualProvider } from "./types.js";

/** The literal we write when a provider gave us no licence information. */
export const UNKNOWN_LICENCE = "unknown";

/**
 * The licence we stamp on assets our own pipeline generated. Not a public
 * licence identifier — it records that no third party holds rights in it.
 */
export const GENERATED_LICENCE = "generated:in-house";

/**
 * Is the licence metadata this provider reports authoritative?
 *
 *   generated  we made it; there is no third party.
 *   pexels     one blanket licence, granted by the API we called.
 *   wikimedia  per-file machine-readable licence from the Commons API.
 *   google     the search index does not know the licence of the host's image.
 *   web        an arbitrary page; its footer is not a grant.
 */
export const PROVIDER_LICENCE_AUTHORITY: Record<VisualProvider, boolean> = {
  generated: true,
  pexels: true,
  wikimedia: true,
  google: false,
  web: false,
};

/**
 * Licence families that may be published, matched after normalisation.
 *
 * Deliberately EXCLUDED, and therefore `needs-review`:
 *   - `unknown` / blank                 no grant at all
 *   - NC (non-commercial)               the channel is commercial marketing
 *   - ND (no-derivatives)               we crop, grade and composite everything
 *   - "all rights reserved", "fair use" not a licence we can rely on at volume
 *   - GFDL                              free, but its invariant-section and
 *                                       full-text-reproduction duties are not
 *                                       satisfiable inside a video frame
 */
// NB: patterns are matched against the hyphen-flattened form produced in
// `isPublishable`, so `generated:in-house` arrives as `generated:in house`.
const PUBLISHABLE_PATTERNS: readonly RegExp[] = [
  /^generated:in house$/,
  /^pexels license$/,
  /^cc0(\b|$)/,
  /^cc[ -]?by(?![a-z])(?!.*\b(nc|nd)\b)/,
  /^cc[ -]?by[ -]?sa(?!.*\b(nc|nd)\b)/,
  /^public domain\b/,
  /^pd(-|\b)/,
  /^no known copyright restrictions$/,
  /^open government licence/,
  /^us government work$/,
  /^work of the (united states|us) (federal )?government$/,
];

/**
 * Licence strings that must NEVER be treated as publishable even if a looser
 * pattern above would otherwise match a substring of them.
 */
const BLOCKED_PATTERNS: readonly RegExp[] = [
  /\bnc\b/, // non-commercial
  /\bnd\b/, // no-derivatives
  /non[- ]?commercial/,
  /no[- ]?deriv/,
  /all rights reserved/,
  /fair use/,
  /\bgfdl\b/,
  /free art licen[cs]e 1\.2 only/,
];

/**
 * Normalise a licence string for matching: lower-cased, punctuation-collapsed,
 * single-spaced. `"CC BY-SA 4.0"`, `"cc-by-sa-4.0"` and `"CC  BY SA 4.0"` all
 * normalise to `"cc by sa 4.0"`.
 */
export function normaliseLicence(licence: string): string {
  return licence
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * May an asset under this licence be published without human review?
 *
 * PURE and total: no network, no env, no throw. An empty string, `"unknown"`,
 * an NC/ND variant or anything unrecognised returns `false` — the default is
 * always "no", so a licence family we have never seen fails closed into the QC
 * queue rather than onto YouTube.
 */
export function isPublishable(licence: string): boolean {
  const raw = normaliseLicence(licence);
  if (raw.length === 0) return false;
  if (raw === UNKNOWN_LICENCE) return false;

  // Hyphen-tolerant form so `cc-by-sa-4.0` matches the spaced patterns.
  const value = raw.replace(/-/g, " ").replace(/\s+/g, " ");

  for (const blocked of BLOCKED_PATTERNS) {
    if (blocked.test(value)) return false;
  }
  return PUBLISHABLE_PATTERNS.some((pattern) => pattern.test(value));
}

/** Does this licence oblige us to carry a visible credit? */
export function requiresAttribution(licence: string): boolean {
  const value = normaliseLicence(licence).replace(/-/g, " ");
  if (value === normaliseLicence(GENERATED_LICENCE).replace(/-/g, " ")) {
    return false;
  }
  if (value === "pexels license") return false;
  if (/^cc0\b/.test(value)) return false;
  if (/^public domain\b/.test(value) || /^pd(\b| )/.test(value)) return false;
  return true;
}

/**
 * The gateway's posture decision for one candidate.
 *
 * Returns `needs-review` with a human-readable reason whenever the asset may be
 * used but must be looked at first. Never returns `publishable` for a provider
 * whose licence metadata is not authoritative — that is the whole point of the
 * google/web gate in design §6.1.
 */
export function assessPosture(
  provider: VisualProvider,
  licence: string,
): { posture: LicencePosture; reason: string | null } {
  if (!PROVIDER_LICENCE_AUTHORITY[provider]) {
    return {
      posture: "needs-review",
      reason:
        `provider "${provider}" does not report authoritative licence ` +
        `metadata (licence recorded as "${licence}") — QC must confirm ` +
        `usage rights before this video is published`,
    };
  }
  if (!isPublishable(licence)) {
    return {
      posture: "needs-review",
      reason:
        `licence "${licence}" is not on the publishable allowlist ` +
        `(see licence.ts PUBLISHABLE_PATTERNS) — QC must clear it`,
    };
  }
  return { posture: "publishable", reason: null };
}
