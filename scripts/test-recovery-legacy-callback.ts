/** Real HTTP/DB test. Ephemeral dummy callback credential; no external service. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createDrizzleClient, setSecret, clearSecret } from "../packages/db/dist/index.js";
const url = process.env.DATABASE_URL ?? "";
if (url !== "postgresql://recovery:local-test-only@127.0.0.1:55438/tutorial_recovery_test" || process.env.SECRETS_ENCRYPTION_KEY !== Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString("base64")) throw new Error("Isolated recovery runtime only");
const sql = postgres(url, { max: 1 }); const database = createDrizzleClient(url);
const id = randomUUID(); const token = `local-callback-probe-${randomUUID()}`;
let createdSecret = false;
try {
  const existing = await sql`SELECT name FROM encrypted_secrets WHERE name='UPLOADER_CALLBACK_SECRET'`;
  assert.equal(existing.length, 0, "Never replace an existing credential");
  const [owner] = await sql`SELECT id FROM users WHERE email='admin@recovery.test'`;
  await setSecret(database, { name: "UPLOADER_CALLBACK_SECRET", value: token, userId: owner!.id, description: "Ephemeral isolated callback probe" }); createdSecret = true;
  await sql`INSERT INTO tutorial_jobs(id,created_by,title,mode,status,script_provider,tts_provider,tts_voice,language,scheduled_for) VALUES(${id},${owner!.id},'Legacy callback observation test','THREE_MIN','COMPLETED','test','test','test','en','2030-01-01T08:00:00Z')`;
  const body = { eventId: "probe-event-1", jobId: id, status: "uploaded", visibility: "public", youtubeVideoId: "abcdefghijk", occurredAt: "2026-09-08T12:00:00Z", scheduledFor: "2030-02-01T08:00:00Z" };
  const call = (event = body, credential = token) => fetch("http://127.0.0.1:3108/api/production/uploader-status", { method: "POST", headers: { authorization: `Bearer ${credential}`, "Content-Type": "application/json" }, body: JSON.stringify(event) });
  assert.equal((await call(body, "wrong")).status, 401);
  const results = await Promise.all(Array.from({ length: 6 }, () => call()));
  assert.equal(results.filter((response) => response.status === 202).length, 1);
  assert.equal(results.filter((response) => response.status === 200).length, 5);
  for (const response of results) assert.equal((await response.json()).verified, false);
  assert.equal((await call({ ...body, eventId: "probe-event-2", status: "failed" })).status, 202);
  const oldDuplicate = await call(); assert.equal(oldDuplicate.status, 200); assert.equal((await oldDuplicate.json()).duplicate, true);
  assert.equal((await call({ ...body, status: "failed" })).status, 409);
  const [job] = await sql`SELECT scheduled_for,youtube_visibility,youtube_published_at,upload_verified_at,is_uploaded,uploader_status FROM tutorial_jobs WHERE id=${id}`;
  assert.equal(job!.scheduled_for.toISOString(), "2030-01-01T08:00:00.000Z");
  for (const field of ["youtube_visibility", "youtube_published_at", "upload_verified_at", "uploader_status"]) assert.equal(job![field], null);
  assert.equal(job!.is_uploaded, false);
  const [events] = await sql`SELECT count(*)::int AS count FROM tutorial_job_events WHERE tutorial_job_id=${id} AND event_type='external_observation'`;
  assert.equal(events!.count, 2);
  console.log(JSON.stringify({ concurrentCallbacks: 6, oneObservation: true, oldDuplicateAfterLaterEventSuppressed: true, conflictingEventIdRejected: true, approvedPublicationFieldsUntouched: true, studioSlotUnchanged: true, verifiedFalse: true, externalCalls: 0 }));
} finally {
  if (createdSecret) await clearSecret(database, "UPLOADER_CALLBACK_SECRET");
  await sql.end();
}
process.exit(0);
