import { and, eq, inArray, sql } from "drizzle-orm";
import {
  storageArtifacts,
  storageArtifactVersions,
  type DrizzleClient,
  type NewStorageArtifact,
  type StorageArtifact,
  type StorageArtifactKind,
  type StorageUploadState,
} from "@repo/db";

/**
 * Persistence for storage artefact links.
 *
 * `db` is passed explicitly (the pattern used by the thumbnail repository)
 * rather than resolved from a singleton, so hub-web and the worker can each
 * supply their own client.
 */

export type EnsureArtifactInput = Pick<
  NewStorageArtifact,
  "job_id" | "kind" | "filename" | "vps_path"
> &
  Partial<
    Pick<
      NewStorageArtifact,
      | "channel_id"
      | "bytes"
      | "checksum_sha256"
      | "owner_kind"
      | "language"
      | "source_job_id"
    >
  >;

/**
 * Idempotent upsert on (job_id, kind).
 *
 * The conflict branch deliberately updates ONLY the local-path fields. It
 * must never reset `state`, `drive_file_id`, or the resumable session — a
 * second scanner pass over an already-uploaded artefact has to be a no-op.
 */
export async function ensureArtifactRow(
  db: DrizzleClient,
  data: EnsureArtifactInput,
): Promise<StorageArtifact> {
  const [row] = await db
    .insert(storageArtifacts)
    .values({ ...data, first_enqueued_at: new Date() })
    .onConflictDoUpdate({
      target: [storageArtifacts.job_id, storageArtifacts.kind],
      set: {
        vps_path: data.vps_path,
        filename: data.filename,
        updated_at: new Date(),
      },
    })
    .returning();

  if (row === undefined) {
    throw new Error(
      `ensureArtifactRow: upsert returned no row for job ${data.job_id} kind ${data.kind}`,
    );
  }
  return row;
}

export async function getArtifact(
  db: DrizzleClient,
  jobId: string,
  kind: StorageArtifactKind,
): Promise<StorageArtifact | undefined> {
  const [row] = await db
    .select()
    .from(storageArtifacts)
    .where(
      and(eq(storageArtifacts.job_id, jobId), eq(storageArtifacts.kind, kind)),
    )
    .limit(1);
  return row;
}

export async function getArtifactById(
  db: DrizzleClient,
  id: string,
): Promise<StorageArtifact | undefined> {
  const [row] = await db
    .select()
    .from(storageArtifacts)
    .where(eq(storageArtifacts.id, id))
    .limit(1);
  return row;
}

export async function listArtifactsForJob(
  db: DrizzleClient,
  jobId: string,
): Promise<StorageArtifact[]> {
  return db
    .select()
    .from(storageArtifacts)
    .where(eq(storageArtifacts.job_id, jobId));
}

export async function listArtifactsByState(
  db: DrizzleClient,
  states: StorageUploadState[],
  limit = 50,
): Promise<StorageArtifact[]> {
  return db
    .select()
    .from(storageArtifacts)
    .where(inArray(storageArtifacts.state, states))
    .limit(limit);
}

export async function markUploading(
  db: DrizzleClient,
  id: string,
): Promise<void> {
  await db
    .update(storageArtifacts)
    .set({
      state: "uploading",
      attempts: sql`${storageArtifacts.attempts} + 1`,
      upload_started_at: new Date(),
      last_attempt_at: new Date(),
      error_kind: null,
      error_message: null,
      updated_at: new Date(),
    })
    .where(eq(storageArtifacts.id, id));
}

export async function recordProgress(
  db: DrizzleClient,
  id: string,
  data: { resumable_session_uri: string; bytes_uploaded: number },
  sourceSha256?: string,
): Promise<void> {
  await db
    .update(storageArtifacts)
    .set({ ...data, updated_at: new Date() })
    .where(and(eq(storageArtifacts.id, id), sourceSha256 ? eq(storageArtifacts.checksum_sha256, sourceSha256) : undefined));
}

