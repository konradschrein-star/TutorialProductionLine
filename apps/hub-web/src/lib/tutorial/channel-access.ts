import { eq } from "drizzle-orm";
import { db, users, channels } from "@/lib/db";

export type ChannelAccessUser = { id: string; role: string; is_active: boolean; default_tutorial_channel_id: string | null };
export type ProductionChannel = { id: string; accepts_tutorials: boolean; is_primary: boolean; metadata?: unknown };

/** An explicit assignment list supersedes the legacy saved channel, including []. */
export function mayProduceOnChannel(user: ChannelAccessUser, channel: ProductionChannel): boolean {
  if (!user.is_active || !channel.accepts_tutorials || !channel.is_primary) return false;
  if (user.role === "ADMIN") return true;
  if (!["TUTORIAL_VA", "PRODUCTION_VA"].includes(user.role)) return false;
  const metadata = channel.metadata as Record<string, unknown> | null;
  if (metadata && Object.prototype.hasOwnProperty.call(metadata, "tutorialProducerIds")) {
    return Array.isArray(metadata.tutorialProducerIds) && metadata.tutorialProducerIds.includes(user.id);
  }
  return user.default_tutorial_channel_id === channel.id;
}

export async function getProductionChannelAccess(userId: string, channelId: string) {
  const [[user], [channel]] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1),
    db.select().from(channels).where(eq(channels.id, channelId)).limit(1),
  ]);
  return user && channel && mayProduceOnChannel(user, channel) ? channel : null;
}
