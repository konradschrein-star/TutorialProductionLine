/** Drain the selected tutorial-thumbnail Drive backlog in bounded passes. */
import { createDrizzleClient } from "@repo/db";
import { ArtifactStore } from "@repo/storage";
import { runTutorialScanOnce } from "../storage/tutorial-drive-scanner.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const db = createDrizzleClient(databaseUrl, { max: 4, statementTimeoutMs: 120_000 });
const created = await ArtifactStore.createFromDatabase(db);
if (!created.ok) throw new Error(`Drive is unavailable: ${created.reason}`);

let uploaded = 0;
let failed = 0;
let skipped = 0;
for (let pass = 1; pass <= 20; pass += 1) {
  const result = await runTutorialScanOnce(db, created.store, {
    batchSize: 100,
    mediaRoot: process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media",
    maxAttemptsPerArtifact: 5,
  });
  uploaded += result.uploaded;
  failed += result.failed;
  skipped += result.skipped;
  console.log(JSON.stringify({ pass, ...result, cumulative: { uploaded, failed, skipped } }));
  if (result.jobs === 0 && result.uploaded === 0) break;
}
console.log(JSON.stringify({ complete: failed === 0, uploaded, failed, skipped }));
process.exit(failed ? 1 : 0);
