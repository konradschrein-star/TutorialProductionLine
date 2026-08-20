import { z } from "zod";

// ── Transcript ─────────────────────────────────────────────────────────────
// Shared by: clip-label worker, CaptionLayer renderer, HITL transcript panel, clip-selection agent
export const TranscriptWordSchema = z.object({
  word: z.string(),
  start: z.number(), // seconds (whisperX output)
  end: z.number(),
  score: z.number().min(0).max(1),
  speaker: z.string().optional(),
});

export const TranscriptSchema = z.object({
  language: z.string().min(2).max(5),
  words: z.array(TranscriptWordSchema),
  speaker_segments: z
    .array(
      z.object({
        speaker: z.string(),
        start: z.number(),
        end: z.number(),
      }),
    )
    .nullish(),
});

export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;

// ── TTS Sentence Timings ───────────────────────────────────────────────────
// Read interface for clip-selection agent consuming TTS output from asset-collection.
// Stored in content_jobs.assembly_manifest under key 'sentence_timings'.
export const SentenceTimingSchema = z.object({
  sentence_index: z.number().int().nonnegative(),
  text: z.string(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  speaker: z.string().optional(),
});

export const SentenceTimingArraySchema = z.array(SentenceTimingSchema);

export type SentenceTiming = z.infer<typeof SentenceTimingSchema>;

// ── Clause timing ──────────────────────────────────────────────────────────
// Word-aligned timing for individual clauses (comma/conjunction splits) within sentences.
// Stored in assembly_manifest.clause_timings after TTS word timestamps are available.
export const ClauseTimingSchema = z.object({
  clause_index: z.number().int(),
  sentence_index: z.number().int(), // which sentence this clause came from
  text: z.string(),
  start_ms: z.number().int(),
  end_ms: z.number().int(),
  // True when both boundaries came from a real Whisper word match rather
  // than interpolation/clamping. Optional for backward compat with
  // manifests persisted before this field existed.
  matched: z.boolean().optional(),
});

export const ClauseTimingArraySchema = z.array(ClauseTimingSchema);

export type ClauseTiming = z.infer<typeof ClauseTimingSchema>;

// ── Clip segment ───────────────────────────────────────────────────────────
// A single source video segment used inside an edit list entry.
// Supports multi-clip entries where one sentence/clause is covered by
// consecutive segments trimmed from (potentially different) source videos.
export const ClipSegmentSchema = z.object({
  clip_id: z.string().uuid(),
  // CDN URL of source video — used by OffthreadVideo for inline strategy
  source_video_cdn_url: z.string().url().optional(),
  // R2 storage key for the source video (server-side access)
  source_video_storage_key: z.string().optional(),
  // Trim within source video (ms relative to source start)
  trim_start_ms: z.number().int(),
  trim_end_ms: z.number().int(),
});

export type ClipSegment = z.infer<typeof ClipSegmentSchema>;

// ── Edit list entry ────────────────────────────────────────────────────────
// NOTE: Custom Zod schema — NOT OTIO. OTIO adapter is planned for a future phase.
// Design inspired by ShortGPT EditingMarkupLanguage + our pipeline requirements.
export const EditListEntrySchema = z.object({
  id: z.string().uuid(),
  sentence_index: z.number().int().nonnegative(),
  sentence_text: z.string(),
  // null = B-roll fallback (AI-generated image/video)
  // Kept for backward compatibility; prefer `clips` array for new entries.
  clip_id: z.string().uuid().nullable().optional(),
  // CDN URL of pre-extracted clip (materialized strategy) — null if inline
  // Kept for backward compatibility; prefer `clips[].source_video_cdn_url`.
  clip_cdn_url: z.string().url().nullable().optional(),
  // CDN URL of source video — used by OffthreadVideo for inline strategy
  // Kept for backward compatibility; prefer `clips[].source_video_cdn_url`.
  source_video_cdn_url: z.string().url().nullable().optional(),
  // Multi-clip support: one or more consecutive source segments covering this entry.
  // When present, supersedes the legacy single-clip fields above.
  clips: z.array(ClipSegmentSchema).min(1).optional(),
  // Timeline position in final assembled video (ms)
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  // Trim within clip (ms relative to clip start) — used only when `clips` is absent.
  // Optional: defaults to 0 / null respectively. When `clips` is present, per-clip
  // trim lives inside each ClipSegment.
  trim_start_ms: z.number().int().nonnegative().default(0).optional(),
  trim_end_ms: z.number().int().positive().nullable().default(null).optional(),
  playback_rate: z.number().positive().default(1.0),
  is_fallback: z.boolean().default(false),
  fallback_prompt: z.string().optional(),
  match_score: z.number().min(0).max(1).optional(),
  match_reason: z.string().optional(),
});

export const EditListSchema = z.array(EditListEntrySchema);

export type EditListEntry = z.infer<typeof EditListEntrySchema>;
export type EditList = z.infer<typeof EditListSchema>;

// ── Shot list ──────────────────────────────────────────────────────────────
// Phase 1 output of two-phase clip selection agent
export const ShotListEntrySchema = z.object({
  sentence_index: z.number().int().nonnegative(),
  sentence_text: z.string(),
  assigned_tags: z.object({
    characters: z.array(z.string()).optional().default([]),
    mood: z.array(z.string()).optional().default([]),
    location: z.array(z.string()).optional().default([]),
    action: z.array(z.string()).optional().default([]),
    custom: z.array(z.string()).optional().default([]),
  }),
  shot_scale_preference: z
    .enum(["extreme_close", "close", "medium", "wide", "extreme_wide", "any"])
    .catch("any")
    .default("any"),
  audio_class_preference: z
    .enum([
      "dialogue",
      "music_only",
      "speech_over_music",
      "action_sfx",
      "ambient",
      "silence",
      "any",
    ])
    .catch("any")
    .default("any"),
  duration_min_ms: z.number().int().positive().optional(),
  duration_max_ms: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

export const ShotListSchema = z.array(ShotListEntrySchema);

export type ShotListEntry = z.infer<typeof ShotListEntrySchema>;
export type ShotList = z.infer<typeof ShotListSchema>;

// ── Format playbook ────────────────────────────────────────────────────────
// Per-format assembly rules injected into clip-selection LLM prompt.
// Stored in clip_library_configs.playbook.
export const FormatPlaybookSchema = z.object({
  format: z.string(),
  system_prompt_addendum: z.string(),
  clips_per_sentence: z.number().int().positive().default(1),
  preferred_shot_scales: z.array(z.string()),
  avoid_audio_classes: z.array(z.string()),
  character_continuity: z.enum(["off", "soft", "strict"]).default("off"),
  min_clip_duration_ms: z.number().int().positive().default(1500),
  max_clip_duration_ms: z.number().int().positive().default(8000),
  transition_style: z.enum(["cut", "dissolve", "fade"]).default("cut"),
  music_volume: z.number().min(0).max(1).default(0.3),
  music_ducking_volume: z.number().min(0).max(1).default(0.08),
  visual_mode: z
    .enum(["full_screen", "side_panel", "lower_third"])
    .default("full_screen"),
});

export type FormatPlaybook = z.infer<typeof FormatPlaybookSchema>;

// ── Clip ingest payload ────────────────────────────────────────────────────
export const ClipIngestPayloadSchema = z.object({
  source_video_id: z.string().uuid(),
  library_id: z.string().uuid(),
});

export type ClipIngestPayload = z.infer<typeof ClipIngestPayloadSchema>;

// ── Create source video payload (programmatic ingest entry point) ──────────
// Discriminated on source_kind so the server can validate the structured
// identity fields required to build ref_base. Same payload powers the Hub
// "Add Source Video" form and any external automation that pushes videos
// into the global library. source_url and source_file_path are inlined per
// option (Zod's discriminatedUnion requires plain z.object shapes — no .and()).
const WorkSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9-]+$/, "work_slug must be kebab-case (a-z0-9-)");

export const CreateSourceVideoPayloadSchema = z
  .discriminatedUnion("source_kind", [
    z.object({
      source_kind: z.literal("movie"),
      library_id: z.string().uuid(),
      work_slug: WorkSlugSchema,
      work_title: z.string().min(1).max(300),
      work_part: z.number().int().positive().optional(),
      source_url: z.string().url().optional(),
      source_file_path: z.string().min(1).optional(),
    }),
    z.object({
      source_kind: z.literal("series"),
      library_id: z.string().uuid(),
      work_slug: WorkSlugSchema,
      work_title: z.string().min(1).max(300),
      season: z.number().int().nonnegative(),
      episode: z.number().int().positive(),
      source_url: z.string().url().optional(),
      source_file_path: z.string().min(1).optional(),
    }),
    z.object({
      source_kind: z.literal("youtube"),
      library_id: z.string().uuid(),
      // Either pass the id directly or a URL — server parses ?v=… / youtu.be/….
      youtube_id: z
        .string()
        .min(8)
        .max(20)
        .regex(/^[A-Za-z0-9_-]+$/)
        .optional(),
      source_url: z.string().url().optional(),
      source_file_path: z.string().min(1).optional(),
      work_title: z.string().min(1).max(300).optional(),
    }),
    z.object({
      source_kind: z.literal("stock"),
      library_id: z.string().uuid(),
      external_provider: z.string().min(1).max(40),
      external_id: z.string().min(1).max(200),
      work_title: z.string().min(1).max(300).optional(),
      source_url: z.string().url().optional(),
      source_file_path: z.string().min(1).optional(),
    }),
    z.object({
      source_kind: z.literal("upload"),
      library_id: z.string().uuid(),
      work_slug: WorkSlugSchema,
      external_id: z.string().min(1).max(200),
      work_title: z.string().min(1).max(300).optional(),
      source_url: z.string().url().optional(),
      source_file_path: z.string().min(1).optional(),
    }),
    z.object({
      source_kind: z.literal("other"),
      library_id: z.string().uuid(),
      work_slug: WorkSlugSchema,
      external_id: z.string().min(1).max(200),
      work_title: z.string().min(1).max(300).optional(),
      source_url: z.string().url().optional(),
      source_file_path: z.string().min(1).optional(),
    }),
  ])
  .superRefine((data, ctx) => {
    // youtube can resolve location from youtube_id; everything else needs
    // an explicit URL or file path.
    if (data.source_kind === "youtube") {
      if (!data.youtube_id && !data.source_url && !data.source_file_path) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Pass youtube_id, source_url, or source_file_path",
        });
      }
      return;
    }
    if (!data.source_url && !data.source_file_path) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either source_url or source_file_path is required",
      });
    }
  });

