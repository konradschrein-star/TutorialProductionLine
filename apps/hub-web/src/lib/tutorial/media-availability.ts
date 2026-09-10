import { lstat } from "node:fs/promises";
import { validateMediaTarget } from "@repo/storage";

export interface ReviewArchiveReceipt {
  jobId: string; ownerKind: string; kind: string; state: string; vpsPath: string;
  driveFileId: string | null; checksumSha256: string | null; bytes: number | null; verifiedAt: Date | null;
}
/** Cheap availability projection, not a claim that current local/remote bytes
 * were rehashed. Actual hydration/download/approval performs that verification.
 */
export async function reviewMediaAvailability(jobId: string, path: string | null, receipts: readonly ReviewArchiveReceipt[], options: { allowedRoots: readonly string[]; maxBytes: number; driveConfigured: boolean }) {
  const unavailable = { playable: false, localAvailable: false, receiptRecorded: false, restoreEligible: false, archiveCurrentBytesVerified: false as const };
  if (!path) return { ...unavailable, availabilityReason: "no_final_path" };
  try { await validateMediaTarget(path, options.allowedRoots); }
  catch { return { ...unavailable, availabilityReason: "unsafe_or_missing_parent_path" }; }
  let local;
  try { local = await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return { ...unavailable, availabilityReason: "local_access_error" }; }
  const localAvailable = Boolean(local?.isFile() && local.size > 0 && local.size <= options.maxBytes);
  const candidates = receipts.filter(receipt => receipt.jobId === jobId && receipt.ownerKind === "tutorial_job" && receipt.kind === "final_video" && receipt.vpsPath === path);
  const receipt = candidates.length === 1 ? candidates[0] : null;
  const receiptRecorded = Boolean(receipt && receipt.state === "uploaded" && receipt.driveFileId && receipt.verifiedAt && /^[a-f0-9]{64}$/i.test(receipt.checksumSha256 ?? "") && Number.isSafeInteger(receipt.bytes) && receipt.bytes! > 0 && receipt.bytes! <= options.maxBytes && (!local || local.size === receipt.bytes));
  const restoreEligible = !local && receiptRecorded && options.driveConfigured;
  return { playable: localAvailable || restoreEligible, localAvailable, receiptRecorded, restoreEligible, archiveCurrentBytesVerified: false as const,
    availabilityReason: localAvailable ? "local_available" : restoreEligible ? "verified_receipt_restore_eligible" : receiptRecorded && !options.driveConfigured ? "drive_not_configured" : "no_verified_current_path_receipt" };
}
