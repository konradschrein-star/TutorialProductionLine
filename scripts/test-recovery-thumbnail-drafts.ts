/** HTTP + PostgreSQL integration probe. Uses only the isolated local runtime. */
import assert from "node:assert/strict";
import postgres from "postgres";
import { signToken } from "../apps/hub-web/src/lib/auth/jwt";
import { createRequire } from "node:module";
import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createDrizzleClient } from "../packages/db/dist/index.js";
import { reconcileThumbnailLocalization } from "../apps/worker-orchestrator/src/services/thumbnail-localization-recovery";
import { assertLocalizationCurrent } from "../apps/worker-orchestrator/src/utils/tutorial/localization-fence";
const require = createRequire(new URL("../apps/hub-web/package.json", import.meta.url));
const sharp = require("sharp");
const { Queue } = require("bullmq");
const fixtureLayout = (top: string, bottom: string, aspectRatio: "16:9" | "9:16" = "16:9") => ({
  aspectRatio,
  elements: [
    { id: "headline-1", type: "TEXT", text: top, x: 30, y: 30, width: 520, height: 110, zIndex: 2, fontSize: 64, fontWeight: "900" },
    { id: "headline-2", type: "TEXT", text: bottom, x: 30, y: 150, width: 520, height: 110, zIndex: 2, fontSize: 64, fontWeight: "900" },
  ],
});

