import { eq } from "drizzle-orm";
import { db, users, channels } from "@/lib/db";

export function mayUploadOnChannel(user: { id: string; role: string; is_active: boolean; default_tutorial_channel_id: string | null }, channel: { id: string; accepts_tutorials: boolean; metadata?: unknown }): boolean {
  if (!user.is_active || !channel.accepts_tutorials) return false;
  if (user.role === "ADMIN") return true;
  if (user.role !== "UPLOADER_VA") return false;
  const metadata = channel.metadata as Record<string, unknown> | null;
  if (metadata && Object.prototype.hasOwnProperty.call(metadata, "tutorialUploaderIds")) return Array.isArray(metadata.tutorialUploaderIds) && metadata.tutorialUploaderIds.includes(user.id);
  return channel.id === user.default_tutorial_channel_id;
}
export async function uploaderChannelIds(userId: string): Promise<string[]> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return [];
  return (await db.select().from(channels)).filter(channel => mayUploadOnChannel(user, channel)).map(channel => channel.id);
}
export async function mayAccessDelivery(session: { userId: string; role: string }, job: { created_by: string | null; channel_id: string | null }) {
  if (session.role === "ADMIN" || job.created_by === session.userId) return true;
  return session.role === "UPLOADER_VA" && Boolean(job.channel_id && (await uploaderChannelIds(session.userId)).includes(job.channel_id));
}
