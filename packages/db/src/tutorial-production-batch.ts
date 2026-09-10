import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  ChannelScheduleSchema,
  TutorialChannelProfileSchema,
  nextPublicationSlot,
  normalizeTutorialLanguage,
  resolveTutorialChannelTargets,
  type ChannelSchedule,
} from "@repo/contracts";
import type { DrizzleClient } from "./client.js";
import { tutorialSourceRevision } from "./tutorial-source-revision.js";
import {
  channels,
  storageArtifacts,
  thumbnails,
  tutorialJobs,
  tutorialUploadDispatches,
} from "./schema/index.js";

const MAX_PER_CHANNEL = 50;
const MAX_PER_LOCAL_DAY = 30;
const UPLOADER_KEY = /^[a-z][a-z0-9_-]{0,63}$/;
const UNCERTAIN_DISPATCH_STATES = new Set(["uncertain", "generic_uncertain", "failed", "generic_failed"]);

export type TutorialBatchExclusionReason =
  | "channel_mapping_invalid"
  | "channel_schedule_invalid"
  | "missing_final_video"
  | "failed_output_qa"
  | "missing_approval"
  | "stale_approval"
  | "missing_thumbnail"
  | "failed_thumbnail_qa"
  | "missing_drive_video"
  | "stale_drive_video"
  | "duplicate_dispatch_confirmed"
  | "duplicate_dispatch_uncertain"
  | "already_reserved";

export interface TutorialBatchChannelInput {
  id: string;
  name: string;
  language: string;
  acceptsTutorials: boolean;
  isPrimary: boolean;
  uploaderChannelKey: string | null;
  metadata: unknown;
}

export interface TutorialBatchJobInput {
  id: string;
  channelId: string | null;
  title: string;
  language: string | null;
  status: string;
  sourceJobId: string | null;
  parentJobId: string | null;
  finalPath: string | null;
  recordingPath: string | null;
  scriptText: string | null;
  recordedAt: Date | null;
  completedAt: Date | null;
  description: string | null;
  tags: string[] | null;
  vaReviewStatus: string | null;
  publicationApproval: unknown;
  outputQaStatus: string | null;
  scheduledFor: Date | null;
  isUploaded: boolean;
  uploaderStatus: string | null;
  uploaderJobId: string | null;
  uploadVerifiedAt: Date | null;
}

export interface TutorialBatchThumbnailInput {
  id: string;
  jobId: string;
  channelId: string | null;
  language: string;
  status: string;
  outputPath: string | null;
  isSelected: boolean;
  reviewVerdict: string;
}

export interface TutorialBatchDriveInput {
  id: string;
  jobId: string;
  state: string;
  vpsPath: string;
  driveFileId: string | null;
  verifiedAt: Date | null;
  checksumSha256: string | null;
  bytes: number | null;
}

export interface TutorialBatchDispatchInput {
  jobId: string;
  state: string;
}

export interface TutorialProductionBatchInput {
  now: Date;
  channels: TutorialBatchChannelInput[];
  jobs: TutorialBatchJobInput[];
  thumbnails: TutorialBatchThumbnailInput[];
  driveVideos: TutorialBatchDriveInput[];
  dispatches: TutorialBatchDispatchInput[];
  occupied: Array<{ channelId: string; at: Date }>;
  maxPerChannel?: number;
}

export interface TutorialProductionBatchPlan {
  version: "tutorial-production-batch/1";
  mode: "dry-run" | "commit";
  generatedAt: string;
  limits: { perChannel: number; perLocalDay: 30 };
  enabledChannels: Array<{ channelId: string; channelName: string; language: string; isPrimary: boolean; uploaderMapped: boolean; hasExplicitProfile: boolean; hasExplicitSchedule: boolean }>;
  totals: { channels: number; baseJobs: number; eligible: number; planned: number; excludedJobs: number };
  channels: Array<{
    channelId: string;
    channelName: string;
    language: string;
    configured: boolean;
    eligible: number;
    planned: number;
    excludedJobs: number;
    exclusionCounts: Partial<Record<TutorialBatchExclusionReason, number>>;
    entries: Array<{ jobId: string; title: string; completedAt: string | null; publishAt: string; approvalRevision: string; thumbnailId: string; driveFileId: string }>;
  }>;
}

