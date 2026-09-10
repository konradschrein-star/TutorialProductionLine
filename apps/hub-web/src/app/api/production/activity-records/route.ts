import { NextResponse } from "next/server";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, tutorialJobs, tutorialJobEvents, channels, users } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { escapeRecordSearch } from "@/lib/tutorial/activity-records";

export const dynamic = "force-dynamic";
const input = z.object({ q: z.string().trim().max(200).default(""), days: z.coerce.number().int().min(1).max(90).default(7), stage: z.string().regex(/^[A-Z_]*$/).max(40).default(""), beforeAt: z.string().datetime().optional(), beforeId: z.string().uuid().optional() });
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success || Boolean(parsed.data?.beforeAt) !== Boolean(parsed.data?.beforeId)) return NextResponse.json({ error: "Invalid search, stage, history window or page cursor" }, { status: 400 });
  const { q, days, stage, beforeAt, beforeId } = parsed.data;
  // Activity ownership is role-scoped, not inferred from a broad settings
  // permission. A VA must never gain team-wide history because a deployment
  // grants that permission for an unrelated settings screen.
  const canSeeTeam = session.role === "ADMIN" || session.role === "MANAGER";
  const scope = canSeeTeam ? undefined : eq(tutorialJobs.created_by, session.userId);
  const search = q ? or(ilike(tutorialJobs.title, escapeRecordSearch(q)), ilike(tutorialJobs.keyword_ref, escapeRecordSearch(q)), ilike(users.name, escapeRecordSearch(q)), ilike(channels.name, escapeRecordSearch(q))) : undefined;
  const fields = {
    id: tutorialJobs.id, sourceId: tutorialJobs.source_job_id, title: tutorialJobs.title, language: tutorialJobs.language, status: tutorialJobs.status,
    producer: users.name, channel: channels.name, duration: tutorialJobs.recording_duration_s, voice: tutorialJobs.tts_voice, provider: tutorialJobs.tts_provider,
    review: tutorialJobs.va_review_status, keyword: tutorialJobs.keyword_ref, createdAt: tutorialJobs.created_at,
    cursorAt: sql<string>`to_char(${tutorialJobs.created_at} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    stageSince: sql<string | null>`(SELECT e.created_at::text FROM tutorial_job_events e WHERE e.tutorial_job_id = ${tutorialJobs.id} AND e.event_type IN ('created', 'stage_changed') ORDER BY e.created_at DESC, e.id DESC LIMIT 1)`,
    thumbnailId: sql<string | null>`(SELECT t.id FROM thumbnails t WHERE t.subject_kind = 'tutorial_job' AND t.subject_id = ${tutorialJobs.id} AND t.is_selected = true AND t.status = 'completed' ORDER BY t.created_at DESC LIMIT 1)`,
    hasVideo: sql<boolean>`${tutorialJobs.final_path} IS NOT NULL`, error: tutorialJobs.error_message,
  };
  const page = await db.select(fields).from(tutorialJobs).leftJoin(users, eq(users.id, tutorialJobs.created_by)).leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
    .where(and(scope, search, isNull(tutorialJobs.source_job_id), sql`${tutorialJobs.created_at} >= now() - ${days} * interval '1 day'`, stage ? sql`${tutorialJobs.status}::text = ${stage}` : undefined,
      beforeAt && beforeId ? sql`(${tutorialJobs.created_at}, ${tutorialJobs.id}) < (${beforeAt}::timestamptz, ${beforeId}::uuid)` : undefined))
    .orderBy(desc(tutorialJobs.created_at), desc(tutorialJobs.id)).limit(51);
  const roots = page.slice(0, 50);
  const locales = roots.length ? await db.select(fields).from(tutorialJobs).leftJoin(users, eq(users.id, tutorialJobs.created_by)).leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
    .where(and(scope, inArray(tutorialJobs.source_job_id, roots.map((row) => row.id)))).orderBy(tutorialJobs.language) : [];
  // Counts are event evidence in the time window, never elapsed-time guesses.
  // They include language variants; repeat completions after rework count again.
  const transitions = await db.select({ stage: sql<string>`${tutorialJobEvents.payload}->>'to'`, count: sql<number>`count(*)::int` }).from(tutorialJobEvents)
    .innerJoin(tutorialJobs, eq(tutorialJobs.id, tutorialJobEvents.tutorial_job_id))
    .where(and(scope, eq(tutorialJobEvents.event_type, "stage_changed"), sql`${tutorialJobEvents.created_at} >= now() - ${days} * interval '1 day'`))
    .groupBy(sql`${tutorialJobEvents.payload}->>'to'`);
  const [rework] = await db.select({ count: sql<number>`count(*)::int` }).from(tutorialJobs).where(and(scope, eq(tutorialJobs.va_review_status, "rework_requested")));
  const last = roots.at(-1);
  return NextResponse.json({
    scope: canSeeTeam ? "All producers" : "Your work", days,
    rows: roots.map((root) => ({ ...root, locales: locales.filter((row) => row.sourceId === root.id) })),
    nextCursor: page.length > 50 && last ? { beforeAt: last.cursorAt, beforeId: last.id } : null,
    transitions, currentlyInRework: rework?.count ?? 0,
    note: "History begins when tracking was enabled. Counts include language variants and repeat transitions. Elapsed stage time includes waiting and automation; it is not VA working time or inactivity. Summary covers your full authorized scope, independent of the record search.",
  });
}
