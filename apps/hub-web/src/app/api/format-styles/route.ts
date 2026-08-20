export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  listFormatStyleLibraries,
  createFormatStyleLibrary,
  type CreateFormatStyleLibraryInput,
} from "@/lib/repositories/format-style-library-repository";

/**
 * GET /api/format-styles
 * List format style libraries with optional filtering
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:formats")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const searchParams = request.nextUrl.searchParams;
    const format = searchParams.get("format") || undefined;
    const is_active = searchParams.get("is_active");

    const libraries = await listFormatStyleLibraries({
      format,
      is_active:
        is_active === "true" ? true : is_active === "false" ? false : undefined,
    });

    return NextResponse.json({ libraries });
  } catch (error) {
    console.error("Failed to list format style libraries:", error);
    return NextResponse.json(
      { error: "Failed to list format style libraries" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/format-styles
 * Create a new format style library
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:templates")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await request.json();

    const input: CreateFormatStyleLibraryInput = {
      name: body.name,
      description: body.description,
      format: body.format,
      text_guidelines: body.text_guidelines,
      metadata: body.metadata,
      asset_refs: body.asset_refs || [],
    };

    const library = await createFormatStyleLibrary(input);

    return NextResponse.json({ library }, { status: 201 });
  } catch (error) {
    console.error("Failed to create format style library:", error);
    return NextResponse.json(
      { error: "Failed to create format style library" },
      { status: 500 },
    );
  }
}
