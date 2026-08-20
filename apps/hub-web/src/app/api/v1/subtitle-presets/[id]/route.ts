import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  subtitlePresets,
  RemotionConfigSchema,
  FfmpegConfigSchema,
} from "@repo/db";
import { eq } from "drizzle-orm";
import { withApiAuth } from "../../_lib/auth";

export const dynamic = "force-dynamic";

/** Validate an incoming config against the engine-specific v2 schema. */
function validateConfig(engine: string, config: unknown) {
  const schema =
    engine === "ffmpeg" ? FfmpegConfigSchema : RemotionConfigSchema;
  return schema.safeParse(config);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [row] = await db
    .select()
    .from(subtitlePresets)
    .where(eq(subtitlePresets.id, id))
    .limit(1);

  if (!row || !row.is_active)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

async function handleUpdate(req: NextRequest, params: Promise<{ id: string }>) {
  return withApiAuth(req, async () => {
    const { id } = await params;

    const [existing] = await db
      .select()
      .from(subtitlePresets)
      .where(eq(subtitlePresets.id, id))
      .limit(1);

    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const { name, description, config, is_locked } = body as {
      name?: string;
      description?: string;
      config?: unknown;
      is_locked?: boolean;
    };

    // A lock-only request is always allowed — otherwise a locked preset could
    // never be unlocked. Any request that also changes content is refused while
    // the preset is locked.
    const changesContent =
      name !== undefined || description !== undefined || config !== undefined;
    if (existing.is_locked && changesContent) {
      return NextResponse.json(
        {
          error:
            "This preset is locked. Unlock it (lock button, top right) or clone it to customize.",
          locked: true,
        },
        { status: 403 },
      );
    }

    // Validate config (when present) against the engine's v2 schema.
    let validatedConfig: Record<string, unknown> | undefined;
    if (config !== undefined) {
      const result = validateConfig(existing.engine, config);
      if (!result.success) {
        return NextResponse.json(
          { error: "Invalid config", issues: result.error.issues },
          { status: 400 },
        );
      }
      validatedConfig = result.data as Record<string, unknown>;
    }

    const [updated] = await db
      .update(subtitlePresets)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(validatedConfig ? { config: validatedConfig } : {}),
        ...(typeof is_locked === "boolean" ? { is_locked } : {}),
        updated_at: new Date(),
      })
      .where(eq(subtitlePresets.id, id))
      .returning();

    return NextResponse.json(updated);
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleUpdate(req, params);
}

// Retained for backward compatibility; validates identically to PUT.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleUpdate(req, params);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiAuth(req, async () => {
    const { id } = await params;

    const [existing] = await db
      .select()
      .from(subtitlePresets)
      .where(eq(subtitlePresets.id, id))
      .limit(1);

    if (!existing)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.is_built_in) {
      return NextResponse.json(
        { error: "Cannot delete built-in preset" },
        { status: 403 },
      );
    }

    await db
      .update(subtitlePresets)
      .set({ is_active: false })
      .where(eq(subtitlePresets.id, id));

    return NextResponse.json({ ok: true });
  });
}
