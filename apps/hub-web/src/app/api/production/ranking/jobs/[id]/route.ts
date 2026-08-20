import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, contentJobs, storageArtifacts } from "@/lib/db";
import { getHubConfig } from "@/lib/config";
import { extractRanking } from "@/lib/ranking-blocks";
import {
  resolveRankingVideo,
  toAbsolute,
  UUID_RE,
} from "../../_lib/ranking-artifacts";
import type { JWTPayload } from "@/lib/auth/jwt";

export const dynamic = "force-dynamic";

/**
 * One RANKING job: everything the detail page needs (GET), and the axe (DELETE).
 *
 * Format-locked like its retry sibling: holding `create:tutorial-job` must
 * never become a way to read or destroy another format's jobs.
 */

type JobRow = typeof contentJobs.$inferSelect;

/**
 * Who may act on a ranking.
 *
 * `content_jobs` has NO `created_by` column, so authorship lives where the
 * create route put it: `metadata.ranking.created_by`. Rows predating that (and
 * jobs made outside this lane) have no author at all — those are treated as
 * unowned and left to privileged users, rather than defaulting to "anyone can
 * delete it".
 *
 * The check matters for the same reason it did in tutorial-review: the
 * permission gate only asks "is this a tutorial VA", so without it any of the
 * four could axe any of the others' work by posting an id, from an option the
 * UI never showed them.
 */
function authorship(
  job: JobRow,
  session: JWTPayload,
): { owner: string | null; allowed: boolean; privileged: boolean } {
  const ranking = extractRanking(job.metadata);
  const raw = (ranking as { created_by?: unknown } | null)?.created_by;
  const owner = typeof raw === "string" && raw ? raw : null;
  const privileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";
  return { owner, allowed: privileged || owner === session.userId, privileged };
}

async function loadRanking(
  id: string,
): Promise<{ ok: true; job: JobRow } | { ok: false; response: NextResponse }> {
  if (!UUID_RE.test(id)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid job ID" }, { status: 400 }),
    };
  }
  const [job] = await db
    .select()
    .from(contentJobs)
    .where(eq(contentJobs.id, id))
    .limit(1);
  if (!job) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }
  if (job.format !== "RANKING") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "This endpoint only serves RANKING jobs." },
        { status: 400 },
      ),
    };
  }
  return { ok: true, job };
}

