import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { capturePublicationApproval, publicationApprovalMatches } from "../publication-approval.js";
let fixture: string | undefined;
afterEach(async () => { if (fixture) await rm(fixture, { recursive: true, force: true }); });
it("binds approval to metadata, destination and bytes even when paths stay unchanged", async () => {
  fixture = await mkdtemp(join(tmpdir(), "publication-approval-test-"));
  const input = { jobId: "job", channelId: "channel", language: "en", sourceRevision: "source", title: "Title", description: "Description", tags: ["tutorial"], videoPath: join(fixture, "video.mp4"), thumbnailId: "thumb", thumbnailPath: join(fixture, "thumb.jpg") };
  await writeFile(input.videoPath, "original video bytes"); await writeFile(input.thumbnailPath, "original thumbnail bytes");
  const original = await capturePublicationApproval(input);
  expect(publicationApprovalMatches(original, await capturePublicationApproval(input))).toBe(true);
  for (const patch of [{ title: "Edited title" }, { channelId: "other" }, { sourceRevision: "re-recorded" }, { thumbnailId: "replacement" }]) expect(publicationApprovalMatches(original, await capturePublicationApproval({ ...input, ...patch }))).toBe(false);
  await writeFile(input.videoPath, "replaced video bytes");
  expect(publicationApprovalMatches(original, await capturePublicationApproval(input))).toBe(false);
  expect(publicationApprovalMatches(null, original)).toBe(false);
});
