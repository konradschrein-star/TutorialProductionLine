import {planPreservationReceipts} from './plan-preservation-receipts';
import {sha256Text} from './preserve-english-finals';
export function reconcilePreservationPromotion(plan:any,before:any,beforeCurrent:any[],after:any,current:any[]) {
  const sorted=(rows:any[])=>JSON.stringify([...rows].sort((a,b)=>String(a.id??a.artifactId).localeCompare(String(b.id??b.artifactId))));
  if(sorted(after.target.runtime)!==sorted(before.target.runtime))return {currentState:'conflict',runtimeUnchanged:false};
  const pointersExact=plan.updates.every((update:any)=>{const matches=current.filter(a=>a.id===update.artifactId);return matches.length===1&&matches[0].job_id===update.jobId&&matches[0].owner_kind==='tutorial_job'&&matches[0].kind==='final_video'&&Object.entries(update.values).every(([key,value])=>['verified_at','uploaded_at'].includes(key)?Date.parse(matches[0][key])===Date.parse(String(value)):matches[0][key]===value)});
  if(pointersExact){
    try{const verified=planPreservationReceipts(after.inputs.manifest,after.manifestSha,after.inputs.ledger,sha256Text(after.inputs.ledger),plan.preparation.mappings,after.target.versions);if(verified.alreadyRecorded===5)return{currentState:'exact_applied',runtimeUnchanged:true};}catch{/* Evidence conflict is not a success. */}
  }
  if(sorted(current)===sorted(beforeCurrent)&&sorted(after.target.versions)===sorted(before.target.versions)&&sorted(after.target.artifacts)===sorted(before.target.artifacts))return{currentState:'unchanged',runtimeUnchanged:true};
  return{currentState:'conflict',runtimeUnchanged:true};
}