/**
 * GET /api/production/ranking/jobs/[id]
 *
 * The whole state of one ranking, resolved against reality rather than
 * inferred from `status`: the video is confirmed on disk, the Drive links are
 * read out of `storage_artifacts`, and when the video has not been delivered
 * the answer says why in terms of what is actually missing.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const loaded = await loadRanking(id);
  if (!loaded.ok) return loaded.response;
  const { job } = loaded;

  const mediaRoot = getHubConfig().LOCAL_MEDIA_ROOT;
  const ranking = extractRanking(job.metadata);
  const video = await resolveRankingVideo(
    {
      id: job.id,
      channel_id: job.channel_id,
      final_video_path: job.final_video_path ?? null,
      r2_asset_manifest: job.r2_asset_manifest,
    },
    mediaRoot,
  );

  // Drive state comes from the real rows. A URL is never constructed from an
  // id or a folder convention — if `drive_web_link` is empty there is no link
  // to give, and the page says so.
  const artifacts = await db
    .select({
      kind: storageArtifacts.kind,
      state: storageArtifacts.state,
      driveFileId: storageArtifacts.drive_file_id,
      driveWebLink: storageArtifacts.drive_web_link,
      driveFolderPath: storageArtifacts.drive_folder_path,
      bytes: storageArtifacts.bytes,
      uploadedAt: storageArtifacts.uploaded_at,
      errorMessage: storageArtifacts.error_message,
    })
    .from(storageArtifacts)
    .where(
      and(
        eq(storageArtifacts.job_id, job.id),
        eq(storageArtifacts.owner_kind, "content_job"),
      ),
    );

  const finalVideoArtifact =
    artifacts.find((a) => a.kind === "final_video") ?? null;
  const deliveredToDrive =
    finalVideoArtifact?.state === "uploaded" &&
    !!finalVideoArtifact.driveFileId;

  // Why the video is not in Drive. Each branch is a condition that was
  // actually tested above, not a category guess.
  const blockers: string[] = [];
  if (!deliveredToDrive) {
    if (finalVideoArtifact) {
      blockers.push(
        `Drive upload is ${finalVideoArtifact.state}` +
          (finalVideoArtifact.errorMessage
            ? `: ${finalVideoArtifact.errorMessage}`
            : "."),
      );
    } else if (video.path && video.source === "render_convention") {
      // The verified prod case.
      blockers.push(
        "The render finished and the file is on disk, but the RANKING workflow " +
          "never recorded it: content_jobs.final_video_path is empty and there " +
          "is no video/final-render entry in r2_asset_manifest. The Drive " +
          "delivery scanner finds videos only through that manifest, so it " +
          "skips this job and no upload is ever attempted. Play or download it " +
          "here in the meantime.",
      );
    } else if (!video.path) {
      blockers.push(
        "No rendered file exists in any of the locations a ranking render " +
          "writes to (checked: " +
          video.checked.map((c) => `${c.source} → ${c.path}`).join("; ") +
          ").",
      );
    } else {
      blockers.push(
        "The video is on disk but has no storage_artifacts row, so Drive " +
          "delivery has not been attempted yet.",
      );
    }
  }

  const { owner, allowed } = authorship(job, session);

  return NextResponse.json({
    id: job.id,
    topic: ranking?.topic ?? job.title ?? "",
    title: job.title,
    status: job.status,
    format: job.format,
    channelId: job.channel_id,
    jobMode: ranking?.jobMode ?? "asset_quality_loop",
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    renderCompletedAt: job.render_completed_at,
    durationSeconds: job.final_video_duration_seconds,
    errorMessage: job.error_message ?? null,
    errorDetail: job.error_detail ?? null,
    retryCount:
      ((job.metadata as Record<string, unknown> | null)?.[
        "retry_count"
      ] as number) ?? 0,

    // Item names, so a VA can repair one the TTS cannot say without a
    // developer and psql. This used to ride along on every row of the list;
    // it belongs here, next to the Retry button it is meant to precede.
    items: (ranking?.items ?? []).map((it) => ({
      id: it.id,
      name: it.name,
      pronunciation: it.pronunciation ?? null,
      anchored: typeof it.narrationStartMs === "number",
      approved: it.vaApproved ?? false,
      skipped: it.vaSkipped ?? false,
    })),

    video: {
      available: video.path !== null,
      source: video.source,
      sizeBytes: video.sizeBytes,
      checked: video.checked.map((c) => ({
        source: c.source,
        path: c.path,
        exists: c.exists,
      })),
      streamUrl: video.path
        ? `/api/production/ranking/jobs/${job.id}/video?inline=1`
        : null,
      downloadUrl: video.path
        ? `/api/production/ranking/jobs/${job.id}/video`
        : null,
    },

    drive: {
      deliveredToDrive,
      folderPath:
        artifacts.find((a) => a.driveFolderPath)?.driveFolderPath ?? null,
      artifacts: artifacts.map((a) => ({
        kind: a.kind,
        state: a.state,
        driveFileId: a.driveFileId,
        // Only ever the stored link. No URL is assembled from an id here.
        driveWebLink: a.driveWebLink,
        bytes: a.bytes,
        uploadedAt: a.uploadedAt,
        errorMessage: a.errorMessage,
      })),
    },

    blockers,
    ownedBy: owner,
    canRetry:
      job.status.startsWith("FAILED_") && job.status !== "FAILED_IRRECOVERABLE",
    canDelete: job.status.startsWith("FAILED_") && allowed,
    canPickBRoll: job.status === "AWAITING_VA_REVIEW",
  });
}

/**
 * DELETE /api/production/ranking/jobs/[id]
 *
 * The axe: abolish a failed ranking, artefacts and all.
 *
 * ## Why this deletes rather than flags
 *
 * `MARKED_FOR_DELETION` already exists in the status enum and every FAILED_*
 * state may legally transition to it (`packages/domain/src/state-machine/
 * transition-rules.ts`). What does NOT exist is anything that collects it.
 * The reaper is real —
 * `apps/worker-orchestrator/src/processors/garbage-collection.ts` unlinks the
 * manifest assets and moves the row to DELETED — but nothing ever reaches it:
 *
 *   - No route, action, script or worker writes MARKED_FOR_DELETION. The rows
 *     on prod carrying it are historical.
 *   - Its only enqueue path, `watchdog/job-auto-delete.ts`, lists
 *     MARKED_FOR_DELETION in EXEMPT_STATUSES and so skips it by construction.
 *
 * So setting the status alone would hide the row and strand its files and its
 * Drive copies forever. This handler therefore does the collecting itself,
 * inline, and only then records the status — reusing the existing vocabulary
 * without depending on a collector that will never run. Deleting the row
 * outright was the alternative and is worse: it would erase the error message
 * that explains why eight of these failed.
 *
 * ## Order: Drive first, then disk, then the row
 *
 * The same order, for the same reason, as the tutorial disapprove path. Drive
 * is the copy a human might publish from, so it is the one that must go; if it
 * cannot, nothing is changed and the caller is told, because a job marked
 * deleted whose video is still in Drive is worse than a loud failure. Local
 * files are best-effort — their absence is not an error, retention may have
 * collected them already.
 *
 * Failed rankings are the target and the only permitted input. A job that is
 * still working, awaiting a human, or already delivered is refused: "abolish
 * the failed ones" is the ask, and an axe that can also take a published video
 * is a different and much more dangerous tool.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const loaded = await loadRanking(id);
  if (!loaded.ok) return loaded.response;
  const { job } = loaded;

  if (!job.status.startsWith("FAILED_")) {
    return NextResponse.json(
      {
        error:
          `Only failed rankings can be deleted here — this one is ${job.status}. ` +
          `Nothing was changed.`,
      },
      { status: 409 },
    );
  }

  const { owner, allowed } = authorship(job, session);
  if (!allowed) {
    return NextResponse.json(
      {
        error: owner
          ? "That ranking was started by someone else."
          : "That ranking has no recorded owner, so only a manager can delete it.",
      },
      { status: 403 },
    );
  }

  // ── 1. Drive ────────────────────────────────────────────────────────────
  const artifacts = await db
    .select({
      id: storageArtifacts.id,
      kind: storageArtifacts.kind,
      driveFileId: storageArtifacts.drive_file_id,
    })
    .from(storageArtifacts)
    .where(
      and(
        eq(storageArtifacts.job_id, job.id),
        eq(storageArtifacts.owner_kind, "content_job"),
      ),
    );

  const withDriveCopy = artifacts.filter((a) => a.driveFileId);
  const driveDeleted: string[] = [];

  if (withDriveCopy.length > 0) {
    const { ArtifactStore } = await import("@repo/storage");
    const created = ArtifactStore.create(db);
    if (!created.ok) {
      return NextResponse.json(
        {
          error: `Google Drive is not configured on this server (${created.reason}), so the Drive copies cannot be deleted. Nothing was changed.`,
        },
        { status: 503 },
      );
    }
    for (const a of withDriveCopy) {
      const ok = await created.store.deleteArtifactFromDrive(a.id);
      if (!ok) {
        return NextResponse.json(
          {
            error: `Failed to delete ${a.kind} from Google Drive. Nothing else was changed; try again.`,
            deletedSoFar: driveDeleted,
          },
          { status: 502 },
        );
      }
      driveDeleted.push(a.kind);
    }
  }

  // ── 2. Local files ──────────────────────────────────────────────────────
  // Every place a RANKING job writes, all keyed by the job id. Both ids were
  // UUID-validated by loadRanking / the guard below, so no caller-controlled
  // text reaches a path.
  const mediaRoot = getHubConfig().LOCAL_MEDIA_ROOT;
  const localRemoved: string[] = [];

  const dirs: string[] = [join(mediaRoot, "thumbnails", job.id)];
  if (UUID_RE.test(job.channel_id)) {
    dirs.push(join(mediaRoot, job.channel_id, job.id));
  }
  for (const dir of dirs) {
    try {
      await rm(dir, { recursive: true, force: true });
      localRemoved.push(dir);
    } catch {
      // Best effort: retention may have collected it already.
    }
  }

  // Sprites and hero stills live in shared folders, one file per item, named
  // `<jobId>-item-N…`. Enumerate rather than glob so nothing outside the
  // prefix can be caught.
  for (const shared of ["ranking-sprites", "ranking-hero"]) {
    const dir = join(mediaRoot, shared);
    try {
      const names = await readdir(dir);
      for (const name of names) {
        if (!name.startsWith(`${job.id}-`)) continue;
        await rm(join(dir, name), { force: true }).catch(() => undefined);
        localRemoved.push(join(dir, name));
      }
    } catch {
      // Directory may not exist on this host.
    }
  }

  // Anything the manifest lists that the directories above did not cover.
  if (Array.isArray(job.r2_asset_manifest)) {
    for (const entry of job.r2_asset_manifest as Array<
      Record<string, unknown>
    >) {
      const key = entry?.["key"];
      if (typeof key !== "string" || !key.trim()) continue;
      const abs = toAbsolute(key, mediaRoot);
      await rm(abs, { force: true }).catch(() => undefined);
    }
  }

  // ── 3. The row ──────────────────────────────────────────────────────────
  // FAILED_* → MARKED_FOR_DELETION is the legal transition for every failure
  // state. The note records that collection already happened here, so nobody
  // later mistakes this for a row still waiting on the reaper that does not run.
  const metadata = (job.metadata as Record<string, unknown>) ?? {};
  await db
    .update(contentJobs)
    .set({
      status: "MARKED_FOR_DELETION" as never,
      metadata: {
        ...metadata,
        deleted_by: session.userId,
        deleted_at: new Date().toISOString(),
        deleted_from_status: job.status,
        deletion_note:
          "Artefacts removed inline by /api/production/ranking/jobs/[id] DELETE; no GC pass is pending.",
      } as never,
      updated_at: new Date(),
      status_updated_at: new Date(),
    })
    .where(eq(contentJobs.id, job.id));

  await db
    .delete(storageArtifacts)
    .where(
      and(
        eq(storageArtifacts.job_id, job.id),
        eq(storageArtifacts.owner_kind, "content_job"),
      ),
    );

  return NextResponse.json({
    success: true,
    id: job.id,
    driveDeleted,
    localRemoved,
    previousStatus: job.status,
  });
}
