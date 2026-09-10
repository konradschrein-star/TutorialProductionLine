/** One authorized restored thumbnail through deployed current-pointer application helper. */
import {execFileSync} from 'node:child_process';
let dispatched=false;
try{
if(process.argv.length!==3||process.argv[2]!=='--restore-exact-thumbnail')throw Error('explicit_single_restore');
const code=`import {createDrizzleClient} from '/app/packages/db/dist/index.js';import {sql} from 'drizzle-orm';import {withTutorialMedia} from '/app/packages/storage/dist/tutorial-media.js';import {fingerprintStorageSource} from '/app/packages/storage/dist/artifact-store.js';import {lstat} from 'node:fs/promises';
const jobId='48790ac0-6ad1-4ce6-8ac4-7f7c26c428a6',thumbId='70175471-10ac-4d26-81d5-da503701b942',sha='94113309775e2b0e8eb9077711be893c0c27a6aa7bb48f068ca3b32f122b719f',bytes=146123;
if(process.getuid()!==1000)throw Error('uid');const db=createDrizzleClient(process.env.DATABASE_URL);
try{const result=await db.transaction(async tx=>{
await tx.execute(sql\`SET LOCAL lock_timeout='10s'\`);await tx.execute(sql\`SET LOCAL statement_timeout='120s'\`);const identity=await tx.execute(sql\`SELECT current_database() as db,current_user as role\`);if(identity[0].db!=='tutorial_staging_cf_20260908'||identity[0].role!=='tutorial_staging')throw Error('staging');
const jobs=await tx.execute(sql\`SELECT to_jsonb(j) as row FROM tutorial_jobs j WHERE id=\${jobId}::uuid FOR UPDATE\`),thumbs=await tx.execute(sql\`SELECT to_jsonb(t) as row FROM thumbnails t WHERE id=\${thumbId}::uuid FOR UPDATE\`);
if(jobs.length!==1||thumbs.length!==1)throw Error('identity');const t=thumbs[0].row;if(t.subject_id!==jobId||t.subject_kind!=='tutorial_job'||t.language!=='en'||!t.is_selected||t.status!=='completed'||t.review_verdict!=='not_reviewed'||!t.output_path?.startsWith('/opt/content-forge/media/thumbnails/'+jobId+'/'))throw Error('selected_original');
const artifacts=await tx.execute(sql\`SELECT to_jsonb(a) as row FROM storage_artifacts a WHERE job_id=\${jobId}::uuid AND owner_kind='tutorial_job' AND kind='thumbnail'\`);if(artifacts.length!==1)throw Error('pointer');const a=artifacts[0].row;if(a.vps_path!==t.output_path||a.state!=='uploaded'||a.drive_file_id!=='1S5yw7OnPaJ0kgjwiHJo7yn2SjVhLrXmZ'||a.checksum_sha256!==sha||a.bytes!==bytes||!a.verified_at)throw Error('verified_pointer');
let existed=true;try{await lstat(t.output_path)}catch(e){if(e.code==='ENOENT')existed=false;else throw e;}
const measured=await withTutorialMedia(db,{jobId,kind:'thumbnail',path:t.output_path,expectedContent:{sha256:sha,size:bytes}},{transaction:tx,allowedRoots:['/opt/content-forge/media'],maxBytes:bytes},fingerprintStorageSource);
if(measured.sha256!==sha||measured.bytes!==bytes)throw Error('fingerprint');
const afterJobs=await tx.execute(sql\`SELECT to_jsonb(j) as row FROM tutorial_jobs j WHERE id=\${jobId}::uuid\`),afterThumbs=await tx.execute(sql\`SELECT to_jsonb(t) as row FROM thumbnails t WHERE id=\${thumbId}::uuid\`),afterArtifacts=await tx.execute(sql\`SELECT to_jsonb(a) as row FROM storage_artifacts a WHERE id=\${a.id}::uuid\`);
if(JSON.stringify(jobs)!==JSON.stringify(afterJobs)||JSON.stringify(thumbs)!==JSON.stringify(afterThumbs)||JSON.stringify(artifacts)!==JSON.stringify(afterArtifacts))throw Error('row_changed');
return{applicationThumbnailRestoreVerified:true,jobId,thumbnailId:thumbId,restoredNewFile:!existed,bytes,sha256:sha,jobUnchanged:true,selectionAndVerdictUnchanged:true,databaseWrites:0,sourceWrites:0};});process.stdout.write(JSON.stringify(result));process.exit(0);
}catch{process.stdout.write(JSON.stringify({applicationThumbnailRestoreVerified:false,mediaPresence:'requires_read_only_reconciliation',databaseWrites:0,sourceWrites:0}));process.exit(1);}`;
dispatched=true;const output=execFileSync('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','vps2','docker exec -i --user 1000:1000 tutorial-recovery-staging-web-1 node --input-type=module'],{input:code,encoding:'utf8',timeout:150000,maxBuffer:1024*1024,stdio:['pipe','pipe','pipe']});console.log(JSON.stringify(JSON.parse(output)));
}catch{console.log(JSON.stringify({applicationThumbnailRestoreVerified:false,dispatched,mediaPresence:dispatched?'requires_read_only_reconciliation':'not_changed',databaseWrites:0,sourceWrites:0}));process.exitCode=1;}
