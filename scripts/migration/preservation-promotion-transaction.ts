/** Serialized into existing staging web. Default rollback; narrowly gated commit requires fresh backup proof. */
export async function rehearsePromotion(plan:any, localReader:(entries:any[])=>Promise<any[]>, mode='rollback', backup:any=null) {
  const {createRequire}=await import('node:module');const req=createRequire(process.cwd()+'/package.json');
  const postgres=req('postgres'),db=postgres(process.env.DATABASE_URL,{max:1,connect_timeout:10,idle_timeout:1});
  let begun=false, committed=false,commitAttempted=false;
  try{
    const identity=await db`select current_database() as db, current_user as role`;
    if(identity[0]?.db!=='tutorial_staging_cf_20260908'||identity[0]?.role!=='tutorial_staging'||process.getuid?.()!==1000)throw Error('staging_identity');
    if(plan.updates.length!==5||plan.preparation.parents.length>3||!plan.atomicAllFive||plan.execute!==false)throw Error('plan_scope');
    const allowed=['2071be5e-9956-42be-9803-04b7d418848b','409f215a-c13d-4937-9dee-3c6aafd995a2','48790ac0-6ad1-4ce6-8ac4-7f7c26c428a6','63edc16b-33b1-4f9d-8be7-5c71d661f568','6b645f6e-1ed6-4ff9-8f55-bb2954d303fb'];
    if(JSON.stringify(plan.updates.map((u:any)=>u.jobId).sort())!==JSON.stringify(allowed)||JSON.stringify(plan.preparation.fences.map((f:any)=>f.id).sort())!==JSON.stringify(allowed))throw Error('fixed_five_scope');
    if(!['rollback','commit-five-verified-originals'].includes(mode))throw Error('invalid_mode');
    if(mode!=='rollback'&&(!backup||backup.database!=='tutorial_staging_cf_20260908'||backup.listingVerified!==true||!Number.isSafeInteger(backup.bytes)||backup.bytes<=0||!/^[a-f0-9]{64}$/.test(backup.sha256)||!/^\/var\/tmp\/tutorial-preservation-promotion-[A-Za-z0-9]+\/staging-before-promotion\.dump$/.test(backup.path)))throw Error('verified_backup_required');
    await db.unsafe("BEGIN; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='90s';");begun=true;
    await db`select pg_advisory_xact_lock(hashtextextended('preserved-english-history-rehearsal',0))`;
    if(mode!=='rollback'){
      const age=await db`select ${backup.completedAt}::timestamptz <= clock_timestamp() and ${backup.completedAt}::timestamptz >= clock_timestamp()-interval '15 minutes' as fresh`;
      if(age[0]?.fresh!==true)throw Error('backup_expired');
    }
    await db`select set_config('tutorial.preservation_plan',${JSON.stringify(plan)},true)`;
    await db.unsafe(`DO $$ DECLARE p jsonb:=current_setting('tutorial.preservation_plan')::jsonb; j jsonb; u jsonb; BEGIN
IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='storage_artifact_versions'::regclass AND tgname='storage_artifact_versions_append_only' AND tgenabled='O') THEN RAISE EXCEPTION 'append_only_guard'; END IF;
PERFORM id FROM tutorial_jobs WHERE id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p->'preparation'->'fences') x) ORDER BY id FOR UPDATE;
FOR j IN SELECT * FROM jsonb_array_elements(p->'preparation'->'fences') LOOP
IF NOT EXISTS(SELECT 1 FROM tutorial_jobs t WHERE t.id=(j->>'id')::uuid AND to_jsonb(t) @> j) THEN RAISE EXCEPTION 'runtime_fence'; END IF;
END LOOP;
FOR j IN SELECT * FROM jsonb_array_elements(p->'mediaLeases') ORDER BY value #>> '{}' LOOP
PERFORM pg_advisory_xact_lock(hashtextextended('tutorial-media:'||(j #>> '{}'),0));
END LOOP;
PERFORM id FROM storage_artifacts WHERE job_id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p->'preparation'->'fences') x) AND kind='final_video' ORDER BY id FOR UPDATE;
FOR u IN SELECT * FROM jsonb_array_elements(p->'updates') LOOP
IF u->'expectedCurrent'='null'::jsonb THEN
IF EXISTS(SELECT 1 FROM storage_artifacts WHERE id=(u->>'artifactId')::uuid OR (job_id=(u->>'jobId')::uuid AND kind='final_video')) THEN RAISE EXCEPTION 'parent_changed'; END IF;
ELSE
IF NOT EXISTS(SELECT 1 FROM storage_artifacts a WHERE a.id=(u->>'artifactId')::uuid AND to_jsonb(a)=u->'expectedCurrent') THEN RAISE EXCEPTION 'artifact_cas'; END IF;
END IF;
IF (u->>'remoteCheckedAt')::timestamptz < clock_timestamp()-interval '15 minutes' OR (u->>'remoteCheckedAt')::timestamptz > clock_timestamp() THEN RAISE EXCEPTION 'proof_expired'; END IF;
END LOOP;
END $$;`);
    // Same advisory key/order as withTutorialMediaSet; no materializer invoked.
    const fresh=await localReader(plan.localEntries);
    if(JSON.stringify(fresh)!==JSON.stringify(plan.localSnapshots))throw Error('local_fence_changed');
    await db.unsafe(`DO $$ DECLARE p jsonb:=current_setting('tutorial.preservation_plan')::jsonb; a jsonb; v jsonb; u jsonb; n integer; total integer:=0; parent_count integer:=0; version_count integer:=0; pointer_count integer:=0; BEGIN
FOR a IN SELECT * FROM jsonb_array_elements(p->'preparation'->'parents') LOOP
INSERT INTO storage_artifacts(id,job_id,owner_kind,channel_id,kind,language,filename,vps_path,state,error_kind,error_message)
VALUES((a->>'id')::uuid,(a->>'job_id')::uuid,'tutorial_job',(a->>'channel_id')::uuid,'final_video','en',a->>'filename',a->>'vps_path','skipped','preservation_history_only',a->>'error_message');
parent_count:=parent_count+1;
END LOOP;
FOR v IN SELECT * FROM jsonb_array_elements((p->'priorVersions')||(p->'incomingVersions')) LOOP
INSERT INTO storage_artifact_versions(artifact_id,drive_file_id,vps_path,bytes,checksum_sha256,drive_md5,verified_at)
VALUES((v->>'artifact_id')::uuid,v->>'drive_file_id',v->>'vps_path',(v->>'bytes')::bigint,v->>'checksum_sha256',v->>'drive_md5',(v->>'verified_at')::timestamptz) ON CONFLICT DO NOTHING;
GET DIAGNOSTICS n=ROW_COUNT;version_count:=version_count+n;
IF NOT EXISTS(SELECT 1 FROM storage_artifact_versions WHERE artifact_id=(v->>'artifact_id')::uuid AND drive_file_id=v->>'drive_file_id' AND vps_path IS NOT DISTINCT FROM v->>'vps_path' AND bytes IS NOT DISTINCT FROM (v->>'bytes')::bigint AND checksum_sha256 IS NOT DISTINCT FROM v->>'checksum_sha256' AND drive_md5 IS NOT DISTINCT FROM v->>'drive_md5' AND verified_at IS NOT DISTINCT FROM (v->>'verified_at')::timestamptz) THEN RAISE EXCEPTION 'immutable_conflict'; END IF;
END LOOP;
FOR u IN SELECT * FROM jsonb_array_elements(p->'updates') LOOP
v:=u->'values';
IF EXISTS(SELECT 1 FROM storage_artifacts current_artifact WHERE current_artifact.id=(u->>'artifactId')::uuid AND current_artifact.job_id=(u->>'jobId')::uuid AND current_artifact.owner_kind='tutorial_job' AND current_artifact.kind='final_video' AND
(to_jsonb(current_artifact)-'verified_at'-'uploaded_at') @> (v-'verified_at'-'uploaded_at') AND current_artifact.verified_at=(v->>'verified_at')::timestamptz AND current_artifact.uploaded_at=(v->>'uploaded_at')::timestamptz) THEN total:=total+1; CONTINUE; END IF;
UPDATE storage_artifacts SET vps_path=v->>'vps_path',drive_file_id=v->>'drive_file_id',drive_web_link=v->>'drive_web_link',drive_folder_id=v->>'drive_folder_id',drive_folder_path=NULL,bytes=(v->>'bytes')::bigint,checksum_sha256=v->>'checksum_sha256',drive_md5=v->>'drive_md5',state='uploaded',verified_at=(v->>'verified_at')::timestamptz,uploaded_at=(v->>'uploaded_at')::timestamptz,bytes_uploaded=(v->>'bytes_uploaded')::bigint,resumable_session_uri=NULL,error_kind=NULL,error_message=NULL,updated_at=clock_timestamp()
WHERE id=(u->>'artifactId')::uuid AND job_id=(u->>'jobId')::uuid AND owner_kind='tutorial_job' AND kind='final_video';
GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'update_count'; END IF;total:=total+n;pointer_count:=pointer_count+n;
END LOOP;
IF total<>5 OR (SELECT sum((x->'values'->>'bytes')::bigint) FROM jsonb_array_elements(p->'updates') x)<>58224531 THEN RAISE EXCEPTION 'scope_count'; END IF;
PERFORM set_config('tutorial.preservation_result',json_build_object('parentInserts',parent_count,'versionInserts',version_count,'pointerUpdates',pointer_count)::text,true);
END $$;`);
    const rows=await db`select current_setting('tutorial.preservation_result')::json as result`;
    const changes=rows[0]?.result;
    if(!changes||!['parentInserts','versionInserts','pointerUpdates'].every(k=>Number.isInteger(changes[k])&&changes[k]>=0))throw Error('result_count');
    if(mode!=='rollback'){commitAttempted=true;try{await db.unsafe('COMMIT');committed=true;}catch{throw Error('commit_outcome_uncertain');}}
    return {parentsRehearsed:plan.preparation.parents.length,receiptsRehearsed:5,pointersRehearsed:5,verifiedBytes:58224531,...changes,committedWrites:committed?changes.parentInserts+changes.versionInserts+changes.pointerUpdates:0,commitPerformed:committed,mediaWrites:0};
  }finally{try{if(begun&&!committed&&!commitAttempted)await db.unsafe('ROLLBACK');}finally{await db.end({timeout:5});}}
}
