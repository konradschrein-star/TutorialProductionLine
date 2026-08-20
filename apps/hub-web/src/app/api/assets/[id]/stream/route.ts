/**
 * Media Streaming API Endpoint
 *
 * GET /api/assets/{id}/stream
 *
 * Serves media files (video, audio, image) for preview in the frontend.
 *
 * Features:
 * - HTTP Range request support for video seeking
 * - Proper Content-Type headers based on file format
 * - 404 handling for missing assets or files
 * - Database-driven file path resolution
 */

import { NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { getAssetById } from "@/lib/repositories/asset-repository";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

/**
 * Validation schema for route parameters
 */
const ParamsSchema = z.object({
  id: z.string().uuid("Invalid asset ID format"),
});

/**
 * Map file formats to MIME types
 */
function getContentType(format: string): string {
  const formatLower = format.toLowerCase();

  // Video formats
  if (formatLower === "mp4") return "video/mp4";
  if (formatLower === "webm") return "video/webm";
  if (formatLower === "mov") return "video/quicktime";
  if (formatLower === "avi") return "video/x-msvideo";
  if (formatLower === "mkv") return "video/x-matroska";

  // Audio formats
  if (formatLower === "mp3") return "audio/mpeg";
  if (formatLower === "wav") return "audio/wav";
  if (formatLower === "ogg") return "audio/ogg";
  if (formatLower === "m4a") return "audio/mp4";
  if (formatLower === "aac") return "audio/aac";

  // Image formats
  if (formatLower === "jpg" || formatLower === "jpeg") return "image/jpeg";
  if (formatLower === "png") return "image/png";
  if (formatLower === "gif") return "image/gif";
  if (formatLower === "webp") return "image/webp";
  if (formatLower === "svg") return "image/svg+xml";

  // Default to octet-stream
  return "application/octet-stream";
}

/**
 * GET handler for media streaming
 *
 * Supports:
 * - Full file delivery
 * - HTTP 206 Partial Content (Range requests for seeking)
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    // AUTH: /api/assets is middleware-exempt (handlers self-authenticate), so
    // this route MUST gate itself. Without this, anyone could stream private
    // render assets by guessing/enumerating asset UUIDs.
    const session = await getSession();
    if (!session || !hasPermission(session, "view:job-detail")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rawParams = await context.params;

    // Validate params
    const validation = ParamsSchema.safeParse(rawParams);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid asset ID", details: validation.error.issues },
        { status: 400 },
      );
    }

    const { id: assetId } = validation.data;

    // Fetch asset metadata from database
    const asset = await getAssetById(assetId);

    if (!asset) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    // Ensure file path exists
    if (!asset.file_path) {
      return NextResponse.json(
        { error: "Media file path not configured" },
        { status: 404 },
      );
    }

    // Validate LOCAL_MEDIA_ROOT is configured
    const mediaRoot = process.env.LOCAL_MEDIA_ROOT;
    if (!mediaRoot) {
      console.error(
        "[Stream] LOCAL_MEDIA_ROOT environment variable not configured",
      );
      return NextResponse.json(
        { error: "Media storage not configured" },
        { status: 500 },
      );
    }

    // Resolve both paths to absolute
    const resolvedMediaRoot = resolve(mediaRoot);
    const resolvedFilePath = resolve(asset.file_path);

    // CRITICAL: Verify file is within allowed media directory
    if (!resolvedFilePath.startsWith(resolvedMediaRoot)) {
      console.error(
        `[Stream] Path traversal attempt blocked: ${asset.file_path} outside ${mediaRoot}`,
      );
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Check if file exists on disk
    if (!existsSync(resolvedFilePath)) {
      return NextResponse.json(
        { error: "Media file not found on disk" },
        { status: 404 },
      );
    }

    // Get file stats
    let stats;
    try {
      stats = statSync(resolvedFilePath);
    } catch (error) {
      console.error(`[Stream] Failed to stat file ${resolvedFilePath}:`, error);
      return NextResponse.json(
        { error: "Failed to access media file" },
        { status: 500 },
      );
    }

    // Determine content type from file format
    const contentType = getContentType(asset.file_format || "");

    // Handle Range requests (for video/audio seeking)
    const rangeHeader = request.headers.get("range");

    if (rangeHeader) {
      // Parse Range header (e.g., "bytes=0-1023")
      const rangeParts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(rangeParts[0], 10);
      const end = rangeParts[1] ? parseInt(rangeParts[1], 10) : stats.size - 1;

      // Validate range
      if (isNaN(start) || start < 0 || start >= stats.size) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${stats.size}`,
          },
        });
      }

      const chunkSize = end - start + 1;

      // Create readable stream for the range
      const stream = createReadStream(resolvedFilePath, { start, end });

      return new NextResponse(stream as any, {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": chunkSize.toString(),
          "Content-Range": `bytes ${start}-${end}/${stats.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    // No range request - return full file
    const stream = createReadStream(resolvedFilePath);

    return new NextResponse(stream as any, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": stats.size.toString(),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    const rawParams = await context.params;
    const assetId = rawParams?.id || "unknown";
    console.error(`[Stream] Error streaming asset ${assetId}:`, error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
