import { z } from "zod";

/**
 * BUSINESS_PLAN_HUB — image backend + image model selection.
 *
 * Two-level control (owner's ask, 2026-08-16):
 *
 *   backend = ai33          → the full AI33 catalogue is selectable
 *   backend = anything else → restricted to Nano Banana Pro / Nano Banana 2
 *
 * The second level DEPENDS on the first, so both live here rather than in the
 * form: the create form, the API route that serves the live list, and the
 * worker that has to honour the choice all read the same table.
 *
 * ── What is actually enforced ────────────────────────────────────────────────
 * Only the `ai33` backend takes a per-request model id (`model_id` on
 * `POST /v1i/task/generate-image`). The self-hosted backends do NOT:
 *
 *   veo_fleet  posts a fixed `model` (`VEO_FLEET_IMAGE_MODEL`, default "2")
 *   vup        posts a fixed `mode: "nano-banana"` at 1K
 *   forge      posts no model at all
 *
 * So for those three the model entry is a STATEMENT OF WHICH BUILD THEY SERVE,
 * not a value that is passed through. `backendHonoursImageModel()` is the
 * single place that says so, and the media gateway warns rather than silently
 * pretending a request was honoured. Nothing here ever substitutes a model.
 *
 * ── Provenance of the catalogue ──────────────────────────────────────────────
 * `AI33_IMAGE_MODEL_CATALOGUE` was captured from a live
 * `GET https://api.ai33.pro/v1i/models` on 2026-08-16 — 20 models, with the
 * aspect ratios and resolutions each one declares. It is a FALLBACK: the API
 * route fetches the live list first and only falls back to this when AI33 is
 * unreachable, and it reports which of the two it served. A stale checked-in
 * list is a UI that renders; it is never presented as the live truth.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Backends
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The image backends a BUSINESS_PLAN_HUB job may pin.
 *
 * `auto` is not a backend — it means "do not pin one", i.e. let the media
 * gateway run its health-gated chain. It is the only value that preserves
 * failover, so it stays selectable even while AI33 is the only live generator.
 *
 * The non-`auto` values are exactly the `MediaBackend` ids the gateway accepts
 * for images. `fastgen` and `veoforge` are deliberately absent: fastgen is
 * retired (licence expired 2026-07-21) and veoforge's pool is dead, so offering
 * either would be offering a control that cannot work.
 */
export const BUSINESS_HUB_IMAGE_BACKENDS = [
  "auto",
  "ai33",
  "veo_fleet",
  "vup",
  "forge",
] as const;

export const BusinessHubImageBackendSchema = z.enum(
  BUSINESS_HUB_IMAGE_BACKENDS,
);

export type BusinessHubImageBackend = z.infer<
  typeof BusinessHubImageBackendSchema
>;

/** Human label for each backend, for the first-level dropdown. */
export const BUSINESS_HUB_IMAGE_BACKEND_LABELS: Record<
  BusinessHubImageBackend,
  { label: string; hint: string }
> = {
  auto: {
    label: "Auto — gateway chain",
    hint: "Health-gated failover. The model is whatever the serving backend runs.",
  },
  ai33: {
    label: "AI33",
    hint: "The full catalogue is selectable — this is the one that compares models.",
  },
  veo_fleet: {
    label: "VEO Fleet",
    hint: "Serves its configured Nano Banana build (VEO_FLEET_IMAGE_MODEL).",
  },
  vup: {
    label: "VUP",
    hint: 'Serves mode "nano-banana" at 1K. No per-job model.',
  },
  forge: {
    label: "forge-api",
    hint: "VEO Studio wrapper. No per-job model.",
  },
};

/**
 * Does this backend actually pass a per-request model id upstream?
 *
 * `true` for `ai33` only. Everything else serves a fixed build, so a model
 * chosen against it is descriptive, not enforced — see the header note.
 */
export function backendHonoursImageModel(
  backend: BusinessHubImageBackend,
): boolean {
  return backend === "ai33";
}

// ─────────────────────────────────────────────────────────────────────────────
// Model catalogue
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One selectable image model.
 *
 * `aspectRatios` / `resolutions` are `null` when the upstream catalogue does
 * not declare them — NOT an empty list, and never a guessed default. A `null`
 * means "unknown, do not filter on it"; an empty list would mean "supports
 * none", which is a different and wrong claim.
 */
export interface ImageModelSpec {
  id: string;
  label: string;
  aspectRatios: readonly string[] | null;
  resolutions: readonly string[] | null;
}

