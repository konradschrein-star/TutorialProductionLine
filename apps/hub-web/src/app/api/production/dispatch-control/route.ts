import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, systemSettings } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";
export async function GET() {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [settings] = await db.select({ paused: systemSettings.tutorialDispatchPaused }).from(systemSettings).where(eq(systemSettings.id, "singleton"));
  return NextResponse.json({ paused: settings?.paused ?? false, canManage: session.role === "ADMIN" });
}
export async function POST(request: Request) {
  const session = await getSession();
  if (session?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const parsed = z.object({ paused: z.boolean() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Expected paused boolean" }, { status: 400 });
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tutorial-dispatch-admission'))`);
    await tx.insert(systemSettings).values({ id: "singleton", tutorialDispatchPaused: parsed.data.paused, updatedBy: session.userId }).onConflictDoUpdate({ target: systemSettings.id, set: { tutorialDispatchPaused: parsed.data.paused, updatedBy: session.userId, updatedAt: new Date() } });
    return NextResponse.json({ paused: parsed.data.paused, canManage: true, externalCancellation: false });
  });
}
