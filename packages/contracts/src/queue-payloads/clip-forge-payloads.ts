import { z } from "zod";

/**
 * Clip Forge — queue payloads.
 *
 * Three-stage MVP pipeline: ingest+download+transcribe → clip detection →
 * raw render. Each payload carries a `source_id` (cf_sources.id) so workers
 * never have to wonder which row to update.
 */

export const ClipForgeIngestPayloadSchema = z.object({
  source_id: z.string().uuid(),
});

export const ClipForgeClipDetectionPayloadSchema = z.object({
  source_id: z.string().uuid(),
});

export const ClipForgeRawRenderPayloadSchema = z.object({
  raw_clip_id: z.string().uuid(),
});

/**
 * Re-render a single existing variant row in cf_finishing_variants using
 * the layout_options / style_ids currently stored on the row. Emitted by
 * the Studio "Save" button after PATCHing the variant.
 */
export const ClipForgeFinishingRenderPayloadSchema = z.object({
  variant_id: z.string().uuid(),
});

export type ClipForgeIngestPayload = z.infer<
  typeof ClipForgeIngestPayloadSchema
>;
export type ClipForgeClipDetectionPayload = z.infer<
  typeof ClipForgeClipDetectionPayloadSchema
>;
export type ClipForgeRawRenderPayload = z.infer<
  typeof ClipForgeRawRenderPayloadSchema
>;
export type ClipForgeFinishingRenderPayload = z.infer<
  typeof ClipForgeFinishingRenderPayloadSchema
>;
