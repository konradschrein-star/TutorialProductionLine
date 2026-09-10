import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, channels, tutorialJobs, tutorialUploadDispatches, tutorialJobEvents, systemSettings, tutorialSourceRevision } from "@/lib/db";
import { getSecret, type DrizzleClient } from "@repo/db";
import { SCHEDULED_DELIVERY_VERSION, ScheduledDeliveryReceiptSchema, scheduledDeliveryTransitionAllowed, TutorialDeliveryPolicySchema, UploaderSettingsSchema } from "@repo/contracts";
import { verifyPublicationApproval } from "@/lib/tutorial/verify-publication-approval";
import { validateDispatchCandidate, type DispatchRequest } from "@/lib/tutorial/uploader-dispatch";
import { uploaderAdmissionHold } from "./admission-safety";
import { mayAccessDelivery } from "@/lib/tutorial/delivery-access";

type Tx = Parameters<Parameters<DrizzleClient["transaction"]>[0]>[0];
export class DeliveryError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (status: number, message: string): never => { throw new DeliveryError(status, message); };
const hash = (value: unknown) => createHash("sha256").update(hashCanonical(value)).digest("hex");
export async function authorizeDeliveryConnector(request: Request) {
  // Use the existing encrypted customer connection token, never a browser session.
  const expected = await getSecret(db, "UPLOADER_CALLBACK_SECRET").catch(() => "");
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return Boolean(expected && supplied && Buffer.byteLength(expected) === Buffer.byteLength(supplied) && timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)));
}

async function approvedJob(tx: Tx, id: string) {
  const [initial] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, id));
  if (!initial) return fail(404, "Tutorial not found.");
  const [source] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, initial.source_job_id ?? id)).for("update");
  const [job] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, id)).for("update");
  if (!source || !job || source.va_review_status !== "approved" || source.status !== "COMPLETED") return fail(409, "Final review is required.");
  try {
    const revision = tutorialSourceRevision(source);
    const sourceApproval = await verifyPublicationApproval(tx, source, revision);
    const approval = source.id === id ? sourceApproval : await verifyPublicationApproval(tx, job, revision);
    return { job, approval };
  } catch { return fail(409, "Assets or metadata changed after approval. Repeat final review before delivery."); }
}

export async function queueScheduledDelivery(id: string, userId: string, privileged: boolean, declaration: DispatchRequest, role = "") {
  return db.transaction(async tx => {
    const [owned] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, id));
    if (!owned) return fail(404, "Tutorial not found.");
    if (!privileged && !await mayAccessDelivery({ userId, role }, owned)) return fail(403, "Forbidden");
    const { job, approval } = await approvedJob(tx, id);
    const [existing] = await tx.select().from(tutorialUploadDispatches).where(eq(tutorialUploadDispatches.tutorial_job_id, id));
    if (existing) {
      if (!existing.scheduled_delivery) return fail(409, "A different delivery request already exists. Reconcile it before changing transport.");
      return { id: existing.id, state: existing.state, idempotent: true };
    }
    const [channel] = await tx.select().from(channels).where(eq(channels.id, job.channel_id!));
    if (!channel) return fail(409, "Assigned channel is unavailable.");
    const attributes = validateDispatchCandidate({ status: job.status, isUploaded: job.is_uploaded, sourceJobId: job.source_job_id, language: job.language, channelId: job.channel_id, channelLanguage: channel.language, title: job.title, description: job.description, tags: job.tags, finalPath: job.final_path, uploaderChannelKey: channel.uploader_channel_key, thumbnailTextTop: job.thumbnail_text_top, thumbnailTextBottom: job.thumbnail_text_bottom }, { ...declaration, visibility: "private" });
    if (!job.scheduled_for || job.scheduled_for.getTime() <= Date.now()) return fail(409, "A future Studio reservation is required. Ask an Admin to move the overdue slot.");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tutorial-dispatch-admission'))`);
    const [control] = await tx.select().from(systemSettings).where(eq(systemSettings.id, "singleton"));
    if (control?.tutorialDispatchPaused) return fail(409, "New dispatches are paused; external schedules were not cancelled.");
    const [dispatch] = await tx.insert(tutorialUploadDispatches).values({ tutorial_job_id: id, idempotency_key: `tutorial:${id}:scheduled:r1`, channel_key: channel.uploader_channel_key!, video_path: approval.identity.videoPath, thumbnail_id: approval.identity.thumbnailId, thumbnail_path: approval.identity.thumbnailPath, approved_asset_snapshot: { ...approval, uploaderChannelKey: channel.uploader_channel_key }, attributes, state: "generic_queued", requested_by: userId, scheduled_delivery: { version: SCHEDULED_DELIVERY_VERSION, publishAt: job.scheduled_for.toISOString(), approvalRevision: approval.revision }, latest_message: "Awaiting a compatible scheduled-delivery connector. No external upload has started." }).returning();
    return { id: dispatch!.id, state: dispatch!.state, idempotent: false };
  });
}

