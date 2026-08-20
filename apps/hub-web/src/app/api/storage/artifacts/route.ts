import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { listArtifactsForJob, listArtifactsByState } from "@repo/storage";
import { loadStorageConfig } from "@repo/storage";
import type { StorageUploadState } from "@repo/db";

export const dynamic = "force-dynamic";

const VALID_STATES: StorageUploadState[] = [
  "pending",
  "uploading",
  "uploaded",
  "failed",
  "skipped",
];

/**
 * GET /api/storage/artifacts?job_id=...   - artefacts for one job
 * GET /api/storage/artifacts?state=failed - artefacts in a given state
 *
 * This is what lets the Jobs UI and the distribution engine answer
 * "where is the finished video?" without SSH.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:jobs")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const jobId = request.nextUrl.searchParams.get("job_id");
  const state = request.nextUrl.searchParams.get("state");
  const config = loadStorageConfig();

  try {
    if (jobId) {
      const artifacts = await listArtifactsForJob(db, jobId);
      return NextResponse.json({
        artifacts,
        drive_enabled: config.enabled,
        drive_disabled_reason: config.enabled ? null : config.reason,
      });
    }

    if (state) {
      const requested = state
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is StorageUploadState =>
          (VALID_STATES as string[]).includes(s),
        );
      if (requested.length === 0) {
        return NextResponse.json(
          { error: `state must be one of: ${VALID_STATES.join(", ")}` },
          { status: 400 },
        );
      }
      const artifacts = await listArtifactsByState(db, requested, 200);
      return NextResponse.json({
        artifacts,
        drive_enabled: config.enabled,
        drive_disabled_reason: config.enabled ? null : config.reason,
      });
    }

    return NextResponse.json(
      { error: "job_id or state query parameter is required" },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to list storage artifacts",
      },
      { status: 500 },
    );
  }
}
