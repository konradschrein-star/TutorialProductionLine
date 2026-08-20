/**
 * `requestVisual()` — the single entry point for every visual in the
 * BUSINESS_PLAN_HUB format.
 *
 * Nothing in this format is screen-recorded (design §3.2). Every frame is
 * either generated through the media-gateway or sourced from a licence-bearing
 * provider, and every returned asset carries full provenance.
 *
 * The loop, per provider in policy order:
 *
 *   search → screen (provenance + licence posture + declared-width floor)
 *          → dedup by sourceUrl (skip the download entirely)
 *          → fetch → sha256 → dedup by content hash
 *          → measure (images) → re-check the width floor
 *          → store under LOCAL_MEDIA_ROOT → VisualRef
 *
 * Fail-closed throughout:
 *   - a candidate missing provider/sourceUrl/licence/retrievedAt is DISCARDED,
 *     never patched;
 *   - a `google`/`web` result is FLAGGED `needs-review`, never silently
 *     published;
 *   - if no provider yields a usable candidate the call THROWS, naming the
 *     query and every provider tried with the reason it failed. There is no
 *     placeholder image anywhere in this file.
 */
import { createContextLogger } from "@repo/logger";
import { VisualRefSchema } from "@repo/contracts";
import type { VisualRef } from "@repo/contracts";
import { assessPosture } from "./licence.js";
import {
  ESSENTIAL_VISUAL_PROVIDERS,
  EssentialVisualProviderError,
  isEssentialProvider,
  probeGeneratedBackends,
} from "./essential-providers.js";
import { measureImageDimensions } from "./image-dimensions.js";
import {
  providerOrderFor,
  screenCandidates,
  validateProvenance,
  validateRequest,
} from "./policy.js";
import { contentHashOf, createFileSystemVisualStore } from "./store.js";
import { generatedProvider } from "./providers/generated.js";
import { googleProvider } from "./providers/google.js";
import { pexelsProvider } from "./providers/pexels.js";
import { webProvider } from "./providers/web.js";
import { wikimediaProvider } from "./providers/wikimedia.js";
import type {
  CandidateRejection,
  ProviderAttempt,
  StoredVisual,
  VisualCandidate,
  VisualProvider,
  VisualProviderAdapter,
  VisualRequest,
  VisualResult,
  VisualStore,
} from "./types.js";

const logger = createContextLogger("visual-gateway");

/** The production adapter set. Override per-call for tests or a dry run. */
export const DEFAULT_ADAPTERS: Record<VisualProvider, VisualProviderAdapter> = {
  generated: generatedProvider,
  pexels: pexelsProvider,
  wikimedia: wikimediaProvider,
  google: googleProvider,
  web: webProvider,
};

export interface RequestVisualDeps {
  /** Replace or stub individual providers. Unlisted ones use the default. */
  adapters?: Partial<Record<VisualProvider, VisualProviderAdapter>>;
  /** Defaults to the filesystem store under `<LOCAL_MEDIA_ROOT>/visual-library`. */
  store?: VisualStore;
}

/**
 * Thrown when no provider could serve the request. Carries the full attempt
 * log so the failure is diagnosable from one log line rather than a rerun.
 */
export class VisualSourcingError extends Error {
  readonly request: VisualRequest;
  readonly attempts: ProviderAttempt[];
  readonly rejections: CandidateRejection[];

