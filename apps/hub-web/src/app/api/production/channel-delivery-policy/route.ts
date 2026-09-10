import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, channels } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { TutorialDeliveryPolicySchema } from "@repo/contracts";
export const dynamic = "force-dynamic";
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ canManage: false, channels: [] });
  const rows = await db.select({ id: channels.id, name: channels.name, language: channels.language, metadata: channels.metadata }).from(channels).where(eq(channels.accepts_tutorials, true));
  return NextResponse.json({ canManage: true, channels: rows.map(row => { const parsed = TutorialDeliveryPolicySchema.safeParse((row.metadata as Record<string, unknown> | null)?.tutorialDelivery ?? {}); return { id: row.id, name: row.name, language: row.language, policy: parsed.success ? parsed.data : null }; }) });
}
export async function POST(request: Request) {
  const session = await getSession();
  if (session?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const parsed = z.object({ channelId: z.string().uuid(), policy: TutorialDeliveryPolicySchema }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Explicit delivery declarations are required.", detail: parsed.error.issues.map(issue => issue.message) }, { status: 400 });
  return db.transaction(async tx => {
    const [channel] = await tx.select().from(channels).where(eq(channels.id, parsed.data.channelId)).for("update");
    if (!channel?.accepts_tutorials) return NextResponse.json({ error: "Tutorial channel not found" }, { status: 404 });
    if (parsed.data.policy.mode === "scheduled_automatic" && !channel.uploader_channel_key) return NextResponse.json({ error: "Set the channel's uploader mapping before enabling automatic delivery." }, { status: 409 });
    await tx.update(channels).set({ metadata: { ...(channel.metadata as Record<string, unknown> ?? {}), tutorialDelivery: parsed.data.policy, tutorialDeliveryUpdatedBy: session.userId, tutorialDeliveryUpdatedAt: new Date().toISOString() } }).where(eq(channels.id, channel.id));
    return NextResponse.json({ success: true, existingExternalSchedulesCancelled: false, message: "Policy saved. New approved requests are recovered automatically. Existing external jobs were not cancelled." });
  });
}
