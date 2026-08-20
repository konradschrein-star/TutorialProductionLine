export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  musicCollections,
  musicCollectionTracks,
  musicLibrary,
} from "@repo/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import { getSession } from "@/app/(authenticated)/_lib/v2-auth";

/**
 * GET /api/music-library/collections
 *
 * Named bundles of tracks. Collections are what get bound to a format or
 * channel, so a format gets variety rather than one repeated track.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const collections = await db
      .select({
        id: musicCollections.id,
        name: musicCollections.name,
        description: musicCollections.description,
        is_active: musicCollections.is_active,
        created_at: musicCollections.created_at,
        updated_at: musicCollections.updated_at,
        track_count: sql<number>`count(${musicCollectionTracks.track_id})::int`,
        total_seconds: sql<number>`coalesce(sum(${musicLibrary.duration_seconds}), 0)::int`,
      })
      .from(musicCollections)
      .leftJoin(
        musicCollectionTracks,
        eq(musicCollectionTracks.collection_id, musicCollections.id),
      )
      .leftJoin(
        musicLibrary,
        eq(musicLibrary.id, musicCollectionTracks.track_id),
      )
      .groupBy(musicCollections.id)
      .orderBy(asc(musicCollections.name));

    return NextResponse.json({ collections });
  } catch (error) {
    console.error("[music-library/collections] list error:", error);
    return NextResponse.json(
      { error: "Failed to list collections" },
      { status: 500 },
    );
  }
}

/** POST /api/music-library/collections — create a collection. */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      name?: string;
      description?: string;
      trackIds?: string[];
    };

    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json(
        { error: "Collection name is required" },
        { status: 400 },
      );
    }

    const [collection] = await db
      .insert(musicCollections)
      .values({ name, description: body.description?.trim() || null })
      .returning();

    if (!collection) {
      return NextResponse.json(
        { error: "Failed to create collection" },
        { status: 500 },
      );
    }

    const trackIds = (body.trackIds ?? []).filter(
      (id) => typeof id === "string" && id.length > 0,
    );
    if (trackIds.length > 0) {
      await db.insert(musicCollectionTracks).values(
        trackIds.map((track_id, i) => ({
          collection_id: collection.id,
          track_id,
          sort_order: i,
        })),
      );
    }

    return NextResponse.json({ collection }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("unique") || message.includes("duplicate")) {
      return NextResponse.json(
        { error: "A collection with that name already exists" },
        { status: 409 },
      );
    }
    console.error("[music-library/collections] create error:", error);
    return NextResponse.json(
      { error: "Failed to create collection" },
      { status: 500 },
    );
  }
}
