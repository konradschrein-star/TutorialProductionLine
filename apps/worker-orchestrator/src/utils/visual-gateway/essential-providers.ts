/**
 * ESSENTIAL VISUAL PROVIDERS — the gate that refuses a render rather than
 * shipping a different product.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * On 2026-08-16 a three-minute BUSINESS_PLAN_HUB video was delivered with no
 * AI imagery in it at all. Every image backend was unconfigured, the visual
 * gateway recorded that as an ordinary provider miss, and the intent's provider
 * order fell through from `generated` to `pexels`. Stock photographs were
 * sourced, stored with correct provenance, and composited. Every component
 * reported success, the job reached PUBLISHED, and nothing anywhere said the
 * format's defining look had been substituted.
 *
 * THE DISTINCTION THIS ENCODES
 * ----------------------------
 * Falling back between two image MODELS is a fallback: gpt-image-2 to
 * seedream-5-pro produces the same kind of frame, and the viewer cannot tell.
 * Falling back from GENERATED to STOCK is not a fallback — it is a different
 * product. The prop-plate look IS BUSINESS_PLAN_HUB; a video of stock office
 * photography is a different channel wearing the same title. Degradation
 * ACROSS KINDS is therefore refused, loudly, and refused BEFORE any money is
 * spent on a script or narration for a render that cannot look right.
 *
 * WHERE THE DECLARATION LIVES
 * ---------------------------
 * In the `ESSENTIAL_VISUAL_PROVIDERS` table below — data, not a conditional
 * buried in the pipeline. A future format states its own identity by adding a
 * row; a format that is genuinely happy with stock simply has no row and keeps
 * today's behaviour exactly. Nothing else in the gateway needs to change.
 *
 * TWO ENFORCEMENT POINTS, BOTH REQUIRED
 * -------------------------------------
 *  1. `preflightEssentialVisualProviders()` — runs BEFORE script, TTS and
 *     render (see step 0.5 of `processors/business-hub/pipeline.ts`). Catches
 *     the whole-environment case: no generation backend configured at all.
 *  2. `gateway.ts` — refuses to fall through to a provider of another kind when
 *     an ESSENTIAL provider fails mid-run. Catches the case the pre-flight
 *     cannot: a backend that was configured at start and died an hour in.
 *
 * Neither is a substitute for the other, and neither degrades quietly.
 */
import { createContextLogger } from "@repo/logger";
import type { GatewayFormat, MediaBackend } from "../media-gateway/types.js";
import { probeImageChain } from "./media-gateway-port.js";
import type { VisualProvider } from "./types.js";

const logger = createContextLogger("visual-gateway:essential-providers");

/* ------------------------------------------------------------------------- *
 * The declaration
 * ------------------------------------------------------------------------- */

/** One format's statement about which providers it cannot be itself without. */
export interface EssentialProviderPolicy {
  /**
   * Providers whose absence changes WHAT THE VIDEO IS, not merely how good it
   * looks. The gateway will refuse rather than route around one of these.
   */
  readonly providers: readonly VisualProvider[];
  /**
   * Why, in the operator's own terms. Quoted verbatim into the thrown
   * diagnostic — whoever reads that error at 3am is usually not whoever wrote
   * this line, and "essential: true" tells them nothing actionable.
   */
  readonly rationale: string;
}

/**
 * The essential-provider map. A format ABSENT from this table has no essential
 * providers and behaves exactly as it did before this gate existed.
 */
export const ESSENTIAL_VISUAL_PROVIDERS: Partial<
  Record<GatewayFormat, EssentialProviderPolicy>
> = {
  BUSINESS_PLAN_HUB: {
    providers: ["generated"],
    rationale:
      "The art-directed prop-plate look IS this format's identity — a dark " +
      "matte surface, a single-hue ocean palette, and no typography (the " +
      "renderer draws every word and figure itself). Stock photography " +
      "satisfies none of that. A BUSINESS_PLAN_HUB video sourced from stock " +
      "is not a lower-quality BUSINESS_PLAN_HUB video; it is a different " +
      "channel.",
  },
};

