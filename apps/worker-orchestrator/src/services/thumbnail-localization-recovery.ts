import { and, asc, eq, gt, inArray, or } from "drizzle-orm";
import { tutorialJobs, thumbnails, channels, tutorialSourceRevision, type DrizzleClient } from "@repo/db";
import { normalizeTutorialLanguage, resolveTutorialChannelTargets, type TutorialTranslatePayload } from "@repo/contracts";
import type { Queue } from "bullmq";

type TranslateQueue = Pick<Queue<TutorialTranslatePayload>, "getJob" | "add">;

/** Approved thumbnails and awaiting drafts are durable intent. Retrying Redis
 * delivery never recreates them. Failed work requires explicit operator retry. */
export async function reconcileThumbnailLocalization(db: DrizzleClient, queue: TranslateQueue, afterSourceId?: string) {
  const pending = await db.selectDistinct({ sourceId: tutorialJobs.source_job_id }).from(tutorialJobs)
    .where(and(eq(tutorialJobs.status, "AWAITING_THUMBNAILS"), afterSourceId ? gt(tutorialJobs.source_job_id, afterSourceId) : undefined))
    .orderBy(asc(tutorialJobs.source_job_id)).limit(50);
  let enqueued = 0;
  for (const candidate of pending) {
    if (!candidate.sourceId) continue;
    await db.transaction(async (tx) => {
      const [source] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, candidate.sourceId!)).limit(1).for("update");
      if (!source || source.status === "CANCELLED" || source.va_review_status === "rework_requested") return;
      const family = await tx.select().from(tutorialJobs).where(or(eq(tutorialJobs.id, source.id), eq(tutorialJobs.source_job_id, source.id)));
      const configuredChannels = await tx.select({ id: channels.id, language: channels.language, isPrimary: channels.is_primary, enabled: channels.accepts_tutorials, metadata: channels.metadata }).from(channels);
      const topology = resolveTutorialChannelTargets(source.channel_id, configuredChannels);
      if (topology.blocked.length) return;
      const languages = ["en", ...topology.targets.map(target => target.language)];
      const variants = languages.map((language) => family.filter((row) => normalizeTutorialLanguage(row.language) === language));
      if (variants.some((matches) => matches.length !== 1)) return;
      const owners = variants.map((matches) => matches[0]!);
      if (topology.targets.some(target => owners.find(owner => normalizeTutorialLanguage(owner.language) === target.language)?.channel_id !== target.channelId)) return;
      for (let index = 0; index < owners.length; index++) {
        const draft = owners[index]!;
        if ((index > 0 && draft.status !== "AWAITING_THUMBNAILS") || draft.thumbnail_text_top?.trim() || draft.thumbnail_text_bottom?.trim()) continue;
        const jobId = `tutorial-thumbnail-copy-${source.id}-${languages[index]}`;
        if (await queue.getJob(jobId)) continue;
        await queue.add("tutorial-thumbnail-copy", { sourceJobId: source.id, targetLanguage: languages[index]!, purpose: "thumbnail-copy" }, { jobId, attempts: 2 });
      }
      if (source.status !== "COMPLETED" || !source.recording_path || !source.script_text || !source.final_path) return;
      const selected = await tx.select().from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), inArray(thumbnails.subject_id, owners.map((row) => row.id)), eq(thumbnails.is_selected, true)));
      const approved = owners.map((owner) => {
        const matches = selected.filter((row) => row.subject_id === owner.id && normalizeTutorialLanguage(row.language) === normalizeTutorialLanguage(owner.language));
        const row = matches[0];
        return matches.length === 1 && row && row.channel_id === owner.channel_id && row.output_path && row.status === "completed" && ["acceptable", "strong"].includes(row.review_verdict) ? row : null;
      });
      if (approved.some((row) => !row)) return;
      for (let index = 1; index < owners.length; index++) {
        if (owners[index]!.status !== "AWAITING_THUMBNAILS") continue;
        const language = languages[index]!;
        const jobId = `tutorial-translate-${source.id}-${language}`;
        // Retained terminal queue records are evidence, not permission to spend
        // again. The explicit retry API reconciles those when requested.
        if (await queue.getJob(jobId)) continue;
        await queue.add("tutorial-translate", { sourceJobId: source.id, targetLanguage: language,
          sourceRevision: tutorialSourceRevision(source), thumbnailId: approved[index]!.id,
        }, { jobId, attempts: 2 });
        enqueued++;
      }
    });
  }
  return { enqueued, nextCursor: pending.length === 50 ? pending[pending.length - 1]!.sourceId ?? undefined : undefined };
}

export function startThumbnailLocalizationRecovery(db: DrizzleClient, queue: TranslateQueue) {
  let running = false;
  let stopped = false;
  let cursor: string | undefined;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await reconcileThumbnailLocalization(db, queue, cursor);
      cursor = result.nextCursor;
      if (result.enqueued) console.log(JSON.stringify({ message: "Recovered approved thumbnail localization requests", count: result.enqueued }));
    } catch {
      console.warn("Thumbnail localization recovery unavailable; persisted drafts remain intact and will be checked again.");
    } finally { running = false; }
  };
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
