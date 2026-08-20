import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  listAllCourses,
  createCourse,
  updateCourse,
  deleteCourse,
} from "@/lib/repositories/knowledge-repository";

export const dynamic = "force-dynamic";

const CreateCourseBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional().default(""),
  thumbnail_key: z.string().nullable().optional(),
  allowed_roles: z.array(z.string()).optional().default([]),
  is_published: z.boolean().optional().default(false),
});

const UpdateCourseBody = CreateCourseBody.partial().extend({
  id: z.string().uuid(),
});

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:knowledge")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const courses = await listAllCourses();
  return NextResponse.json({ courses });
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

  const parsed = CreateCourseBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request body format",
        details: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const course = await createCourse(parsed.data);
  return NextResponse.json({ course }, { status: 201 });
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

  const parsed = UpdateCourseBody.safeParse(body);
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
  const course = await updateCourse(id, patch);
  if (!course)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ course });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:knowledge")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await deleteCourse(id);
  return NextResponse.json({ deleted: true });
}
