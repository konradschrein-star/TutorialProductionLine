import { NextResponse } from "next/server";
import { and, asc, eq, ilike, isNotNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import { ChannelScheduleSchema, channelLocalDate, scheduleForLocalDay } from "@repo/contracts";
import { db, channels, tutorialJobs, tutorialUploadDispatches, tutorialJobEvents, tutorialSourceRevision } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { verifyPublicationApproval } from "@/lib/tutorial/verify-publication-approval";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const canManage = session.role === "ADMIN";
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length > 200) return NextResponse.json({ error: "Search is limited to 200 characters." }, { status: 400 });
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db.select({ id: tutorialJobs.id, title: tutorialJobs.title, language: tutorialJobs.language, channelName: channels.name, publishAt: tutorialJobs.scheduled_for, uploaded: tutorialJobs.is_uploaded, uploaderStatus: tutorialJobs.uploader_status }).from(tutorialJobs).leftJoin(channels, eq(channels.id, tutorialJobs.channel_id)).where(and(isNotNull(tutorialJobs.scheduled_for), ne(tutorialJobs.status, "CANCELLED"), eq(tutorialJobs.is_uploaded, false), canManage ? undefined : eq(tutorialJobs.created_by, session.userId), query ? or(ilike(tutorialJobs.title, pattern), ilike(channels.name, pattern)) : undefined)).orderBy(asc(tutorialJobs.scheduled_for), asc(tutorialJobs.id)).limit(100);
  return NextResponse.json({ canManage, rows, limit: 100 });
}
export async function POST(request: Request) {
  const session = await getSession();
  if (session?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const parsed = z.object({ jobId: z.string().uuid(), publishAt: z.string().datetime(), reason: z.string().trim().min(5).max(1000) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide tutorial ID, UTC publication time and a reason (at least five characters)." }, { status: 400 });
  const at = new Date(parsed.data.publishAt);
  if (at <= new Date()) return NextResponse.json({ error: "Choose a future publication time." }, { status: 400 });
  return db.transaction(async (tx) => {
    const [initial] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, parsed.data.jobId));
    if (!initial) return NextResponse.json({ error: "Tutorial not found" }, { status: 404 });
    const [source] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, initial.source_job_id ?? initial.id)).for("update");
    const [job] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, initial.id)).for("update");
    if (job && (job.source_job_id ?? job.id) !== source?.id) return NextResponse.json({ error: "Tutorial family changed. Refresh and retry." }, { status: 409 });
    if (!source || !job?.channel_id || source.va_review_status !== "approved") return NextResponse.json({ error: "Complete final review before overriding a slot." }, { status: 409 });
    const [dispatch] = await tx.select({ id: tutorialUploadDispatches.id }).from(tutorialUploadDispatches).where(eq(tutorialUploadDispatches.tutorial_job_id, job.id));
    if (dispatch || job.is_uploaded || job.uploader_job_id || job.uploader_status) return NextResponse.json({ error: "Delivery has already started. Reconcile the external uploader first; no external schedule has been changed." }, { status: 409 });
    try { await verifyPublicationApproval(tx, source, tutorialSourceRevision(source)); if (job.id !== source.id) await verifyPublicationApproval(tx, job, tutorialSourceRevision(source)); }
    catch { return NextResponse.json({ error: "Assets changed after review. Review the current revision first." }, { status: 409 }); }
    const [channel] = await tx.select().from(channels).where(eq(channels.id, job.channel_id)).for("update");
    const config = ChannelScheduleSchema.safeParse((channel?.metadata as Record<string, unknown> | null)?.tutorialSchedule ?? {});
    if (!config.success) return NextResponse.json({ error: "Correct the channel schedule configuration first." }, { status: 409 });
    const existing = await tx.select({ at: tutorialJobs.scheduled_for }).from(tutorialJobs).where(and(eq(tutorialJobs.channel_id, job.channel_id), ne(tutorialJobs.id, job.id), isNotNull(tutorialJobs.scheduled_for)));
    if (existing.some((row) => row.at?.getTime() === at.getTime())) return NextResponse.json({ error: "That channel already has a tutorial reserved at this time." }, { status: 409 });
    const day = channelLocalDate(at, config.data.timezone);
    const dayPlan = scheduleForLocalDay(day, config.data);
    if (!dayPlan.enabled) return NextResponse.json({ error: "That weekday is closed in this channel's upload plan. Enable it or choose another day." }, { status: 409 });
    if (existing.filter((row) => row.at && channelLocalDate(row.at, config.data.timezone) === day).length >= dayPlan.dailyCapacity) return NextResponse.json({ error: "That channel day is at capacity. Change capacity explicitly or choose another day." }, { status: 409 });
    if (job.scheduled_for?.getTime() === at.getTime()) return NextResponse.json({ publishAt: at, idempotent: true, externalScheduleChanged: false });
    await tx.update(tutorialJobs).set({ scheduled_for: at }).where(eq(tutorialJobs.id, job.id));
    await tx.insert(tutorialJobEvents).values({ tutorial_job_id: job.id, event_type: "schedule_overridden", actor_id: session.userId, payload: { previous: job.scheduled_for?.toISOString() ?? null, publishAt: at.toISOString(), reason: parsed.data.reason, channelId: job.channel_id } });
    return NextResponse.json({ publishAt: at, externalScheduleChanged: false });
  });
}
