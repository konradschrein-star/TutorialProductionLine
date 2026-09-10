import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ChannelScheduleSchema } from "@repo/contracts";
import { db, channels } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (session.role !== "ADMIN") return NextResponse.json({ canManage: false, channels: [] });
  const rows = await db.select({ id: channels.id, name: channels.name, language: channels.language, metadata: channels.metadata }).from(channels).where(eq(channels.accepts_tutorials, true));
  return NextResponse.json({ canManage: true, channels: rows.map((row) => {
    const config = ChannelScheduleSchema.safeParse((row.metadata as Record<string, unknown> | null)?.tutorialSchedule ?? {});
    return { id: row.id, name: row.name, language: row.language, schedule: config.success ? config.data : null, error: config.success ? null : "Saved schedule is invalid. Correct it before new reservations." };
  }) });
}
export async function POST(request: Request) {
  const session = await getSession();
  if (session?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const parsed = z.object({ channelId: z.string().uuid(), schedule: ChannelScheduleSchema }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid schedule", reasons: parsed.error.issues.map((issue) => issue.message) }, { status: 400 });
  return db.transaction(async (tx) => {
    const [channel] = await tx.select().from(channels).where(eq(channels.id, parsed.data.channelId)).for("update");
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    const metadata = (channel.metadata as Record<string, unknown> | null) ?? {};
    await tx.update(channels).set({ metadata: { ...metadata, tutorialSchedule: parsed.data.schedule, tutorialScheduleUpdatedBy: session.userId, tutorialScheduleUpdatedAt: new Date().toISOString() } }).where(eq(channels.id, channel.id));
    return NextResponse.json({ schedule: parsed.data.schedule, existingReservationsChanged: false });
  });
}
