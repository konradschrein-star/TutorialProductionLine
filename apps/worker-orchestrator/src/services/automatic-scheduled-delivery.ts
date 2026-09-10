import { and, asc, eq, isNotNull, isNull, gt, sql } from "drizzle-orm";
import { channels, tutorialJobs, thumbnails, tutorialUploadDispatches, systemSettings, tutorialJobEvents, tutorialSourceRevision, type DrizzleClient } from "@repo/db";
import { TutorialDeliveryPolicySchema, TutorialUploaderAttributesSchema, SCHEDULED_DELIVERY_VERSION, normalizeTutorialLanguage } from "@repo/contracts";
import { capturePublicationApproval, publicationApprovalMatches } from "@repo/media-core";
import { withTutorialPublicationInputs } from "../utils/tutorial/media-inputs.js";
type Tx = Parameters<Parameters<DrizzleClient["transaction"]>[0]>[0];
async function verify(tx: Tx, job: typeof tutorialJobs.$inferSelect, revision: string) {
  if (job.status !== "COMPLETED" || !job.channel_id || !job.language || !job.final_path || !job.description?.trim() || !job.tags?.length || !job.thumbnail_text_top?.trim()) throw new Error("Complete video, copy and localized metadata are required.");
  const selected = await tx.select().from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, job.id), eq(thumbnails.is_selected, true)));
  const asset = selected[0];
  if (selected.length !== 1 || !asset?.output_path || asset.channel_id !== job.channel_id || normalizeTutorialLanguage(asset.language) !== normalizeTutorialLanguage(job.language) || asset.status !== "completed" || !["acceptable", "strong"].includes(asset.review_verdict)) throw new Error("Selected thumbnail needs approval.");
  const identity = { jobId: job.id, channelId: job.channel_id, language: job.language, sourceRevision: revision, title: job.title, description: job.description, tags: job.tags, videoPath: job.final_path, thumbnailId: asset.id, thumbnailPath: asset.output_path };
  const approval = await withTutorialPublicationInputs(identity, () => capturePublicationApproval(identity), {transaction:tx});
  if (!publicationApprovalMatches(job.publication_approval, approval)) throw new Error("Assets changed after final review.");
  return approval;
}

/** Durable approved rows are the recovery source. May restore verified Drive bytes;
 * never starts external publication or a paid generation request. */
