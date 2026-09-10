import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createDrizzleClient, createOrReuseTutorialJob } from "../packages/db/dist/index.js";
import { dispatchTutorialGeneration } from "../apps/worker-orchestrator/src/services/tutorial-generation-outbox.js";
import { deliverKeywordMilestone } from "../apps/worker-orchestrator/src/services/keyword-outbox.js";

const url = process.env.DATABASE_URL;
if (url !== "postgresql://recovery:local-test-only@127.0.0.1:55438/tutorial_recovery_test") {
  throw new Error("Only the isolated recovery database is allowed");
}

const client = postgres(url);
const db = createDrizzleClient(url);
const [owner] = await client`SELECT id FROM users WHERE email='va@recovery.test'`;
const [channel] = await client`SELECT id FROM channels WHERE name='Test tutorials en'`;
assert(owner && channel);

const suffix = randomUUID().replaceAll("-", "");
const source = `keyword-tool.test-${suffix}`;
const otherSource = `keyword-tool.other-${suffix}`;
const keywordRef = "900000000001";
const requestId = randomUUID();
const runId = randomUUID();
const routeId = randomUUID();
const opportunityId = randomUUID();
const familyId = randomUUID();
const evidenceId = randomUUID();
const hash = "a".repeat(64);
const created: string[] = [];

function input(overrides: Record<string, unknown> = {}) {
  return {
    created_by: owner.id,
    channel_id: channel.id,
    keyword_ref: keywordRef,
    title: "Identity v2 isolated recovery probe",
    mode: "THREE_MIN" as const,
    status: "QUEUED" as const,
    language: "en",
    script_provider: "test",
    tts_provider: "test",
    tts_voice: "test",
    external_source: source,
    external_production_run_id: runId,
    external_opportunity_id: opportunityId,
    external_family_id: familyId,
    external_evidence_id: evidenceId,
    external_route_decision_id: routeId,
    intake_request_id: requestId,
    intake_request_hash: hash,
    external_route_snapshot: {
      schemaVersion: 2,
      routeDecisionId: routeId,
      channelId: channel.id,
      language: "en",
      format: "THREE_MIN",
    },
    ...overrides,
  };
}