type ApprovedPublication = {
  version: 1;
  revision: string;
  identity: { jobId: string; channelId: string; language: string; sourceRevision: string; title: string; description: string; tags: string[]; videoPath: string; thumbnailId: string; thumbnailPath: string };
  video: { sha256: string; size: number };
  thumbnail: { sha256: string; size: number };
};

function asApproval(value: unknown): ApprovedPublication | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ApprovedPublication>;
  const identity = row.identity as Partial<ApprovedPublication["identity"]> | undefined;
  if (row.version !== 1 || !/^[a-f0-9]{64}$/i.test(row.revision ?? "") || !identity || !row.video || !row.thumbnail) return null;
  if (!/^[a-f0-9]{64}$/i.test(row.video.sha256 ?? "") || !/^[a-f0-9]{64}$/i.test(row.thumbnail.sha256 ?? "") || !Number.isSafeInteger(row.video.size) || !Number.isSafeInteger(row.thumbnail.size)) return null;
  return row as ApprovedPublication;
}

function cappedSchedule(schedule: ChannelSchedule): ChannelSchedule {
  return {
    ...schedule,
    dailyCapacity: Math.min(schedule.dailyCapacity, MAX_PER_LOCAL_DAY),
    ...(schedule.weeklyPlan ? {
      weeklyPlan: Object.fromEntries(Object.entries(schedule.weeklyPlan).map(([day, plan]) => [day, { ...plan, dailyCapacity: Math.min(plan.dailyCapacity, MAX_PER_LOCAL_DAY) }])) as ChannelSchedule["weeklyPlan"],
    } : {}),
  };
}

function sameTags(left: string[] | null, right: string[] | undefined) {
  return Array.isArray(left) && Array.isArray(right) && JSON.stringify(left) === JSON.stringify(right);
}

function increment(target: Partial<Record<TutorialBatchExclusionReason, number>>, reason: TutorialBatchExclusionReason) {
  target[reason] = (target[reason] ?? 0) + 1;
}

/** Pure admission plan. Exclusion counts overlap by design, while excludedJobs
 * is the exact number of unique jobs excluded by one or more gates. */
