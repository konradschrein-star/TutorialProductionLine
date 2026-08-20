import type {
  LayoutType,
  TransitionType,
  BiomeEntry,
  CompositionPlanEntry,
  CompositionPlan,
} from "@repo/contracts";

/**
 * V2 Biome-Based Scene Composition
 *
 * Generates a composition plan where layouts persist for stretches of scenes
 * (biomes) with bell-curve durations and adjacency compatibility rules.
 *
 * This is NOT random per-scene selection. The algorithm:
 * 1. Determines structural zone boundaries (hook, body, outro)
 * 2. Generates a biome sequence for the body zone
 * 3. Injects content-gated layouts (quotes)
 * 4. Pins structural positions (intro = avatar fullscreen, outro = avatar fullscreen)
 * 5. Maps scenes to biomes
 *
 * ZERO IO — pure functions only.
 */

// ---------------------------------------------------------------------------
// PRNG (mulberry32 — local copy, domain can't import media-core)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SceneInput {
  scene_index: number;
  paragraph: string;
  start_frame: number;
  end_frame: number;
  duration_frames: number;
}

export interface SentenceInput {
  sentence_index: number;
  sentence_text: string;
  scene_index: number;
  start_frame: number;
  end_frame: number;
  duration_frames: number;
}

export interface CompositionParams {
  scenes: SceneInput[];
  masterSeed: number;
  totalDurationSeconds: number;
  fps: number;
  /** Avatar video aspect ratio (width/height). Defaults to 9/16 if omitted. */
  avatarAspectRatio?: number;
}

export interface SentenceCompositionParams {
  sentences: SentenceInput[];
  masterSeed: number;
  totalDurationSeconds: number;
  fps: number;
  /** Avatar video aspect ratio (width/height). Defaults to 9/16 if omitted. */
  avatarAspectRatio?: number;
}

// ---------------------------------------------------------------------------
// Constants — biome configuration
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Avatar aspect ratio category helpers
// ---------------------------------------------------------------------------

type AvatarCategory = "portrait" | "square" | "landscape";

function getAvatarCategory(ratio: number): AvatarCategory {
  if (ratio < 0.8) return "portrait"; // 9:16, etc.
  if (ratio <= 1.3) return "square"; // 1:1, 4:3, etc.
  return "landscape"; // 16:9, etc.
}

/**
 * Body zone weights per avatar category.
 *
 * Target distribution: PIP=55%, SPLIT=20%, QUOTE_CARD=10%, remainder sparse.
 * - AVATAR_FULLSCREEN is sparingly used (visually less dynamic than PIP/SPLIT).
 * - IMAGE_FULLSCREEN is very short (1-2 scenes) and used for dramatic B-roll moments.
 * - QUOTE_CARD appears periodically for text-based emphasis (key statements, data points).
 * - Portrait: AVATAR_FULLSCREEN omitted (looks broken on 16:9 canvas); AVATAR_SPLIT handles prominence.
 * - Landscape: AVATAR_SPLIT included but less dominant (wide avatar + panel is tight).
 */
function getBodyWeights(category: AvatarCategory): Record<string, number> {
  switch (category) {
    case "portrait":
      return {
        AVATAR_PIP: 55,
        AVATAR_SPLIT: 20,
        QUOTE_CARD: 10,
        IMAGE_FULLSCREEN: 15,
      };
    case "square":
      return {
        AVATAR_PIP: 55,
        AVATAR_SPLIT: 18,
        AVATAR_FULLSCREEN: 10,
        QUOTE_CARD: 10,
        IMAGE_FULLSCREEN: 7,
      };
    case "landscape":
      return {
        AVATAR_PIP: 55,
        AVATAR_SPLIT: 18,
        AVATAR_FULLSCREEN: 12,
        QUOTE_CARD: 10,
        IMAGE_FULLSCREEN: 5,
      };
  }
}

/**
 * The "prominent narrator" layout for hook/outro depends on avatar category.
 * For portrait: AVATAR_SPLIT is the closest to AVATAR_FULLSCREEN (fills height, prominent).
 * For landscape/square: AVATAR_FULLSCREEN fills the canvas properly.
 */
function getProminentLayout(category: AvatarCategory): LayoutType {
  return category === "portrait" ? "AVATAR_SPLIT" : "AVATAR_FULLSCREEN";
}