/** The essential providers for a format. Empty when the format declares none. */
export function essentialProvidersFor(
  format: GatewayFormat,
): readonly VisualProvider[] {
  return ESSENTIAL_VISUAL_PROVIDERS[format]?.providers ?? [];
}

/** Is this provider one the format cannot be substituted away from? */
export function isEssentialProvider(
  format: GatewayFormat,
  provider: VisualProvider,
): boolean {
  return essentialProvidersFor(format).includes(provider);
}

/* ------------------------------------------------------------------------- *
 * The diagnostic
 * ------------------------------------------------------------------------- */

/** One backend, and the verdict the pre-flight reached about it. */
export interface BackendVerdict {
  backend: MediaBackend;
  usable: boolean;
  /** Plain-language reason. Always populated, including when `usable`. */
  reason: string;
}

/**
 * Thrown when a format's essential visual provider cannot serve.
 *
 * Named, and carrying the structured probe results, so the caller can log the
 * fields as well as the message — and so a test can assert on the CAUSE rather
 * than on prose that will be reworded.
 */
export class EssentialVisualProviderError extends Error {
  readonly format: GatewayFormat;
  readonly provider: VisualProvider;
  readonly rationale: string;
  readonly verdicts: BackendVerdict[];

  constructor(input: {
    format: GatewayFormat;
    provider: VisualProvider;
    rationale: string;
    verdicts: BackendVerdict[];
    /** Extra context when the failure happened mid-run, not at pre-flight. */
    detail?: string;
  }) {
    const probed =
      input.verdicts.length > 0
        ? input.verdicts
            .map(
              (v) =>
                `  - ${v.backend}: ${v.usable ? "USABLE" : "unusable"} — ${v.reason}`,
            )
            .join("\n")
        : "  (no backends were probed — the gateway offered no chain at all)";

    super(
      `visual-gateway: REFUSING TO RENDER ${input.format}. The "${input.provider}" ` +
        `provider is ESSENTIAL to this format and cannot serve.\n` +
        `\nWhy that is fatal rather than a fallback:\n${input.rationale}\n` +
        (input.detail ? `\nWhat happened: ${input.detail}\n` : "") +
        `\nBackends probed:\n${probed}\n` +
        `\nThis render was refused because it would NOT LOOK LIKE THE FORMAT. ` +
        `Substituting stock or sourced imagery for generated imagery is a ` +
        `DIFFERENT PRODUCT, not a degraded one, so no substitution was made ` +
        `and no script, narration or render time was spent.\n` +
        `\nTo fix: configure a generation backend (AI33 needs AI33_API_KEY and ` +
        `MEDIA_ALLOW_AI33_IMAGE=1; veo_fleet, vup and forge need their own ` +
        `credentials), then re-run. To deliberately ship this format on stock ` +
        `imagery, remove it from ESSENTIAL_VISUAL_PROVIDERS — that is a ` +
        `product decision and it must be made in code, not by an outage.`,
    );
    this.name = "EssentialVisualProviderError";
    this.format = input.format;
    this.provider = input.provider;
    this.rationale = input.rationale;
    this.verdicts = input.verdicts;
  }
}

/* ------------------------------------------------------------------------- *
 * The pre-flight
 * ------------------------------------------------------------------------- */

/** What a passing pre-flight reports, for the job log. */
export interface EssentialPreflightReport {
  format: GatewayFormat;
  /** Providers checked. Empty when the format declares none. */
  checked: readonly VisualProvider[];
  /** Backend verdicts behind the `generated` provider. */
  verdicts: BackendVerdict[];
  /** The backends that would actually serve, in routing order. */
  usableBackends: MediaBackend[];
}

