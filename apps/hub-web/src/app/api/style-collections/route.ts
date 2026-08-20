import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  listStyleCollections,
  createStyleCollection,
} from "@/lib/repositories/style-library-repository";

export const dynamic = "force-dynamic";

/**
 * GET /api/style-collections
 *
 * List style collections with optional filtering.
 * Query params:
 *   - channel_id (optional) — filter by channel (includes universal)
 *   - archetype_id (optional) — filter by archetype (includes universal)
 *   - format (optional) — filter by format (includes universal)
 *   - is_active (optional) — filter by active status
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  // Allow users with create:job permission to read style collections for job creation
  if (
    !session ||
    !(
      hasPermission(session, "view:settings") ||
      hasPermission(session, "create:job")
    )
  ) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channel_id") ?? undefined;
  const archetypeId = searchParams.get("archetype_id") ?? undefined;
  const format = searchParams.get("format") ?? undefined;
  const isActive = searchParams.get("is_active") === "true" ? true : undefined;

  try {
    const collections = await listStyleCollections({
      channel_id: channelId,
      archetype_id: archetypeId,
      format,
      is_active: isActive,
    });
    return NextResponse.json({ collections });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to list style collections: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/style-collections
 *
 * Create a new style collection.
 *
 * Request body:
 *   - name: string (required)
 *   - description: string (required)
 *   - text_guidelines: string (optional) — injected into image prompts
 *   - channel_id: string | null (optional) — null = universal
 *   - archetype_id: string | null (optional) — null = universal
 *   - format: string | null (optional) — null = universal
 *   - metadata: object (optional)
 *   - asset_refs: Array<{ asset_id: string, ref_type: string, display_order?: number }> (required)
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    );
  }

  const {
    name,
    description,
    text_guidelines,
    channel_id,
    archetype_id,
    format,
    metadata,
    asset_refs,
  } = body;

  // Validation
  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!description?.trim()) {
    return NextResponse.json(
      { error: "description is required" },
      { status: 400 },
    );
  }
  // asset_refs is now optional - can be added later via /assets endpoint
  if (asset_refs !== undefined && !Array.isArray(asset_refs)) {
    return NextResponse.json(
      { error: "asset_refs must be an array" },
      { status: 400 },
    );
  }

  try {
    const collection = await createStyleCollection({
      name: name.trim(),
      description: description.trim(),
      text_guidelines: text_guidelines?.trim(),
      channel_id: channel_id || null,
      archetype_id: archetype_id || null,
      format: format || null,
      metadata,
      asset_refs: asset_refs || [], // Default to empty array if not provided
    });

    return NextResponse.json({ collection }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to create style collection: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 },
    );
  }
}
