/**
 * BUSINESS_PLAN_HUB — the ONE canonical art direction for generated visuals.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every generated frame in this format used to describe its own look in prose,
 * inline, at the call site. Text-only style descriptions drift: the same words
 * produce a visibly different image every generation, so a catalogue of videos
 * ends up looking like a catalogue of different channels. CASUALLY_EXPLAINED
 * has the correct mechanism for this — a `style_guide` REFERENCE IMAGE — and its
 * own asset builder skips it, which is the documented root cause of CE's style
 * drift (`docs/.../project-ce-style-root-cause`). This format does not repeat
 * that: the style words live here once, and they are anchored by a reference
 * plate that is itself generated from these same words.
 *
 * TWO HALVES, BOTH REQUIRED
 * -------------------------
 *  1. `composeArtDirectedPrompt()` — the text. One constant, composed into every
 *     intent. Grep for `ART_DIRECTION_STYLE` to find everything it governs.
 *  2. `loadStyleReference()` — the picture. Resolved from
 *     `<LOCAL_MEDIA_ROOT>/style-assets/business-hub/style-guide.png`, handed to
 *     the media gateway as `options.referenceImages`, which forwards it to the
 *     image backend (veo_fleet → VUP nano-banana takes up to 10, each ≤ 1 MB).
 *
 * A MISSING REFERENCE IS LOUD, NOT FATAL. `media/` is gitignored and the style
 * plate is a generated artefact, so a fresh checkout legitimately has no file
 * there. Blocking a render on it would make the format undeployable; hiding its
 * absence would make style drift invisible again. So: warn at `warn` level,
 * name the exact path, and continue text-only.
 *
 * PALETTE PROVENANCE: the six ocean stops below are transcribed by hand from
 * `apps/worker-render/src/remotion/business-hub/theme/tokens.ts` (`PALETTE`),
 * which is itself transcribed from the product's own design system. They are
 * restated rather than imported because worker-orchestrator and worker-render
 * are separate apps with no shared theme package. If you change one, change
 * both — a generated plate in a palette the renderer never uses is worse than
 * no plate at all.
 */
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { createContextLogger } from "@repo/logger";

const logger = createContextLogger("visual-gateway:art-direction");

/* ------------------------------------------------------------------------- *
 * Palette
 * ------------------------------------------------------------------------- */

/**
 * The only colours a generated BUSINESS_PLAN_HUB frame may contain.
 *
 * A single-hue ocean ramp. There is deliberately NO yellow and NO gold: the web
 * product carries `--gold #c9a24b` for review stars, and it is absent here on
 * purpose — see the same rule in the renderer's `tokens.ts`.
 */
export const BUSINESS_HUB_PALETTE = {
  /** Darkest ocean stop. */
  ink: "#001d39",
  /** Primary brand. */
  navy: "#0a4174",
  /** Accent and emphasis. */
  steel: "#49769f",
  /** Muted mid-tone. */
  slate: "#4e8ea2",
  /** Faint accents on dark grounds. */
  silver: "#7bbde8",
  /** Hairlines and highlights. */
  mist: "#bdd8e9",
  /** The mat: near-black, not pure black (pure black crushes on YouTube). */
  groundDark: "#0b0f14",
} as const;

/* ------------------------------------------------------------------------- *
 * The canonical style block
 * ------------------------------------------------------------------------- */

/** Surface / staging. */
export const ART_DIRECTION_SURFACE =
  `Photographic still life staged on a dark near-black matte surface ` +
  `(${BUSINESS_HUB_PALETTE.groundDark}), seen from a low three-quarter angle.`;

/** Palette, stated as explicit hex stops so the model cannot wander off-hue. */
export const ART_DIRECTION_PALETTE =
  `Strictly a single-hue cool ocean palette: ink ${BUSINESS_HUB_PALETTE.ink}, ` +
  `navy ${BUSINESS_HUB_PALETTE.navy}, steel ${BUSINESS_HUB_PALETTE.steel}, ` +
  `slate ${BUSINESS_HUB_PALETTE.slate}, silver ${BUSINESS_HUB_PALETTE.silver}, ` +
  `mist ${BUSINESS_HUB_PALETTE.mist}. Absolutely no yellow, no gold, no amber, ` +
  `no orange, no warm cast anywhere in the frame.`;

/** Lighting. */
export const ART_DIRECTION_LIGHT =
  `One soft directional key light from the upper left with a single dim bounce ` +
  `fill; long soft shadows falling to the lower right; deep unlit falloff at ` +
  `the frame edges.`;

/** Lens / capture character. */
export const ART_DIRECTION_LENS =
  `Shot on a 50mm prime at f/2.0: shallow depth of field, the nearest object ` +
  `crisp and the far edge softly out of focus. Fine natural film grain, ` +
  `neutral contrast, no HDR look, no glossy render sheen.`;

