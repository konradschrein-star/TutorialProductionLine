import { and, eq, isNotNull, lt } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import { tutorialJobs, storageArtifacts } from "@repo/db";
import { logger } from "@repo/logger";
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

/**
 * VPS retention sweep for finished tutorials.
 *
 * ## The rule
 *
 * Google Drive is the permanent store; the VPS keeps roughly the last week so
 * there is something local to re-deliver or inspect. `raw_recording` alone is
 * 83% of all bytes (59 of 71 GB), so without a sweep the box fills.
 *
 * ## The safety property that matters
 *
 * A local file is deleted ONLY when its Drive copy is CONFIRMED:
 *
 *     storage_artifacts.state = 'uploaded'  AND  drive_file_id IS NOT NULL
 *
 * Not "the job says delivered_to_drive". Not "we tried to upload it". That
 * boolean is hand-written, has a documented history of being set by a UI button
 * that never uploaded anything, and 32 finished videos were once invisible for
 * 19-33 days because a best-effort write-back silently failed. Trusting it here
 * would delete the only copy of a video that never reached Drive.
 *
 * `drive_file_id` is the only field that can only exist because Drive itself
 * returned it.
 *
 * ## Dry run by default
 *
 * This deletes irreversibly and there is NO media backup by policy, so it
 * reports what it would remove and removes nothing unless explicitly enabled
 * with TUTORIAL_RETENTION_ENABLED=true. A sweep that starts deleting the moment
 * it is deployed is how a bad predicate becomes 59 GB of lost work.
 */

const DEFAULT_RETENTION_DAYS = 7;
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 4x a day is ample

/** Artefacts whose local copy is disposable once Drive has confirmed it. */
const SWEEPABLE_KINDS = ["final_video", "raw_recording"] as const;

export interface RetentionSweepResult {
  considered: number;
  deleted: number;
  bytesFreed: number;
  skippedUnconfirmed: number;
  skippedMissing: number;
  dryRun: boolean;
  proposedFiles: number;
  proposedBytes: number;
  blockedUnsafeEviction: boolean;
}

function resolveLocal(path: string | null, mediaRoot: string): string | null {
  if (!path || path === "") return null;
  return isAbsolute(path) ? path : join(mediaRoot, path);
}

/**
 * One sweep. Never throws — a retention pass must not take the worker down.
 */
export async function runRetentionSweepOnce(
  db: DrizzleClient,
  opts: {
    mediaRoot: string;
    retentionDays?: number;
    dryRun?: boolean;
    batchSize?: number;
  },
): Promise<RetentionSweepResult> {
  const retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
  // Recovery safety fence: the legacy predicate proves neither current bytes
  // nor Drive readability, and consumers do not yet hydrate archived media.
  // Even an inherited TUTORIAL_RETENTION_ENABLED=true must not evict files.
  // Enable deletion only after revision-aware verification, hydration and
  // consumer leases replace this legacy candidate scanner.
  const dryRun = true;
  const batchSize = opts.batchSize ?? 200;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const result: RetentionSweepResult = {
    considered: 0,
    deleted: 0,
    bytesFreed: 0,
    skippedUnconfirmed: 0,
    skippedMissing: 0,
    dryRun,
    proposedFiles: 0,
    proposedBytes: 0,
    blockedUnsafeEviction: opts.dryRun === false,
  };

  try {
    const candidates = await db
      .select({
        id: tutorialJobs.id,
        final_path: tutorialJobs.final_path,
        recording_path: tutorialJobs.recording_path,
        completed_at: tutorialJobs.completed_at,
      })
      .from(tutorialJobs)
      .where(
        and(
          eq(tutorialJobs.status, "COMPLETED"),
          isNotNull(tutorialJobs.completed_at),
          lt(tutorialJobs.completed_at, cutoff),
        ),
      )
      .limit(batchSize);

    for (const job of candidates) {
      // Confirmed-in-Drive artefacts for this job, by kind. This is the whole
      // safety property — see the module doc.
      const confirmed = await db
        .select({ kind: storageArtifacts.kind })
        .from(storageArtifacts)
        .where(
          and(
            eq(storageArtifacts.job_id, job.id),
            eq(storageArtifacts.owner_kind, "tutorial_job"),
            eq(storageArtifacts.state, "uploaded"),
            isNotNull(storageArtifacts.drive_file_id),
          ),
        );
      const confirmedKinds = new Set(confirmed.map((c) => c.kind));

      for (const kind of SWEEPABLE_KINDS) {
        const localPath = resolveLocal(
          kind === "final_video" ? job.final_path : job.recording_path,
          opts.mediaRoot,
        );
        if (localPath === null) continue;
        result.considered += 1;

        if (!confirmedKinds.has(kind)) {
          result.skippedUnconfirmed += 1;
          logger.debug(
            { jobId: job.id, kind, localPath },
            "retention: no confirmed Drive copy — keeping the local file",
          );
          continue;
        }

        let sizeBytes = 0;
        try {
          sizeBytes = (await stat(localPath)).size;
        } catch {
          result.skippedMissing += 1; // already gone; nothing to do
          continue;
        }

        result.proposedFiles += 1;
        result.proposedBytes += sizeBytes;
      }
    }

    logger.info(
      {
        ...result,
        gbFreed: Number((result.bytesFreed / 1024 ** 3).toFixed(2)),
        retentionDays,
        cutoff: cutoff.toISOString(),
      },
      dryRun
        ? "retention: candidates only — eviction blocked pending verified archive restoration and consumer leases"
        : "retention: sweep complete",
    );
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "retention: sweep failed",
    );
  }

  return result;
}

export function startTutorialRetentionInterval(
  db: DrizzleClient,
  mediaRoot: string,
  intervalMs = POLL_INTERVAL_MS,
): NodeJS.Timeout {
  const dryRun = process.env["TUTORIAL_RETENTION_ENABLED"] !== "true";
  const retentionDays = Number(
    process.env["TUTORIAL_RETENTION_DAYS"] ?? DEFAULT_RETENTION_DAYS,
  );
  const opts = {
    mediaRoot,
    dryRun,
    retentionDays: Number.isFinite(retentionDays)
      ? retentionDays
      : DEFAULT_RETENTION_DAYS,
  };

  void runRetentionSweepOnce(db, opts);
  return setInterval(() => {
    void runRetentionSweepOnce(db, opts);
  }, intervalMs);
}
