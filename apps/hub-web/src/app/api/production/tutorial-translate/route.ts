import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, tutorialJobs } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Localization overview: recent COMPLETED English source tutorials and, for each,
 * the status of its per-language translation children (de/fr/es/ja/ko …).
 * Drives the Localize tab. Read-only. (POST enqueue lives in ./enqueue.)
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sources = await db
    .select({
      id: tutorialJobs.id,
      title: tutorialJobs.title,
      language: tutorialJobs.language,
      createdAt: tutorialJobs.completed_at,
    })
    .from(tutorialJobs)
    .where(and(isNull(tutorialJobs.source_job_id), eq(tutorialJobs.status, "COMPLETED")))
    .orderBy(desc(tutorialJobs.completed_at))
    .limit(60);

  const ids = sources.map((s) => s.id);
  const translations = ids.length
    ? await db
        .select({
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

  const bySource = new Map<string, Array<{ language: string | null; status: string }>>();
  for (const t of translations) {
    if (!t.sourceId) continue;
    const arr = bySource.get(t.sourceId) ?? [];
    arr.push({ language: t.language, status: t.status });
    bySource.set(t.sourceId, arr);
  }

  return NextResponse.json({
    sources: sources.map((s) => ({
      id: s.id,
      title: s.title,
      language: s.language,
      createdAt: s.createdAt,
      translations: bySource.get(s.id) ?? [],
    })),
  });
}