export type CreateSourceVideoPayload = z.infer<
  typeof CreateSourceVideoPayloadSchema
>;

// ── Clip label payload ─────────────────────────────────────────────────────
export const ClipLabelPayloadSchema = z.object({
  clip_id: z.string().uuid(),
  library_id: z.string().uuid(),
});

export type ClipLabelPayload = z.infer<typeof ClipLabelPayloadSchema>;

// ── Clip label batch payload ───────────────────────────────────────────────
// Group all clips of one source_video into a single job so the worker can
// inject prev_context / next_keyframe when labeling micro-clips (<1s) —
// Gemini hallucinates on isolated frames without surrounding context.
export const ClipLabelBatchPayloadSchema = z.object({
  source_video_id: z.string().uuid(),
  library_id: z.string().uuid(),
});

export type ClipLabelBatchPayload = z.infer<typeof ClipLabelBatchPayloadSchema>;

// ── Clip embed payload ─────────────────────────────────────────────────────
export const ClipEmbedPayloadSchema = z.object({
  clip_id: z.string().uuid(),
});

export type ClipEmbedPayload = z.infer<typeof ClipEmbedPayloadSchema>;

// ── Clip selection payload ─────────────────────────────────────────────────
export const ClipSelectionPayloadSchema = z.object({
  job_id: z.string().uuid(),
  config_id: z.string().uuid(),
});