/**
 * The 20 AI33 image models, as `GET /v1i/models` returned them on 2026-08-16.
 *
 * Labels are ours; ids are verbatim. Two of them (`gpt-image-1.5`,
 * `gpt-image-1`) do NOT offer 16:9, which is the only ratio this format
 * renders — `modelSupportsAspect()` is what keeps them from being picked, not a
 * silent substitution at generation time.
 */
export const AI33_IMAGE_MODEL_CATALOGUE: readonly ImageModelSpec[] = [
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    aspectRatios: [
      "auto",
      "3:1",
      "21:9",
      "2:1",
      "16:9",
      "3:2",
      "4:3",
      "5:4",
      "1:1",
      "4:5",
      "3:4",
      "2:3",
      "9:16",
      "1:2",
      "1:3",
    ],
    resolutions: ["1K", "2K", "4K"],
  },
  {
    id: "gpt-image-1.5",
    label: "GPT Image 1.5",
    aspectRatios: ["1:1", "3:2", "2:3"],
    resolutions: null,
  },
  {
    id: "gpt-image-1",
    label: "GPT Image 1",
    aspectRatios: ["3:2", "1:1", "2:3"],
    resolutions: null,
  },
  {
    id: "gemini-3-pro-image-preview",
    label: "Nano Banana Pro (Gemini 3 Pro Image)",
    aspectRatios: [
      "21:9",
      "16:9",
      "5:4",
      "4:3",
      "3:2",
      "1:1",
      "2:3",
      "3:4",
      "4:5",
      "9:16",
    ],
    resolutions: ["1K", "2K", "4K"],
  },
  {
    id: "gemini-3.1-flash-image-preview",
    label: "Nano Banana 2 (Gemini 3.1 Flash Image)",
    aspectRatios: [
      "8:1",
      "4:1",
      "21:9",
      "16:9",
      "5:4",
      "4:3",
      "3:2",
      "1:1",
      "2:3",
      "3:4",
      "4:5",
      "9:16",
      "1:4",
      "1:8",
    ],
    resolutions: ["512", "1K", "2K", "4K"],
  },
  {
    id: "gemini-3.1-flash-lite-image",
    label: "Gemini 3.1 Flash Lite Image",
    aspectRatios: [
      "21:9",
      "16:9",
      "5:4",
      "4:3",
      "3:2",
      "1:1",
      "2:3",
      "3:4",
      "4:5",
      "9:16",
    ],
    resolutions: ["1K"],
  },
  {
    id: "gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image",
    aspectRatios: [
      "21:9",
      "16:9",
      "5:4",
      "4:3",
      "3:2",
      "1:1",
      "2:3",
      "3:4",
      "4:5",
      "9:16",
    ],
    resolutions: null,
  },
  {
    id: "bytedance-seedream-5-pro",
    label: "Seedream 5 Pro",
    aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16"],
    resolutions: ["1K", "2K"],
  },
  {
    id: "bytedance-seedream-5-lite",
    label: "Seedream 5 Lite",
    aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16"],
    resolutions: ["2K", "3K"],
  },
  {
    id: "bytedance-seedream-4.5",
    label: "Seedream 4.5",
    aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16"],
    resolutions: ["2K", "4K"],
  },
  {
    id: "bytedance-seedream-4",
    label: "Seedream 4",
    aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16"],
    resolutions: ["1080p", "2K", "4K"],
  },
  {
    id: "recraft-v4.1",
    label: "Recraft v4.1",
    aspectRatios: [
      "2:1",
      "16:9",
      "3:2",
      "14:10",
      "4:3",
      "5:4",
      "1:1",
      "4:5",
      "3:4",
      "10:14",
      "2:3",
      "6:10",
      "9:16",
      "1:2",
    ],
    resolutions: ["1K", "2K"],
  },
  {
    id: "krea-2-large",
    label: "Krea 2 Large",
    aspectRatios: ["2.35:1", "16:9", "3:2", "4:3", "1:1", "4:5", "2:3", "9:16"],
    resolutions: null,
  },
  {
    id: "krea-2-medium",
    label: "Krea 2 Medium",
    aspectRatios: ["2.35:1", "16:9", "3:2", "4:3", "1:1", "4:5", "2:3", "9:16"],
    resolutions: null,
  },
  {
    id: "flux-2-pro",
    label: "FLUX 2 Pro",
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    resolutions: ["720p", "1080p", "2K"],
  },
  {
    id: "flux-1-kontext",
    label: "FLUX 1 Kontext",
    aspectRatios: [
      "21:9",
      "16:9",
      "4:3",
      "3:2",
      "1:1",
      "2:3",
      "3:4",
      "9:16",
      "9:21",
    ],
    resolutions: null,
  },
  {
    id: "kling-omni-image",
    label: "Kling Omni Image",
    aspectRatios: [
      "auto",
      "16:9",
      "9:16",
      "1:1",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "21:9",
    ],
    resolutions: ["1K", "2K"],
  },
  {
    id: "runway-gen4-image",
    label: "Runway Gen-4 Image",
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    resolutions: ["720p", "1080p"],
  },
  {
    id: "runway-gen4-image-turbo",
    label: "Runway Gen-4 Image Turbo",
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    resolutions: ["720p", "1080p"],
  },
  {
    id: "wan-2.5-preview-image",
    label: "Wan 2.5 Preview Image",
    aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16"],
    resolutions: null,
  },
];

