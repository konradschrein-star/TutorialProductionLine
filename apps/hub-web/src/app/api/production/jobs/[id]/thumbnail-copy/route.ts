import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { normalizeTutorialLanguage, type TutorialTranslatePayload } from "@repo/contracts";
import { createRedisConnection, createTutorialTranslateQueue } from "@repo/queue";
import { db, tutorialJobs, thumbnails } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

/** Explicit retry of the retained, bounded copy job. Existing operator copy and
 * selected assets are never cleared to make a retry possible. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:thumbnails")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid tutorial id" }, { status: 400 });
  const [requested] = await db.select().from(tutorialJobs).where(eq(tutorialJobs.id, id)).limit(1);
  if (!requested) return NextResponse.json({ error: "Tutorial not found" }, { status: 404 });
  if (requested.created_by !== session.userId && !hasPermission(session, "manage:tutorial-settings")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) return NextResponse.json({ error: "Headline worker is not configured. Enter both headline lines manually." }, { status: 503 });
  const connection = createRedisConnection({ url: redisUrl, mode: "queue" });
  const queue = createTutorialTranslateQueue(connection);
  try {
    return await db.transaction(async (tx) => {
      const [root] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, requested.source_job_id ?? id)).for("update");
      const [draft] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, id));
      if (!root || !draft || root.status === "CANCELLED" || root.va_review_status === "rework_requested") return NextResponse.json({ error: "Restore the original before generating headlines." }, { status: 409 });
      const language = normalizeTutorialLanguage(draft.language);
      if (!language || !["en", "de", "fr", "it", "sv"].includes(language) || (draft.source_job_id && draft.status !== "AWAITING_THUMBNAILS")) return NextResponse.json({ error: "Only an English source or waiting locale draft can generate copy." }, { status: 409 });
      if (draft.thumbnail_text_top?.trim() || draft.thumbnail_text_bottom?.trim()) return NextResponse.json({ error: "Existing headline text is preserved. Complete or edit the two lines manually." }, { status: 409 });
      const selected = await tx.select({ id: thumbnails.id }).from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, id), eq(thumbnails.is_selected, true))).limit(1);
      if (selected.length) return NextResponse.json({ error: "An existing thumbnail is preserved. Edit its headline manually." }, { status: 409 });
      const jobId = `tutorial-thumbnail-copy-${root.id}-${language}`;
      const prior = await queue.getJob(jobId);
      if (prior) {
        const state = await prior.getState();
        if (state === "failed") await prior.retry();
        else if (state !== "completed") return NextResponse.json({ queued: true, duplicate: true }, { status: 202 });
        else return NextResponse.json({ error: "The previous generation completed without usable copy. Enter the two lines manually." }, { status: 409 });
      } else await queue.add("tutorial-thumbnail-copy", { sourceJobId: root.id, targetLanguage: language as TutorialTranslatePayload["targetLanguage"], purpose: "thumbnail-copy" }, { jobId, attempts: 2 });
      return NextResponse.json({ queued: true }, { status: 202 });
    });
  } catch { return NextResponse.json({ error: "Headline queue unavailable. Your work is intact; retry later or enter the two lines manually." }, { status: 503 }); }
  finally { await queue.close().catch(() => undefined); await connection.quit().catch(() => undefined); }
}