export function planTutorialProductionBatch(input: TutorialProductionBatchInput): TutorialProductionBatchPlan {
  if (!Number.isFinite(input.now.getTime())) throw new Error("Invalid planning time");
  const maxPerChannel = Math.min(Math.max(input.maxPerChannel ?? MAX_PER_CHANNEL, 1), MAX_PER_CHANNEL);
  const targetInputs = input.channels.map((channel) => ({ id: channel.id, language: channel.language, isPrimary: channel.isPrimary, enabled: channel.acceptsTutorials, metadata: channel.metadata }));
  const results: TutorialProductionBatchPlan["channels"] = [];

  for (const channel of input.channels.filter((row) => row.acceptsTutorials && row.isPrimary && normalizeTutorialLanguage(row.language) === "en")) {
    const metadata = channel.metadata && typeof channel.metadata === "object" ? channel.metadata as Record<string, unknown> : null;
    const hasExplicitProfile = Boolean(metadata && Object.prototype.hasOwnProperty.call(metadata, "tutorialChannelProfile"));
    const hasExplicitSchedule = Boolean(metadata && Object.prototype.hasOwnProperty.call(metadata, "tutorialSchedule"));
    const profile = TutorialChannelProfileSchema.safeParse(metadata?.tutorialChannelProfile);
    const schedule = ChannelScheduleSchema.safeParse(metadata?.tutorialSchedule);
    const topology = resolveTutorialChannelTargets(channel.id, targetInputs);
    const mappingValid = hasExplicitProfile && profile.success && profile.data.primaryChannelId === null && Boolean(channel.uploaderChannelKey && UPLOADER_KEY.test(channel.uploaderChannelKey)) && topology.blocked.length === 0;
    const scheduleValid = hasExplicitSchedule && schedule.success;
    const channelJobs = input.jobs.filter((job) => job.channelId === channel.id && job.status === "COMPLETED" && !job.sourceJobId && !job.parentJobId && normalizeTutorialLanguage(job.language) === "en");
    const exclusionCounts: Partial<Record<TutorialBatchExclusionReason, number>> = {};
    const admitted: Array<{ job: TutorialBatchJobInput; approval: ApprovedPublication; thumbnail: TutorialBatchThumbnailInput; drive: TutorialBatchDriveInput }> = [];
    let excludedJobs = 0;

    for (const job of channelJobs) {
      const reasons = new Set<TutorialBatchExclusionReason>();
      if (!mappingValid) reasons.add("channel_mapping_invalid");
      if (!scheduleValid) reasons.add("channel_schedule_invalid");
      if (!job.finalPath?.trim()) reasons.add("missing_final_video");
      if (job.outputQaStatus === "failed") reasons.add("failed_output_qa");
      if (job.scheduledFor) reasons.add("already_reserved");

      const selected = input.thumbnails.filter((thumbnail) => thumbnail.jobId === job.id && thumbnail.isSelected);
      const readyThumbnails = selected.filter((thumbnail) => thumbnail.channelId === channel.id && normalizeTutorialLanguage(thumbnail.language) === "en" && thumbnail.status === "completed" && Boolean(thumbnail.outputPath?.trim()) && ["acceptable", "strong"].includes(thumbnail.reviewVerdict));
      if (!selected.length) reasons.add("missing_thumbnail");
      else if (readyThumbnails.length !== 1) reasons.add("failed_thumbnail_qa");
      const thumbnail = readyThumbnails.length === 1 ? readyThumbnails[0]! : null;

      const approval = asApproval(job.publicationApproval);
      if (job.vaReviewStatus !== "approved" || !approval) reasons.add("missing_approval");
      else if (!thumbnail || !job.finalPath || approval.identity.jobId !== job.id || approval.identity.channelId !== channel.id || normalizeTutorialLanguage(approval.identity.language) !== "en" || approval.identity.sourceRevision !== tutorialSourceRevision({ recording_path: job.recordingPath, final_path: job.finalPath, script_text: job.scriptText, recorded_at: job.recordedAt }) || approval.identity.title !== job.title || approval.identity.description !== job.description || !sameTags(job.tags, approval.identity.tags) || approval.identity.videoPath !== job.finalPath || approval.identity.thumbnailId !== thumbnail.id || approval.identity.thumbnailPath !== thumbnail.outputPath) reasons.add("stale_approval");

      const driveRows = input.driveVideos.filter((drive) => drive.jobId === job.id);
      const durable = driveRows.filter((drive) => drive.state === "uploaded" && Boolean(drive.driveFileId) && Boolean(drive.verifiedAt) && drive.vpsPath === job.finalPath);
      if (!durable.length) reasons.add("missing_drive_video");
      const drive = durable.length === 1 ? durable[0]! : null;
      if (drive && approval && (drive.checksumSha256 !== approval.video.sha256 || drive.bytes !== approval.video.size)) reasons.add("stale_drive_video");

      const dispatchStates = input.dispatches.filter((dispatch) => dispatch.jobId === job.id).map((dispatch) => dispatch.state);
      const legacyDispatch = job.isUploaded || Boolean(job.uploaderStatus || job.uploaderJobId || job.uploadVerifiedAt);
      if (dispatchStates.some((state) => UNCERTAIN_DISPATCH_STATES.has(state)) || (!dispatchStates.length && job.uploaderStatus && UNCERTAIN_DISPATCH_STATES.has(job.uploaderStatus))) reasons.add("duplicate_dispatch_uncertain");
      if (dispatchStates.some((state) => !UNCERTAIN_DISPATCH_STATES.has(state)) || (legacyDispatch && !reasons.has("duplicate_dispatch_uncertain"))) reasons.add("duplicate_dispatch_confirmed");

      for (const reason of reasons) increment(exclusionCounts, reason);
      if (reasons.size) excludedJobs += 1;
      else admitted.push({ job, approval: approval!, thumbnail: thumbnail!, drive: drive! });
    }

    const occupied = input.occupied.filter((row) => row.channelId === channel.id).map((row) => row.at);
    const entries: TutorialProductionBatchPlan["channels"][number]["entries"] = [];
    if (scheduleValid) {
      const effective = cappedSchedule(schedule.data);
      for (const row of admitted.sort((a, b) => (a.job.completedAt?.getTime() ?? 0) - (b.job.completedAt?.getTime() ?? 0) || a.job.id.localeCompare(b.job.id)).slice(0, maxPerChannel)) {
        const publishAt = nextPublicationSlot(input.now, occupied, effective);
        occupied.push(publishAt);
        entries.push({ jobId: row.job.id, title: row.job.title, completedAt: row.job.completedAt?.toISOString() ?? null, publishAt: publishAt.toISOString(), approvalRevision: row.approval.revision, thumbnailId: row.thumbnail.id, driveFileId: row.drive.driveFileId! });
      }
    }
    results.push({ channelId: channel.id, channelName: channel.name, language: normalizeTutorialLanguage(channel.language) ?? "en", configured: mappingValid && scheduleValid, eligible: admitted.length, planned: entries.length, excludedJobs, exclusionCounts, entries });
  }

  return {
    version: "tutorial-production-batch/1",
    mode: "dry-run",
    generatedAt: input.now.toISOString(),
    limits: { perChannel: maxPerChannel, perLocalDay: 30 },
    enabledChannels: input.channels.filter((channel) => channel.acceptsTutorials).map((channel) => {
      const metadata = channel.metadata && typeof channel.metadata === "object" ? channel.metadata as Record<string, unknown> : null;
      return { channelId: channel.id, channelName: channel.name, language: normalizeTutorialLanguage(channel.language) ?? channel.language, isPrimary: channel.isPrimary, uploaderMapped: Boolean(channel.uploaderChannelKey && UPLOADER_KEY.test(channel.uploaderChannelKey)), hasExplicitProfile: Boolean(metadata && Object.prototype.hasOwnProperty.call(metadata, "tutorialChannelProfile")), hasExplicitSchedule: Boolean(metadata && Object.prototype.hasOwnProperty.call(metadata, "tutorialSchedule")) };
    }),
    totals: {
      channels: results.length,
      baseJobs: results.reduce((sum, channel) => sum + channel.eligible + channel.excludedJobs, 0),
      eligible: results.reduce((sum, channel) => sum + channel.eligible, 0),
      planned: results.reduce((sum, channel) => sum + channel.planned, 0),
      excludedJobs: results.reduce((sum, channel) => sum + channel.excludedJobs, 0),
    },
    channels: results,
  };
}

