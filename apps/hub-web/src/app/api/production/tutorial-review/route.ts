import { NextResponse } from "next/server";
import { and, desc, eq, gte, isNotNull, isNull, inArray } from "drizzle-orm";
import { access } from "node:fs/promises";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  db,
  tutorialJobs,
  channels,
  thumbnails,
  storageArtifacts,
} from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * The VA's end-of-day review list.
 *
 * The owner's instruction, verbatim: "At end of day the VA sees all their jobs
 * (this is deliberately motivating — they see how much they produced), and
 * approves or disapproves each."
 *
 * That "deliberately motivating" is a design constraint, not a nicety. The list
 * is what the VA produced TODAY, newest first, with the count front and centre.
 * It is not a work queue and it must never read like one: nothing here is
 * blocking, an unreviewed job stays exactly as it is forever, and the VA can
 * close the tab having pressed nothing without consequence.
 *
 * SCOPE: "THEIR jobs" is load-bearing and was not implemented — the list
 * returned every VA's output to every VA. Four tutorial VAs produce into this
 * table concurrently, so each of them was scrolling three other people's work
 * and the "you finished N videos" count was the team's, not theirs. It now
 * filters to created_by = the caller. ADMIN/MANAGER may pass scope=all for
 * oversight; a VA cannot, whatever they put in the query string.
 *
 * Under /api/production because that prefix is already on the middleware
 * bypass list and every handler beneath it self-authenticates (see the RANKING
 * route's note). Authorises on the tutorial grants, so a TUTORIAL_VA can use it
 * without being handed `create:job` and with it every other format.
 */

/** Default window. "Today" for a VA who works past midnight is still today. */
const DEFAULT_LOOKBACK_HOURS = 18;

async function fileExists(path: string | null): Promise<boolean> {
  if (!path) return false;
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const hoursRaw = Number(url.searchParams.get("hours"));
  const hours =
    Number.isFinite(hoursRaw) && hoursRaw > 0 && hoursRaw <= 24 * 30
      ? hoursRaw
      : DEFAULT_LOOKBACK_HOURS;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const canSeeEveryone =
    session.role === "ADMIN" ||
    session.role === "MANAGER" ||
    hasPermission(session, "manage:tutorial-settings");
  const wantsEveryone = url.searchParams.get("scope") === "all";
  const scopeAll = canSeeEveryone && wantsEveryone;

  const rows = await db
    .select({
      id: tutorialJobs.id,
      title: tutorialJobs.title,
      channelName: channels.name,
      completedAt: tutorialJobs.completed_at,
      finalPath: tutorialJobs.final_path,
      durationS: tutorialJobs.recording_duration_s,
      reviewStatus: tutorialJobs.va_review_status,
      reviewedAt: tutorialJobs.va_reviewed_at,
      qaStatus: tutorialJobs.output_qa_status,
      qaDetail: tutorialJobs.output_qa_detail,
      deliveredToDrive: tutorialJobs.delivered_to_drive,
      description: tutorialJobs.description,
      tags: tutorialJobs.tags,
      createdBy: tutorialJobs.created_by,
    })
    .from(tutorialJobs)
    .leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
    .where(
      and(
        eq(tutorialJobs.status, "COMPLETED"),
        isNotNull(tutorialJobs.completed_at),
        gte(tutorialJobs.completed_at, since),
        // Only the ENGLISH originals the VA actually recorded. Localized
        // children (source_job_id set) reuse the same recorded background and
        // are auto-delivered, so they never need a separate approval — showing
        // them would make the VA re-approve the same video in five languages.
        isNull(tutorialJobs.source_job_id),
        ...(scopeAll ? [] : [eq(tutorialJobs.created_by, session.userId)]),
      ),
    )
    .orderBy(desc(tutorialJobs.completed_at))
    .limit(200);

  const ids = rows.map((r) => r.id);

  const variantRows = ids.length > 0
    ? await db
        .select({
          id: tutorialJobs.id,
          sourceJobId: tutorialJobs.source_job_id,
          language: tutorialJobs.language,
          title: tutorialJobs.title,
        })
        .from(tutorialJobs)
        .where(and(
          isNotNull(tutorialJobs.source_job_id),
          inArray(tutorialJobs.source_job_id, ids),
        ))
    : [];
  const allThumbnailJobIds = [...ids, ...variantRows.map((variant) => variant.id)];

  // Thumbnails are polymorphic (subject_kind + subject_id, no FK), so they
  // cannot be joined — fetched for these jobs and matched in memory. The row id
  // is returned, not just a boolean: the Review tab renders the picture, and
  // /api/production/jobs/[id]/thumbnail/[thumbId] is the one thumbnail route a
  // TUTORIAL_VA can actually read (the /api/thumbnails/* family wants
  // view:settings, which they do not hold).
  const thumbRows =
    allThumbnailJobIds.length > 0
      ? await db
          .select({
            id: thumbnails.id,
            subjectId: thumbnails.subject_id,
            outputPath: thumbnails.output_path,
            isSelected: thumbnails.is_selected,
            createdAt: thumbnails.created_at,
          })
          .from(thumbnails)
          .where(
            and(
              eq(thumbnails.subject_kind, "tutorial_job"),
              eq(thumbnails.status, "completed"),
              inArray(thumbnails.subject_id, allThumbnailJobIds),
            ),
          )
          .orderBy(desc(thumbnails.is_selected), desc(thumbnails.created_at))
      : [];

  // Selected first, then newest — so the first hit per subject is the one that
  // ships.
  const thumbBySubject = new Map<string, string>();
  for (const t of thumbRows) {
    if (t.outputPath && !thumbBySubject.has(t.subjectId)) {
      thumbBySubject.set(t.subjectId, t.id);
    }
  }

  // Drive presence is read from storage_artifacts, never from the
  // delivered_to_drive boolean alone — that flag is hand-written and has a
  // documented history of being set without an upload happening.
  const artRows =
    ids.length > 0
      ? await db
          .select({
            jobId: storageArtifacts.job_id,
            kind: storageArtifacts.kind,
            driveFileId: storageArtifacts.drive_file_id,
          })
          .from(storageArtifacts)
          .where(
            and(
              eq(storageArtifacts.owner_kind, "tutorial_job"),
              inArray(storageArtifacts.job_id, ids),
            ),
          )
      : [];
  const inDrive = new Set(
    artRows
      .filter((a) => a.kind === "final_video" && a.driveFileId)
      .map((a) => a.jobId),
  );

  // Whether the MP4 is still on disk decides whether the player can open it.
  // 1,177 tutorial rows have no file, so "COMPLETED" alone does not mean
  // playable and the UI must say which it is rather than showing a dead player.
  const playable = await Promise.all(rows.map((r) => fileExists(r.finalPath)));

  const jobs = rows.map((r, i) => ({
    id: r.id,
    title: r.title,
    channelName: r.channelName,
    completedAt: r.completedAt?.toISOString() ?? null,
    durationSeconds: r.durationS !== null ? Number(r.durationS) : null,
    reviewStatus: r.reviewStatus,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    qaStatus: r.qaStatus,
    qaSummary:
      r.qaDetail && typeof r.qaDetail === "object"
        ? ((r.qaDetail as { summary?: string }).summary ?? null)
        : null,
    thumbnailId: thumbBySubject.get(r.id) ?? null,
    thumbnailVariants: [
      { id: r.id, language: "en", title: r.title, thumbnailId: thumbBySubject.get(r.id) ?? null },
      ...variantRows
        .filter((variant) => variant.sourceJobId === r.id)
        .map((variant) => ({
          id: variant.id,
          language: variant.language ?? "translated",
          title: variant.title,
          thumbnailId: thumbBySubject.get(variant.id) ?? null,
        })),
    ],
    hasThumbnail: thumbBySubject.has(r.id),
    inDrive: inDrive.has(r.id),
    hasDescription: Boolean(r.description),
    hasTags: Array.isArray(r.tags) && r.tags.length > 0,
    playable: playable[i] ?? false,
    mine: r.createdBy === session.userId,
  }));

  return NextResponse.json({
    hours,
    scope: scopeAll ? "all" : "mine",
    canSeeEveryone,
    producedCount: jobs.length,
    approvedCount: jobs.filter((j) => j.reviewStatus === "approved").length,
    disapprovedCount: jobs.filter((j) => j.reviewStatus === "disapproved")
      .length,
    jobs,
  });
}
