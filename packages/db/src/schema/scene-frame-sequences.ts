import { pgTable, uuid, varchar, text, integer, timestamp } from "drizzle-orm/pg-core";
import { contentJobs } from "./content-jobs.js";
import { assets } from "./assets.js";

/**
 * Scene Frame Sequences Table
 *
 * Represents an ordered set of image frames within a single scene — the
 * "low-FPS animation" capability. A scene with 3 frames produces a
 * micro-animation at the rhythm of the narration:
 *
 *   Frame 0 (v1): "Character reaching up toward ice cream cone"
 *   Frame 1 (v2): "Ice cream falling from character's hand"
 *   Frame 2 (v3): "Character crying, broken ice cream on ground"
 *
 * Consistency across frames is achieved by passing frame N-1 as a reference
 * image (@img4 in the canonical injection order) when generating frame N.
 * This is tracked via seed_asset_id.
 *
 * The render worker reads this table to assemble the frame sequence within
 * the scene's allocated duration, applying the specified transitions between
 * frames.
 *
 * Unique constraint: (job_id, scene_index, frame_index) — enforced via
 * CREATE UNIQUE INDEX rather than a table constraint for Drizzle ORM
 * compatibility and upsert operations.
 */
export const sceneFrameSequences = pgTable("scene_frame_sequences", {
  id: uuid("id").primaryKey().defaultRandom(),
  job_id: uuid("job_id")
    .notNull()
    .references(() => contentJobs.id, { onDelete: "cascade" }),
  scene_index: integer("scene_index").notNull(),
  frame_index: integer("frame_index").notNull(),
  /**
   * The generated image asset for this frame.
   * Null until image generation completes — status tracks readiness.
   */
  asset_id: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
  /**
   * What changed visually from the previous frame.
   * Written by scene analysis, used as the prompt delta when generating
   * subsequent frames: "ice cream now on ground, character crying, tears visible"
   */
  prompt_delta: text("prompt_delta"),
  /**
   * The asset used as a reference image when generating this frame.
   * For frame_index 0: null (no prior frame).
   * For frame_index N > 0: asset_id of frame N-1.
   * Passed as @img4 in the canonical injection order to ensure visual continuity.
   */
  seed_asset_id: uuid("seed_asset_id").references(() => assets.id, { onDelete: "set null" }),
  transition_type: varchar("transition_type", { length: 20 }).notNull().default("cut"),
  hold_duration_ms: integer("hold_duration_ms").notNull().default(500),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type SceneFrameSequence = typeof sceneFrameSequences.$inferSelect;
export type NewSceneFrameSequence = typeof sceneFrameSequences.$inferInsert;
