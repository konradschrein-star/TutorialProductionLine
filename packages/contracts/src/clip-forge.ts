import { z } from "zod";

/**
 * Clip Forge queue payloads.
 *
 * Reconstructed 2026-06-17 from processor usage (the originals were developed
 * but never committed). Each stage carries only the id of the row it operates
 * on; everything else is read from the database.
 */

export const ClipForgeIngestPayloadSchema = z.object({
  source_id: z.string().uuid(),
});
export type ClipForgeIngestPayload = z.infer<
  typeof ClipForgeIngestPayloadSchema
>;

export const ClipForgeClipDetectionPayloadSchema = z.object({
  source_id: z.string().uuid(),
});
export type ClipForgeClipDetectionPayload = z.infer<
  typeof ClipForgeClipDetectionPayloadSchema
>;

export const ClipForgeRawRenderPayloadSchema = z.object({
  raw_clip_id: z.string().uuid(),
});
export type ClipForgeRawRenderPayload = z.infer<
  typeof ClipForgeRawRenderPayloadSchema
>;

export const ClipForgeFinishingRenderPayloadSchema = z.object({
  variant_id: z.string().uuid(),
});
export type ClipForgeFinishingRenderPayload = z.infer<
  typeof ClipForgeFinishingRenderPayloadSchema
>;
