import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getTutorialJobById, updateTutorialJob } from "@repo/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/production/jobs/[id]
 * Get a single tutorial job (owner or admin/manager only).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = await getTutorialJobById(db, id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = job.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";

  if (!isOwner && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ job });
}

const PatchSchema = z.object({
  playback_speed: z.number().min(0.1).max(5),
});

/**
 * PATCH /api/production/jobs/[id]
 * Update mutable fields — currently only playback_speed.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = await getTutorialJobById(db, id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = job.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";

  if (!isOwner && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = PatchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const updated = await updateTutorialJob(db, id, {
    playback_speed: String(parsed.data.playback_speed),
  });

  return NextResponse.json({ job: updated });
}

/**
 * DELETE /api/production/jobs/[id]
 * Delete a tutorial job (owner or admin/manager only). SIX_MIN_STITCH child
 * jobs cascade via the parent_job_id FK.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = await getTutorialJobById(db, id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = job.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";

  if (!isOwner && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.execute(sql`DELETE FROM tutorial_jobs WHERE id = ${id}`);

  return NextResponse.json({ ok: true });
}