/**
 * Probe the backends behind the `generated` provider.
 *
 * The chain comes from the media-gateway itself (`resolveImageChain`) rather
 * than being re-derived here, so the pre-flight can never approve a route the
 * gateway would not take. A backend is judged in three buckets:
 *
 *   - not in the chain      structurally incapable of this request, switched
 *                           off in the provider registry, or behind a flag
 *                           (AI33 needs MEDIA_ALLOW_AI33_IMAGE=1)
 *   - in chain, no creds    the operator has not supplied its API key here
 *   - in chain, configured  it would be tried
 *
 * Health is deliberately NOT consulted: an unprobed backend reports "unknown",
 * and refusing a whole render on a cache that has not warmed up yet would be
 * its own kind of wrong. Liveness is the run's problem; configuration is this
 * function's problem.
 */
export async function probeGeneratedBackends(input: {
  format: GatewayFormat;
  refCount: number;
  aspectRatio?: "16:9" | "9:16" | "1:1";
}): Promise<{ verdicts: BackendVerdict[]; usable: MediaBackend[] }> {
  const probe = await probeImageChain({
    format: input.format,
    refCount: input.refCount,
    ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
  });

  const inChain = new Set(probe.chain);
  const configured = new Set(probe.configured);

  const verdicts: BackendVerdict[] = probe.all.map((backend) => {
    if (!inChain.has(backend)) {
      return {
        backend,
        usable: false,
        reason:
          `not offered for this request — it is switched off in the provider ` +
          `registry, gated behind a feature flag, or structurally unable to ` +
          `serve ${input.refCount} reference image(s) at ` +
          `${input.aspectRatio ?? "16:9"}`,
      };
    }
    if (!configured.has(backend)) {
      return {
        backend,
        usable: false,
        reason:
          "routable, but NO CREDENTIALS are configured in this environment",
      };
    }
    return { backend, usable: true, reason: "routable and configured" };
  });

  return { verdicts, usable: [...probe.configured] };
}

/**
 * THE GATE. Run this before a format spends anything.
 *
 * @throws EssentialVisualProviderError when a declared-essential provider
 *         cannot serve. Naming the backends probed and why each failed, so the
 *         operator does not have to reproduce the failure to diagnose it.
 */
export async function preflightEssentialVisualProviders(input: {
  format: GatewayFormat;
  /** How many reference images generation will pass (the style plate: 0 or 1). */
  refCount: number;
  aspectRatio?: "16:9" | "9:16" | "1:1";
}): Promise<EssentialPreflightReport> {
  const { format } = input;
  const policy = ESSENTIAL_VISUAL_PROVIDERS[format];

  if (!policy || policy.providers.length === 0) {
    logger.info(
      { format },
      "no essential visual providers declared for this format — pre-flight " +
        "passes trivially",
    );
    return { format, checked: [], verdicts: [], usableBackends: [] };
  }

  let verdicts: BackendVerdict[] = [];
  let usableBackends: MediaBackend[] = [];

  for (const provider of policy.providers) {
    if (provider !== "generated") {
      // Only `generated` is backed by the media-gateway and therefore probeable
      // without spending. A future essential provider that is not generation
      // needs its own probe — and must NOT be waved through here, because a
      // pre-flight that silently skips what it cannot check is the same class
      // of bug this whole file exists to remove.
      throw new EssentialVisualProviderError({
        format,
        provider,
        rationale: policy.rationale,
        verdicts: [],
        detail:
          `"${provider}" is declared essential but this pre-flight can only ` +
          `probe "generated" (the media-gateway-backed provider). Add a probe ` +
          `for it rather than letting an unverifiable provider pass.`,
      });
    }

    const probed = await probeGeneratedBackends(input);
    verdicts = probed.verdicts;
    usableBackends = probed.usable;

    if (usableBackends.length === 0) {
      throw new EssentialVisualProviderError({
        format,
        provider,
        rationale: policy.rationale,
        verdicts,
        detail:
          "no image-generation backend is both routable and configured, so " +
          "every generated visual in this video would have fallen through to " +
          "a sourced provider.",
      });
    }
  }

  logger.info(
    {
      format,
      essential_providers: policy.providers,
      usable_backends: usableBackends,
      unusable_backends: verdicts.filter((v) => !v.usable).map((v) => v.backend),
    },
    "essential visual provider pre-flight PASSED",
  );

  return {
    format,
    checked: policy.providers,
    verdicts,
    usableBackends,
  };
}
