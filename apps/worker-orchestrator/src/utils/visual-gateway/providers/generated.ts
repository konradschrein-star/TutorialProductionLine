/**
 * `generated` provider — images drawn by our own pipeline.
 *
 * Routes through the unified media-gateway with format `BUSINESS_PLAN_HUB`
 * (priority 60), via `../media-gateway-port.js`. Calling `vup-client`,
 * `fastgen-client`, `forge-client` or AI33 directly from a format is a standing
 * architectural violation in this repo: the gateway owns priority, backend
 * routing, health-gated failover and rate-limit shaping, and a direct call
 * silently opts out of all four.
 *
 * Provenance for a generated asset: `sourceUrl` is the opaque media-gateway ref
 * (`mediagateway:fleet:…`), which is the closest thing to an origin that
 * exists, and the licence is `generated:in-house` — no third party holds rights
 * in it. The ref is only known after generation, so the candidate's
 * `sourceUrl` is finalised inside `fetchBytes` and the gateway re-validates
 * provenance after the fetch.
 */
import { createContextLogger } from "@repo/logger";
import { DEFAULT_BUSINESS_HUB_IMAGE_MODEL as DEFAULT_IMAGE_MODEL } from "@repo/contracts";

/**
 * Resolution requested alongside this format's default model. "2K" on
 * gpt-image-2 is ~2048x1152 — comfortably above the 1920px a 1080p render
 * needs, where that model's own "1K" default (1280x720) is not.
 */
const DEFAULT_IMAGE_RESOLUTION = "2K";
import {
  downloadGeneratedBytes,
  generateImage,
  toImageBackend,
} from "../media-gateway-port.js";
import {
  composeArtDirectedPrompt,
  loadStyleReference,
  variationFor,
} from "../art-direction.js";
import { GENERATED_LICENCE } from "../licence.js";
import type {
  VisualCandidate,
  VisualProviderAdapter,
  VisualRequest,
} from "../types.js";

const logger = createContextLogger("visual-gateway:generated");

/** Orientation → the aspect ratio the media-gateway understands. */
export function aspectFor(
  orientation: VisualRequest["orientation"],
): "16:9" | "9:16" | "1:1" {
  switch (orientation) {
    case "landscape":
      return "16:9";
    case "portrait":
      return "9:16";
    case "square":
      return "1:1";
    default: {
      const never: never = orientation;
      throw new Error(`visual-gateway: unhandled orientation ${String(never)}`);
    }
  }
}

/**
 * The intent's contribution to the prompt: HOW the props are arranged. Every
 * other word of the look — surface, palette, lighting, lens, negatives — comes
 * from the one canonical block in `../art-direction.ts` and is identical across
 * intents, which is the whole point: a per-intent restatement of the style is
 * how the look drifts.
 *
 * @throws Error on an unhandled intent (exhaustiveness guard).
 */
export function framingFor(intent: VisualRequest["intent"]): string {
  switch (intent) {
    case "prop-plate":
      return "Props arranged slightly off-axis, casually placed, edges overlapping.";
    case "thumbnail":
      return "Single hero object, centred, high contrast, generous empty mat around it.";
    case "abstract-subject":
      return "Abstract, non-literal composition built from simple physical objects.";
    case "broll":
      return "Wide establishing composition with depth from foreground to background.";
    case "document":
    case "logo":
    case "long-tail":
      return "";
    default: {
      const never: never = intent;
      throw new Error(`visual-gateway: unhandled intent ${String(never)}`);
    }
  }
}

/**
 * Compose the generation prompt when the caller did not supply one.
 *
 * Deliberately a PROP PLATE, not an illustration of the subject matter
 * (design §3.2). A caller-supplied `generationPrompt` still wins verbatim — the
 * planner sometimes knows exactly what a scene needs, and second-guessing it
 * here would make that field a lie.
 *
 * `req.variationIndex` varies the CAMERA AND STAGING per beat while the style
 * block stays byte-identical, which is what stops a run of connective beats
 * coming back as one picture repeated (see `ART_DIRECTION_VARIATIONS`).
 *
 * @throws Error on an unhandled intent, on a blank query/topic, or on a
 *         `variationIndex` that is not a non-negative integer.
 */
export function composeGenerationPrompt(req: VisualRequest): string {
  const supplied = req.generationPrompt?.trim();
  if (supplied && supplied.length > 0) return supplied;

  return composeArtDirectedPrompt({
    subject: req.query,
    topic: req.topic,
    framing: framingFor(req.intent),
    ...(req.variationIndex !== undefined
      ? { variation: variationFor(req.variationIndex) }
      : {}),
  });
}

/**
 * Exactly one candidate: generation is not a search, so there is nothing to
 * rank. Bytes are produced lazily inside `fetchBytes`, so a dedup hit or a
 * cheaper provider never spends a generation slot.
 */
