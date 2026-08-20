import { z } from "zod";

/**
 * Garbage Collection Queue Payload
 *
 * Used by queue-garbage-collection lane for hard deletion of local assets
 * and zombie cleanup.
 *
 * This queue runs at low concurrency and processes jobs marked for deletion.
 * It iterates the r2_asset_manifest JSONB field and deletes every
 * listed local file. No orphaned files by design.
 *
 * Fields:
 * - job_id: Job to garbage collect
 * - force: Force deletion even if job is not in MARKED_FOR_DELETION status
 *          (use with extreme caution - for admin override only)
 */
export const GarbageCollectionPayloadSchema = z.object({
  job_id: z.string().uuid().describe("Job ID to garbage collect"),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe("Force deletion (admin override - use with caution)"),
});

export type GarbageCollectionPayload = z.infer<typeof GarbageCollectionPayloadSchema>;
