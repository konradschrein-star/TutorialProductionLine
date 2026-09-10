/** Synthetic archive/routing probe. No source DB, hashes or personal data. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import {
  createDrizzleClient,
  prepareLegacyTutorialArchive,
} from "../packages/db/dist/index.js";
const url = process.env.DATABASE_URL;
if (
  url !==
  "postgresql://recovery:local-test-only@127.0.0.1:55438/tutorial_recovery_test"
)
  throw new Error("Isolated database only");
const sql = postgres(url, { max: 4 });
const db = createDrizzleClient(url);
const jobId = randomUUID();
const ownerId = randomUUID();
const channelId = randomUUID();
try {
  await sql.unsafe(
    await readFile(
      "../../packages/db/src/migrations/0098_tutorial_legacy_archive.sql",
      "utf8",
    ),
  );
  const { routeLegacyArchive } =
    await import("../apps/hub-web/src/lib/tutorial/legacy-archive-routing");
  const [admin] =
    await sql`SELECT id FROM users WHERE email='admin@recovery.test'`;
  assert(admin);
  await sql`INSERT INTO users(id,email,name,role,password_hash,is_active) VALUES(${ownerId},${`archive-${ownerId}@recovery.test`},'Synthetic archive producer','TUTORIAL_VA','not-a-real-login-hash',true)`;
  await sql`INSERT INTO channels(id,youtube_channel_id,name,language,accepts_tutorials,is_primary,metadata) VALUES(${channelId},${`UC_${randomUUID()}`},'Synthetic archive destination','en',true,true,${sql.json({ tutorialProducerIds: [ownerId] })})`;
  await sql`INSERT INTO tutorial_jobs(id,created_by,title,mode,status,script_provider,tts_provider,tts_voice,language) VALUES(${jobId},${ownerId},'Synthetic unmapped recording','THREE_MIN','READY_TO_RECORD','test','test','test','en')`;
  const raw = JSON.stringify({
    id: jobId,
    created_by: ownerId,
    channel_id: null,
    title: "Synthetic unmapped recording",
    status: "READY_TO_RECORD",
    language: "English",
    intro_config: { nested: ["preserve"] },
    va_review_status: "approved",
  });
  const plan = prepareLegacyTutorialArchive({
    sourceSystem: "synthetic_cf",
    sourceTable: "tutorial_jobs",
    sourceJSON: raw,
    knownUserIds: new Set([ownerId]),
  });
  assert.equal(plan.source_json, raw);
  assert.equal(plan.needs_routing, true);
  const [archive] =
    await sql`INSERT INTO tutorial_legacy_archive ${sql({ ...plan, runtime_job_id: jobId })} RETURNING id`;
  assert(archive);
  const [saved] =
    await sql`SELECT source_json FROM tutorial_legacy_archive WHERE id=${archive.id}`;
  assert.equal(saved!.source_json, raw);
  await assert.rejects(
    sql`UPDATE tutorial_legacy_archive SET source_json='{}' WHERE id=${archive.id}`,
    /immutable/,
  );
  await assert.rejects(
    sql`DELETE FROM tutorial_legacy_archive WHERE id=${archive.id}`,
    /immutable/,
  );
  assert.throws(
    () =>
      prepareLegacyTutorialArchive({
        sourceSystem: "synthetic_cf",
        sourceTable: "tutorial_jobs",
        sourceJSON: JSON.stringify({
          ...JSON.parse(raw),
          nested: [{ password_hash: "forbidden" }],
        }),
        knownUserIds: new Set([ownerId]),
      }),
    /forbidden/,
  );
  await assert.rejects(
    sql`INSERT INTO tutorial_legacy_archive ${sql({ ...plan, source_id: randomUUID(), source_json: JSON.stringify({ credentials: { value: "forbidden" } }) })}`,
    /check constraint/,
  );
  await assert.rejects(
    sql`INSERT INTO tutorial_legacy_archive ${sql({ ...plan, source_id: randomUUID(), source_table: "users" })}`,
    /check constraint/,
  );
  await assert.rejects(
    routeLegacyArchive(
      db,
      archive.id,
      channelId,
      ownerId,
      "Synthetic explicit routing",
    ),
    /Admin access/,
  );
  const invalidChannel = randomUUID();
  await sql`INSERT INTO channels(id,youtube_channel_id,name,language,accepts_tutorials,is_primary,metadata) VALUES(${invalidChannel},${`UC_${randomUUID()}`},'Unassigned synthetic channel','en',true,true,'{}')`;
  await assert.rejects(
    routeLegacyArchive(
      db,
      archive.id,
      invalidChannel,
      admin.id,
      "Synthetic explicit routing",
    ),
    /assigned to this active producer/,
  );
  const attempts = await Promise.all(
    Array.from({ length: 4 }, () =>
      routeLegacyArchive(
        db,
        archive.id,
        channelId,
        admin.id,
        "Synthetic explicit routing",
      ),
    ),
  );
  assert.equal(attempts.filter((attempt) => !attempt.idempotent).length, 1);
  assert(attempts.every((attempt) => attempt.enqueued === false));
  const [runtime] =
    await sql`SELECT channel_id,status,publication_approval,scheduled_for,is_uploaded FROM tutorial_jobs WHERE id=${jobId}`;
  assert.equal(runtime!.channel_id, channelId);
  assert.equal(runtime!.status, "READY_TO_RECORD");
  assert.equal(runtime!.publication_approval, null);
  assert.equal(runtime!.scheduled_for, null);
  assert.equal(runtime!.is_uploaded, false);
  const [events] =
    await sql`SELECT count(*)::int AS count FROM tutorial_legacy_archive_events WHERE archive_id=${archive.id}`;
  assert.equal(events!.count, 1);
  await assert.rejects(
    sql`UPDATE tutorial_legacy_archive_events SET event_type='changed' WHERE archive_id=${archive.id}`,
    /append-only/,
  );
  const archivedOnlyId = randomUUID();
  const archiveOnly = prepareLegacyTutorialArchive({
    sourceSystem: "synthetic_cf",
    sourceTable: "tutorial_jobs",
    sourceJSON: JSON.stringify({ ...JSON.parse(raw), id: archivedOnlyId }),
    knownUserIds: new Set([ownerId]),
  });
  const [only] =
    await sql`INSERT INTO tutorial_legacy_archive ${sql(archiveOnly)} RETURNING id`;
  const assignedOnly = await routeLegacyArchive(
    db,
    only!.id,
    channelId,
    admin.id,
    "Assign source for later migration",
  );
  assert.equal(assignedOnly.runtimeUpdated, false);
  assert.equal(assignedOnly.enqueued, false);
  const [created] =
    await sql`SELECT count(*)::int AS count FROM tutorial_jobs WHERE id=${archivedOnlyId}`;
  assert.equal(created!.count, 0);
  console.log(
    JSON.stringify({
      syntheticOnly: true,
      immutableRawBytes: true,
      credentialKeysRejectedJSAndDB: true,
      tableAllowlist: true,
      adminOnlyRouting: true,
      assignedChannelRequired: true,
      concurrentRouting: 4,
      oneAuditEvent: true,
      runtimeStatusUnchanged: true,
      noFabricatedApproval: true,
      archiveOnlyDoesNotCreateJob: true,
      enqueued: false,
      sourceCalls: 0,
    }),
  );
} finally {
  await sql.end();
}
process.exit(0);
