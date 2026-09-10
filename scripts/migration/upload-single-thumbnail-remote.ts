/** VPS2-only JSON-line service. Code may be installed separately; execution requires reviewed flag and parent-coordinated source rechecks. */
import {createInterface} from 'node:readline';
import {constants} from 'node:fs';
import {lstat,mkdir,open,readFile,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DriveClient} from '../../packages/storage/src/drive/client';
import {DriveTokenProvider} from '../../packages/storage/src/drive/auth';
import {loadStorageConfig} from '../../packages/storage/src/config';
import {preserveOne,assertDriveOwner,sha256Text,type Receipt} from './preserve-english-finals';
import {SINGLE_THUMBNAIL as S,assertSingleThumbnail} from './single-thumbnail-policy';
const ROOT='/var/tmp/tutorial-single-thumbnail-70175471-10ac-4d26-81d5-da503701b942';
const emit=(x:any)=>process.stdout.write(JSON.stringify(x)+'\n');
const unwrap=<T>(x:{ok:true,value:T}|{ok:false,error:unknown}):T=>{if(!x.ok)throw Error('Drive operation failed');return x.value};
let lock:any=null,ledger:any=null,lockOwned=false,remoteAttempted=false;
async function protectedRead(path:string,max:number){const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==0||(s.mode&0o077)||s.size>max)throw Error('private_file');return readFile(path,'utf8');}
async function syncDirectory(){const d=await open(ROOT,'r');try{await d.sync()}finally{await d.close()}}
try{
  if(process.platform!=='linux'||process.getuid?.()!==0||process.argv.length!==3||process.argv[2]!=='--execute-exact-thumbnail')throw Error('explicit_staging_only');
  const staging=await lstat('/opt/tutorial-recovery-staging');if(!staging.isDirectory()||staging.isSymbolicLink()||staging.uid!==0||(staging.mode&0o077))throw Error('staging_directory');
  const lines=createInterface({input:process.stdin,crlfDelay:Infinity})[Symbol.asyncIterator]();let received=0;process.stdin.on('data',chunk=>{received+=chunk.length;if(received>1024*1024)process.stdin.destroy(Error('Input exceeds fixed bound'))});
  async function next(){const r=await Promise.race([lines.next(),new Promise<never>((_,reject)=>{const t=setTimeout(()=>reject(Error('parent_timeout')),30000);t.unref()})]);if(r.done||r.value.length>300000)throw Error('parent_input');return JSON.parse(r.value);}
  const initial=await next();if(initial.type!=='init')throw Error('initial_input');const source=initial.source;assertSingleThumbnail(source);
  if(typeof source.dataBase64!=='string'||! /^[A-Za-z0-9+/]+={0,2}$/.test(source.dataBase64))throw Error('spool_encoding');const bytes=Buffer.from(source.dataBase64,'base64');
  if(bytes.length!==S.bytes||createHash('sha256').update(bytes).digest('hex')!==S.sha256||createHash('md5').update(bytes).digest('hex')!==S.md5)throw Error('spool_fingerprint');
  const sniffed=bytes[0]===255&&bytes[1]===216?'image/jpeg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':null;
  if(sniffed!==source.mimeType)throw Error('spool_mime');
  await mkdir(ROOT,{mode:0o700}).catch((e:any)=>{if(e.code!=='EEXIST')throw e});const rootStat=await lstat(ROOT);if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||rootStat.uid!==0||(rootStat.mode&0o077))throw Error('work_directory');
  lock=await open(ROOT+'/ledger.lock','wx',0o600);lockOwned=true;await lock.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()})+'\n');await lock.sync();await syncDirectory();
  const {dataBase64:_,...identity}=source;
  const manifest=JSON.stringify({version:'selected-thumbnail-preservation/1',account:'konrad.schrein@gmail.com',folderId:S.folderId,...identity}),manifestSha=sha256Text(manifest);
  let priorManifest:string|null=null;try{priorManifest=await protectedRead(ROOT+'/manifest.json',16384)}catch(e:any){if(e.code!=='ENOENT')throw e}
  if(priorManifest!==null&&priorManifest!==manifest)throw Error('manifest_changed');
  if(priorManifest===null){const f=await open(ROOT+'/manifest.json','wx',0o600);try{await f.writeFile(manifest);await f.sync()}finally{await f.close()}}
  const spool=ROOT+'/source-image.bin';let exists=true;try{await lstat(spool)}catch(e:any){if(e.code==='ENOENT')exists=false;else throw e}
  if(!exists){const f=await open(spool,'wx',0o600);try{await f.writeFile(bytes);await f.sync()}finally{await f.close()}}
  const spoolStat=await lstat(spool),stat=(s:any)=>JSON.stringify([s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs]);
  if(!spoolStat.isFile()||spoolStat.isSymbolicLink()||spoolStat.nlink!==1||spoolStat.uid!==0||(spoolStat.mode&0o077)||spoolStat.size!==S.bytes||createHash('sha256').update(await readFile(spool)).digest('hex')!==S.sha256)throw Error('spool_changed');await syncDirectory();
  let previous='';try{previous=await protectedRead(ROOT+'/receipts.jsonl',1024*1024)}catch(e:any){if(e.code!=='ENOENT')throw e}
  if(previous&&!previous.endsWith('\n'))throw Error('truncated_ledger');const history:Receipt[]=[];let sequence=0,head='';
  for(const line of previous.split('\n').filter(Boolean)){const {hash,...row}=JSON.parse(line);if(row.manifestSha256!==manifestSha||row.sequence!==++sequence||row.previousHash!==head||row.thumbnailId!==S.thumbnailId||row.jobId!==S.jobId||hash!==sha256Text(JSON.stringify(row))||!['intent','session','uploaded','verified','uncertain'].includes(row.stage))throw Error('ledger_chain');head=hash;history.push(row);}
  ledger=await open(ROOT+'/receipts.jsonl',constants.O_APPEND|constants.O_WRONLY|constants.O_CREAT|constants.O_NOFOLLOW,0o600);await syncDirectory();
  const append=async(receipt:Receipt)=>{const row={...receipt,thumbnailId:S.thumbnailId,manifestSha256:manifestSha,sequence:++sequence,at:new Date().toISOString(),previousHash:head};const hash=sha256Text(JSON.stringify(row));await ledger.writeFile(JSON.stringify({...row,hash})+'\n');await ledger.sync();head=hash;history.push(receipt);};
  const cfg=loadStorageConfig({STORAGE_DRIVE_ENABLED:'true',GOOGLE_OAUTH_CLIENT_SECRET_FILE:'/opt/tutorial-recovery-staging/drive-secrets/client.json',GOOGLE_DRIVE_REFRESH_TOKEN_FILE:'/opt/tutorial-recovery-staging/drive-secrets/refresh-token.txt',STORAGE_DRIVE_MAX_ATTEMPTS:'1'});
  if(!cfg.enabled)throw Error('drive_config');cfg.drive.maxAttempts=1; // Never hide a second create attempt inside an HTTP retry.
  const timed:typeof fetch=(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(45000)}),drive=new DriveClient(cfg.drive,{fetch:timed}),tokens=new DriveTokenProvider(cfg.drive.auth,{fetch:timed});
  async function get(url:string){const t=unwrap(await tokens.getToken()),r=await timed(url,{headers:{Authorization:'Bearer '+t.token}});if(!r.ok)throw Error('drive_metadata');return r.json() as Promise<any>;}
  async function destination(){const about=await get('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress),storageQuota'),folder=await get('https://www.googleapis.com/drive/v3/files/'+S.folderId+'?fields=id,mimeType,ownedByMe,trashed,driveId,capabilities(canAddChildren)&supportsAllDrives=true');assertDriveOwner(about,folder,S.bytes);}
  await destination();let request=0;
  const file={jobId:S.jobId,path:spool,sourceRevision:S.sourceRevision,completedAt:source.completedAt,bytes:S.bytes,sha256:S.sha256,md5:S.md5,statToken:stat(spoolStat)};
  try{
    await preserveOne(file,history,{
      recheck:async()=>{if(stat(await lstat(spool))!==file.statToken)throw Error('spool_changed');const id=++request;emit({event:'source-recheck',requestId:id});const ack=await next();if(ack.type!=='source-recheck-result'||ack.requestId!==id||ack.ok!==true||ack.sourceRevision!==S.sourceRevision||ack.sha256!==S.sha256||ack.statToken!==source.statToken)throw Error('source_recheck');},
      find:async()=>unwrap(await drive.findExistingArtifact(S.jobId,'thumbnail',S.sha256))?.id??null,
      start:async()=>{await destination();remoteAttempted=true;return unwrap(await drive.createResumableSession({filename:'english-thumbnail-'+S.thumbnailId+(source.mimeType==='image/jpeg'?'.jpg':'.png'),parentId:S.folderId,mimeType:source.mimeType,sizeBytes:S.bytes,jobId:S.jobId,kind:'thumbnail',sourceSha256:S.sha256}))},
      offset:async(uri,total)=>unwrap(await drive.queryResumableOffset(uri,total)),
      chunk:async(uri,_file,start,end)=>{remoteAttempted=true;const fd=await open(spool,constants.O_RDONLY|constants.O_NOFOLLOW);try{if(stat(await fd.stat())!==file.statToken)throw Error('spool_changed');const r=unwrap(await drive.uploadChunk({sessionUri:uri,localPath:'/proc/self/fd/'+fd.fd,start,end,totalBytes:S.bytes}));if(stat(await fd.stat())!==file.statToken)throw Error('spool_changed');return r.done?{fileId:r.file.id}:{nextOffset:r.nextOffset}}finally{await fd.close()}},
      verify:async(id)=>{if(!/^[\w-]{10,200}$/.test(id))throw Error('drive_id');await destination();const url='https://www.googleapis.com/drive/v3/files/'+id+'?fields=id,size,md5Checksum,mimeType,parents,ownedByMe,owners(emailAddress),trashed,version&supportsAllDrives=true';const m=await get(url);if(!m.ownedByMe||m.trashed||!m.owners?.some((o:any)=>o.emailAddress?.toLowerCase()==='konrad.schrein@gmail.com')||m.parents?.length!==1||m.parents[0]!==S.folderId||m.mimeType!==source.mimeType||Number(m.size)!==S.bytes||m.md5Checksum!==S.md5)throw Error('object_identity');const content=unwrap(await drive.inspectFileContent(id,S.bytes));if(content.sizeBytes!==S.bytes||content.sha256!==S.sha256)throw Error('object_bytes');if(JSON.stringify(await get(url))!==JSON.stringify(m))throw Error('object_changed');const found=unwrap(await drive.findExistingArtifact(S.jobId,'thumbnail',S.sha256));if(found?.id!==id)throw Error('object_reconciliation');},
      append,
    });
    emit({event:'complete',verified:true,verifiedFiles:1,fileId:history.at(-1)?.fileId,bytes:S.bytes,sha256:S.sha256,ledgerPath:ROOT+'/receipts.jsonl',manifestSha256:manifestSha,ledgerHead:head,sourceWrites:0,databaseWrites:0,pointerWrites:0});
  }catch{await append({jobId:S.jobId,stage:'uncertain'});throw Error('preservation_uncertain');}
}catch{emit({event:'complete',verified:false,uncertain:remoteAttempted,detailsWithheld:true,sourceWrites:0,databaseWrites:0,pointerWrites:0});process.exitCode=1;}
finally{await ledger?.close();await lock?.close();if(lockOwned)await unlink(ROOT+'/ledger.lock').catch(()=>undefined);}
