import { NextResponse, type NextRequest } from "next/server";
import { unlink } from "node:fs/promises";
import { db } from "@/lib/db";
import { subtitleFonts } from "@repo/db";
import { eq } from "drizzle-orm";
import { withApiAuth } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiAuth(req, async () => {
    const { id } = await params;

    const [font] = await db
      .select()
      .from(subtitleFonts)
      .where(eq(subtitleFonts.id, id))
      .limit(1);

    if (!font)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Built-in (provisioned) fonts are part of the starter set — never deletable
    // via the API. Only user uploads can be removed.
    if (font.is_builtin) {
      return NextResponse.json(
        { error: "Built-in fonts cannot be deleted" },
        { status: 403 },
      );
    }

    // Delete file from disk (non-fatal if already gone)
    await unlink(font.file_path).catch(() => {});

    await db.delete(subtitleFonts).where(eq(subtitleFonts.id, id));

    return NextResponse.json({ ok: true });
  });
}
