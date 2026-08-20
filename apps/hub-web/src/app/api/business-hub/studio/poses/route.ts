/**
 * GET  /api/business-hub/studio/poses  — read the presenter pose manifest.
 * PUT  /api/business-hub/studio/poses  — save it back, fully validated.
 *
 * The browser cannot write the filesystem, so this route is how the Presenter
 * Studio persists calibration. The write is fail-closed in both directions: a
 * manifest that does not satisfy the contracts schema is rejected, and a pose
 * flipped to `anchor_status: "calibrated"` without all six hitboxes is rejected
 * separately with a message naming the pose — see `writePoseManifest`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardStudio, studioErrorResponse } from "../_lib/guard";
import {
  readPoseManifest,
  writePoseManifest,
  resolvePresenterRoot,
} from "../_lib/presenter-store";

export const dynamic = "force-dynamic";

/**
 * The save envelope. `poses` is intentionally `unknown`: it is validated by
 * `PoseManifestSchema` inside `writePoseManifest`, and pre-shaping it here with
 * a looser local schema would produce two disagreeing sources of truth.
 */
const SaveSchema = z.object({
  poses: z.unknown(),
  /**
   * Revision the client loaded. Required — omitting it to force a write is not
   * something the UI ever needs, and a stale save silently discarding another
   * operator's calibration is the failure this prevents.
   */
  revision: z.string().min(1),
});

export async function GET(): Promise<NextResponse> {
  const denied = await guardStudio("read");
  if (denied) return denied;

  try {
    const { poses, revision, path: manifestPath } = await readPoseManifest();
    const calibrated = poses.filter(
      (p) => p.anchor_status === "calibrated",
    ).length;

    return NextResponse.json(
      {
        poses,
        revision,
        manifestPath,
        presenterRoot: resolvePresenterRoot(),
        summary: {
          total: poses.length,
          calibrated,
          needsCalibration: poses.length - calibrated,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return studioErrorResponse(error, "Reading the pose manifest failed");
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const denied = await guardStudio("write");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch (error) {
    return NextResponse.json(
      {
        error: `Request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 400 },
    );
  }

  const envelope = SaveSchema.safeParse(body);
  if (!envelope.success) {
    return NextResponse.json(
      {
        error:
          "Save envelope must be { poses, revision }. " +
          envelope.error.issues
            .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
            .join("; "),
      },
      { status: 400 },
    );
  }

  try {
    const { revision, path: manifestPath } = await writePoseManifest(
      envelope.data.poses,
      envelope.data.revision,
    );
    const reloaded = await readPoseManifest();
    const calibrated = reloaded.poses.filter(
      (p) => p.anchor_status === "calibrated",
    ).length;

    return NextResponse.json({
      saved: true,
      revision,
      manifestPath,
      poses: reloaded.poses,
      summary: {
        total: reloaded.poses.length,
        calibrated,
        needsCalibration: reloaded.poses.length - calibrated,
      },
    });
  } catch (error) {
    return studioErrorResponse(error, "Saving the pose manifest failed");
  }
}
