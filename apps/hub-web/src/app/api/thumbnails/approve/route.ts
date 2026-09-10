export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, thumbnails, tutorialJobs } from "@/lib/db";
import { assessTutorialThumbnailSelection } from "@/lib/tutorial/thumbnail-selection";

const Body = z.object({ thumbnailIds: z.array(z.string().uuid()).min(1).max(20) });

/** Marks rendered, video-bound thumbnails ready for the Drive/uploader lane. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || (!hasPermission(session, "manage:thumbnails") && !hasPermission(session, "edit:settings"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Expected thumbnailIds" }, { status: 400 });

  const ids = [...new Set(parsed.data.thumbnailIds)];
  const candidates = await db.select().from(thumbnails).where(inArray(thumbnails.id, ids));
  if (candidates.length !== ids.length) return NextResponse.json({ error: "One or more thumbnails no longer exist." }, { status: 404 });
  const privileged = hasPermission(session, "manage:tutorial-settings") || session.role === "ADMIN" || session.role === "MANAGER";
  if (!privileged && candidates.some((row) => row.subject_kind !== "tutorial_job")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const jobIds = candidates.filter((row) => row.subject_kind === "tutorial_job").map((row) => row.subject_id);
  const owners = jobIds.length ? await db.select({ id: tutorialJobs.id, createdBy: tutorialJobs.created_by }).from(tutorialJobs).where(inArray(tutorialJobs.id, jobIds)) : [];
  if (jobIds.some((id) => !owners.some((owner) => owner.id === id && (privileged || owner.createdBy === session.userId)))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (candidates.some((row) => row.status !== "completed" || !row.output_path)) return NextResponse.json({ error: "Only rendered thumbnails can be approved." }, { status: 409 });
  return db.transaction(async (tx) => {
  // Match the lock used by selection/manual saves. A stale grid must never
  // approve an image that has since been replaced by another operator.
  const boundJobs = jobIds.length ? await tx.select().from(tutorialJobs).where(inArray(tutorialJobs.id, jobIds)) : [];
  const rootIds = [...new Set(boundJobs.map((job) => job.source_job_id ?? job.id))].sort();
  for (const rootId of rootIds) await tx.execute(sql`SELECT id FROM tutorial_jobs WHERE id = ${rootId}::uuid FOR UPDATE`);
  const current = await tx.select().from(thumbnails).where(inArray(thumbnails.id, ids));
  if (current.length !== ids.length || current.some((row) => row.status !== "completed" || !row.output_path)) return NextResponse.json({ error: "Thumbnails changed. Refresh this batch before approving." }, { status: 409 });
  const currentJobs = jobIds.length ? await tx.select().from(tutorialJobs).where(inArray(tutorialJobs.id, jobIds)) : [];
  if (currentJobs.length !== new Set(jobIds).size || currentJobs.some((job) => !privileged && job.created_by !== session.userId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const allAssets = jobIds.length ? await tx.select().from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), inArray(thumbnails.subject_id, jobIds))) : [];
  for (const candidate of current.filter((row) => row.subject_kind === "tutorial_job")) {
    const owner = currentJobs.find((job) => job.id === candidate.subject_id);
    if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const selection = assessTutorialThumbnailSelection({ language: owner.language, channelId: owner.channel_id }, allAssets.filter((row) => row.subject_id === owner.id).map((row) => ({ id: row.id, language: row.language, channelId: row.channel_id, isSelected: row.is_selected, outputPath: row.output_path, status: row.status })));
    if (selection.thumbnail?.id !== candidate.id) return NextResponse.json({ error: "The selected thumbnail changed. Refresh this batch before approving." }, { status: 409 });
  }
  const rows = await tx
    .update(thumbnails)
    .set({ review_verdict: "acceptable", reviewed_at: new Date(), updated_at: new Date() })
    .where(inArray(thumbnails.id, ids))
    .returning({ id: thumbnails.id, subjectId: thumbnails.subject_id });
  return NextResponse.json({ approved: rows });
  });
}
