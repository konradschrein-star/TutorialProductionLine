/**
 * Asset Resolution — Pure Business Logic
 *
 * Defines the canonical reference injection order for AI33 image generation
 * and the tier-based asset resolution algorithm.
 *
 * ZERO IO — pure functions only. No database calls here.
 * Callers receive a spec and execute the DB query themselves.
 */

// ---------------------------------------------------------------------------
// Reference Injection Order
// ---------------------------------------------------------------------------

/**
 * Canonical order in which reference images are attached to AI33 generation
 * requests. @img1 carries the most weight; order must be enforced by all
 * callers — never left to ad-hoc decisions in processors.
 *
 * Slots:
 *   @img1 style_guide      — archetype visual DNA (ALWAYS first, ALWAYS present)
 *   @img2 character        — primary character master sheet
 *   @img3 character_state  — specific state for this scene (e.g. crying)
 *   @img4 sequence_seed    — previous frame for v1→v2 continuity
 *   @img5 background       — environment/background reference
 *   @img6 layout_reference — composite layout (PowerPoint-style multi-image)
 */
export const REFERENCE_INJECTION_ORDER = [
  "style_guide", // @img1 — highest weight, required
  "character", // @img2 — primary character master sheet
  "character_state", // @img3 — specific state for this scene
  "sequence_seed", // @img4 — previous frame (v1→v2 continuity)
  "background", // @img5 — environment/background reference
  "layout_reference", // @img6 — composite layout (PowerPoint-style multi-image)
] as const satisfies readonly string[];

export type ReferenceSlot = (typeof REFERENCE_INJECTION_ORDER)[number];

// ---------------------------------------------------------------------------
// Asset Resolution Spec
// ---------------------------------------------------------------------------

/**
 * Resolution context — the three primary association vectors.
 * Any combination is valid; more populated = higher specificity.
 */
export interface AssetResolutionContext {
  channel_id?: string;
  archetype_id?: string;
  format?: string;
}

/**
 * Query parameters for asset resolution.
 */
export interface AssetResolutionQuery {
  asset_types: string[];
  tags?: string[];
  require_approved?: boolean;
}

/**
 * A single resolution tier — the WHERE clause components for a DB query
 * at one specificity level.
 */
export interface ResolutionTier {
  /** Human-readable label for logging */
  label: string;
  /** Priority — lower number wins */
  priority: number;
  channel_id: string | null;
  archetype_id: string | null;
  format: string | null;
}

export interface AssetResolutionSpec {
  tiers: ResolutionTier[];
  asset_types: string[];
  tags?: string[];
  require_approved: boolean;
}

// ---------------------------------------------------------------------------
// Resolution Tiers
// ---------------------------------------------------------------------------

/**
 * Build the ordered list of resolution tiers from a production context.
 *
 * Tiers are ordered from most specific (priority 1) to least specific
 * (priority 6 = universal). The caller queries each tier in order and
 * uses the first non-empty result at the highest-priority tier.
 *
 * Within a tier: approved > draft; higher quality_rating wins;
 * most recently updated breaks ties.
 */
function buildResolutionTiers(ctx: AssetResolutionContext): ResolutionTier[] {
  const { channel_id, archetype_id, format } = ctx;

  const tiers: ResolutionTier[] = [];
  let priority = 1;

  // Tier 1: channel + archetype + format (most specific)
  if (channel_id && archetype_id && format) {
    tiers.push({
      label: "channel+archetype+format",
      priority: priority++,
      channel_id,
      archetype_id,
      format,
    });
  }

  // Tier 2: channel + archetype
  if (channel_id && archetype_id) {
    tiers.push({
      label: "channel+archetype",
      priority: priority++,
      channel_id,
      archetype_id,
      format: null,
    });
  }

  // Tier 3: archetype + format
  if (archetype_id && format) {
    tiers.push({
      label: "archetype+format",
      priority: priority++,
      channel_id: null,
      archetype_id,
      format,
    });
  }

  // Tier 4: channel only
  if (channel_id) {
    tiers.push({
      label: "channel",
      priority: priority++,
      channel_id,
      archetype_id: null,
      format: null,
    });
  }

  // Tier 5: archetype only
  if (archetype_id) {
    tiers.push({
      label: "archetype",
      priority: priority++,
      channel_id: null,
      archetype_id,
      format: null,
    });
  }

  // Tier 6: universal (no associations) — always present as the fallback
  tiers.push({
    label: "universal",
    priority: priority++,
    channel_id: null,
    archetype_id: null,
    format: null,
  });

  return tiers;
}

/**
 * Produce a resolution spec from context + query.
 *
 * The spec contains everything a repository needs to execute the tiered
 * lookup without any domain logic leaking into the persistence layer.
 */
export function resolveAssets(
  context: AssetResolutionContext,
  query: AssetResolutionQuery,
): AssetResolutionSpec {
  return {
    tiers: buildResolutionTiers(context),
    asset_types: query.asset_types,
    tags: query.tags,
    require_approved: query.require_approved ?? false,
  };
}

// ---------------------------------------------------------------------------
// Reference Image Prompt Injection
// ---------------------------------------------------------------------------

export interface ReferenceInjectionInput {
  basePrompt: string;
  /** Keyed by ReferenceSlot — provide only the slots you have buffers for */
  slots: Partial<Record<ReferenceSlot, Uint8Array>>;
}

