// Read-only local-byte inventory on Content Forge. No credentials or paths emitted.
import { execFileSync } from 'node:child_process';
import { statSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';
const mediaRoot='/opt/content-forge/media/tutorial';
const query=`SELECT coalesce(json_agg(x),'[]') FROM (
 SELECT j.id,j.status,j.final_path,j.recording_path,j.audio_path,
 EXISTS (SELECT 1 FROM storage_artifacts a WHERE a.job_id=j.id AND a.owner_kind='tutorial_job' AND a.kind='final_video' AND a.state='uploaded' AND a.drive_file_id IS NOT NULL) AS video_archived,
 EXISTS (SELECT 1 FROM storage_artifacts a WHERE a.job_id=j.id AND a.owner_kind='tutorial_job' AND a.kind='raw_recording' AND a.state='uploaded' AND a.drive_file_id IS NOT NULL) AS raw_archived
 FROM tutorial_jobs j) x`;
const rows=JSON.parse(execFileSync('docker',['exec','content-forge-postgres','psql','-U','postgres','-d','content_forge','-At','-c',query],{encoding:'utf8',maxBuffer:32*1024*1024}));
const completedMissing={jobs:0,localFinalPresent:0,localRawPresent:0,localAudioPresent:0};
const activeIds=new Set();
const byStatus={};
function present(path) {
 if(!path) return false;
 const full=resolve(path), rel=relative(mediaRoot,full);
 if(rel.startsWith('..')||isAbsolute(rel)) return false;
 try {return statSync(full).isFile();} catch {return false;}
}
for(const row of rows) {
 byStatus[row.status]??={jobs:0,missingLocalFinal:0}; byStatus[row.status].jobs++;
 if(!present(row.final_path)) byStatus[row.status].missingLocalFinal++;
 if(!['COMPLETED','CANCELLED'].includes(row.status)) activeIds.add(row.id);
 if(row.status==='COMPLETED'&&!row.video_archived) {
  completedMissing.jobs++;
  if(present(row.final_path)) completedMissing.localFinalPresent++;
  if(present(row.recording_path)) completedMissing.localRawPresent++;
  if(present(row.audio_path)) completedMissing.localAudioPresent++;
 }
}
const bytes={activeJobDirectories:0,otherJobDirectories:0,symlinksSkipped:0,files:0};
function walk(path,active) {
 for(const name of readdirSync(path)) {
  const full=join(path,name);let s;try{s=lstatSync(full);}catch{continue;}
  if(s.isSymbolicLink()){bytes.symlinksSkipped++;continue;}
  if(s.isDirectory())walk(full,active);
  else if(s.isFile()){bytes.files++;bytes[active?'activeJobDirectories':'otherJobDirectories']+=s.size;}
 }
}
for(const name of readdirSync(mediaRoot)) {
 const path=join(mediaRoot,name);const s=lstatSync(path);
 if(s.isDirectory()&&!s.isSymbolicLink())walk(path,activeIds.has(name));
}
console.log(JSON.stringify({mode:'read-only',byStatus,completedWithoutRecordedDriveVideo:completedMissing,bytes,note:'Directory bytes are a migration estimate, not a safe deletion list. Pending locale/source dependencies still require mapping.'}));