const url = process.env.DATABASE_URL ?? "";
if (url !== "postgresql://recovery:local-test-only@127.0.0.1:55438/tutorial_recovery_test") throw new Error("Isolated recovery database only.");
if (process.env.JWT_SECRET !== "local-recovery-test-secret-not-for-production-2026") throw new Error("Local test signing key required.");
if (process.env.LOCAL_MEDIA_ROOT !== "C:/Users/konra/AppData/Local/Temp/tutorial-recovery-media") throw new Error("Isolated recovery media root required.");
const sql = postgres(url, { max: 1 });
const root = randomUUID();
let sourceChannelId: string | undefined;
let previousSourceMetadata: unknown = null;
const previousDestinationMetadata = new Map<string, unknown>();
try {
  const [owner] = await sql`SELECT id FROM users WHERE email='va@recovery.test'`;
  const [other] = await sql`SELECT id FROM users WHERE email='other@recovery.test'`;
  assert(owner && other, "Seed local test users first");
  const [channel] = await sql`SELECT id,metadata FROM channels WHERE youtube_channel_id='recovery-test-en'`;
  assert(channel);
  sourceChannelId = channel.id;
  previousSourceMetadata = channel.metadata;
  const localeChannels = await sql`SELECT id,language,metadata FROM channels WHERE youtube_channel_id IN ('recovery-test-de','recovery-test-fr','recovery-test-it','recovery-test-sv')`;
  const tutorialLocaleChannels = Object.fromEntries(localeChannels.map((row) => [row.language, row.id]));
  assert.deepEqual(Object.keys(tutorialLocaleChannels).sort(), ["de", "fr", "it", "sv"]);
  // Locale fan-out is deliberately explicit. The probe supplies an isolated
  // source-channel mapping instead of relying on a global language default.
  await sql`UPDATE channels SET metadata=COALESCE(metadata,'{}'::jsonb) || ${sql.json({ tutorialLocaleChannels })} WHERE id=${channel.id}`;
  for (const destination of localeChannels) {
    previousDestinationMetadata.set(destination.id, destination.metadata);
    const tutorialChannelProfile = {
      version: 1,
      primaryChannelId: channel.id,
      translationEnabled: true,
      translationMethod: "voiceover",
    };
    await sql`UPDATE channels SET metadata=COALESCE(metadata,'{}'::jsonb) || ${sql.json({ tutorialChannelProfile })} WHERE id=${destination.id}`;
  }
  await sql`INSERT INTO tutorial_jobs(id,created_by,channel_id,title,mode,status,script_provider,tts_provider,tts_voice,language,final_path,recording_path,script_text,description,tags)
    VALUES(${root},${owner.id},${channel.id},'Thumbnail-first API test','THREE_MIN','COMPLETED','test','test','test','en','/test-only/video.mp4','/test-only/recording.mp4','Test script','Test metadata',${sql.json(["test"])})`;
  const token = await signToken({ userId: owner.id, email: "va@recovery.test", role: "TUTORIAL_VA" });
  const otherToken = await signToken({ userId: other.id, email: "other@recovery.test", role: "TUTORIAL_VA" });
  assert.equal((await fetch("http://127.0.0.1:3108/api/presence", { method: "POST", headers: { Cookie: `hub_session=${token}` }, redirect: "error" })).status, 200);
  const endpoint = `http://127.0.0.1:3108/api/production/jobs/${root}/thumbnail-drafts`;
  const call = (session: string) => fetch(endpoint, { method: "POST", headers: { Cookie: `hub_session=${session}` }, redirect: "error" });
  assert.equal((await call(otherToken)).status, 403);
  const responses = await Promise.all(Array.from({ length: 8 }, () => call(token)));
  for (const response of responses) assert.equal(response.status, 200, await response.text());
  const drafts = await sql`SELECT id,language,status,final_path,channel_id FROM tutorial_jobs WHERE source_job_id=${root}`;
  assert.equal(drafts.length, 4);
  assert.deepEqual(drafts.map((row) => row.language).sort(), ["de", "fr", "it", "sv"]);
  assert(drafts.every((row) => row.status === "AWAITING_THUMBNAILS" && row.final_path === null && row.channel_id));
  const before = drafts.map((row) => row.id).sort();
  assert.equal((await call(token)).status, 200);
  const after = await sql`SELECT id FROM tutorial_jobs WHERE source_job_id=${root}`;
  assert.deepEqual(after.map((row) => row.id).sort(), before);
  const blocked = await fetch("http://127.0.0.1:3108/api/production/tutorial-translate/enqueue", {
    method: "POST", headers: { Cookie: `hub_session=${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sourceJobId: root, mode: "automatic", languages: ["de", "fr", "it", "sv"] }), redirect: "error",
  });
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).error, /Thumbnail approval/);
  const testImage = await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#274563" } }).png().toBuffer();
  const portrait = new FormData();
  portrait.append("file", new Blob([testImage], { type: "image/png" }), "portrait-layout-test.png");
  portrait.append("layout", JSON.stringify(fixtureLayout("TEST", "PORTRAIT", "9:16")));
  portrait.append("top", "TEST"); portrait.append("bottom", "PORTRAIT");
  const portraitResponse = await fetch(`http://127.0.0.1:3108/api/production/jobs/${root}/thumbnail/manual`, { method: "POST", headers: { Cookie: `hub_session=${token}` }, body: portrait });
  assert.equal(portraitResponse.status, 400);
  assert.match((await portraitResponse.json()).error, /16:9/);
  for (const row of [{ id: root, language: "en" }, ...drafts]) {
    const form = new FormData();
    form.append("file", new Blob([testImage], { type: "image/png" }), "local-test-pattern.png");
    form.append("layout", JSON.stringify(fixtureLayout(`TEST ${row.language}`, "LOCAL FIXTURE")));
    form.append("top", `TEST ${row.language}`);
    form.append("bottom", "LOCAL FIXTURE");
    const response = await fetch(`http://127.0.0.1:3108/api/production/jobs/${row.id}/thumbnail/manual`, { method: "POST", headers: { Cookie: `hub_session=${token}` }, body: form, redirect: "error" });
    assert.equal(response.status, 200, await response.text());
    const [saved] = await sql`SELECT output_path FROM thumbnails WHERE subject_id=${row.id} AND is_selected=true`;
    assert(saved);
    assert(saved.output_path.replaceAll("\\", "/").startsWith("C:/Users/konra/AppData/Local/Temp/tutorial-recovery-media/thumbnails/"));
    await access(saved.output_path);
  }
  const enqueue = () => fetch("http://127.0.0.1:3108/api/production/tutorial-translate/enqueue", {
    method: "POST", headers: { Cookie: `hub_session=${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sourceJobId: root, mode: "automatic", languages: ["de", "fr", "it", "sv"] }), redirect: "error",
  });
  const batchUrl = "http://127.0.0.1:3108/api/production/thumbnail-batches?q=Thumbnail-first";
  const batchResponse = await fetch(batchUrl, { headers: { Cookie: `hub_session=${token}` } });
  assert.equal(batchResponse.status, 200);
  const batch = await batchResponse.json();
  assert.equal(batch.scope, "mine");
  const ownRow = batch.rows.find((row: { id: string }) => row.id === root);
  assert(ownRow && ownRow.variants.length === 5 && ownRow.approved);
  const otherBatch = await (await fetch(batchUrl, { headers: { Cookie: `hub_session=${otherToken}` } })).json();
  assert(!otherBatch.rows.some((row: { id: string }) => row.id === root));
  assert.equal((await fetch(`${batchUrl}&beforeId=${root}`, { headers: { Cookie: `hub_session=${token}` } })).status, 400);
  const approve = (session: string) => fetch("http://127.0.0.1:3108/api/thumbnails/approve", { method: "POST", headers: { Cookie: `hub_session=${session}`, "Content-Type": "application/json" }, body: JSON.stringify({ thumbnailIds: ownRow.variants.map((variant: { thumbnailId: string }) => variant.thumbnailId) }) });
  assert.equal((await approve(otherToken)).status, 403);
  assert.equal((await approve(token)).status, 200);
  // Simulate a stale selected image within this probe's isolated fixture only.
  const englishThumbnail = ownRow.variants.find((variant: { language: string }) => variant.language === "en").thumbnailId;
  await sql`UPDATE thumbnails SET is_selected=false WHERE id=${englishThumbnail}`;
  assert.equal((await approve(token)).status, 409);
  await sql`UPDATE thumbnails SET is_selected=true WHERE id=${englishThumbnail}`;
  console.log(JSON.stringify({ batchOwnerScoping: true, fiveLanguageGrid: true, incompleteCursorRejected: true, crossVaApprovalBlocked: true, staleSelectionApprovalBlocked: true }));
  const first = await enqueue();
  assert.equal(first.status, 200, await first.clone().text());
  assert.equal((await first.json()).enqueued.length, 4);
  const repeat = await enqueue();
  assert.equal(repeat.status, 200);
  assert.deepEqual((await repeat.json()).enqueued, []);
  // Remove only this probe's waiting queue requests. Test assets and records
  // remain for browser inspection; no real workers/providers are running.
  const queue = new Queue("queue-tutorial-translate", { connection: { host: "127.0.0.1", port: 56388 } });
  try {
    for (const language of ["de", "fr", "it", "sv"]) {
      const queued = await queue.getJob(`tutorial-translate-${root}-${language}`);
      assert(queued, "Expected deterministic queue request");
      await queued.remove();
    }
  } finally { await queue.close(); }
  const requests = new Map<string, unknown>();
  let unavailable = true;
  const fakeQueue = {
    getJob: async (id: string) => { if (unavailable) throw new Error("Simulated queue outage"); return requests.get(id); },
    add: async (_name: string, data: unknown, options: { jobId: string }) => { requests.set(options.jobId, data); },
  };
  const recoveryDb = createDrizzleClient(url);
  await assert.rejects(() => reconcileThumbnailLocalization(recoveryDb, fakeQueue as never), /Simulated queue outage/);
  unavailable = false;
  const recovered = await reconcileThumbnailLocalization(recoveryDb, fakeQueue as never);
  assert(recovered.enqueued >= 4);
  assert.equal((await reconcileThumbnailLocalization(recoveryDb, fakeQueue as never)).enqueued, 0);
  assert(requests.has(`tutorial-translate-${root}-de`));
  const revisionPayload = requests.get(`tutorial-translate-${root}-de`) as { sourceRevision: string; thumbnailId: string };
  const german = drafts.find((row) => row.language === "de")!;
  const fenceInput = { sourceJobId: root, childId: german.id, ...revisionPayload };
  await assertLocalizationCurrent(recoveryDb, fenceInput);
  await sql`UPDATE tutorial_jobs SET script_text='A replaced source script' WHERE id=${root}`;
  await assert.rejects(() => assertLocalizationCurrent(recoveryDb, fenceInput), /Source changed/);
  await sql`UPDATE tutorial_jobs SET script_text='Test script' WHERE id=${root}`;
  await sql`UPDATE thumbnails SET is_selected=false WHERE id=${revisionPayload.thumbnailId}`;
  await assert.rejects(() => assertLocalizationCurrent(recoveryDb, fenceInput), /Thumbnail changed/);
  await sql`UPDATE thumbnails SET is_selected=true WHERE id=${revisionPayload.thumbnailId}`;
  await sql`UPDATE tutorial_jobs SET status='CANCELLED' WHERE id=${german.id}`;
  await assert.rejects(() => assertLocalizationCurrent(recoveryDb, fenceInput), /withdrawn/);
  await sql`UPDATE tutorial_jobs SET status='AWAITING_THUMBNAILS' WHERE id=${german.id}`;
  console.log(JSON.stringify({ staleSourceRejected: true, replacedThumbnailRejected: true, cancelledLocaleRejected: true }));
  for (const request of requests.values()) {
    const payload = request as { sourceRevision: string; thumbnailId: string; purpose?: string };
    if (payload.purpose === "thumbnail-copy") continue;
    assert.match(payload.sourceRevision, /^[a-f0-9]{64}$/);
    assert(payload.thumbnailId);
  }
  console.log(JSON.stringify({ concurrentRequests: 8, stableDrafts: 4, unauthorizedProducerBlocked: true, approvedThumbnailsWithoutLocaleVideos: 4, unapprovedLocalizationBlocked: true, duplicateEnqueueSuppressed: true, providerCalls: 0, testQueueRequestsRemoved: 4 }));
  console.log(JSON.stringify({ approvedPackRecoveredAfterQueueOutage: true, recoveryDuplicateSuppression: true, revisionFencedRequests: requests.size }));
} finally {
  // Also reconcile requests left by the first version of this local probe,
  // which used the fixed UI fixture before correcting the queue name.
  const queue = new Queue("queue-tutorial-translate", { connection: { host: "127.0.0.1", port: 56388 } });
  try {
    for (const sourceId of [root, "11111111-2222-4333-8444-555555555551"]) {
      for (const language of ["de", "fr", "it", "sv"]) {
        const queued = await queue.getJob(`tutorial-translate-${sourceId}-${language}`);
        if (queued) await queued.remove();
      }
    }
  } finally {
    await queue.close();
    if (sourceChannelId) {
      if (previousSourceMetadata === null) await sql`UPDATE channels SET metadata=NULL WHERE id=${sourceChannelId}`;
      else await sql`UPDATE channels SET metadata=${sql.json(previousSourceMetadata as never)} WHERE id=${sourceChannelId}`;
    }
    for (const [channelId, metadata] of previousDestinationMetadata) {
      if (metadata === null) await sql`UPDATE channels SET metadata=NULL WHERE id=${channelId}`;
      else await sql`UPDATE channels SET metadata=${sql.json(metadata as never)} WHERE id=${channelId}`;
    }
    await sql.end();
  }
}
// All scoped queues and SQL fixture connections are closed. The separate
// shared Drizzle factory has no public close API; this standalone probe is done.
process.exit(0);
