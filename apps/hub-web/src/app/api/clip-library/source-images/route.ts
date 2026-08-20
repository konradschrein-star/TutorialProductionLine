import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { sourceImages, clipLibraries } from "@repo/db";
import { CreateSourceImagePayloadSchema, buildRefBase } from "@repo/contracts";
import type { CreateSourceImagePayload } from "@repo/contracts";
import { createRedisConnection, createImageIngestQueue } from "@repo/queue";

export const dynamic = "force-dynamic";

/**
 * POST /api/clip-library/source-images
 *
 * Programmatic image ingest entry point. Same payload powers the Hub
 * "Add Source Image" form and any external scraper. Discriminated on
 * `source_kind` so the server validates the structured identity required
 * to build `ref_base`. For source_kind='stock' + external_provider='pexels',
 * the worker resolves the download URL via the Pexels API.
 *
 * Returns: { id, ref_base, status: 'pending' }
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:job")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    );
  }

  const parseResult = CreateSourceImagePayloadSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parseResult.error.flatten() },
      { status: 400 },
    );
  }
  const payload: CreateSourceImagePayload = parseResult.data;

  const [library] = await db
    .select({ id: clipLibraries.id })
    .from(clipLibraries)
    .where(eq(clipLibraries.id, payload.library_id))
    .limit(1);
  if (!library) {
    return NextResponse.json({ error: "Library not found" }, { status: 404 });
  }

  // Pre-flight ref_base so we reject malformed identity at the door rather
  // than 30 s later in the worker. Images carry a leaner identity set
  // (no season/episode/youtube_id/work_part) — fill nulls explicitly.
  const refBaseSource = {
    source_kind: payload.source_kind,
    work_slug: "work_slug" in payload ? (payload.work_slug ?? null) : null,
    work_part: null,
    season: "season" in payload ? (payload.season ?? null) : null,
    episode: "episode" in payload ? (payload.episode ?? null) : null,
    youtube_id: null,
    external_provider:
      "external_provider" in payload
        ? (payload.external_provider ?? null)
        : null,
    external_id:
      "external_id" in payload ? (payload.external_id ?? null) : null,
  };

  let refBase: string;
  try {
    refBase = buildRefBase(refBaseSource);
  } catch (err) {
    return NextResponse.json(
      {
        error: `Cannot build ref_base: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    );
  }

  let redis: ReturnType<typeof createRedisConnection> | undefined;
  try {
    const [sourceImage] = await db
      .insert(sourceImages)
      .values({
        library_id: payload.library_id,
        source_kind: payload.source_kind,
        work_slug: refBaseSource.work_slug ?? null,
        work_title:
          "work_title" in payload ? (payload.work_title ?? null) : null,
        external_provider: refBaseSource.external_provider ?? null,
        external_id: refBaseSource.external_id ?? null,
        ref_base: refBase,
        source_url:
          "source_url" in payload ? (payload.source_url ?? null) : null,
        source_file_path:
          "source_file_path" in payload
            ? (payload.source_file_path ?? null)
            : null,
        ingest_status: "pending",
      })
      .returning();

    if (!sourceImage) {
      throw new Error("Failed to create source_image row");
    }

    const redisUrl = process.env["REDIS_URL"];
    if (!redisUrl) {
      throw new Error("REDIS_URL environment variable not configured");
    }
    redis = createRedisConnection({ url: redisUrl, mode: "queue" });
    const queue = createImageIngestQueue(redis);

    await queue.add(
      "image-ingest",
      { source_image_id: sourceImage.id, library_id: payload.library_id },
      {
        jobId: sourceImage.id,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    );

    return NextResponse.json(
      { id: sourceImage.id, ref_base: refBase, status: "pending" },
      { status: 201 },
    );
  } catch (err) {
    console.error("POST /api/clip-library/source-images error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  } finally {
    if (redis) await redis.quit();
  }
}