/** Claim identity is supplied and persisted by the connector before it makes this call. */
export async function claimScheduledDelivery(dispatchId: string, claimId: string) {
  return db.transaction(async tx => {
    const [initial] = await tx.select().from(tutorialUploadDispatches).where(eq(tutorialUploadDispatches.id, dispatchId));
    if (!initial?.scheduled_delivery) return fail(404, "Scheduled request not found.");
    const { job, approval } = await approvedJob(tx, initial.tutorial_job_id);
    const [dispatch] = await tx.select().from(tutorialUploadDispatches).where(eq(tutorialUploadDispatches.id, dispatchId)).for("update");
    const plan = dispatch!.scheduled_delivery!;
    if (plan.claimId) {
      if (plan.claimId !== claimId) return fail(409, "Request was already claimed. Reconcile its outcome; do not create a second upload.");
      // A response-loss replay is read-only. It never reauthorizes another upload.
      return { replay: true, mayStart: false, state: dispatch!.state, request: plan.request, requestSha256: plan.requestSha256 };
    }
    if (dispatch!.state !== "generic_queued") return fail(409, "This request is not available for new execution.");
    if (approval.revision !== plan.approvalRevision || job.scheduled_for?.toISOString() !== plan.publishAt) return fail(409, "Approval or Studio reservation changed. Reconcile this request before proceeding.");
    const [channel] = await tx.select().from(channels).where(eq(channels.id, job.channel_id!)).for("update");
    if (channel?.uploader_channel_key !== dispatch!.channel_key) return fail(409, "Destination mapping changed after the request.");
    if (plan.automatic === true) {
      const policy = TutorialDeliveryPolicySchema.safeParse((channel.metadata as Record<string, unknown> | null)?.tutorialDelivery ?? {});
      if (!policy.success || policy.data.mode !== "scheduled_automatic" || hashCanonical(policy.data) !== hashCanonical(plan.policy)) return fail(409, "Automatic channel delivery policy changed or was disabled. This unclaimed request is held for Admin reconciliation.");
    }
    if (Date.parse(String(plan.publishAt)) <= Date.now()) return fail(409, "Publication slot is overdue; an Admin must reconcile the plan.");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tutorial-dispatch-admission'))`);
    const [control] = await tx.select().from(systemSettings).where(eq(systemSettings.id, "singleton")).for("share");
    const hold = uploaderAdmissionHold(UploaderSettingsSchema.parse(control?.uploader ?? {}));
    if (hold) return fail(409, hold);
    if (control?.tutorialDispatchPaused) return fail(409, "New dispatches are paused. Existing external jobs have not been cancelled.");
    const wire = { version: SCHEDULED_DELIVERY_VERSION, dispatchId, claimId, idempotencyKey: dispatch!.idempotency_key, approvalRevision: approval.revision, channelKey: dispatch!.channel_key, operation: "upload_and_schedule", publishAt: plan.publishAt, attributes: dispatch!.attributes, assets: [ { role: "video", sha256: approval.video.sha256, sizeBytes: approval.video.size, url: `/api/production/delivery/${dispatchId}/assets/video` }, { role: "thumbnail", sha256: approval.thumbnail.sha256, sizeBytes: approval.thumbnail.size, url: `/api/production/delivery/${dispatchId}/assets/thumbnail` } ] };
    const requestSha256 = hash(wire);
    await tx.update(tutorialUploadDispatches).set({ state: "generic_dispatched", scheduled_delivery: { ...plan, claimId, claimedAt: new Date().toISOString(), request: wire, requestSha256 }, manifest_sha256: requestSha256, latest_message: "Connector admitted. Upload remains unverified until exact-request receipts arrive." }).where(eq(tutorialUploadDispatches.id, dispatchId));
    return { replay: false, mayStart: true, request: wire, requestSha256 };
  });
}

