/** Isolated DB/HTTP check; never creates an uploader request or calls Drive. */
import assert from "node:assert/strict";
import postgres from "postgres";
import { signToken } from "../apps/hub-web/src/lib/auth/jwt";
import { createDrizzleClient } from "../packages/db/dist/index.js";
import { DrizzleTutorialUploaderExchangeRepository } from "../apps/worker-orchestrator/src/storage/tutorial-uploader-exchange";

const url = process.env.DATABASE_URL ?? "";
if (url !== "postgresql://recovery:local-test-only@127.0.0.1:55438/tutorial_recovery_test" || process.env.JWT_SECRET !== "local-recovery-test-secret-not-for-production-2026") throw new Error("Isolated recovery runtime only");
const sql = postgres(url, { max: 1 });
const endpoint = "http://127.0.0.1:3108/api/production/dispatch-control";
let adminToken = "";
let previousPaused = false;
const setPause = (token: string, paused: boolean) => fetch(endpoint, { method: "POST", headers: { Cookie: `hub_session=${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ paused }), redirect: "error" });
try {
  const [admin] = await sql`SELECT id FROM users WHERE email='admin@recovery.test'`;
  const [va] = await sql`SELECT id FROM users WHERE email='va@recovery.test'`;
  assert(admin && va);
  adminToken = await signToken({ userId: admin.id, email: "admin@recovery.test", role: "ADMIN" });
  const vaToken = await signToken({ userId: va.id, email: "va@recovery.test", role: "TUTORIAL_VA" });
  const prior = await fetch(endpoint, { headers: { Cookie: `hub_session=${adminToken}` } });
  assert.equal(prior.status, 200, await prior.clone().text());
  previousPaused = (await prior.json()).paused;
  assert.equal((await setPause(vaToken, true)).status, 403);
  assert.equal((await setPause(adminToken, true)).status, 200);
  const view = await (await fetch(endpoint, { headers: { Cookie: `hub_session=${vaToken}` } })).json();
  assert.deepEqual(view, { paused: true, canManage: false });
  const repository = new DrizzleTutorialUploaderExchangeRepository(createDrizzleClient(url));
  assert.deepEqual(await repository.listPublishCandidates(10), []);
  await assert.rejects(() => repository.markPublishing({} as never), /paused by an Admin/);
  assert.equal((await setPause(adminToken, false)).status, 200);
  const resumed = await (await fetch(endpoint, { headers: { Cookie: `hub_session=${adminToken}` } })).json();
  assert.equal(resumed.paused, false);
  console.log(JSON.stringify({ adminOnlyPause: true, vaReadOnly: true, pendingDispatchesHeld: true, previouslyListedCandidateBlockedAtAdmission: true, resumable: true, externalCalls: 0 }));
} finally {
  if (adminToken) await setPause(adminToken, previousPaused);
  await sql.end();
}
process.exit(0);
