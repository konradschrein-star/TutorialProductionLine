/** One authorized current-pointer integration pilot; no standalone Drive downloader. */
import {execFileSync} from 'node:child_process';
import {readPrivatePreservationContext} from './preflight-preservation-receipts-cli';
const JOB='48790ac0-6ad1-4ce6-8ac4-7f7c26c428a6';
let dispatched=false;
try{
  if(process.argv.length!==3||process.argv[2]!=='--restore-exact-one')throw Error('explicit_one_only');
  const context=readPrivatePreservationContext(),entry=context.manifest.entries.find(e=>e.jobId===JOB);
  const receipt=context.verified.inserts.find(e=>e.artifact_id===JOB);
  if(!entry||!receipt||entry.bytes>32*1024*1024)throw Error('exact_receipt_required');
  const code=`
import {createDrizzleClient} from '/app/packages/db/dist/index.js';
import {sql} from 'drizzle-orm';
import {withTutorialMedia} from '/app/packages/storage/dist/tutorial-media.js';
import {fingerprintStorageSource} from '/app/packages/storage/dist/artifact-store.js';
import {lstat} from 'node:fs/promises';
const expected=${JSON.stringify({jobId:JOB,path:entry.path,bytes:entry.bytes,sha256:entry.sha256,driveId:receipt.drive_file_id})};
if(process.getuid()!==1000)throw Error('service_uid');
const db=createDrizzleClient(process.env.DATABASE_URL);
try{
const result=await db.transaction(async tx=>{
await tx.execute(sql\`SET LOCAL lock_timeout='10s'\`);
await tx.execute(sql\`SET LOCAL statement_timeout='120s'\`);
const identity=await tx.execute(sql\`SELECT current_database() as db,current_user as role\`);
if(identity[0].db!=='tutorial_staging_cf_20260908'||identity[0].role!=='tutorial_staging')throw Error('staging_identity');
const jobs=await tx.execute(sql\`SELECT to_jsonb(j) as row FROM tutorial_jobs j WHERE id=\${expected.jobId}::uuid FOR UPDATE\`);
if(jobs.length!==1||jobs[0].row.final_path!==expected.path||jobs[0].row.language!=='en'||jobs[0].row.source_job_id||jobs[0].row.parent_job_id)throw Error('current_original');
const artifacts=await tx.execute(sql\`SELECT to_jsonb(a) as row FROM storage_artifacts a WHERE owner_kind='tutorial_job' AND kind='final_video' AND job_id=\${expected.jobId}::uuid\`);
if(artifacts.length!==1)throw Error('current_pointer');const a=artifacts[0].row;
if(a.state!=='uploaded'||a.vps_path!==expected.path||a.drive_file_id!==expected.driveId||!a.verified_at||a.bytes!==expected.bytes||a.checksum_sha256!==expected.sha256)throw Error('verified_pointer');
let existed=true;try{await lstat(expected.path)}catch(e){if(e.code==='ENOENT')existed=false;else throw e;}
// No injected downloader or lease: this uses the deployed application's real
// current-pointer lookup, DB settings/credentials and materializer implementation.
const measured=await withTutorialMedia(db,{jobId:expected.jobId,kind:'final_video',path:expected.path,expectedContent:{sha256:expected.sha256,size:expected.bytes}},{allowedRoots:['/opt/content-forge/media'],maxBytes:expected.bytes,transaction:tx},fingerprintStorageSource);
if(measured.bytes!==expected.bytes||measured.sha256!==expected.sha256)throw Error('restored_fingerprint');
const afterJobs=await tx.execute(sql\`SELECT to_jsonb(j) as row FROM tutorial_jobs j WHERE id=\${expected.jobId}::uuid\`);
const afterArtifacts=await tx.execute(sql\`SELECT to_jsonb(a) as row FROM storage_artifacts a WHERE id=\${a.id}::uuid\`);
if(JSON.stringify(jobs)!==JSON.stringify(afterJobs)||JSON.stringify(artifacts)!==JSON.stringify(afterArtifacts))throw Error('database_changed');
return {applicationPointerRestoreVerified:true,restoredNewFile:!existed,reusedExisting:existed,jobId:expected.jobId,bytes:measured.bytes,sha256:measured.sha256,databaseWrites:0,sourceDeletions:0,approvalWrites:0};
});process.stdout.write(JSON.stringify(result));process.exit(0);
}catch{process.stdout.write(JSON.stringify({applicationPointerRestoreVerified:false,detailsWithheld:true,mediaPresence:'requires_read_only_reconciliation',databaseWrites:0,sourceDeletions:0}));process.exit(1);}
`;
  dispatched=true;
  const output=execFileSync('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','vps2','docker exec -i --user 1000:1000 tutorial-recovery-staging-web-1 node --input-type=module'],{input:code,encoding:'utf8',timeout:150000,maxBuffer:1024*1024,stdio:['pipe','pipe','pipe']});
  console.log(JSON.stringify(JSON.parse(output)));
}catch{console.log(JSON.stringify({applicationPointerRestoreVerified:false,dispatched,detailsWithheld:true,mediaPresence:dispatched?'requires_read_only_reconciliation':'not_changed',databaseWrites:0,sourceDeletions:0}));process.exitCode=1;}
