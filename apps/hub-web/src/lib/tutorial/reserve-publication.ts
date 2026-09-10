import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { channels, thumbnails, tutorialJobs, reserveTutorialPublicationSlot, type DrizzleClient } from "@repo/db";
import { ChannelScheduleSchema, nextPublicationSlot } from "./publication-slots";
import { assessPublicationVariant } from "./publication-readiness";

type Transaction = Parameters<Parameters<DrizzleClient["transaction"]>[0]>[0];

/** Reserve on each variant's existing channel. No language/name routing here.
 * The caller holds the English source lock; channel locks serialize concurrent
 * approvals from different VAs. Failed/incomplete locales stay outstanding. */
export async function reserveCompletedTutorialSlots(tx: Transaction, sourceId: string, now = new Date(), approvedIds?: string[]) {
  const completed = await tx.select()
    .from(tutorialJobs).where(
      or(eq(tutorialJobs.id, sourceId), eq(tutorialJobs.source_job_id, sourceId)),
    );
  const reserved: Array<{ jobId: string; channelId: string; publishAt: string }> = [];
  const outstanding: Array<{ jobId: string; reason: string }> = [];
  const candidates = completed.length ? await tx.select({
    id: thumbnails.id, subjectId: thumbnails.subject_id, language: thumbnails.language,
    channelId: thumbnails.channel_id, status: thumbnails.status,
    isSelected: thumbnails.is_selected, outputPath: thumbnails.output_path,
  }).from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), inArray(thumbnails.subject_id, completed.map((row) => row.id)))) : [];
  const variants = completed.flatMap((row) => {
    if (approvedIds && !approvedIds.includes(row.id)) return [];
    const readiness = assessPublicationVariant(row, candidates.filter((candidate) => candidate.subjectId === row.id));
    if (!readiness.ready) {
      outstanding.push({ jobId: row.id, reason: readiness.reasons.join(" ") });
      return [];
    }
    return [{ id: row.id, channelId: row.channel_id, scheduledFor: row.scheduled_for }];
  });
  // Stable lock ordering prevents two multilingual approvals deadlocking.
  const channelIds = [...new Set(variants.flatMap((row) => row.channelId ? [row.channelId] : []))].sort();
  for (const channelId of channelIds) {
    const [channel] = await tx.select().from(channels).where(eq(channels.id, channelId)).limit(1).for("update");
    if (!channel) continue;
    const metadata = channel.metadata as Record<string, unknown> | null;
    const config = ChannelScheduleSchema.safeParse(metadata?.tutorialSchedule ?? {});
    if (!config.success) {
      for (const row of variants.filter((row) => row.channelId === channelId)) outstanding.push({ jobId: row.id, reason: "Channel schedule configuration is invalid; ask an Admin to correct it." });
      continue;
    }
    for (const row of variants.filter((row) => row.channelId === channelId)) {
      const at = await reserveTutorialPublicationSlot(tx, row.id, now);
      reserved.push({ jobId: row.id, channelId, publishAt: at.toISOString() });
    }
  }
  for (const row of variants.filter((row) => !row.channelId)) outstanding.push({ jobId: row.id, reason: "Assign a destination channel before this tutorial can enter the content plan." });
  return { reserved, outstanding };
}
