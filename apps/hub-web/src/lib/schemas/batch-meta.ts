import { z } from 'zod';

/**
 * Batch Meta Schema
 *
 * Validates _batch_meta.json found in ingestion zip files.
 * These fields override the UI-provided batch defaults when present.
 */
export const BatchMetaSchema = z
  .object({
    template_id: z.string().uuid().optional(),
    channel_id: z.string().uuid().optional(),
    format: z.string().optional(),
  })
  .strict();

export type BatchMeta = z.infer<typeof BatchMetaSchema>;
