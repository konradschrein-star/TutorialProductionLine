/**
 * Routing and provenance policy for the visual gateway.
 *
 * Pure functions only — no network, no filesystem. Everything here is the part
 * of the gateway that decides WHICH provider is asked and WHETHER a candidate
 * is allowed to exist, and it is the part that must be unit-testable without a
 * live API in front of it.
 */
import { assessPosture } from "./licence.js";
import type {
  CandidateRejection,
  LicencePosture,
  VisualCandidate,
  VisualIntent,
  VisualProvider,
  VisualRequest,
} from "./types.js";
import { VISUAL_PROVIDERS } from "./types.js";

/**
 * Provider order per intent, best-provenance-first within what the intent can
 * actually use.
 *
 * `generated` leads wherever a plate can be drawn rather than found: it has no
 * third-party rights at all, which is the cheapest licence in existence at this
 * volume. `wikimedia` leads for documents and logos because Commons publishes
 * an authoritative per-file licence. `google` and `web` are last everywhere —
 * they can only ever produce `needs-review` assets (see `licence.ts`).
 */
export const PROVIDER_ORDER_BY_INTENT: Record<VisualIntent, VisualProvider[]> =
  {
    "prop-plate": ["generated", "pexels"],
    "abstract-subject": ["generated", "pexels", "wikimedia"],
    thumbnail: ["generated", "pexels"],
    broll: ["pexels", "generated", "wikimedia"],
    document: ["wikimedia", "web", "google"],
    logo: ["wikimedia", "google", "web"],
    "long-tail": ["wikimedia", "generated", "pexels", "google", "web"],
  };

function parseProviderList(raw: string): VisualProvider[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is VisualProvider =>
      (VISUAL_PROVIDERS as readonly string[]).includes(s),
    );
}

/**
 * The provider order for a request.
 *
 * Precedence: explicit `req.providerOrder` → env override
 * `VISUAL_GATEWAY_PROVIDERS_<INTENT>` (upper-snake) → env override
 * `VISUAL_GATEWAY_PROVIDERS` → the intent default. Motion requests put
 * `pexels` first because it is the only provider here that returns video.
 *
 * @throws Error when the resolved order is empty — an unroutable request must
 *         fail loudly rather than fall through to "try everything".
 */
export function providerOrderFor(req: VisualRequest): VisualProvider[] {
  const explicit = req.providerOrder;
  let order: VisualProvider[];

  if (explicit && explicit.length > 0) {
    order = [...explicit];
  } else {
    const intentKey = req.intent.toUpperCase().replace(/-/g, "_");
    const envIntent = process.env[`VISUAL_GATEWAY_PROVIDERS_${intentKey}`];
    const envGlobal = process.env["VISUAL_GATEWAY_PROVIDERS"];
    const fromEnv = envIntent ?? envGlobal;
    order = fromEnv
      ? parseProviderList(fromEnv)
      : [...PROVIDER_ORDER_BY_INTENT[req.intent]];
  }

  if (req.preferMotion && order.includes("pexels")) {
    order = ["pexels", ...order.filter((p) => p !== "pexels")];
  }

  if (order.length === 0) {
    throw new Error(
      `visual-gateway: no providers resolved for intent "${req.intent}" ` +
        `(query "${req.query}"). Check VISUAL_GATEWAY_PROVIDERS* env ` +
        `overrides — an empty order is never treated as "try them all".`,
    );
  }
  return order;
}

/** Reject a request that cannot be served correctly, before any network call. */
export function validateRequest(req: VisualRequest): void {
  const problems: string[] = [];
  if (req.query.trim().length === 0) problems.push("query is empty");
  if (req.topic.trim().length === 0) problems.push("topic is empty");
  if (!Number.isFinite(req.minWidth) || req.minWidth <= 0) {
    problems.push(`minWidth must be a positive number, got ${req.minWidth}`);
  }
  if (!(req.intent in PROVIDER_ORDER_BY_INTENT)) {
    problems.push(`unknown intent "${req.intent}"`);
  }
  if (
    req.preferMotion &&
    (!Number.isFinite(req.motionDurationSeconds ?? NaN) ||
      (req.motionDurationSeconds ?? 0) <= 0)
  ) {
    // Motion goes through the footage gateway, which trims to a target length.
    // The scene knows how long the beat is; the gateway must not pick for it.
    problems.push(
      "preferMotion is set but motionDurationSeconds is missing or non-positive",
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `visual-gateway: invalid VisualRequest — ${problems.join("; ")}. ` +
        `The caller must state what it needs; the gateway does not guess.`,
    );
  }
}

/** ISO-8601 instant, as `VisualRefSchema.retrievedAt` requires. */
function isIsoInstant(value: string): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

