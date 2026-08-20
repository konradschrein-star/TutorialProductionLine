import { NextRequest, NextResponse } from "next/server";
import { getJobById } from "@/lib/repositories/job-repository";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { statSync, readFileSync } from "fs";
import { resolve, sep } from "node:path";
import { Readable } from "node:stream";
import JSZip from "jszip";

/**
 * Download All Assets API Route
 *
 * GET /api/assets/[id]/download-all
 *
 * Creates a ZIP archive of all assets for a job and streams it to the client.
 */

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session || !hasPermission(session, "view:job-detail")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: jobId } = await params;

    // Verify job access
    const job = await getJobById(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Get asset manifest
    const manifest =
      (job.r2_asset_manifest as Array<{
        key: string;
        type: string;
        size_bytes: number;
      }>) || [];
    if (manifest.length === 0) {
      return NextResponse.json({ error: "No assets found" }, { status: 404 });
    }

    // Create ZIP archive
    const zip = new JSZip();
    const mediaRoot =
      process.env.LOCAL_MEDIA_ROOT || "/opt/content-forge/media";
    const rootAbs = resolve(mediaRoot);
    let filesAdded = 0;

    // Add each asset to the archive
    for (const asset of manifest) {
      let localPath = asset.key;

      // Handle both absolute and relative paths
      if (!localPath.startsWith("/")) {
        localPath = `${mediaRoot}/${localPath}`;
      }

      // SECURITY: manifest keys are system-generated but treat them as untrusted
      // — confine every read to LOCAL_MEDIA_ROOT so a poisoned key can't escape.
      const targetAbs = resolve(localPath);
      if (targetAbs !== rootAbs && !targetAbs.startsWith(rootAbs + sep)) {
        console.warn(`Skipping out-of-root asset key: ${asset.key}`);
        continue;
      }

      try {
        // Verify file exists
        statSync(targetAbs);

        // Get filename for archive (use last segment of path)
        const filename =
          targetAbs.split(/[\\/]/).pop() || `asset-${filesAdded}`;

        // Read file and add to ZIP
        const fileBuffer = readFileSync(targetAbs);
        zip.file(filename, fileBuffer);
        filesAdded++;
      } catch (error) {
        // Skip missing files but log them
        console.warn(`Skipping missing asset: ${targetAbs}`, error);
      }
    }

    // If no files were added, return error
    if (filesAdded === 0) {
      return NextResponse.json(
        { error: "No accessible assets found" },
        { status: 404 },
      );
    }

    // Stream the archive out rather than materializing the whole blob in memory.
    // Use STORE (no compression): asset bundles are already-compressed media
    // (mp4/jpg/webp), so level-9 DEFLATE only burns CPU (blocking the event loop
    // for the whole process) for near-zero size gain.
    const nodeStream = zip.generateNodeStream({
      type: "nodebuffer",
      streamFiles: true,
      compression: "STORE",
    });

    const headers = new Headers({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="job-${jobId}-assets.zip"`,
      "Cache-Control": "private, no-cache",
    });

    return new NextResponse(
      Readable.toWeb(nodeStream) as unknown as ReadableStream,
      { headers },
    );
  } catch (error) {
    console.error("Failed to create asset archive:", error);
    return NextResponse.json(
      { error: "Failed to create archive" },
      { status: 500 },
    );
  }
}