/**
 * Hard negatives. Appended LAST to every prompt, without exception.
 *
 * Typography and data belong to the renderer — it draws every caption, figure,
 * axis and chart itself (`apps/worker-render/src/remotion/business-hub/`).
 * A model-generated word or number is therefore always wrong twice: it is
 * unreadable garbage, and it duplicates a layer the compositor owns. Generated
 * lettering is also the single fastest tell that a frame is synthetic.
 */
export const ART_DIRECTION_NEGATIVES =
  `Hard negatives — none of the following may appear: text, lettering, words, ` +
  `numbers, typography, captions, labels, logos, brand marks, watermarks, ` +
  `signage, people, faces, hands, charts, graphs, diagrams, infographics, ` +
  `user interfaces. Typography and data are drawn later by the renderer.`;

/**
 * The complete style block minus the negatives, as one string. Exported so a
 * test can assert its presence and so a reviewer can read the whole look in one
 * place without reassembling it.
 */
export const ART_DIRECTION_STYLE = [
  ART_DIRECTION_SURFACE,
  ART_DIRECTION_PALETTE,
  ART_DIRECTION_LIGHT,
  ART_DIRECTION_LENS,
].join(" ");

/* ------------------------------------------------------------------------- *
 * Per-beat composition variation
 * ------------------------------------------------------------------------- */

/**
 * Camera and staging alternatives, rotated one per generated beat.
 *
 * WHY THIS EXISTS. The v2 render put ten connective beats through this format
 * and Konrad's note on it was "the same plate repeats about ten times in a row".
 * Every beat asked for a photographic still life on the same mat, in the same
 * palette, under the same key light, at the same angle, against the same
 * reference plate — so even with ten different subjects and ten different sets
 * of bytes, ten near-identical frames came back. Distinct BYTES are not distinct
 * PICTURES.
 *
 * These clauses vary only CAMERA and STAGING. Nothing here touches surface,
 * palette, light quality or lens character: those stay in
 * {@link ART_DIRECTION_STYLE}, which is the whole reason the catalogue holds a
 * consistent look. A variation that restated the style would be exactly the
 * drift this file was written to stop.
 *
 * The rotation is by INDEX, not random: two runs of the same plan must produce
 * the same prompts, or a re-render is a different video.
 */
export const ART_DIRECTION_VARIATIONS: readonly string[] = [
  "Camera low and close to the surface, the nearest prop large in the foreground and the rest falling away.",
  "Camera high, looking almost straight down, the props spread flat across the mat with wide empty gaps between them.",
  "Camera at desk height from the side, props reading as a shallow row front to back, deep negative space above them.",
  "Camera at three-quarters from the upper right, props gathered tightly into the lower left third of the frame.",
  "Camera far back, the props small and grouped near the centre, most of the frame empty mat.",
  "Camera very close, a single prop filling most of the frame with the others cropped by the frame edge.",
] as const;

/**
 * The staging clause for the n-th generated beat of a video.
 *
 * @throws Error when `index` is not a non-negative integer. A fractional or
 *         negative index would silently modulo into an arbitrary variation, and
 *         the point of this function is that the beat you asked for is the
 *         staging you get.
 */
export function variationFor(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(
      `visual-gateway/art-direction: variation index must be a non-negative ` +
        `integer, received ${String(index)}`,
    );
  }
  return ART_DIRECTION_VARIATIONS[index % ART_DIRECTION_VARIATIONS.length]!;
}

/** Inputs to the one prompt composer every generated visual goes through. */
export interface ArtDirectedPromptInput {
  /** What is physically in the frame. Non-empty. */
  subject: string;
  /** The wider video's topic, for context only — never illustrated literally. */
  topic: string;
  /**
   * Intent-specific composition clause (how the props are arranged / framed).
   * Empty string when the intent adds nothing beyond the canonical block.
   */
  framing: string;
  /**
   * Per-beat camera/staging clause from {@link variationFor}. Absent means "no
   * variation" — correct for a one-off plate (the style guide, a thumbnail),
   * wrong for a run of beats inside one video.
   */
  variation?: string;
}

/**
 * Compose a generation prompt from the ONE canonical art direction.
 *
 * Order is deliberate: subject first (models weight the head of the prompt),
 * then the invariant style block, then the intent's framing, then the negatives
 * last — negatives placed at the tail are the most reliably obeyed.
 *
 * @throws Error when `subject` or `topic` is blank. A prompt built around an
 *         empty subject still generates *something*, which is precisely the
 *         silent-garbage failure this format is not allowed to have.
 */
