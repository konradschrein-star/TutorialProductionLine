import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { clipLibraries } from "@repo/db";

export const dynamic = "force-dynamic";

const CreateBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  clip_storage_strategy: z.enum(["inline", "materialized"]).default("inline"),
});

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = CreateBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const { name, description, clip_storage_strategy } = parsed.data;
    const baseSlug = toSlug(name);

    // Ensure slug uniqueness by appending a timestamp if needed
    const existing = await db
      .select({ slug: clipLibraries.slug })
      .from(clipLibraries);
    const slugSet = new Set(existing.map((r) => r.slug));
    let slug = baseSlug;
    if (slugSet.has(slug)) {
      slug = `${baseSlug}-${Date.now()}`;
    }

    const [library] = await db
      .insert(clipLibraries)
      .values({ name, slug, description, clip_storage_strategy })
      .returning();

    return NextResponse.json({ library }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/clip-library]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
