/** Actual loopback browser API -> KT intent -> Studio API -> ordered KT callback.
 * Does not start workers. Completion is a synthetic transition, not a rendered video.
 * The first browser ACK is deliberately discarded; underlying services use real HTTP.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { signToken } from "../apps/hub-web/src/lib/auth/jwt";
import { createDrizzleClient } from "../packages/db/dist/index.js";
import { deliverKeywordMilestone } from "../apps/worker-orchestrator/src/services/keyword-outbox";

const database = process.env.DATABASE_URL;
if (database !== "postgresql://recovery:local-test-only@127.0.0.1:55438/tutorial_recovery_test" ||
  process.env.JWT_SECRET !== "local-recovery-test-secret-not-for-production-2026" || process.env.RECOVERY_NO_WORKERS !== "true") {
  throw new Error("Explicit synthetic database, JWT and no-workers assertion required");
}
const hub = "http://127.0.0.1:3108";
const kt = "http://127.0.0.1:17877";
const fixtureScript = "C:/Users/konra/AppData/Local/Temp/keyword-live-recovery-82957784c49447849cbff7d0a1c16669/scripts/bridge_fixture.py";
const fixture = (seed = false) => {
  const output = spawnSync("C:/Python314/python.exe", [fixtureScript, ...(seed ? ["--seed"] : [])], { encoding: "utf8" });
  assert.equal(output.status, 0, "Synthetic fixture helper must succeed");
  return JSON.parse(output.stdout) as { status: string; owner_matches: boolean; job_id: string | null; intent_count: number; intent_state: string; attempts: number; frozen_channel: string; frozen_title_matches: boolean; credited_total: number };
};
const sql = postgres(database, { max: 1 });
const db = createDrizzleClient(database, { idleTimeoutSeconds: 1 });
try {
  const [va] = await sql`SELECT id,default_tutorial_channel_id FROM users WHERE email='va@recovery.test' AND is_active=true`;
  assert(va?.default_tutorial_channel_id, "Synthetic producer must have an explicit saved destination");
  const [channel] = await sql`SELECT id,language FROM channels WHERE id=${va.default_tutorial_channel_id}`;
  assert(channel);
  const cookie = `hub_session=${await signToken({ userId: va.id, email: "va@recovery.test", role: "TUTORIAL_VA" })}`;
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ email: "va@recovery.test", role: "TUTORIAL_VA", exp: Math.floor(Date.now() / 1000) + 120 })).toString("base64url");
  const token = `${header}.${body}.${createHmac("sha256", "local-kt-studio-embed-sso-2026-test-only").update(`${header}.${body}`).digest("base64url")}`;
  const sso = await fetch(`${kt}/api/integration/forge/embed-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), redirect: "error" });
  assert.equal(sso.status, 200);
  const session = await sso.json() as { token: string; user: { id: number } }; assert.equal(session.user.id, 201);
  const snapshot = fixture(true);
  if (snapshot.status === "NEW") {
    const claim = await fetch(`${kt}/api/v5/keywords/910206/claim`, { method: "POST", headers: { Authorization: `Bearer ${session.token}` }, redirect: "error" });
    assert.equal(claim.status, 200, "Actual KT claim must succeed");
  }
  assert.equal(fixture().owner_matches, true);
  const payload = { keyword_ref: "910206", title: "Synthetic browser bridge settings", channel_id: channel.id,
    language: channel.language, mode: "THREE_MIN", steps_input: "Open settings and inspect the account menu.", source_mode: "FROM_SCRATCH" };
  const send = (overrides: Record<string, unknown> = {}) => fetch(`${hub}/api/production/jobs`, {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, ...overrides }), redirect: "error", signal: AbortSignal.timeout(60_000),
  });
  assert.equal((await send({ keyword_ref: "204" })).status, 403, "Other producer claim rejected");
  assert.equal((await send({ channel_id: "00000000-0000-4000-8000-000000000999" })).status, 403, "Unassigned destination rejected");
  const [lostAck, concurrent] = await Promise.all([send(), send()]);
  assert([200, 503].includes(lostAck.status) && [200, 503].includes(concurrent.status), "Parallel requests are confirmed or retained, never duplicated");
  // Deliberately discard both response bodies: this models a lost browser ACK,
  // not a simulated provider or a fabricated downstream HTTP response.
  await lostAck.arrayBuffer(); await concurrent.arrayBuffer();
  const retry = await send();
  assert.equal(retry.status, 200, "Retry should confirm the saved request");
  const receipt = await retry.json() as { jobId: string };
  let state = fixture();
  assert.equal(state.intent_count, 1); assert.equal(state.intent_state, "confirmed"); assert.equal(state.job_id, receipt.jobId);
  assert.equal(state.frozen_channel, channel.id); assert.equal(state.frozen_title_matches, true);
  const [count] = await sql`SELECT count(*)::int n FROM tutorial_jobs WHERE keyword_ref='910206' AND source_job_id IS NULL`;
  assert.equal(count!.n, 1);
  const [job] = await sql`SELECT created_by,channel_id,script_provider,tts_provider,tts_voice,prompt_preset_id FROM tutorial_jobs WHERE id=${receipt.jobId}`;
  assert.equal(job!.created_by, va.id); assert.equal(job!.channel_id, channel.id);
  const [recipe] = await sql`SELECT default_script_provider,default_tts_provider,default_tts_voice FROM tutorial_settings LIMIT 1`;
  assert(recipe);
  assert.equal(job!.script_provider, recipe.default_script_provider);
  assert.equal(job!.tts_provider, recipe.default_tts_provider);
  assert.equal(job!.tts_voice, recipe.default_tts_voice);
  assert(job!.prompt_preset_id, "Studio must bind its configured preset");
  const mine = await fetch(`${hub}/api/production/keywords/mine?includeDone=1`, { headers: { Cookie: cookie } });
  assert.equal(mine.status, 200);
  const view = await mine.json() as { keywords: Array<{ id: number; job: { id: string; status: string } | null }> };
  assert.equal(view.keywords.find((keyword) => keyword.id === 910206)?.job?.id, receipt.jobId);
  const receiver = `${kt}/api/integration/forge/job-status`;
  const secret = "local-kt-studio-webhook-2026";
  for (let i = 0; i < 30; i++) {
    const result = await deliverKeywordMilestone(db, { url: receiver, secret, jobId: receipt.jobId });
    if (!result.pending) break;
    assert(result.delivered);
  }
  await sql`UPDATE tutorial_jobs SET status='COMPLETED',completed_at=now() WHERE id=${receipt.jobId} AND keyword_ref='910206'`;
  const completion = await deliverKeywordMilestone(db, { url: receiver, secret, jobId: receipt.jobId });
  assert(completion.delivered || state.status === 'UPLOADED', "Synthetic completion delivered or already verified on replay");
  state = fixture(); assert.equal(state.status, "UPLOADED");
  const [event] = await sql`SELECT payload FROM tutorial_keyword_outbox WHERE tutorial_job_id=${receipt.jobId} ORDER BY event_sequence DESC LIMIT 1`;
  const replay = await fetch(receiver, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify(event!.payload), redirect: "error" });
  assert.equal(replay.status, 200); assert.equal((await replay.json() as { verified: boolean }).verified, true);
  assert.equal(fixture().credited_total, state.credited_total, "Replay must not double-credit VA");
  console.log(JSON.stringify({ actualLocalHttp: true, browserAcknowledgementDiscarded: true, originalJobs: 1, boundIntents: 1,
    ownerRejected: true, channelRejected: true, workspaceRecipePreserved: true, completionProjected: true, duplicateCreditPrevented: true,
    renderedVideoProduced: false, paidProviderCalls: 0, publicUploads: 0, embeddedFrontendVerified: false }));
} finally { await sql.end(); }
