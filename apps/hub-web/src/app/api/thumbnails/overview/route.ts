export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { resolveChannelHost } from "@repo/db/repositories";
import {
  db,
  contentJobs,
  thumbnails,
  tutorialJobs,
  channels,
  users,
} from "@/lib/db";

/**
 * GET /api/thumbnails/overview?days=30&producer=<userId>&state=all|missing|unselected|failed
 *
 * The cross-assistant thumbnail overview. The owner's question was literally
 * "am I seeing only the thumbnails that I have generated or also the thumbnails
 * from the virtual assistants" — and the honest answer for the existing
 * /api/thumbnails/jobs is "everyone's, the search has never been scoped to a
 * user". Nothing on screen said so, which is why the question was reasonable.
 *
 * This route answers the follow-up ("having an overview for the thumbnails that
 * the virtual assistants generated would be quite nice"): every finished video
 * in a time window, WHO produced it, when, and whether its thumbnail is
 * selected, missing or failed.
 *
 * It is VIDEO-centric rather than thumbnail-centric on purpose. A thumbnail-row
 * listing can only ever show thumbnails that exist, and the single most
 * important row in this report is the video that has NO thumbnail row at all —
 * the blank tile in the owner's screenshot. That row is invisible to any query
 * that starts at the thumbnails table.
 *
 * ADMIN/MANAGER only. `manage:thumbnails` deliberately does NOT open this: a
 * TUTORIAL_VA holds that grant for read+select on their own work, and a
 * cross-assistant productivity report is a management view, not a VA tool.
 */

/** Content-job statuses that mean "the video is rendered and shippable". */
const FINISHED_CONTENT_STATUSES = [
  "AWAITING_UPLOADER",
  "UPLOADING",
  "PUBLISHED",
] as const;

const MAX_ITEMS = 300;
const DEFAULT_DAYS = 30;

type ThumbnailState = "selected" | "generated" | "failed" | "missing";

interface OverviewItem {
  kind: "content_job" | "tutorial_job";
  id: string;
  title: string;
  status: string;
  channelName: string | null;
  producerId: string | null;
  producerName: string | null;
  producerRole: string | null;
  createdAt: string;
  /** Newest thumbnail activity for this video, null when none was attempted. */
  lastThumbnailAt: string | null;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  state: ThumbnailState;
  previewThumbnailId: string | null;
  /** Why the most recent attempt failed. Present only when it did. */
  lastError: string | null;
  /** True when the shipping thumbnail carried the channel's host reference. */
  hasHostReference: boolean;
}

/**
 * Per-channel branding readiness — the pre-flight for the branding contract
 * enforced in the thumbnail engine.
 *
 * A tutorial channel with no host character can no longer produce a thumbnail
 * at all (it is refused, loudly, with a row). This panel is where that is
 * visible BEFORE it costs a render, and it is also where the owner can see
 * which of his characters each channel currently resolves to — an assignment
 * that was made without him and that he may want to change.
 */
interface ChannelBranding {
  channelId: string;
  channelName: string;
  hostCharacterName: string | null;
  hostImageCount: number;
  /** True when this channel carries tutorial videos, i.e. the contract binds. */
  contractApplies: boolean;
  ready: boolean;
}

