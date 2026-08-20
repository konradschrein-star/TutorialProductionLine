import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createQMSValidationQueue, createRedisConnection } from "@repo/queue";
import { getSession } from "@/lib/auth/session";
import { db, jobEditLists, contentJobs } from "@/lib/db";
import { EditListSchema } from "@repo/contracts";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * GET /api/clip-library/edit-lists/[editListId]
 *
 * Fetch a single job edit list with parsed entries.
 *
 * Returns:
 * - 200: Edit list object with parsed entries
 * - 401: Not authenticated
 * - 404: Edit list not found
 * - 500: Server error
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ editListId: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { editListId } = await params;
    if (!editListId || !/^[0-9a-f-]{36}$/i.test(editListId)) {
      return NextResponse.json(
        { error: "Invalid edit list ID" },
        { status: 400 },
      );
    }

    const [editList] = await db
      .select()
      .from(jobEditLists)
      .where(eq(jobEditLists.id, editListId))
      .limit(1);

    if (!editList) {
      return NextResponse.json(
        { error: "Edit list not found" },
        { status: 404 },
      );
    }

    // Parse entries from jsonb
    const entriesParsed = EditListSchema.safeParse(editList.entries);
    const entries = entriesParsed.success ? entriesParsed.data : [];

    return NextResponse.json({ ...editList, entries });
  } catch (error) {
    console.error(
      "GET /api/clip-library/edit-lists/[editListId] error:",
      error,
    );
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}

const PatchBodySchema = z.object({
  status: z.enum(["approved", "rejected"]),
});

/**
 * PATCH /api/clip-library/edit-lists/[editListId]
 *
 * Update the status of a job edit list.
 * - approved: also advances job to QMS_VALIDATING
 * - rejected: returns job to CLIP_SELECTION for re-run
 *
 * Returns:
 * - 200: Updated edit list
 * - 400: Invalid body or edit list ID
 * - 401: Not authenticated
 * - 404: Edit list not found
 * - 500: Server error
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ editListId: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { editListId } = await params;
    if (!editListId || !/^[0-9a-f-]{36}$/i.test(editListId)) {
      return NextResponse.json(
        { error: "Invalid edit list ID" },
        { status: 400 },
      );
    }

    const body = await req.json();
    const parsed = PatchBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { status } = parsed.data;

    // Fetch existing edit list
    const [editList] = await db
      .select()
      .from(jobEditLists)
      .where(eq(jobEditLists.id, editListId))
      .limit(1);

    if (!editList) {
      return NextResponse.json(
        { error: "Edit list not found" },
        { status: 404 },
      );
    }

    const now = new Date();

    // Update edit list status
    await db
      .update(jobEditLists)
      .set({
        status,
        reviewed_by: session.userId ?? undefined,
        reviewed_at: now,
        updated_at: now,
      })
      .where(eq(jobEditLists.id, editListId));

    // Advance job status based on review decision
    const newJobStatus =
      status === "approved" ? "QMS_VALIDATING" : "CLIP_SELECTION";

    await db
      .update(contentJobs)
      .set({
        status: newJobStatus as any,
        updated_at: now,
        status_updated_at: now,
      })
      .where(eq(contentJobs.id, editList.job_id));

    // Dispatch pre-render validation so the worker picks the job up straight
    // away. Without this the job sat at QMS_VALIDATING with nothing listening
    // — no queue message is ever produced elsewhere on the approve path — so
    // every human-approved edit list stalled until the stale-state watchdog
    // failed it. Mirrors /api/jobs/[id]/va-review/submit, which does enqueue.
    if (status === "approved") {
      const redisUrl = process.env["REDIS_URL"];
      if (redisUrl) {
        try {
          const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
          const qmsQueue = createQMSValidationQueue(conn);
          await qmsQueue.add("validate-pre-render", {
            job_id: editList.job_id,
            validation_stage: "pre-render",
          });
          await conn.quit();
        } catch (err) {
          // Non-fatal: the status is already advanced. Log loudly — this is
          // exactly the silent failure that produced the original stall.
          console.error(
            "[clip-library/edit-lists] Failed to dispatch QMS job:",
            err,
          );
        }
      } else {
        console.error(
          "[clip-library/edit-lists] REDIS_URL unset — job advanced to QMS_VALIDATING with no queue dispatch",
        );
      }
    }

    console.warn(
      JSON.stringify({
        level: "info",
        message: "Edit list reviewed",
        edit_list_id: editListId,
        job_id: editList.job_id,
        status,
        new_job_status: newJobStatus,
        reviewed_by: session.userId,
      }),
    );

    // Return updated edit list
    const [updated] = await db
      .select()
      .from(jobEditLists)
      .where(eq(jobEditLists.id, editListId))
      .limit(1);

    const entriesParsed = EditListSchema.safeParse(updated?.entries);
    const entries = entriesParsed.success ? entriesParsed.data : [];

    return NextResponse.json({ ...updated, entries });
  } catch (error) {
    console.error(
      "PATCH /api/clip-library/edit-lists/[editListId] error:",
      error,
    );
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
