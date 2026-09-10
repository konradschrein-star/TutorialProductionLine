import { eq } from "drizzle-orm";
import {
  type DrizzleClient,
  tutorialLegacyArchive,
  tutorialLegacyArchiveEvents,
  tutorialJobs,
  tutorialUploadDispatches,
  users,
  channels,
  tutorialJobEvents,
} from "@repo/db";
import { mayProduceOnChannel } from "./channel-access";
export class ArchiveRoutingError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const ROUTABLE_SOURCE_STATUSES = new Set([
  "QUEUED",
  "GENERATING_SCRIPT",
  "GENERATING_AUDIO",
  "READY_TO_RECORD",
  "AWAITING_UPLOAD",
  "RECORDED",
  "FAILED_SCRIPT",
  "FAILED_AUDIO",
  "FAILED_SPLICE",
  "SPLICING",
]);
export async function routeLegacyArchive(
  db: DrizzleClient,
  archiveId: string,
  channelId: string,
  actorId: string,
  reason: string,
) {
  if (reason.trim().length < 5 || reason.length > 1000)
    throw new ArchiveRoutingError(400, "A concise routing reason is required.");
  return db.transaction(async (tx) => {
    const [actor] = await tx.select().from(users).where(eq(users.id, actorId));
    if (!actor?.is_active || actor.role !== "ADMIN")
      throw new ArchiveRoutingError(403, "Admin access required.");
    const [archive] = await tx
      .select()
      .from(tutorialLegacyArchive)
      .where(eq(tutorialLegacyArchive.id, archiveId))
      .for("update");
    if (!archive)
      throw new ArchiveRoutingError(404, "Archive record not found.");
    if (!archive.needs_routing || archive.source_table !== "tutorial_jobs")
      throw new ArchiveRoutingError(
        409,
        "Only active unrouted original source work can be assigned here.",
      );
    if (archive.source_parent_id)
      throw new ArchiveRoutingError(
        409,
        "Legacy segments remain archive-only; do not treat them as original work.",
      );
    if (!ROUTABLE_SOURCE_STATUSES.has(archive.source_status))
      throw new ArchiveRoutingError(
        409,
        "This legacy workflow remains archive-only and needs a separate migration decision.",
      );
    const [producer] = archive.owner_user_id
      ? await tx
          .select()
          .from(users)
          .where(eq(users.id, archive.owner_user_id))
          .for("update")
      : [];
    if (!producer)
      throw new ArchiveRoutingError(
        409,
        "Import and activate the original producer account first. No replacement owner is assigned.",
      );
    let runtime: typeof tutorialJobs.$inferSelect | undefined;
    if (archive.runtime_job_id) {
      [runtime] = await tx
        .select()
        .from(tutorialJobs)
        .where(eq(tutorialJobs.id, archive.runtime_job_id))
        .for("update");
      if (
        !runtime ||
        runtime.created_by !== producer.id ||
        runtime.source_job_id ||
        runtime.parent_job_id
      )
        throw new ArchiveRoutingError(
          409,
          "Linked runtime identity does not match this original producer.",
        );
      if (runtime.id !== archive.source_id)
        throw new ArchiveRoutingError(
          409,
          "Linked runtime UUID must preserve the source job identity.",
        );
      const [dispatch] = await tx
        .select({ id: tutorialUploadDispatches.id })
        .from(tutorialUploadDispatches)
        .where(eq(tutorialUploadDispatches.tutorial_job_id, runtime.id));
      if (
        runtime.publication_approval ||
        runtime.scheduled_for ||
        runtime.is_uploaded ||
        runtime.uploader_job_id ||
        runtime.upload_verified_at ||
        dispatch ||
        ["COMPLETED", "CANCELLED"].includes(runtime.status)
      )
        throw new ArchiveRoutingError(
          409,
          "Approved, delivered or historical runtime jobs cannot be rerouted here.",
        );
      if (
        runtime.channel_id &&
        runtime.channel_id !== archive.assigned_channel_id
      )
        throw new ArchiveRoutingError(
          409,
          "Runtime job already has a destination; use the normal workflow instead.",
        );
    }
    const [channel] = await tx
      .select()
      .from(channels)
      .where(eq(channels.id, channelId))
      .for("update");
    if (!channel || !mayProduceOnChannel(producer, channel))
      throw new ArchiveRoutingError(
        403,
        "Choose an enabled primary channel explicitly assigned to this active producer.",
      );
    if (archive.assigned_channel_id) {
      if (archive.assigned_channel_id !== channelId)
        throw new ArchiveRoutingError(
          409,
          "Migration routing was already assigned. Existing mappings are not silently overwritten.",
        );
      return {
        idempotent: true,
        runtimeUpdated: Boolean(runtime),
        enqueued: false,
        message: "Assigned for migration; not resumed.",
      };
    }
    if (runtime?.channel_id)
      throw new ArchiveRoutingError(
        409,
        "Runtime routing must still be empty.",
      );
    if (runtime) {
      await tx
        .update(tutorialJobs)
        .set({ channel_id: channel.id })
        .where(eq(tutorialJobs.id, runtime.id));
      await tx
        .insert(tutorialJobEvents)
        .values({
          tutorial_job_id: runtime.id,
          actor_id: actorId,
          event_type: "migration_channel_assigned",
          payload: {
            archiveId,
            fromChannelId: null,
            channelId,
            reason,
            enqueued: false,
          },
        });
    }
    await tx
      .update(tutorialLegacyArchive)
      .set({
        assigned_channel_id: channelId,
        assigned_by: actorId,
        assigned_at: new Date(),
      })
      .where(eq(tutorialLegacyArchive.id, archiveId));
    await tx
      .insert(tutorialLegacyArchiveEvents)
      .values({
        archive_id: archiveId,
        actor_id: actorId,
        event_type: "channel_assigned",
        payload: {
          channelId,
          reason,
          runtimeUpdated: Boolean(runtime),
          enqueued: false,
        },
      });
    return {
      idempotent: false,
      runtimeUpdated: Boolean(runtime),
      enqueued: false,
      message: "Assigned for migration; not resumed.",
    };
  });
}
