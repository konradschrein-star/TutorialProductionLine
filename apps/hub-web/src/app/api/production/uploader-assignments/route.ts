import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, channels, users } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
export const dynamic = "force-dynamic";
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ canManage: false });
  const [network, uploaders] = await Promise.all([
    db.select({ id: channels.id, name: channels.name, language: channels.language, metadata: channels.metadata }).from(channels).where(eq(channels.accepts_tutorials, true)),
    db.select({ id: users.id, name: users.name, email: users.email, defaultChannelId: users.default_tutorial_channel_id }).from(users).where(and(eq(users.role, "UPLOADER_VA"), eq(users.is_active, true))),
  ]);
  return NextResponse.json({ canManage: true, uploaders, channels: network.map(channel => { const metadata = channel.metadata as Record<string, unknown> | null; const explicit = metadata && Object.prototype.hasOwnProperty.call(metadata, "tutorialUploaderIds"); return { id: channel.id, name: channel.name, language: channel.language, uploaderIds: explicit ? (Array.isArray(metadata.tutorialUploaderIds) ? metadata.tutorialUploaderIds : []) : uploaders.filter(user => user.defaultChannelId === channel.id).map(user => user.id), explicit: Boolean(explicit) }; }) });
}
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = z.object({ channelId: z.string().uuid(), uploaderIds: z.array(z.string().uuid()).max(200) }).strict().safeParse(await request.json().catch(() => null));
  if (!body.success || new Set(body.data.uploaderIds).size !== body.data.uploaderIds.length) return NextResponse.json({ error: "Select a channel and unique uploader accounts." }, { status: 400 });
  return db.transaction(async tx => {
    const [channel] = await tx.select().from(channels).where(eq(channels.id, body.data.channelId)).for("update");
    if (!channel?.accepts_tutorials) return NextResponse.json({ error: "Tutorial channel not found" }, { status: 404 });
    const valid = body.data.uploaderIds.length ? await tx.select({ id: users.id }).from(users).where(and(inArray(users.id, body.data.uploaderIds), eq(users.role, "UPLOADER_VA"), eq(users.is_active, true))) : [];
    if (valid.length !== body.data.uploaderIds.length) return NextResponse.json({ error: "Only active uploader VA accounts can be assigned." }, { status: 400 });
    await tx.update(channels).set({ metadata: { ...(channel.metadata as Record<string, unknown> ?? {}), tutorialUploaderIds: body.data.uploaderIds } }).where(eq(channels.id, channel.id));
    return NextResponse.json({ success: true });
  });
}
