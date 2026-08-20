import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  getStyleCollectionById,
  updateStyleCollection,
  deleteStyleCollection,
} from "@/lib/repositories/style-library-repository";

export const dynamic = "force-dynamic";

/**
 * GET /api/style-collections/[id]
 *
 * Get a style collection by ID with linked reference assets.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const collection = await getStyleCollectionById(id);
    if (!collection) {
      return NextResponse.json(
        { error: "Style collection not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ collection });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to get style collection: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/style-collections/[id]
 *
 * Update style collection metadata.
 * Does NOT modify linked assets (use separate asset management endpoints).
 *
 * Request body:
 *   - name: string (optional)
 *   - description: string (optional)
 *   - text_guidelines: string (optional)
 *   - channel_id: string | null (optional)
 *   - archetype_id: string | null (optional)
 *   - format: string | null (optional)
 *   - metadata: object (optional)
 *   - is_active: boolean (optional)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;

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

  try {
    const collection = await updateStyleCollection(id, body);
    if (!collection) {
      return NextResponse.json(
        { error: "Style collection not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ collection });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to update style collection: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/style-collections/[id]
 *
 * Delete a style collection.
 * Cascade deletes asset links but preserves assets themselves.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;

  try {
    await deleteStyleCollection(id);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to delete style collection: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 },
    );
  }
}