/**
 * Bell curve parameters for biome length (in scenes/paragraphs) per layout type.
 * In the sentence-level image pipeline, images change WITHIN a biome at sentence pace.
 * These sizes control layout switching frequency — shorter = more layout variety.
 *
 * NEWS BROADCAST TUNING: Reduced by ~50% for more frequent layout switches.
 * Target: layout switch every 15-30 seconds instead of 60-90 seconds.
 */
const BIOME_SIZE_CONFIG: Record<
  string,
  { mean: number; stddev: number; min: number; max: number }
> = {
  AVATAR_PIP: { mean: 2, stddev: 0.7, min: 1, max: 4 }, // was: mean 3, max 6
  AVATAR_FULLSCREEN: { mean: 2, stddev: 0.6, min: 2, max: 5 }, // was: mean 2, max 3 (body only, longer stretches OK)
  AVATAR_SPLIT: { mean: 2, stddev: 0.7, min: 1, max: 3 }, // was: mean 3, max 5
  QUOTE_CARD: { mean: 1, stddev: 0.3, min: 1, max: 1 }, // always single scene
  IMAGE_FULLSCREEN: { mean: 1, stddev: 0.3, min: 1, max: 2 }, // was: stddev 0.5
};

/**
 * Adjacency compatibility matrix.
 * forbidden[A] contains layout types that CANNOT follow A.
 * Key rule: AVATAR_PIP <-> IMAGE_FULLSCREEN are forbidden neighbors
 * (too visually similar — both fullscreen image, only difference is small PIP overlay).
 */
const FORBIDDEN_NEIGHBORS: Partial<Record<LayoutType, LayoutType[]>> = {
  AVATAR_PIP: ["IMAGE_FULLSCREEN"],
  IMAGE_FULLSCREEN: ["AVATAR_PIP"],
};

// ---------------------------------------------------------------------------
// Hook duration (seconds-based, not percentage)
// ---------------------------------------------------------------------------

/**
 * Compute hook duration in seconds based on total video length.
 * The hook covers the fast-cutting intro period (sub-sentence image switching).
 * Scene 0 (narrator fullscreen) is separate — it always covers exactly the first paragraph.
 *
 * - Under 3 min : 20–40s (scales with length)
 * - 3–10 min    : 40–75s (scales: longer video = longer hook)
 * - Over 10 min : 90s
 */
export function computeHookDurationSeconds(
  totalDurationSeconds: number,
): number {
  if (totalDurationSeconds < 180) {
    // Under 3 minutes: scale 20-40s
    const t = totalDurationSeconds / 180;
    return Math.round(20 + t * 20);
  }
  if (totalDurationSeconds < 600) {
    // 3-10 minutes: scale 40-75s
    const t = (totalDurationSeconds - 180) / (600 - 180);
    return Math.round(40 + t * 35);
  }
  return 90;
}

// ---------------------------------------------------------------------------
// Normal distribution sampling (Box-Muller)
// ---------------------------------------------------------------------------

function sampleNormal(
  rng: () => number,
  mean: number,
  stddev: number,
  min: number,
  max: number,
): number {
  // Box-Muller transform for normal distribution
  const u1 = Math.max(rng(), 1e-10); // avoid log(0)
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const raw = mean + z * stddev;
  return Math.round(Math.max(min, Math.min(max, raw)));
}

// ---------------------------------------------------------------------------
// Weighted random selection
// ---------------------------------------------------------------------------

function weightedSelect(
  rng: () => number,
  weights: Record<string, number>,
  exclude: string[],
): string {
  const entries = Object.entries(weights).filter(([k]) => !exclude.includes(k));
  const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
  if (totalWeight === 0) {
    // All excluded — fallback to first available
    return entries.length > 0 ? entries[0]![0] : Object.keys(weights)[0]!;
  }
  let roll = rng() * totalWeight;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1]![0];
}

// ---------------------------------------------------------------------------
// Quote detection
// ---------------------------------------------------------------------------

/** Simple heuristic: paragraph contains quoted text */
function containsQuote(paragraph: string): boolean {
  // Match "..." or "..." (curly quotes) or «...»
  return /[""\u00AB].{10,}[""\u00BB]/.test(paragraph);
}

// ---------------------------------------------------------------------------
// Biome generation
// ---------------------------------------------------------------------------

interface Biome {
  layoutType: LayoutType;
  sceneCount: number;
}

