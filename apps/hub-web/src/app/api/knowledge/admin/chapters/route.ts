import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  listChaptersByCourse,
  createChapter,
  updateChapter,
  deleteChapter,
} from "@/lib/repositories/knowledge-repository";

export const dynamic = "force-dynamic";

const CreateChapterBody = z.object({
  course_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  order_index: z.number().int().min(0).optional().default(0),
});

const UpdateChapterBody = CreateChapterBody.partial().extend({
  id: z.string().uuid(),
});

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:knowledge")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const courseId = request.nextUrl.searchParams.get("courseId");
  if (!courseId)
    return NextResponse.json({ error: "Missing courseId" }, { status: 400 });
  const chapters = await listChaptersByCourse(courseId);
  return NextResponse.json({ chapters });
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

  const parsed = CreateChapterBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request body format",
        details: parsed.error.issues,
      },
      { status: 400 },
    );
  }
  const chapter = await createChapter(parsed.data);
  return NextResponse.json({ chapter }, { status: 201 });
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

  const parsed = UpdateChapterBody.safeParse(body);
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
  const chapter = await updateChapter(id, patch);
  if (!chapter)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ chapter });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:knowledge")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await deleteChapter(id);
  return NextResponse.json({ deleted: true });
}
