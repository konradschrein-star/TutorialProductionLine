import { NextResponse } from "next/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { access, stat } from "node:fs/promises";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, tutorialJobs, videoStitchJobs, users } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * "Needs a human" — the tutorial jobs that are stalled and why.
 *
 * WHY THIS EXISTS
 * ---------------
 * The stitch reconciler already diagnoses every one of these conditions
 * correctly, every 10 minutes, and refuses to auto-repair them on purpose
 * (`stitch-reconciler.ts`: "re-stitch or recover, do NOT force-promote").
 * Its diagnosis then goes to `logger.error` and stops there.
 *
 * Measured on production while writing this: six LONG_FORM courses had been
 * emitting `[stitch-reconciler] NEEDS HUMAN` on a ten-minute loop for up to
 * 1,140 hours — 47 days — and no screen anywhere in the product said a word
 * about it. The jobs simply were not in any list a VA or the owner looks at.
 * That is the whole "tutorials sit invisible for weeks" complaint: not a
 * missing diagnosis, a missing SURFACE.
 *
 * So this route re-derives the same verdicts as read-only SQL + a stat() and
 * hands them to the Dashboard. It deliberately mirrors the reconciler rather
 * than inventing its own rules, and it deliberately CHANGES NOTHING — every
 * repair here is a human decision, exactly as the reconciler argues.
 *
 * SCOPE: a VA sees their own stalls; ADMIN/MANAGER see everyone's, because the
 * long-form courses that strand are usually not owned by the person who has to
 * decide what to do about them.
 */

/** Hours before a job waiting on a human gate is worth showing. */
const STALE_HOURS = 24;

type AttentionKind =
  | "DANGLING_STITCH_REF"
  | "ARTIFACT_GONE"
  | "STITCH_FAILED"
  | "AWAITING_HUMAN_RENDER"
  | "AUTO_SEND_FAILED"
  | "INCOMPLETE_RECORDINGS";

interface AttentionRow {
  id: string;
  title: string;
  status: string;
  owner: string | null;
  kind: AttentionKind;
  /** One line a human can act on. No jargon, no job ids. */
  detail: string;
  action: string;
  hoursStuck: number;
  stitchJobId: string | null;
}

async function fileBytes(path: string | null): Promise<number | null> {
  if (!path) return null;
  try {
    await access(path);
    const s = await stat(path);
    return s.size > 0 ? s.size : null;
  } catch {
    return null;
  }
}

