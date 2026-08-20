import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getArtifactById, resetForRetry } from "@repo/storage";

export const dynamic = "force-dynamic";

/**
 * POST /api/storage/artifacts/:id/retry
 *
 * Resets a failed artefact to `pending` so the scanner picks it up on its
 * next pass. Does not upload synchronously - a final video can be hundreds of
 * MB and must not run inside a request.
 *
 * Deliberately refuses to touch an artefact that is currently `uploading`:
 * resetting it mid-transfer would orphan the resumable session.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:job")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const artifact = await getArtifactById(db, id);
    if (!artifact) {
      return NextResponse.json(
        { error: "Artifact not found" },
        { status: 404 },
      );
    }

    if (artifact.state === "uploading") {
      return NextResponse.json(
        {
          error:
            "Artifact is currently uploading. Wait for it to finish or fail before retrying.",
          state: artifact.state,
        },
        { status: 409 },
      );
    }

    if (artifact.state === "uploaded") {
      return NextResponse.json({
        message: "Already uploaded; nothing to retry.",
        artifact,
      });
    }

    await resetForRetry(db, id);
    const updated = await getArtifactById(db, id);

    return NextResponse.json({
      message: "Queued for retry on the next scanner pass.",
      artifact: updated,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to retry artifact",
      },
      { status: 500 },
    );
  }
}
