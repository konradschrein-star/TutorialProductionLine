import type { LayoutType } from "./composition-plan.js";

/**
 * One sentence (or sub-sentence clause) within a scene paragraph.
 * Each SentenceImage corresponds to one AI-generated B-roll image (or KEY_FACT card).
 *
 * Lifecycle:
 *   1. Populated by scene analysis (sentence_text, image_prompt, is_key_fact, key_fact_text, layout_type)
 *   2. group_index set by asset collection (grouping for late-body pacing)
 *   3. enriched_image_prompt and r2_key set when image generation completes
 *   4. start_frame, end_frame, duration_frames set by worker-render at render time
 */
export interface SentenceImage {
  /** Exact text of this sentence or clause as it appears in the script */
  sentence_text: string;
  /** AI image generation prompt (written with full paragraph context) */
  image_prompt: string;
  /** Layout type for this sentence (from V2 composition plan). Optional for legacy jobs. */
  layout_type?: LayoutType;
  /** Enriched prompt after broadcast photography specs injection */
  enriched_image_prompt?: string | null;
  /**
   * R2 object key of the generated image.
   * Null until image generation completes.
   * Only set for the FIRST sentence in each group (group head).
   */
  r2_key?: string | null;
  /**
   * Pacing group index for late-body scenes.
   * Multiple sentences with the same group_index share one image.
   * The first sentence in a group (lowest img_index) is the group head — it has a prompt
   * and gets an image generated. Subsequent sentences in the same group reuse that image.
   * Set to null/undefined until asset collection applies grouping.
   */
  group_index?: number | null;
  /** True if this sentence should render as a KEY_FACT text card instead of B-roll imagery */
  is_key_fact?: boolean;
  /** Display text for the KEY_FACT card (concise version of the sentence) */
  key_fact_text?: string | null;
  /** Whisper-aligned frame timing — set by worker-render at render time */
  start_frame?: number | null;
  end_frame?: number | null;
  duration_frames?: number | null;
}
