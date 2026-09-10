import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewMediaAvailability, type ReviewArchiveReceipt } from "../media-availability";
let root: string, path: string, receipt: ReviewArchiveReceipt;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "review-availability-test-")); path = join(root, "final.mp4");
  receipt = { jobId:"job",ownerKind:"tutorial_job",kind:"final_video",state:"uploaded",vpsPath:path,driveFileId:"private-id",checksumSha256:"a".repeat(64),bytes:10,verifiedAt:new Date() };
});
afterEach(async () => { if (!root.startsWith(join(tmpdir(), "review-availability-test-"))) throw new Error("Unexpected fixture path"); await rm(root,{recursive:true,force:true}); });
const assess = (receipts = [receipt], driveConfigured = true) => reviewMediaAvailability("job",path,receipts,{allowedRoots:[root],maxBytes:1024,driveConfigured});
it("marks a missing final file playable when exact verified receipt restoration is configured",async()=>{
  expect(await assess()).toMatchObject({playable:true,localAvailable:false,receiptRecorded:true,restoreEligible:true,archiveCurrentBytesVerified:false,availabilityReason:"verified_receipt_restore_eligible"});
});
it.each(["pending","hash","verification","path","owner","kind","job","size","duplicate"])("rejects misleading %s receipt evidence",async(mode)=>{
  if(mode==="pending")receipt.state="pending";
  if(mode==="hash")receipt.checksumSha256=null;
  if(mode==="verification")receipt.verifiedAt=null;
  if(mode==="path")receipt.vpsPath=join(root,"old.mp4");
  if(mode==="owner")receipt.ownerKind="content_job";
  if(mode==="kind")receipt.kind="raw_recording";
  if(mode==="job")receipt.jobId="other";
  if(mode==="size")receipt.bytes=2048;
  expect(await assess(mode==="duplicate"?[receipt,receipt]:[receipt])).toMatchObject({playable:false,receiptRecorded:false,restoreEligible:false});
});
it("does not promise restore when credentials/storage are disabled",async()=>{
  expect(await assess([receipt],false)).toMatchObject({playable:false,receiptRecorded:true,restoreEligible:false,availabilityReason:"drive_not_configured"});
});
it("accepts current unarchived local files without claiming current Drive bytes verified",async()=>{
  await writeFile(path,"current draft bytes");
  expect(await assess([])).toMatchObject({playable:true,localAvailable:true,receiptRecorded:false,archiveCurrentBytesVerified:false});
});
it("rejects a receipt whose size no longer matches local bytes",async()=>{
  await writeFile(path,"changed longer current bytes");
  expect(await assess()).toMatchObject({playable:true,localAvailable:true,receiptRecorded:false});
});
it("rejects out-of-root and missing-parent restore paths",async()=>{
  path=join(root,"missing-parent","final.mp4");receipt.vpsPath=path;
  expect(await assess()).toMatchObject({playable:false,restoreEligible:false,availabilityReason:"unsafe_or_missing_parent_path"});
});
