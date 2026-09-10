/** Real localhost Studio outbox -> localhost Keyword Tool receiver; no providers. */
import { strict as assert } from 'node:assert';
import postgres from 'postgres';
import { createDrizzleClient } from '../packages/db/dist/index.js';
import { deliverKeywordMilestone } from '../apps/worker-orchestrator/src/services/keyword-outbox';
const url=process.env.DATABASE_URL;
if(url!=='postgresql://recovery:local-test-only@127.0.0.1:55438/tutorial_recovery_test')throw new Error('Isolated test database only');
const jobId='d183a142-2632-45da-bbbe-e3698b116a99';
const client=postgres(url);const db=createDrizzleClient(url,{idleTimeoutSeconds:1});
const receiver='http://127.0.0.1:17877/api/integration/forge/job-status';
const secret='local-kt-studio-webhook-2026';
try {
 const [job]=await client`SELECT keyword_ref FROM tutorial_jobs WHERE id=${jobId}`;
 assert.equal(job?.keyword_ref,'202','Use only the known real-HTTP synthetic intake fixture');
 let confirmed=0;
 for(let index=0;index<20;index++) {
  const result=await deliverKeywordMilestone(db,{url:receiver,secret,jobId});
  if(!result.pending)break;
  assert(result.delivered,'Actual Keyword Tool must confirm the bound event');confirmed++;
 }
 // This status change is synthetic contract evidence, NOT actual recording.
 await client`UPDATE tutorial_jobs SET status=CASE WHEN status='READY_TO_RECORD' THEN 'RECORDED'::tutorial_job_status ELSE 'READY_TO_RECORD'::tutorial_job_status END WHERE id=${jobId}`;
 const result=await deliverKeywordMilestone(db,{url:receiver,secret,jobId});
 assert(result.delivered,'Recorded workflow milestone must reach actual receiver');confirmed++;
 const [event]=await client`SELECT payload FROM tutorial_keyword_outbox WHERE tutorial_job_id=${jobId} ORDER BY event_sequence DESC LIMIT 1`;
 const replay=await fetch(receiver,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${secret}`},body:JSON.stringify(event!.payload)});
 assert.equal(replay.status,200);const replayReceipt=await replay.json() as {verified?:boolean};assert.equal(replayReceipt.verified,true);
 const [pending]=await client`SELECT count(*)::int n FROM tutorial_keyword_outbox WHERE tutorial_job_id=${jobId} AND delivered_at IS NULL`;
 assert.equal(pending!.n,0);
 console.log(JSON.stringify({realLocalHttp:true,confirmedEvents:confirmed,duplicateReceiptVerified:true,pendingEvents:0,paidProviderCalls:0,publicUploads:0,recordingActuallyPerformed:false}));
} finally {await client.end();}