export async function ingestScheduledReceipt(raw: unknown) {
  const parsed = ScheduledDeliveryReceiptSchema.safeParse(raw);
  if (!parsed.success) return fail(400, parsed.error.issues.map(x => x.message).join(" "));
  const receipt = parsed.data;
  const receivedAt = new Date();
  if (Date.parse(receipt.occurredAt) > receivedAt.getTime() + 60_000 || (receipt.publishedAt && Date.parse(receipt.publishedAt) > receivedAt.getTime()) || (receipt.evidence && Date.parse(receipt.evidence.observedAt) > receivedAt.getTime() + 60_000)) return fail(400, "Evidence cannot be dated in the future.");
  return db.transaction(async tx => {
    const [initial] = await tx.select().from(tutorialUploadDispatches).where(eq(tutorialUploadDispatches.id, receipt.dispatchId));
    if (!initial?.scheduled_delivery) return fail(404, "Scheduled request not found.");
    // Same lock order as approval/claim/manual reporting. Reconciliation stays on during pause.
    const [initialJob] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, initial.tutorial_job_id));
    if (!initialJob) return fail(404, "Tutorial not found.");
    await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, initialJob.source_job_id ?? initialJob.id)).for("update");
    const [job] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, initialJob.id)).for("update");
    const [dispatch] = await tx.select().from(tutorialUploadDispatches).where(eq(tutorialUploadDispatches.id, receipt.dispatchId)).for("update");
    const plan = dispatch!.scheduled_delivery!;
    if (receipt.claimId !== plan.claimId || receipt.approvalRevision !== plan.approvalRevision || receipt.requestSha256 !== plan.requestSha256) return fail(409, "Receipt does not match the exact admitted request.");
    const eventKey = `scheduled:${receipt.dispatchId}:${receipt.sequence}`;
    const [existing] = await tx.select().from(tutorialJobEvents).where(and(eq(tutorialJobEvents.tutorial_job_id, job!.id), eq(tutorialJobEvents.event_type, "delivery_receipt"), eq(tutorialJobEvents.event_key, eventKey)));
    if (existing) {
      if (JSON.stringify(existing.payload) !== JSON.stringify(JSON.parse(JSON.stringify(receipt))) && hashCanonical(existing.payload) !== hashCanonical(receipt)) return fail(409, "Sequence already contains different evidence.");
      return { duplicate: true, state: dispatch!.state };
    }
    if (receipt.sequence <= dispatch!.latest_sequence) return fail(409, "Out-of-order unknown receipt. Replay the original sequence or send newer reconciliation evidence.");
    if (!scheduledDeliveryTransitionAllowed(dispatch!.state, receipt.state)) return fail(409, "Receipt would regress delivery state.");
    if (receipt.state === "scheduled" && new Date(receipt.scheduledFor!).toISOString() !== plan.publishAt) return fail(409, "Provider schedule does not match Studio's reserved slot.");
    if (dispatch!.youtube_video_id && receipt.videoId && dispatch!.youtube_video_id !== receipt.videoId) return fail(409, "Video identity changed. Reconcile without creating another upload.");
    await tx.insert(tutorialJobEvents).values({ tutorial_job_id: job!.id, event_type: "delivery_receipt", event_key: eventKey, payload: receipt });
    const state = `generic_${receipt.state}`;
    await tx.update(tutorialUploadDispatches).set({ state, latest_sequence: receipt.sequence, latest_message: receipt.message, youtube_video_id: receipt.videoId ?? dispatch!.youtube_video_id, youtube_video_url: receipt.videoId ? `https://www.youtube.com/watch?v=${receipt.videoId}` : dispatch!.youtube_video_url, error_message: ["failed", "uncertain"].includes(receipt.state) ? receipt.message : null, error_retryable: false, terminal_at: receipt.state === "published" ? receivedAt : null, scheduled_delivery: { ...plan, lastEvidence: receipt.evidence ?? null, externalScheduledFor: receipt.scheduledFor ?? plan.externalScheduledFor ?? null } }).where(eq(tutorialUploadDispatches.id, receipt.dispatchId));
    // A receipt for superseded output stays in history; never bless current output.
    let current = false;
    try { current = (await approvedJob(tx, job!.id)).approval.revision === receipt.approvalRevision; }
    catch { /* Keep historical evidence without blessing changed current output. */ }
    if (current) await tx.update(tutorialJobs).set({ uploader_status: receipt.state === "published" ? "uploaded" : receipt.state, uploader_job_id: receipt.dispatchId, uploader_last_callback_at: receivedAt, ...(receipt.videoId ? { youtube_upload_url: `https://www.youtube.com/watch?v=${receipt.videoId}` } : {}), ...(receipt.visibility ? { youtube_visibility: receipt.visibility } : {}), ...(["uploaded", "scheduled", "published"].includes(receipt.state) ? { upload_verified_at: receivedAt } : {}), ...(receipt.state === "published" ? { is_uploaded: true, uploaded_at: new Date(receipt.publishedAt!), youtube_published_at: new Date(receipt.publishedAt!) } : {}) }).where(eq(tutorialJobs.id, job!.id));
    return { duplicate: false, state, currentRevision: current, reconciliationRequired: !current || ["failed", "uncertain"].includes(receipt.state) };
  });
}

function hashCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(hashCanonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${JSON.stringify(k)}:${hashCanonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export async function getScheduledAsset(dispatchId: string, role: "video" | "thumbnail") {
  return db.transaction(async tx => {
    const [dispatch] = await tx.select().from(tutorialUploadDispatches).where(eq(tutorialUploadDispatches.id, dispatchId));
    if (!dispatch?.scheduled_delivery?.claimId) return fail(404, "Admitted request not found.");
    const { approval } = await approvedJob(tx, dispatch.tutorial_job_id);
    if (approval.revision !== dispatch.scheduled_delivery.approvalRevision) return fail(409, "Approved assets changed. Stop and reconcile; do not upload replacement bytes.");
    return { jobId: dispatch.tutorial_job_id, path: role === "video" ? approval.identity.videoPath : approval.identity.thumbnailPath, sha256: approval[role].sha256, size: approval[role].size };
  });
}
