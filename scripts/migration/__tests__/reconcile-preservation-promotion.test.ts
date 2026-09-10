import {describe,expect,it} from 'vitest';
import {fixture} from './preservation-fixture';
import {preparePreservationParents} from '../prepare-preservation-parents';
import {planPreservationPromotion} from '../plan-preservation-promotion';
import {reconcilePreservationPromotion} from '../reconcile-preservation-promotion';
function sample(){
  const before:any=fixture(),p=preparePreservationParents(before),now=Date.parse('2026-09-09T00:01:00Z');
  const old=before.target.artifacts.map((a:any)=>({id:a.artifactId,job_id:a.jobId,owner_kind:'tutorial_job',kind:'final_video',drive_file_id:null,state:'skipped',vps_path:before.manifest.entries.find((e:any)=>e.jobId===a.jobId).path,updated_at:'2026-09-09T00:00:00Z'}));
  const remote=p.history.inserts.map(v=>({fileId:v.drive_file_id,ownerMatches:true,ownedByMe:true,trashed:false,bytes:v.bytes,sha256:v.checksum_sha256,md5:v.drive_md5,checkedAt:'2026-09-09T00:00:30Z',parentIds:['actual-parent']}));
  const local=before.manifest.entries.map((e:any)=>({jobId:e.jobId,safePath:true,parentDirectoryReady:true,state:'absent'}));
  const plan=planPreservationPromotion(before,remote as any,local,old,now),after=structuredClone(before);
  after.target.artifacts=plan.preparation.mappings.map(a=>({jobId:a.jobId,artifactId:a.artifactId,ownerKind:'tutorial_job',kind:'final_video'}));
  after.target.versions=structuredClone(plan.incomingVersions);
  const current=plan.updates.map(u=>({id:u.artifactId,job_id:u.jobId,owner_kind:'tutorial_job',kind:'final_video',updated_at:'2026-09-09T00:01:00Z',...u.values,verified_at:u.values.verified_at.replace('Z','+00:00'),uploaded_at:u.values.uploaded_at.replace('Z','+00:00')}));
  return{before,after,old,current,plan,remote,local,now};
}
describe('post-commit exact reconciliation and retry',()=>{
  it('recognizes applied state without relying on network acknowledgement',()=>{const s=sample();expect(reconcilePreservationPromotion(s.plan,s.before,s.old,s.after,s.current).currentState).toBe('exact_applied')});
  it('recognizes unchanged rollback and rejects partial or changed runtime state',()=>{const s=sample();expect(reconcilePreservationPromotion(s.plan,s.before,s.old,s.before,s.old).currentState).toBe('unchanged');s.current[0]!.drive_file_id='different';expect(reconcilePreservationPromotion(s.plan,s.before,s.old,s.after,s.current).currentState).toBe('conflict');s.after.target.runtime[0].status='changed';expect(reconcilePreservationPromotion(s.plan,s.before,s.old,s.after,s.current).runtimeUnchanged).toBe(false)});
  it('replans already applied receipts without new parents or timestamp-format conflicts',()=>{const s=sample(),retry=planPreservationPromotion(s.after,s.remote as any,s.local,s.current,s.now);expect(retry.preparation.parents).toHaveLength(0);expect(retry.preparation.history.alreadyRecorded).toBe(5);expect(retry.updates).toHaveLength(5)});
});
