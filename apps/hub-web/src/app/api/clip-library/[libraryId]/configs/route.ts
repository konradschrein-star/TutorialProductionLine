import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { clipLibraries, clipLibraryConfigs } from "@repo/db";
import { FormatPlaybookSchema } from "@repo/contracts";

export const dynamic = "force-dynamic";

const CreateConfigSchema = z.object({
  format: z.string().min(1),
  channel_id: z.string().uuid().nullable().optional(),
  clip_selection_enabled: z.boolean().default(false),
  hitl_clip_review: z.boolean().default(true),
  clips_per_sentence: z.number().int().min(1).max(5).default(1),
  min_gap_before_repeat: z.number().int().min(0).max(20).default(5),
  character_continuity: z.enum(["off", "soft", "strict"]).default("off"),
  broll_fallback_enabled: z.boolean().default(true),
  playbook: FormatPlaybookSchema,
});

/**
 * GET /api/clip-library/[libraryId]/configs
 *
 * Lists all clip_library_configs for this library.
 */
export async function GET(
  _req: NextRequest,
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

    const configs = await db
      .select()
      .from(clipLibraryConfigs)
      .where(eq(clipLibraryConfigs.clip_library_id, libraryId));

    return NextResponse.json({ configs });
  } catch (error) {
    console.error("GET /api/clip-library/[libraryId]/configs error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/clip-library/[libraryId]/configs
 *
 * Creates a new clip_library_config linking this library to a content format.
 * Returns the created config.
 */
export async function POST(
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

    const [library] = await db
      .select({ id: clipLibraries.id })
      .from(clipLibraries)
      .where(eq(clipLibraries.id, libraryId))
      .limit(1);

    if (!library) {
      return NextResponse.json({ error: "Library not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = CreateConfigSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const {
      format,
      channel_id,
      clip_selection_enabled,
      hitl_clip_review,
      clips_per_sentence,
      min_gap_before_repeat,
      character_continuity,
      broll_fallback_enabled,
      playbook,
    } = parsed.data;

    const [created] = await db
      .insert(clipLibraryConfigs)
      .values({
        format: format as any,
        channel_id: channel_id ?? null,
        clip_library_id: libraryId,
        clip_selection_enabled,
        hitl_clip_review,
        clips_per_sentence,
        min_gap_before_repeat,
        character_continuity,
        broll_fallback_enabled,
        playbook,
      })
      .returning();

    return NextResponse.json({ config: created }, { status: 201 });
  } catch (error) {
    console.error("POST /api/clip-library/[libraryId]/configs error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
