import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { clipLibraries } from "@repo/db";

export const dynamic = "force-dynamic";

const VlmConfigSchema = z.object({
  enabled: z.boolean(),
  lm_studio_url: z.string(),
  lm_studio_token: z.string(),
  lm_studio_model: z.string(),
  concurrency: z.number().int().min(1).max(4).default(1),
  vps_host: z.string().default("65.108.6.149"),
  vps_user: z.string().default("root"),
  ssh_key_path: z.string().default("~/.ssh/content-forge-key"),
  vps_media_root: z.string().default("/opt/content-forge/media"),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ libraryId: string }> },
) {
  try {
    const session = await getSession();
    if (!session)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { libraryId } = await params;
    const [lib] = await db
      .select({ vlm_labeling_config: clipLibraries.vlm_labeling_config })
      .from(clipLibraries)
      .where(eq(clipLibraries.id, libraryId))
      .limit(1);

    if (!lib)
      return NextResponse.json({ error: "Library not found" }, { status: 404 });

    return NextResponse.json({ config: lib.vlm_labeling_config });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ libraryId: string }> },
) {
  try {
    const session = await getSession();
    if (!session)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { libraryId } = await params;
    const body = await req.json();
    const parsed = VlmConfigSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid config", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    await db
      .update(clipLibraries)
      .set({ vlm_labeling_config: parsed.data as any, updated_at: new Date() })
      .where(eq(clipLibraries.id, libraryId));

    return NextResponse.json({ config: parsed.data });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