export const generatedProvider: VisualProviderAdapter = {
  provider: "generated",

  async search(req: VisualRequest): Promise<VisualCandidate[]> {
    const prompt = composeGenerationPrompt(req);
    const aspectRatio = aspectFor(req.orientation);

    // Backend pin. Validated HERE, before any generation is attempted, so an
    // unrecognised name fails the job instead of quietly falling back to the
    // chain. Absent = no pin, which is what keeps the gateway's failover.
    const backend =
      req.imageBackend === undefined
        ? undefined
        : await toImageBackend(req.imageBackend);

    // Model pin, in the order the create form and the operator expect:
    //   job metadata (`metadata.business_hub.image_model`)
    //     → gpt-image-2 (Konrad's choice for this format, 2026-08-16)
    // This is a SELECTION between stated values, not a synthetic fallback: every
    // rung is a model somebody deliberately named, and the one that served is
    // logged below so two runs are never confusable.
    //
    // WHY THE HOST-WIDE `AI33_IMAGE_MODEL` IS NOT A RUNG HERE (changed 2026-08-16).
    // It used to sit between the two, which silently coupled this format to a
    // setting owned by every other surface. When the host-wide default moved to
    // Nano Banana 2 — the right model for tutorial images and thumbnails — this
    // format would have followed it and quietly stopped using the model Konrad
    // picked for it, with nothing failing and nothing to read. A format that has
    // named its own model does not inherit somebody else's. Operators who want
    // a different model for a BUSINESS_PLAN_HUB job pin it on the job, which is
    // what the create form already does on every submission.
    const imageModel = req.imageModel ?? DEFAULT_IMAGE_MODEL;
    // Resolution follows the SAME rung of the ladder the model came from.
    //
    // Seven of AI33's twenty models declare no resolutions and reject a task
    // that carries one, so a resolution is never invented for a model the
    // caller picked. But `DEFAULT_IMAGE_RESOLUTION` was chosen for
    // `DEFAULT_IMAGE_MODEL` specifically, so when the model came from that rung
    // the resolution must travel with it — otherwise AI33 applies the model's
    // own default, and for gpt-image-2 that default is "1K", i.e. 1280x720.
    //
    // MEASURED 2026-08-16: with the resolution dropped, every plate came back
    // 1280x720 while the intended value was 2K. Nothing failed — the frames were
    // simply half the intended resolution, which at 1080p is an upscale nobody
    // chose. The width floor (`req.minWidth`) is the backstop that turns any
    // remaining shortfall into a hard rejection rather than a soft blur.
    //
    // `AI33_IMAGE_RESOLUTION` is deliberately not read here, for the same reason
    // `AI33_IMAGE_MODEL` is not: it is the host-wide value, paired with the
    // host-wide model, and this format no longer uses either.
    const imageResolution =
      req.imageResolution ??
      (req.imageModel === undefined ? DEFAULT_IMAGE_RESOLUTION : undefined);

    const candidate: VisualCandidate = {
      mediaKind: "image",
      fileExtension: "png",
      // The backends do not report pixel dimensions, so the gateway measures
      // the bytes rather than us asserting a size we never verified.
      dimensionsDeclared: false,
      provenance: {
        provider: "generated",
        // Provisional — replaced with the real media ref inside fetchBytes.
        sourceUrl: `mediagateway:pending:${aspectRatio}`,
        licence: GENERATED_LICENCE,
        retrievedAt: new Date().toISOString(),
        width: 0,
        height: 0,
        title: `generated plate: ${req.query}`,
      },
      fetchBytes: async (): Promise<Buffer> => {
        // The style plate. Loaded here rather than in search() so a dedup hit
        // never pays for the read, and so its absence is reported once per real
        // generation instead of once per candidate that is never materialised.
        const referenceImages = await loadStyleReference();
        const generated = await generateImage(prompt, {
          format: "BUSINESS_PLAN_HUB",
          aspectRatio,
          // Text alone does not hold a look steady across a catalogue; the
          // reference plate is what does. `[]` is passed through as "no
          // reference", which the gateway treats as refCount 0.
          referenceImages,
          context: `business-hub:${req.intent}:${req.topic}`,
          ...(backend !== undefined ? { backend } : {}),
          imageModel,
          ...(imageResolution !== undefined ? { imageResolution } : {}),
        });
        if (typeof generated.ref !== "string" || generated.ref.length === 0) {
          throw new Error(
            "visual-gateway: media-gateway returned no ref for a generated " +
              "image — refusing to record an asset with no origin",
          );
        }
        logger.info(
          {
            intent: req.intent,
            served_by: generated.servedBy,
            fallback_used: generated.fallbackUsed,
            // Whether this frame was anchored to the canonical style plate.
            // Without this line "why do these two videos look different" is
            // unanswerable after the fact.
            style_reference: referenceImages.length > 0,
            // Which model was ASKED for, and whether the backend that actually
            // served can honour a model pin at all (only ai33 can). Comparing
            // models is the reason this is selectable, so a run whose model was
            // ignored must be identifiable from the log alone.
            image_model_requested: imageModel,
            image_resolution_requested: imageResolution ?? null,
            image_backend_pinned: backend ?? null,
            image_model_honoured: generated.servedBy === "ai33",
          },
          "generated visual",
        );
        candidate.provenance.sourceUrl = `mediagateway:${generated.ref}`;
        candidate.provenance.retrievedAt = new Date().toISOString();
        candidate.provenance.title = `generated plate (${generated.servedBy}): ${req.query}`;
        return downloadGeneratedBytes(generated.ref);
      },
    };

    return [candidate];
  },
};
