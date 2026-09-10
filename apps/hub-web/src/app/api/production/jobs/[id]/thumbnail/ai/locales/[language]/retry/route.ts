import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, or, desc } from "drizzle-orm";
import { z } from "zod";
import { withTutorialMedia } from "@repo/storage";
import { englishThumbnailApprovalRevision } from "@repo/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { getHubConfig } from "@/lib/config";
import { db, tutorialJobs, tutorialSettings, thumbnails, tutorialThumbnailFanout, tutorialUploadDispatches } from "@/lib/db";

const input = z.object({ requestId: z.string().uuid() }).strict();
const routeInput = z.object({ id: z.string().uuid(), language: z.string().regex(/^[a-z]{2}$/).refine(value => value !== "en") });
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; language: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:thumbnails")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  const route = routeInput.safeParse(await params);
  if (!parsed.success || !route.success) return NextResponse.json({ error: "A valid locale and retry request ID are required" }, { status: 400 });
  const { id, language } = route.data;
  const privileged = ["ADMIN", "MANAGER"].includes(session.role) || hasPermission(session, "manage:tutorial-settings");
  try {
    return await db.transaction(async tx => {
      const [source] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, id)).limit(1).for("update");
      if (!source || (!privileged && source.created_by !== session.userId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (source.source_job_id || source.language !== "en") return NextResponse.json({ error: "Use the English original" }, { status: 409 });
      const [intent] = await tx.select().from(tutorialThumbnailFanout).where(and(eq(tutorialThumbnailFanout.source_job_id, id), eq(tutorialThumbnailFanout.target_language, language))).orderBy(desc(tutorialThumbnailFanout.created_at)).limit(1).for("update");
      if (!intent) return NextResponse.json({ error: "No recorded localization request" }, { status: 404 });
      const replay = intent.retry_history.find(item => item.requestId === parsed.data.requestId);
      if (replay) return NextResponse.json({ state: intent.state, requestId: parsed.data.requestId, duplicate: true });
      const images = await tx.select().from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, id), eq(thumbnails.language, "en"), eq(thumbnails.is_selected, true)));
      const image = images[0];
      const valid = source.status !== "CANCELLED" && source.va_review_status !== "rework_requested" && source.channel_id && images.length === 1 && image && image.id === intent.source_thumbnail_id && image.status === "completed" && image.output_path === intent.source_path && image.channel_id === source.channel_id && ["acceptable", "strong"].includes(image.review_verdict) && englishThumbnailApprovalRevision({ sourceJobId: id, thumbnailId: image.id, sourcePath: intent.source_path, sha256: intent.source_sha256, size: intent.source_size }, source.channel_id) === intent.approval_revision;
      if (!valid) {
        await tx.update(tutorialThumbnailFanout).set({ state: "superseded", updated_at: new Date() }).where(eq(tutorialThumbnailFanout.id, intent.id));
        return NextResponse.json({ state: "superseded", error: "English approval changed. Approve the current English master." }, { status: 409 });
      }
      if (intent.state !== "failed") return NextResponse.json({ state: intent.state, code: intent.state === "uncertain" ? "ADMIN_RECONCILIATION_REQUIRED" : "NOT_RETRYABLE", error: intent.state === "uncertain" ? "Admin must verify the provider outcome before another generation can be submitted." : "Only a definite failed attempt can be retried." }, { status: 409 });
      const [settings] = await tx.select().from(tutorialSettings).where(eq(tutorialSettings.id, 1)).for("share");
      if (settings?.thumbnail_generation_mode !== "ai") return NextResponse.json({ error: "AI mode is disabled by the Admin" }, { status: 409 });
      const family = await tx.select().from(tutorialJobs).where(or(eq(tutorialJobs.id, id), eq(tutorialJobs.source_job_id, id)));
      const child = family.filter(row => row.source_job_id === id && row.language === language);
      const dispatch = await tx.select({ id: tutorialUploadDispatches.id }).from(tutorialUploadDispatches).where(inArray(tutorialUploadDispatches.tutorial_job_id, family.map(row => row.id))).limit(1);
      if (dispatch.length || family.some(row => row.is_uploaded || row.uploader_status) || child.length !== 1 || child[0]!.channel_id !== intent.target_channel_id || child[0]!.created_by !== source.created_by) return NextResponse.json({ error: "Delivery or language assignment changed; reconcile first" }, { status: 409 });
      return withTutorialMedia(db, { jobId: id, kind: "thumbnail", path: intent.source_path, expectedContent: { sha256: intent.source_sha256, size: intent.source_size } }, { allowedRoots: [getHubConfig().LOCAL_MEDIA_ROOT], maxBytes: 32 * 1024 ** 2, transaction: tx }, async () => {
        const generationRequestId = randomUUID();
        await tx.update(tutorialThumbnailFanout).set({ state: "pending", generation_request_id: generationRequestId, output_thumbnail_id: null, lease_token: null, lease_until: null, last_error: null, updated_at: new Date(), retry_history: [...intent.retry_history, { requestId: parsed.data.requestId, actorId: session.userId, at: new Date().toISOString(), previousState: intent.state, previousError: intent.last_error, generationRequestId }] }).where(eq(tutorialThumbnailFanout.id, intent.id));
        return NextResponse.json({ state: "pending", requestId: parsed.data.requestId });
      });
    });
  } catch { return NextResponse.json({ error: "Retry could not be verified or committed. The saved attempt was preserved." }, { status: 409 }); }
}