type QueryClient = Pick<DrizzleClient, "select">;
export async function loadTutorialProductionBatchInput(db: QueryClient, now = new Date()): Promise<TutorialProductionBatchInput> {
  const channelRows = await db.select({ id: channels.id, name: channels.name, language: channels.language, acceptsTutorials: channels.accepts_tutorials, isPrimary: channels.is_primary, uploaderChannelKey: channels.uploader_channel_key, metadata: channels.metadata }).from(channels).where(eq(channels.accepts_tutorials, true)).orderBy(asc(channels.name));
  const channelIds = channelRows.map((channel) => channel.id);
  if (!channelIds.length) return { now, channels: [], jobs: [], thumbnails: [], driveVideos: [], dispatches: [], occupied: [] };
  const jobRows = await db.select({ id: tutorialJobs.id, channelId: tutorialJobs.channel_id, title: tutorialJobs.title, language: tutorialJobs.language, status: tutorialJobs.status, sourceJobId: tutorialJobs.source_job_id, parentJobId: tutorialJobs.parent_job_id, finalPath: tutorialJobs.final_path, recordingPath: tutorialJobs.recording_path, scriptText: tutorialJobs.script_text, recordedAt: tutorialJobs.recorded_at, completedAt: tutorialJobs.completed_at, description: tutorialJobs.description, tags: tutorialJobs.tags, vaReviewStatus: tutorialJobs.va_review_status, publicationApproval: tutorialJobs.publication_approval, outputQaStatus: tutorialJobs.output_qa_status, scheduledFor: tutorialJobs.scheduled_for, isUploaded: tutorialJobs.is_uploaded, uploaderStatus: tutorialJobs.uploader_status, uploaderJobId: tutorialJobs.uploader_job_id, uploadVerifiedAt: tutorialJobs.upload_verified_at }).from(tutorialJobs).where(and(inArray(tutorialJobs.channel_id, channelIds), eq(tutorialJobs.status, "COMPLETED"), isNull(tutorialJobs.source_job_id), isNull(tutorialJobs.parent_job_id))).orderBy(asc(tutorialJobs.completed_at), asc(tutorialJobs.id));
  const jobIds = jobRows.map((job) => job.id);
  const [thumbnailRows, driveRows, dispatchRows, occupiedRows] = await Promise.all([
    jobIds.length ? db.select({ id: thumbnails.id, jobId: thumbnails.subject_id, channelId: thumbnails.channel_id, language: thumbnails.language, status: thumbnails.status, outputPath: thumbnails.output_path, isSelected: thumbnails.is_selected, reviewVerdict: thumbnails.review_verdict }).from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), inArray(thumbnails.subject_id, jobIds), eq(thumbnails.is_selected, true))) : [],
    jobIds.length ? db.select({ id: storageArtifacts.id, jobId: storageArtifacts.job_id, state: storageArtifacts.state, vpsPath: storageArtifacts.vps_path, driveFileId: storageArtifacts.drive_file_id, verifiedAt: storageArtifacts.verified_at, checksumSha256: storageArtifacts.checksum_sha256, bytes: storageArtifacts.bytes }).from(storageArtifacts).where(and(eq(storageArtifacts.owner_kind, "tutorial_job"), eq(storageArtifacts.kind, "final_video"), inArray(storageArtifacts.job_id, jobIds))) : [],
    jobIds.length ? db.select({ jobId: tutorialUploadDispatches.tutorial_job_id, state: tutorialUploadDispatches.state }).from(tutorialUploadDispatches).where(inArray(tutorialUploadDispatches.tutorial_job_id, jobIds)) : [],
    db.select({ channelId: tutorialJobs.channel_id, at: tutorialJobs.scheduled_for }).from(tutorialJobs).where(and(inArray(tutorialJobs.channel_id, channelIds), isNotNull(tutorialJobs.scheduled_for))),
  ]);
  return { now, channels: channelRows, jobs: jobRows, thumbnails: thumbnailRows, driveVideos: driveRows, dispatches: dispatchRows, occupied: occupiedRows.flatMap((row) => row.channelId && row.at ? [{ channelId: row.channelId, at: row.at }] : []) };
}

