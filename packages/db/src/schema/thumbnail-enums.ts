import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Who owns a generated thumbnail row.
 *   content_job  / tutorial_job — attached to a real production job
 *   studio       — ad-hoc render from the Thumbnail Studio, not tied to a job
 *   test         — legacy prompt-lab render (kept for existing rows)
 */
// Order matches the live pg enum (migration 0037 appends 'studio' last).
export const thumbnailSubjectKindEnum = pgEnum("thumbnail_subject_kind", [
  "content_job",
  "tutorial_job",
  "test",
  "studio",
]);

/** Lifecycle of a single generated thumbnail. */
export const thumbnailStatusEnum = pgEnum("thumbnail_status", [
  "pending",
  "generating",
  "completed",
  "failed",
]);

/**
 * How the image prompt was authored.
 *   programmatic — deterministic renderer over the compiled brief
 *   authored     — an LLM writes the prompt FROM the compiled brief
 *   deepseek     — legacy alias for authored (kept so old rows stay valid)
 *   manual       — operator hand-edited the prompt (escape hatch)
 * Order matches the live pg enum (0037 created the first two; 0054 appends
 * 'authored' then 'manual' via ALTER TYPE ... ADD VALUE).
 */
export const thumbnailPromptModeEnum = pgEnum("thumbnail_prompt_mode", [
  "programmatic",
  "deepseek",
  "authored",
  "manual",
]);

/**
 * How a thumbnail row was produced. Replaces the old implicit signal (the ONLY
 * distinction used to be parent_thumbnail_id, which could not tell Iterate from
 * Regenerate — the DECISIONS §3.2.5 semantics bug).
 *   original   — first generation from the archetype reference + compiled brief
 *   variant    — a sibling of an original (same brief, different seed/layout)
 *   iterate    — reference is the PARENT'S OUTPUT; apply deltas only
 *   regenerate — reference is the parent's ORIGINAL archetype; brief recompiled
 *   edit       — deterministic overlay compositor (no provider call)
 *   localize   — translate an existing thumbnail for another market
 */
export const thumbnailGenerationKindEnum = pgEnum("thumbnail_generation_kind", [
  "original",
  "variant",
  "iterate",
  "regenerate",
  "edit",
  "localize",
]);

/** Optional QA-gate verdict (§3.2.9, default OFF). */
export const thumbnailReviewVerdictEnum = pgEnum("thumbnail_review_verdict", [
  "strong",
  "acceptable",
  "reject",
  "not_reviewed",
]);