export type ClipSelectionPayload = z.infer<typeof ClipSelectionPayloadSchema>;

// ── Clip retag payload ─────────────────────────────────────────────────────
export const ClipRetagPayloadSchema = z.object({
  clip_id: z.string().uuid(),
  library_id: z.string().uuid(),
});

export type ClipRetagPayload = z.infer<typeof ClipRetagPayloadSchema>;

// ── Clip extract payload ───────────────────────────────────────────────────
// Extracts all clips for a source_video into individual MP4 files (materialized strategy).
export const ClipExtractPayloadSchema = z.object({
  source_video_id: z.string().uuid(),
  library_id: z.string().uuid(),
});

export type ClipExtractPayload = z.infer<typeof ClipExtractPayloadSchema>;

// ── Image library payloads ────────────────────────────────────────────────
// Parallel pipeline to clips: ingest → label → embed → done.
export const ImageIngestPayloadSchema = z.object({
  source_image_id: z.string().uuid(),
  library_id: z.string().uuid(),
});
export type ImageIngestPayload = z.infer<typeof ImageIngestPayloadSchema>;

export const ImageLabelPayloadSchema = z.object({
  image_id: z.string().uuid(),
  library_id: z.string().uuid(),
});
export type ImageLabelPayload = z.infer<typeof ImageLabelPayloadSchema>;

export const ImageEmbedPayloadSchema = z.object({
  image_id: z.string().uuid(),
});
export type ImageEmbedPayload = z.infer<typeof ImageEmbedPayloadSchema>;

