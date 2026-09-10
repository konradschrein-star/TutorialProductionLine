/** Fixed-one staging transaction. Only default rollback may run before explicit root review. */
export async function promoteSingleThumbnail(plan:any,localReader:(rows:any[])=>Promise<any[]>,mode='rollback',backup:any=null){
  const {createRequire}=await import('node:module'),req=createRequire(process.cwd()+'/package.json'),postgres=req('postgres'),db=postgres(process.env.DATABASE_URL,{max:1,connect_timeout:10,idle_timeout:1});
  let begun=false,attempted=false,committed=false;
  try{
    const rows=await db`select current_database() as db,current_user as role`;
    if(rows[0]?.db!=='tutorial_staging_cf_20260908'||rows[0]?.role!=='tutorial_staging'||process.getuid?.()!==1000)throw Error('staging_identity');
    if(plan.job?.id!=='48790ac0-6ad1-4ce6-8ac4-7f7c26c428a6'||plan.thumbnail?.id!=='70175471-10ac-4d26-81d5-da503701b942'||plan.version?.bytes!==146123||plan.version?.checksum_sha256!=='94113309775e2b0e8eb9077711be893c0c27a6aa7bb48f068ca3b32f122b719f'||plan.version?.drive_file_id!=='1S5yw7OnPaJ0kgjwiHJo7yn2SjVhLrXmZ'||!['rollback','commit-single-thumbnail'].includes(mode))throw Error('fixed_singleton_scope');
    if(mode!=='rollback'&&(!backup||backup.database!=='tutorial_staging_cf_20260908'||backup.listingVerified!==true||!Number.isSafeInteger(backup.bytes)||backup.bytes<1||!/^[a-f0-9]{64}$/.test(backup.sha256)||!/^\/var\/tmp\/tutorial-preservation-promotion-[A-Za-z0-9]+\/staging-before-promotion\.dump$/.test(backup.path)))throw Error('verified_backup_required');
    await db.unsafe("BEGIN;SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='30s';SET LOCAL idle_in_transaction_session_timeout='90s';");begun=true;
    await db`select pg_advisory_xact_lock(hashtextextended('single-thumbnail-preservation-promotion',0))`;
    if(mode!=='rollback'){const age=await db`select ${backup.completedAt}::timestamptz<=clock_timestamp() and ${backup.completedAt}::timestamptz>=clock_timestamp()-interval '15 minutes' as fresh`;if(age[0]?.fresh!==true)throw Error('backup_expired');}
    await db`select set_config('tutorial.single_thumbnail_plan',${JSON.stringify(plan)},true)`;
    await db.unsafe(`DO $$ DECLARE p jsonb:=current_setting('tutorial.single_thumbnail_plan')::jsonb; x jsonb; BEGIN
IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='storage_artifact_versions'::regclass AND tgname='storage_artifact_versions_append_only' AND tgenabled='O') THEN RAISE EXCEPTION 'append_only_guard'; END IF;
PERFORM id FROM tutorial_jobs WHERE id=(p->'job'->>'id')::uuid FOR UPDATE;
IF NOT EXISTS(SELECT 1 FROM tutorial_jobs j WHERE j.id=(p->'job'->>'id')::uuid AND to_jsonb(j)=p->'job') THEN RAISE EXCEPTION 'root_cas'; END IF;
PERFORM id FROM thumbnails WHERE id=(p->'thumbnail'->>'id')::uuid FOR UPDATE;
IF NOT EXISTS(SELECT 1 FROM thumbnails t WHERE t.id=(p->'thumbnail'->>'id')::uuid AND to_jsonb(t)=p->'thumbnail') OR (SELECT count(*) FROM thumbnails WHERE subject_id=(p->'job'->>'id')::uuid AND subject_kind='tutorial_job' AND language='en' AND is_selected)<>1 THEN RAISE EXCEPTION 'thumbnail_cas'; END IF;
FOR x IN SELECT * FROM jsonb_array_elements(p->'mediaLeases') ORDER BY value #>> '{}' LOOP PERFORM pg_advisory_xact_lock(hashtextextended('tutorial-media:'||(x #>> '{}'),0)); END LOOP;
PERFORM id FROM storage_artifacts WHERE job_id=(p->'job'->>'id')::uuid AND kind='thumbnail' ORDER BY id FOR UPDATE;
IF p->'prior'='null'::jsonb THEN
IF EXISTS(SELECT 1 FROM storage_artifacts WHERE id=(p->>'artifactId')::uuid OR (job_id=(p->'job'->>'id')::uuid AND kind='thumbnail')) THEN RAISE EXCEPTION 'parent_changed'; END IF;
ELSE IF NOT EXISTS(SELECT 1 FROM storage_artifacts a WHERE a.id=(p->>'artifactId')::uuid AND to_jsonb(a)=p->'prior') THEN RAISE EXCEPTION 'artifact_cas'; END IF; END IF;
IF (p->>'remoteCheckedAt')::timestamptz>clock_timestamp() OR (p->>'remoteCheckedAt')::timestamptz<clock_timestamp()-interval '15 minutes' THEN RAISE EXCEPTION 'proof_expired'; END IF;
END $$;`);
    if(JSON.stringify(await localReader(plan.localEntries))!==JSON.stringify(plan.localSnapshots))throw Error('local_fence_changed');
    await db.unsafe(`DO $$ DECLARE p jsonb:=current_setting('tutorial.single_thumbnail_plan')::jsonb; v jsonb; n integer; parents integer:=0; versions integer:=0; pointers integer:=0; BEGIN
IF p->'prior'='null'::jsonb THEN
INSERT INTO storage_artifacts(id,job_id,owner_kind,channel_id,kind,language,filename,vps_path,state,error_kind,error_message)
VALUES((p->>'artifactId')::uuid,(p->'job'->>'id')::uuid,'tutorial_job',(p->'job'->>'channel_id')::uuid,'thumbnail','en',p->>'filename',p->'values'->>'vps_path','skipped','preservation_history_only','Verified singleton preservation promotion in progress');parents:=1;
END IF;
FOR v IN SELECT * FROM jsonb_array_elements((p->'priorVersions')||jsonb_build_array(p->'version')) LOOP
INSERT INTO storage_artifact_versions(artifact_id,drive_file_id,vps_path,bytes,checksum_sha256,drive_md5,verified_at)
VALUES((v->>'artifact_id')::uuid,v->>'drive_file_id',v->>'vps_path',(v->>'bytes')::bigint,v->>'checksum_sha256',v->>'drive_md5',(v->>'verified_at')::timestamptz) ON CONFLICT DO NOTHING;
GET DIAGNOSTICS n=ROW_COUNT;versions:=versions+n;
IF NOT EXISTS(SELECT 1 FROM storage_artifact_versions WHERE artifact_id=(v->>'artifact_id')::uuid AND drive_file_id=v->>'drive_file_id' AND vps_path IS NOT DISTINCT FROM v->>'vps_path' AND bytes IS NOT DISTINCT FROM (v->>'bytes')::bigint AND checksum_sha256 IS NOT DISTINCT FROM v->>'checksum_sha256' AND drive_md5 IS NOT DISTINCT FROM v->>'drive_md5' AND verified_at IS NOT DISTINCT FROM (v->>'verified_at')::timestamptz) THEN RAISE EXCEPTION 'immutable_conflict'; END IF;
END LOOP;
v:=p->'values';
IF NOT EXISTS(SELECT 1 FROM storage_artifacts a WHERE a.id=(p->>'artifactId')::uuid AND (to_jsonb(a)-'verified_at'-'uploaded_at') @> (v-'verified_at'-'uploaded_at') AND a.verified_at=(v->>'verified_at')::timestamptz AND a.uploaded_at=(v->>'uploaded_at')::timestamptz) THEN
IF p->'prior'<>'null'::jsonb THEN RAISE EXCEPTION 'replacement_not_authorized'; END IF;
UPDATE storage_artifacts SET vps_path=v->>'vps_path',drive_file_id=v->>'drive_file_id',drive_web_link=v->>'drive_web_link',drive_folder_id=v->>'drive_folder_id',drive_folder_path=NULL,bytes=(v->>'bytes')::bigint,checksum_sha256=v->>'checksum_sha256',drive_md5=v->>'drive_md5',state='uploaded',verified_at=(v->>'verified_at')::timestamptz,uploaded_at=(v->>'uploaded_at')::timestamptz,bytes_uploaded=(v->>'bytes_uploaded')::bigint,resumable_session_uri=NULL,error_kind=NULL,error_message=NULL,updated_at=clock_timestamp()
WHERE id=(p->>'artifactId')::uuid AND job_id=(p->'job'->>'id')::uuid AND owner_kind='tutorial_job' AND kind='thumbnail';GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'pointer_count'; END IF;pointers:=n;
END IF;
IF parents NOT BETWEEN 0 AND 1 OR versions NOT BETWEEN 0 AND 1 OR pointers NOT BETWEEN 0 AND 1 OR (p->'prior'='null'::jsonb AND (parents<>1 OR versions<>1 OR pointers<>1)) OR (p->'prior'<>'null'::jsonb AND (parents<>0 OR versions<>0 OR pointers<>0)) THEN RAISE EXCEPTION 'exact_write_bounds'; END IF;
PERFORM set_config('tutorial.single_thumbnail_result',json_build_object('parentInserts',parents,'versionInserts',versions,'pointerUpdates',pointers)::text,true);
END $$;`);
    const result=(await db`select current_setting('tutorial.single_thumbnail_result')::json as result`)[0]?.result;
    if(!result||!['parentInserts','versionInserts','pointerUpdates'].every(k=>Number.isInteger(result[k])&&result[k]>=0&&result[k]<=1&&result[k]===(plan.prior?0:1)))throw Error('result_count');
    if(mode!=='rollback'){attempted=true;try{await db.unsafe('COMMIT');committed=true}catch{throw Error('commit_outcome_uncertain')}}
    return{...result,verifiedBytes:146123,commitPerformed:committed,committedWrites:committed?result.parentInserts+result.versionInserts+result.pointerUpdates:0,mediaWrites:0,sourceWrites:0};
  }finally{try{if(begun&&!committed&&!attempted)await db.unsafe('ROLLBACK')}finally{await db.end({timeout:5})}}
}
