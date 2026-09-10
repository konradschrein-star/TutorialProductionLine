import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

const PreferencesSchema = z.object({
  recordHotkey: z.string().trim().min(1).max(32),
  playbackSpeed: z.number().min(0.5).max(2.5),
});

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [user] = await db.select({
    recordHotkey: users.tutorial_record_hotkey,
    playbackSpeed: users.tutorial_playback_speed,
  }).from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return NextResponse.json({ recordHotkey: user.recordHotkey, playbackSpeed: Number(user.playbackSpeed) || 1 });
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = PreferencesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid recording preferences", details: parsed.error.issues.map(issue => issue.message) }, { status: 400 });
  await db.update(users).set({
    tutorial_record_hotkey: parsed.data.recordHotkey,
    tutorial_playback_speed: String(parsed.data.playbackSpeed),
    updated_at: new Date(),
  }).where(eq(users.id, session.userId));
  return NextResponse.json({ ok: true, ...parsed.data });
}
