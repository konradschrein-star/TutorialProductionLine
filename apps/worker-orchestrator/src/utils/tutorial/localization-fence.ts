import { and, eq, tutorialJobs, thumbnails, tutorialSourceRevision, type DrizzleClient } from "@repo/db";
import { normalizeTutorialLanguage } from "@repo/contracts";

export async function assertLocalizationCurrent(
  db: Pick<DrizzleClient, "select">,
  input: { sourceJobId: string; childId: string; sourceRevision?: string; thumbnailId?: string },
) {
  const [source] = await db.select().from(tutorialJobs).where(eq(tutorialJobs.id, input.sourceJobId));
  const [child] = await db.select().from(tutorialJobs).where(eq(tutorialJobs.id, input.childId));
  if (!source || !child || source.status !== "COMPLETED" || source.error_stage === "rework_requested" || child.status === "CANCELLED" || child.source_job_id !== source.id) throw new Error("Localization inputs were withdrawn. Reopen the current source before retrying.");
  if (input.sourceRevision && tutorialSourceRevision(source) !== input.sourceRevision) throw new Error("Source changed during localization. Stale output was not accepted.");
  if (input.thumbnailId) {
    const selected = await db.select().from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, child.id), eq(thumbnails.is_selected, true)));
    const matching = selected.filter((row) => normalizeTutorialLanguage(row.language) === normalizeTutorialLanguage(child.language));
    if (matching.length !== 1 || matching[0]!.id !== input.thumbnailId || matching[0]!.channel_id !== child.channel_id || matching[0]!.status !== "completed" || !matching[0]!.output_path || !["acceptable", "strong"].includes(matching[0]!.review_verdict)) throw new Error("Thumbnail changed during localization. Approve the current thumbnail before retrying.");
  }
}
