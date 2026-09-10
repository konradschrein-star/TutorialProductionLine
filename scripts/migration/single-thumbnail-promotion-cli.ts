/** Fixed singleton staging promotion. Rollback default; explicit commit requires new protected backup. */
import {execFileSync} from 'node:child_process';
import {SINGLE_THUMBNAIL as S} from './single-thumbnail-policy';
import {inspectSingleThumbnailSource} from './single-thumbnail-source';
import {readDriveProof,readLocalProof} from './preservation-promotion-remote';
import {planSingleThumbnailPromotion} from './single-thumbnail-promotion-plan';
import {promoteSingleThumbnail} from './single-thumbnail-promotion-transaction';
import {createPromotionBackup,verifyPromotionBackup,recordPromotionAudit} from './preservation-promotion-backup';
import {sha256Text} from './preserve-english-finals';
const options=['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10'];
const commit=process.argv.length===3&&process.argv[2]==='--commit-single-thumbnail';
let stage='arguments',dispatched=false,acknowledged=false,backup:any=null,plan:any=null,before:any=null,planHash:string|null=null;
function ssh(host:string,command:string,input?:string,timeout=45000){return execFileSync('ssh',[...options,host,command],{input,encoding:'utf8',timeout,maxBuffer:4*1024**2,stdio:['pipe','pipe','pipe']})}
function call(host:string,fn:Function,input:any,web=false,timeout=45000){return JSON.parse(ssh(host,web?'docker exec -i --user 1000:1000 tutorial-recovery-staging-web-1 node':'node',`(${fn.toString()})(${JSON.stringify(input)}).then(x=>process.stdout.write(JSON.stringify(x))).catch(()=>{process.stderr.write('PRIVATE_CHECK_FAILED');process.exitCode=1});`,timeout))}
function target(){return JSON.parse(ssh('vps2','docker exec -i tutorial-recovery-staging-postgres-1 psql -X -U tutorial_staging -d tutorial_staging_cf_20260908 -qAt -v ON_ERROR_STOP=1',`BEGIN READ ONLY;SELECT json_build_object('job',(SELECT to_jsonb(j) FROM tutorial_jobs j WHERE id='${S.jobId}'::uuid),'thumbnail',(SELECT to_jsonb(t) FROM thumbnails t WHERE id='${S.thumbnailId}'::uuid),'selectedCount',(SELECT count(*) FROM thumbnails WHERE subject_kind='tutorial_job' AND subject_id='${S.jobId}'::uuid AND language='en' AND is_selected),'artifacts',(SELECT coalesce(json_agg(a),'[]') FROM storage_artifacts a WHERE job_id='${S.jobId}'::uuid AND kind='thumbnail'),'versions',(SELECT coalesce(json_agg(v),'[]') FROM storage_artifact_versions v JOIN storage_artifacts a ON a.id=v.artifact_id WHERE a.job_id='${S.jobId}'::uuid AND a.kind='thumbnail'),'now',floor(extract(epoch from clock_timestamp())*1000)::bigint);ROLLBACK;`))}
function inventory(){
  const names=ssh('vps2',"docker ps --filter label=com.docker.compose.project=tutorial-recovery-staging --format '{{.Names}}'").trim().split(/\r?\n/).sort();if(JSON.stringify(names)!==JSON.stringify(['tutorial-recovery-staging-postgres-1','tutorial-recovery-staging-redis-1','tutorial-recovery-staging-web-1']))throw Error('staging_workers');
  const cmd=JSON.parse(ssh('vps2',"docker inspect --format '{{json .Config.Cmd}}' tutorial-recovery-staging-web-1"));if(JSON.stringify(cmd)!==JSON.stringify(['node','--import','tsx','src/server/index.ts']))throw Error('staging_command');
  const env=Object.fromEntries(JSON.parse(ssh('vps2',"docker inspect --format '{{json .Config.Env}}' tutorial-recovery-staging-web-1")).map((s:string)=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)]}));if(['TUTORIAL_PUBLICATION_RECOVERY_ENABLED','TUTORIAL_AUTOMATIC_DELIVERY_RECOVERY_ENABLED','TUTORIAL_RETENTION_ENABLED'].some(k=>env[k]!=='false')||env.VEOFORGE_IMAGES_ENABLED!=='0')throw Error('staging_flags');
  const procs=ssh('vps2','docker top tutorial-recovery-staging-web-1 -eo pid,args').trim().split(/\r?\n/).slice(1).map(s=>s.trim().replace(/^\d+\s+/,''));if(procs.filter(s=>s==='node --import tsx src/server/index.ts').length!==1||procs.some(s=>s!=='node --import tsx src/server/index.ts'&&!/^\/app\/node_modules\/.*\/esbuild --service=[\d.]+ --ping$/.test(s)))throw Error('staging_processes');
}
const normalized=(t:any)=>JSON.stringify({...t,now:0,artifacts:[...t.artifacts].sort((a,b)=>a.id.localeCompare(b.id)),versions:[...t.versions].sort((a,b)=>a.id.localeCompare(b.id))});
function reconcile(after:any){
  if(JSON.stringify(before.job)!==JSON.stringify(after.job)||JSON.stringify(before.thumbnail)!==JSON.stringify(after.thumbnail)||after.selectedCount!==before.selectedCount)return'conflict';
  const a=after.artifacts.find((x:any)=>x.id===plan.artifactId),v=after.versions.find((x:any)=>x.artifact_id===plan.artifactId&&x.drive_file_id===plan.version.drive_file_id);
  const match=(row:any,expected:any)=>!!row&&Object.entries(expected).every(([k,value])=>['verified_at','uploaded_at'].includes(k)?Date.parse(row[k])===Date.parse(String(value)):row[k]===value);
  if(match(a,plan.values)&&match(v,plan.version))return'exact_applied';if(normalized(after)===normalized(before))return'unchanged';return'conflict';
}
try{
  if(!(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--rehearse')||commit))throw Error('explicit_mode');
  stage='inventory';inventory();
  stage='source_revision';call('cf-vps-deploy',inspectSingleThumbnailSource,false);
  const code=`const fs=require('node:fs'),p='/var/tmp/tutorial-single-thumbnail-70175471-10ac-4d26-81d5-da503701b942';const d=fs.lstatSync(p);if(!d.isDirectory()||d.isSymbolicLink()||d.uid!==0||(d.mode&0o077)||fs.existsSync(p+'/ledger.lock'))throw Error('private_directory');function read(n,max){const s=fs.lstatSync(p+'/'+n);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==0||(s.mode&0o077)||s.size>max)throw Error('private_file');return fs.readFileSync(p+'/'+n,'utf8')}process.stdout.write(JSON.stringify({manifest:read('manifest.json',16384),ledger:read('receipts.jsonl',1048576)}));`;
  stage='private_receipt';const input=JSON.parse(ssh('vps2','node',code)),manifest=JSON.parse(input.manifest);
  stage='fresh_drive_proof';const proof=call('cf-vps-deploy',readDriveProof,[{drive_file_id:'1S5yw7OnPaJ0kgjwiHJo7yn2SjVhLrXmZ',bytes:S.bytes,checksum_sha256:S.sha256,drive_md5:S.md5}],false,180000)[0];
  stage='local_target';const local=call('vps2',readLocalProof,[{jobId:S.jobId,path:manifest.sourcePath,bytes:S.bytes,sha256:S.sha256}],true)[0];
  if(!local.parentDirectoryReady||!local.safePath||local.state==='conflict'){console.log(JSON.stringify({mode:'rollback',stopped:true,missingParentDirectory:!local.parentDirectoryReady,localConflict:!local.safePath||local.state==='conflict',committedWrites:0,mediaWrites:0}));process.exitCode=1;}
  else{
    stage='plan';before=target();plan=planSingleThumbnailPromotion(input,before,proof,local,Number(before.now));planHash=sha256Text(JSON.stringify(plan));
    if(commit){stage='backup';backup=call('vps2',createPromotionBackup,{scope:'one-selected-original-thumbnail',planHash,manifestSha256:plan.manifestSha256,ledgerSha256:plan.ledgerSha256},false,240000);call('vps2',verifyPromotionBackup,backup)}
    stage='source_fence';call('cf-vps-deploy',inspectSingleThumbnailSource,false);inventory();
    if(commit)call('vps2',recordPromotionAudit,{proof:backup,event:'before-commit',planHash,outcome:'dispatch_pending'});
    stage=commit?'commit_transaction':'rollback_transaction';dispatched=commit;
    const result=JSON.parse(ssh('vps2','docker exec -i --user 1000:1000 tutorial-recovery-staging-web-1 node',`const localReader=${readLocalProof.toString()};(${promoteSingleThumbnail.toString()})(${JSON.stringify(plan)},localReader,${JSON.stringify(commit?'commit-single-thumbnail':'rollback')},${JSON.stringify(backup)}).then(x=>process.stdout.write(JSON.stringify(x))).catch(e=>{process.stdout.write(JSON.stringify({remoteError:true,sqlCode:/^[A-Z0-9]{5}$/.test(e.code??'')?e.code:null,reason:['local_fence_changed','commit_outcome_uncertain','verified_backup_required'].includes(e.message)?e.message:null}));});`,120000));
    if(result.remoteError){console.log(JSON.stringify({remoteFailure:result,committedWrites:commit?null:0}));throw Error('transaction_failed')}
    acknowledged=result.commitPerformed===true;stage='independent_verification';const state=reconcile(target());if(state!==(commit?'exact_applied':'unchanged'))throw Error('reconciliation');
    if(commit)call('vps2',recordPromotionAudit,{proof:backup,event:'after-commit',planHash,outcome:'acknowledged_and_exactly_verified',result});
    console.log(JSON.stringify({mode:commit?'committed-single-thumbnail':'rollback-rehearsal',...result,postState:state,jobUnchanged:true,thumbnailSelectionAndVerdictUnchanged:true,planHash,backup:backup??undefined}));
  }
}catch{let state='not_attempted';if(dispatched){try{state=reconcile(target())}catch{state='unavailable'}try{call('vps2',recordPromotionAudit,{proof:backup,event:'reconciliation',planHash,outcome:acknowledged?'acknowledged_followup_failed':'commit_acknowledgment_unknown',currentState:state})}catch{}}console.log(JSON.stringify({stopped:true,stage,commitOutcome:dispatched?(acknowledged?'acknowledged_needs_reconciliation':'uncertain_do_not_retry'):'not_attempted',currentState:state,committedWrites:dispatched?null:0,mediaWrites:0,sourceWrites:0,backup:backup??undefined}));process.exitCode=1;}