interface ProducerSummary {
  id: string;
  name: string;
  role: string;
  videos: number;
  selected: number;
  generated: number;
  failed: number;
  missing: number;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "MANAGER")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const daysRaw = Number.parseInt(params.get("days") ?? "", 10);
  const days =
    Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 365
      ? daysRaw
      : DEFAULT_DAYS;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const producerFilter = params.get("producer");
  const stateFilter = params.get("state") ?? "all";

  const items: OverviewItem[] = [];

  // ── Tutorial videos ─────────────────────────────────────────────────────
  // `created_by` is the assistant who made the video, which is exactly the
  // attribution the owner asked for.
  const tutorialRows = await db
    .select({
      id: tutorialJobs.id,
      title: tutorialJobs.title,
      status: tutorialJobs.status,
      createdAt: tutorialJobs.created_at,
      channelName: channels.name,
      producerId: users.id,
      producerName: users.name,
      producerEmail: users.email,
      producerRole: users.role,
    })
    .from(tutorialJobs)
    .leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
    .leftJoin(users, eq(users.id, tutorialJobs.created_by))
    .where(
      and(
        eq(tutorialJobs.status, "COMPLETED"),
        gte(tutorialJobs.created_at, since),
      ),
    )
    .orderBy(desc(tutorialJobs.created_at))
    .limit(MAX_ITEMS);

  for (const r of tutorialRows) {
    items.push({
      kind: "tutorial_job",
      id: r.id,
      title: r.title,
      status: r.status,
      channelName: r.channelName ?? null,
      producerId: r.producerId ?? null,
      producerName: r.producerName ?? r.producerEmail ?? null,
      producerRole: r.producerRole ?? null,
      createdAt: r.createdAt.toISOString(),
      lastThumbnailAt: null,
      totalCount: 0,
      completedCount: 0,
      failedCount: 0,
      state: "missing",
      previewThumbnailId: null,
      lastError: null,
      hasHostReference: false,
    });
  }

  // ── Content jobs ────────────────────────────────────────────────────────
  // content_jobs has no `created_by`; the closest honest attribution is the
  // assigned production VA. It is labelled as such in the UI rather than being
  // presented as "who made this", because it is not the same fact.
  const contentRows = await db
    .select({
      id: contentJobs.id,
      title: contentJobs.title,
      status: contentJobs.status,
      createdAt: contentJobs.created_at,
      channelName: channels.name,
      producerId: users.id,
      producerName: users.name,
      producerEmail: users.email,
      producerRole: users.role,
    })
    .from(contentJobs)
    .leftJoin(channels, eq(channels.id, contentJobs.channel_id))
    .leftJoin(users, eq(users.id, contentJobs.assigned_production_va_id))
    .where(
      and(
        inArray(contentJobs.status, [...FINISHED_CONTENT_STATUSES]),
        gte(contentJobs.created_at, since),
      ),
    )
    .orderBy(desc(contentJobs.created_at))
    .limit(MAX_ITEMS);

  for (const r of contentRows) {
    items.push({
      kind: "content_job",
      id: r.id,
      title: r.title,
      status: r.status,
      channelName: r.channelName ?? null,
      producerId: r.producerId ?? null,
      producerName: r.producerName ?? r.producerEmail ?? null,
      producerRole: r.producerRole ?? null,
      createdAt: r.createdAt.toISOString(),
      lastThumbnailAt: null,
      totalCount: 0,
      completedCount: 0,
      failedCount: 0,
      state: "missing",
      previewThumbnailId: null,
      lastError: null,
      hasHostReference: false,
    });
  }

  // ── Thumbnail state, in two queries rather than one per row ─────────────
  if (items.length > 0) {
    const subjectMatch = or(
      ...items.map((i) =>
        and(
          eq(thumbnails.subject_kind, i.kind),
          eq(thumbnails.subject_id, i.id),
        ),
      ),
    );

    const counts = await db
      .select({
        subjectKind: thumbnails.subject_kind,
        subjectId: thumbnails.subject_id,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${thumbnails.status} = 'completed')::int`,
        failed: sql<number>`count(*) filter (where ${thumbnails.status} = 'failed')::int`,
        selected: sql<number>`count(*) filter (where ${thumbnails.is_selected})::int`,
        lastAt: sql<string>`max(${thumbnails.created_at})`,
      })
      .from(thumbnails)
      .where(subjectMatch)
      .groupBy(thumbnails.subject_kind, thumbnails.subject_id);

    const byKey = new Map(
      counts.map((c) => [`${c.subjectKind}:${c.subjectId}`, c]),
    );

    // Per-subject detail rows, newest first, selected-first among completed.
    // One pass fills both the preview id and the newest error message.
    const rows = await db
      .select({
        id: thumbnails.id,
        subjectKind: thumbnails.subject_kind,
        subjectId: thumbnails.subject_id,
        status: thumbnails.status,
        isSelected: thumbnails.is_selected,
        errorMessage: thumbnails.error_message,
        referencePaths: thumbnails.reference_paths,
        createdAt: thumbnails.created_at,
      })
      .from(thumbnails)
      .where(subjectMatch)
      .orderBy(desc(thumbnails.created_at));

    const previewByKey = new Map<string, { id: string; hasHost: boolean }>();
    const errorByKey = new Map<string, string>();
    for (const row of rows) {
      const key = `${row.subjectKind}:${row.subjectId}`;
      if (row.status === "completed" && !previewByKey.has(key)) {
        previewByKey.set(key, {
          id: row.id,
          hasHost: Boolean(row.referencePaths?.persona),
        });
      }
      if (row.status === "failed" && !errorByKey.has(key) && row.errorMessage) {
        errorByKey.set(key, row.errorMessage);
      }
    }
    // A SELECTED thumbnail outranks "newest completed" as the preview — it is
    // the one that actually ships.
    for (const row of rows) {
      if (!row.isSelected || row.status !== "completed") continue;
      previewByKey.set(`${row.subjectKind}:${row.subjectId}`, {
        id: row.id,
        hasHost: Boolean(row.referencePaths?.persona),
      });
    }

    for (const item of items) {
      const key = `${item.kind}:${item.id}`;
      const c = byKey.get(key);
      const preview = previewByKey.get(key);
      if (c) {
        item.totalCount = c.total;
        item.completedCount = c.completed;
        item.failedCount = c.failed;
        item.lastThumbnailAt = c.lastAt
          ? new Date(c.lastAt).toISOString()
          : null;
        item.state =
          c.selected > 0
            ? "selected"
            : c.completed > 0
              ? "generated"
              : c.failed > 0
                ? "failed"
                : "missing";
      }
      if (preview) {
        item.previewThumbnailId = preview.id;
        item.hasHostReference = preview.hasHost;
      }
      item.lastError = errorByKey.get(key) ?? null;
    }
  }

  // ── Per-producer roll-up, computed BEFORE the row filters ───────────────
  // The summary must describe the whole window, otherwise filtering to
  // "missing" would make every producer look 100% broken.
  const producers = new Map<string, ProducerSummary>();
  for (const item of items) {
    const id = item.producerId ?? "unattributed";
    const existing = producers.get(id) ?? {
      id,
      name: item.producerName ?? "Unattributed",
      role: item.producerRole ?? "—",
      videos: 0,
      selected: 0,
      generated: 0,
      failed: 0,
      missing: 0,
    };
    existing.videos += 1;
    existing[item.state] += 1;
    producers.set(id, existing);
  }

  let visible = items;
  if (producerFilter && producerFilter !== "all") {
    visible = visible.filter(
      (i) => (i.producerId ?? "unattributed") === producerFilter,
    );
  }
  if (stateFilter !== "all") {
    visible = visible.filter((i) =>
      stateFilter === "unselected"
        ? i.state === "generated" ||
          i.state === "failed" ||
          i.state === "missing"
        : i.state === stateFilter,
    );
  }
  visible = [...visible]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, MAX_ITEMS);

  // ── Branding readiness, per channel ─────────────────────────────────────
  // Cheap: a handful of channels, two small queries each, and this is an
  // admin report rather than a hot path.
  const channelRows = await db
    .select({ id: channels.id, name: channels.name })
    .from(channels)
    .orderBy(channels.name);
  const tutorialChannelIds = new Set(
    (
      await db
        .selectDistinct({ channelId: tutorialJobs.channel_id })
        .from(tutorialJobs)
    )
      .map((r) => r.channelId)
      .filter((id): id is string => Boolean(id)),
  );
  const branding: ChannelBranding[] = await Promise.all(
    channelRows.map(async (c) => {
      const host = await resolveChannelHost(db, c.id).catch(() => undefined);
      const contractApplies = tutorialChannelIds.has(c.id);
      return {
        channelId: c.id,
        channelName: c.name,
        hostCharacterName: host?.character.name ?? null,
        hostImageCount: host?.images.length ?? 0,
        contractApplies,
        ready: Boolean(host),
      };
    }),
  );

  return NextResponse.json({
    // Stated explicitly so the UI never has to imply it: this is everyone.
    scope: "all_producers",
    branding,
    days,
    summary: {
      videos: items.length,
      selected: items.filter((i) => i.state === "selected").length,
      generated: items.filter((i) => i.state === "generated").length,
      failed: items.filter((i) => i.state === "failed").length,
      missing: items.filter((i) => i.state === "missing").length,
    },
    producers: [...producers.values()].sort((a, b) => b.videos - a.videos),
    items: visible,
  });
}
