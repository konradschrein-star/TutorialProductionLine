export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, storageArtifacts, thumbnails, tutorialJobs, tutorialUploadDispatches } from "@/lib/db";
import { and, eq, inArray, or } from "drizzle-orm";
import { selectThumbnail, getThumbnailById } from "@repo/db";
import { normalizeTutorialLanguage } from "@repo/contracts";

/**
 * POST /api/thumbnails/select   { thumbnailId }
 *
 * "Use this one." Marks a thumbnail as the chosen one for its subject and
 * clears the flag on its siblings — the uploader pipeline reads
 * `is_selected = true`.
 *
 * This action had NO route and NO caller anywhere in the app before now:
 * `selectThumbnail()` has existed in the repository since the schema landed
 * with zero call sites, so `is_selected` could only ever be written by the
 * automatic rule (selectBestThumbnailForSubject). A human looking at three
 * generated thumbnails had no way to say which one ships.
 */

const Body = z.object({ thumbnailId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (
    !session ||
    (!hasPermission(session, "manage:thumbnails") &&
      !hasPermission(session, "edit:settings"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Expected { thumbnailId }" },
      { status: 400 },
    );
  }

  const existing = await getThumbnailById(db, parsed.data.thumbnailId);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const privileged = hasPermission(session, "manage:tutorial-settings") || session.role === "ADMIN" || session.role === "MANAGER";
  if (existing.subject_kind !== "tutorial_job" && !privileged) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Only a rendered thumbnail can ship. Selecting a failed/generating row
  // would set is_selected on something with no output_path, and the uploader
  // would publish a video with no thumbnail at all.
  if (existing.status !== "completed" || !existing.output_path) {
    return NextResponse.json(
      {
        error: `Thumbnail is ${existing.status} with no rendered file — only a completed thumbnail can be selected.`,
      },
      { status: 400 },
    );
  }

  if (existing.subject_kind === "tutorial_job") {
    return db.transaction(async (tx) => {
    const [job] = await tx
      .select({
        id: tutorialJobs.id,
        createdBy: tutorialJobs.created_by,
        sourceJobId: tutorialJobs.source_job_id,
        language: tutorialJobs.language,
        channelId: tutorialJobs.channel_id,
      })
      .from(tutorialJobs)
      .where(eq(tutorialJobs.id, existing.subject_id))
      .limit(1);
    if (!job || (!privileged && job.createdBy !== session.userId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const rootId = job.sourceJobId ?? job.id;
    await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, rootId)).for("update");
    if (
      !job ||
      !job.channelId ||
      normalizeTutorialLanguage(job.language) !==
        normalizeTutorialLanguage(existing.language) ||
      existing.channel_id !== job.channelId
    ) {
      return NextResponse.json(
        {
          error:
            "Thumbnail language/channel does not belong to this tutorial variant",
        },
        { status: 409 },
      );
    }
    const family = await tx.select({ id: tutorialJobs.id, uploaded: tutorialJobs.is_uploaded, status: tutorialJobs.uploader_status }).from(tutorialJobs).where(or(eq(tutorialJobs.id, rootId), eq(tutorialJobs.source_job_id, rootId)));
    const [dispatch] = await tx.select({ id: tutorialUploadDispatches.id }).from(tutorialUploadDispatches).where(inArray(tutorialUploadDispatches.tutorial_job_id, family.map((row) => row.id))).limit(1);
    if (dispatch || family.some((row) => row.uploaded || row.status)) return NextResponse.json({ error: "Delivery has started. Reconcile the external upload before changing selected assets." }, { status: 409 });
    await tx.update(thumbnails).set({ is_selected: false }).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, job.id), eq(thumbnails.language, existing.language)));
    const [thumbnail] = await tx.update(thumbnails).set({ is_selected: true }).where(eq(thumbnails.id, existing.id)).returning();
    await tx
      .update(storageArtifacts)
      .set({
        state: "pending",
        vps_path: existing.output_path!,
        error_kind: "thumbnail_replaced",
        error_message: "Selected thumbnail changed; replace Drive copy",
        updated_at: new Date(),
      })
      .where(
        and(
          eq(storageArtifacts.job_id, existing.subject_id),
          eq(storageArtifacts.kind, "thumbnail"),
        ),
      );
    await tx.update(tutorialJobs).set({ va_review_status: null, va_reviewed_at: null, va_reviewed_by: null }).where(eq(tutorialJobs.id, rootId));
    return NextResponse.json({ thumbnail });
    });
  }
  const thumbnail = await selectThumbnail(db, parsed.data.thumbnailId);
  return NextResponse.json({ thumbnail });
}
