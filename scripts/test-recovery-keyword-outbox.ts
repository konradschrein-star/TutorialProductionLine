import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createDrizzleClient } from "../packages/db/dist/index.js";
import { deliverKeywordMilestone } from "../apps/worker-orchestrator/src/services/keyword-outbox";
const url = process.env.DATABASE_URL;
if (url !== "postgresql://recovery:local-test-only@127.0.0.1:55438/tutorial_recovery_test") throw new Error("Only isolated recovery DB allowed");
const client = postgres(url); const db = createDrizzleClient(url);
const id = randomUUID(); const ref = `test-outbox-${id}`;
const [owner] = await client`SELECT id FROM users WHERE email='va@recovery.test'`;
assert(owner);
await client`INSERT INTO tutorial_jobs(id,created_by,title,keyword_ref,mode,status,script_provider,tts_provider,tts_voice) VALUES(${id},${owner.id},'Outbox test',${ref},'THREE_MIN','QUEUED','test','test','test')`;
try {
  await Promise.all(Array.from({ length: 6 }, (_, index) => client.begin(async (tx) => {
    await tx`SELECT id FROM tutorial_jobs WHERE id=${id} FOR UPDATE`;
    await tx`UPDATE tutorial_jobs SET status=${index % 2 ? 'GENERATING_AUDIO' : 'GENERATING_SCRIPT'}::tutorial_job_status WHERE id=${id}`;
  })));
  const events = await client`SELECT * FROM tutorial_keyword_outbox WHERE tutorial_job_id=${id} ORDER BY event_sequence`;
  assert(events.length >= 2);
  assert.deepEqual(events.map((row) => row.event_sequence), events.map((_, index) => index + 1));
  await assert.rejects(client.begin(async (tx) => { await tx`UPDATE tutorial_jobs SET status='COMPLETED' WHERE id=${id}`; throw new Error("rollback"); }));
  assert.equal((await client`SELECT count(*)::int AS n FROM tutorial_keyword_outbox WHERE tutorial_job_id=${id}`)[0].n, events.length);
  // Keep this probe isolated from earlier retained probe events.
  const existing = await client`SELECT count(*)::int AS n FROM tutorial_keyword_outbox WHERE tutorial_job_id<>${id} AND delivered_at IS NULL AND available_at<=now()`;
  assert.equal(existing[0].n, 0, "Other pending events exist; do not consume unrelated test work");
  let calls = 0;
  const failed = await deliverKeywordMilestone(db, { url: "https://keyword.invalid/status", secret: "test", fetch: (async () => { calls++; return new Response("", { status: 503 }); }) as typeof fetch });
  assert.equal(failed.delivered, false); assert.equal(calls, 1);
  const blocked = await deliverKeywordMilestone(db, { url: "https://keyword.invalid/status", secret: "test", fetch: (async () => { throw new Error("Must not skip earlier failed event"); }) as typeof fetch });
  assert.equal(blocked.pending, false);
  await client`UPDATE tutorial_keyword_outbox SET available_at=now() WHERE tutorial_job_id=${id}`;
  const delivered: number[] = [];
  const receiver = (async (_url: unknown, options: RequestInit) => {
    const payload = JSON.parse(options.body as string); assert.equal(payload.forge_job_id, id); assert.equal(payload.keyword_ref, ref);
    assert.equal((options.headers as Record<string,string>).Authorization, "Bearer test");
    delivered.push(payload.event_sequence); return Response.json({ verified: true, forge_job_id: payload.forge_job_id, keyword_ref: payload.keyword_ref, event_sequence: payload.event_sequence, dedup_key: payload.dedup_key });
  }) as typeof fetch;
  for (let index = 0; index < events.length; index++) await Promise.all([deliverKeywordMilestone(db, { url: "https://keyword.invalid/status", secret: "test", fetch: receiver }), deliverKeywordMilestone(db, { url: "https://keyword.invalid/status", secret: "test", fetch: receiver })]);
  assert.deepEqual(delivered, events.map((row) => row.event_sequence));
  console.log(JSON.stringify({ concurrentTransitions: true, rollbackAtomic: true, outagePreserved: true, orderedRetries: true, competingConsumers: true, externalCalls: 0 }));
} finally {
  // Retain the synthetic job for inspection but not externally deliverable work.
  await client`UPDATE tutorial_keyword_outbox SET delivered_at=now(),last_error='Local test only' WHERE tutorial_job_id=${id}`;
  await client.end();
}
process.exit(0);
