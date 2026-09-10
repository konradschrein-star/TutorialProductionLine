import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, thumbnails, tutorialJobs, tutorialThumbnailDrafts, tutorialUploadDispatches } from "@/lib/db";
import { thumbnailLayoutSchema } from "@/lib/thumbnails/layout-document";

const inputSchema = z.object({ layout: thumbnailLayoutSchema, revision: z.number().int().nonnegative(), baseThumbnailId: z.string().uuid().nullable() });
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:thumbnails")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const text = await request.text();
  if (text.length > 50_000) return NextResponse.json({ error: "Draft is too large. Use uploaded assets instead of embedded image data." }, { status: 400 });
  const parsed = inputSchema.safeParse((() => { try { return JSON.parse(text); } catch { return null; } })());
  if (!parsed.success) return NextResponse.json({ error: "Invalid draft layout or revision" }, { status: 400 });
  if (parsed.data.layout.aspectRatio !== "16:9") return NextResponse.json({ error: "Tutorial thumbnails require 16:9" }, { status: 400 });
  const { id } = await params;
  const [job] = await db.select().from(tutorialJobs).where(eq(tutorialJobs.id, id)).limit(1);
  if (!job) return NextResponse.json({ error: "Tutorial not found" }, { status: 404 });
  const privileged = ["ADMIN", "MANAGER"].includes(session.role) || hasPermission(session, "manage:tutorial-settings");
  if (!privileged && job.created_by !== session.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const saved = await db.transaction(async tx => {
      const rootId = job.source_job_id ?? job.id;
      await tx.select({ id: tutorialJobs.id }).from(tutorialJobs).where(eq(tutorialJobs.id, rootId)).for("update");
      const family = await tx.select({ id: tutorialJobs.id, uploaded: tutorialJobs.is_uploaded, uploaderStatus: tutorialJobs.uploader_status }).from(tutorialJobs).where(or(eq(tutorialJobs.id, rootId), eq(tutorialJobs.source_job_id, rootId)));
      const dispatch = await tx.select({ id: tutorialUploadDispatches.id }).from(tutorialUploadDispatches).where(inArray(tutorialUploadDispatches.tutorial_job_id, family.map(row => row.id))).limit(1);
      if (dispatch.length || family.some(row => row.uploaded || row.uploaderStatus)) throw new Error("Delivery has started. Reconcile it before editing this thumbnail.");
      const selected = await tx.select({ id: thumbnails.id }).from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, id), eq(thumbnails.is_selected, true)));
      if (selected.length > 1 || (selected[0]?.id ?? null) !== parsed.data.baseThumbnailId) throw new Error("The selected thumbnail changed. Reload before saving; your open draft has not overwritten it.");
      const [existing] = await tx.select().from(tutorialThumbnailDrafts).where(eq(tutorialThumbnailDrafts.tutorial_job_id, id));
      if ((existing?.revision ?? 0) !== parsed.data.revision) throw new Error("Another editor saved a newer draft. Reload before saving; no changes were overwritten.");
      const revision = (existing?.revision ?? 0) + 1;
      const value = { layout: parsed.data.layout, revision, base_thumbnail_id: parsed.data.baseThumbnailId, updated_by: session.userId, updated_at: new Date() };
      await tx.insert(tutorialThumbnailDrafts).values({ tutorial_job_id: id, ...value }).onConflictDoUpdate({ target: tutorialThumbnailDrafts.tutorial_job_id, set: value });
      return { revision, savedAt: value.updated_at.toISOString() };
    });
    return NextResponse.json({ ...saved, approved: false, selectedThumbnailUnchanged: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save draft" }, { status: 409 }); }
}