try {
  const [schema] = await client`
    SELECT
      (SELECT data_type FROM information_schema.columns WHERE table_name='tutorial_jobs' AND column_name='intake_request_id') request_type,
      (SELECT convalidated FROM pg_constraint WHERE conrelid='tutorial_jobs'::regclass AND conname='tutorial_jobs_external_identity_v2_complete') constraint_valid,
      to_regclass('public.tutorial_generation_outbox')::text outbox
  `;
  assert.deepEqual(schema, { request_type: "uuid", constraint_valid: true, outbox: "tutorial_generation_outbox" });

  const concurrent = await Promise.all(Array.from({ length: 20 }, () => createOrReuseTutorialJob(db, input())));
  assert.equal(concurrent.filter((result) => result.created).length, 1);
  assert.equal(new Set(concurrent.map((result) => result.job?.id)).size, 1);
  const rootId = concurrent[0].job!.id;
  created.push(rootId);

  assert.equal((await client`SELECT count(*)::int n FROM tutorial_generation_outbox WHERE tutorial_job_id=${rootId}`)[0].n, 1);
  const queueCalls: unknown[][] = [];
  const dispatch = await dispatchTutorialGeneration(db, {
    add: async (...args: unknown[]) => { queueCalls.push(args); return {}; },
  } as never, { jobId: rootId });
  assert.deepEqual(dispatch, { pending: true, dispatched: true });
  assert.equal(queueCalls.length, 1);
  assert.equal((queueCalls[0][2] as { jobId: string }).jobId, `tutorial-script-${rootId}`);
  assert.equal((await client`SELECT dispatched_at IS NOT NULL AS sent FROM tutorial_generation_outbox WHERE tutorial_job_id=${rootId}`)[0].sent, true);
  const [event] = await client`SELECT payload FROM tutorial_keyword_outbox WHERE tutorial_job_id=${rootId} AND event_sequence=1`;
  assert.equal(event.payload.schema_version, 2);
  assert.equal(event.payload.external_source, source);
  assert.equal(event.payload.request_id, requestId);
  assert.equal(event.payload.production_run_id, runId);
  const delivered = await deliverKeywordMilestone(db, {
    url: "https://keyword.invalid/status",
    secret: "test",
    jobId: rootId,
    fetch: (async (_url: unknown, options: RequestInit) => {
      const payload = JSON.parse(String(options.body));
      return Response.json({ ...payload, verified: true });
    }) as typeof fetch,
  });
  assert.equal(delivered.delivered, true);
  await client`UPDATE tutorial_jobs SET status='GENERATING_SCRIPT' WHERE id=${rootId}`;
  const rejectedReceipt = await deliverKeywordMilestone(db, {
    url: "https://keyword.invalid/status",
    secret: "test",
    jobId: rootId,
    fetch: (async (_url: unknown, options: RequestInit) => {
      const payload = JSON.parse(String(options.body));
      return Response.json({ ...payload, production_run_id: randomUUID(), verified: true });
    }) as typeof fetch,
  });
  assert.equal(rejectedReceipt.delivered, false);
  const [rejectedEvent] = await client`SELECT delivered_at,last_error FROM tutorial_keyword_outbox WHERE tutorial_job_id=${rootId} AND event_sequence=2`;
  assert.equal(rejectedEvent.delivered_at, null);
  assert.match(rejectedEvent.last_error, /identity/i);

  assert.equal((await createOrReuseTutorialJob(db, input({ external_production_run_id: randomUUID() }))).job, null);
  assert.equal((await createOrReuseTutorialJob(db, input({ intake_request_id: randomUUID() }))).job, null);

  const independent = await createOrReuseTutorialJob(db, input({
    external_source: otherSource,
    external_production_run_id: randomUUID(),
    intake_request_id: randomUUID(),
  }));
  assert.equal(independent.created, true);
  created.push(independent.job!.id);

  const segmentRun = randomUUID();
  const segmentOpportunity = randomUUID();
  const segmentFamily = randomUUID();
  const segmentEvidence = randomUUID();
  const segmentRoute = randomUUID();
  const segmentRequest = randomUUID();
  await assert.rejects(client`
    INSERT INTO tutorial_jobs(created_by,title,keyword_ref,mode,status,script_provider,tts_provider,tts_voice,external_source)
    VALUES(${owner.id},'Partial identity',${`partial-${suffix}`} ,'THREE_MIN','QUEUED','test','test','test',${source})
  `);
  await assert.rejects(client`
    INSERT INTO tutorial_jobs(
      created_by,title,keyword_ref,mode,status,script_provider,tts_provider,tts_voice,channel_id,language,parent_job_id,
      external_source,external_production_run_id,external_opportunity_id,external_family_id,external_evidence_id,
      external_route_decision_id,intake_request_id,intake_request_hash,external_route_snapshot
    ) VALUES(
      ${owner.id},'Segment identity',${`segment-${suffix}`} ,'THREE_MIN','QUEUED','test','test','test',${channel.id},'en',${rootId},
      ${source},${segmentRun},${segmentOpportunity},${segmentFamily},${segmentEvidence},${segmentRoute},${segmentRequest},${hash},
      ${client.json({ schemaVersion: 2, routeDecisionId: segmentRoute, channelId: channel.id, language: "en", format: "THREE_MIN" })}
    )
  `);
  const childRun = randomUUID();
  const childOpportunity = randomUUID();
  const childFamily = randomUUID();
  const childEvidence = randomUUID();
  const childRoute = randomUUID();
  const childRequest = randomUUID();
  await assert.rejects(client`
    INSERT INTO tutorial_jobs(
      created_by,title,keyword_ref,mode,status,script_provider,tts_provider,tts_voice,channel_id,language,source_job_id,
      external_source,external_production_run_id,external_opportunity_id,external_family_id,external_evidence_id,
      external_route_decision_id,intake_request_id,intake_request_hash,external_route_snapshot
    ) VALUES(
      ${owner.id},'Child identity',${`child-${suffix}`} ,'THREE_MIN','QUEUED','test','test','test',${channel.id},'en',${rootId},
      ${source},${childRun},${childOpportunity},${childFamily},${childEvidence},${childRoute},${childRequest},${hash},
      ${client.json({ schemaVersion: 2, routeDecisionId: childRoute, channelId: channel.id, language: "en", format: "THREE_MIN" })}
    )
  `);

  const legacyId = randomUUID();
  created.push(legacyId);
  await client`
    INSERT INTO tutorial_jobs(id,created_by,title,keyword_ref,mode,status,script_provider,tts_provider,tts_voice)
    VALUES(${legacyId},${owner.id},'Legacy envelope',${`legacy-${suffix}`} ,'THREE_MIN','QUEUED','test','test','test')
  `;
  const [legacy] = await client`SELECT payload FROM tutorial_keyword_outbox WHERE tutorial_job_id=${legacyId} AND event_sequence=1`;
  assert.equal(legacy.payload.schema_version, undefined);
  assert.equal(legacy.payload.updated_at !== undefined, true);
  assert.equal(legacy.payload.occurred_at, undefined);

  console.log(JSON.stringify({
    concurrentRequests: 20,
    exactlyOneJob: true,
    runCollisionBlocked: true,
    requestCollisionBlocked: true,
    sourceNamespaceIsolated: true,
    partialAndChildIdentityBlocked: true,
    durableGenerationIntent: true,
    generationDispatchVerified: true,
    v1EnvelopePreserved: true,
    v2ReceiptIdentityVerified: true,
    externalCalls: 0,
  }));
} finally {
  if (created.length) await client`DELETE FROM tutorial_jobs WHERE id = ANY(${created}::uuid[])`;
  await client.end();
}
process.exit(0);