function generateBiomeSequence(
  rng: () => number,
  totalScenes: number,
  weights: Record<string, number>,
  initialPrevLayout?: LayoutType,
): Biome[] {
  const biomes: Biome[] = [];
  let cursor = 0;
  let prevLayout: LayoutType | undefined = initialPrevLayout;

  while (cursor < totalScenes) {
    const remaining = totalScenes - cursor;
    if (remaining <= 0) break;

    const exclude: string[] = [];

    if (prevLayout) {
      // No consecutive same-type biomes
      exclude.push(prevLayout);
      // Adjacency compatibility
      const forbidden = FORBIDDEN_NEIGHBORS[prevLayout];
      if (forbidden) {
        for (const f of forbidden) {
          if (!exclude.includes(f)) exclude.push(f);
        }
      }
    }

    const layoutType = weightedSelect(rng, weights, exclude) as LayoutType;
    const config = BIOME_SIZE_CONFIG[layoutType]!;
    const size = Math.min(
      sampleNormal(rng, config.mean, config.stddev, config.min, config.max),
      remaining,
    );

    biomes.push({ layoutType, sceneCount: size });
    prevLayout = layoutType;
    cursor += size;
  }

  return biomes;
}

// ---------------------------------------------------------------------------
// Transition selection
// ---------------------------------------------------------------------------

