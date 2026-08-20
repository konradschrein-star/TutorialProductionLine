export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { listCharacterLibrary } from "@/lib/repositories/character-library-repository";

/**
 * GET /api/characters/library
 *
 * The Character Library listing: every character with its images (in cycle
 * order) and its channel bindings. Distinct from GET /api/characters, which is
 * the older drama-oriented listing and returns bare character rows.
 *
 * Self-authenticating: /api/characters is an auth BYPASS in middleware, not a
 * grant.
 */
export async function GET() {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  const characters = await listCharacterLibrary();
  return NextResponse.json({ characters });
}
