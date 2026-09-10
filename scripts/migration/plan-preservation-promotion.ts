/** Pure Phase B proposal: no DB, local-file or provider writes. */
import { preparePreservationParents } from "./prepare-preservation-parents";
import { planPreservationReceipts } from "./plan-preservation-receipts";
import { sha256Text } from "./preserve-english-finals";
import { posix } from 'node:path';
export type RemotePreservationProof = { fileId: string; ownerMatches: boolean; ownedByMe: boolean; trashed: boolean; bytes: number; md5: string; sha256: string; checkedAt: string; parentIds: string[] };
export type LocalPreservationProof = { jobId: string; safePath: boolean; parentDirectoryReady: boolean; state: "absent" | "exact" | "conflict"; bytes?: number; sha256?: string };
export function planPreservationPromotion(context: any, remote: RemotePreservationProof[], local: LocalPreservationProof[], current: Record<string, any>[], now: number) {
  if (!Number.isFinite(now)) throw Error("Valid proof evaluation time required");
  const preparation = preparePreservationParents(context);
  const all = planPreservationReceipts(context.inputs.manifest, context.manifestSha, context.inputs.ledger, sha256Text(context.inputs.ledger), preparation.mappings);
  const updates = [], priorVersions = [];
  for (const version of all.inserts) {
    const mapping = preparation.mappings.find(row => row.artifactId === version.artifact_id)!;
    const proofs = remote.filter(row => row.fileId === version.drive_file_id), proof = proofs[0];
    if (proofs.length !== 1 || !proof || !proof.ownerMatches || !proof.ownedByMe || proof.trashed || proof.bytes !== version.bytes || proof.sha256 !== version.checksum_sha256 || proof.md5 !== version.drive_md5 || !Number.isFinite(Date.parse(proof.checkedAt)) || Date.parse(proof.checkedAt)>now || now-Date.parse(proof.checkedAt)>15*60_000 || !Array.isArray(proof.parentIds)) throw Error("Fresh exact Drive proof required");
    const locals = local.filter(row => row.jobId === mapping.jobId), disk=locals[0];
    if (locals.length!==1 || !disk?.safePath || !disk.parentDirectoryReady || !['absent','exact'].includes(disk.state) || (disk.state==='exact' && (disk.bytes!==version.bytes || disk.sha256!==version.checksum_sha256))) throw Error("Local path conflict or unsafe restore target");
    if (proof.parentIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) || new Set(proof.parentIds).size !== proof.parentIds.length) throw Error("Invalid exact Drive parent proof");
    const rows=current.filter(row=>row.id===version.artifact_id), prior=rows[0];
    const isNew=preparation.parents.some(row=>row.id===version.artifact_id);
    if ((!isNew&&rows.length!==1)||(isNew&&rows.length!==0)|| (prior && (prior.job_id!==mapping.jobId||prior.owner_kind!=='tutorial_job'||prior.kind!=='final_video'))) throw Error("Current artifact snapshot mismatch");
    if (prior && (!Object.hasOwn(prior,'drive_file_id') || !Object.hasOwn(prior,'vps_path') || !Object.hasOwn(prior,'state') || !Object.hasOwn(prior,'updated_at'))) throw Error("Full current artifact snapshot required");
    if (prior && (typeof prior.vps_path!=='string'||!prior.vps_path.startsWith('/opt/content-forge/media/')||posix.normalize(prior.vps_path)!==prior.vps_path||prior.vps_path.includes('\\')||/[\x00-\x1f]/.test(prior.vps_path)||prior.vps_path.split('/').length>30)) throw Error('Unsafe prior media lease path');
    if (prior?.state === 'uploading' || prior?.resumable_session_uri) throw Error("Active or uncertain storage upload must be reconciled first");
    if (prior?.drive_file_id) priorVersions.push({artifact_id:prior.id,drive_file_id:prior.drive_file_id,vps_path:prior.vps_path,bytes:prior.bytes??null,checksum_sha256:prior.checksum_sha256??null,drive_md5:prior.drive_md5??null,verified_at:prior.verified_at??null});
    updates.push({ artifactId:version.artifact_id, jobId:mapping.jobId, expectedCurrent:prior??null,
      values:{vps_path:version.vps_path,drive_file_id:version.drive_file_id,drive_web_link:`https://drive.google.com/file/d/${version.drive_file_id}/view`,
        drive_folder_id:proof.parentIds.length===1?proof.parentIds[0]:null,drive_folder_path:null,bytes:version.bytes,checksum_sha256:version.checksum_sha256,drive_md5:version.drive_md5,
        state:'uploaded',verified_at:version.verified_at,uploaded_at:version.verified_at,bytes_uploaded:version.bytes,resumable_session_uri:null,error_kind:null,error_message:null},
      localPresence:disk.state,remoteCheckedAt:proof.checkedAt });
  }
  for (const prior of priorVersions) {
    for (const existing of [...all.inserts, ...context.target.versions]) {
      if (existing.artifact_id !== prior.artifact_id || existing.drive_file_id !== prior.drive_file_id) continue;
      if (['vps_path','bytes','checksum_sha256','drive_md5'].some(key => (existing[key] ?? null) !== (prior[key as keyof typeof prior] ?? null)) || (existing.verified_at == null || prior.verified_at == null ? (existing.verified_at ?? null)!==(prior.verified_at ?? null) : Date.parse(existing.verified_at)!==Date.parse(prior.verified_at))) throw Error('Prior immutable identity conflicts; reconcile before promotion');
    }
  }
  return {preparation,priorVersions,incomingVersions:all.inserts,updates,rootLocks:preparation.fences.map(row=>String(row.id)).sort(),mediaLeases:[...new Set([...all.inserts.map(row=>row.vps_path),...updates.flatMap(row=>row.expectedCurrent?[row.expectedCurrent.vps_path]:[])])].sort(),
    archiveBeforePromotion:true,atomicAllFive:true,mediaWrites:0,jobWrites:0,scheduleWrites:0,execute:false};
}
