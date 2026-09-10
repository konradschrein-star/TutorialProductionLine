import { and, asc, eq, isNotNull, isNull, tutorialJobs, thumbnails, tutorialUploadDispatches, tutorialSourceRevision, reserveTutorialPublicationSlot, type DrizzleClient } from "@repo/db";
import { gt } from "drizzle-orm";
import { normalizeTutorialLanguage } from "@repo/contracts";
import { capturePublicationApproval, publicationApprovalMatches } from "@repo/media-core";
import { withTutorialPublicationInputs } from "../utils/tutorial/media-inputs.js";
type Transaction = Parameters<Parameters<DrizzleClient["transaction"]>[0]>[0];

async function snapshot(tx: Transaction, job: typeof tutorialJobs.$inferSelect, sourceRevision: string) {
  if (job.status !== "COMPLETED" || !job.channel_id || !job.language || !job.final_path || !job.title.trim() || !job.description?.trim() || !job.tags?.length || job.tags.some((tag) => !tag.trim())) throw new Error("Publication assets are incomplete.");
  const assets = await tx.select().from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, job.id), eq(thumbnails.is_selected, true)));
  const matching = assets.filter((asset) => normalizeTutorialLanguage(asset.language) === normalizeTutorialLanguage(job.language));
  const selected = matching[0];
  if (matching.length !== 1 || !selected || selected.channel_id !== job.channel_id || selected.status !== "completed" || !selected.output_path || !["acceptable", "strong"].includes(selected.review_verdict)) throw new Error("Approve this language's selected thumbnail.");
  const identity = { jobId: job.id, channelId: job.channel_id, language: job.language, sourceRevision, title: job.title, description: job.description, tags: job.tags, videoPath: job.final_path, thumbnailId: selected.id, thumbnailPath: selected.output_path };
  return withTutorialPublicationInputs(identity, () => capturePublicationApproval(identity), {transaction:tx});
}

/** Only newly produced locales with durable source provenance can inherit review.
 * Legacy outputs and corrected dispatches are never silently reapproved. */
export async function reconcileLateLocalePublication(db: DrizzleClient, afterId?: string, now = new Date()) {
  const pending = await db.select({ id: tutorialJobs.id, sourceId: tutorialJobs.source_job_id }).from(tutorialJobs).where(and(eq(tutorialJobs.status, "COMPLETED"), isNotNull(tutorialJobs.source_job_id), isNotNull(tutorialJobs.localization_source_revision), isNull(tutorialJobs.publication_approval), isNull(tutorialJobs.scheduled_for), afterId ? gt(tutorialJobs.id, afterId) : undefined)).orderBy(asc(tutorialJobs.id)).limit(20);
  let approved = 0; let outstanding = 0;
  const failures: Array<{ jobId: string; reason: string }> = [];
  for (const candidate of pending) {
    try {
      const accepted = await db.transaction(async (tx) => {
        const [source] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, candidate.sourceId!)).for("update");
        const [job] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, candidate.id)).for("update");
        if (!source || !job || source.va_review_status !== "approved" || !source.publication_approval || job.publication_approval || job.scheduled_for || job.status !== "COMPLETED" || job.is_uploaded || job.source_job_id !== source.id) return false;
        const revision = tutorialSourceRevision(source);
        if (job.localization_source_revision !== revision) return false;
        const [dispatch] = await tx.select({ id: tutorialUploadDispatches.id }).from(tutorialUploadDispatches).where(eq(tutorialUploadDispatches.tutorial_job_id, job.id));
        if (dispatch) return false;
        const sourceApproval = await snapshot(tx, source, revision);
        if (!publicationApprovalMatches(source.publication_approval, sourceApproval)) return false;
        const approval = await snapshot(tx, job, revision);
        await tx.update(tutorialJobs).set({ publication_approval: { ...approval, inherited_from_revision: sourceApproval.revision }, va_review_status: "approved", va_reviewed_by: source.va_reviewed_by, va_reviewed_at: now }).where(eq(tutorialJobs.id, job.id));
        await reserveTutorialPublicationSlot(tx, job.id, now);
        return true;
      });
      if (accepted) approved++;
      else {
        outstanding++;
        failures.push({ jobId: candidate.id, reason: "Locale is no longer eligible for inherited approval." });
      }
    } catch (error) {
      outstanding++;
      failures.push({ jobId: candidate.id, reason: error instanceof Error ? error.message : "Late-locale approval failed." });
    }
  }
  return { approved, outstanding, failures, nextCursor: pending.length === 20 ? pending[pending.length - 1]!.id : undefined };
}

export function startLateLocalePublicationRecovery(db: DrizzleClient) {
  let running = false; let stopped = false; let cursor: string | undefined;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await reconcileLateLocalePublication(db, cursor);
      cursor = result.nextCursor;
      if (result.approved) console.log(JSON.stringify({ message: "Late completed locales inherited verified source approval and reserved Studio slots", count: result.approved }));
    } catch { console.warn("Late-locale publication recovery unavailable; no external dispatch was attempted."); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), 60_000); timer.unref(); void tick();
  return () => { stopped = true; clearInterval(timer); };
}
