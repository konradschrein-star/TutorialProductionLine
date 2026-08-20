import { z } from "zod";
import { LayoutTypeSchema, TransitionTypeSchema } from "./composition-plan.js";

/**
 * Video Timeline — Edit Layer
 *
 * Sits above the assembly_manifest as the human-editable intermediate
 * representation. The renderer prefers this when it exists, falling back
 * to the raw assembly_manifest.
 *
 * This is the "rough cut" that operators can inspect and adjust before
 * triggering a final render. Every field maps back to a source in either
 * assembly_manifest or scene_frame_sequences.
 */

// ─── Frame (maps from scene_frame_sequences row) ─────────────────────────────

export const TimelineFrameSchema = z.object({
  frame_sequence_id: z.string().uuid().describe("scene_frame_sequences.id"),
  frame_index: z.number().int().nonnegative(),
  asset_id: z.string().uuid().nullable().describe("Null until image generation completes"),
  hold_duration_ms: z.number().int().positive(),
  transition_type: z.enum(["cut", "dissolve", "hold"]),
  prompt_delta: z.string().nullable().describe("What changed visually from the previous frame"),
  pending_regeneration: z
    .object({ new_prompt_delta: z.string() })
    .optional()
    .describe("Set when operator has edited the prompt and queued regen"),
});

export type TimelineFrame = z.infer<typeof TimelineFrameSchema>;

// ─── Text Overlay (maps from ticker_headline) ─────────────────────────────────

export const TextOverlaySchema = z.object({
  text: z.string().max(200),
  position: z.enum(["lower-third", "ticker", "center"]),
});

export type TextOverlay = z.infer<typeof TextOverlaySchema>;

// ─── Avatar PiP (derived from composition_plan layoutType) ──────────────────

export const AvatarPipSchema = z.object({
  asset_id: z.string().uuid().nullable().describe("HeyGen video clip asset, null until uploaded"),
  position: z.enum(["bottom-right", "bottom-left", "hidden"]),
  scale: z.number().min(0.1).max(1.0).default(0.3),
  trim_start_ms: z.number().int().nonnegative().default(0),
  trim_end_ms: z.number().int().nonnegative().default(0),
});

export type AvatarPip = z.infer<typeof AvatarPipSchema>;

// ─── Voiceover (derived from word_timestamps slice) ─────────────────────────

export const VoiceoverSchema = z.object({
  asset_id: z.string().uuid().nullable().describe("TTS audio asset, null until generated"),
  offset_ms: z.number().int().default(0).describe("Nudge audio relative to scene start"),
  trim_start_ms: z.number().int().nonnegative().default(0),
});

export type Voiceover = z.infer<typeof VoiceoverSchema>;

// ─── Regeneration Request (audit trail) ──────────────────────────────────────

export const RegenerationActionSchema = z.enum([
  "full_regen",
  "prompt_delta",
  "swap_layout",
  "swap_character_state",
  "swap_environment",
]);

export const RegenerationRequestSchema = z.object({
  action: RegenerationActionSchema,
  requested_at: z.string().describe("ISO 8601 timestamp"),
  requested_by: z.string().optional().describe("Operator username"),
  new_prompt_delta: z.string().optional(),
  new_layout_type: LayoutTypeSchema.optional(),
  status: z.enum(["pending", "dispatched", "complete", "failed"]).default("pending"),
});

export type RegenerationAction = z.infer<typeof RegenerationActionSchema>;
export type RegenerationRequest = z.infer<typeof RegenerationRequestSchema>;

// ─── Timeline Scene ───────────────────────────────────────────────────────────

export const TimelineSceneSchema = z.object({
  scene_index: z.number().int().nonnegative(),
  scene_id: z.string().describe("Stable composite key: '{job_id}:scene_{scene_index}'"),

  // Timing (computed from start_frame/duration_frames or word_timestamps)
  start_ms: z.number().int().nonnegative(),
  duration_ms: z.number().int().positive(),

  // Layout (from composition_plan.entries[scene_index])
  layout_type: LayoutTypeSchema,
  transition_in: TransitionTypeSchema,
  is_hook: z.boolean().describe("True = scene is in the hook zone"),

  // Tracks
  video_frames: z.array(TimelineFrameSchema).describe("From scene_frame_sequences; empty = single still"),
  avatar_pip: AvatarPipSchema.optional().describe("Present when layout includes avatar PiP"),
  text_overlays: z.array(TextOverlaySchema).describe("From ticker_headline"),
  voiceover: VoiceoverSchema,

  // Source metadata (read-only in the editor — reflects assembly_manifest state)
  paragraph: z.string().describe("Script paragraph spoken during this scene"),
  image_prompt: z.string().nullable(),
  enriched_image_prompt: z.string().nullable(),
  shot_type: z.string().nullable(),
  camera_angle: z.string().nullable(),

  // Primary visual R2 key (from assembly_manifest.scenes[i].visual_asset_key)
  // Used by the compositor for single-still scenes (no frame sequences).
  preview_r2_key: z.string().nullable().optional(),

  // Operator edits history
  regeneration_requests: z.array(RegenerationRequestSchema).default([]),
});

export type TimelineScene = z.infer<typeof TimelineSceneSchema>;

// ─── Video Timeline (top-level edit layer) ───────────────────────────────────

export const VideoTimelineSchema = z.object({
  job_id: z.string().uuid(),
  version: z.number().int().positive().default(1),
  total_duration_ms: z.number().int().positive(),
  scenes: z.array(TimelineSceneSchema).min(1),
  global_audio: z.object({
    music_asset_id: z.string().uuid().optional(),
    music_duck_db: z.number().default(-12).describe("Music ducking under voiceover in dB"),
    voiceover_gain_db: z.number().default(0).describe("Voiceover gain adjustment in dB"),
  }),
  /** ISO 8601 timestamp set by the render route when a render is dispatched. Used for cooldown checks. */
  render_queued_at: z.string().datetime().optional(),
});

export type VideoTimeline = z.infer<typeof VideoTimelineSchema>;
