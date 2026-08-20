export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";

/**
 * POST /api/jobs/ranking-upload  (multipart/form-data)
 *
 * Stages create-time media (images / clips) for a RANKING job BEFORE the job
 * exists. The form generates a random `draft_id`; files land under
 *   LOCAL_MEDIA_ROOT/_ranking_drafts/<draft_id>/<file>
 * and the returned `url` (a `file://` absolute path) is stored verbatim in
 * `metadata.ranking.userMedia`. footage-collection later offers the videos as
 * shared B-roll candidates; the studio uses the images as hero options.
 *
 * `previewUrl` (an /api/media key) is only for the form's own thumbnail — it is
 * auth-gated like every media key, so it renders in the operator's session.
 *
 * Fields: draft_id (string, required), media (File[], required).
 */

const MAX_FILES = 20;
const MAX_BYTES = 200 * 1024 * 1024; // 200 MB per file
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".m4v", ".mkv"]);

function safeName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
  return base.length > 0 ? base.slice(-120) : "upload";
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.userId || !hasPermission(session, "create:job")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const mediaRoot = process.env["LOCAL_MEDIA_ROOT"];
  if (!mediaRoot) {
    return NextResponse.json(
      { error: "LOCAL_MEDIA_ROOT not configured" },
      { status: 500 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart form" },
      { status: 400 },
    );
  }

  const draftId = String(formData.get("draft_id") ?? "").trim();
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(draftId)) {
    return NextResponse.json({ error: "invalid draft_id" }, { status: 400 });
  }
  const files = formData
    .getAll("media")
    .filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "no files" }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `max ${MAX_FILES} files` },
      { status: 400 },
    );
  }

  const dir = join(mediaRoot, "_ranking_drafts", draftId);
  await mkdir(dir, { recursive: true });

  const uploaded: Array<{
    url: string;
    previewUrl: string;
    kind: "photo" | "video";
    name: string;
    sizeBytes: number;
  }> = [];

  for (const file of files) {
    const ext = extname(file.name).toLowerCase();
    const isImage = IMAGE_EXT.has(ext);
    const isVideo = VIDEO_EXT.has(ext);
    if (!isImage && !isVideo) {
      return NextResponse.json(
        { error: `unsupported file type: ${file.name}` },
        { status: 400 },
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      return NextResponse.json(
        { error: `${file.name} exceeds 200 MB` },
        { status: 400 },
      );
    }
    // Prefix with an index so two files of the same name don't collide.
    const fname = `${uploaded.length}_${safeName(file.name)}`;
    const abs = join(dir, fname);
    await writeFile(abs, buffer);
    uploaded.push({
      url: `file://${abs}`,
      previewUrl: `/api/media/_ranking_drafts/${draftId}/${fname}`,
      kind: isImage ? "photo" : "video",
      name: file.name,
      sizeBytes: buffer.length,
    });
  }

  return NextResponse.json({ success: true, media: uploaded });
}
