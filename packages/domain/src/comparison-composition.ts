import type { LayoutType, TransitionType } from "@repo/contracts";

/**
 * Comparison Format Composition Planner
 *
 * Maps sentences to blocks (Director Agent scene_blocks) and applies biome-based
 * layout distribution WITHIN each block's sentence set.
 *
 * KEY DIFFERENCE from standard formats:
 * - Standard: Biomes span entire video (hook → body → outro zones)
 * - Comparison: Biomes span WITHIN each block (each block is its own mini-composition)
 *
 * This allows blocks to control their own visual pacing while still benefiting
 * from procedural layout variety.
 *
 * ZERO IO — pure functions only.
 */

// ---------------------------------------------------------------------------
// PRNG (mulberry32 — local copy, must match scene-composition.ts)
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

export interface ComparisonSceneInput {
  scene_index: number;
  start_frame: number | null;
  end_frame: number | null;
  duration_frames: number | null;
  paragraph?: string;
  comparison_block_type?: string | null;
}

export interface ComparisonSentenceInput {
  sentence_index: number;
  scene_index: number;
  start_frame: number;
  end_frame: number;
  duration_frames: number;
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface SentenceLayoutAssignment {
  sentence_index: number;
  layout_type: LayoutType;
  start_frame_relative: number; // Relative to block start_frame
  end_frame_relative: number;
  duration_frames: number;
}

export interface BlockCompositionPlan {
  block_index: number;
  sentences: SentenceLayoutAssignment[];
}

export interface ComparisonCompositionPlan {
  blocks: BlockCompositionPlan[];
  masterSeed: number;
}

export interface ComparisonCompositionParams {
  scenes: ComparisonSceneInput[];
  sentences: ComparisonSentenceInput[];
  wordTimestamps: WordTimestamp[];
  masterSeed: number;
  fps: number;
}

// ---------------------------------------------------------------------------
// Constants — biome configuration (reused from scene-composition.ts)
// ---------------------------------------------------------------------------

/**
 * Bell curve parameters for biome length (in sentences) per layout type.
 * These control layout switching frequency within blocks.
 *
 * Comparison format uses MORE AGGRESSIVE switching (lower means):
 * Target: layout switch every 10-20 seconds for visual variety.
 */
const BIOME_SIZE_CONFIG: Record<string, { mean: number; stddev: number; min: number; max: number }> = {
  AVATAR_PIP:        { mean: 2, stddev: 0.7, min: 1, max: 4 },
  AVATAR_FULLSCREEN: { mean: 2, stddev: 0.6, min: 2, max: 5 },
  AVATAR_SPLIT:      { mean: 2, stddev: 0.7, min: 1, max: 3 },
  QUOTE_CARD:        { mean: 1, stddev: 0.3, min: 1, max: 1 },
  IMAGE_FULLSCREEN:  { mean: 1, stddev: 0.3, min: 1, max: 2 },
};

/**
 * Body zone weights for comparison format.
 * Prioritizes visual variety with moderate narrator prominence.
 */
const COMPARISON_BODY_WEIGHTS: Record<string, number> = {
  AVATAR_PIP: 55,
  AVATAR_SPLIT: 20,
  QUOTE_CARD: 10,
  IMAGE_FULLSCREEN: 15,
};

/**
 * Adjacency compatibility matrix.
 * Forbidden neighbors to avoid visually similar back-to-back layouts.
 */
const FORBIDDEN_NEIGHBORS: Partial<Record<LayoutType, LayoutType[]>> = {
  AVATAR_PIP:       ["IMAGE_FULLSCREEN"],
  IMAGE_FULLSCREEN: ["AVATAR_PIP"],
};

// ---------------------------------------------------------------------------
// Normal distribution sampling (Box-Muller)
// ---------------------------------------------------------------------------

function sampleNormal(rng: () => number, mean: number, stddev: number, min: number, max: number): number {
  const u1 = Math.max(rng(), 1e-10);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const raw = mean + z * stddev;
  return Math.round(Math.max(min, Math.min(max, raw)));
}

// ---------------------------------------------------------------------------
// Weighted random selection
// ---------------------------------------------------------------------------

function weightedSelect(rng: () => number, weights: Record<string, number>, exclude: string[]): string {
  const entries = Object.entries(weights).filter(([k]) => !exclude.includes(k));
  const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
  if (totalWeight === 0) {
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
// Biome generation
// ---------------------------------------------------------------------------

interface Biome {
  layoutType: LayoutType;
  sentenceCount: number;
}

function generateBiomeSequence(
  rng: () => number,
  totalSentences: number,
  weights: Record<string, number>,
  initialPrevLayout?: LayoutType,
): Biome[] {
  const biomes: Biome[] = [];
  let cursor = 0;
  let prevLayout: LayoutType | undefined = initialPrevLayout;

  while (cursor < totalSentences) {
    const remaining = totalSentences - cursor;
    if (remaining <= 0) break;

    const exclude: string[] = [];

    if (prevLayout) {
      exclude.push(prevLayout);
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

    biomes.push({ layoutType, sentenceCount: size });
    prevLayout = layoutType;
    cursor += size;
  }

  return biomes;
}

// ---------------------------------------------------------------------------
// Sentence-to-Block Mapping
// ---------------------------------------------------------------------------

/**
 * Map sentences to blocks by timing overlap.
 * A sentence belongs to a block if its start_frame falls within the block's range.
 */
function mapSentencesToBlocks(
  scenes: ComparisonSceneInput[],
  sentences: ComparisonSentenceInput[],
): Map<number, ComparisonSentenceInput[]> {
  const blockSentences = new Map<number, ComparisonSentenceInput[]>();

  // Initialize empty arrays for each block
  for (const scene of scenes) {
    blockSentences.set(scene.scene_index, []);
  }

  // Assign sentences to blocks
  for (const sentence of sentences) {
    const block = scenes.find(
      (s) =>
        s.start_frame != null &&
        s.end_frame != null &&
        sentence.start_frame >= s.start_frame &&
        sentence.start_frame < s.end_frame
    );

    if (block) {
      blockSentences.get(block.scene_index)!.push(sentence);
    } else {
      // Fallback: assign to block by scene_index if timing fails
      const fallbackBlock = blockSentences.get(sentence.scene_index);
      if (fallbackBlock) {
        fallbackBlock.push(sentence);
      }
    }
  }

  return blockSentences;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate comparison composition plan: maps sentences to blocks with biome-based
 * layout distribution applied WITHIN each block.
 *
 * Algorithm:
 * 1. Map sentences to blocks by timing overlap
 * 2. For each block, generate biome sequence for its sentence set
 * 3. Assign layout types to sentences using bell-curve distribution
 * 4. Return block-to-sentences mapping with relative timing
 *
 * @param params - Scenes, sentences, word timestamps, master seed, and FPS
 * @returns Composition plan with per-block sentence layout assignments
 */
export function generateComparisonCompositionPlan(
  params: ComparisonCompositionParams
): ComparisonCompositionPlan {
  const { scenes, sentences, masterSeed, fps } = params;
  const rng = mulberry32(masterSeed);

  // Step 1: Map sentences to blocks
  const blockSentences = mapSentencesToBlocks(scenes, sentences);

  // Step 2: Generate biome-based layout assignments for each block
  const blocks: BlockCompositionPlan[] = [];

  for (const scene of scenes) {
    const sentencesInBlock = blockSentences.get(scene.scene_index) || [];

    // Skip blocks with no sentences or invalid timing
    if (sentencesInBlock.length === 0 || scene.start_frame == null || scene.end_frame == null) {
      continue;
    }

    // Generate biome sequence for this block's sentences
    const biomes = generateBiomeSequence(
      rng,
      sentencesInBlock.length,
      COMPARISON_BODY_WEIGHTS,
      undefined // No previous layout constraint (each block is independent)
    );

    // Assign layouts to sentences based on biomes
    const sentenceAssignments: SentenceLayoutAssignment[] = [];
    let sentenceIdx = 0;

    for (const biome of biomes) {
      for (let i = 0; i < biome.sentenceCount && sentenceIdx < sentencesInBlock.length; i++) {
        const sentence = sentencesInBlock[sentenceIdx]!;

        sentenceAssignments.push({
          sentence_index: sentence.sentence_index,
          layout_type: biome.layoutType,
          start_frame_relative: sentence.start_frame - scene.start_frame,
          end_frame_relative: sentence.end_frame - scene.start_frame,
          duration_frames: sentence.duration_frames,
        });

        sentenceIdx++;
      }
    }

    blocks.push({
      block_index: scene.scene_index,
      sentences: sentenceAssignments,
    });
  }

  return {
    blocks,
    masterSeed,
  };
}
