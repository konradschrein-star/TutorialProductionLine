import { createHash } from "node:crypto";
import { tutorialAiThumbnailsEnabled } from "../utils/tutorial/ai-thumbnail-policy.js";
import { and, asc, eq, gt, isNull, notInArray, or, inArray } from "drizzle-orm";
import { tutorialJobs, thumbnails, tutorialSettings, tutorialThumbnailAiBatches, tutorialUploadDispatches, type DrizzleClient, type TutorialJob } from "@repo/db";
import { ThumbnailPayloadSchema, type ThumbnailPayload } from "@repo/contracts";
import type { Queue } from "bullmq";
type ThumbnailQueue = Pick<Queue<ThumbnailPayload>, "getJob" | "add">;

export function automaticEnglishBatch(source: Pick<TutorialJob, "id" | "channel_id" | "source_job_id" | "parent_job_id" | "language" | "title" | "script_text" | "thumbnail_text_top" | "thumbnail_text_bottom">) {
  if (source.source_job_id || source.parent_job_id || source.language !== "en" || !source.channel_id || !source.script_text?.trim() || !source.thumbnail_text_top?.trim()) return null;
  const revision = createHash("sha256").update(JSON.stringify([source.id, source.channel_id, source.title, source.script_text, source.thumbnail_text_top, source.thumbnail_text_bottom])).digest("hex");
  const requestId = `${revision.slice(0,8)}-${revision.slice(8,12)}-4${revision.slice(13,16)}-8${revision.slice(17,20)}-${revision.slice(20,32)}`;
  const payload = ThumbnailPayloadSchema.parse({ subjectKind: "tutorial_job", subjectId: source.id, channelId: source.channel_id,
    format: "TUTORIAL_STUDIO", language: "en", title: source.title, thumbnailTextTop: source.thumbnail_text_top,
    ...(source.thumbnail_text_bottom?.trim() ? { thumbnailTextBottom: source.thumbnail_text_bottom } : {}), headlineText: [source.thumbnail_text_top, source.thumbnail_text_bottom].filter(Boolean).join("\n"),
    scriptExcerpt: source.script_text.slice(0,2000), requestGroupId: requestId, manualSelection: true, generationKind: "variant", promptMode: "programmatic", onFallback: "warn" });
  return { requestId, payload, count: 5, digest: createHash("sha256").update(JSON.stringify({ payload, count: 5 })).digest("hex") };
}

/** Source rows + persisted batch payload are the outbox. Redis loss cannot mint a new request identity. */
export async function enqueueAutomaticEnglishThumbnails(db: DrizzleClient, queue: ThumbnailQueue, sourceId: string, options: { recoverOnly?: boolean } = {}) {
  if (!tutorialAiThumbnailsEnabled()) return 0;
  const intent = await db.transaction(async tx => {
    const [source] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, sourceId)).limit(1).for("update");
    const [settings] = await tx.select().from(tutorialSettings).where(eq(tutorialSettings.id, 1));
    if (!source || settings?.thumbnail_generation_mode !== "ai" || ["CANCELLED", "FAILED_SCRIPT", "FAILED_AUDIO", "FAILED_SPLICE"].includes(source.status) || source.va_review_status === "rework_requested") return null;
    const family = await tx.select().from(tutorialJobs).where(or(eq(tutorialJobs.id, sourceId), eq(tutorialJobs.source_job_id, sourceId)));
    if (family.some(row => row.is_uploaded || row.uploader_status)) return null;
    const dispatch = await tx.select({ id: tutorialUploadDispatches.id }).from(tutorialUploadDispatches).where(inArray(tutorialUploadDispatches.tutorial_job_id, family.map(row => row.id))).limit(1);
    if (dispatch.length) return null;
    const saved = await tx.select().from(tutorialThumbnailAiBatches).where(eq(tutorialThumbnailAiBatches.job_id, sourceId));
    if (saved.length) return { saved, channelId: source.channel_id };
    // Historical completed work is not permission to start new paid generation.
    if (options.recoverOnly) return null;
    const selected = await tx.select({ id: thumbnails.id }).from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, sourceId), eq(thumbnails.is_selected, true))).limit(1);
    if (selected.length) return null;
    const batch = automaticEnglishBatch(source);
    if (!batch) return null;
    // An explicit VA batch also satisfies intake. Recover its original payload,
    // never create a second paid batch just because its HTTP acknowledgement was lost.
    await tx.insert(tutorialThumbnailAiBatches).values({ job_id: sourceId, request_id: batch.requestId, payload_digest: batch.digest, payload: { payload: batch.payload, count: batch.count } }).onConflictDoNothing();
    const [stored] = await tx.select().from(tutorialThumbnailAiBatches).where(and(eq(tutorialThumbnailAiBatches.job_id, sourceId), eq(tutorialThumbnailAiBatches.request_id, batch.requestId))).limit(1);
    if (!stored || stored.payload_digest !== batch.digest) throw new Error("Automatic thumbnail request identity conflict");
    return { saved: [stored], channelId: source.channel_id };
  });
  if (!intent) return 0;
  let queued = 0;
  for (const saved of intent.saved) {
    const envelope = saved.payload as { payload?: unknown; count?: unknown };
    const parsed = ThumbnailPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success || ![1, 5].includes(Number(envelope.count))) continue;
    const payload = parsed.data;
    if (payload.subjectKind !== "tutorial_job" || payload.subjectId !== sourceId || payload.channelId !== intent.channelId || payload.language !== "en" || payload.requestGroupId !== saved.request_id || payload.manualSelection !== true) continue;
    queued += await enqueueSavedEnglishBatch(db, queue, sourceId, saved.request_id, payload, Number(envelope.count));
  }
  return queued;
}

