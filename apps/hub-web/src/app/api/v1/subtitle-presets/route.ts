import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { subtitlePresets } from "@repo/db";
import { RemotionConfigSchema, FfmpegConfigSchema } from "@repo/db/subtitles";
import { eq, and, asc } from "drizzle-orm";
import { withApiAuth } from "../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const engine = searchParams.get("engine");

  const conditions = [eq(subtitlePresets.is_active, true)];
  if (engine) conditions.push(eq(subtitlePresets.engine, engine));

  const rows = await db
    .select()
    .from(subtitlePresets)
    .where(and(...conditions))
    .orderBy(asc(subtitlePresets.name));

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  return withApiAuth(req, async () => {
    const body = await req.json();
    const { name, description, engine, config } = body as {
      name?: string;
      description?: string;
      engine?: string;
      config?: Record<string, unknown>;
    };

    if (!name || !engine || !config) {
      return NextResponse.json(
        { error: "name, engine, config required" },
        { status: 400 },
      );
    }
    if (engine !== "remotion" && engine !== "ffmpeg") {
      return NextResponse.json(
        { error: "engine must be remotion or ffmpeg" },
        { status: 400 },
      );
    }

    // Validate against the engine's schema BEFORE storing. Without this an
    // invalid config is persisted happily and only blows up later, inside the
    // renderer's strict resolver, on whatever job first used the preset. The
    // PUT/PATCH route has always validated; POST did not.
    const schema =
      engine === "ffmpeg" ? FfmpegConfigSchema : RemotionConfigSchema;
    const parsed = schema.safeParse(config);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid config", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const [row] = await db
      .insert(subtitlePresets)
      .values({
        name,
        description,
        engine,
        config: parsed.data,
        is_built_in: false,
      })
      .returning();

    return NextResponse.json(row, { status: 201 });
  });
}
