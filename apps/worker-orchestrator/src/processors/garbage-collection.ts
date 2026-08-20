import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import type { GarbageCollectionPayload } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { contentJobs } from "@repo/db";
import { updateJobStatus } from "../utils/update-job-status.js";
import {
  GarbageCollectionPayloadSchema,
  buildErrorDetail,
} from "@repo/contracts";
import { deleteLocalAssets } from "@repo/media-core";
import { getConfig } from "@repo/config";
import { unlink } from "node:fs/promises";

/**
 * Garbage Collection Processor
 *
 * Processes queue-garbage-collection jobs — hard deletion of local assets
 * and zombie cleanup.
 *
 * Reads r2_asset_manifest JSONB field and deletes every listed local file.
 * No orphaned files by design.
 *
 * Flow:
 * 1. Validate payload
 * 2. Verify job is in MARKED_FOR_DELETION status (unless force=true)
 * 3. Iterate r2_asset_manifest and delete each local file
 * 4. Delete per-job local directory (archived final video, ref images, etc.)
 * 5. Update status to DELETED
 *
 * @param db - Drizzle client
 * @returns Processor function for garbage collection queue
 */
export function createGarbageCollectionProcessor(db: DrizzleClient) {
  return async (job: Job<GarbageCollectionPayload>) => {
    console.log(
      JSON.stringify({
        level: "info",
        message: "Processing garbage collection job",
        job_id: job.id,
        payload: job.data,
      }),
    );

    // 1. Validate payload
    const parseResult = GarbageCollectionPayloadSchema.safeParse(job.data);
    if (!parseResult.success) {
      const errorMessage = `Invalid payload: ${parseResult.error.message}`;
      console.error(
        JSON.stringify({
          level: "error",
          message: errorMessage,
          job_id: job.id,
          errors: parseResult.error.errors,
        }),
      );
      throw new Error(errorMessage);
    }

    const { job_id, force } = parseResult.data;

    const config = getConfig();

    // 2. Fetch job
    const [contentJob] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, job_id))
      .limit(1);

    if (!contentJob) {
      // Job row is already gone (e.g. a prior GC run deleted it, or it was
      // manually cleaned up) — treat as already-collected rather than
      // failing. Throwing here just produces permanently-stuck "not found"
      // entries in the failed set, since retrying can never succeed.
      console.log(
        JSON.stringify({
          level: "info",
          message: "Garbage collection job skipped — content job already gone",
          job_id: job_id,
        }),
      );
      return;
    }

    // 3. Verify job is in MARKED_FOR_DELETION status (unless force=true)
    if (!force && contentJob.status !== "MARKED_FOR_DELETION") {
      throw new Error(
        `Job ${job_id} is not in MARKED_FOR_DELETION status (current: ${contentJob.status}). Use force=true to override.`,
      );
    }

    // 4. Delete all individual asset files from the manifest
    const assetManifest =
      (contentJob.r2_asset_manifest as Array<{
        key: string;
        type: string;
        size_bytes: number;
      }>) || [];

    console.log(
      JSON.stringify({
        level: "info",
        message: "Deleting local asset files",
        job_id: job_id,
        asset_count: assetManifest.length,
      }),
    );

    const failedAssetKeys: string[] = [];

    for (const asset of assetManifest) {
      // Skip placeholder entries (e.g. skipped thumbnail markers)
      if (asset.key === "skipped") {
        continue;
      }

      try {
        await unlink(asset.key);
        console.log(
          JSON.stringify({
            level: "info",
            message: "Deleted local asset file",
            job_id: job_id,
            asset_key: asset.key,
            asset_type: asset.type,
            size_bytes: asset.size_bytes,
          }),
        );
      } catch (deleteErr: any) {
        if (deleteErr.code === "ENOENT") {
          // Already gone — not a failure
          continue;
        }
        failedAssetKeys.push(asset.key);
        // Non-fatal: log and continue — partial deletion is better than no deletion
        console.error(
          JSON.stringify({
            level: "error",
            message: "Failed to delete local asset file (continuing)",
            job_id: job_id,
            asset_key: asset.key,
            error: String(deleteErr),
          }),
        );
      }
    }

    console.log(
      JSON.stringify({
        level: failedAssetKeys.length > 0 ? "warn" : "info",
        message:
          failedAssetKeys.length > 0
            ? `Asset deletion completed with ${failedAssetKeys.length} failure(s)`
            : "All asset files deleted",
        job_id: job_id,
        asset_count: assetManifest.length,
        failed_count: failedAssetKeys.length,
      }),
    );

    // 5. Delete local disk per-job directory (archived final video, ref dir, etc.)
    try {
      await deleteLocalAssets(config.LOCAL_MEDIA_ROOT, job_id);
      console.log(
        JSON.stringify({
          level: "info",
          message: "Local job directory deleted",
          job_id: job_id,
        }),
      );
    } catch (localDeleteErr) {
      // Non-fatal — local dir may not exist for jobs without archived video
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "Local job directory deletion failed (non-fatal)",
          job_id: job_id,
          error: String(localDeleteErr),
        }),
      );
    }

    // 6. Update status to DELETED
    const deletionErrorDetail =
      failedAssetKeys.length > 0
        ? buildErrorDetail({
            code: "PARTIAL_ASSET_DELETION",
            message: `${failedAssetKeys.length} asset file(s) could not be deleted`,
            category: "asset_management",
            retryable: false,
            context: { failed_keys: failedAssetKeys, job_id },
          })
        : undefined;

    await updateJobStatus(
      db,
      job_id,
      "DELETED",
      failedAssetKeys.length > 0
        ? `Partial deletion: ${failedAssetKeys.length} file(s) failed`
        : undefined,
      deletionErrorDetail,
    );

    console.log(
      JSON.stringify({
        level: "info",
        message: "Garbage collection job completed",
        job_id: job.id,
        content_job_id: job_id,
      }),
    );
  };
}
