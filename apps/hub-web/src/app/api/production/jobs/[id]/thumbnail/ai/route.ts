import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { ThumbnailPayloadSchema } from "@repo/contracts";
import { createRedisConnection, createThumbnailQueue } from "@repo/queue";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, thumbnails, tutorialJobs, tutorialSettings, tutorialUploadDispatches, tutorialThumbnailAiBatches, tutorialThumbnailFanout } from "@/lib/db";
import { getV1Runtime } from "@/app/api/_lib/runtime";
import { getTutorialAiProviderReadiness } from "@/lib/tutorial/ai-provider-readiness";
import { withTutorialAsset } from "@/lib/tutorial/media-access";
import { fingerprintStorageSource } from "@repo/storage";
import { readThumbnailQualityReport } from "@/lib/thumbnails/quality-report";
import { unresolvedAdmittedVariants } from "@/lib/thumbnails/ai-attempts";
import { thumbnailBatchProgress, currentThumbnailLocales } from "@/lib/thumbnails/ai-progress";
import { englishThumbnailApprovalRevision } from "@repo/db";

const bodySchema = z.object({ requestId: z.string().uuid(), instructions: z.string().max(2000).default(""), top: z.string().trim().min(1).max(48), bottom: z.string().trim().max(48).default(""), resolution: z.enum(["1k", "2k", "4k"]).default("1k"), parentThumbnailId: z.string().uuid().optional(), retryThumbnailId: z.string().uuid().optional() }).refine(value => !(value.parentThumbnailId && value.retryThumbnailId)).refine(value => `${value.top} ${value.bottom}`.trim().split(/\s+/).length <= 4, "Use no more than four thumbnail words");
async function context(id: string) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:thumbnails")) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const [job] = await db.select().from(tutorialJobs).where(eq(tutorialJobs.id, id));
  if (!job) return { error: NextResponse.json({ error: "Tutorial not found" }, { status: 404 }) };
  if (job.created_by !== session.userId && !["ADMIN", "MANAGER"].includes(session.role) && !hasPermission(session, "manage:tutorial-settings")) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { job, session };
}
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await context((await params).id); if (result.error) return result.error;
  if (!result.job!.language) return NextResponse.json({ error: "Assign a language to this tutorial first." }, { status: 409 });
  const qualityId = _request.nextUrl.searchParams.get("quality");
  if (qualityId) {
    if (!z.string().uuid().safeParse(qualityId).success) return NextResponse.json({ error: "Invalid candidate" }, { status: 400 });
    const [candidate] = await db.select().from(thumbnails).where(and(eq(thumbnails.id, qualityId), eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, result.job!.id), eq(thumbnails.language, result.job!.language)));
    if (!candidate?.output_path) return NextResponse.json({ error: "Candidate unavailable" }, { status: 404 });
    try { return await withTutorialAsset({ jobId: result.job!.id, kind: "thumbnail", path: candidate.output_path }, async path => {
      const fingerprint = await fingerprintStorageSource(path);
      return NextResponse.json({ quality: await readThumbnailQualityReport(path, fingerprint.sha256), approval: "human_required" }, { headers: { "Cache-Control": "no-store" } });
    }); } catch { return NextResponse.json({ quality: null, reason: "Current candidate bytes are unavailable for verification", approval: "human_required" }); }
  }
  const [settings] = await db.select({ mode: tutorialSettings.thumbnail_generation_mode }).from(tutorialSettings).where(eq(tutorialSettings.id, 1));
  const providerReadiness = await getTutorialAiProviderReadiness();
  const master = await db.select({ id: thumbnails.id, verdict: thumbnails.review_verdict, path: thumbnails.output_path, channelId: thumbnails.channel_id }).from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, result.job!.source_job_id ?? result.job!.id), eq(thumbnails.language, "en"), eq(thumbnails.is_selected, true), eq(thumbnails.status, "completed")));
  const englishApproved = master.length === 1 && ["acceptable", "strong"].includes(master[0]!.verdict);
  const source = result.job!.source_job_id ? (await db.select().from(tutorialJobs).where(eq(tutorialJobs.id, result.job!.source_job_id)))[0] : result.job!;
  let approvalRevision: string | null = null;
  if (englishApproved && master[0]?.path && master[0].channelId && source?.channel_id === master[0].channelId) {
    const selected = master[0];
    try { approvalRevision = await withTutorialAsset({ jobId: result.job!.source_job_id ?? result.job!.id, kind: "thumbnail", path: selected.path! }, async path => {
      const fingerprint = await fingerprintStorageSource(path);
      return englishThumbnailApprovalRevision({ sourceJobId: result.job!.source_job_id ?? result.job!.id, thumbnailId: selected.id, sourcePath: selected.path!, sha256: fingerprint.sha256, size: fingerprint.bytes }, selected.channelId!);
    }); } catch { /* Unknown current bytes must not bless historical locale receipts. */ }
  }
  const localeRows = approvalRevision ? await db.select({ sourceThumbnailId: tutorialThumbnailFanout.source_thumbnail_id, approvalRevision: tutorialThumbnailFanout.approval_revision, language: tutorialThumbnailFanout.target_language, state: tutorialThumbnailFanout.state, error: tutorialThumbnailFanout.last_error, outputThumbnailId: tutorialThumbnailFanout.output_thumbnail_id }).from(tutorialThumbnailFanout).where(and(eq(tutorialThumbnailFanout.source_job_id, result.job!.source_job_id ?? result.job!.id), eq(tutorialThumbnailFanout.approval_revision, approvalRevision))).orderBy(desc(tutorialThumbnailFanout.created_at)) : [];
  const localization = currentThumbnailLocales(localeRows, master[0]?.id ?? null, approvalRevision);
  const batches = await db.select({ requestId: tutorialThumbnailAiBatches.request_id, attempted: tutorialThumbnailAiBatches.attempted_variants, payload: tutorialThumbnailAiBatches.payload, createdAt: tutorialThumbnailAiBatches.created_at }).from(tutorialThumbnailAiBatches).where(eq(tutorialThumbnailAiBatches.job_id, result.job!.id)).orderBy(desc(tutorialThumbnailAiBatches.created_at)).limit(10);
  const outputs = batches.length ? await db.select({ requestId: thumbnails.request_group_id, index: thumbnails.variant_index, status: thumbnails.status, path: thumbnails.output_path, updatedAt: thumbnails.updated_at }).from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, result.job!.id), inArray(thumbnails.request_group_id, batches.map(batch => batch.requestId)))) : [];
  const batchProgress = batches.map(batch => thumbnailBatchProgress({ ...batch, count: Number(batch.payload.count) }, outputs));
  const reconciliation = unresolvedAdmittedVariants(batches, outputs);
  const rows = await db.select({ id: thumbnails.id, requestId: thumbnails.request_group_id, status: thumbnails.status, selected: thumbnails.is_selected, verdict: thumbnails.review_verdict, score: thumbnails.review_score, notes: thumbnails.review_notes, provider: thumbnails.provider_used, fallback: thumbnails.fallback_used, resolution: thumbnails.resolution, references: thumbnails.reference_paths, parentId: thumbnails.parent_thumbnail_id, error: thumbnails.error_message, output: thumbnails.output_path }).from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, result.job!.id), eq(thumbnails.language, result.job!.language))).orderBy(desc(thumbnails.created_at)).limit(20);
  const currentRows = result.job!.source_job_id ? rows.filter(row => localization.some(locale => locale.language === result.job!.language && locale.state === "completed" && locale.outputThumbnailId === row.id)) : rows;
  return NextResponse.json({ enabled: settings?.mode === "ai", providerReadiness, englishApproved, localization, localizationIdentityVerified: Boolean(approvalRevision), batchProgress, reconciliation, language: result.job!.language, sourceJobId: result.job!.source_job_id ?? result.job!.id, candidates: currentRows.map(row => ({ id: row.id, requestId: row.requestId, status: row.status, selected: row.selected, approved: ["acceptable", "strong"].includes(row.verdict ?? ""), error: row.error, score: row.score, notes: row.notes, provider: row.provider, fallback: row.fallback, resolution: row.resolution, referenceKinds: Object.entries(row.references ?? {}).filter(([,value]) => Boolean(value)).map(([kind]) => kind), parentId: row.parentId, imageUrl: row.output ? `/api/thumbnails/image/${row.id}` : null })) });
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await context((await params).id); if (result.error) return result.error;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter one or two short headline blocks with no more than four words total." }, { status: 400 });
  const providerReadiness = await getTutorialAiProviderReadiness();
  if (providerReadiness.ready === false) return NextResponse.json({ error: providerReadiness.reason }, { status: 503 });
  try {
    const intent = await db.transaction(async tx => {
      const rootId = result.job!.source_job_id ?? result.job!.id;
      await tx.select({ id: tutorialJobs.id }).from(tutorialJobs).where(eq(tutorialJobs.id, rootId)).for("update");
      const [job] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, result.job!.id));
      if (!job || (job.created_by !== result.session!.userId && !["ADMIN", "MANAGER"].includes(result.session!.role) && !hasPermission(result.session!, "manage:tutorial-settings"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!job?.language || !job.channel_id) return NextResponse.json({ error: "Assign a language and channel before generating thumbnails." }, { status: 409 });
      if (job.source_job_id || job.language.toLowerCase() !== "en") return NextResponse.json({ error: "Choose the English master first. Localized thumbnails must reference its exact approved image." }, { status: 409 });
      const [settings] = await tx.select().from(tutorialSettings).where(eq(tutorialSettings.id, 1)).for("share");
      if (settings?.thumbnail_generation_mode !== "ai") return NextResponse.json({ error: "AI thumbnails are disabled by the Admin. Use the procedural editor or ask the Admin to change thumbnail mode." }, { status: 409 });
      const family = await tx.select({ id: tutorialJobs.id, uploaded: tutorialJobs.is_uploaded, uploaderStatus: tutorialJobs.uploader_status }).from(tutorialJobs).where(or(eq(tutorialJobs.id, rootId), eq(tutorialJobs.source_job_id, rootId)));
      const dispatch = await tx.select({ id: tutorialUploadDispatches.id }).from(tutorialUploadDispatches).where(inArray(tutorialUploadDispatches.tutorial_job_id, family.map(row => row.id))).limit(1);
      if (dispatch.length || family.some(row => row.uploaded || row.uploaderStatus)) return NextResponse.json({ error: "Delivery has started. Reconcile it before creating replacement candidates." }, { status: 409 });
      if (parsed.data.parentThumbnailId) {
        const [parent] = await tx.select().from(thumbnails).where(and(eq(thumbnails.id, parsed.data.parentThumbnailId), eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, job.id), eq(thumbnails.channel_id, job.channel_id), eq(thumbnails.language, job.language)));
        if (!parent || parent.status !== "completed" || !parent.output_path || !parsed.data.instructions.trim()) return NextResponse.json({ error: "Choose a rendered candidate from this tutorial and describe the changes." }, { status: 409 });
      }
      if (parsed.data.retryThumbnailId) {
        const [failed] = await tx.select().from(thumbnails).where(and(eq(thumbnails.id, parsed.data.retryThumbnailId), eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, job.id), eq(thumbnails.channel_id, job.channel_id), eq(thumbnails.language, job.language)));
        if (!failed || failed.status !== "failed") return NextResponse.json({ error: "Only a failed candidate from this tutorial can be explicitly retried." }, { status: 409 });
        return NextResponse.json({ code: "ADMIN_RECONCILIATION_REQUIRED", error: "A failed English thumbnail record does not prove the provider produced no image. An Admin must reconcile its outcome before authorizing another paid attempt." }, { status: 409 });
      }
      const payload = ThumbnailPayloadSchema.parse({ subjectKind: "tutorial_job", subjectId: job.id, channelId: job.channel_id, language: job.language, title: job.title, format: "TUTORIAL_STUDIO", thumbnailTextTop: parsed.data.top, ...(parsed.data.bottom ? { thumbnailTextBottom: parsed.data.bottom } : {}), headlineText: [parsed.data.top, parsed.data.bottom].filter(Boolean).join("\n"), instructions: parsed.data.instructions, promptMode: "programmatic", aspectRatio: "16:9", resolution: parsed.data.resolution, requestGroupId: parsed.data.requestId, manualSelection: true, generationKind: "variant", onFallback: "warn" });
      const requestPayload = { ...payload, ...(providerReadiness.provider === "veoforge" ? { backend: "veoforge" as const, onFallback: "fail" as const } : {}), ...(parsed.data.parentThumbnailId ? { parentThumbnailId: parsed.data.parentThumbnailId, generationKind: "iterate" as const } : {}) };
      const count = parsed.data.parentThumbnailId || parsed.data.retryThumbnailId ? 1 : 5;
      const stored = { payload: requestPayload, count, ...(parsed.data.retryThumbnailId ? { retryThumbnailId: parsed.data.retryThumbnailId } : {}) };
      const digest = createHash("sha256").update(JSON.stringify(stored)).digest("hex");
      const [previous] = await tx.select().from(tutorialThumbnailAiBatches).where(and(eq(tutorialThumbnailAiBatches.job_id, job.id), eq(tutorialThumbnailAiBatches.request_id, parsed.data.requestId)));
      if (previous && previous.payload_digest !== digest) return NextResponse.json({ error: "This request identity already belongs to different instructions or settings. Start a new explicit request." }, { status: 409 });
      if (!previous) await tx.insert(tutorialThumbnailAiBatches).values({ job_id: job.id, request_id: parsed.data.requestId, payload_digest: digest, payload: stored });
      return { jobId: job.id, payload: requestPayload, count };
    });
    if (intent instanceof NextResponse) return intent;
    // The intent is committed before external queue calls; lost ACK retries
    // reuse identical inputs and persisted results even after Redis retention.
      const connection = createRedisConnection({ url: getV1Runtime().redisUrl, mode: "queue" });
      const queue = createThumbnailQueue(connection);
      try {
        let queued = 0;
        const { count } = intent;
        const persisted = await db.select({ index: thumbnails.variant_index }).from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, intent.jobId), eq(thumbnails.request_group_id, parsed.data.requestId)));
        for (let variantIndex = 0; variantIndex < count; variantIndex++) {
          if (persisted.some(row => row.index === variantIndex)) continue;
          const queueId = `tutorial-ai-${intent.jobId}-${parsed.data.requestId}-${variantIndex}`;
          if (!await queue.getJob(queueId)) { await queue.add("thumbnail", { ...intent.payload, variantIndex }, { jobId: queueId, attempts: 1 }); queued++; }
        }
        return NextResponse.json({ queued: true, count, newlyQueued: queued, duplicate: queued === 0, requestId: parsed.data.requestId, selectedImageUnchanged: true }, { status: 202 });
      } finally { await queue.close(); await connection.quit(); }
  } catch { return NextResponse.json({ error: "AI request could not be queued. Your approved thumbnail is unchanged. Retry this request or check provider/queue settings." }, { status: 503 }); }
}
