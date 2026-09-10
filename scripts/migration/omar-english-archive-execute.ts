/** Reviewed exact-manifest executor. Defaults to read-only; never writes database or publication bundles. */
import {execFileSync} from 'node:child_process';
import {constants} from 'node:fs';
import {lstat,open,readFile,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {DriveClient} from '../../packages/storage/src/drive/client';
import {DriveTokenProvider} from '../../packages/storage/src/drive/auth';
import {loadStorageConfig} from '../../packages/storage/src/config';
import {assertDriveOwner,preserveOne,sha256Text,type Receipt} from './preserve-english-finals';
import {OMAR_ARCHIVE as S,validateArchive,archiveRevision,type ArchiveEntry} from './omar-english-archive-policy';
const MANIFEST='/var/tmp/omar-english-archive-Kfwm1O/manifest.json',SHA='6d82c6496630db90dfba341363c25818879b1dd58df5ac066d7bc00b8b42a07d',ROOT=dirname(MANIFEST);
const unwrap=<T>(r:{ok:true,value:T}|{ok:false,error:unknown}):T=>{if(!r.ok)throw Error('drive_operation');return r.value};
const token=(s:any)=>JSON.stringify([s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs]);
let lock:any,ledger:any,owned=false,attempted=false;
async function privateRead(p:string){const d=await lstat(ROOT),s=await lstat(p);if(!d.isDirectory()||d.isSymbolicLink()||d.uid!==0||(d.mode&0o077)||!s.isFile()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o077)||s.nlink!==1||s.size>2097152)throw Error('private_input');return readFile(p,'utf8')}
async function syncDir(){const d=await open(ROOT,'r');try{await d.sync()}finally{await d.close()}}
async function recheck(f:ArchiveEntry,full:boolean){
 for(let p=dirname(f.path);p!=='/';p=dirname(p)){const s=await lstat(p);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o022))throw Error('source_ancestor');}
 const s=await lstat(f.path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||token(s)!==f.statToken)throw Error('source_changed');
 if(!full)return;
 const query=`SELECT row_to_json(x) FROM(SELECT j.id,j.status,j.language,j.final_path,j.recording_path,j.audio_path,j.completed_at,j.output_qa_status,j.delivered_to_drive,j.parent_job_id,j.source_job_id,md5(coalesce(j.script_text,'')) AS script_digest FROM tutorial_jobs j WHERE id='${f.jobId}'::uuid)x`;
 const row=JSON.parse(execFileSync('sudo',['-u','postgres','psql','-X','-d','tutorial_studio','-qAt','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}));if(archiveRevision(row)!==f.sourceRevision)throw Error('revision_changed');
 const fd=await open(f.path,constants.O_RDONLY|constants.O_NOFOLLOW),sha=createHash('sha256'),md5=createHash('md5');let bytes=0;try{if(token(await fd.stat())!==f.statToken)throw Error('source_changed');for await(const b of fd.createReadStream({autoClose:false})){sha.update(b);md5.update(b);bytes+=b.length;}if(token(await fd.stat())!==f.statToken)throw Error('source_changed');}finally{await fd.close();}
 if(bytes!==f.bytes||sha.digest('hex')!==f.sha256||md5.digest('hex')!==f.md5||token(await lstat(f.path))!==f.statToken)throw Error('source_changed');
}
async function main(){
 const execute=process.argv[2]==='--execute-reviewed-sixteen';if(process.platform!=='linux'||process.getuid?.()!==0||process.argv.length>3||(process.argv[2]&&!execute))throw Error('arguments');
 const text=await privateRead(MANIFEST);if(sha256Text(text)!==SHA)throw Error('manifest_sha');const m=validateArchive(JSON.parse(text));for(const f of m.entries)await recheck(f,true);
 const pm=JSON.parse(execFileSync('pm2',['jlist'],{encoding:'utf8',maxBuffer:8388608})),env=pm.find((p:any)=>p.name==='tutorial-worker')?.pm2_env;const allowedWorkerRoots=new Set(['/opt/tutorial-studio/apps/worker-orchestrator','/opt/tutorial-review-omar-20260909-X9mWtF/app/apps/worker-orchestrator']);if(!allowedWorkerRoots.has(env?.pm_cwd))throw Error('host');const cfg=loadStorageConfig(env);if(!cfg.enabled)throw Error('config');cfg.drive.maxAttempts=1;
 const timed:typeof fetch=(u,o)=>fetch(u,{...o,signal:AbortSignal.timeout(45000)}),drive=new DriveClient(cfg.drive,{fetch:timed}),tokens=new DriveTokenProvider(cfg.drive.auth,{fetch:timed});
 const get=async(u:string)=>{const t=unwrap(await tokens.getToken()),r=await timed(u,{headers:{Authorization:'Bearer '+t.token}});if(!r.ok)throw Error('drive_read');return r.json() as Promise<any>};
 const folderMeta=(id:string)=>get('https://www.googleapis.com/drive/v3/files/'+id+'?fields=id,name,mimeType,parents,ownedByMe,trashed,driveId,capabilities(canAddChildren)');
 const about=await get('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress),storageQuota');assertDriveOwner(about,await folderMeta(m.parentId),S.bytes);
 if(!execute){console.log(JSON.stringify({mode:'rehearsal',files:16,bytes:S.bytes,manifestSha256:SHA,sourceStable:true,ownerVerified:true,driveWrites:0,databaseWrites:0}));return;}
 lock=await open(ROOT+'/archive.lock','wx',0o600);owned=true;await lock.sync();await syncDir();let prior='';try{prior=await privateRead(ROOT+'/receipts.jsonl')}catch(e:any){if(e.code!=='ENOENT')throw e}if(prior&&!prior.endsWith('\n'))throw Error('ledger_truncated');
 const history:any[]=[];let seq=0,head='';for(const line of prior.split('\n').filter(Boolean)){const {hash,...r}=JSON.parse(line);if(r.manifestSha256!==SHA||r.sequence!==++seq||r.previousHash!==head||hash!==sha256Text(JSON.stringify(r)))throw Error('ledger_chain');head=hash;history.push(r);}
 ledger=await open(ROOT+'/receipts.jsonl',constants.O_APPEND|constants.O_WRONLY|constants.O_CREAT|constants.O_NOFOLLOW,0o600);await syncDir();const append=async(r:any)=>{const row={...r,manifestSha256:SHA,sequence:++seq,at:new Date().toISOString(),previousHash:head},hash=sha256Text(JSON.stringify(row));await ledger.writeFile(JSON.stringify({...row,hash})+'\n');await ledger.sync();head=hash;history.push(row);};
 let folderId=history.findLast(r=>r.stage==='folder_verified')?.fileId;
 if(!folderId){if(history.some(r=>r.stage.startsWith('folder_')))throw Error('folder_creation_uncertain_requires_reconciliation');await append({stage:'folder_intent'});attempted=true;folderId=unwrap(await drive.createFolder(m.folderName,m.parentId));const fm=await folderMeta(folderId);assertDriveOwner(about,fm,S.bytes);if(fm.parents?.length!==1||fm.parents[0]!==m.parentId||fm.name!==m.folderName)throw Error('folder_identity');await append({stage:'folder_verified',fileId:folderId});}
 const fm=await folderMeta(folderId);assertDriveOwner(about,fm,S.bytes);if(fm.parents?.length!==1||fm.parents[0]!==m.parentId||fm.name!==m.folderName)throw Error('folder_identity');let verified=0;
 for(const f of m.entries){
  await preserveOne(f,history as Receipt[],{
   recheck:(x,full)=>recheck(x as ArchiveEntry,full),find:async()=>unwrap(await drive.findExistingArtifact(f.jobId,'recovery_unapproved_final',f.sha256))?.id??null,
   start:async()=>{attempted=true;return unwrap(await drive.createResumableSession({filename:`NOT-APPROVED_${f.qa}_${f.jobId}_${f.filename}`,parentId:folderId,mimeType:'video/mp4',sizeBytes:f.bytes,jobId:f.jobId,kind:'recovery_unapproved_final',sourceSha256:f.sha256}))},
   offset:async(u,n)=>unwrap(await drive.queryResumableOffset(u,n)),
   chunk:async(u,_f,start,end)=>{const fd=await open(f.path,constants.O_RDONLY|constants.O_NOFOLLOW);try{if(token(await fd.stat())!==f.statToken)throw Error('source_changed');attempted=true;const r=unwrap(await drive.uploadChunk({sessionUri:u,localPath:'/proc/self/fd/'+fd.fd,start,end,totalBytes:f.bytes}));if(token(await fd.stat())!==f.statToken)throw Error('source_changed');return r.done?{fileId:r.file.id}:{nextOffset:r.nextOffset};}finally{await fd.close()}},
   verify:async(id)=>{
    if(!/^[\w-]{10,200}$/.test(id))throw Error('file_id');
    const url='https://www.googleapis.com/drive/v3/files/'+id+'?fields=id,size,md5Checksum,parents,ownedByMe,trashed,version';
    let last:unknown;
    // A completed resumable upload can be briefly visible in metadata before
    // its downloadable bytes are available. Retry only these read-only checks;
    // the durable uploaded receipt prevents any duplicate create/upload.
    for(let attempt=0;attempt<4;attempt++){
     try{const a=await get(url);if(!a.ownedByMe||a.trashed||a.parents?.length!==1||a.parents[0]!==folderId||Number(a.size)!==f.bytes||a.md5Checksum!==f.md5)throw Error('remote_identity');const b=unwrap(await drive.inspectFileContent(id,f.bytes));if(b.sha256!==f.sha256||b.sizeBytes!==f.bytes||JSON.stringify(a)!==JSON.stringify(await get(url)))throw Error('remote_changed');return;}
     catch(error){last=error;if(attempt<3)await new Promise(resolve=>setTimeout(resolve,2000));}
    }
    throw last;
   },append
  });verified++;console.log(JSON.stringify({verified,bytes:m.entries.slice(0,verified).reduce((n,e)=>n+e.bytes,0),databaseWrites:0}));
 }
 console.log(JSON.stringify({complete:true,verified,bytes:S.bytes,folderId,manifestSha256:SHA,ledgerHead:head,ledgerPath:ROOT+'/receipts.jsonl',databaseWrites:0,sourceWrites:0}));
}
main().catch(()=>{console.error(JSON.stringify({stopped:true,uncertain:attempted,detailsWithheld:true,noBlindRetry:true,databaseWrites:0,sourceWrites:0}));process.exitCode=1}).finally(async()=>{await ledger?.close();await lock?.close();if(owned)await unlink(ROOT+'/archive.lock')});
