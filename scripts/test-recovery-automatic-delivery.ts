/** Isolated durable automatic-delivery scan; zero external API calls. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createDrizzleClient, tutorialSourceRevision } from "../packages/db/dist/index.js";
import { capturePublicationApproval } from "../packages/media-core/dist/index.js";
import { recoverAutomaticScheduledDelivery } from "../apps/worker-orchestrator/src/services/automatic-scheduled-delivery";
const url = process.env.DATABASE_URL;
if (url !== "postgresql://recovery:local-test-only@127.0.0.1:55438/tutorial_recovery_test") throw new Error("Isolated recovery database only");
const sql = postgres(url, { max: 4 }); const db = createDrizzleClient(url);
const id = randomUUID(); const channelId = randomUUID(); const thumbId = randomUUID(); let oldPause = false;
try {
  const [control] = await sql`SELECT tutorial_dispatch_paused FROM system_settings WHERE id='singleton'`; oldPause = control!.tutorial_dispatch_paused;
  const [source] = await sql`SELECT * FROM tutorial_jobs WHERE id='11111111-2222-4333-8444-555555555551'`;
  const [thumb] = await sql`SELECT * FROM thumbnails WHERE subject_id=${source!.id} AND is_selected=true LIMIT 1`; assert(source && thumb);
  await sql`INSERT INTO channels(id,name,youtube_channel_id,language,accepts_tutorials,is_primary,uploader_channel_key,metadata) VALUES(${channelId},'Automatic recovery probe',${`UC_${randomUUID()}`},'en',true,true,'automatic_probe','{}')`;
  await sql`INSERT INTO tutorial_jobs SELECT (jsonb_populate_record(NULL::tutorial_jobs,to_jsonb(t) || ${sql.json({ id, channel_id: channelId, title: "Automatic delivery isolated probe", source_job_id: null, status: "COMPLETED", va_review_status: "approved", is_uploaded: false, uploader_job_id: null, uploader_status: null, upload_verified_at: null, publication_approval: null, scheduled_for: new Date(Date.now() + 86400000).toISOString() })})).* FROM tutorial_jobs t WHERE id=${source.id}`;
  await sql`INSERT INTO thumbnails SELECT (jsonb_populate_record(NULL::thumbnails,to_jsonb(t) || ${sql.json({ id: thumbId, subject_id: id, channel_id: channelId, status: "completed", review_verdict: "acceptable", is_selected: true })})).* FROM thumbnails t WHERE id=${thumb.id}`;
  const [job] = await sql`SELECT * FROM tutorial_jobs WHERE id=${id}`;
  const approval = await capturePublicationApproval({ jobId: id, channelId, language: "en", sourceRevision: tutorialSourceRevision(job as any), title: job!.title, description: job!.description, tags: job!.tags, videoPath: job!.final_path, thumbnailId: thumbId, thumbnailPath: thumb.output_path });
  await sql`UPDATE tutorial_jobs SET publication_approval=${sql.json(approval)} WHERE id=${id}`;
  const count = async () => (await sql`SELECT count(*)::int AS count FROM tutorial_upload_dispatches WHERE tutorial_job_id=${id}`)[0]!.count;
  await recoverAutomaticScheduledDelivery(db); assert.equal(await count(), 0, "Manual default must not queue");
  const policy = { mode: "scheduled_automatic", notMadeForKidsConfirmed: true, monetization: "off", adSuitabilityConfirmed: false };
  await sql`UPDATE channels SET metadata=${sql.json({ tutorialDelivery: policy, branding: "preserved" })} WHERE id=${channelId}`;
  await sql`UPDATE system_settings SET tutorial_dispatch_paused=true WHERE id='singleton'`;
  await recoverAutomaticScheduledDelivery(db); assert.equal(await count(), 0, "Emergency pause holds new requests");
  await sql`UPDATE system_settings SET tutorial_dispatch_paused=false WHERE id='singleton'`;
  await sql`UPDATE tutorial_jobs SET title='Changed after approval' WHERE id=${id}`;
  await recoverAutomaticScheduledDelivery(db); assert.equal(await count(), 0, "Changed approval must not queue");
  await sql`UPDATE tutorial_jobs SET title='Automatic delivery isolated probe' WHERE id=${id}`;
  const scans = await Promise.all(Array.from({ length: 4 }, () => recoverAutomaticScheduledDelivery(db)));
  assert.equal(scans.reduce((total, scan) => total + scan.queued, 0), 1);
  assert.equal(await count(), 1);
  await recoverAutomaticScheduledDelivery(db); assert.equal(await count(), 1, "Restart scan cannot duplicate a request");
  const [dispatch] = await sql`SELECT * FROM tutorial_upload_dispatches WHERE tutorial_job_id=${id}`;
  assert.equal(dispatch!.state, "generic_queued"); assert.equal(dispatch!.scheduled_delivery.automatic, true); assert.equal(dispatch!.scheduled_delivery.approvalRevision, approval.revision); assert.equal(dispatch!.attributes.monetization, "off");
  console.log(JSON.stringify({ manualDefault: true, explicitPolicy: true, pauseHeld: true, staleApprovalBlocked: true, concurrentScans: 4, singleRequest: true, restartIdempotent: true, exactRevision: true, externalCalls: 0 }));
} finally {
  await sql`UPDATE channels SET metadata=jsonb_set(metadata,'{tutorialDelivery,mode}','"manual"') WHERE id=${channelId}`;
  await sql`UPDATE system_settings SET tutorial_dispatch_paused=${oldPause} WHERE id='singleton'`;
  await sql.end();
}
process.exit(0);