function hoursSince(when: Date): number {
  return Math.floor((Date.now() - when.getTime()) / 3_600_000);
}

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const canSeeEveryone =
    session.role === "ADMIN" ||
    session.role === "MANAGER" ||
    hasPermission(session, "manage:tutorial-settings");
  const scopeAll =
    canSeeEveryone && new URL(request.url).searchParams.get("scope") === "all";

  // Only top-level jobs. Child segment rows rest at RECORDED by design — that
  // is documented in stitch-reconciler.ts and unstick-stranded-stitch-parents.ts,
  // and 197 of the 260 RECORDED rows on production belong to parents that are
  // already COMPLETED. Listing them would invent 260 problems out of 11.
  const rows = await db
    .select({
      id: tutorialJobs.id,
      title: tutorialJobs.title,
      status: tutorialJobs.status,
      updatedAt: tutorialJobs.updated_at,
      createdBy: tutorialJobs.created_by,
      stitchJobId: tutorialJobs.stitch_job_id,
      ownerEmail: users.email,
    })
    .from(tutorialJobs)
    .leftJoin(users, eq(users.id, tutorialJobs.created_by))
    .where(
      and(
        isNull(tutorialJobs.parent_job_id),
        inArray(tutorialJobs.status, [
          "READY_TO_STITCH",
          "SENT_TO_STITCHER",
          "AWAITING_RECORDINGS",
        ]),
        ...(scopeAll ? [] : [eq(tutorialJobs.created_by, session.userId)]),
      ),
    )
    .orderBy(asc(tutorialJobs.updated_at))
    .limit(200);

  const stitchIds = rows
    .map((r) => r.stitchJobId)
    .filter((v): v is string => v !== null);

  const stitchRows =
    stitchIds.length > 0
      ? await db
          .select({
            id: videoStitchJobs.id,
            status: videoStitchJobs.status,
            outputVideoPath: videoStitchJobs.output_video_path,
          })
          .from(videoStitchJobs)
          .where(inArray(videoStitchJobs.id, stitchIds))
      : [];
  const stitchById = new Map(stitchRows.map((s) => [s.id, s]));

  // Child progress, for the AWAITING_RECORDINGS lines ("3 of 5 recorded").
  const parentIds = rows
    .filter((r) => r.status === "AWAITING_RECORDINGS")
    .map((r) => r.id);
  const children =
    parentIds.length > 0
      ? await db
          .select({
            parentId: tutorialJobs.parent_job_id,
            status: tutorialJobs.status,
          })
          .from(tutorialJobs)
          .where(inArray(tutorialJobs.parent_job_id, parentIds))
      : [];
  const childTally = new Map<string, { total: number; recorded: number }>();
  for (const c of children) {
    if (!c.parentId) continue;
    const t = childTally.get(c.parentId) ?? { total: 0, recorded: 0 };
    t.total += 1;
    if (c.status === "RECORDED") t.recorded += 1;
    childTally.set(c.parentId, t);
  }

  const out: AttentionRow[] = [];

  for (const row of rows) {
    const hoursStuck = hoursSince(row.updatedAt);
    const base = {
      id: row.id,
      title: row.title,
      status: row.status,
      owner: row.ownerEmail,
      hoursStuck,
      stitchJobId: row.stitchJobId,
    };

    if (row.status === "AWAITING_RECORDINGS") {
      if (hoursStuck < STALE_HOURS) continue;
      const t = childTally.get(row.id);
      out.push({
        ...base,
        kind: "INCOMPLETE_RECORDINGS",
        detail:
          t === undefined
            ? "Waiting on part recordings, but this job has no parts."
            : `${t.recorded} of ${t.total} parts recorded — the rest were never uploaded.`,
        action: "Record and upload the remaining parts, or cancel the job.",
      });
      continue;
    }

    if (row.status === "READY_TO_STITCH") {
      if (hoursStuck < STALE_HOURS) continue;
      // Every part is recorded and the automatic hand-off to the stitcher did
      // not happen. That hand-off is fired inline by the upload request and
      // swallows its own failure (publish-recording.ts), so nothing retries it
      // and nothing recorded why.
      out.push({
        ...base,
        kind: "AUTO_SEND_FAILED",
        detail:
          "All parts are recorded, but the automatic hand-off to the stitcher never completed.",
        action: 'Press "Send to stitcher" on this job in the Studio tab.',
      });
      continue;
    }

    // SENT_TO_STITCHER
    const stitch = row.stitchJobId ? stitchById.get(row.stitchJobId) : undefined;

    if (!stitch) {
      out.push({
        ...base,
        kind: "DANGLING_STITCH_REF",
        detail:
          "This job points at a stitch render that no longer exists, so no video was ever produced.",
        action:
          "Needs a manual repair: clear the stitch link and send it to the stitcher again.",
      });
      continue;
    }

    if (stitch.status === "FAILED") {
      out.push({
        ...base,
        kind: "STITCH_FAILED",
        detail: "The stitch render failed.",
        action:
          "Open it in the Video Stitcher and look at the error before re-rendering.",
      });
      continue;
    }

    if (stitch.status !== "RENDERED" && stitch.status !== "UPLOADED") {
      // DRAFT / PENDING / PROCESSING — the render is a deliberate human gate.
      if (hoursStuck < STALE_HOURS) continue;
      out.push({
        ...base,
        kind: "AWAITING_HUMAN_RENDER",
        detail: `The stitch render is still ${stitch.status.toLowerCase()} — nobody has started it.`,
        action: "Open it in the Video Stitcher and press Render.",
      });
      continue;
    }

    // RENDERED / UPLOADED — the render finished, so the only question left is
    // whether the file survived. `UPLOADED` here is the stitcher's own state
    // and does NOT mean Drive: on production all six stalled courses had no
    // storage_artifacts row at all.
    const bytes = await fileBytes(stitch.outputVideoPath);
    if (bytes === null) {
      out.push({
        ...base,
        kind: "ARTIFACT_GONE",
        detail:
          "The render finished, but the video file is gone from disk and was never delivered to Drive.",
        action:
          "The video is lost. Re-stitch it from the recorded parts, or cancel the job.",
      });
      continue;
    }

    // Rendered, present, and not promoted — the reconciler will pick this up
    // within 10 minutes on its own, so it is not a human problem yet.
  }

  return NextResponse.json({
    scope: scopeAll ? "all" : "mine",
    canSeeEveryone,
    staleHours: STALE_HOURS,
    count: out.length,
    jobs: out,
  });
}
