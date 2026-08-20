import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { musicPresets } from "@repo/db";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

const CreatePresetSchema = z.object({
  name: z.string().min(1).max(100),
  music_upload_id: z.string().uuid(),
  original_filename: z.string(),
});

/**
 * GET /api/video-stitch/music-presets
 * List user's music presets
 */
export async function GET(request: NextRequest) {
  // Allow tutorial VAs too — they need preset options on the long-form
  // stitch finish panel. Presets are global read-only here.
  const session = await getSession();
  if (
    !session ||
    (!hasPermission(session, "view:jobs") &&
      !hasPermission(session, "create:tutorial-job"))
  ) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const presets = await db
      .select({
        id: musicPresets.id,
        name: musicPresets.name,
        file_path: musicPresets.file_path,
        original_filename: musicPresets.original_filename,
        created_at: musicPresets.created_at,
      })
      .from(musicPresets)
      .where(eq(musicPresets.user_id, session.userId))
      .orderBy(desc(musicPresets.created_at));

    return NextResponse.json(
      presets.map((p) => ({
        id: p.id,
        name: p.name,
        file_path: p.file_path,
        original_filename: p.original_filename,
        created_at: p.created_at.toISOString(),
      })),
    );
  } catch (err) {
    console.error("Failed to list music presets", err);
    return NextResponse.json(
      { error: "Failed to list presets" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/video-stitch/music-presets
 * Create a new music preset from uploaded music
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:job")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parseResult = CreatePresetSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parseResult.error.errors },
      { status: 400 },
    );
  }

  const data = parseResult.data;

  try {
    const mediaRoot =
      process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";
    const extension = data.original_filename
      .substring(data.original_filename.lastIndexOf("."))
      .toLowerCase();
    const filePath = `${mediaRoot}/stitch-uploads/${data.music_upload_id}/original${extension}`;

    const [preset] = await db
      .insert(musicPresets)
      .values({
        user_id: session.userId,
        name: data.name,
        file_path: filePath,
        original_filename: data.original_filename,
      })
      .returning();

    return NextResponse.json({
      id: preset.id,
      name: preset.name,
      file_path: preset.file_path,
      original_filename: preset.original_filename,
      created_at: preset.created_at.toISOString(),
    });
  } catch (err) {
    console.error("Failed to create music preset", err);
    return NextResponse.json(
      { error: "Failed to create preset" },
      { status: 500 },
    );
  }
}
