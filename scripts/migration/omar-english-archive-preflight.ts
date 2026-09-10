/** Fixed source host. Read-only DB/Drive; exclusive private manifest creation only. No upload mode. */
import {execFileSync} from 'node:child_process';
import {constants} from 'node:fs';
import {lstat,open,mkdtemp} from 'node:fs/promises';
import {basename,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {loadStorageConfig} from '../../packages/storage/src/config';
import {DriveTokenProvider} from '../../packages/storage/src/drive/auth';
import {assertDriveOwner,sha256Text} from './preserve-english-finals';
import {OMAR_ARCHIVE as S,archiveRevision,validateArchive,type ArchiveEntry} from './omar-english-archive-policy';
const sql=`SELECT coalesce(json_agg(x ORDER BY id),'[]') FROM(SELECT j.id,j.status,j.language,j.final_path,j.recording_path,j.audio_path,j.completed_at,j.output_qa_status,j.delivered_to_drive,j.parent_job_id,j.source_job_id,md5(coalesce(j.script_text,'')) AS script_digest FROM tutorial_jobs j WHERE language='English' AND status='COMPLETED' AND final_path IS NOT NULL AND NOT EXISTS(SELECT 1 FROM storage_artifacts a WHERE a.job_id=j.id AND a.kind='final_video')) x`;
const rows=()=>JSON.parse(execFileSync('sudo',['-u','postgres','psql','-X','-d','tutorial_studio','-qAt','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',maxBuffer:1048576}));
const token=(s:any)=>JSON.stringify([s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs]);
async function safe(path:string){if(!path.startsWith(S.root+'/')||path.split('/').some(p=>p==='..'||p==='.') )throw Error('path_scope');for(let p=dirname(path);p!=='/';p=dirname(p)){const s=await lstat(p);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o022))throw Error('unsafe_ancestor');}const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size<=0)throw Error('unsafe_file');return token(s);}
async function main(){
 if(process.platform!=='linux'||process.getuid?.()!==0||process.argv.length>2)throw Error('fixed_preflight_only');
 const selected=rows();if(selected.length!==16||selected.some((r:any)=>r.delivered_to_drive||r.parent_job_id||r.source_job_id||![null,'failed'].includes(r.output_qa_status)))throw Error('selection_changed');
 const entries:ArchiveEntry[]=[];
 for(const r of selected){const statToken=await safe(r.final_path),f=await open(r.final_path,constants.O_RDONLY|constants.O_NOFOLLOW),sha=createHash('sha256'),md5=createHash('md5');let bytes=0;try{if(token(await f.stat())!==statToken)throw Error('changed');for await(const b of f.createReadStream({autoClose:false})){sha.update(b);md5.update(b);bytes+=b.length;}if(token(await f.stat())!==statToken)throw Error('changed');}finally{await f.close();}if(await safe(r.final_path)!==statToken)throw Error('changed');entries.push({jobId:r.id,path:r.final_path,filename:basename(r.final_path),qa:r.output_qa_status??'unmeasured',completedAt:r.completed_at,sourceRevision:archiveRevision(r),bytes,sha256:sha.digest('hex'),md5:md5.digest('hex'),statToken});}
 if(archiveRevision(rows())!==archiveRevision(selected))throw Error('rows_changed');
 const pm=JSON.parse(execFileSync('pm2',['jlist'],{encoding:'utf8',maxBuffer:8388608})),env=pm.find((p:any)=>p.name==='tutorial-worker')?.pm2_env;if(!env||env.pm_cwd!=='/opt/tutorial-studio/apps/worker-orchestrator')throw Error('host_identity');
 const cfg=loadStorageConfig(env);if(!cfg.enabled)throw Error('drive_disabled');const tok=await new DriveTokenProvider(cfg.drive.auth).getToken();if(!tok.ok)throw Error('auth');const get=async(url:string)=>{const r=await fetch(url,{headers:{Authorization:'Bearer '+tok.value.token},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('drive_read');return r.json();};
 const about=await get('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress),storageQuota'),folder=await get('https://www.googleapis.com/drive/v3/files/'+S.parent+'?fields=id,mimeType,ownedByMe,trashed,driveId,capabilities(canAddChildren)');assertDriveOwner(about,folder,S.bytes);
 const m=validateArchive({version:S.version,parentId:S.parent,folderName:'Recovery archive - Omar English - NOT APPROVED - 20260909',createdAt:new Date().toISOString(),entries}),text=JSON.stringify(m),dir=await mkdtemp('/var/tmp/omar-english-archive-');const f=await open(dir+'/manifest.json','wx',0o600);try{await f.writeFile(text);await f.sync();}finally{await f.close();}const d=await open(dir,'r');try{await d.sync();}finally{await d.close();}
 console.log(JSON.stringify({mode:'preflight',manifestPath:dir+'/manifest.json',manifestSha256:sha256Text(text),files:16,bytes:S.bytes,failedQa:5,unmeasuredQa:11,parentId:S.parent,newFolderRequired:true,driveWrites:0,databaseWrites:0}));
}
main().catch(e=>{const safeCodes=['fixed_preflight_only','selection_changed','path_scope','unsafe_ancestor','unsafe_file','changed','rows_changed','host_identity','drive_disabled','auth','drive_read'];console.error(JSON.stringify({stopped:true,reason:safeCodes.includes(e?.message)?e.message:'details_withheld',driveWrites:0,databaseWrites:0}));process.exitCode=1});
