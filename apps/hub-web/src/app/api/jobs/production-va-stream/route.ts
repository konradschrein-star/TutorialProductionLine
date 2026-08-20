export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, contentJobs } from "@/lib/db";
import { eq, and, isNotNull, count } from "drizzle-orm";

/**
 * GET /api/jobs/production-va-stream?job_id=...
 *
 * Server-Sent Events stream for real-time Production VA job updates.
 * Sends updates every 2 seconds while the current job is at AWAITING_PRODUCTION_VA.
 * Tracks queue statistics and job status changes.
 */
export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Check permissions (same as HeyGen upload actions)
    if (!hasPermission(session, "upload:heygen-footage")) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }

    // Get job_id from query parameters
    const jobId = request.nextUrl.searchParams.get("job_id");
    if (!jobId) {
      return NextResponse.json(
        { error: "Missing job_id parameter" },
        { status: 400 },
      );
    }

    // Set up SSE response headers
    const responseHeaders = new Headers({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable proxy buffering
    });

    // Create a custom response with the event stream
    const body = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        // Send initial connection message
        controller.enqueue(encoder.encode(": connected\n\n"));

        // Poll for updates every 2 seconds
        const pollInterval = setInterval(async () => {
          try {
            // Get current job status
            const [currentJob] = await db
              .select()
              .from(contentJobs)
              .where(eq(contentJobs.id, jobId))
              .limit(1);

            if (!currentJob) {
              controller.enqueue(
                encoder.encode(
                  `event: job-deleted\ndata: ${JSON.stringify({ jobId })}\n\n`,
                ),
              );
              clearInterval(pollInterval);
              controller.close();
              return;
            }

            // Send job status update
            controller.enqueue(
              encoder.encode(
                `event: job-update\ndata: ${JSON.stringify({
                  jobId: currentJob.id,
                  status: currentJob.status,
                  error_message: currentJob.error_message,
                  updated_at: currentJob.updated_at,
                })}\n\n`,
              ),
            );

            // If job left AWAITING_PRODUCTION_VA state, close the stream
            if (currentJob.status !== "AWAITING_PRODUCTION_VA") {
              clearInterval(pollInterval);
              controller.close();
              return;
            }

            // Send Production VA queue statistics
            const awaitingResult = await db
              .select({ count: count() })
              .from(contentJobs)
              .where(eq(contentJobs.status, "AWAITING_PRODUCTION_VA" as any));
            const awaitingCount = awaitingResult[0]?.count ?? 0;

            const errorResult = await db
              .select({ count: count() })
              .from(contentJobs)
              .where(
                and(
                  eq(contentJobs.status, "AWAITING_PRODUCTION_VA" as any),
                  isNotNull(contentJobs.error_message),
                ),
              );
            const errorCount = errorResult[0]?.count ?? 0;

            controller.enqueue(
              encoder.encode(
                `event: va-stats\ndata: ${JSON.stringify({
                  awaitingProductionVACount: awaitingCount,
                  errorCount: errorCount,
                })}\n\n`,
              ),
            );
          } catch (error) {
            console.error("Error in Production VA stream poll:", error);
            // Don't close on error, just skip this update
          }
        }, 2000);

        // Clean up on client disconnect
        const checkClosed = setInterval(() => {
          if (!controller.desiredSize) {
            clearInterval(pollInterval);
            clearInterval(checkClosed);
            try {
              controller.close();
            } catch (err) {
              // Stream already closed
            }
          }
        }, 1000);
      },
    });

    return new NextResponse(body, { headers: responseHeaders });
  } catch (error) {
    console.error("GET /api/jobs/production-va-stream error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
