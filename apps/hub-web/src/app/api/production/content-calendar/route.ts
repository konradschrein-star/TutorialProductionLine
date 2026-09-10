import { NextResponse } from "next/server";
import { and, asc, eq, gte, isNotNull, lt, ne } from "drizzle-orm";
import { ChannelScheduleSchema } from "@repo/contracts";
import { db, tutorialJobs, channels } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { calendarDays } from "@/lib/tutorial/content-calendar";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const start = new URL(request.url).searchParams.get("start") ?? new Date().toISOString().slice(0,10);
  let days: string[];
  try { days = calendarDays(start); } catch { return NextResponse.json({ error: "Choose a valid calendar date." }, { status: 400 }); }
  const canManage = session.role === "ADMIN";
  // Include UTC margins so every channel-local day is complete, including UTC+14.
  const from = new Date(Date.parse(`${start}T00:00:00Z`) - 86400000);
  const until = new Date(Date.parse(`${start}T00:00:00Z`) + 9 * 86400000);
  const results = await db.select({ id: tutorialJobs.id, title: tutorialJobs.title, language: tutorialJobs.language, channelId: tutorialJobs.channel_id, publishAt: tutorialJobs.scheduled_for, uploaderStatus: tutorialJobs.uploader_status, youtubeVisibility: tutorialJobs.youtube_visibility, isUploaded: tutorialJobs.is_uploaded, uploadVerifiedAt: tutorialJobs.upload_verified_at, youtubePublishedAt: tutorialJobs.youtube_published_at, channelName: channels.name, channelLanguage: channels.language, metadata: channels.metadata }).from(tutorialJobs).leftJoin(channels, eq(channels.id, tutorialJobs.channel_id)).where(and(isNotNull(tutorialJobs.scheduled_for), ne(tutorialJobs.status, "CANCELLED"), gte(tutorialJobs.scheduled_for, from), lt(tutorialJobs.scheduled_for, until), canManage ? undefined : eq(tutorialJobs.created_by, session.userId))).orderBy(asc(tutorialJobs.scheduled_for), asc(tutorialJobs.id)).limit(5001);
  const truncated = results.length > 5000;
  const rows = results.slice(0,5000);
  const channelRows = canManage ? await db.select({ id: channels.id, name: channels.name, language: channels.language, metadata: channels.metadata }).from(channels).where(eq(channels.accepts_tutorials, true)) : rows.filter((row,index,all) => row.channelId && all.findIndex(other => other.channelId === row.channelId) === index).map(row => ({ id: row.channelId!, name: row.channelName ?? "Assigned channel", language: row.channelLanguage ?? row.language, metadata: row.metadata }));
  return NextResponse.json({ days, canManage, scope: canManage ? "installation" : "own", truncated, channels: channelRows.map(channel => {
    const parsed = ChannelScheduleSchema.safeParse((channel.metadata as Record<string,unknown> | null)?.tutorialSchedule ?? {});
    return { id: channel.id, name: channel.name, language: channel.language, schedule: parsed.success ? parsed.data : null };
  }), rows: rows.map(({ metadata, channelName, channelLanguage, ...row }) => row) }, { headers: { "Cache-Control": "no-store" } });
}
