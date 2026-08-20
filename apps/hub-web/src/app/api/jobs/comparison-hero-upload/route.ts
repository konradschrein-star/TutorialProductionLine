export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { db, contentJobs, eq } from "@/lib/db";
import { getConfig } from "@repo/config";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";

/**
 * POST /api/jobs/comparison-hero-upload
 *
 * Uploads hero image for Product A or B and updates metadata.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const formData = await request.formData();
    const jobId = formData.get("job_id") as string;
    const channelId = formData.get("channel_id") as string;
    const slot = formData.get("slot") as "A" | "B";
    const heroImage = formData.get("hero_image") as File;

    if (!jobId || !channelId || !slot || !heroImage) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: job_id, channel_id, slot, hero_image",
        },
        { status: 400 },
      );
    }

    if (!["A", "B"].includes(slot)) {
      return NextResponse.json(
        { error: 'Slot must be "A" or "B"' },
        { status: 400 },
      );
    }

    // Fetch job
    const job = await db.query.contentJobs.findFirst({
      where: eq(contentJobs.id, jobId),
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const comparisonMeta = ((job.metadata as any) ?? {})?.comparison;

    if (!comparisonMeta) {
      return NextResponse.json(
        { error: "Not a comparison job" },
        { status: 400 },
      );
    }

    // Determine save path
    const { LOCAL_MEDIA_ROOT } = getConfig();
    const jobDir = join(LOCAL_MEDIA_ROOT, channelId, jobId);
    await mkdir(jobDir, { recursive: true });

    const fileName = `hero_${slot.toLowerCase()}.${heroImage.type.split("/")[1] || "png"}`;
    const filePath = join(jobDir, fileName);

    // Write file
    const bytes = await heroImage.arrayBuffer();
    await writeFile(filePath, Buffer.from(bytes));

    console.warn(`[comparison-hero-upload] Saved ${fileName} to ${filePath}`);

    // Update metadata
    const products = comparisonMeta.products || [];
    const productIndex = products.findIndex((p: any) => p.slot === slot);

    if (productIndex === -1) {
      return NextResponse.json(
        { error: `Product slot ${slot} not found in metadata` },
        { status: 400 },
      );
    }

    products[productIndex].hero_asset_key = filePath;

    const updatedMetadata = {
      ...((job.metadata as any) ?? {}),
      comparison: {
        ...comparisonMeta,
        products,
      },
    };

    await db
      .update(contentJobs)
      .set({ metadata: updatedMetadata })
      .where(eq(contentJobs.id, jobId));

    // Update asset manifest
    const assetManifest = (job.r2_asset_manifest as any[]) || [];
    const assetType = `image/hero-${slot}`;
    const existingAssetIndex = assetManifest.findIndex(
      (a) => a.type === assetType,
    );

    if (existingAssetIndex !== -1) {
      assetManifest[existingAssetIndex] = {
        key: filePath,
        type: assetType,
        size_bytes: bytes.byteLength,
      };
    } else {
      assetManifest.push({
        key: filePath,
        type: assetType,
        size_bytes: bytes.byteLength,
      });
    }

    await db
      .update(contentJobs)
      .set({ r2_asset_manifest: assetManifest })
      .where(eq(contentJobs.id, jobId));

    return NextResponse.json({
      success: true,
      job_id: jobId,
      slot,
      file_path: filePath,
    });
  } catch (error: any) {
    console.error("[comparison-hero-upload] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
