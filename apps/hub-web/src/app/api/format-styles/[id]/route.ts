export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  getFormatStyleLibraryById,
  updateFormatStyleLibrary,
  deleteFormatStyleLibrary,
} from "@/lib/repositories/format-style-library-repository";

/**
 * `/api/format-styles` is on the middleware API_ROUTES bypass list
 * (middleware.ts), so the deny-by-default canAccessRoute() gate never runs for
 * it — these handlers are the ONLY access control. Until 2026-07-29 this file
 * had none at all, which made DELETE /api/format-styles/[id] an anonymous,
 * internet-reachable delete. Permissions mirror the collection route
 * (../route.ts): read = view:formats, write = manage:templates.
 */

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/format-styles/[id]
 * Get a format style library by ID with reference assets
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:formats")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await context.params;
    const library = await getFormatStyleLibraryById(id);

    if (!library) {
      return NextResponse.json({ error: "Library not found" }, { status: 404 });
    }

    return NextResponse.json({ library });
  } catch (error) {
    console.error("Failed to get format style library:", error);
    return NextResponse.json(
      { error: "Failed to get format style library" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/format-styles/[id]
 * Update a format style library's metadata
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:templates")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id } = await context.params;
    const body = await request.json();

    const library = await updateFormatStyleLibrary(id, {
      name: body.name,
      description: body.description,
      text_guidelines: body.text_guidelines,
      format: body.format,
      metadata: body.metadata,
      is_active: body.is_active,
    });

    if (!library) {
      return NextResponse.json({ error: "Library not found" }, { status: 404 });
    }

    return NextResponse.json({ library });
  } catch (error) {
    console.error("Failed to update format style library:", error);
    return NextResponse.json(
      { error: "Failed to update format style library" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/format-styles/[id]
 * Delete a format style library
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:templates")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id } = await context.params;
    await deleteFormatStyleLibrary(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete format style library:", error);
    return NextResponse.json(
      { error: "Failed to delete format style library" },
      { status: 500 },
    );
  }
}
