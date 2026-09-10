/** Exact-one read-only preparation; no uploads, copies, source or DB writes. */
import {execFileSync} from 'node:child_process';
import {sha256Text} from './preserve-english-finals';
const JOB='48790ac0-6ad1-4ce6-8ac4-7f7c26c428a6',THUMB='70175471-10ac-4d26-81d5-da503701b942';
function ssh(host:string,command:string,input:string){return execFileSync('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10',host,command],{input,encoding:'utf8',timeout:60000,maxBuffer:1024*1024,stdio:['pipe','pipe','pipe']});}
try{
if(process.argv.length!==2)throw Error('read_only');
const destination=JSON.parse(ssh('vps2','docker exec -i tutorial-recovery-staging-postgres-1 psql -X -U tutorial_staging -d tutorial_staging_cf_20260908 -qAt -v ON_ERROR_STOP=1',`BEGIN READ ONLY; SELECT json_build_object('folderId',drive_folder_id,'videoId',drive_file_id) FROM storage_artifacts WHERE job_id='${JOB}'::uuid AND owner_kind='tutorial_job' AND kind='final_video' AND state='uploaded' AND verified_at IS NOT NULL; ROLLBACK;`));
if(!/^[\w-]{10,200}$/.test(destination.folderId))throw Error('existing_exact_folder');
const code=`const fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
(async()=>{
const query="BEGIN READ ONLY;SELECT json_build_object('thumbnail',(SELECT row_to_json(t) FROM (SELECT id,subject_id,subject_kind,language,status,is_selected,review_verdict,output_path,updated_at FROM thumbnails WHERE id='${THUMB}'::uuid AND subject_id='${JOB}'::uuid)t),'job',(SELECT row_to_json(j) FROM (SELECT id,status,channel_id,final_path FROM tutorial_jobs WHERE id='${JOB}'::uuid)j));ROLLBACK;";
function rows(){return JSON.parse(execFileSync('docker',['exec','content-forge-postgres','psql','-X','-U','postgres','-d','content_forge','-qAt','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
const before=rows(),t=before.thumbnail,p=t?.output_path;
if(!t?.is_selected||t.status!=='completed'||!['en','english'].includes(t.language?.toLowerCase())||typeof p!=='string'||!p.startsWith('/opt/content-forge/media/thumbnails/${JOB}/')||require('node:path').posix.normalize(p)!==p)throw Error('source_selection');
let parent='';for(const part of require('node:path').dirname(p).split('/').filter(Boolean)){parent+='/'+part;const s=fs.lstatSync(parent);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o022))throw Error('source_ancestor');}
const s=fs.lstatSync(p),stable=x=>JSON.stringify([x.dev,x.ino,x.size,x.mtimeMs,x.ctimeMs]);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size!==146123)throw Error('source_file');
const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let content;
try{if(stable(fs.fstatSync(fd))!==stable(s))throw Error('source_changed');content=fs.readFileSync(fd);if(stable(fs.fstatSync(fd))!==stable(s)||stable(fs.lstatSync(p))!==stable(s))throw Error('source_changed');}finally{fs.closeSync(fd);}
if(JSON.stringify(before)!==JSON.stringify(rows()))throw Error('selection_changed');
const sha256=crypto.createHash('sha256').update(content).digest('hex'),md5=crypto.createHash('md5').update(content).digest('hex'),sourceRevision=crypto.createHash('sha256').update(JSON.stringify(before)).digest('hex');
const env=createRequire('/opt/content-forge/package.json')('dotenv').parse(fs.readFileSync('/opt/content-forge/.env'));process.chdir('/opt/content-forge');
let id=env.GOOGLE_DRIVE_CLIENT_ID,secret=env.GOOGLE_DRIVE_CLIENT_SECRET;if(!id||!secret){const raw=JSON.parse(fs.readFileSync(env.GOOGLE_OAUTH_CLIENT_SECRET_FILE,'utf8')),c=raw.web??raw.installed??raw;id??=c.client_id;secret??=c.client_secret;}
const refresh=env.GOOGLE_DRIVE_REFRESH_TOKEN??fs.readFileSync(env.GOOGLE_DRIVE_REFRESH_TOKEN_FILE,'utf8').trim();
const auth=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:id,client_secret:secret,refresh_token:refresh,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});if(!auth.ok)throw Error('auth');const token=(await auth.json()).access_token;
async function get(url){const r=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('metadata');return r.json();}
const about=await get('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress),storageQuota');
const folder=await get('https://www.googleapis.com/drive/v3/files/${destination.folderId}?fields=id,mimeType,ownedByMe,trashed,driveId,capabilities(canAddChildren)&supportsAllDrives=true');
const video=await get('https://www.googleapis.com/drive/v3/files/${destination.videoId}?fields=id,parents,ownedByMe,trashed&supportsAllDrives=true');
if(about.user?.emailAddress?.toLowerCase()!=='konrad.schrein@gmail.com'||folder.mimeType!=='application/vnd.google-apps.folder'||!folder.ownedByMe||folder.trashed||folder.driveId||!folder.capabilities?.canAddChildren||!video.ownedByMe||video.trashed||!video.parents?.includes(folder.id))throw Error('destination');
const q=about.storageQuota;if(!q||!/^\\d+$/.test(q.usage??'')||(q.limit!==undefined&&(!/^\\d+$/.test(q.limit)||BigInt(q.limit)-BigInt(q.usage)<BigInt(146123+100*1024*1024))))throw Error('quota');
process.stdout.write(JSON.stringify({jobId:'${JOB}',thumbnailId:'${THUMB}',bytes:content.length,sha256,md5,sourceRevision,sourceSelectionPinned:true,account:'konrad.schrein@gmail.com',destinationFolderId:folder.id,destinationSameAsVerifiedOriginal:true,destinationWritable:true,driveHeadroomVerified:true,databaseWrites:0,sourceWrites:0,uploads:0}));
})().catch(()=>{process.stderr.write('PRIVATE_PLAN_FAILED');process.exitCode=1});`;
const result=JSON.parse(ssh('cf-vps-deploy','node',code));console.log(JSON.stringify({...result,planHash:sha256Text(JSON.stringify(result))}));
}catch{console.log(JSON.stringify({stopped:true,detailsWithheld:true,databaseWrites:0,sourceWrites:0,uploads:0}));process.exitCode=1;}
