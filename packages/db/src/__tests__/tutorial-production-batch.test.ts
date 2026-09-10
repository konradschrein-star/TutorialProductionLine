import { describe, expect, it } from "vitest";
import { tutorialSourceRevision } from "../tutorial-source-revision.js";
import {
  planTutorialProductionBatch,
  tutorialProductionBatchCsv,
  type TutorialBatchJobInput,
  type TutorialProductionBatchInput,
} from "../tutorial-production-batch.js";

const channelId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-09-07T00:00:00.000Z");
const metadata = {
  tutorialChannelProfile: { version: 1 },
  tutorialSchedule: { timezone: "UTC", dailyCapacity: 100, startMinute: 480, endMinute: 1200 },
};

function job(index: number): TutorialBatchJobInput {
  const id = `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`;
  return {
    id, channelId, title: `Tutorial ${index}`, language: "English", status: "COMPLETED",
    sourceJobId: null, parentJobId: null, finalPath: `/media/${id}/final.mp4`, recordingPath: `/media/${id}/recording.mp4`,
    scriptText: "Narration", recordedAt: new Date("2026-09-01T00:00:00Z"), completedAt: new Date(Date.UTC(2026, 8, 1, 0, index)),
    description: "Description", tags: ["tutorial"], vaReviewStatus: "approved", publicationApproval: null,
    outputQaStatus: "passed", scheduledFor: null, isUploaded: false, uploaderStatus: null, uploaderJobId: null, uploadVerifiedAt: null,
  };
}

function fixture(count = 1): TutorialProductionBatchInput {
  const jobs = Array.from({ length: count }, (_, index) => job(index));
  const thumbnails = jobs.map((row, index) => ({ id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`, jobId: row.id, channelId, language: "en", status: "completed", outputPath: `/media/${row.id}/thumb.jpg`, isSelected: true, reviewVerdict: "strong" }));
  const driveVideos = jobs.map((row, index) => ({ id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`, jobId: row.id, state: "uploaded", vpsPath: row.finalPath!, driveFileId: `drive-${index}`, verifiedAt: new Date("2026-09-02T00:00:00Z"), checksumSha256: "a".repeat(64), bytes: 100 }));
  for (let index = 0; index < jobs.length; index++) {
    const row = jobs[index]!;
    const thumbnail = thumbnails[index]!;
    row.publicationApproval = {
      version: 1, revision: String(index % 10).repeat(64),
      identity: { jobId: row.id, channelId, language: "en", sourceRevision: tutorialSourceRevision({ recording_path: row.recordingPath, final_path: row.finalPath, script_text: row.scriptText, recorded_at: row.recordedAt }), title: row.title, description: row.description, tags: row.tags, videoPath: row.finalPath, thumbnailId: thumbnail.id, thumbnailPath: thumbnail.outputPath },
      video: { sha256: "a".repeat(64), size: 100 }, thumbnail: { sha256: "b".repeat(64), size: 20 },
    };
  }
  return {
    now,
    channels: [{ id: channelId, name: "USA Tutorials", language: "en", acceptsTutorials: true, isPrimary: true, uploaderChannelKey: "usa_tutorials", metadata }],
    jobs, thumbnails, driveVideos, dispatches: [], occupied: [],
  };
}

describe("tutorial production batch admission", () => {
  it("plans at most 50 unique originals and hard-caps every channel at 30 per local day", () => {
    const plan = planTutorialProductionBatch(fixture(50));
    expect(plan.mode).toBe("dry-run");
    expect(plan.totals).toMatchObject({ eligible: 50, planned: 50, excludedJobs: 0 });
    const entries = plan.channels[0]!.entries;
    expect(new Set(entries.map((entry) => entry.jobId)).size).toBe(50);
    expect(entries.filter((entry) => entry.publishAt.startsWith("2026-09-07")).length).toBe(30);
    expect(entries.filter((entry) => entry.publishAt.startsWith("2026-09-08")).length).toBe(20);
  });

  it("respects disabled weekdays in the explicit weekly schedule", () => {
    const input = fixture(1);
    input.now = new Date("2026-09-11T20:00:00Z");
    const profile = input.channels[0]!.metadata as typeof metadata & { tutorialSchedule: Record<string, unknown> };
    profile.tutorialSchedule = { timezone: "UTC", dailyCapacity: 30, startMinute: 480, endMinute: 1200, weeklyPlan: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [day, { enabled: day === "monday", dailyCapacity: 30, startMinute: 480, endMinute: 1200 }])) };
    expect(planTutorialProductionBatch(input).channels[0]!.entries[0]!.publishAt.startsWith("2026-09-14")).toBe(true);
  });

  it("reports exact overlapping approval, thumbnail, Drive, QA and uncertain-dispatch exclusions", () => {
    const input = fixture(3);
    input.jobs[0]!.publicationApproval = null;
    input.jobs[0]!.vaReviewStatus = null;
    input.thumbnails = input.thumbnails.filter((row) => row.jobId !== input.jobs[0]!.id);
    input.driveVideos = input.driveVideos.filter((row) => row.jobId !== input.jobs[0]!.id);
    input.jobs[1]!.outputQaStatus = "failed";
    input.dispatches.push({ jobId: input.jobs[1]!.id, state: "generic_uncertain" });
    input.driveVideos.find((row) => row.jobId === input.jobs[1]!.id)!.checksumSha256 = "c".repeat(64);
    const result = planTutorialProductionBatch(input).channels[0]!;
    expect(result).toMatchObject({ eligible: 1, planned: 1, excludedJobs: 2 });
    expect(result.exclusionCounts).toMatchObject({ missing_approval: 1, missing_thumbnail: 1, missing_drive_video: 1, failed_output_qa: 1, duplicate_dispatch_uncertain: 1, stale_drive_video: 1 });
  });

  it("fails closed when the profile, uploader mapping or schedule was never explicitly configured", () => {
    const input = fixture(1);
    input.channels[0]!.metadata = {};
    input.channels[0]!.uploaderChannelKey = null;
    const result = planTutorialProductionBatch(input).channels[0]!;
    expect(result.configured).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.exclusionCounts).toMatchObject({ channel_mapping_invalid: 1, channel_schedule_invalid: 1 });
  });

  it("emits spreadsheet-safe CSV from the same immutable plan", () => {
    const input = fixture(1);
    input.jobs[0]!.title = "One, \"quoted\" title";
    const approval = input.jobs[0]!.publicationApproval as { identity: { title: string } };
    approval.identity.title = input.jobs[0]!.title;
    const csv = tutorialProductionBatchCsv(planTutorialProductionBatch(input));
    expect(csv).toContain('"One, ""quoted"" title"');
    expect(csv.split("\n")).toHaveLength(3);
  });
});
