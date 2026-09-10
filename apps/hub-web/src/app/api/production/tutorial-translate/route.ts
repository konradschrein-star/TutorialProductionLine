import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { channels, db, tutorialJobs } from "@/lib/db";
import { localizationTargets } from "@/lib/tutorial/localization-targets";

export const dynamic = "force-dynamic";

/**
 * Localization overview: recent COMPLETED English source tutorials and, for each,
 * the status of its per-language translation children (de/fr/es/ja/ko …).
 * Drives the Localize tab. Read-only. (POST enqueue lives in ./enqueue.)
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const canSeeEveryone =
    session.role === "ADMIN" ||
    session.role === "MANAGER" ||
    hasPermission(session, "manage:tutorial-settings");
  const params = new URL(request.url).searchParams;
  const scopeAll = canSeeEveryone && params.get("scope") === "all";
  const sourceJobId = params.get("sourceJobId");
  if (
    sourceJobId !== null &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      sourceJobId,
    )
  ) {
    return NextResponse.json(
      { error: "Invalid source tutorial ID" },
      { status: 400 },
    );
  }
  const sources = await db
    .select({
      id: tutorialJobs.id,
      title: tutorialJobs.title,
      language: tutorialJobs.language,
      createdAt: tutorialJobs.completed_at,
      createdBy: tutorialJobs.created_by,
      channelId: tutorialJobs.channel_id,
    })
    .from(tutorialJobs)
    .where(
      and(
        isNull(tutorialJobs.source_job_id),
        eq(tutorialJobs.status, "COMPLETED"),
        sql`lower(trim(${tutorialJobs.language})) in ('en', 'english')`,
        ...(scopeAll ? [] : [eq(tutorialJobs.created_by, session.userId)]),
        ...(sourceJobId ? [eq(tutorialJobs.id, sourceJobId)] : []),
      ),
    )
    .orderBy(desc(tutorialJobs.completed_at))
    .limit(sourceJobId ? 1 : 60);

  const ids = sources.map((s) => s.id);
  const translations = ids.length
    ? await db
        .select({
          id: tutorialJobs.id,
          sourceId: tutorialJobs.source_job_id,
          language: tutorialJobs.language,
          status: tutorialJobs.status,
        })
        .from(tutorialJobs)
        .where(
          and(
            isNotNull(tutorialJobs.source_job_id),
            inArray(tutorialJobs.source_job_id, ids),
          ),
        )
    : [];

  const bySource = new Map<
    string,
    Array<{ id: string; language: string | null; status: string }>
  >();
  const targetChannels = ids.length ? await db.select({ id: channels.id, language: channels.language, isPrimary: channels.is_primary, metadata: channels.metadata }).from(channels).where(eq(channels.accepts_tutorials, true)) : [];
  for (const t of translations) {
    if (!t.sourceId) continue;
    const arr = bySource.get(t.sourceId) ?? [];
    arr.push({ id: t.id, language: t.language, status: t.status });
    bySource.set(t.sourceId, arr);
  }

  return NextResponse.json({
    canSeeEveryone,
    scope: scopeAll ? "all" : "mine",
    sources: sources.map((s) => ({
      id: s.id,
      title: s.title,
      language: s.language,
      createdAt: s.createdAt,
      mine: s.createdBy === session.userId,
      canAct: canSeeEveryone || s.createdBy === session.userId,
      targetLanguages: localizationTargets(s.channelId, targetChannels).map(target => target.language),
      translations: bySource.get(s.id) ?? [],
    })),
  });
}
