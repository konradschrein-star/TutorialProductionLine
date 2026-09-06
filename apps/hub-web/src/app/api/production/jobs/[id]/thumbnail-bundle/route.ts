export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, thumbnails, tutorialJobs } from "@/lib/db";
import { DEFAULT_STANDARD_LANGUAGES } from "@/lib/tutorial/languages";

const normalizeLanguage = (value: string | null | undefined) => {
  const lower = (value ?? "en").trim().toLowerCase();
  if (lower === "english") return "en";
  return lower;
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (!hasPermission(session, "manage:thumbnails") && !hasPermission(session, "view:production"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const [requested] = await db.select({ id: tutorialJobs.id, sourceJobId: tutorialJobs.source_job_id }).from(tutorialJobs).where(eq(tutorialJobs.id, id)).limit(1);
  if (!requested) return NextResponse.json({ error: "Video not found" }, { status: 404 });
  const rootId = requested.sourceJobId ?? requested.id;
  const existingJobs = await db
    .select({ id: tutorialJobs.id, sourceJobId: tutorialJobs.source_job_id, language: tutorialJobs.language, title: tutorialJobs.title, status: tutorialJobs.status })
    .from(tutorialJobs)
    .where(and(
      or(eq(tutorialJobs.id, rootId), eq(tutorialJobs.source_job_id, rootId)),
      inArray(tutorialJobs.language, ["English", "en", "de", "fr", "it", "nl", "sv"]),
    ));
  const root = existingJobs.find((job) => job.id === rootId) ?? existingJobs[0];
  if (!root) return NextResponse.json({ error: "Source video not found" }, { status: 404 });

  // The thumbnail workflow deliberately precedes localization. Represent every
  // configured launch language even when its TTS/video child does not exist
  // yet. Until that child is rendered, its preview plays the English source;
  // the approved PNG is stored on the source with the target language and is
  // adopted by the child when translation starts.
  const languages = ["en", ...DEFAULT_STANDARD_LANGUAGES];
  const jobs = languages.map((language) => {
    const existing = existingJobs.find(
      (job) => normalizeLanguage(job.language) === language,
    );
    return existing ? { ...existing, virtual: false } : {
      ...root,
      id: rootId,
      sourceJobId: rootId,
      language,
      status: "AWAITING_LOCALIZATION",
      virtual: true,
    };
  });

  const subjectIds = [...new Set(existingJobs.map((job) => job.id))];
  const thumbRows = await db
    .select({ id: thumbnails.id, subjectId: thumbnails.subject_id, language: thumbnails.language, headline: thumbnails.headline_text, selected: thumbnails.is_selected, verdict: thumbnails.review_verdict })
    .from(thumbnails)
    .where(and(eq(thumbnails.subject_kind, "tutorial_job"), or(...subjectIds.map((subjectId) => eq(thumbnails.subject_id, subjectId)))))
    .orderBy(desc(thumbnails.is_selected), desc(thumbnails.created_at));
  const byJobAndLanguage = new Map<string, typeof thumbRows[number]>();
  for (const thumbnail of thumbRows) {
    const key = `${thumbnail.subjectId}:${normalizeLanguage(thumbnail.language)}`;
    if (!byJobAndLanguage.has(key)) byJobAndLanguage.set(key, thumbnail);
  }
  return NextResponse.json({
    rootId,
    requestedId: id,
    variants: jobs
      .map((job) => {
        const language = normalizeLanguage(job.language);
        const thumbnail =
          byJobAndLanguage.get(`${job.id}:${language}`) ??
          byJobAndLanguage.get(`${rootId}:${language}`);
        return {
          ...job,
          language,
          videoUrl: `/api/production/jobs/${job.virtual ? rootId : job.id}/download?inline=1`,
          thumbnailId: thumbnail?.id ?? null,
          headline: thumbnail?.headline ?? null,
          approved: thumbnail?.verdict === "acceptable" || thumbnail?.verdict === "strong",
        };
      }),
  });
}
