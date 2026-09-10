/** Only --rehearse is accepted; generated transaction always ends ROLLBACK. */
import { execFileSync } from "node:child_process";
import { readPrivatePreservationContext } from "./preflight-preservation-receipts-cli";
import { preparePreservationParents } from "./prepare-preservation-parents";
import { sha256Text } from "./preserve-english-finals";
try {
  if (process.argv.length !== 3 || process.argv[2] !== "--rehearse") throw Error("Explicit rollback rehearsal required");
  const plan = preparePreservationParents(readPrivatePreservationContext());
  // JSON is hex encoded before SQL interpolation: no strings/paths become SQL syntax.
  const encoded = Buffer.from(JSON.stringify(plan)).toString("hex");
  const sql = `BEGIN; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('preserved-english-history-rehearsal',0));
DO $$ DECLARE p jsonb:=convert_from(decode('${encoded}','hex'),'UTF8')::jsonb; j jsonb; a jsonb; v jsonb; n integer; BEGIN
IF current_database()<>'tutorial_staging_cf_20260908' OR current_user<>'tutorial_staging' THEN RAISE EXCEPTION 'Wrong staging identity'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='storage_artifact_versions'::regclass AND tgname='storage_artifact_versions_append_only' AND tgenabled='O') THEN RAISE EXCEPTION 'Append-only guard absent'; END IF;
PERFORM id FROM tutorial_jobs WHERE id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p->'fences') x) ORDER BY id FOR UPDATE;
FOR j IN SELECT * FROM jsonb_array_elements(p->'fences') LOOP
IF NOT EXISTS(SELECT 1 FROM tutorial_jobs t WHERE t.id=(j->>'id')::uuid AND to_jsonb(t) @> j) THEN RAISE EXCEPTION 'Runtime source changed'; END IF;
END LOOP;
PERFORM id FROM storage_artifacts WHERE job_id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p->'fences') x) AND kind='final_video' ORDER BY id FOR UPDATE;
FOR a IN SELECT * FROM jsonb_array_elements(p->'parents') LOOP
IF EXISTS(SELECT 1 FROM storage_artifacts WHERE (job_id=(a->>'job_id')::uuid AND kind='final_video') OR id=(a->>'id')::uuid) THEN RAISE EXCEPTION 'Parent mapping changed'; END IF;
INSERT INTO storage_artifacts(id,job_id,owner_kind,channel_id,kind,language,filename,vps_path,state,error_kind,error_message)
VALUES((a->>'id')::uuid,(a->>'job_id')::uuid,'tutorial_job',(a->>'channel_id')::uuid,'final_video','en',a->>'filename',a->>'vps_path','skipped','preservation_history_only',a->>'error_message');
END LOOP;
FOR a IN SELECT * FROM jsonb_array_elements(p->'mappings') LOOP
IF NOT EXISTS(SELECT 1 FROM storage_artifacts WHERE id=(a->>'artifactId')::uuid AND job_id=(a->>'jobId')::uuid AND owner_kind='tutorial_job' AND kind='final_video') THEN RAISE EXCEPTION 'Artifact ownership changed'; END IF;
END LOOP;
FOR v IN SELECT * FROM jsonb_array_elements(p->'history'->'inserts') LOOP
INSERT INTO storage_artifact_versions(artifact_id,drive_file_id,vps_path,bytes,checksum_sha256,drive_md5,verified_at)
VALUES((v->>'artifact_id')::uuid,v->>'drive_file_id',v->>'vps_path',(v->>'bytes')::bigint,v->>'checksum_sha256',v->>'drive_md5',(v->>'verified_at')::timestamptz) ON CONFLICT DO NOTHING;
IF NOT EXISTS(SELECT 1 FROM storage_artifact_versions WHERE artifact_id=(v->>'artifact_id')::uuid AND drive_file_id=v->>'drive_file_id' AND vps_path=v->>'vps_path' AND bytes=(v->>'bytes')::bigint AND checksum_sha256=v->>'checksum_sha256' AND drive_md5=v->>'drive_md5' AND verified_at IS NOT NULL) THEN RAISE EXCEPTION 'Immutable conflict'; END IF;
END LOOP;
END $$;
SELECT json_build_object('mode','rollback-rehearsal','parentsPlanned',${plan.parents.length},'versionsPlanned',${plan.history.inserts.length},'verifiedBytes',${plan.history.verifiedBytes},'committedWrites',0,'currentPointersChanged',0);
ROLLBACK;`;
  const output = execFileSync("ssh", ["-o","BatchMode=yes","-o","StrictHostKeyChecking=yes","-o","ConnectTimeout=10","vps2","docker exec -i tutorial-recovery-staging-postgres-1 psql -X -U tutorial_staging -d tutorial_staging_cf_20260908 -qAt -v ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", stdio: ["pipe","pipe","pipe"], maxBuffer: 1024*1024, timeout: 45000 });
  const summary=JSON.parse(output.trim());
  console.log(JSON.stringify({...summary,planHash:sha256Text(JSON.stringify(plan))}));
} catch { console.log(JSON.stringify({mode:"rollback-rehearsal",stopped:true,detailsWithheld:true,committedWrites:0})); process.exitCode=1; }