// ── Create source image payload (programmatic ingest entry point) ────────
// Discriminated on source_kind; mirrors CreateSourceVideoPayloadSchema but
// images don't need explicit work_part/season/episode. Pexels gets a
// dedicated branch so the scraper / Hub form can pass just the photo id.
const ImageWorkSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9-]+$/, "work_slug must be kebab-case (a-z0-9-)");

export const CreateSourceImagePayloadSchema = z
  .discriminatedUnion("source_kind", [
    z.object({
      source_kind: z.literal("stock"),
      library_id: z.string().uuid(),
      external_provider: z.string().min(1).max(40), // 'pexels','unsplash',…
      external_id: z.string().min(1).max(200),
      work_title: z.string().min(1).max(300).optional(),
      // Optional — server can fetch the URL itself from Pexels by id.
      source_url: z.string().url().optional(),
      source_file_path: z.string().min(1).optional(),
    }),
    z.object({
      source_kind: z.literal("upload"),
      library_id: z.string().uuid(),
      work_slug: ImageWorkSlugSchema,
      external_id: z.string().min(1).max(200),
      work_title: z.string().min(1).max(300).optional(),
      source_url: z.string().url().optional(),
      source_file_path: z.string().min(1).optional(),
    }),
    z.object({
      source_kind: z.literal("other"),
      library_id: z.string().uuid(),
      work_slug: ImageWorkSlugSchema,
      external_id: z.string().min(1).max(200),
      work_title: z.string().min(1).max(300).optional(),
      source_url: z.string().url().optional(),
      source_file_path: z.string().min(1).optional(),
    }),
    z.object({
      source_kind: z.literal("movie"),
      library_id: z.string().uuid(),
      work_slug: ImageWorkSlugSchema,
      work_title: z.string().min(1).max(300),
      external_id: z.string().min(1).max(200),
      source_url: z.string().url().optional(),
      source_file_path: z.string().min(1).optional(),
    }),
    z.object({
      source_kind: z.literal("series"),
      library_id: z.string().uuid(),
      work_slug: ImageWorkSlugSchema,
      work_title: z.string().min(1).max(300),
      season: z.number().int().nonnegative(),
      episode: z.number().int().positive(),
      external_id: z.string().min(1).max(200),
      source_url: z.string().url().optional(),
      source_file_path: z.string().min(1).optional(),
    }),
  ])
  .superRefine((data, ctx) => {
    if (data.source_kind === "stock") {
      // Pexels: server can resolve URL from id; URL or file path optional.
      return;
    }
    if (!data.source_url && !data.source_file_path) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either source_url or source_file_path is required",
      });
    }
  });

export type CreateSourceImagePayload = z.infer<
  typeof CreateSourceImagePayloadSchema
>;

// ── Sidecar response types ─────────────────────────────────────────────────
export const FaceResultSchema = z.object({
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  character_name: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  // ArcFace 512-dim embedding (not stored in DB; used for centroid update only)
  embedding: z.array(z.number()).length(512).optional(),
});

export type FaceResult = z.infer<typeof FaceResultSchema>;

export const AudioClassResultSchema = z.object({
  dominant_class: z.enum([
    "dialogue",
    "music_only",
    "speech_over_music",
    "action_sfx",
    "ambient",
    "silence",
  ]),
  timeline: z.array(
    z.object({
      timestamp_ms: z.number().int(),
      audio_class: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export type AudioClassResult = z.infer<typeof AudioClassResultSchema>;

export const SparseEmbeddingSchema = z.object({
  indices: z.array(z.number().int()),
  values: z.array(z.number()),
});

export const EmbeddingResultSchema = z.object({
  dense: z.array(z.number()).length(384),
  sparse: SparseEmbeddingSchema,
});

export type EmbeddingResult = z.infer<typeof EmbeddingResultSchema>;

export const SceneDetectionResultSchema = z.object({
  scenes: z.array(
    z.object({
      start_ms: z.number().int().nonnegative(),
      end_ms: z.number().int().positive(),
      // Visual signals optionally emitted by the sidecar (added 2026-06-05).
      // Older sidecar versions omit these; consumers treat as nullable.
      // phash is the 64-bit dHash of the midpoint frame as a signed int.
      phash: z.number().int().nullish(),
      motion_score: z.number().min(0).max(1).nullish(),
      palette_hex: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).nullish(),
    }),
  ),
  detector_used: z.enum([
    "transnetv2",
    "pyscenedetect",
    "ffprobe-interval",
    "transnetv2+ensemble",
  ]),
});

export type SceneDetectionResult = z.infer<typeof SceneDetectionResultSchema>;
