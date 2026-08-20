export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { createJob } from "@/app/actions/jobs";

/**
 * POST /api/jobs
 *
 * Create a new content job.
 *
 * Request body:
 * {
 *   channel_id: string;
 *   template_id: string;
 *   format: string;
 *   metadata?: { topic?: string; script?: string; [key: string]: unknown };
 *   production_version?: string;
 *   language?: string;
 *   image_generation_mode?: "auto" | "manual";
 * }
 *
 * Returns:
 * - 201: { id: string } - Job created successfully
 * - 401: { error: string } - Not authenticated
 * - 403: { error: string } - Permission denied
 * - 400: { error: string } - Validation error
 * - 500: { error: string } - Server error
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Check permissions
    if (!hasPermission(session, "create:job")) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();
    const { channel_id, template_id, format, metadata, narration_source_path } =
      body;

    // Basic validation
    if (!channel_id || !template_id || !format) {
      return NextResponse.json(
        { error: "Missing required fields: channel_id, template_id, format" },
        { status: 400 },
      );
    }

    // Extract topic and script from metadata if present
    const topic = metadata?.topic;
    const script = metadata?.script;

    // Call the server action
    const result = await createJob({
      channel_id,
      template_id,
      format,
      production_version: body.production_version || "V2",
      initial_topic: topic,
      script_text: script,
      language: body.language || "en",
      image_generation_mode: body.image_generation_mode || "auto",
      narration_source_path: narration_source_path || undefined,
      metadata,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to create job" },
        { status: 400 },
      );
    }

    // Return success with a synthetic job ID (the action doesn't return the actual ID)
    // The client will redirect to /jobs list page
    return NextResponse.json(
      { message: "Job created successfully" },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/jobs error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
