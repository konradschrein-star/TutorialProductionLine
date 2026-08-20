export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  getVariants,
  updateAsset,
} from "../../../../../lib/repositories/asset-repository";

/**
 * GET /api/assets/[id]/variants
 *
 * Fetch all variants of a parent asset
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:job-detail")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await params;
    const variants = await getVariants(id);

    return NextResponse.json({
      variants,
      total: variants.length,
    });
  } catch (error) {
    console.error("Error fetching variants:", error);
    return NextResponse.json(
      { error: "Failed to fetch variants" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/assets/[id]/variants
 *
 * Create a new variant relationship
 *
 * Body: {
 *   variant_id: string;
 *   variant_type: string;
 *   variant_metadata?: Record<string, unknown>;
 * }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: parentId } = await params;
    const body = await request.json();

    const { variant_id, variant_type, variant_metadata } = body;

    if (!variant_id || !variant_type) {
      return NextResponse.json(
        { error: "variant_id and variant_type are required" },
        { status: 400 },
      );
    }

    // Update the variant asset to link it to the parent
    const updatedVariant = await updateAsset(variant_id, {
      parent_asset_id: parentId,
      variant_type,
      variant_metadata: variant_metadata || {},
    });

    if (!updatedVariant) {
      return NextResponse.json(
        { error: "Variant asset not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      variant: updatedVariant,
    });
  } catch (error) {
    console.error("Error creating variant:", error);
    return NextResponse.json(
      { error: "Failed to create variant" },
      { status: 500 },
    );
  }
}
