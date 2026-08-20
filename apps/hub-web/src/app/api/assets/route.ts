import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { listAssets, createAsset } from "@/lib/repositories/asset-repository";
import { saveAsset } from "@/lib/services/local-storage-service";
import { z } from "zod";

// Zod schema for generation_recipe - must be an object, not primitive/array
const generationRecipeSchema = z.record(z.unknown());

export const dynamic = "force-dynamic";

/**
 * GET /api/assets
 *
 * List assets with optional filters.
 * Query params: asset_type, archetype_id, channel_id, format, status, character_id
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const assets = await listAssets({
    asset_type: searchParams.get("asset_type") ?? undefined,
    archetype_id: searchParams.get("archetype_id") ?? undefined,
    channel_id: searchParams.get("channel_id") ?? undefined,
    format: searchParams.get("format") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    character_id: searchParams.get("character_id") ?? undefined,
  });

  return NextResponse.json({ assets });
}

/**
 * POST /api/assets
 *
 * Upload a new asset. Saves file to SSD under LOCAL_MEDIA_ROOT/assets/{uuid}.{ext}
 *
 * FormData fields:
 *   - file: File (required)
 *   - name: string (required)
 *   - description: string (required)
 *   - asset_type: string (required)
 *   - origin: string (optional, default 'real')
 *   - archetype_id: string (optional)
 *   - channel_id: string (optional)
 *   - format: string (optional)
 *   - tags: string (optional, comma-separated)
 *   - background_removed: 'true'|'false' (optional)
 *   - quality_rating: string '1'-'5' (optional)
 *   - character_id: string (optional, for character_state assets)
 *   - status: string (optional, default 'draft')
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to parse form data: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    );
  }

  const file = formData.get("file") as File | null;
  const name = (formData.get("name") as string | null)?.trim();
  const description = (formData.get("description") as string | null)?.trim();
  const asset_type = (formData.get("asset_type") as string | null)?.trim();
  const origin = (formData.get("origin") as string | null)?.trim() ?? "real";
  const archetype_id =
    (formData.get("archetype_id") as string | null)?.trim() || null;
  const channel_id =
    (formData.get("channel_id") as string | null)?.trim() || null;
  const format = (formData.get("format") as string | null)?.trim() || null;
  const tagsRaw = (formData.get("tags") as string | null)?.trim() || "";
  const tags = tagsRaw
    ? tagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const background_removed = formData.get("background_removed") === "true";
  const quality_rating = formData.get("quality_rating")
    ? Number(formData.get("quality_rating"))
    : null;
  const character_id =
    (formData.get("character_id") as string | null)?.trim() || null;
  const status = (formData.get("status") as string | null)?.trim() ?? "draft";
  const generationRecipeRaw =
    (formData.get("generation_recipe") as string | null)?.trim() || null;

  let generation_recipe: Record<string, unknown> | null = null;
  if (generationRecipeRaw) {
    try {
      const parsed = JSON.parse(generationRecipeRaw);
      const validationResult = generationRecipeSchema.safeParse(parsed);

      if (!validationResult.success) {
        return NextResponse.json(
          {
            error: "generation_recipe must be a valid JSON object",
            details: validationResult.error.message,
          },
          { status: 400 },
        );
      }

      generation_recipe = validationResult.data;
    } catch (parseError) {
      return NextResponse.json(
        {
          error: "generation_recipe must be valid JSON",
          details:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
        },
        { status: 400 },
      );
    }
  }

  if (!file)
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!name)
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!description)
    return NextResponse.json(
      { error: "description is required" },
      { status: 400 },
    );
  if (!asset_type)
    return NextResponse.json(
      { error: "asset_type is required" },
      { status: 400 },
    );

  if (asset_type === "character_state") {
    const stateTagCount = tags.filter((t) => /^#state:.+$/.test(t)).length;
    if (stateTagCount !== 1) {
      return NextResponse.json(
        {
          error: `character_state assets must have exactly one #state:<name> tag; found ${stateTagCount}`,
        },
        { status: 400 },
      );
    }
  }

  if (file.size > 50 * 1024 * 1024) {
    return NextResponse.json(
      {
        error: `File too large: ${Math.round(file.size / 1024 / 1024)}MB (max 50MB)`,
      },
      { status: 413 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
    const assetUuid = randomUUID();

    const { filePath, fileName } = await saveAsset(
      asset_type,
      assetUuid,
      ext,
      buffer,
    );

    const asset = await createAsset({
      name,
      description,
      asset_type,
      origin,
      channel_id,
      archetype_id,
      format,
      tags,
      file_path: filePath,
      file_name: fileName,
      file_format: ext,
      width: null,
      height: null,
      size_bytes: file.size,
      background_removed,
      quality_rating:
        quality_rating && !isNaN(quality_rating) ? quality_rating : null,
      status,
      character_id,
      generation_recipe,
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create asset" },
      { status: 500 },
    );
  }
}