export async function enqueueSavedEnglishBatch(db: DrizzleClient, queue: ThumbnailQueue, sourceId: string, requestId: string, payload: ThumbnailPayload, count: number) {
  if (!tutorialAiThumbnailsEnabled()) return 0;
  const [batch] = await db.select({ attempted: tutorialThumbnailAiBatches.attempted_variants }).from(tutorialThumbnailAiBatches).where(and(eq(tutorialThumbnailAiBatches.job_id, sourceId), eq(tutorialThumbnailAiBatches.request_id, requestId))).limit(1);
  if (!batch) return 0;
  const existing = await db.select({ variant: thumbnails.variant_index }).from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, sourceId), eq(thumbnails.request_group_id, requestId)));
  let queued = 0;
  for (let variantIndex = 0; variantIndex < count; variantIndex++) {
    if (batch.attempted.includes(variantIndex)) continue;
    if (existing.some(row => row.variant === variantIndex)) continue;
    const jobId = `tutorial-ai-${sourceId}-${requestId}-${variantIndex}`;
    if (await queue.getJob(jobId)) continue;
    await queue.add("thumbnail", { ...payload, variantIndex, manualSelection: true }, { jobId, attempts: 1 }); queued++;
  }
  return queued;
}

export function startAutomaticEnglishThumbnails(db: DrizzleClient, queue: ThumbnailQueue) {
  if (!tutorialAiThumbnailsEnabled()) return () => {};
  let busy = false, stopped = false, cursor: string | undefined;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const rows = await db.select({ id: tutorialJobs.id }).from(tutorialJobs).where(and(isNull(tutorialJobs.source_job_id), eq(tutorialJobs.language, "en"), notInArray(tutorialJobs.status, ["CANCELLED", "FAILED_SCRIPT", "FAILED_AUDIO", "FAILED_SPLICE"]), cursor ? gt(tutorialJobs.id, cursor) : undefined)).orderBy(asc(tutorialJobs.id)).limit(50);
      for (const row of rows) { if (stopped) break; await enqueueAutomaticEnglishThumbnails(db, queue, row.id, { recoverOnly: true }); }
      cursor = rows.length === 50 ? rows[49]!.id : undefined;
    } catch { console.warn("Automatic English thumbnail intake unavailable; saved requests retained"); }
    finally { busy = false; }
  };
  const timer = setInterval(() => void tick(), 30_000); timer.unref(); void tick();
  return () => { stopped = true; clearInterval(timer); };
}
