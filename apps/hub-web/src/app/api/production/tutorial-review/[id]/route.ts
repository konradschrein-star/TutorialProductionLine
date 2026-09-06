import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, tutorialJobs, storageArtifacts } from "@/lib/db";
import { getHubConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Record the VA's end-of-day verdict on one finished tutorial.
 *
 * The owner's instruction: "Disapprove deletes the video, including from Drive.
 * Approve or no action = it stays."
 *
 * ## What approve does
 *
 * Records the verdict. Nothing else. Approval is not a gate — the video was
 * already delivered — it exists so the VA can see what they cleared. NULL and
 * 'approved' are identical to every other part of the system.
 *
 * ## What disapprove does, and the order it does it in
 *
 * Drive FIRST, then local, then the flag. That order is deliberate: Drive is
 * the copy a VA might publish from, so it is the one that must go. If the Drive
 * delete fails we stop and report, leaving the row untouched — a job marked
 * disapproved whose video is still sitting in Drive is worse than one that
 * failed loudly, because the whole point of the verdict is that the video is
 * gone.
 *
 * The local file is deleted too, but its absence is not an error: retention may
 * already have collected it.
 *
 * ## Why this is the only place anything deletes a finished video
 *
 * A human pressed a button. Nothing in this system deletes a video on a timer
 * or a heuristic — `job-auto-delete.ts` used to, which is why that rule now
 * appears in three files.
 */

const ActionSchema = z.object({
  action: z.enum(["approve", "disapprove"]),
});

function resolveLocal(path: string | null, mediaRoot: string): string | null {
  if (!path) return null;
  return isAbsolute(path) ? path : join(mediaRoot, path);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [job] = await db
    .select({
      id: tutorialJobs.id,
      created_by: tutorialJobs.created_by,
      final_path: tutorialJobs.final_path,
      recording_path: tutorialJobs.recording_path,
    })
    .from(tutorialJobs)
    .where(eq(tutorialJobs.id, id))
    .limit(1);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // A VA reviews THEIR OWN work. This check was missing: the permission gate
  // above only asks "is this a tutorial VA", so any of the four could delete any
  // of the other three's finished videos — out of Drive and off disk — by
  // posting an id. The list never offered them the option, which is exactly why
  // nobody would have found this from the UI.
  const isOwner = job.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";
  if (!isOwner && !isPrivileged) {
    return NextResponse.json(
      { error: "That video was produced by someone else." },
      { status: 403 },
    );
  }

  if (parsed.data.action === "approve") {
    await db
      .update(tutorialJobs)
      .set({
        va_review_status: "approved",
        va_reviewed_at: new Date(),
        va_reviewed_by: session.userId,
      })
      .where(eq(tutorialJobs.id, id));
    return NextResponse.json({ success: true, status: "approved" });
  }

  // ── disapprove ───────────────────────────────────────────────────────────
  const artifacts = await db
    .select({
      id: storageArtifacts.id,
      kind: storageArtifacts.kind,
      driveFileId: storageArtifacts.drive_file_id,
    })
    .from(storageArtifacts)
    .where(
      and(
        eq(storageArtifacts.job_id, id),
        eq(storageArtifacts.owner_kind, "tutorial_job"),
      ),
    );

  const withDriveCopy = artifacts.filter((a) => a.driveFileId);
  const driveDeleted: string[] = [];

  if (withDriveCopy.length > 0) {
    const { ArtifactStore } = await import("@repo/storage");
    const created = await ArtifactStore.createFromDatabase(db);
    if (!created.ok) {
      return NextResponse.json(
        {
          error: `Google Drive is not configured on this server (${created.reason}), so the Drive copy cannot be deleted. Nothing was changed — a job marked disapproved whose video is still in Drive is worse than a loud failure.`,
        },
        { status: 503 },
      );
    }
    for (const a of withDriveCopy) {
      const ok = await created.store.deleteArtifactFromDrive(a.id);
      if (!ok) {
        return NextResponse.json(
          {
            error: `Failed to delete ${a.kind} from Google Drive. Nothing was changed; try again.`,
            deletedSoFar: driveDeleted,
          },
          { status: 502 },
        );
      }
      driveDeleted.push(a.kind);
    }
  }

  // Local files. Absence is fine — retention may already have collected them.
  const mediaRoot = getHubConfig().LOCAL_MEDIA_ROOT;
  for (const p of [job.final_path, job.recording_path]) {
    const local = resolveLocal(p, mediaRoot);
    if (local) await unlink(local).catch(() => undefined);
  }

  await db
    .update(tutorialJobs)
    .set({
      va_review_status: "disapproved",
      va_reviewed_at: new Date(),
      va_reviewed_by: session.userId,
      delivered_to_drive: false,
    })
    .where(eq(tutorialJobs.id, id));

  return NextResponse.json({
    success: true,
    status: "disapproved",
    driveDeleted,
  });
}
