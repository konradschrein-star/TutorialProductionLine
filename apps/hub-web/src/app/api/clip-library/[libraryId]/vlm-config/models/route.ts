import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { clipLibraries } from "@repo/db";

export const dynamic = "force-dynamic";

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

    const cfg = lib.vlm_labeling_config;
    if (!cfg?.lm_studio_url) {
      return NextResponse.json({
        models: [],
        error: "LM Studio URL not configured",
      });
    }

    const url = `${cfg.lm_studio_url.replace(/\/$/, "")}/v1/models`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${cfg.lm_studio_token ?? ""}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return NextResponse.json({
          models: [],
          error: `LM Studio returned ${res.status}`,
        });
      }

      const data = (await res.json()) as { data?: { id: string }[] };
      const models = (data.data ?? []).map((m) => m.id).filter(Boolean);
      return NextResponse.json({ models });
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : "Connection failed";
      return NextResponse.json({ models: [], error: msg });
    }
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