export async function inspectTutorialProductionBatch(db: QueryClient, now = new Date(), maxPerChannel = MAX_PER_CHANNEL) {
  return planTutorialProductionBatch({ ...await loadTutorialProductionBatchInput(db, now), maxPerChannel });
}

/** The only mutating path: reserve planned `scheduled_for` values. It never
 * changes approvals, thumbnails, dispatch rows, uploader state, or media. */
export async function reserveTutorialProductionBatch(db: DrizzleClient, now = new Date(), maxPerChannel = MAX_PER_CHANNEL) {
  return db.transaction(async (tx) => {
    // Serialize with every uploader admission path so a dispatch cannot appear
    // between the duplicate-evidence check and reservation persistence.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tutorial-dispatch-admission'))`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tutorial-production-batch-admission'))`);
    const initial = await inspectTutorialProductionBatch(tx as unknown as QueryClient, now, maxPerChannel);
    const jobIds = initial.channels.flatMap((channel) => channel.entries.map((entry) => entry.jobId)).sort();
    if (jobIds.length) await tx.select({ id: tutorialJobs.id }).from(tutorialJobs).where(inArray(tutorialJobs.id, jobIds)).orderBy(asc(tutorialJobs.id)).for("update");
    // Approval/delivery paths lock the source before its destination channel;
    // retain that order here to avoid an inverted-lock deadlock.
    const channelIds = initial.channels.filter((channel) => channel.planned).map((channel) => channel.channelId).sort();
    if (channelIds.length) await tx.select({ id: channels.id }).from(channels).where(inArray(channels.id, channelIds)).orderBy(asc(channels.id)).for("update");
    const current = await inspectTutorialProductionBatch(tx as unknown as QueryClient, now, maxPerChannel);
    for (const channel of current.channels) for (const entry of channel.entries) {
      const updated = await tx.update(tutorialJobs).set({ scheduled_for: new Date(entry.publishAt) }).where(and(eq(tutorialJobs.id, entry.jobId), isNull(tutorialJobs.scheduled_for))).returning({ id: tutorialJobs.id });
      if (updated.length !== 1) throw new Error(`Admission changed while reserving ${entry.jobId}; transaction rolled back`);
    }
    return { ...current, mode: "commit" as const };
  });
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function tutorialProductionBatchCsv(plan: TutorialProductionBatchPlan) {
  const rows = [["channel_id", "channel_name", "job_id", "title", "completed_at", "publish_at", "approval_revision", "thumbnail_id", "drive_file_id"]];
  for (const channel of plan.channels) for (const entry of channel.entries) rows.push([channel.channelId, channel.channelName, entry.jobId, entry.title, entry.completedAt ?? "", entry.publishAt, entry.approvalRevision, entry.thumbnailId, entry.driveFileId]);
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}
