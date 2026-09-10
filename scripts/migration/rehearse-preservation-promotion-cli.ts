/** Fixed five, fixed staging DB. Rollback default; explicit commit requires a fresh full protected backup. */
import {execFileSync} from 'node:child_process';
import {readPrivatePreservationContext} from './preflight-preservation-receipts-cli';
import {preparePreservationParents} from './prepare-preservation-parents';
import {planPreservationPromotion} from './plan-preservation-promotion';
import {readDriveProof,readLocalProof} from './preservation-promotion-remote';
import {rehearsePromotion} from './preservation-promotion-transaction';
import {sha256Text} from './preserve-english-finals';
import {planPreservationReceipts} from './plan-preservation-receipts';
import {createPromotionBackup,verifyPromotionBackup,recordPromotionAudit} from './preservation-promotion-backup';
import {reconcilePreservationPromotion} from './reconcile-preservation-promotion';
const options=['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10'];
function ssh(alias:'vps2'|'cf-vps-deploy',command:string,input?:string,timeout=45000){return execFileSync('ssh',[...options,alias,command],{input,encoding:'utf8',timeout,maxBuffer:8*1024**2,stdio:['pipe','pipe','pipe']});}
function stoppedWriters(){
  const names=ssh('vps2',"docker ps --filter label=com.docker.compose.project=tutorial-recovery-staging --format '{{.Names}}'").trim().split(/\r?\n/).sort();
  const expected=['tutorial-recovery-staging-postgres-1','tutorial-recovery-staging-redis-1','tutorial-recovery-staging-web-1'].sort();
  if(JSON.stringify(names)!==JSON.stringify(expected))throw Error('staging_service_inventory');
  const config=JSON.parse(ssh('vps2',"docker inspect --format '{{json .Config.Cmd}}' tutorial-recovery-staging-web-1"));
  if(JSON.stringify(config)!==JSON.stringify(['node','--import','tsx','src/server/index.ts']))throw Error('staging_web_command');
  const env=Object.fromEntries(JSON.parse(ssh('vps2',"docker inspect --format '{{json .Config.Env}}' tutorial-recovery-staging-web-1")).map((line:string)=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)]}));
  if(['TUTORIAL_PUBLICATION_RECOVERY_ENABLED','TUTORIAL_AUTOMATIC_DELIVERY_RECOVERY_ENABLED','TUTORIAL_RETENTION_ENABLED'].some(key=>env[key]!=='false')||env.VEOFORGE_IMAGES_ENABLED!=='0')throw Error('staging_writer_flags');
  // Reject sidecar execs/workers in the web container, not just Compose names.
  const top=ssh('vps2','docker top tutorial-recovery-staging-web-1 -eo pid,args');
  const processes=top.trim().split(/\r?\n/).slice(1).map(row=>row.trim().replace(/^\d+\s+/,''));
  const main=processes.filter(p=>/^node --import tsx src\/server\/index\.ts$/.test(p));
  const children=processes.filter(p=>/^\/app\/node_modules\/.*\/esbuild --service=[\d.]+ --ping$/.test(p));
  if(main.length!==1||children.length>1||main.length+children.length!==processes.length)throw Error('staging_process_inventory');
}
function remoteCall(alias:'vps2'|'cf-vps-deploy',fn:Function,input:any,timeout=45000){
  const code=`(${fn.toString()})(${JSON.stringify(input)}).then(x=>process.stdout.write(JSON.stringify(x))).catch(()=>{process.stderr.write('REMOTE_CHECK_FAILED');process.exitCode=1});`;
  return JSON.parse(ssh(alias,alias==='vps2'?'docker exec -i --user 1000:1000 tutorial-recovery-staging-web-1 node':'node',code,timeout));
}
let stage='arguments';
const commit=process.argv.length===3&&process.argv[2]==='--commit-five-verified-originals';
let commitDispatched=false,commitAcknowledged=false,backup:any=null;
let savedPlan:any=null,savedContext:any=null,savedCurrent:any[]=[],savedPlanHash:string|null=null;
let remoteFailure:any=null;
function hostCall(fn:Function,input:any,timeout=45000){const code=`(${fn.toString()})(${JSON.stringify(input)}).then(x=>process.stdout.write(JSON.stringify(x))).catch(()=>{process.stderr.write('BACKUP_CHECK_FAILED');process.exitCode=1});`;return JSON.parse(ssh('vps2','node',code,timeout));}
try{
  if(!(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--rehearse')||commit))throw Error('invalid_mode');
  stage='writer_inventory';stoppedWriters();
  stage='private_context';const context=readPrivatePreservationContext(),prep=preparePreservationParents(context);
  const ids=context.ids.map(id=>`'${id}'::uuid`).join(',');
  stage='current_snapshot';const current=JSON.parse(ssh('vps2','docker exec -i tutorial-recovery-staging-postgres-1 psql -X -U tutorial_staging -d tutorial_staging_cf_20260908 -qAt -v ON_ERROR_STOP=1',`BEGIN READ ONLY; SELECT coalesce(json_agg(a),'[]') FROM storage_artifacts a WHERE job_id IN (${ids}) AND kind='final_video'; ROLLBACK;`));
  const incoming=planPreservationReceipts(context.inputs.manifest,context.manifestSha,context.inputs.ledger,sha256Text(context.inputs.ledger),prep.mappings);
  stage='fresh_drive_proof';const remote=remoteCall('cf-vps-deploy',readDriveProof,incoming.inserts,720000);
  stage='local_snapshot';const local=remoteCall('vps2',readLocalProof,context.manifest.entries);
  const missingParents=local.filter((x:any)=>!x.parentDirectoryReady).length,localConflicts=local.filter((x:any)=>!x.safePath||x.state==='conflict').length;
  if(missingParents||localConflicts){console.log(JSON.stringify({mode:'rollback-rehearsal',stopped:true,missingParentDirectories:missingParents,localConflicts,remoteVerified:remote.length,committedWrites:0,mediaWrites:0}));process.exitCode=1;}
  else{
    // Source/VPS clocks are authoritative; the operator PC may have clock skew.
    // Keep the same strict freshness rule as the SQL transaction, not a tolerance.
    const stagingNow=Number(ssh('vps2','docker exec -i tutorial-recovery-staging-postgres-1 psql -X -U tutorial_staging -d tutorial_staging_cf_20260908 -qAt -v ON_ERROR_STOP=1','SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint;').trim());
    stage='plan';const plan={...planPreservationPromotion(context,remote,local,current,stagingNow),localEntries:context.manifest.entries,localSnapshots:local};
    const planHash=sha256Text(JSON.stringify(plan));
    savedPlan=plan;savedContext=context;savedCurrent=current;savedPlanHash=planHash;
    if(commit){
      stage='protected_backup';backup=hostCall(createPromotionBackup,{planHash,manifestSha256:context.manifestSha,ledgerSha256:sha256Text(context.inputs.ledger),scope:'five-preserved-English-originals',intendedParents:plan.preparation.parents.length,intendedReceipts:5,intendedPointers:5},240000);
      stage='verify_protected_backup';hostCall(verifyPromotionBackup,backup);
    }
    stage='writer_inventory_recheck';stoppedWriters();
    if(commit){stage='private_attempt_audit';hostCall(recordPromotionAudit,{proof:backup,event:'before-commit',planHash,outcome:'dispatch_pending',intendedParents:plan.preparation.parents.length,intendedReceipts:5,intendedPointers:5});}
    stage=commit?'commit_transaction':'rollback_transaction';const code=`const localReader=${readLocalProof.toString()};(${rehearsePromotion.toString()})(${JSON.stringify(plan)},localReader,${JSON.stringify(commit?'commit-five-verified-originals':'rollback')},${JSON.stringify(backup)}).then(x=>process.stdout.write(JSON.stringify(x))).catch(e=>{process.stdout.write(JSON.stringify({remoteError:true,sqlCode:/^[A-Z0-9]{5}$/.test(e.code??'')?e.code:null,reason:['result_count','local_fence_changed','commit_outcome_uncertain','fixed_five_scope','verified_backup_required','backup_expired'].includes(e.message)?e.message:null,position:/^[0-9]+$/.test(e.position??'')?Number(e.position):null}));});`;
    commitDispatched=commit;
    const result=JSON.parse(ssh('vps2','docker exec -i --user 1000:1000 tutorial-recovery-staging-web-1 node',code,120000));
    if(result.remoteError){remoteFailure=result;throw Error('remote_transaction');}
    commitAcknowledged=result.commitPerformed===true;
    stage=commit?'post_commit':'post_rollback';const after=readPrivatePreservationContext();
    const afterCurrent=JSON.parse(ssh('vps2','docker exec -i tutorial-recovery-staging-postgres-1 psql -X -U tutorial_staging -d tutorial_staging_cf_20260908 -qAt -v ON_ERROR_STOP=1',`BEGIN READ ONLY; SELECT coalesce(json_agg(a),'[]') FROM storage_artifacts a WHERE job_id IN (${ids}) AND kind='final_video'; ROLLBACK;`));
    const sorted=(rows:any[])=>JSON.stringify([...rows].sort((a,b)=>String(a.id??a.artifactId).localeCompare(String(b.id??b.artifactId))));
    if(!commit){if(sorted(after.target.artifacts)!==sorted(context.target.artifacts)||sorted(after.target.versions)!==sorted(context.target.versions)||sorted(afterCurrent)!==sorted(current))throw Error('rollback_changed');}
    else{
      if(!commitAcknowledged||reconcilePreservationPromotion(plan,context,current,after,afterCurrent).currentState!=='exact_applied')throw Error('post_commit_conflict');
      stage='private_result_audit';hostCall(recordPromotionAudit,{proof:backup,event:'after-commit',planHash,outcome:'acknowledged_and_exactly_verified',result});
    }
    console.log(JSON.stringify({mode:commit?'committed-five-originals':'rollback-rehearsal',...result,remoteVerified:remote.length,locallyExact:local.filter((x:any)=>x.state==='exact').length,locallyAbsent:local.filter((x:any)=>x.state==='absent').length,priorPointersPreserved:plan.priorVersions.length,planHash,postRollbackUnchanged:commit?undefined:true,postCommitVerified:commit?true:undefined,backup:backup??undefined}));
  }
}catch(error){
  const known:Record<string,string>={'Prior immutable identity conflicts; reconcile before promotion':'prior_immutable_conflict','Active or uncertain storage upload must be reconciled first':'active_or_uncertain_upload','Unsafe prior media lease path':'unsafe_prior_path','Full current artifact snapshot required':'incomplete_snapshot','Current artifact snapshot mismatch':'artifact_snapshot_mismatch','Fresh exact Drive proof required':'fresh_drive_proof','Local path conflict or unsafe restore target':'local_target','Current English original revision mismatch':'current_revision'};
  const reason=known[error instanceof Error?error.message:'']??'private_details_withheld';
  let reconciliation:any={currentState:'not_attempted'};
  if(commitDispatched&&savedPlan){
    try{const after=readPrivatePreservationContext(),ids=savedPlan.updates.map((u:any)=>`'${u.jobId}'::uuid`).join(',');const current=JSON.parse(ssh('vps2','docker exec -i tutorial-recovery-staging-postgres-1 psql -X -U tutorial_staging -d tutorial_staging_cf_20260908 -qAt -v ON_ERROR_STOP=1',`BEGIN READ ONLY;SELECT coalesce(json_agg(a),'[]') FROM storage_artifacts a WHERE job_id IN (${ids}) AND kind='final_video';ROLLBACK;`));reconciliation=reconcilePreservationPromotion(savedPlan,savedContext,savedCurrent,after,current);}catch{reconciliation={currentState:'unavailable'};}
    try{hostCall(recordPromotionAudit,{proof:backup,event:'reconciliation',planHash:savedPlanHash,outcome:commitAcknowledged?'acknowledged_followup_failed':'commit_acknowledgment_unknown',reconciliation});}catch{/* Backup and before-commit audit remain protected; do not obscure uncertainty. */}
  }
  console.log(JSON.stringify({mode:commit?'commit-five-originals':'rollback-rehearsal',stopped:true,stage,reason,remoteFailure:remoteFailure??undefined,detailsWithheld:true,commitOutcome:commitDispatched?(commitAcknowledged?'acknowledged_needs_reconciliation':'uncertain_do_not_retry_blindly'):'not_attempted',reconciliation,committedWrites:commitDispatched?null:0,backup:backup??undefined,mediaWrites:0}));process.exitCode=1;
}
