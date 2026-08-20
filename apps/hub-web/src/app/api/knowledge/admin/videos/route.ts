import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  listVideosByChapter,
  createVideo,
  updateVideo,
  deleteVideo,
} from "@/lib/repositories/knowledge-repository";

export const dynamic = "force-dynamic";

const CreateVideoBody = z.object({
  chapter_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  order_index: z.number().int().min(0).optional().default(0),
  /** Absolute local path to the video file on the server. */
  video_key: z.string().min(1),
  duration_seconds: z.number().int().min(0).nullable().optional(),
  thumbnail_key: z.string().nullable().optional(),
  is_published: z.boolean().optional().default(true),
});

const UpdateVideoBody = CreateVideoBody.partial().extend({
  id: z.string().uuid(),
});

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:knowledge")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const chapterId = request.nextUrl.searchParams.get("chapterId");
  if (!chapterId)
    return NextResponse.json({ error: "Missing chapterId" }, { status: 400 });
  const videos = await listVideosByChapter(chapterId);
  return NextResponse.json({ videos });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:knowledge")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid JSON in request body",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }

  const parsed = CreateVideoBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request body format",
        details: parsed.error.issues,
      },
      { status: 400 },
    );
  }
  const video = await createVideo(parsed.data);
  return NextResponse.json({ video }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:knowledge")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid JSON in request body",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }

  const parsed = UpdateVideoBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request body format",
        details: parsed.error.issues,
      },
      { status: 400 },
    );
  }
  const { id, ...patch } = parsed.data;
  const video = await updateVideo(id, patch);
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ video });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:knowledge")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await deleteVideo(id);
  return NextResponse.json({ deleted: true });
}
