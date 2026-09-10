import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { and, eq, inArray, or } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  channels,
  db,
  storageArtifacts,
  thumbnails,
  tutorialJobs,
  tutorialUploadDispatches,
  tutorialThumbnailDrafts,
} from "@/lib/db";
import {
  THUMBNAIL_PACK_LANGUAGES,
  assessThumbnailDraft,
} from "@/lib/tutorial/thumbnail-pack";
import { resolveTutorialThumbnailVariant } from "@/lib/tutorial/thumbnail-context";
import { readThumbnailLayout } from '@/lib/thumbnails/layout-document';
import { validateProceduralHeadlines } from '@/lib/thumbnails/procedural-policy';

export const dynamic = "force-dynamic";

const MAX_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_LAYOUT_CHARS = 50_000;

/**
 * Store a browser-composited thumbnail as a first-class selected thumbnail for
 * one localized tutorial draft. Rendering the video is not a prerequisite.
 * The server normalizes every image to a
 * bounded 1280x720 JPEG before the Drive/uploader handoff can see it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:thumbnails")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const form = await request.formData().catch(() => null);
  const [job] = await db
    .select({
      id: tutorialJobs.id,
      createdBy: tutorialJobs.created_by,
      channelId: tutorialJobs.channel_id,
      channelLanguage: channels.language,
      sourceJobId: tutorialJobs.source_job_id,
      language: tutorialJobs.language,
      title: tutorialJobs.title,
      description: tutorialJobs.description,
      tags: tutorialJobs.tags,
      thumbnailTextTop: tutorialJobs.thumbnail_text_top,
      thumbnailTextBottom: tutorialJobs.thumbnail_text_bottom,
      status: tutorialJobs.status,
      finalPath: tutorialJobs.final_path,
    })
    .from(tutorialJobs)
    .leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
    .where(eq(tutorialJobs.id, id))
    .limit(1);

  if (!job) {
    return NextResponse.json(
      { error: "Tutorial job not found" },
      { status: 404 },
    );
  }
  const privileged =
    session.role === "ADMIN" ||
    session.role === "MANAGER" ||
    hasPermission(session, "manage:tutorial-settings");
  if (job.createdBy !== session.userId && !privileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  for (const [field, key] of [["thumbnailTextTop", "top"], ["thumbnailTextBottom", "bottom"]] as const) {
    const submitted = form?.get(key);
    if (submitted !== null && submitted !== undefined) {
      if (typeof submitted !== "string" || (key === "top" && !submitted.trim()) || submitted.trim().length > 48) {
        return NextResponse.json({ error: "Headline 1 is required; each headline may contain up to 48 characters." }, { status: 400 });
      }
      job[field] = submitted.trim() || null;
    }
  }
  const headlineWordCount = [job.thumbnailTextTop, job.thumbnailTextBottom].filter(Boolean).join(" ").trim().split(/\s+/).filter(Boolean).length;
  if (headlineWordCount < 1 || headlineWordCount > 4) return NextResponse.json({ error: "Use no more than four words across the thumbnail headline." }, { status: 400 });
  let thumbnailContext;
  try {
    thumbnailContext = resolveTutorialThumbnailVariant(job);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Thumbnail variant is not configured safely",
        reasons: [error instanceof Error ? error.message : String(error)],
      },
      { status: 409 },
    );
  }
  const jobLanguage = thumbnailContext.language;
  if (!/^[a-z]{2}(?:-[a-z]{2})?$/.test(jobLanguage)) {
    return NextResponse.json(
      {
        error:
          "Tutorial language is archive-only and outside the active upload network",
      },
      { status: 409 },
    );
  }

  const assessment = assessThumbnailDraft({
    jobId: job.id,
    language: jobLanguage,
    title: job.title,
    description: job.description,
    tags: job.tags,
    thumbnailTextTop: job.thumbnailTextTop,
    thumbnailTextBottom: job.thumbnailTextBottom,
    status: job.status,
    finalPath: job.finalPath,
    thumbnailId: null,
  });
  if (!assessment.ready) {
    return NextResponse.json(
      {
        error: "Localized thumbnail copy is incomplete",
        reasons: assessment.reasons,
      },
      { status: 409 },
    );
  }

  const file = form?.get("file");
  const layout = form?.get("layout");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Expected thumbnail file" },
      { status: 400 },
    );
  }
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    return NextResponse.json(
      { error: "Thumbnail must be PNG, JPEG or WebP" },
      { status: 400 },
    );
  }
  if (file.size === 0 || file.size > MAX_INPUT_BYTES) {
    return NextResponse.json(
      { error: "Thumbnail must be between 1 byte and 12 MB" },
      { status: 400 },
    );
  }

  const layoutJson = typeof layout === "string" ? layout : "{}";
  if (layoutJson.length > MAX_LAYOUT_CHARS) {
    return NextResponse.json(
      { error: "Layout document is too large" },
      { status: 400 },
    );
  }
  let layoutHeadlineLines: string[] = [];
  try {
    const document = JSON.parse(layoutJson);
    const parsedLayout = readThumbnailLayout(layoutJson);
    if (!parsedLayout) return NextResponse.json({ error: "Layout document is incomplete or invalid. Reload the editor and retry." }, { status: 400 });
    const reason = validateProceduralHeadlines(parsedLayout.elements);
    if (reason) return NextResponse.json({error:reason},{status:400});
    layoutHeadlineLines = parsedLayout.elements
      .filter(layer => layer.type === 'TEXT' && layer.text?.trim())
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map(layer => layer.text!.trim());
    const top = layoutHeadlineLines[0] ?? '';
    const bottom = layoutHeadlineLines.slice(1).join(' ');
    if (top !== (job.thumbnailTextTop??'') || bottom !== (job.thumbnailTextBottom??'')) return NextResponse.json({error:'Layout headline and submitted copy differ. Reload the editor and retry.'},{status:400});
    if (document?.aspectRatio && document.aspectRatio !== "16:9") {
      return NextResponse.json({ error: "Tutorial delivery requires a 16:9 layout. Portrait exports would be cropped; switch to 16:9 and review the layout." }, { status: 400 });
    }
  } catch {
    return NextResponse.json(
      { error: "Layout document is invalid JSON" },
      { status: 400 },
    );
  }

  const mediaRoot =
    process.env["THUMBNAIL_MEDIA_DIR"] ?? join(process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media", "thumbnails");
  const dir = join(mediaRoot, job.id);
  await mkdir(dir, { recursive: true });
  const outputPath = join(dir, `manual-layout-${randomUUID()}.jpg`);

  try {
    const input = Buffer.from(await file.arrayBuffer());
    const normalized = await sharp(input)
      .rotate()
      .resize(1280, 720, { fit: "cover", position: "centre" })
      .jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toBuffer();
    if (normalized.length === 0 || normalized.length > 2 * 1024 * 1024) {
      throw new Error(
        "normalized thumbnail exceeds the 2 MB publication limit",
      );
    }
    await writeFile(outputPath, normalized, { flag: "wx" });

    // Record + sibling deselection is one database transaction. Otherwise a
    // failed selection could leave a completed row pointing at a file removed
    // by the catch block below.
    const selected = await db.transaction(async (transaction) => {
      const rootId = job.sourceJobId ?? job.id;
      await transaction.select({ id: tutorialJobs.id }).from(tutorialJobs)
        .where(eq(tutorialJobs.id, rootId)).limit(1).for("update");
      const family = await transaction.select({ id: tutorialJobs.id, uploaded: tutorialJobs.is_uploaded, uploaderStatus: tutorialJobs.uploader_status })
        .from(tutorialJobs).where(or(eq(tutorialJobs.id, rootId), eq(tutorialJobs.source_job_id, rootId)));
      const [dispatch] = await transaction.select({ id: tutorialUploadDispatches.id }).from(tutorialUploadDispatches)
        .where(inArray(tutorialUploadDispatches.tutorial_job_id, family.map((row) => row.id))).limit(1);
      if (dispatch || family.some((row) => row.uploaded || row.uploaderStatus)) {
        throw new Error("Delivery has already started. Reconcile the external upload before replacing approved assets.");
      }
      const expectedBase = form?.get("baseThumbnailId");
      if (typeof expectedBase === "string") {
        const current = await transaction.select({ id: thumbnails.id }).from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, job.id), eq(thumbnails.is_selected, true)));
        if (current.length > 1 || (current[0]?.id ?? "") !== expectedBase) throw new Error("Selected thumbnail changed in another editor. Reload before approving; no approved image was replaced.");
      }
      const expectedDraft = form?.get("draftRevision");
      if (typeof expectedDraft === "string") {
        const revision = Number(expectedDraft);
        const [draft] = await transaction.select().from(tutorialThumbnailDrafts).where(eq(tutorialThumbnailDrafts.tutorial_job_id, job.id));
        if (!Number.isSafeInteger(revision) || revision < 0 || revision !== (draft?.revision ?? 0)) throw new Error("A newer draft was saved elsewhere. Reload before approving.");
      }
      await transaction
        .update(thumbnails)
        .set({ is_selected: false })
        .where(
          and(
            eq(thumbnails.subject_kind, "tutorial_job"),
            eq(thumbnails.subject_id, job.id),
            eq(thumbnails.language, jobLanguage),
          ),
        );
      const [record] = await transaction
        .insert(thumbnails)
        .values({
          subject_kind: "tutorial_job",
          subject_id: job.id,
          channel_id: thumbnailContext.channelId,
          language: jobLanguage,
          prompt_mode: "manual",
          prompt_used: layoutJson,
          reference_paths: {},
          aspect_ratio: "16:9",
          resolution: "1280x720",
          title: job.title,
          headline_text: layoutHeadlineLines.join("\n"),
          headline_source: "operator",
          generation_kind: "edit",
          output_path: outputPath,
          requested_backend: "browser-layout",
          provider_used: "browser-layout",
          backend_chain: ["browser-layout"],
          review_verdict: "acceptable",
          reviewed_at: new Date(),
          status: "completed",
          is_selected: true,
        })
        .returning();
      if (!record) throw new Error("Could not persist thumbnail record");
      // Keep artifact bookkeeping atomic with selection. If this fails the
      // transaction rolls back before the catch removes the new export.
      await transaction
      .update(storageArtifacts)
      .set({
        state: "pending",
        vps_path: outputPath,
        error_kind: "thumbnail_replaced",
        error_message: "Selected thumbnail changed; replace Drive copy",
        updated_at: new Date(),
      })
      .where(
        and(
          eq(storageArtifacts.job_id, job.id),
          eq(storageArtifacts.kind, "thumbnail"),
        ),
      );
      await transaction.update(tutorialJobs).set({
        thumbnail_text_top: job.thumbnailTextTop, thumbnail_text_bottom: job.thumbnailTextBottom,
      }).where(eq(tutorialJobs.id, job.id));
      await transaction.update(tutorialJobs).set({
        va_review_status: null, va_reviewed_at: null, va_reviewed_by: null,
      }).where(eq(tutorialJobs.id, job.sourceJobId ?? job.id));
      await transaction.delete(tutorialThumbnailDrafts).where(eq(tutorialThumbnailDrafts.tutorial_job_id,job.id));
      return record;
    });
    return NextResponse.json({
      thumbnailId: selected.id,
      language: jobLanguage,
      selected: selected.is_selected,
      draftRevision: 0,
    });
  } catch (error) {
    await rm(outputPath, { force: true }).catch(() => undefined);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
