import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { createAsset } from "@/lib/repositories/asset-repository";
import { addAssetToStyleCollection } from "@/lib/repositories/style-library-repository";
import { getConfig } from "@repo/config";

export const dynamic = "force-dynamic";

/**
 * POST /api/style-collections/[id]/assets
 *
 * Upload a reference image and link it to a style collection.
 *
 * FormData fields:
 *   - file: File (required) — image file
 *   - ref_type: string (required) — logo, typography, color_palette, scene_example, style_guide
 *   - display_order: number (optional) — defaults to 0
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id: collectionId } = await params;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to parse form data: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    );
  }

  const file = formData.get("file") as File | null;
  const refType = formData.get("ref_type") as string | null;
  const displayOrder = parseInt(
    (formData.get("display_order") as string) || "0",
    10,
  );

  // Validation
  if (!file) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (!refType) {
    return NextResponse.json(
      { error: "ref_type is required" },
      { status: 400 },
    );
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json(
      { error: "file must be an image" },
      { status: 400 },
    );
  }

  try {
    const config = getConfig();
    const mediaRoot = config.LOCAL_MEDIA_ROOT;

    // Create directory structure: {LOCAL_MEDIA_ROOT}/style-collections/{collection_id}/
    const collectionDir = join(mediaRoot, "style-collections", collectionId);
    await mkdir(collectionDir, { recursive: true });

    // Generate unique filename
    const timestamp = Date.now();
    const ext = file.name.split(".").pop() || "png";
    const fileName = `${refType}_${timestamp}.${ext}`;
    const filePath = join(collectionDir, fileName);

    // Write file
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // Create asset entry. `asset_type: "style_guide"` is the closest match
    // in the `assets.asset_type` enum — there is no dedicated
    // "style_collection_ref" value (that literal doesn't exist in the enum
    // and would have failed the insert at the database level).
    const asset = await createAsset({
      name: `${refType} - ${collectionId}`,
      description: `${refType} reference image for style collection`,
      asset_type: "style_guide",
      file_path: filePath.replace(/\\/g, "/"), // Normalize to forward slashes
      file_name: fileName,
      file_format: ext,
      format: "image",
      channel_id: null, // Style collection assets are not channel-specific
      tags: [`#style-collection:${collectionId}`, `#ref-type:${refType}`],
      origin: "real", // User-uploaded
    });

    // Link asset to style collection
    await addAssetToStyleCollection(
      collectionId,
      asset.id,
      refType,
      displayOrder,
    );

    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to upload asset: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}
