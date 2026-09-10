import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, channels, users } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { mayProduceOnChannel } from "@/lib/tutorial/channel-access";
export const dynamic = "force-dynamic";
export async function GET() {
  const session = await getSession();
  if (session?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const [destinations, producers] = await Promise.all([
    db.select().from(channels).where(eq(channels.accepts_tutorials, true)),
    db.select({ id: users.id, name: users.name, role: users.role, is_active: users.is_active, default_tutorial_channel_id: users.default_tutorial_channel_id }).from(users).where(inArray(users.role, ["TUTORIAL_VA", "PRODUCTION_VA"])),
  ]);
  return NextResponse.json({ producers, channels: destinations.filter((channel) => channel.is_primary).map((channel) => ({ id: channel.id, name: channel.name, producerIds: producers.filter((user) => mayProduceOnChannel(user, channel)).map((user) => user.id) })) });
}
export async function POST(request: Request) {
  const session = await getSession();
  if (session?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const parsed = z.object({ channelId: z.string().uuid(), producerIds: z.array(z.string().uuid()).max(500) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid assignments" }, { status: 400 });
  const ids = [...new Set(parsed.data.producerIds)];
  return db.transaction(async (tx) => {
    const [channel] = await tx.select().from(channels).where(eq(channels.id, parsed.data.channelId)).for("update");
    if (!channel?.accepts_tutorials || !channel.is_primary) return NextResponse.json({ error: "Choose an enabled primary tutorial channel" }, { status: 400 });
    const found = ids.length ? await tx.select().from(users).where(inArray(users.id, ids)) : [];
    if (found.length !== ids.length || found.some((user) => !user.is_active || !["TUTORIAL_VA", "PRODUCTION_VA"].includes(user.role))) return NextResponse.json({ error: "Assignments must identify active producers" }, { status: 400 });
    const metadata = (channel.metadata as Record<string, unknown> | null) ?? {};
    await tx.update(channels).set({ metadata: { ...metadata, tutorialProducerIds: ids, tutorialAssignmentsUpdatedBy: session.userId, tutorialAssignmentsUpdatedAt: new Date().toISOString() } }).where(eq(channels.id, channel.id));
    return NextResponse.json({ producerIds: ids, existingJobsChanged: false });
  });
}
