/** Read-only, memory-only SSH preflight. Never prints private inputs or database errors. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { planPreservationReceipts, type ReceiptTarget } from "./plan-preservation-receipts";
import { parsePreservationManifest, sha256Text, exactFiveIds } from "./preserve-english-finals";
const manifestSha = "f022aedee8cd423e26a8ce05adce4b98164c27fa504a8e9f85ceb26a0fe188da";
const options = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10"];
function ssh(alias: "cf-vps-deploy" | "vps2", command: string, input?: string) {
  return execFileSync("ssh", [...options, alias, command], { input, encoding: "utf8", maxBuffer: 8 * 1024 ** 2, timeout: 45_000, stdio: ["pipe", "pipe", "pipe"] });
}
export function preservationSourceRevision(row: any) {
  return sha256Text(JSON.stringify([row.id, row.status, row.final_path, row.completed_at, row.recording_path, row.audio_path, row.recorded_at,
    createHash("md5").update(row.script_text ?? "").digest("hex"), row.source_job_id ?? null, row.parent_job_id ?? null]));
}
export function readPrivatePreservationContext() {
  // Remote source checks prevent read redirection; stdout is captured only in memory.
  const sourceScript = `const fs=require('node:fs'); const p='/var/tmp/tutorial-migration-preserve-q09ypb';
const d=fs.lstatSync(p);if(!d.isDirectory()||d.isSymbolicLink()||d.uid!==process.getuid()||(d.mode&0o077))throw Error('protected directory required');
if(fs.existsSync(p+'/receipts.jsonl.lock'))throw Error('active preservation writer');
function read(n,max){const f=p+'/'+n,s=fs.lstatSync(f);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==process.getuid()||(s.mode&0o077)||s.size>max)throw Error('protected file required');return fs.readFileSync(f,'utf8')}
process.stdout.write(JSON.stringify({manifest:read('manifest.json',131072),ledger:read('receipts.jsonl',2097152)}));`;
  const inputs = JSON.parse(ssh("cf-vps-deploy", "node", sourceScript));
  if (sha256Text(inputs.manifest) !== manifestSha) throw Error("Unexpected preservation manifest");
  const manifest = parsePreservationManifest(JSON.parse(inputs.manifest));
  // Validate the complete ledger independently of missing destination rows.
  // These identity-only placeholders are never emitted or used for database inserts.
  const verified = planPreservationReceipts(inputs.manifest, manifestSha, inputs.ledger, sha256Text(inputs.ledger), manifest.entries.map(entry => ({ jobId: entry.jobId, artifactId: entry.jobId, ownerKind: "tutorial_job", kind: "final_video", archivedSourceRevision: entry.sourceRevision })));
  const ids = exactFiveIds(manifest.entries.map(row => row.jobId));
  const quoted = ids.map(id => `'${id}'::uuid`).join(",");
  const sql = `BEGIN READ ONLY;
SELECT json_build_object(
'archives',(SELECT coalesce(json_agg(json_build_object('sourceId',source_id,'raw',source_json,'snapshotSha',snapshot_sha256)),'[]') FROM tutorial_legacy_archive WHERE source_system='content-forge-main' AND source_table='tutorial_jobs' AND source_id IN (${quoted})),
'artifacts',(SELECT coalesce(json_agg(json_build_object('jobId',job_id,'artifactId',id,'ownerKind',owner_kind,'kind',kind)),'[]') FROM storage_artifacts WHERE job_id IN (${quoted}) AND kind='final_video'),
'versions',(SELECT coalesce(json_agg(v),'[]') FROM storage_artifact_versions v JOIN storage_artifacts a ON a.id=v.artifact_id WHERE a.job_id IN (${quoted}) AND a.kind='final_video'),
'runtime',(SELECT coalesce(json_agg(j),'[]') FROM tutorial_jobs j WHERE id IN (${quoted})));
COMMIT;`;
  const target = JSON.parse(ssh("vps2", "docker exec -i tutorial-recovery-staging-postgres-1 psql -X -U tutorial_staging -d tutorial_staging_cf_20260908 -qAt -v ON_ERROR_STOP=1", sql));
  return { inputs, manifest, verified, ids, target, manifestSha };
}
function main() {
  if (process.argv.length !== 2) throw Error("No execution or mutation flags accepted");
  const { inputs, manifest, verified, target } = readPrivatePreservationContext();
  const targets: ReceiptTarget[] = [];
  let archiveMatches = 0, currentRevisionMatches = 0, missingArtifacts = 0, archiveMismatches = 0, missingArtifactRuntimeJobs = 0;
  for (const entry of manifest.entries) {
    const matching = target.archives.filter((a: any) => a.sourceId === entry.jobId && sha256Text(a.raw) === a.snapshotSha && preservationSourceRevision(JSON.parse(a.raw)) === entry.sourceRevision);
    if (!matching.length) { archiveMismatches++; continue; }
    archiveMatches++;
    const runtime = target.runtime.find((row: any) => row.id === entry.jobId);
    if (runtime && preservationSourceRevision(runtime) === entry.sourceRevision) currentRevisionMatches++;
    const artifacts = target.artifacts.filter((a: any) => a.jobId === entry.jobId && a.ownerKind === "tutorial_job");
    if (artifacts.length !== 1) { missingArtifacts++; if (runtime) missingArtifactRuntimeJobs++; continue; }
    targets.push({ ...artifacts[0], archivedSourceRevision: entry.sourceRevision });
  }
  if (archiveMismatches || missingArtifacts) {
    console.log(JSON.stringify({ mode: "read-only", verifiedFiles: verified.verifiedFiles, verifiedBytes: verified.verifiedBytes, archiveMatches, currentRevisionMatches, runtimeJobs: target.runtime.length, missingArtifacts, missingArtifactRuntimeJobs, missingArtifactArchiveOnlyJobs: missingArtifacts - missingArtifactRuntimeJobs, archiveMismatches, preflightHash: sha256Text(JSON.stringify({ manifestSha, ledgerSha: sha256Text(inputs.ledger), targets })), planHash: null, databaseWrites: 0, ready: false })); return;
  }
  const plan = planPreservationReceipts(inputs.manifest, manifestSha, inputs.ledger, sha256Text(inputs.ledger), targets, target.versions);
  const planHash = sha256Text(JSON.stringify(plan));
  console.log(JSON.stringify({ mode: "read-only", ready: true, verifiedFiles: plan.verifiedFiles, verifiedBytes: plan.verifiedBytes, archiveMatches, currentRevisionMatches,
    insertCount: plan.inserts.length, alreadyRecorded: plan.alreadyRecorded, manifestSha256: manifestSha, ledgerSha256: sha256Text(inputs.ledger), planHash, databaseWrites: 0, currentPointersChanged: 0 }));
}
if (process.argv[1] && /(?:^|[\\/])preflight-preservation-receipts-cli\.(?:mjs|ts|js)$/.test(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href) {
try { main(); } catch { console.log(JSON.stringify({ mode: "read-only", ready: false, stopped: 1, databaseWrites: 0, detail: "Private input, mapping or transport verification failed; raw details withheld" })); process.exitCode = 1; }
}
