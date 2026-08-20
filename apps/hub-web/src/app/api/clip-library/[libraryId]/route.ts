import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { clipLibraries } from "@repo/db";

export const dynamic = "force-dynamic";

const PatchBodySchema = z.object({
  tag_vocabulary: z.record(z.array(z.string())).optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().optional(),
  is_active: z.boolean().optional(),
});

/**
 * PATCH /api/clip-library/[libraryId]
 *
 * Update library settings (tag_vocabulary, name, description, is_active).
 * Returns the updated library record.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ libraryId: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { libraryId } = await params;
    if (!libraryId || !/^[0-9a-f-]{36}$/i.test(libraryId)) {
      return NextResponse.json(
        { error: "Invalid library ID" },
        { status: 400 },
      );
    }

    // Verify library exists
    const [existing] = await db
      .select()
      .from(clipLibraries)
      .where(eq(clipLibraries.id, libraryId))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Library not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = PatchBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { tag_vocabulary, name, description, is_active } = parsed.data;

    // Build update payload (only set provided fields)
    const updateData: Record<string, unknown> = { updated_at: new Date() };
    if (tag_vocabulary !== undefined)
      updateData.tag_vocabulary = tag_vocabulary;
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (is_active !== undefined) updateData.is_active = is_active;

    await db
      .update(clipLibraries)
      .set(updateData)
      .where(eq(clipLibraries.id, libraryId));

    const [updated] = await db
      .select()
      .from(clipLibraries)
      .where(eq(clipLibraries.id, libraryId))
      .limit(1);

    return NextResponse.json({ library: updated });
  } catch (error) {
    console.error("PATCH /api/clip-library/[libraryId] error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