export function composeArtDirectedPrompt(
  input: ArtDirectedPromptInput,
): string {
  const subject = input.subject.trim();
  const topic = input.topic.trim();
  if (subject.length === 0) {
    throw new Error(
      "visual-gateway/art-direction: subject is empty — refusing to compose a " +
        "prompt with nothing in the frame",
    );
  }
  if (topic.length === 0) {
    throw new Error(
      "visual-gateway/art-direction: topic is empty — refusing to compose a " +
        "prompt with no context",
    );
  }
  const framing = input.framing.trim();
  const variation = input.variation?.trim() ?? "";
  return [
    `${subject}.`,
    ART_DIRECTION_STYLE,
    `Subject of the wider video, for context only — do not illustrate it ` +
      `literally: ${topic}.`,
    framing,
    variation,
    ART_DIRECTION_NEGATIVES,
  ]
    .filter((part) => part.length > 0)
    .join(" ");
}

/* ------------------------------------------------------------------------- *
 * The style reference plate
 * ------------------------------------------------------------------------- */

/** Env var that overrides where the canonical style plate is read from. */
export const STYLE_GUIDE_PATH_ENV = "BUSINESS_HUB_STYLE_GUIDE_PATH";

/**
 * Absolute path of the canonical style plate.
 *
 * Reads `LOCAL_MEDIA_ROOT` directly rather than importing `@repo/config`, whose
 * module-level validation asserts the media root exists — correct for a worker
 * process, wrong for a utility that must also load inside a unit test. Same
 * reasoning, same fallback as `store.ts::visualLibraryRoot()`.
 */
export function styleGuidePath(): string {
  const override = process.env[STYLE_GUIDE_PATH_ENV]?.trim();
  if (override && override.length > 0) return override;
  const mediaRoot =
    process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";
  return join(mediaRoot, "style-assets", "business-hub", "style-guide.png");
}

/**
 * Per-reference byte ceiling. VUP (the nano-banana app behind veo_fleet)
 * rejects references above 1 MB — see the MAX_IMAGE_REFERENCES commentary in
 * `media-gateway/index.ts`. A larger plate does not degrade the image, it fails
 * the whole generation, so it is dropped here with a loud message instead.
 */
export const STYLE_GUIDE_MAX_BYTES = 1_000_000;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * Load the canonical style plate as a `data:` URI, ready for
 * `ImageRequestOptions.referenceImages`.
 *
 * Returns `[]` — never throws — when the plate is absent, unreadable or too
 * large, after logging exactly which of those it was and the exact path. The
 * caller then generates text-only. This is the one place in this format where
 * degradation is allowed, and it is allowed because the alternative is that a
 * gitignored artefact can block every render.
 */
export async function loadStyleReference(): Promise<string[]> {
  const path = styleGuidePath();

  let bytes: Buffer;
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      logger.warn(
        { style_guide_path: path },
        "BUSINESS_PLAN_HUB style guide path is not a file — generating " +
          "WITHOUT a style reference; expect visual drift between videos",
      );
      return [];
    }
    if (info.size > STYLE_GUIDE_MAX_BYTES) {
      logger.warn(
        {
          style_guide_path: path,
          bytes: info.size,
          max_bytes: STYLE_GUIDE_MAX_BYTES,
        },
        "BUSINESS_PLAN_HUB style guide exceeds the 1 MB per-reference limit " +
          "the image backend accepts — generating WITHOUT a style reference. " +
          "Re-encode the plate smaller.",
      );
      return [];
    }
    bytes = await readFile(path);
  } catch (err) {
    logger.warn(
      { style_guide_path: path, err: (err as Error).message },
      "BUSINESS_PLAN_HUB style guide is MISSING — generating WITHOUT a style " +
        "reference. Every video will drift in look until this plate exists.",
    );
    return [];
  }

  const mime = MIME_BY_EXTENSION[extname(path).toLowerCase()];
  if (mime === undefined) {
    logger.warn(
      { style_guide_path: path },
      "BUSINESS_PLAN_HUB style guide has an unsupported extension — " +
        "generating WITHOUT a style reference. Use .png, .jpg or .webp.",
    );
    return [];
  }

  return [`data:${mime};base64,${bytes.toString("base64")}`];
}

/**
 * The prompt that produces the style plate itself.
 *
 * Composed from the same constant as every other prompt, on purpose: the
 * reference image and the prompts it anchors can then never disagree about the
 * look. Props are the format's own subject matter (design §3.2) — documents, a
 * calculator, a pen, a coffee cup on the mat.
 */
export const STYLE_GUIDE_PROMPT = composeArtDirectedPrompt({
  subject:
    "A neat stack of printed loan documents, a slim desk calculator, a matte " +
    "black fountain pen laid across the top sheet, and a plain dark ceramic " +
    "coffee cup on a saucer",
  topic: "writing and financing a small business plan",
  framing:
    "Props arranged slightly off-axis and casually placed, edges overlapping, " +
    "nothing parallel to the frame edge, generous empty mat in the upper third.",
});
