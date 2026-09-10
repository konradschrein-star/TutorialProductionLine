/** One-shot, explicitly guarded Omar thumbnail reset. Keep upload receipts. */
import { createDrizzleClient, sql } from "../../packages/db/src/index.js";
import { ArtifactStore } from "../../packages/storage/src/index.js";

const confirmation = process.env["OMAR_THUMBNAIL_RESET_CONFIRM"];
if (confirmation !== "DELETE_AND_REGENERATE_OMAR_THUMBNAILS_20260909") {
  throw new Error("Exact Omar thumbnail reset confirmation is required");
}
const databaseUrl = process.env["DATABASE_URL"];
const databaseName = databaseUrl
  ? decodeURIComponent(new URL(databaseUrl).pathname.slice(1))
  : "missing";
if (!databaseUrl || databaseName !== "tutorial_studio") {
  throw new Error(`Refusing to operate outside the Omar tutorial_studio database (received ${databaseName})`);
}

const db = createDrizzleClient(databaseUrl, { max: 2, statementTimeoutMs: 120_000 });
const artifacts = await db.execute(sql<{
  id: string;
  job_id: string;
  drive_file_id: string | null;
}>`SELECT id, job_id, drive_file_id FROM storage_artifacts WHERE kind = 'thumbnail' ORDER BY created_at`);

const storage = await ArtifactStore.createFromDatabase(db);
if (!storage.ok && artifacts.some((artifact) => artifact.drive_file_id)) {
  throw new Error(`Drive is unavailable; no database rows were changed: ${storage.reason}`);
}

let driveDeleted = 0;
const driveFailures: string[] = [];
if (storage.ok) {
  for (const artifact of artifacts) {
    if (!artifact.drive_file_id) continue;
    if (await storage.store.deleteArtifactFromDrive(artifact.id)) driveDeleted += 1;
    else driveFailures.push(artifact.id);
  }
}
if (driveFailures.length) {
  throw new Error(`Drive deletion failed for ${driveFailures.length} artifacts; database thumbnail reset was not started`);
}

const result = await db.transaction(async (tx) => {
  await tx.execute(sql`DELETE FROM tutorial_thumbnail_fanout`);
  await tx.execute(sql`DELETE FROM tutorial_thumbnail_ai_batches`);
  await tx.execute(sql`DELETE FROM tutorial_thumbnail_drafts`);
  const deleted = await tx.execute(sql<{ id: string }>`
    DELETE FROM thumbnails
    WHERE NOT EXISTS (
      SELECT 1 FROM tutorial_upload_dispatches dispatch
      WHERE dispatch.thumbnail_id = thumbnails.id
    )
    RETURNING id
  `);
  const preserved = await tx.execute(sql<{ id: string }>`
    UPDATE thumbnails
    SET is_selected = false, updated_at = NOW()
    WHERE EXISTS (
      SELECT 1 FROM tutorial_upload_dispatches dispatch
      WHERE dispatch.thumbnail_id = thumbnails.id
    )
    RETURNING id
  `);
  const unapproved = await tx.execute(sql<{ id: string }>`
    UPDATE tutorial_jobs
    SET va_review_status = NULL,
        va_reviewed_at = NULL,
        va_reviewed_by = NULL,
        publication_approval = NULL,
        updated_at = NOW()
    WHERE va_review_status IS NOT NULL
       OR va_reviewed_at IS NOT NULL
       OR va_reviewed_by IS NOT NULL
       OR publication_approval IS NOT NULL
    RETURNING id
  `);
  return { deleted: deleted.length, preserved: preserved.length, unapproved: unapproved.length };
});

console.log(JSON.stringify({
  complete: true,
  driveArtifacts: artifacts.length,
  driveDeleted,
  ...result,
  note: "Referenced thumbnail rows are retained only as immutable uploader-receipt evidence and are no longer selected.",
}));
process.exit(0);
