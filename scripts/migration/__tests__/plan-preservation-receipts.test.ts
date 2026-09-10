import { describe, expect, it } from "vitest";
import { planPreservationReceipts, type ReceiptTarget } from "../plan-preservation-receipts";
import { EXPECTED_OWNER, PRESERVATION_VERSION, sha256Text } from "../preserve-english-finals";
function fixture() {
  const entries = Array.from({ length: 5 }, (_, i) => ({ jobId: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`, path: `/opt/content-forge/media/tutorial/${i}.mp4`, sourceRevision: "b".repeat(64), completedAt: "2026-09-09T00:00:00Z", bytes: 123, sha256: "a".repeat(64), md5: "c".repeat(32), statToken: "private" }));
  const manifest = JSON.stringify({ version: PRESERVATION_VERSION, expectedOwner: EXPECTED_OWNER, folderId: "synthetic-folder", createdAt: entries[0]!.completedAt, entries });
  let previousHash = "";
  const ledger = entries.map((entry, i) => {
    const row = { jobId: entry.jobId, stage: "verified", fileId: `synthetic-file-${i}`, sha256: entry.sha256, bytes: entry.bytes, manifestSha256: sha256Text(manifest), sequence: i + 1, at: entry.completedAt, previousHash };
    previousHash = sha256Text(JSON.stringify(row)); return JSON.stringify({ ...row, hash: previousHash });
  }).join("\n") + "\n";
  const targets: ReceiptTarget[] = entries.map(entry => ({ jobId: entry.jobId, artifactId: entry.jobId, ownerKind: "tutorial_job", kind: "final_video", archivedSourceRevision: entry.sourceRevision }));
  return { manifest, ledger, targets };
}
const run = (f: ReturnType<typeof fixture>, existing: Parameters<typeof planPreservationReceipts>[5] = []) => planPreservationReceipts(f.manifest, sha256Text(f.manifest), f.ledger, sha256Text(f.ledger), f.targets, existing);
describe("preservation receipt import planning", () => {
  it("plans five history inserts without current-pointer mutation", () => { const p = run(fixture()); expect(p.inserts).toHaveLength(5); expect(p.verifiedBytes).toBe(615); expect(p.currentPointersChanged).toBe(0); expect(JSON.stringify(p)).not.toContain("sessionUri"); });
  it("is idempotent for exact existing immutable evidence", () => { const f = fixture(); expect(run(f, run(f).inserts).alreadyRecorded).toBe(5); });
  it("rejects missing artifact mappings", () => { const f = fixture(); f.targets.pop(); expect(() => run(f)).toThrow("mapping"); });
  it("rejects source revisions that differ from migration archive", () => { const f = fixture(); f.targets[0]!.archivedSourceRevision = "d".repeat(64); expect(() => run(f)).toThrow("mapping"); });
  it("rejects tampered receipt chains even with a new outer checksum", () => { const f = fixture(); f.ledger = f.ledger.replace('"bytes":123', '"bytes":124'); expect(() => run(f)).toThrow("chain"); });
  it("rejects conflicting preexisting immutable rows", () => { const f = fixture(), rows = run(f).inserts; rows[0]!.checksum_sha256 = "d".repeat(64); expect(() => run(f, rows)).toThrow("conflict"); });
  it("rejects truncated ledger", () => { const f = fixture(); f.ledger = f.ledger.trimEnd(); expect(() => run(f)).toThrow("Truncated"); });
});
