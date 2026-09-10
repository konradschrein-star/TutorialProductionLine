import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, tutorialJobs, tutorialJobEvents } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid tutorial ID" }, { status: 400 });
  const [job] = await db.select({ owner: tutorialJobs.created_by }).from(tutorialJobs).where(eq(tutorialJobs.id, id));
  if (!job) return NextResponse.json({ error: "Tutorial not found" }, { status: 404 });
  if (session.role !== "ADMIN" && job.owner !== session.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = await db.select({ id: tutorialJobEvents.id, type: tutorialJobEvents.event_type, actorId: tutorialJobEvents.actor_id, payload: tutorialJobEvents.payload, createdAt: tutorialJobEvents.created_at }).from(tutorialJobEvents).where(eq(tutorialJobEvents.tutorial_job_id, id)).orderBy(desc(tutorialJobEvents.created_at), desc(tutorialJobEvents.id)).limit(101);
  return NextResponse.json({ events: rows.slice(0, 100), hasMore: rows.length > 100, note: "Recorded since history tracking was enabled. Stage time is not VA working time." });
}
