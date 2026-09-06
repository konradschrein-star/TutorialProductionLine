import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, thumbnails, tutorialJobs } from "@/lib/db";
import {
  THUMBNAIL_PACK_LANGUAGES,
  assessThumbnailPackJob,
} from "@/lib/tutorial/thumbnail-pack";

export const dynamic = "force-dynamic";

const MAX_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_LAYOUT_CHARS = 50_000;

/**
 * Store a browser-composited thumbnail as a first-class selected thumbnail for
 * one completed localized tutorial. The server normalizes every image to a
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
  const [job] = await db
    .select({
      id: tutorialJobs.id,
      createdBy: tutorialJobs.created_by,
      channelId: tutorialJobs.channel_id,
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
  if (!job.sourceJobId || !job.language) {
    return NextResponse.json(
      { error: "The four-language pack only accepts localized child jobs" },
      { status: 409 },
    );
  }
  const jobLanguage = job.language;
  if (!THUMBNAIL_PACK_LANGUAGES.includes(jobLanguage)) {
    return NextResponse.json(
      { error: "Localized job is outside the automatic four-language pack" },
      { status: 409 },
    );
  }

  const assessment = assessThumbnailPackJob({
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
        error: "Localized job is not publication-ready",
        reasons: assessment.reasons,
      },
      { status: 409 },
    );
  }

  const form = await request.formData().catch(() => null);
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
  try {
    JSON.parse(layoutJson);
  } catch {
    return NextResponse.json(
      { error: "Layout document is invalid JSON" },
      { status: 400 },
    );
  }

  const mediaRoot =
    process.env["THUMBNAIL_MEDIA_DIR"] ?? "/opt/content-forge/media/thumbnails";
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
      await transaction
        .update(thumbnails)
        .set({ is_selected: false })
        .where(
          and(
            eq(thumbnails.subject_kind, "tutorial_job"),
            eq(thumbnails.subject_id, job.id),
          ),
        );
      const [record] = await transaction
        .insert(thumbnails)
        .values({
          subject_kind: "tutorial_job",
          subject_id: job.id,
          channel_id: job.channelId,
          language: jobLanguage,
          prompt_mode: "manual",
          prompt_used: layoutJson,
          reference_paths: {},
          aspect_ratio: "16:9",
          resolution: "1280x720",
          title: job.title,
          headline_text: [job.thumbnailTextTop, job.thumbnailTextBottom]
            .filter(Boolean)
            .join(" / "),
          generation_kind: "edit",
          output_path: outputPath,
          requested_backend: "browser-layout",
          provider_used: "browser-layout",
          backend_chain: ["browser-layout"],
          status: "completed",
          is_selected: true,
        })
        .returning();
      if (!record) throw new Error("Could not persist thumbnail record");
      return record;
    });
    return NextResponse.json({
      thumbnailId: selected.id,
      language: jobLanguage,
      selected: selected.is_selected,
    });
  } catch (error) {
    await rm(outputPath, { force: true }).catch(() => undefined);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
