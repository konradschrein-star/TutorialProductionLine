export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, storageArtifacts, thumbnails, tutorialJobs } from "@/lib/db";
import { createThumbnailRecord, updateThumbnailRecord } from "@repo/db";

const MAX_BYTES = 12 * 1024 * 1024;

/** Saves a browser-composed PNG as a first-class thumbnail of one tutorial. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || (!hasPermission(session, "manage:thumbnails") && !hasPermission(session, "edit:settings"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const jobId = String(form?.get("jobId") ?? "");
  const language = String(form?.get("language") ?? "en").slice(0, 64);
  const headline = String(form?.get("headline") ?? "").trim().split(/\s+/).slice(0, 3).join(" ");
  const aspectRatio = form?.get("aspectRatio") === "9:16" ? "9:16" : "16:9";
  if (!(file instanceof File) || !jobId) return NextResponse.json({ error: "file and jobId are required" }, { status: 400 });
  if (!file.type.startsWith("image/") || file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "Expected an image under 12 MB" }, { status: 400 });
  const [job] = await db.select({ id: tutorialJobs.id, channelId: tutorialJobs.channel_id, title: tutorialJobs.title, language: tutorialJobs.language }).from(tutorialJobs).where(eq(tutorialJobs.id, jobId)).limit(1);
  if (!job) return NextResponse.json({ error: "Video not found" }, { status: 404 });

  const dir = join(process.env["THUMBNAIL_MEDIA_DIR"] ?? "/opt/content-forge/media/thumbnails", jobId);
  await mkdir(dir, { recursive: true });
  const outputPath = join(dir, `manual-${randomUUID()}.png`);
  await writeFile(outputPath, Buffer.from(await file.arrayBuffer()));
  const thumbnail = await createThumbnailRecord(db, {
    subject_kind: "tutorial_job",
    subject_id: jobId,
    channel_id: job.channelId,
    archetype_id: null,
    language,
    prompt_mode: "manual",
    prompt_used: "Manual Thumbnail Studio composition",
    reference_paths: {},
    extra_reference_paths: [],
    aspect_ratio: aspectRatio,
    resolution: "1k",
    title: job.title.slice(0, 300),
    headline_text: headline || null,
    headline_source: "operator",
    generation_kind: "edit",
    output_path: outputPath,
    requested_backend: null,
    provider_used: "manual_composer",
    status: "completed",
    is_selected: false,
  });
  // Before localized video jobs exist, all language thumbnails belong to the
  // English source. Selection is therefore per subject + language, not merely
  // per subject. Otherwise approving German would silently unselect English.
  await db.update(thumbnails).set({ is_selected: false }).where(and(
    eq(thumbnails.subject_kind, "tutorial_job"),
    eq(thumbnails.subject_id, jobId),
    eq(thumbnails.language, language),
  ));
  await updateThumbnailRecord(db, thumbnail.id, { is_selected: true });
  // A selected replacement must supersede the thumbnail already in the
  // video's Drive folder. Preserve its Drive id so the scanner can delete the
  // old file before uploading this one.
  const jobLanguage = (job.language ?? "en").toLowerCase() === "english"
    ? "en"
    : (job.language ?? "en").toLowerCase();
  if (jobLanguage === language.toLowerCase()) {
    await db.update(storageArtifacts).set({
      state: "pending",
      vps_path: outputPath,
      error_kind: "thumbnail_replaced",
      error_message: "Selected thumbnail changed; replace Drive copy",
      updated_at: new Date(),
    }).where(and(eq(storageArtifacts.job_id, jobId), eq(storageArtifacts.kind, "thumbnail")));
  }
  const approved = await updateThumbnailRecord(db, thumbnail.id, {
    review_verdict: "acceptable",
    reviewed_at: new Date(),
  });
  return NextResponse.json({ thumbnail: approved });
}
