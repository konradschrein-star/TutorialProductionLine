import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/production/keywords/seed/[id]  — set the workflow status
 * DELETE /api/production/keywords/seed/[id] — soft-delete ("don't want to do")
 *
 * State tracking + delete for the "Initial Keywords" fallback, mirroring what
 * the previous tutorial tool offered. Local-only (seed_keywords), so it works
 * with the Keyword Tool down. Requires view:production.
 */

const PatchSchema = z.object({
  status: z.enum(["NEW", "IN_PROGRESS", "DONE"]),
});

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const numId = parseId(id);
  if (numId === null) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const rows = (await db.execute<{ id: number; status: string }>(
    sql`UPDATE seed_keywords
        SET status = ${parsed.data.status}, updated_at = now()
        WHERE id = ${numId} AND deleted_at IS NULL
        RETURNING id, status`,
  )) as unknown as Array<{ id: number; status: string }>;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id: rows[0]!.id, status: rows[0]!.status });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const numId = parseId(id);
  if (numId === null) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }

  // Soft-delete so the set is never destroyed and can be restored if needed;
  // the list hides deleted rows, which is what the VA sees as "deleted".
  await db.execute(
    sql`UPDATE seed_keywords SET deleted_at = now(), updated_at = now()
        WHERE id = ${numId} AND deleted_at IS NULL`,
  );
  return NextResponse.json({ ok: true });
}
