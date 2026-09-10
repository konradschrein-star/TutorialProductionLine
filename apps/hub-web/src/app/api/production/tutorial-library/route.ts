import { NextResponse } from "next/server";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, tutorialJobs, channels, users } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { escapeRecordSearch } from "@/lib/tutorial/activity-records";
import {
  LIBRARY_STAGES,
  youtubeLibraryLinks,
} from "@/lib/tutorial/tutorial-library";
export const dynamic = "force-dynamic";
const input = z.object({
  q: z.string().trim().max(200).default(""),
  stage: z.union([z.enum(LIBRARY_STAGES), z.literal("")]).default(""),
  channelId: z.string().uuid().optional(),
  producerId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  beforeAt: z.string().datetime().optional(),
  beforeId: z.string().uuid().optional(),
  sort: z.enum(["newest", "oldest"]).default("newest"),
});
const response = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production"))
    return response({ error: "Forbidden" }, 403);
  const parsed = input.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (
    !parsed.success ||
    Boolean(parsed.data.beforeAt) !== Boolean(parsed.data.beforeId)
  )
    return response({ error: "Invalid library filters or cursor" }, 400);
  const {
    q,
    stage,
    channelId,
    producerId,
    parentId,
    beforeAt,
    beforeId,
    sort,
  } = parsed.data;
  const admin = session.role === "ADMIN";
  if (producerId && !admin)
    return response({ error: "Producer filtering requires Admin access" }, 403);
  const scope = admin ? undefined : eq(tutorialJobs.created_by, session.userId);
  const fields = {
    id: tutorialJobs.id,
    sourceId: tutorialJobs.source_job_id,
    title: tutorialJobs.title,
    language: tutorialJobs.language,
    status: tutorialJobs.status,
    producer: users.name,
    producerId: tutorialJobs.created_by,
    channel: channels.name,
    channelId: tutorialJobs.channel_id,
    voice: tutorialJobs.tts_voice,
    provider: sql<string>`coalesce(${tutorialJobs.tts_provider_used},${tutorialJobs.tts_provider})`,
    duration: sql<
      string | null
    >`coalesce(${tutorialJobs.recording_duration_s},${tutorialJobs.audio_duration_s})::text`,
    durationKind: sql<
      string | null
    >`CASE WHEN ${tutorialJobs.recording_duration_s} IS NOT NULL THEN 'recording' WHEN ${tutorialJobs.audio_duration_s} IS NOT NULL THEN 'audio' ELSE NULL END`,
    review: tutorialJobs.va_review_status,
    createdAt: tutorialJobs.created_at,
    cursorAt: sql<string>`to_char(${tutorialJobs.created_at} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    thumbnailId: sql<
      string | null
    >`(SELECT t.id FROM thumbnails t WHERE t.subject_kind='tutorial_job' AND t.subject_id=${tutorialJobs.id} AND t.is_selected=true AND t.status='completed' ORDER BY t.created_at DESC,t.id DESC LIMIT 1)`,
    localeCount: admin
      ? sql<number>`(SELECT count(*)::int FROM tutorial_jobs child WHERE child.source_job_id=${tutorialJobs.id})`
      : sql<number>`(SELECT count(*)::int FROM tutorial_jobs child WHERE child.source_job_id=${tutorialJobs.id} AND child.created_by=${session.userId})`,
    hasVideo: sql<boolean>`${tutorialJobs.final_path} IS NOT NULL`,
    youtubeRaw: tutorialJobs.youtube_upload_url,
    youtubeVerified: sql<boolean>`${tutorialJobs.upload_verified_at} IS NOT NULL`,
  };
  const serialize = (row: any) => {
    const { youtubeRaw, cursorAt, ...safe } = row;
    return { ...safe, canCompose: hasPermission(session, "manage:thumbnails"), ...youtubeLibraryLinks(youtubeRaw) };
  };
  try {
    if (parentId) {
      const [parent] = await db
        .select({ id: tutorialJobs.id })
        .from(tutorialJobs)
        .where(
          and(
            scope,
            eq(tutorialJobs.id, parentId),
            isNull(tutorialJobs.source_job_id),
            isNull(tutorialJobs.parent_job_id),
          ),
        )
        .limit(1);
      if (!parent) return response({ error: "Tutorial not found" }, 404);
      const page = await db
        .select(fields)
        .from(tutorialJobs)
        .leftJoin(users, eq(users.id, tutorialJobs.created_by))
        .leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
        .where(
          and(
            scope,
            eq(tutorialJobs.source_job_id, parentId),
            beforeAt && beforeId
              ? sql`(${tutorialJobs.created_at},${tutorialJobs.id}) > (${beforeAt}::timestamptz,${beforeId}::uuid)`
              : undefined,
          ),
        )
        .orderBy(asc(tutorialJobs.created_at), asc(tutorialJobs.id))
        .limit(26);
      const rows = page.slice(0, 25),
        last = rows.at(-1);
      return response({
        rows: rows.map(serialize),
        nextCursor:
          page.length > 25 && last
            ? { beforeAt: last.cursorAt, beforeId: last.id }
            : null,
      });
    }
    const filter = and(
      scope,
      isNull(tutorialJobs.source_job_id),
      isNull(tutorialJobs.parent_job_id),
      stage ? sql`${tutorialJobs.status}::text=${stage}` : undefined,
      channelId ? eq(tutorialJobs.channel_id, channelId) : undefined,
      producerId ? eq(tutorialJobs.created_by, producerId) : undefined,
      q
        ? or(
            ilike(tutorialJobs.title, escapeRecordSearch(q)),
            ilike(tutorialJobs.keyword_ref, escapeRecordSearch(q)),
            ilike(channels.name, escapeRecordSearch(q)),
            ilike(users.name, escapeRecordSearch(q)),
          )
        : undefined,
    );
    const cursor =
      beforeAt && beforeId
        ? sort === "newest"
          ? sql`(${tutorialJobs.created_at},${tutorialJobs.id}) < (${beforeAt}::timestamptz,${beforeId}::uuid)`
          : sql`(${tutorialJobs.created_at},${tutorialJobs.id}) > (${beforeAt}::timestamptz,${beforeId}::uuid)`
        : undefined;
    const order = sort === "newest" ? desc : asc;
    const page = await db
      .select(fields)
      .from(tutorialJobs)
      .leftJoin(users, eq(users.id, tutorialJobs.created_by))
      .leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
      .where(and(filter, cursor))
      .orderBy(order(tutorialJobs.created_at), order(tutorialJobs.id))
      .limit(26);
    const [total] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tutorialJobs)
      .leftJoin(users, eq(users.id, tutorialJobs.created_by))
      .leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
      .where(filter);
    const channelOptions = await db
      .select({ id: channels.id, name: channels.name })
      .from(tutorialJobs)
      .innerJoin(channels, eq(channels.id, tutorialJobs.channel_id))
      .where(
        and(
          scope,
          isNull(tutorialJobs.source_job_id),
          isNull(tutorialJobs.parent_job_id),
        ),
      )
      .groupBy(channels.id, channels.name)
      .orderBy(asc(channels.name))
      .limit(200);
    const producerOptions = admin
      ? await db
          .select({ id: users.id, name: users.name })
          .from(tutorialJobs)
          .innerJoin(users, eq(users.id, tutorialJobs.created_by))
          .where(
            and(
              isNull(tutorialJobs.source_job_id),
              isNull(tutorialJobs.parent_job_id),
            ),
          )
          .groupBy(users.id, users.name)
          .orderBy(asc(users.name))
          .limit(200)
      : [];
    const rows = page.slice(0, 25),
      last = rows.at(-1);
    return response({
      rows: rows.map(serialize),
      total: total?.count ?? 0,
      scope: admin ? "All producers" : "Your tutorials",
      canFilterProducer: admin,
      channels: channelOptions,
      producers: producerOptions,
      nextCursor:
        page.length > 25 && last
          ? { beforeAt: last.cursorAt, beforeId: last.id }
          : null,
    });
  } catch {
    return response({ error: "Could not load tutorials. Try again." }, 500);
  }
}
