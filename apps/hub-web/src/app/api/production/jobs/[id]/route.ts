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

const PatchSchema = z
  .object({
    playback_speed: z.number().min(0.1).max(5).optional(),
    // The VA-edited narration. Regenerating the audio afterwards re-voices it.
    script_text: z.string().trim().min(1).optional(),
  })
  .refine((v) => v.playback_speed !== undefined || v.script_text !== undefined, {
    message: "Nothing to update",
  });

/**
 * PATCH /api/production/jobs/[id]
 * Update mutable fields — playback_speed and/or the edited script_text.
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

  const patch: { playback_speed?: string; script_text?: string } = {};
  if (parsed.data.playback_speed !== undefined) {
    patch.playback_speed = String(parsed.data.playback_speed);
  }
  if (parsed.data.script_text !== undefined) {
    patch.script_text = parsed.data.script_text;
  }

  const updated = await updateTutorialJob(db, id, patch);

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
