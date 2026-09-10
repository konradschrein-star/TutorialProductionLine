/** Isolated database/HTTP only; no files, providers, workers or external uploads. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { signToken } from "../apps/hub-web/src/lib/auth/jwt";
const url = process.env.DATABASE_URL ?? "";
if (url !== "postgresql://recovery:local-test-only@127.0.0.1:55438/tutorial_recovery_test" || process.env.JWT_SECRET !== "local-recovery-test-secret-not-for-production-2026") throw new Error("Isolated recovery runtime only");
const sql = postgres(url, { max: 1 });
const marker = `Delivery search ${randomUUID()}`;
try {
  const [owner] = await sql`SELECT id FROM users WHERE email='va@recovery.test'`;
  const [other] = await sql`SELECT id FROM users WHERE email='other@recovery.test'`;
  const va = await signToken({ userId: owner!.id, email: "va@recovery.test", role: "TUTORIAL_VA" });
  const otherVa = await signToken({ userId: other!.id, email: "other@recovery.test", role: "TUTORIAL_VA" });
  await sql`INSERT INTO tutorial_jobs(created_by,title,mode,status,script_provider,tts_provider,tts_voice,language,completed_at)
    SELECT ${owner!.id},${marker} || ' ' || n,'THREE_MIN','COMPLETED','test','test','test','en', timestamptz '2030-01-01 12:00:00.123000+00' + n * interval '1 microsecond' FROM generate_series(1,63) n`;
  const list = (params: Record<string, string>, token = va) => fetch(`http://127.0.0.1:3108/api/production/uploads?${new URLSearchParams(params)}`, { headers: { Cookie: `hub_session=${token}` } });
  const firstResponse = await list({ q: marker }); assert.equal(firstResponse.status, 200, await firstResponse.clone().text());
  const first = await firstResponse.json(); assert.equal(first.videos.length, 60); assert(first.nextCursor);
  assert.match(first.nextCursor.beforeAt, /\.\d{6}Z$/);
  const second = await (await list({ q: marker, ...first.nextCursor })).json(); assert.equal(second.videos.length, 3); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.videos, ...second.videos].map((row) => row.id)).size, 63);
  const parentId = second.videos[0].id;
  await sql`UPDATE tutorial_jobs SET keyword_ref=${`${marker} keyword reference`}, is_uploaded=true WHERE id=${parentId}`;
  await sql`INSERT INTO tutorial_jobs(created_by,source_job_id,title,mode,status,script_provider,tts_provider,tts_voice,language) VALUES (${owner!.id},${parentId},${`${marker} localized needle`},'THREE_MIN','FAILED_AUDIO','test','test','test','de')`;
  for (const q of [`${marker} keyword reference`, `${marker} localized needle`]) {
    const result = await (await list({ q })).json(); assert.deepEqual(result.videos.map((row: { id: string }) => row.id), [parentId]);
  }
  const uploaded = await (await list({ q: marker, filter: "UPLOADED" })).json(); assert.deepEqual(uploaded.videos.map((row: { id: string }) => row.id), [parentId]);
  const forbidden = await (await list({ q: marker }, otherVa)).json(); assert.equal(forbidden.videos.length, 0);
  assert.equal((await list({ beforeId: parentId })).status, 400);
  assert.equal((await list({ filter: "anything" })).status, 400);
  const literal = await (await list({ q: `${marker}%` })).json(); assert.equal(literal.videos.length, 0);
  console.log(JSON.stringify({ keysetPages: [60, 3], microsecondBoundaryPreserved: true, noDuplicatesOrMissingRows: true, fullArchiveKeywordSearch: true, localeTitleSearch: true, serverSideFilter: true, ownerScope: true, malformedCursorRejected: true, wildcardsLiteral: true, externalCalls: 0 }));
} finally { await sql.end(); }
