import { and, eq, isNotNull } from "drizzle-orm";
import { ChannelScheduleSchema, nextPublicationSlot } from "@repo/contracts";
import { tutorialJobs, channels } from "./schema/index.js";
import type { DrizzleClient } from "./client.js";
type Transaction = Parameters<Parameters<DrizzleClient["transaction"]>[0]>[0];

/** Caller holds the source lock. Multi-channel callers must lock in sorted order. */
export async function reserveTutorialPublicationSlot(tx: Transaction, jobId: string, now = new Date()) {
  const [job] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, jobId));
  if (!job?.channel_id) throw new Error("Assign a destination channel before scheduling.");
  const [channel] = await tx.select().from(channels).where(eq(channels.id, job.channel_id)).for("update");
  if (!channel) throw new Error("Destination channel no longer exists.");
  const config = ChannelScheduleSchema.parse((channel.metadata as Record<string, unknown> | null)?.tutorialSchedule ?? {});
  if (job.scheduled_for) return job.scheduled_for;
  const rows = await tx.select({ at: tutorialJobs.scheduled_for }).from(tutorialJobs).where(and(eq(tutorialJobs.channel_id, channel.id), isNotNull(tutorialJobs.scheduled_for)));
  const at = nextPublicationSlot(now, rows.flatMap((row) => row.at ? [row.at] : []), config);
  await tx.update(tutorialJobs).set({ scheduled_for: at }).where(eq(tutorialJobs.id, jobId));
  return at;
}
