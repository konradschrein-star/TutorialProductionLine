import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { sourceVideos, clipLibraries } from "@repo/db";
import {
  CreateSourceVideoPayloadSchema,
  buildRefBase,
  parseYoutubeId,
} from "@repo/contracts";
import type { CreateSourceVideoPayload } from "@repo/contracts";
import { createRedisConnection, createClipIngestQueue } from "@repo/queue";

export const dynamic = "force-dynamic";

/**
 * POST /api/clip-library/source-videos
 *
 * Programmatic ingest entry point. Same payload powers the Hub "Add Source
 * Video" form and any external automation. Discriminated on `source_kind`
 * so the server validates the structured identity fields required to build
 * `ref_base`. For youtube sources, `youtube_id` is auto-extracted from
 * `source_url` if not provided explicitly.
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

  const parseResult = CreateSourceVideoPayloadSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        details: parseResult.error.flatten(),
      },
      { status: 400 },
    );
  }

  const payload: CreateSourceVideoPayload = parseResult.data;

  // YouTube source can resolve location from youtube_id alone. If only a
  // URL was passed, lift the id out so the worker has both fields.
  let youtube_id: string | null = null;
  let source_url: string | null = null;
  let source_file_path: string | null = null;

  if (payload.source_kind === "youtube") {
    youtube_id = payload.youtube_id ?? null;
    source_url = payload.source_url ?? null;
    source_file_path = payload.source_file_path ?? null;

    if (!youtube_id && source_url) {
      youtube_id = parseYoutubeId(source_url);
      if (!youtube_id) {
        return NextResponse.json(
          {
            error:
              "Could not extract YouTube id from source_url — pass youtube_id explicitly",
          },
          { status: 400 },
        );
      }
    }

    if (!source_url && youtube_id) {
      source_url = `https://www.youtube.com/watch?v=${youtube_id}`;
    }
  } else {
    source_url = payload.source_url ?? null;
    source_file_path = payload.source_file_path ?? null;
  }

  // Verify library exists.
  const [library] = await db
    .select({ id: clipLibraries.id })
    .from(clipLibraries)
    .where(eq(clipLibraries.id, payload.library_id))
    .limit(1);

  if (!library) {
    return NextResponse.json({ error: "Library not found" }, { status: 404 });
  }

  // Compose ref_base up front so we reject malformed identity at the door
  // (not 5 minutes later when the worker reaches step 10).
  const refBaseSource = {
    source_kind: payload.source_kind,
    work_slug: "work_slug" in payload ? (payload.work_slug ?? null) : null,
    work_part: "work_part" in payload ? (payload.work_part ?? null) : null,
    season: "season" in payload ? (payload.season ?? null) : null,
    episode: "episode" in payload ? (payload.episode ?? null) : null,
    youtube_id,
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
    const [sourceVideo] = await db
      .insert(sourceVideos)
      .values({
        library_id: payload.library_id,
        source_kind: payload.source_kind,
        work_slug: refBaseSource.work_slug ?? null,
        work_title:
          "work_title" in payload ? (payload.work_title ?? null) : null,
        work_part: refBaseSource.work_part ?? null,
        season: refBaseSource.season ?? null,
        episode: refBaseSource.episode ?? null,
        youtube_id,
        external_provider: refBaseSource.external_provider ?? null,
        external_id: refBaseSource.external_id ?? null,
        ref_base: refBase,
        source_url,
        source_file_path,
        title: ("work_title" in payload ? payload.work_title : null) ?? null,
        ingest_status: "pending",
      })
      .returning();

    if (!sourceVideo) {
      throw new Error("Failed to create source_video row");
    }

    const redisUrl = process.env["REDIS_URL"];
    if (!redisUrl) {
      throw new Error("REDIS_URL environment variable not configured");
    }
    redis = createRedisConnection({ url: redisUrl, mode: "queue" });
    const queue = createClipIngestQueue(redis);

    await queue.add(
      "clip-ingest",
      { source_video_id: sourceVideo.id, library_id: payload.library_id },
      {
        jobId: sourceVideo.id,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    );

    return NextResponse.json(
      { id: sourceVideo.id, ref_base: refBase, status: "pending" },
      { status: 201 },
    );
  } catch (err) {
    console.error("POST /api/clip-library/source-videos error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  } finally {
    if (redis) {
      await redis.quit();
    }
  }
}
