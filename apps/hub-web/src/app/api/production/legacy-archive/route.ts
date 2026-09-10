import { NextResponse } from "next/server";
import { and, asc, eq, gt, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db, tutorialLegacyArchive, channels, users } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { mayProduceOnChannel } from "@/lib/tutorial/channel-access";
import {
  ArchiveRoutingError,
  routeLegacyArchive,
} from "@/lib/tutorial/legacy-archive-routing";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (
    !hasPermission(session, "view:production") &&
    !hasPermission(session, "upload:youtube-video") &&
    session.role !== "ADMIN"
  )
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const query = z
    .object({
      q: z.string().trim().max(200).default(""),
      filter: z.enum(["all", "unrouted"]).default("all"),
      after: z.string().uuid().optional(),
    })
    .strict()
    .safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success)
    return NextResponse.json(
      { error: "Invalid archive search" },
      { status: 400 },
    );
  const admin = session.role === "ADMIN";
  const pattern = `%${query.data.q.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db
    .select({
      id: tutorialLegacyArchive.id,
      sourceSystem: tutorialLegacyArchive.source_system,
      sourceTable: tutorialLegacyArchive.source_table,
      sourceId: tutorialLegacyArchive.source_id,
      sourceParentId: tutorialLegacyArchive.source_parent_id,
      ownerId: tutorialLegacyArchive.owner_user_id,
      title: tutorialLegacyArchive.title,
      language: tutorialLegacyArchive.language,
      status: tutorialLegacyArchive.source_status,
      sourceChannelId: tutorialLegacyArchive.source_channel_id,
      needsRouting: tutorialLegacyArchive.needs_routing,
      assignedChannelId: tutorialLegacyArchive.assigned_channel_id,
      assignedAt: tutorialLegacyArchive.assigned_at,
      runtimeJobId: tutorialLegacyArchive.runtime_job_id,
      archivedAt: tutorialLegacyArchive.created_at,
    })
    .from(tutorialLegacyArchive)
    .where(
      and(
        admin
          ? undefined
          : eq(tutorialLegacyArchive.owner_user_id, session.userId),
        query.data.q
          ? or(
              ilike(tutorialLegacyArchive.title, pattern),
              ilike(tutorialLegacyArchive.source_status, pattern),
            )
          : undefined,
        query.data.filter === "unrouted"
          ? and(
              eq(tutorialLegacyArchive.needs_routing, true),
              isNull(tutorialLegacyArchive.assigned_channel_id),
            )
          : undefined,
        query.data.after
          ? gt(tutorialLegacyArchive.id, query.data.after)
          : undefined,
      ),
    )
    .orderBy(asc(tutorialLegacyArchive.id))
    .limit(51);
  const page = rows.slice(0, 50);
  const [network, producers] = admin
    ? await Promise.all([
        db
          .select()
          .from(channels)
          .where(
            and(
              eq(channels.accepts_tutorials, true),
              eq(channels.is_primary, true),
            ),
          ),
        db.select({ id: users.id, name: users.name, role: users.role, is_active: users.is_active, default_tutorial_channel_id: users.default_tutorial_channel_id }).from(users),
      ])
    : [[], []];
  return NextResponse.json(
    {
      canRoute: admin,
      rows: page.map((row) => {
        const producer = producers.find((user) => user.id === row.ownerId);
        const supported =
          !row.sourceParentId &&
          [
            "QUEUED",
            "GENERATING_SCRIPT",
            "GENERATING_AUDIO",
            "READY_TO_RECORD",
            "AWAITING_UPLOAD",
            "RECORDED",
            "FAILED_SCRIPT",
            "FAILED_AUDIO",
            "FAILED_SPLICE",
            "SPLICING",
          ].includes(row.status);
        return {
          ...row,
          ownerLabel: admin
            ? (producer?.name ?? "Original owner not imported")
            : "Your imported record",
          routingBlocker:
            row.needsRouting && !supported
              ? "Legacy segment/workflow remains archive-only; a separate migration decision is required."
              : null,
          routingState: row.assignedChannelId
            ? "assigned_for_migration_not_resumed"
            : row.needsRouting
              ? "admin_routing_required"
              : "read_only_history",
          channelOptions:
            producer && supported
              ? network
                  .filter((channel) => mayProduceOnChannel(producer, channel))
                  .map((channel) => ({
                    id: channel.id,
                    name: channel.name,
                    language: channel.language,
                  }))
              : [],
        };
      }),
      nextCursor: rows.length > 50 ? page.at(-1)?.id : null,
      countScope: "page",
      rawSourceExposed: false,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const session = await getSession();
  if (session?.role !== "ADMIN")
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  const parsed = z
    .object({
      archiveId: z.string().uuid(),
      channelId: z.string().uuid(),
      reason: z.string().trim().min(5).max(1000),
    })
    .strict()
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      {
        error:
          "An archive record, assigned channel and routing reason are required.",
      },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      await routeLegacyArchive(
        db,
        parsed.data.archiveId,
        parsed.data.channelId,
        session.userId,
        parsed.data.reason,
      ),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof ArchiveRoutingError
            ? error.message
            : "Migration routing unavailable. No job was enqueued.",
      },
      { status: error instanceof ArchiveRoutingError ? error.status : 503 },
    );
  }
}
