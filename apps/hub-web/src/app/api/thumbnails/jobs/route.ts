export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  db,
  contentJobs,
  thumbnails,
  tutorialJobs,
  channels,
  users,
} from "@/lib/db";

/**
 * GET /api/thumbnails/jobs?q=<title fragment>&kind=all|content_job|tutorial_job
 *
 * Title search over FINISHED videos, for the uploader's Thumbnails tab.
 *
 * The uploader VA does not browse the pipeline — they are handed a finished
 * video and a title, and their job is to publish it with a good thumbnail. So
 * the entry point is the title, not a job id, and the result set is restricted
 * to jobs whose video actually exists: content jobs at AWAITING_UPLOADER /
 * UPLOADING / PUBLISHED, and tutorial jobs at COMPLETED.
 *
 * Each row carries its thumbnail counts so the list can show "3 thumbnails, 1
 * selected" (or, loudly, "0 thumbnails") before anything is clicked.
 *
 * SCOPE: this search has never been filtered by who created the video — it
 * returns EVERY finished video, from every producer. That was not visible
 * anywhere, which is why the owner had to ask whether he was seeing only his
 * own. Each hit now carries its producer so the answer is on the screen instead
 * of in this comment, and the response states the scope explicitly.
 */

/** Content-job statuses that mean "the video is rendered and shippable". */
const FINISHED_CONTENT_STATUSES = [
  "AWAITING_UPLOADER",
  "UPLOADING",
  "PUBLISHED",
] as const;

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 300;

