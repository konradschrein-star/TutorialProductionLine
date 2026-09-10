/** Isolated real-DB protocol probe. Never starts workers or contacts a provider. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { capturePublicationApproval } from "../packages/media-core/dist/index.js";
import { tutorialSourceRevision } from "../packages/db/dist/index.js";

const url = process.env.DATABASE_URL;
if (url !== "postgresql://recovery:local-test-only@127.0.0.1:55438/tutorial_recovery_test") throw new Error("Isolated test database only");
if (process.env.LOCAL_MEDIA_ROOT !== "C:/Users/konra/AppData/Local/Temp/tutorial-recovery-media") throw new Error("Isolated recovery media root required");
const sql = postgres(url, { max: 3 });
const id = randomUUID();
const directory = `C:/Users/konra/AppData/Local/Temp/tutorial-recovery-media/scheduled-${id}`;
let previousSettings: unknown;
let previousPause = false;
try {
  await sql.unsafe(await readFile(new URL("../packages/db/src/migrations/0095_tutorial_scheduled_delivery.sql", import.meta.url), "utf8"));
  const { queueScheduledDelivery, claimScheduledDelivery, ingestScheduledReceipt, getScheduledAsset } = await import("../apps/hub-web/src/lib/uploader/scheduled-delivery");
  const [owner] = await sql`SELECT id FROM users WHERE email='va@recovery.test'`;
  const [channel] = await sql`SELECT * FROM channels WHERE language='en' AND uploader_channel_key IS NOT NULL LIMIT 1`;
  assert(owner && channel);
  const [settings] = await sql`SELECT uploader,tutorial_dispatch_paused FROM system_settings WHERE id='singleton'`;
  assert(settings); previousSettings = settings.uploader; previousPause = settings.tutorial_dispatch_paused;
  await sql`UPDATE system_settings SET uploader=${sql.json({ ...(settings.uploader ?? {}), enabled: true, executionMode: "live", requireManualRelease: false })},tutorial_dispatch_paused=false WHERE id='singleton'`;
  await mkdir(directory, { recursive: true });
  const videoPath = `${directory}/video.mp4`; const thumbPath = `${directory}/thumb.jpg`;
  await copyFile("C:/Users/konra/AppData/Local/Temp/tutorial-recovery-media/pilot-test-pattern.mp4", videoPath);
  const [thumb] = await sql`SELECT output_path FROM thumbnails WHERE subject_id='11111111-2222-4333-8444-555555555551' AND is_selected=true LIMIT 1`;
  assert(thumb); await copyFile(thumb.output_path, thumbPath);
  const publishAt = new Date(Date.now() + 86400000).toISOString();
  await sql`INSERT INTO tutorial_jobs(id,created_by,channel_id,title,mode,status,script_provider,tts_provider,tts_voice,language,final_path,recording_path,script_text,description,tags,thumbnail_text_top,thumbnail_text_bottom,va_review_status,scheduled_for)
    VALUES(${id},${owner.id},${channel.id},'Scheduled contract probe','THREE_MIN','COMPLETED','test','test','test','en',${videoPath},${videoPath},'Source script','Original description',${sql.json(["tutorial"])},'TEST','SCHEDULE','approved',${publishAt})`;
  const [selected] = await sql`INSERT INTO thumbnails(subject_kind,subject_id,channel_id,language,prompt_mode,prompt_used,reference_paths,aspect_ratio,resolution,headline_source,generation_kind,output_path,requested_backend,provider_used,backend_chain,review_verdict,status,is_selected)
    VALUES('tutorial_job',${id},${channel.id},'en','manual','{}','{}','16:9','1280x720','operator','edit',${thumbPath},'browser-layout','browser-layout',ARRAY['browser-layout'],'acceptable','completed',true) RETURNING id`;
  const [job] = await sql`SELECT * FROM tutorial_jobs WHERE id=${id}`;
  const approval = await capturePublicationApproval({ jobId: id, channelId: channel.id, language: "en", sourceRevision: tutorialSourceRevision(job as any), title: job!.title, description: job!.description, tags: job!.tags, videoPath, thumbnailId: selected!.id, thumbnailPath: thumbPath });
  await sql`UPDATE tutorial_jobs SET publication_approval=${sql.json(approval)} WHERE id=${id}`;
  const declaration = { visibility: "private", made_for_kids: false, monetization: "off" } as const;
  await assert.rejects(queueScheduledDelivery(id, randomUUID(), false, declaration), /Forbidden/);
  const requests = await Promise.all(Array.from({ length: 4 }, () => queueScheduledDelivery(id, owner.id, false, declaration)));
  assert.equal(requests.filter(request => !request.idempotent).length, 1);
  const dispatchId = requests[0]!.id;
  const claimId = randomUUID();
  await sql`UPDATE system_settings SET tutorial_dispatch_paused=true WHERE id='singleton'`;
  await assert.rejects(claimScheduledDelivery(dispatchId, claimId), /paused/);
  await sql`UPDATE system_settings SET tutorial_dispatch_paused=false WHERE id='singleton'`;
  const claimed = await claimScheduledDelivery(dispatchId, claimId);
  assert.equal(claimed.mayStart, true);
  const replay = await claimScheduledDelivery(dispatchId, claimId); assert.equal(replay.mayStart, false); assert.equal(replay.replay, true);
  await assert.rejects(claimScheduledDelivery(dispatchId, randomUUID()), /already claimed/);
  assert.equal((await getScheduledAsset(dispatchId, "video")).sha256, approval.video.sha256);
  const base = { version: "tutorial-scheduled-delivery/1", dispatchId, claimId, approvalRevision: approval.revision, requestSha256: claimed.requestSha256, sequence: 1, state: "uncertain", occurredAt: new Date().toISOString(), message: "Connector lost response; reconciliation required" };
  await sql`UPDATE system_settings SET tutorial_dispatch_paused=true WHERE id='singleton'`;
  const receipts = await Promise.all(Array.from({ length: 5 }, () => ingestScheduledReceipt(base)));
  assert.equal(receipts.filter(receipt => !receipt.duplicate).length, 1);
  await assert.rejects(ingestScheduledReceipt({ ...base, message: "conflicting evidence" }), /different evidence/);
  await assert.rejects(ingestScheduledReceipt({ ...base, sequence: 2, state: "uploading" }), /regress/);
  const scheduled = { ...base, sequence: 2, state: "scheduled", message: "Provider readback confirmed schedule", videoId: "abcdefghijk", visibility: "private", scheduledFor: publishAt, evidence: { kind: "provider_readback", reference: "test/provider/abcdefghijk", observedAt: new Date().toISOString() } };
  await assert.rejects(ingestScheduledReceipt({ ...scheduled, requestSha256: "a".repeat(64) }), /exact admitted/);
  await assert.rejects(ingestScheduledReceipt({ ...scheduled, scheduledFor: new Date(Date.now() + 172800000).toISOString() }), /reserved slot/);
  await ingestScheduledReceipt(scheduled);
  const [scheduledJob] = await sql`SELECT is_uploaded,youtube_visibility,scheduled_for FROM tutorial_jobs WHERE id=${id}`;
  assert.equal(scheduledJob!.is_uploaded, false); assert.equal(scheduledJob!.youtube_visibility, "private"); assert.equal(scheduledJob!.scheduled_for.toISOString(), publishAt);
  assert.equal((await ingestScheduledReceipt(base)).duplicate, true, "Old duplicate must remain idempotent after a newer receipt");
  await writeFile(thumbPath, "Changed bytes after connector download");
  await assert.rejects(getScheduledAsset(dispatchId, "thumbnail"), /Assets or metadata changed/);
  const published = await ingestScheduledReceipt({ ...scheduled, sequence: 3, state: "published", visibility: "public", publishedAt: new Date().toISOString(), message: "Old asset publication observed" });
  assert.equal("currentRevision" in published && published.currentRevision, false);
  const [unchanged] = await sql`SELECT is_uploaded,youtube_published_at FROM tutorial_jobs WHERE id=${id}`;
  assert.equal(unchanged!.is_uploaded, false); assert.equal(unchanged!.youtube_published_at, null);
  console.log(JSON.stringify({ concurrentRequests: 4, singleDispatch: true, pauseAtClaim: true, claimReplayCannotRestart: true, uniqueClaim: true, exactAssetHash: true, concurrentReceipts: 5, duplicateSequenceIdempotent: true, conflictingEvidenceRejected: true, unknownTransferCannotRetry: true, scheduleMismatchRejected: true, noElapsedTimePublication: true, staleBytesNotBlessed: true, receiptDuringPause: true, externalCalls: 0 }));
} finally {
  if (previousSettings !== undefined) await sql`UPDATE system_settings SET uploader=${sql.json(previousSettings as any)},tutorial_dispatch_paused=${previousPause} WHERE id='singleton'`;
  await sql.end();
}
process.exit(0);
