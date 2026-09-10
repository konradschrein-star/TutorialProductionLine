import { parsePreservationManifest, sha256Text } from "./preserve-english-finals";
import { posix } from "node:path";

export type ReceiptTarget = {
  jobId: string; artifactId: string; ownerKind: string; kind: string;
  /** Digest re-derived privately from the exact archived source row, not a UI DTO. */
  archivedSourceRevision: string;
};
export type VersionInsert = {
  artifact_id: string; drive_file_id: string; vps_path: string; bytes: number;
  checksum_sha256: string; drive_md5: string; verified_at: string;
};

/** Pure append-only plan. Caller supplies protected files and verified target identities.
 * No current-pointer promotion, restore, scheduling, provider or database effects. */
export function planPreservationReceipts(manifestText: string, expectedManifestSha: string,
  ledgerText: string, expectedLedgerSha: string, targets: ReceiptTarget[], existing: VersionInsert[] = []) {
  if (sha256Text(manifestText) !== expectedManifestSha || sha256Text(ledgerText) !== expectedLedgerSha) throw Error("Private input checksum mismatch");
  const manifest = parsePreservationManifest(JSON.parse(manifestText));
  if (manifest.entries.some(entry => posix.normalize(entry.path) !== entry.path || entry.path.includes("\\")) || new Set(targets.map(target => target.artifactId)).size !== targets.length) throw Error("Canonical paths and distinct artifact mappings required");
  if (!ledgerText.endsWith("\n") || Buffer.byteLength(ledgerText) > 2 * 1024 ** 2) throw Error("Truncated or oversized receipt ledger");
  let sequence = 0, previousHash = "";
  const latest = new Map<string, Record<string, any>>();
  for (const line of ledgerText.split("\n").filter(Boolean)) {
    const { hash, ...row } = JSON.parse(line);
    if (row.manifestSha256 !== expectedManifestSha || row.sequence !== ++sequence || row.previousHash !== previousHash || hash !== sha256Text(JSON.stringify(row)) || !manifest.entries.some(entry => entry.jobId === row.jobId)) throw Error("Receipt chain mismatch");
    if (!["intent", "session", "uploaded", "verified", "uncertain"].includes(row.stage) || !Number.isFinite(Date.parse(row.at))) throw Error("Invalid receipt event");
    previousHash = hash;
    latest.set(row.jobId, row);
  }
  const inserts: VersionInsert[] = [];
  let alreadyRecorded = 0;
  for (const entry of manifest.entries) {
    const receipt = latest.get(entry.jobId);
    // Later uncertainty must never be hidden by an earlier verified event.
    if (!receipt || receipt.stage !== "verified" || !/^[\w-]{10,200}$/.test(receipt.fileId ?? "") || receipt.sha256 !== entry.sha256 || receipt.bytes !== entry.bytes) throw Error("Five final verified receipts required");
    const matches = targets.filter(target => target.jobId === entry.jobId);
    if (matches.length !== 1 || matches[0]!.ownerKind !== "tutorial_job" || matches[0]!.kind !== "final_video" || matches[0]!.archivedSourceRevision !== entry.sourceRevision) throw Error("Exact archived source and artifact mapping required");
    const version: VersionInsert = { artifact_id: matches[0]!.artifactId, drive_file_id: receipt.fileId, vps_path: entry.path,
      bytes: entry.bytes, checksum_sha256: entry.sha256, drive_md5: entry.md5, verified_at: receipt.at };
    const prior = existing.filter(row => row.artifact_id === version.artifact_id && row.drive_file_id === version.drive_file_id);
    if (prior.length) {
      if (prior.length !== 1 || ["vps_path", "bytes", "checksum_sha256", "drive_md5"].some(key => prior[0]![key as keyof VersionInsert] !== version[key as keyof VersionInsert]) || !prior[0]!.verified_at) throw Error("Immutable version conflict requires reconciliation");
      alreadyRecorded++;
    } else inserts.push(version);
  }
  return { inserts, alreadyRecorded, verifiedFiles: 5, verifiedBytes: manifest.entries.reduce((sum, row) => sum + row.bytes, 0),
    audit: { manifestSha256: expectedManifestSha, ledgerSha256: expectedLedgerSha, ledgerHead: previousHash }, currentPointersChanged: 0 as const };
}
