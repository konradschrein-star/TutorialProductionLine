// Read-only source-server audit. Run over SSH stdin; never prints credentials.
// Checks recorded finished-video/thumbnail Drive IDs against current remote metadata.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const require = createRequire('/opt/content-forge/package.json');
require('dotenv').config({ path: '/opt/content-forge/.env', quiet: true });
process.chdir('/opt/content-forge');
const query = `SELECT coalesce(json_agg(x),'[]') FROM (
 SELECT kind, drive_file_id, bytes::text, drive_md5, checksum_sha256
 FROM storage_artifacts WHERE owner_kind='tutorial_job'
 AND kind IN ('final_video','thumbnail') AND state='uploaded'
 ORDER BY uploaded_at DESC NULLS LAST, id) x`;
const records = JSON.parse(execFileSync('docker', ['exec', 'content-forge-postgres', 'psql', '-U', 'postgres', '-d', 'content_forge', '-At', '-c', query], {encoding:'utf8', maxBuffer: 16*1024*1024}));
let clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
let clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
 const parsed = JSON.parse(readFileSync(process.env.GOOGLE_OAUTH_CLIENT_SECRET_FILE, 'utf8'));
 const client = parsed.web ?? parsed.installed ?? parsed;
 clientId ??= client.client_id; clientSecret ??= client.client_secret;
}
const refreshToken = readFileSync(process.env.GOOGLE_DRIVE_REFRESH_TOKEN_FILE, 'utf8').trim();
const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {method:'POST', body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'}), signal:AbortSignal.timeout(20000)});
if (!tokenResponse.ok) throw new Error(`Drive credential refresh failed: HTTP ${tokenResponse.status}; response body withheld`);
const token = await tokenResponse.json();
if (!token.access_token) throw new Error('Drive access token absent');
if (process.argv.includes('--missing-folders')) {
 const missingQuery=`SELECT coalesce(json_agg(x),'[]') FROM (
 SELECT j.id, v.filename, (SELECT a.drive_folder_id FROM storage_artifacts a
 WHERE a.job_id=j.id AND a.owner_kind='tutorial_job' AND a.state='uploaded'
 AND a.drive_folder_id IS NOT NULL ORDER BY a.uploaded_at DESC LIMIT 1) AS folder
 FROM tutorial_jobs j LEFT JOIN storage_artifacts v ON v.job_id=j.id
 AND v.owner_kind='tutorial_job' AND v.kind='final_video'
 WHERE j.status='COMPLETED' AND (v.id IS NULL OR v.state<>'uploaded' OR v.drive_file_id IS NULL)) x`;
 const missing=JSON.parse(execFileSync('docker',['exec','content-forge-postgres','psql','-U','postgres','-d','content_forge','-At','-c',missingQuery],{encoding:'utf8',maxBuffer:4*1024*1024}));
 const summary={jobs:missing.length,noKnownFolder:0,folderUnavailable:0,noMatchingVideo:0,exactNameCandidates:0,otherVideoCandidates:0,requestFailed:0};
 let next=0;
 await Promise.all(Array.from({length:4},async()=>{
  while(next<missing.length) {
   const row=missing[next++];
   if(!row.folder || !/^[A-Za-z0-9_-]+$/.test(row.folder)){summary.noKnownFolder++;continue;}
   try {
    const url=new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q',`'${row.folder}' in parents and trashed=false`);
    url.searchParams.set('fields','nextPageToken,files(id,name,mimeType,size)');
    url.searchParams.set('pageSize','1000');url.searchParams.set('supportsAllDrives','true');url.searchParams.set('includeItemsFromAllDrives','true');
    const response=await fetch(url,{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(15000)});
    if(!response.ok){summary.folderUnavailable++;continue;}
    const data=await response.json();
    if(data.nextPageToken){summary.requestFailed++;continue;}
    const videos=data.files.filter(file=>file.mimeType?.startsWith('video/')||/\.mp4$/i.test(file.name));
    if(row.filename && videos.some(file=>file.name===row.filename))summary.exactNameCandidates++;
    else if(videos.length)summary.otherVideoCandidates++;
    else summary.noMatchingVideo++;
   }catch{summary.requestFailed++;}
  }
 }));
 console.log(JSON.stringify({phase:'missing-folder-audit',summary,note:'Filename candidates are recovery leads, not checksum-verified deliveries. No known folder does not prove no copy exists elsewhere. No files changed.'}));
}
const selected = process.argv.includes('--missing-folders') ? [] : process.argv.includes('--all') ? records : records.slice(0,20);
const counts = {}; let cursor=0, completed=0;
const count = (kind, result) => { counts[kind] ??= {}; counts[kind][result]=(counts[kind][result]??0)+1; };
console.log(JSON.stringify({phase:'start',recordedUploaded:records.length,checking:selected.length,mode:'read-only-metadata-no-delete'}));
await Promise.all(Array.from({length:4},async()=>{
 while(cursor<selected.length) {
  const record=selected[cursor++];
  try {
   if (!record.drive_file_id) { count(record.kind,'missing_recorded_id'); continue; }
   const url=new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(record.drive_file_id)}`);
   url.searchParams.set('fields','id,size,md5Checksum,sha256Checksum,trashed');
   url.searchParams.set('supportsAllDrives','true');
   let response;
   for(let attempt=0;attempt<3;attempt++) {
    response=await fetch(url,{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(15000)});
    if(response.status!==429 && response.status<500) break;
    await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
   }
   if(!response.ok) {count(record.kind,`http_${response.status}`);continue;}
   const file=await response.json();
   if(file.trashed) count(record.kind,'trashed');
   else if(!record.bytes || !record.drive_md5) count(record.kind,'insufficient_recorded_evidence');
   else if(file.size!==record.bytes || file.md5Checksum!==record.drive_md5) count(record.kind,'size_or_checksum_mismatch');
   else if(record.checksum_sha256 && file.sha256Checksum && record.checksum_sha256!==file.sha256Checksum) count(record.kind,'sha256_mismatch');
   else count(record.kind,'remote_matches_recorded_upload');
  } catch { count(record.kind,'request_failed'); }
  finally {
   completed++;
   if(completed%250===0) console.log(JSON.stringify({phase:'progress',completed,total:selected.length,counts}));
  }
 }
}));
console.log(JSON.stringify({phase:'complete',completed,counts,cleanupAuthorized:false,note:'Metadata check proves current Drive copy matches recorded upload, not current local bytes. No files changed.'}));