/** AI33 model id → catalogue entry, for the fallback lookups. */
const AI33_BY_ID = new Map(AI33_IMAGE_MODEL_CATALOGUE.map((m) => [m.id, m]));

/**
 * Konrad's choice for this format (2026-08-16). Also the fallback the worker
 * lands on when neither the job metadata nor `AI33_IMAGE_MODEL` names one.
 */
export const DEFAULT_BUSINESS_HUB_IMAGE_MODEL = "gpt-image-2";

/** Nano Banana 2 — the build the self-hosted backends already serve. */
export const NANO_BANANA_2_MODEL_ID = "gemini-3.1-flash-image-preview";
/** Nano Banana Pro. */
export const NANO_BANANA_PRO_MODEL_ID = "gemini-3-pro-image-preview";

/**
 * The restricted pair offered for every non-AI33 backend — "when selecting my
 * other apis we are restricted to only nanobanana pro / nanobanana 2".
 */
export const NANO_BANANA_MODELS: readonly ImageModelSpec[] = [
  AI33_BY_ID.get(NANO_BANANA_PRO_MODEL_ID)!,
  AI33_BY_ID.get(NANO_BANANA_2_MODEL_ID)!,
];

/**
 * The models offered for a backend, from the checked-in catalogue.
 *
 * `auto` gets the restricted pair too: under the chain the serving backend is
 * not known in advance, and the three self-hosted ones can only ever produce a
 * Nano Banana frame — offering the full AI33 list there would promise a model
 * the run may not use.
 */
export function fallbackModelsForBackend(
  backend: BusinessHubImageBackend,
): readonly ImageModelSpec[] {
  return backend === "ai33" ? AI33_IMAGE_MODEL_CATALOGUE : NANO_BANANA_MODELS;
}

/** The pre-selected model for a backend. */
export function defaultModelForBackend(
  backend: BusinessHubImageBackend,
): string {
  return backend === "ai33"
    ? DEFAULT_BUSINESS_HUB_IMAGE_MODEL
    : NANO_BANANA_2_MODEL_ID;
}

/**
 * Can this model render `aspect`?
 *
 * `true` when the model declares no ratios at all — unknown is not the same as
 * unsupported, and refusing a model the catalogue simply did not describe would
 * remove a working option.
 */
export function modelSupportsAspect(
  model: ImageModelSpec,
  aspect: string,
): boolean {
  if (model.aspectRatios === null) return true;
  return model.aspectRatios.includes(aspect);
}

/**
 * Which `resolution` to send with a model.
 *
 * `preferred` wins when the model lists it; otherwise the largest ratio the
 * model does list, in catalogue order (AI33 lists ascending). `undefined` means
 * the model declares no resolutions — the caller must then OMIT the parameter
 * rather than send a plausible-looking one, which is how a request gets
 * rejected for a value nobody chose.
 */
export function resolutionForModel(
  model: ImageModelSpec,
  preferred = "2K",
): string | undefined {
  if (model.resolutions === null || model.resolutions.length === 0) {
    return undefined;
  }
  if (model.resolutions.includes(preferred)) return preferred;
  return model.resolutions[model.resolutions.length - 1];
}

/** Catalogue lookup by id. `undefined` when the id is not one we know. */
export function findAI33ImageModel(id: string): ImageModelSpec | undefined {
  return AI33_BY_ID.get(id);
}
