export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { dispatchStagedJobs } from "@/app/actions/zip-ingestion";

/**
 * POST /api/dispatch-jobs
 *
 * API route wrapper for the dispatchStagedJobs server action.
 * Called from the job creation staging table to dispatch jobs to the ingest queue.
 *
 * Expects FormData with:
 * - `jobs` (JSON string): Array of StagedJobPayload objects
 *
 * Returns:
 * - { success: boolean, queued: number, results: Array<{topic, success, error?}> }
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const result = await dispatchStagedJobs(formData);

    return NextResponse.json(result, {
      status: result.success ? 200 : 400,
    });
  } catch (error) {
    console.error("Dispatch jobs API error:", error);
    return NextResponse.json(
      {
        success: false,
        queued: 0,
        results: [
          {
            topic: "",
            success: false,
            error:
              error instanceof Error ? error.message : "Internal server error",
          },
        ],
      },
      { status: 500 },
    );
  }
}
