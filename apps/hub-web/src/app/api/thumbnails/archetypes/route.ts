export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  listArchetypes,
  createArchetype,
} from "@/lib/repositories/thumbnail-studio-repository";
import type { NewThumbnailArchetype } from "@repo/db";

/**
 * GET  /api/thumbnails/archetypes?scope=all|global|<channelId>&activeOnly=true
 * POST /api/thumbnails/archetypes
 *
 * Archetypes are GLOBAL by default: `channel_id` NULL means every channel can
 * use it. `scope=<channelId>` returns that channel's own archetypes PLUS all
 * global ones — never channel-owned alone — because that is the pool the
 * generator actually draws from.
 */

const ASPECTS = ["16:9", "9:16", "1:1"] as const;
const RESOLUTIONS = ["1k", "2k", "4k"] as const;

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  /** null / omitted = global. */
  channel_id: z.string().uuid().nullable().optional(),
  description: z.string().max(2000).optional(),
  reference_image_path: z.string().min(1),
  extra_reference_paths: z.array(z.string()).max(6).optional(),
  layout_instructions: z.string().max(4000).optional(),
  base_prompt: z.string().max(4000).optional(),
  features_logo: z.boolean().optional(),
  category: z.string().max(80).optional(),
  /** Empty = no format restriction. */
  formats: z.array(z.string()).default([]),
  aspect_ratio: z.enum(ASPECTS).default("16:9"),
  resolution: z.enum(RESOLUTIONS).default("1k"),
  is_active: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  // Read-only listing. `manage:thumbnails` needs it to offer the uploader a
  // different reference style; creating/editing archetypes still needs
  // edit:settings (see POST below).
  if (
    !session ||
    (!hasPermission(session, "view:settings") &&
      !hasPermission(session, "manage:thumbnails"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const scope = req.nextUrl.searchParams.get("scope") ?? "all";
  const activeOnly = req.nextUrl.searchParams.get("activeOnly") === "true";

  const archetypes = await listArchetypes({ scope, activeOnly });
  return NextResponse.json({ archetypes });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  try {
    const archetype = await createArchetype(
      parsed.data as NewThumbnailArchetype,
    );
    return NextResponse.json({ archetype }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to create archetype",
      },
      { status: 500 },
    );
  }
}
