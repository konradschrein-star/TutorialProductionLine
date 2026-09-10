import { describe, expect, it } from "vitest";
import { preparePreservationParents } from "../prepare-preservation-parents";
import { preservationSourceRevision } from "../preflight-preservation-receipts-cli";
import { sha256Text, PRESERVATION_VERSION, EXPECTED_OWNER } from "../preserve-english-finals";
function fixture() {
  const runtime=Array.from({length:5},(_,i)=>({id:`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`,channel_id:'20000000-0000-4000-8000-000000000000',language:'en',status:'COMPLETED',source_job_id:null,parent_job_id:null,final_path:`/opt/content-forge/media/tutorial/${i}.mp4`,completed_at:'2026-09-09T00:00:00Z',recording_path:null,audio_path:null,recorded_at:null,script_text:'synthetic'}));
  const entries=runtime.map((j,i)=>({jobId:j.id,path:j.final_path,sourceRevision:preservationSourceRevision(j),completedAt:j.completed_at,bytes:i===4?18224531:10000000,sha256:'a'.repeat(64),md5:'b'.repeat(32),statToken:'private'}));
  const manifest={version:PRESERVATION_VERSION,expectedOwner:EXPECTED_OWNER,folderId:'synthetic-folder',entries},text=JSON.stringify(manifest),manifestSha=sha256Text(text);let previousHash='';
  const ledger=entries.map((e,i)=>{const r={jobId:e.jobId,stage:'verified',fileId:`synthetic-file-${i}`,sha256:e.sha256,bytes:e.bytes,manifestSha256:manifestSha,sequence:i+1,at:e.completedAt,previousHash};previousHash=sha256Text(JSON.stringify(r));return JSON.stringify({...r,hash:previousHash})}).join('\n')+'\n';
  return {manifest,manifestSha,inputs:{manifest:text,ledger},target:{runtime,archives:runtime.map(j=>({sourceId:j.id,raw:JSON.stringify(j),snapshotSha:sha256Text(JSON.stringify(j))})),artifacts:runtime.slice(0,2).map(j=>({jobId:j.id,artifactId:j.id,ownerKind:'tutorial_job',kind:'final_video'})),versions:[]}};
}
describe('staging preservation parent preparation',()=>{
  it('prepares only three skipped parents and five immutable versions',()=>{const p=preparePreservationParents(fixture());expect(p.parents).toHaveLength(3);expect(p.history.inserts).toHaveLength(5);for(const row of p.parents)expect(row).toMatchObject({state:'skipped',drive_file_id:null,verified_at:null,bytes:null,checksum_sha256:null,error_kind:'preservation_history_only'});expect(p.history.currentPointersChanged).toBe(0)});
  it('has deterministic parent IDs and plans',()=>expect(preparePreservationParents(fixture())).toEqual(preparePreservationParents(fixture())));
  it('rejects stale current source data',()=>{const f=fixture();f.target.runtime[0]!.script_text='changed';expect(()=>preparePreservationParents(f)).toThrow('revision')});
  it('rejects unrelated-format unique-key collisions',()=>{const f=fixture();f.target.artifacts[0]!.ownerKind='content_job';expect(()=>preparePreservationParents(f)).toThrow('ownership')});
  it('refuses missing runtime jobs instead of fabricating them',()=>{const f=fixture();f.target.runtime.pop();expect(()=>preparePreservationParents(f)).toThrow('revision')});
});
