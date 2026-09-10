// Read-only classification of historical final-video exceptions. No paths or credentials printed.
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
const root = '/opt/content-forge/media/tutorial';
const query = `SELECT coalesce(json_agg(x),'[]') FROM (
 SELECT j.language,(to_jsonb(j)->>'source_job_id') IS NOT NULL AS translated,
 (to_jsonb(j)->>'parent_job_id') IS NOT NULL AS segment,j.final_path,j.recording_path,
 EXISTS(SELECT 1 FROM storage_artifacts a WHERE a.job_id=j.id
 AND a.owner_kind='tutorial_job' AND a.kind='final_video'
 AND a.state='uploaded' AND a.drive_file_id IS NOT NULL) AS archived
 FROM tutorial_jobs j WHERE j.status='COMPLETED') x`;
const rows = JSON.parse(execFileSync('docker',['exec','content-forge-postgres','psql','-U','postgres','-d','content_forge','-At','-c',query],{encoding:'utf8',maxBuffer:16*1024*1024}));
function present(path) {
  if (!path) return false;
  const full=resolve(path), rel=relative(root, full);
  if (rel.startsWith('..') || isAbsolute(rel)) return false;
  try { return statSync(full).isFile(); } catch { return false; }
}
const groups = {};
for (const row of rows) {
  const lang=String(row.language || '').toLowerCase();
  const kind=row.translated ? 'translation_child' : row.segment ? 'segment_child' : lang === 'en' || lang === 'english' || lang.startsWith('en-') ? 'explicit_english_original' : !lang ? 'original_language_unknown' : 'other_language_original';
  const g=groups[kind]??={completed:0,withoutRecordedDriveVideo:0,localFinalPresentAmongExceptions:0,rawPresentAmongExceptions:0};
  g.completed++;
  if (!row.archived) {
    g.withoutRecordedDriveVideo++;
    if (present(row.final_path)) g.localFinalPresentAmongExceptions++;
    if (present(row.recording_path)) g.rawPresentAmongExceptions++;
  }
}
console.log(JSON.stringify({mode:'read_only',source:'Content Forge VPS1',groups,note:'Unknown-language records are not inferred English. Upload receipt presence is not a fresh remote-byte verification. No files modified.'}));