export interface ReferenceInjectionResult {
  /** Modified prompt with @img1, @img2 etc. prepended */
  prompt: string;
  /** Ordered reference image buffers matching the @imgN references in prompt */
  referenceImages: Uint8Array[];
}

/**
 * Build explicit style copying instructions based on which reference slots are populated.
 *
 * CRITICAL: The AI needs explicit instructions to copy the art style from reference images.
 * Without this, reference images are ignored or misinterpreted (e.g., AI copies grid layouts
 * instead of just the style).
 *
 * @img1 is ALWAYS the style_guide when present - primary visual DNA source
 */
function buildStyleCopyingInstruction(
  slots: Partial<Record<ReferenceSlot, Uint8Array>>,
): string {
  const hasStyleGuide = !!slots.style_guide;
  const hasCharacter = !!slots.character || !!slots.character_state;
  const hasLayout = !!slots.layout_reference;

  if (!hasStyleGuide && !hasCharacter && !hasLayout) {
    return "";
  }

  const parts: string[] = [];

  // Primary instruction: copy the art style from @img1 (style guide)
  if (hasStyleGuide) {
    parts.push(
      "CRITICAL STYLE REFERENCE: @img1 contains 2-4 example images arranged in a grid layout (e.g., 2x2 grid). " +
        "Your task: EXTRACT the style/aesthetic from these examples, NOT the grid structure itself. " +
        "STUDY THE EXAMPLES to identify: " +
        "(1) Line work style - thickness, smoothness, hand-drawn vs digital. " +
        "(2) Color palette - exact colors, saturation levels, harmony approach. " +
        "(3) Shading technique - flat color, gradient, textured, or cel-shaded. " +
        "(4) Character proportions - head-to-body ratio, limb proportions, facial style. " +
        "(5) Background treatment - detailed, minimalist, abstract, or photorealistic. " +
        "Then CREATE A SINGLE UNIFIED IMAGE using that extracted style applied to the current prompt. " +
        "ABSOLUTELY DO NOT: Recreate the grid layout, include multiple panels, divide the canvas, " +
        "or copy specific scene composition from @img1. " +
        "DO: Apply the discovered visual style to create a cohesive single-frame image.",
    );
  }

  // Secondary: character appearance from @img2/@img3
  if (hasCharacter) {
    const charRef = slots.character ? "@img2" : "@img3";
    parts.push(
      `CHARACTER APPEARANCE REFERENCE: ${charRef} shows the primary character's design specification. ` +
        `MATCH EXACTLY: facial features, body proportions, clothing/costume design, ` +
        `color scheme (skin tone, hair color, outfit colors), and distinctive features. ` +
        `If ${charRef} shows multiple poses in a grid, extract the CHARACTER DESIGN that is ` +
        `consistent across all poses - NOT any single pose. Apply this character design to ` +
        `the current scene while maintaining the character's visual identity.`,
    );
  }

  // Tertiary: composition/layout hints (not literal copy)
  if (hasLayout) {
    const layoutIdx =
      [
        slots.style_guide,
        slots.character,
        slots.character_state,
        slots.sequence_seed,
        slots.background,
      ].filter(Boolean).length + 1;
    // CRITICAL: Reference images often show multiple scenes/snapshots in a grid layout.
    // The AI must extract the STYLE and artistic approach, NOT replicate the grid structure.
    parts.push(
      `IMPORTANT: @img${layoutIdx} shows multiple scenes/snapshots in a grid. ` +
        `Extract ONLY the visual style, color palette, and artistic approach from @img${layoutIdx}. ` +
        `DO NOT copy the grid layout or multi-panel structure. Create a single unified scene.`,
    );
  }

  return parts.join(" ") + " ";
}

/**
 * Inject reference image placeholders into a prompt in canonical order.
 *
 * Only slots that have a corresponding Uint8Array are included; empty slots
 * are skipped (indices are re-numbered to remain contiguous).
 *
 * Example output:
 *   prompt: "@img1 @img2 @img3 Copy the exact art style from @img1. Simple flat-design illustration..."
 *   referenceImages: [styleGuideBuf, characterBuf, characterStateBuf]
 *
 * The caller passes both the modified prompt and the referenceImages array
 * to generateImageAI33() — the order must be identical.
 */
export function buildReferenceInjectedPrompt(
  input: ReferenceInjectionInput,
): ReferenceInjectionResult {
  const { basePrompt, slots } = input;

  const referenceImages: Uint8Array[] = [];
  const imgRefs: string[] = [];

  for (const slot of REFERENCE_INJECTION_ORDER) {
    const buf = slots[slot];
    if (buf) {
      referenceImages.push(buf);
      imgRefs.push(`@img${referenceImages.length}`);
    }
  }

  if (imgRefs.length === 0) {
    return { prompt: basePrompt, referenceImages: [] };
  }

  // Build style copying instruction based on which reference slots are present
  const styleInstruction = buildStyleCopyingInstruction(slots);

  // Prepend @imgN references with explicit style copying instructions
  // AI33 uses these placeholders to inject reference images via FormData
  const prompt = `${imgRefs.join(" ")} ${styleInstruction}${basePrompt}`;
  return { prompt, referenceImages };
}