interface JobHit {
  kind: "content_job" | "tutorial_job";
  id: string;
  title: string;
  status: string;
  format: string;
  channelId: string | null;
  channelName: string | null;
  createdAt: string;
  /**
   * Who produced the video. For a tutorial job that is `created_by` — the
   * assistant who made it. A content job has no creator column, so it is the
   * assigned production VA, which is a different fact and is labelled as such.
   */
  producerName: string | null;
  producerRole: string | null;
  thumbnailCount: number;
  completedCount: number;
  hasSelected: boolean;
  /**
   * The thumbnail this video would ship with — selected if there is one, else
   * the newest completed. NULL when nothing has rendered.
   *
   * The list used to return only counts, so the Thumbnails tab was a wall of
   * titles and badges: you had to click a row to find out whether its picture
   * was any good, which is the entire question the tab exists to answer. The id
   * is enough for the client to fetch the image.
   */
  previewThumbnailId: string | null;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (
    !session ||
    (!hasPermission(session, "manage:thumbnails") &&
      !hasPermission(session, "view:settings"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const kind = req.nextUrl.searchParams.get("kind") ?? "all";
  const pattern = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  // Pagination: the tab used to hard-cap at 25 with no way to see the rest, so a
  // line with 100+ finished videos could never reach the older ones. The client
  // grows `limit` on "Load more"; we fetch one extra row per source as an
  // overflow sentinel to tell the client whether another page exists.
  const requested = Math.min(
    Math.max(
      parseInt(req.nextUrl.searchParams.get("limit") ?? "", 10) ||
        DEFAULT_LIMIT,
      1,
    ),
    MAX_LIMIT,
  );
  const fetchN = requested + 1;
  let contentOverflow = false;
  let tutorialOverflow = false;

  const hits: JobHit[] = [];

  if (kind === "all" || kind === "content_job") {
    const filters = [
      inArray(contentJobs.status, [...FINISHED_CONTENT_STATUSES]),
    ];
    if (q) filters.push(ilike(contentJobs.title, pattern));
    const rows = await db
      .select({
        id: contentJobs.id,
        title: contentJobs.title,
        status: contentJobs.status,
        format: contentJobs.format,
        channelId: contentJobs.channel_id,
        channelName: channels.name,
        createdAt: contentJobs.created_at,
        producerName: users.name,
        producerEmail: users.email,
        producerRole: users.role,
      })
      .from(contentJobs)
      .leftJoin(channels, eq(channels.id, contentJobs.channel_id))
      .leftJoin(users, eq(users.id, contentJobs.assigned_production_va_id))
      .where(and(...filters))
      .orderBy(desc(contentJobs.created_at))
      .limit(fetchN);
    contentOverflow = rows.length > requested;
    for (const r of rows) {
      hits.push({
        kind: "content_job",
        id: r.id,
        title: r.title,
        status: r.status,
        format: r.format,
        channelId: r.channelId ?? null,
        channelName: r.channelName ?? null,
        createdAt: r.createdAt.toISOString(),
        producerName: r.producerName ?? r.producerEmail ?? null,
        producerRole: r.producerRole ?? null,
        thumbnailCount: 0,
        completedCount: 0,
        hasSelected: false,
        previewThumbnailId: null,
      });
    }
  }

  if (kind === "all" || kind === "tutorial_job") {
    const filters = [eq(tutorialJobs.status, "COMPLETED")];
    if (q) filters.push(ilike(tutorialJobs.title, pattern));
    const rows = await db
      .select({
        id: tutorialJobs.id,
        title: tutorialJobs.title,
        status: tutorialJobs.status,
        channelId: tutorialJobs.channel_id,
        channelName: channels.name,
        createdAt: tutorialJobs.created_at,
        producerName: users.name,
        producerEmail: users.email,
        producerRole: users.role,
      })
      .from(tutorialJobs)
      .leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
      .leftJoin(users, eq(users.id, tutorialJobs.created_by))
      .where(and(...filters))
      .orderBy(desc(tutorialJobs.created_at))
      .limit(fetchN);
    tutorialOverflow = rows.length > requested;
    for (const r of rows) {
      hits.push({
        kind: "tutorial_job",
        id: r.id,
        title: r.title,
        status: r.status,
        format: "TUTORIAL_STUDIO",
        channelId: r.channelId ?? null,
        channelName: r.channelName ?? null,
        createdAt: r.createdAt.toISOString(),
        producerName: r.producerName ?? r.producerEmail ?? null,
        producerRole: r.producerRole ?? null,
        thumbnailCount: 0,
        completedCount: 0,
        hasSelected: false,
        previewThumbnailId: null,
      });
    }
  }

  // Thumbnail counts in ONE query. A hit with 0 completed thumbnails is the
  // interesting case (that is what 57 consecutive failures looked like), so
  // the count is always shown rather than hidden behind a click.
  if (hits.length > 0) {
    const counts = await db
      .select({
        subjectKind: thumbnails.subject_kind,
        subjectId: thumbnails.subject_id,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${thumbnails.status} = 'completed')::int`,
        selected: sql<number>`count(*) filter (where ${thumbnails.is_selected})::int`,
      })
      .from(thumbnails)
      .where(
        or(
          ...hits.map((h) =>
            and(
              eq(thumbnails.subject_kind, h.kind),
              eq(thumbnails.subject_id, h.id),
            ),
          ),
        ),
      )
      .groupBy(thumbnails.subject_kind, thumbnails.subject_id);
    const byKey = new Map(
      counts.map((c) => [`${c.subjectKind}:${c.subjectId}`, c]),
    );
    for (const hit of hits) {
      const c = byKey.get(`${hit.kind}:${hit.id}`);
      if (!c) continue;
      hit.thumbnailCount = c.total;
      hit.completedCount = c.completed;
      hit.hasSelected = c.selected > 0;
    }

    // The picture to show per row. Ordered selected-first then newest, so the
    // first row seen per subject is the one that would ship.
    const previews = await db
      .select({
        id: thumbnails.id,
        subjectKind: thumbnails.subject_kind,
        subjectId: thumbnails.subject_id,
      })
      .from(thumbnails)
      .where(
        and(
          eq(thumbnails.status, "completed"),
          or(
            ...hits.map((h) =>
              and(
                eq(thumbnails.subject_kind, h.kind),
                eq(thumbnails.subject_id, h.id),
              ),
            ),
          ),
        ),
      )
      .orderBy(desc(thumbnails.is_selected), desc(thumbnails.created_at));
    const previewByKey = new Map<string, string>();
    for (const p of previews) {
      const key = `${p.subjectKind}:${p.subjectId}`;
      if (!previewByKey.has(key)) previewByKey.set(key, p.id);
    }
    for (const hit of hits) {
      hit.previewThumbnailId =
        previewByKey.get(`${hit.kind}:${hit.id}`) ?? null;
    }
  }

  hits.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const hasMore = contentOverflow || tutorialOverflow || hits.length > requested;
  return NextResponse.json({
    // Stated, not implied. Consumers render this rather than guessing.
    scope: "all_producers",
    jobs: hits.slice(0, requested),
    hasMore,
  });
}