export type ProvenanceCheck = { ok: true } | { ok: false; reason: string };

/**
 * The fail-closed provenance gate (design §8 rule 6).
 *
 * A candidate missing `provider`, `sourceUrl`, `licence` or `retrievedAt`, or
 * carrying a malformed one, is DISCARDED. Nothing here patches a missing field
 * with a default — that is precisely the behaviour the rule exists to prevent.
 */
export function validateProvenance(
  candidate: VisualCandidate,
): ProvenanceCheck {
  const p = candidate.provenance;

  if (!(VISUAL_PROVIDERS as readonly string[]).includes(p.provider)) {
    return { ok: false, reason: `unknown provider "${String(p.provider)}"` };
  }
  if (typeof p.sourceUrl !== "string" || p.sourceUrl.trim().length === 0) {
    return { ok: false, reason: "sourceUrl is missing or blank" };
  }
  if (p.provider !== "generated" && !/^https?:\/\//i.test(p.sourceUrl)) {
    return {
      ok: false,
      reason:
        `sourceUrl "${p.sourceUrl}" is not an http(s) URL; a sourced asset ` +
        `must cite a retrievable origin`,
    };
  }
  if (typeof p.licence !== "string" || p.licence.trim().length === 0) {
    return { ok: false, reason: "licence is missing or blank" };
  }
  if (typeof p.retrievedAt !== "string" || !isIsoInstant(p.retrievedAt)) {
    return {
      ok: false,
      reason: `retrievedAt "${String(p.retrievedAt)}" is not an ISO-8601 instant`,
    };
  }
  if (typeof p.title !== "string" || p.title.trim().length === 0) {
    return { ok: false, reason: "title is missing or blank" };
  }
  if (candidate.fileExtension.trim().length === 0) {
    return { ok: false, reason: "fileExtension is blank" };
  }
  if (candidate.mediaKind === "video" && !candidate.dimensionsDeclared) {
    return {
      ok: false,
      reason:
        "video candidate does not declare width/height and video dimensions " +
        "cannot be measured from bytes here — the provider must report them",
    };
  }
  if (candidate.dimensionsDeclared && (p.width <= 0 || p.height <= 0)) {
    return {
      ok: false,
      reason: `declared dimensions ${p.width}x${p.height} are not positive`,
    };
  }
  return { ok: true };
}

export interface AcceptedCandidate {
  candidate: VisualCandidate;
  posture: LicencePosture;
  reviewReason: string | null;
}

export interface CandidateScreening {
  accepted: AcceptedCandidate[];
  rejected: CandidateRejection[];
}

/**
 * Validate provenance, apply the licence posture rule and the declared-width
 * floor, then rank what survives.
 *
 * Ranking: publishable before needs-review, then widest first. A `needs-review`
 * candidate is kept (and flagged) unless the request sets
 * `allowNeedsReview: false`, matching design §6.1 — google/web results are
 * gated by QC, not silently dropped and not silently published.
 */
export function screenCandidates(
  req: VisualRequest,
  candidates: VisualCandidate[],
): CandidateScreening {
  const accepted: AcceptedCandidate[] = [];
  const rejected: CandidateRejection[] = [];
  const allowNeedsReview = req.allowNeedsReview !== false;

  for (const candidate of candidates) {
    const provenance = validateProvenance(candidate);
    if (!provenance.ok) {
      rejected.push({
        provider: candidate.provenance.provider,
        sourceUrl: String(candidate.provenance.sourceUrl ?? "<missing>"),
        reason: provenance.reason,
      });
      continue;
    }

    const { posture, reason } = assessPosture(
      candidate.provenance.provider,
      candidate.provenance.licence,
    );
    if (posture === "needs-review" && !allowNeedsReview) {
      rejected.push({
        provider: candidate.provenance.provider,
        sourceUrl: candidate.provenance.sourceUrl,
        reason: `needs-review candidate refused (allowNeedsReview=false): ${reason}`,
      });
      continue;
    }

    if (
      candidate.dimensionsDeclared &&
      candidate.provenance.width < req.minWidth
    ) {
      rejected.push({
        provider: candidate.provenance.provider,
        sourceUrl: candidate.provenance.sourceUrl,
        reason:
          `declared width ${candidate.provenance.width}px is below the ` +
          `${req.minWidth}px floor`,
      });
      continue;
    }

    accepted.push({ candidate, posture, reviewReason: reason });
  }

  accepted.sort((a, b) => {
    if (a.posture !== b.posture) return a.posture === "publishable" ? -1 : 1;
    return b.candidate.provenance.width - a.candidate.provenance.width;
  });

  return { accepted, rejected };
}