  constructor(
    request: VisualRequest,
    attempts: ProviderAttempt[],
    rejections: CandidateRejection[],
  ) {
    const attemptLines = attempts
      .map((a) => `  - ${a.provider}: ${a.outcome} — ${a.reason}`)
      .join("\n");
    const rejectionLines =
      rejections.length > 0
        ? `\nDiscarded candidates:\n` +
          rejections
            .slice(0, 12)
            .map((r) => `  - ${r.provider} ${r.sourceUrl}: ${r.reason}`)
            .join("\n")
        : "";
    super(
      `visual-gateway: no usable visual for query "${request.query}" ` +
        `(intent "${request.intent}", topic "${request.topic}", ` +
        `minWidth ${request.minWidth}px).\n` +
        `Providers tried:\n${attemptLines}${rejectionLines}\n` +
        `No placeholder is substituted — fix the query, widen the provider ` +
        `order, or lower minWidth deliberately.`,
    );
    this.name = "VisualSourcingError";
    this.request = request;
    this.attempts = attempts;
    this.rejections = rejections;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function toVisualRef(stored: StoredVisual): VisualRef {
  const ref = {
    provider: stored.provenance.provider,
    assetKey: stored.assetKey,
    sourceUrl: stored.provenance.sourceUrl,
    licence: stored.provenance.licence,
    retrievedAt: stored.provenance.retrievedAt,
  };
  // The contract schema (F2) is the last gate before the ref reaches a scene.
  // If the gateway ever produced something it rejects, that is a bug here and
  // must surface as a throw, not as an unparseable plan three stages later.
  const parsed = VisualRefSchema.safeParse(ref);
  if (!parsed.success) {
    throw new Error(
      `visual-gateway: produced a VisualRef that fails VisualRefSchema — ` +
        `${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

/**
 * Build the result from a stored asset. The review reason is RECOMPUTED from
 * the stored provenance rather than carried over from the candidate that
 * triggered the lookup — on a dedup hit those are different assets, and the
 * reason must describe the one we are actually returning.
 */
function resultFromStored(
  stored: StoredVisual,
  deduplicated: boolean,
  attempts: ProviderAttempt[],
): VisualResult {
  const { reason } = assessPosture(
    stored.provenance.provider,
    stored.provenance.licence,
  );
  return {
    visual: toVisualRef(stored),
    provenance: stored.provenance,
    posture: stored.posture,
    reviewReason: stored.posture === "needs-review" ? reason : null,
    contentHash: stored.contentHash,
    storagePath: stored.storagePath,
    bytes: stored.bytes,
    mediaKind: stored.mediaKind,
    deduplicated,
    rejected: attempts,
  };
}

/**
 * Screen a LIBRARY HIT against this request's own width floor.
 *
 * Both dedup paths used to return before the measured-dimension check below,
 * which is the only place actual pixel width is ever compared to `minWidth`.
 * The declared-width pre-filter in `policy.ts` does not cover the gap either:
 * it is skipped entirely for `dimensionsDeclared: false` candidates. The result
 * was that an asset stored by an earlier 720p job was served verbatim to a
 * 1080p job — precisely the "480px stock thumbnail upscaled into a 1080p frame"
 * the caller states this floor to prevent.
 *
 * The stored width IS authoritative: `save()` records the re-measured
 * dimensions for images, and video candidates are rejected upstream unless the
 * source declared theirs.
 *
 * @returns A rejection reason, or `null` when the stored asset clears the floor.
 */
function storedBelowFloor(
  stored: StoredVisual,
  minWidth: number,
): string | null {
  const width = stored.provenance.width;
  if (!Number.isFinite(width) || width <= 0) {
    return (
      `stored asset ${stored.assetKey} records no usable width ` +
      `(${String(width)}), so it cannot be checked against the ${minWidth}px ` +
      `floor. An unverifiable asset is not served rather than assumed adequate.`
    );
  }
  if (width < minWidth) {
    return (
      `stored width ${width}px is below the ${minWidth}px floor for this ` +
      `request (asset ${stored.assetKey}). It was admitted under an earlier ` +
      `request with a lower floor; it is not upscaled.`
    );
  }
  return null;
}

/**
 * Resolve one visual.
 *
 * @throws VisualSourcingError when every provider in the order failed or
 *         produced only unusable candidates.
 * @throws Error when the request itself is invalid (empty query, non-positive
 *         minWidth, unknown intent) — that is a caller bug, not a sourcing
 *         failure, and it must not be retried.
 */
export async function requestVisual(
  req: VisualRequest,
  deps: RequestVisualDeps = {},
): Promise<VisualResult> {
  validateRequest(req);

  const store = deps.store ?? createFileSystemVisualStore();
  const order = providerOrderFor(req);
  const attempts: ProviderAttempt[] = [];
  const rejections: CandidateRejection[] = [];

  // Fail-closed default: see the `format` field on VisualRequest.
  const format = req.format ?? "BUSINESS_PLAN_HUB";

  /**
   * Record a provider failure — and REFUSE to continue past it when that
   * provider is essential to the format.
   *
   * This is the second enforcement point described in
   * `essential-providers.ts`. The pre-flight cannot cover this case: a backend
   * that was configured when the job started can die thirty minutes into a
   * fifteen-minute narration, and at that moment the provider order would
   * happily walk on to `pexels` and produce a stock-photo video that reports
   * success. Walking on is the bug. There is nothing to fall back TO, because
   * the next provider makes a different product.
   *
   * @throws EssentialVisualProviderError when `provider` is essential.
   */
  async function recordFailure(
    provider: VisualProvider,
    outcome: ProviderAttempt["outcome"],
    reason: string,
  ): Promise<void> {
    attempts.push({ provider, outcome, reason });

    if (!isEssentialProvider(format, provider)) return;

    const remaining = order.slice(order.indexOf(provider) + 1);
    // Probe purely to enrich the diagnostic; it spends nothing. If even the
    // probe fails, the refusal still stands — we just report fewer details.
    let verdicts: Awaited<
      ReturnType<typeof probeGeneratedBackends>
    >["verdicts"] = [];
    if (provider === "generated") {
      try {
        ({ verdicts } = await probeGeneratedBackends({
          format,
          refCount: 1,
        }));
      } catch {
        verdicts = [];
      }
    }

    throw new EssentialVisualProviderError({
      format,
      provider,
      rationale:
        ESSENTIAL_VISUAL_PROVIDERS[format]?.rationale ??
        `"${provider}" is declared essential to ${format}.`,
      verdicts,
      detail:
        `it failed mid-run while sourcing "${req.query}" (intent ` +
        `"${req.intent}") with outcome "${outcome}": ${reason}. ` +
        (remaining.length > 0
          ? `The provider order would have continued to ` +
            `${remaining.join(", ")}, which source rather than generate — so ` +
            `that fallthrough was REFUSED.`
          : `No provider remained after it.`),
    });
  }

  for (const provider of order) {
    const adapter = deps.adapters?.[provider] ?? DEFAULT_ADAPTERS[provider];
    if (!adapter) {
      await recordFailure(
        provider,
        "no-adapter",
        `no adapter registered for "${provider}"`,
      );
      continue;
    }

    let candidates: VisualCandidate[];
    try {
      candidates = await adapter.search(req);
    } catch (error) {
      logger.warn(
        { provider, query: req.query, error: errorMessage(error) },
        "visual provider failed",
      );
      await recordFailure(provider, "error", errorMessage(error));
      continue;
    }

    if (candidates.length === 0) {
      await recordFailure(
        provider,
        "no-results",
        "provider returned no candidates (no match, or unconfigured)",
      );
      continue;
    }

    const screening = screenCandidates(req, candidates);
    rejections.push(...screening.rejected);

    if (screening.accepted.length === 0) {
      await recordFailure(
        provider,
        "all-candidates-rejected",
        `${candidates.length} candidate(s) all failed provenance, licence ` +
          `or width screening`,
      );
      continue;
    }

    let candidateFailure: string | null = null;

    for (const accepted of screening.accepted) {
      const { candidate, posture } = accepted;

      // ── Fetch-once dedup: the same URL anywhere in the catalogue ──────────
      const bySourceUrl = await store.lookupBySourceUrl(
        candidate.provenance.sourceUrl,
      );
      if (bySourceUrl) {
        const tooNarrow = storedBelowFloor(bySourceUrl, req.minWidth);
        if (tooNarrow !== null) {
          rejections.push({
            provider,
            sourceUrl: candidate.provenance.sourceUrl,
            reason: `library hit (sourceUrl) rejected: ${tooNarrow}`,
          });
          continue;
        }
        logger.info(
          { provider, source_url: candidate.provenance.sourceUrl },
          "visual served from library (sourceUrl hit) — no fetch",
        );
        return resultFromStored(bySourceUrl, true, attempts);
      }

      let bytes: Buffer;
      try {
        bytes = await candidate.fetchBytes();
      } catch (error) {
        candidateFailure = errorMessage(error);
        rejections.push({
          provider,
          sourceUrl: candidate.provenance.sourceUrl,
          reason: `fetch failed: ${candidateFailure}`,
        });
        continue;
      }

      if (bytes.length === 0) {
        rejections.push({
          provider,
          sourceUrl: candidate.provenance.sourceUrl,
          reason: "fetch returned zero bytes",
        });
        continue;
      }

      // Providers may finalise provenance during the fetch (the generated
      // adapter only learns its media ref then), so re-validate.
      const postFetch = validateProvenance(candidate);
      if (!postFetch.ok) {
        rejections.push({
          provider,
          sourceUrl: String(candidate.provenance.sourceUrl),
          reason: `provenance invalid after fetch: ${postFetch.reason}`,
        });
        continue;
      }

      // ── Content dedup: same bytes, any URL ───────────────────────────────
      const contentHash = contentHashOf(bytes);
      const byHash = await store.lookupByHash(contentHash);
      if (byHash) {
        const tooNarrow = storedBelowFloor(byHash, req.minWidth);
        if (tooNarrow !== null) {
          rejections.push({
            provider,
            sourceUrl: candidate.provenance.sourceUrl,
            reason: `library hit (content hash) rejected: ${tooNarrow}`,
          });
          continue;
        }
        logger.info(
          { provider, content_hash: contentHash },
          "visual served from library (content hash hit)",
        );
        return resultFromStored(byHash, true, attempts);
      }

      // ── Real dimensions ─────────────────────────────────────────────────
      let width = candidate.provenance.width;
      let height = candidate.provenance.height;
      if (candidate.mediaKind === "image") {
        try {
          const measured = measureImageDimensions(bytes);
          width = measured.width;
          height = measured.height;
        } catch (error) {
          rejections.push({
            provider,
            sourceUrl: candidate.provenance.sourceUrl,
            reason: `dimensions unreadable: ${errorMessage(error)}`,
          });
          continue;
        }
      }
      if (width < req.minWidth) {
        rejections.push({
          provider,
          sourceUrl: candidate.provenance.sourceUrl,
          reason: `actual width ${width}px is below the ${req.minWidth}px floor`,
        });
        continue;
      }

      const stored = await store.save({
        bytes,
        contentHash,
        fileExtension: candidate.fileExtension,
        mediaKind: candidate.mediaKind,
        provenance: { ...candidate.provenance, width, height },
        posture,
      });

      logger.info(
        {
          provider,
          posture,
          content_hash: contentHash,
          asset_key: stored.assetKey,
          width,
          height,
        },
        posture === "needs-review"
          ? "visual stored — FLAGGED for QC"
          : "visual stored",
      );

      return resultFromStored(stored, false, attempts);
    }

    await recordFailure(
      provider,
      "all-candidates-rejected",
      candidateFailure !== null
        ? `every accepted candidate failed on fetch/validation ` +
            `(last: ${candidateFailure})`
        : "every accepted candidate failed post-fetch validation",
    );
  }

  throw new VisualSourcingError(req, attempts, rejections);
}