function selectTransition(
  _prevLayout: LayoutType | null,
  _currentLayout: LayoutType,
  _isZoneBoundary: boolean,
): TransitionType {
  // All biome boundaries use hard CUT.
  // Crossfades look like fades-from-black in Remotion without scene overlap,
  // and the layout switch itself is visually impactful enough.
  return "CUT";
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * @deprecated Use generateSentenceCompositionPlan() instead.
 *
 * This scene-based function is obsolete. The system has migrated to sentence-based
 * composition where sentences are the atomic video timing unit, not scenes/paragraphs.
 */
export function generateCompositionPlan(
  params: CompositionParams,
): CompositionPlan {
  throw new Error(
    "generateCompositionPlan() is deprecated. Use generateSentenceCompositionPlan() instead. " +
      "The composition system has migrated from scene-based to sentence-based timing.",
  );
}

// ---------------------------------------------------------------------------
// Sentence-Based Composition Plan (NEW)
// ---------------------------------------------------------------------------

/**
 * Generate composition plan with sentence-level layout assignment.
 *
 * Replaces scene/paragraph-based timing with sentence-based atomic units.
 * Layouts span multiple sentences via biome distribution algorithm.
 * Paragraphs are LLM context only (not video timing units).
 */
export function generateSentenceCompositionPlan(
  params: SentenceCompositionParams,
): CompositionPlan {
  const { sentences, masterSeed, totalDurationSeconds, fps } = params;
  const totalFrames = Math.round(totalDurationSeconds * fps);
  const rng = mulberry32(masterSeed);

  const category = getAvatarCategory(params.avatarAspectRatio ?? 9 / 16);
  const bodyWeights = getBodyWeights(category);
  const prominentLayout = getProminentLayout(category);

  // --- Step 1: Zone boundaries (time-based, then map to sentence indices) ---
  const hookDurationSec = computeHookDurationSeconds(totalDurationSeconds);
  const hookEndFrame = Math.round(hookDurationSec * fps);

  const outroMaxFrames = Math.round(40 * fps);
  const outroStartFrame = Math.max(
    totalFrames - outroMaxFrames,
    Math.floor(totalFrames * 0.9),
  );

  // Short videos: skip hook/outro segmentation, treat everything as body
  if (sentences.length < 3) {
    const bodyBiomes =
      sentences.length > 0
        ? generateBiomeSequence(
            rng,
            sentences.length,
            bodyWeights,
            prominentLayout,
          )
        : [];
    const entries: CompositionPlanEntry[] = [];
    const biomeEntries: BiomeEntry[] = [];
    let sentenceIdx = 0;
    for (const biome of bodyBiomes) {
      const startIdx = sentenceIdx;
      const endIdx = Math.min(
        sentenceIdx + biome.sceneCount - 1,
        sentences.length - 1,
      );
      biomeEntries.push({
        layoutType: biome.layoutType,
        startSentenceIndex: startIdx,
        endSentenceIndex: endIdx,
        transitionIn: "CUT",
      });
      for (let s = startIdx; s <= endIdx && s < sentences.length; s++) {
        entries.push({
          sentenceIndex: s,
          sceneIndex: sentences[s]!.scene_index,
          layoutType: biome.layoutType,
          isFirstInBiome: s === startIdx,
          transitionIn: "CUT",
          avatarSide: undefined,
          isHook: false,
        });
      }
      sentenceIdx = endIdx + 1;
    }
    return {
      entries,
      biomes: biomeEntries,
      masterSeed,
      hookEndSentenceIndex: 0,
      outroStartSentenceIndex: sentences.length,
    };
  }

  // Map sentences to zones by timing
  let hookEndSentenceIndex = 0;
  let outroStartSentenceIndex = sentences.length;

  for (const sentence of sentences) {
    if (sentence.start_frame < hookEndFrame) {
      hookEndSentenceIndex = sentence.sentence_index + 1;
    }
    if (
      sentence.start_frame >= outroStartFrame &&
      outroStartSentenceIndex === sentences.length
    ) {
      outroStartSentenceIndex = sentence.sentence_index;
    }
  }

  // Outro = last sentence (clamp)
  outroStartSentenceIndex = Math.max(
    outroStartSentenceIndex,
    sentences.length - 1,
  );

  // Ensure at least 1 hook sentence and body exists
  hookEndSentenceIndex = Math.max(
    1,
    Math.min(hookEndSentenceIndex, sentences.length - 2),
  );
  outroStartSentenceIndex = Math.max(
    hookEndSentenceIndex + 1,
    outroStartSentenceIndex,
  );

  // --- Step 2: Generate biomes for hook/body/outro zones ---
  const entries: CompositionPlanEntry[] = [];
  const hookBiomes: Biome[] = [];

  // Hook zone: first sentence = prominent layout
  hookBiomes.push({ layoutType: prominentLayout, sceneCount: 1 });

  // Remaining hook sentences: rapid switching
  let hookCursor = 1;
  let lastHookType: LayoutType = prominentLayout;
  while (hookCursor < hookEndSentenceIndex) {
    const remaining = hookEndSentenceIndex - hookCursor;
    const hookType =
      lastHookType === "AVATAR_PIP"
        ? category === "portrait"
          ? ("AVATAR_SPLIT" as LayoutType)
          : prominentLayout
        : ("AVATAR_PIP" as LayoutType);
    const size = Math.min(sampleNormal(rng, 1.5, 0.5, 1, 3), remaining);
    hookBiomes.push({ layoutType: hookType, sceneCount: size });
    lastHookType = hookType;
    hookCursor += size;
  }

  // Body zone: biome generation
  const bodySentenceCount = outroStartSentenceIndex - hookEndSentenceIndex;
  const lastHookLayout = hookBiomes[hookBiomes.length - 1]!.layoutType;
  const bodyBiomes =
    bodySentenceCount > 0
      ? generateBiomeSequence(
          rng,
          bodySentenceCount,
          bodyWeights,
          lastHookLayout,
        )
      : [];

  // Outro zone: prominent layout
  const outroSentenceCount = sentences.length - outroStartSentenceIndex;
  const outroBiomes: Biome[] =
    outroSentenceCount > 0
      ? [{ layoutType: prominentLayout, sceneCount: outroSentenceCount }]
      : [];

  // --- Step 3: Build flat sentence entries ---
  const allBiomes = [...hookBiomes, ...bodyBiomes, ...outroBiomes];
  const biomeEntries: BiomeEntry[] = [];

  let sentenceIdx = 0;
  let prevLayout: LayoutType | null = null;

  for (let b = 0; b < allBiomes.length; b++) {
    const biome = allBiomes[b]!;
    const startIdx = sentenceIdx;
    const endIdx = Math.min(
      sentenceIdx + biome.sceneCount - 1,
      sentences.length - 1,
    );

    const isZoneBoundary =
      startIdx === hookEndSentenceIndex || startIdx === outroStartSentenceIndex;

    const transition = selectTransition(
      prevLayout,
      biome.layoutType,
      isZoneBoundary,
    );

    biomeEntries.push({
      layoutType: biome.layoutType,
      startSentenceIndex: startIdx,
      endSentenceIndex: endIdx,
      transitionIn: transition,
    });

    // Generate per-sentence entries for this biome
    for (let s = startIdx; s <= endIdx && s < sentences.length; s++) {
      const sentence = sentences[s];
      const avatarSide =
        biome.layoutType === "AVATAR_SPLIT"
          ? rng() < 0.5
            ? ("left" as const)
            : ("right" as const)
          : undefined;

      entries.push({
        sentenceIndex: s,
        sceneIndex: sentence!.scene_index,
        layoutType: biome.layoutType,
        isFirstInBiome: s === startIdx,
        transitionIn: s === startIdx ? transition : "CUT",
        avatarSide:
          biome.layoutType === "AVATAR_SPLIT" ? avatarSide : undefined,
        isHook: s < hookEndSentenceIndex,
      });
    }

    prevLayout = biome.layoutType;
    sentenceIdx = endIdx + 1;
  }

  // --- Step 4: Inject QUOTE_CARD where quotes exist ---
  for (let i = 0; i < entries.length; i++) {
    const sentence = sentences[i];
    if (!sentence) continue;
    if (
      containsQuote(sentence.sentence_text) &&
      entries[i]!.layoutType !== prominentLayout
    ) {
      if (i > 0 && i < outroStartSentenceIndex) {
        entries[i]!.layoutType = "QUOTE_CARD";
        entries[i]!.isFirstInBiome = true;
        entries[i]!.transitionIn = "CUT";
        if (i + 1 < entries.length) {
          entries[i + 1]!.isFirstInBiome = true;
          entries[i + 1]!.transitionIn = "CUT";
        }
      }
    }
  }

  // Fix avatarSide: consistent within a biome
  for (const biome of biomeEntries) {
    if (biome.layoutType === "AVATAR_SPLIT") {
      const side: "left" | "right" =
        category === "portrait" ? "left" : rng() < 0.5 ? "left" : "right";
      for (let s = biome.startSentenceIndex; s <= biome.endSentenceIndex; s++) {
        if (entries[s]) {
          entries[s]!.avatarSide = side;
        }
      }
    }
  }

  return {
    entries,
    biomes: biomeEntries,
    masterSeed,
    hookEndSentenceIndex,
    outroStartSentenceIndex,
  };
}

// ---------------------------------------------------------------------------
// Preliminary layout assignment (before image generation)
// ---------------------------------------------------------------------------

/** One scene's layout assignment, produced before image generation begins. */
export interface PreliminaryLayoutEntry {
  scene_index: number;
  layout_type: LayoutType;
  /** True when this layout will actually render a B-roll image. */
  needs_image: boolean;
}

/**
 * Assign layouts to scenes before image prompts are generated.
 *
 * Called during scene analysis — before the VA uploads HeyGen footage,
 * before Whisper runs, and before image prompts are written to Claude.
 * Uses estimated uniform timing so zones are approximate; the final
 * composition plan at render time uses the same masterSeed, so the
 * layout sequence is reproduced exactly once real timings are known.
 *
 * Assumes portrait (9/16) avatar by default since that is the HeyGen standard.
 * Callers may override avatarAspectRatio if the template specifies otherwise.
 *
 * AVATAR_FULLSCREEN and scenes returning AVATAR_ON_CAMERA (scene 0 in the hook)
 * do not need B-roll images and return needs_image=false.
 */
export function assignPreliminaryLayouts(
  paragraphCount: number,
  masterSeed: number,
  estimatedDurationSeconds: number,
  avatarAspectRatio: number = 9 / 16,
  fps: number = 30,
  forceLayout?: LayoutType,
): PreliminaryLayoutEntry[] {
  // If a layout is forced (e.g. CASUALLY_EXPLAINED locks to AVATAR_PIP),
  // short-circuit the biome algorithm and return all scenes with that layout.
  // needs_image is always true for AVATAR_PIP since every scene requires a background.
  if (forceLayout) {
    return Array.from({ length: paragraphCount }, (_, i) => ({
      scene_index: i,
      layout_type: forceLayout,
      needs_image: true,
    }));
  }

  const totalFrames = Math.round(estimatedDurationSeconds * fps);
  const framesPerScene = Math.max(1, Math.floor(totalFrames / paragraphCount));

  // Build dummy sentences with uniform timing (one sentence per paragraph/scene)
  const dummySentences: SentenceInput[] = Array.from(
    { length: paragraphCount },
    (_, i) => ({
      sentence_index: i,
      sentence_text: "",
      scene_index: i,
      start_frame: i * framesPerScene,
      end_frame: Math.min((i + 1) * framesPerScene, totalFrames),
      duration_frames: framesPerScene,
    }),
  );

  const plan = generateSentenceCompositionPlan({
    sentences: dummySentences,
    masterSeed,
    totalDurationSeconds: estimatedDurationSeconds,
    fps,
    avatarAspectRatio,
  });

  const IMAGE_BEARING = new Set<LayoutType>([
    "AVATAR_PIP",
    "AVATAR_SPLIT",
    "IMAGE_FULLSCREEN",
  ]);

  return plan.entries.map((entry) => ({
    scene_index: entry.sceneIndex,
    layout_type: entry.layoutType,
    needs_image: IMAGE_BEARING.has(entry.layoutType),
  }));
}