export async function markUploaded(
  db: DrizzleClient,
  id: string,
  data: {
    drive_file_id: string;
    drive_web_link: string | null;
    drive_folder_id: string;
    drive_folder_path: string;
    bytes: number;
    checksum_sha256: string | null;
    drive_md5?: string | null;
    /** Set when the post-upload MD5 was verified against the local file. */
    verified?: boolean;
  },
): Promise<void> {
  const { verified, ...rest } = data;
  await db.transaction(async (tx) => {
  const [current] = await tx.select().from(storageArtifacts).where(eq(storageArtifacts.id, id)).for("update");
  if (!current || (current.checksum_sha256 && current.checksum_sha256 !== data.checksum_sha256)) throw new Error("Storage source revision changed before Drive pointer commit; prior objects retained");
  const [updated] = await tx
    .update(storageArtifacts)
    .set({
      ...rest,
      state: "uploaded",
      uploaded_at: new Date(),
      verified_at: verified === true ? new Date() : null,
      bytes_uploaded: data.bytes,
      resumable_session_uri: null,
      error_kind: null,
      error_message: null,
      updated_at: new Date(),
    })
    .where(eq(storageArtifacts.id, id)).returning();
  if (updated?.drive_file_id) await tx.insert(storageArtifactVersions).values({ artifact_id: updated.id, drive_file_id: updated.drive_file_id, vps_path: updated.vps_path, bytes: updated.bytes, checksum_sha256: updated.checksum_sha256, drive_md5: updated.drive_md5, verified_at: updated.verified_at }).onConflictDoNothing();
  });
}

/** Persist old identity before any local-path or current-pointer replacement. */
export async function archiveArtifactVersion(db: DrizzleClient, row: StorageArtifact): Promise<void> {
  if (!row.drive_file_id) return;
  await db.insert(storageArtifactVersions).values({ artifact_id: row.id, drive_file_id: row.drive_file_id, vps_path: row.vps_path, bytes: row.bytes, checksum_sha256: row.checksum_sha256, drive_md5: row.drive_md5, verified_at: row.verified_at }).onConflictDoNothing();
}

export async function recordSourceRevision(db: DrizzleClient, id: string, source: { vps_path: string; bytes: number; checksum_sha256: string; preserveSession: boolean }) {
  await db.update(storageArtifacts).set({ vps_path: source.vps_path, bytes: source.bytes, checksum_sha256: source.checksum_sha256, verified_at: null,
    ...(source.preserveSession ? {} : { resumable_session_uri: null, bytes_uploaded: 0 }), updated_at: new Date(),
  }).where(eq(storageArtifacts.id, id));
}

/**
 * Park an artefact back to `pending` because today's byte budget is spent.
 * This is a VISIBLE, explained pause — the next pass on a fresh day picks it
 * up again. Never a silent stall.
 */
export async function markBudgetDeferred(
  db: DrizzleClient,
  id: string,
  reason: string,
): Promise<void> {
  await db
    .update(storageArtifacts)
    .set({
      state: "pending",
      error_kind: "daily_budget_exhausted",
      error_message: reason.slice(0, 2000),
      last_attempt_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(storageArtifacts.id, id));
}

export async function markFailed(
  db: DrizzleClient,
  id: string,
  error: { kind: string; message: string },
): Promise<void> {
  await db
    .update(storageArtifacts)
    .set({
      state: "failed",
      error_kind: error.kind,
      // Keep the row readable in psql / the UI; the full text is in the logs.
      error_message: error.message.slice(0, 2000),
      last_attempt_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(storageArtifacts.id, id));
}

export async function markSkipped(
  db: DrizzleClient,
  id: string,
  reason: string,
): Promise<void> {
  await db
    .update(storageArtifacts)
    .set({
      state: "skipped",
      error_kind: "skipped",
      error_message: reason.slice(0, 2000),
      last_attempt_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(storageArtifacts.id, id));
}

/**
 * Record that an artefact's Drive copy has been deliberately deleted.
 *
 * `drive_file_id` is cleared because it is the field every other part of the
 * system uses to answer "is this in Drive?" — the retention sweep gates local
 * deletion on it, and leaving a stale id there would let the sweep remove the
 * last local copy of a video whose Drive copy no longer exists.
 */
export async function markDeletedFromDrive(
  db: DrizzleClient,
  id: string,
  reason: string,
): Promise<void> {
  await db
    .update(storageArtifacts)
    .set({
      drive_file_id: null,
      state: "skipped",
      error_kind: "skipped",
      error_message: reason.slice(0, 2000),
      updated_at: new Date(),
    })
    .where(eq(storageArtifacts.id, id));
}

/** Reset a failed artefact so the scanner picks it up again. */
export async function resetForRetry(
  db: DrizzleClient,
  id: string,
): Promise<void> {
  await db
    .update(storageArtifacts)
    .set({
      state: "pending",
      error_kind: null,
      error_message: null,
      updated_at: new Date(),
    })
    .where(eq(storageArtifacts.id, id));
}
