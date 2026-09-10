import { posix } from "node:path";
import { sha256Text } from "./preserve-english-finals";
import { planPreservationReceipts } from "./plan-preservation-receipts";
import { preservationSourceRevision } from "./preflight-preservation-receipts-cli";

export function preparePreservationParents(context: any) {
  const { manifest, manifestSha, inputs, target } = context;
  const parents: Record<string, unknown>[] = [], mappings = [], fences: Record<string, unknown>[] = [];
  for (const entry of manifest.entries) {
    const jobs = target.runtime.filter((row: any) => row.id === entry.jobId);
    const job = jobs[0];
    if (jobs.length !== 1 || !job.channel_id || job.source_job_id || job.parent_job_id || job.language !== "en" || preservationSourceRevision(job) !== entry.sourceRevision) throw Error("Current English original revision mismatch");
    const archives = target.archives.filter((row: any) => row.sourceId === entry.jobId && sha256Text(row.raw) === row.snapshotSha && preservationSourceRevision(JSON.parse(row.raw)) === entry.sourceRevision);
    if (!archives.length) throw Error("Immutable source evidence mismatch");
    const existing = target.artifacts.filter((row: any) => row.jobId === entry.jobId);
    if (existing.length > 1 || existing.some((row: any) => row.ownerKind !== "tutorial_job" || row.kind !== "final_video")) throw Error("Artifact ownership conflict");
    const digest = sha256Text(`preservation-parent/1:${entry.jobId}:final_video`);
    const artifactId = existing[0]?.artifactId ?? `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
    if (!existing.length) parents.push({ id: artifactId, job_id: entry.jobId, owner_kind: "tutorial_job", channel_id: job.channel_id, kind: "final_video", language: "en", source_job_id: null,
      filename: posix.basename(entry.path), vps_path: entry.path, state: "skipped", error_kind: "preservation_history_only", error_message: "Immutable preservation evidence only; current Drive pointer deliberately not activated", drive_file_id: null, verified_at: null, bytes: null, checksum_sha256: null });
    mappings.push({ jobId: entry.jobId, artifactId, ownerKind: "tutorial_job", kind: "final_video", archivedSourceRevision: entry.sourceRevision });
    fences.push({ id: entry.jobId, status: job.status, final_path: job.final_path, completed_at: job.completed_at, recording_path: job.recording_path, audio_path: job.audio_path, recorded_at: job.recorded_at, script_text: job.script_text, source_job_id: job.source_job_id, parent_job_id: job.parent_job_id, channel_id: job.channel_id, language: job.language });
  }
  const history = planPreservationReceipts(inputs.manifest, manifestSha, inputs.ledger, sha256Text(inputs.ledger), mappings, target.versions);
  if (parents.length > 3 || history.verifiedBytes !== 58224531) throw Error("Approved preservation scope changed");
  return { parents, history, fences, mappings, existingVersionCount: target.versions.length };
}