export async function recoverAutomaticScheduledDelivery(db: DrizzleClient, afterId?: string, now = new Date()) {
  const candidates = await db.select({ id: tutorialJobs.id, sourceId: tutorialJobs.source_job_id }).from(tutorialJobs).innerJoin(channels, eq(channels.id, tutorialJobs.channel_id)).leftJoin(tutorialUploadDispatches, eq(tutorialUploadDispatches.tutorial_job_id, tutorialJobs.id)).where(and(eq(tutorialJobs.status, "COMPLETED"), eq(tutorialJobs.is_uploaded, false), isNotNull(tutorialJobs.publication_approval), isNotNull(tutorialJobs.scheduled_for), isNull(tutorialUploadDispatches.id), sql`${channels.metadata}->'tutorialDelivery'->>'mode' = 'scheduled_automatic'`, afterId ? gt(tutorialJobs.id, afterId) : undefined)).orderBy(asc(tutorialJobs.id)).limit(20);
  let queued = 0; let blocked = 0;
  for (const candidate of candidates) {
    try {
      const created = await db.transaction(async tx => {
        const [source] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, candidate.sourceId ?? candidate.id)).for("update");
        const [job] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, candidate.id)).for("update");
        if (!source || !job || source.va_review_status !== "approved" || job.is_uploaded || job.uploader_job_id || job.upload_verified_at) return false;
        const [existing] = await tx.select({ id: tutorialUploadDispatches.id }).from(tutorialUploadDispatches).where(eq(tutorialUploadDispatches.tutorial_job_id, job.id));
        if (existing) return false;
        const revision = tutorialSourceRevision(source);
        const sourceApproval = await verify(tx, source, revision);
        const approval = source.id === job.id ? sourceApproval : await verify(tx, job, revision);
        // Channel lock serializes the final policy decision with Admin changes.
        const [channel] = await tx.select().from(channels).where(eq(channels.id, job.channel_id!)).for("update");
        const metadata = channel?.metadata as Record<string, unknown> | null;
        const policy = TutorialDeliveryPolicySchema.safeParse(metadata?.tutorialDelivery ?? {});
        if (!policy.success || policy.data.mode !== "scheduled_automatic") return false;
        if (!channel?.accepts_tutorials || !channel.uploader_channel_key || !/^[a-z][a-z0-9_-]{0,63}$/.test(channel.uploader_channel_key) || normalizeTutorialLanguage(channel.language) !== normalizeTutorialLanguage(job.language)) throw new Error("Assigned channel needs a matching language and uploader mapping.");
        if (!job.scheduled_for || job.scheduled_for.getTime() <= now.getTime()) throw new Error("Publication reservation is overdue. Ask an Admin to move the slot.");
        const attributes = TutorialUploaderAttributesSchema.parse({ title: job.title.trim(), description: job.description!.trim(), tags: job.tags, visibility: "private", made_for_kids: false, monetization: policy.data.monetization, ...(policy.data.monetization === "on" ? { ad_suitability: "none" } : {}) });
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tutorial-dispatch-admission'))`);
        const [control] = await tx.select().from(systemSettings).where(eq(systemSettings.id, "singleton"));
        if (control?.tutorialDispatchPaused) return false;
        await tx.insert(tutorialUploadDispatches).values({ tutorial_job_id: job.id, idempotency_key: `tutorial:${job.id}:scheduled:r1`, channel_key: channel.uploader_channel_key, video_path: approval.identity.videoPath, thumbnail_id: approval.identity.thumbnailId, thumbnail_path: approval.identity.thumbnailPath, approved_asset_snapshot: { ...approval, uploaderChannelKey: channel.uploader_channel_key }, attributes, state: "generic_queued", requested_by: job.va_reviewed_by ?? source.va_reviewed_by, scheduled_delivery: { version: SCHEDULED_DELIVERY_VERSION, publishAt: job.scheduled_for.toISOString(), approvalRevision: approval.revision, automatic: true, policy: policy.data }, latest_message: "Approved assets automatically queued by channel policy. Awaiting a compatible scheduled connector; no external upload has started." });
        await tx.insert(tutorialJobEvents).values({ tutorial_job_id: job.id, event_type: "delivery_auto_queued", event_key: `auto-queue:${approval.revision}`, payload: { approvalRevision: approval.revision, channelId: channel.id, publishAt: job.scheduled_for.toISOString(), policy: policy.data } }).onConflictDoNothing();
        return true;
      });
      if (created) queued++;
    } catch (error) {
      blocked++;
      await db.insert(tutorialJobEvents).values({ tutorial_job_id: candidate.id, event_type: "delivery_auto_blocked", event_key: "auto-delivery-first-blocker", payload: { reason: error instanceof Error ? error.message : "Automatic request preparation failed", action: "Check current approval, channel mapping and future reservation; recovery retries automatically." } }).onConflictDoNothing().catch(() => undefined);
    }
  }
  return { queued, blocked, nextCursor: candidates.length === 20 ? candidates.at(-1)!.id : undefined };
}
export function startAutomaticScheduledDeliveryRecovery(db: DrizzleClient) {
  let running = false; let stopped = false; let cursor: string | undefined;
  const tick = async () => {
    if (running || stopped) return; running = true;
    try { const result = await recoverAutomaticScheduledDelivery(db, cursor); cursor = result.nextCursor; if (result.queued) console.log(JSON.stringify({ message: "Approved tutorial deliveries queued from opt-in channel policy", count: result.queued })); }
    catch { console.warn("Automatic scheduled-delivery recovery unavailable; no provider call attempted."); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), 60_000); timer.unref(); void tick();
  return () => { stopped = true; clearInterval(timer); };
}
