export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  musicCollections,
  musicCollectionTracks,
  musicLibrary,
} from "@repo/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import { getSession } from "@/app/(authenticated)/_lib/v2-auth";

/** GET /api/music-library/collections/[id] — collection with its tracks. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const [collection] = await db
      .select()
      .from(musicCollections)
      .where(eq(musicCollections.id, id));

    if (!collection) {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 404 },
      );
    }

    const tracks = await db
      .select({
        track: musicLibrary,
        sort_order: musicCollectionTracks.sort_order,
      })
      .from(musicCollectionTracks)
      .innerJoin(
        musicLibrary,
        eq(musicLibrary.id, musicCollectionTracks.track_id),
      )
      .where(eq(musicCollectionTracks.collection_id, id))
      .orderBy(asc(musicCollectionTracks.sort_order), asc(musicLibrary.name));

    return NextResponse.json({ collection, tracks });
  } catch (error) {
    console.error("[music-library/collections] detail error:", error);
    return NextResponse.json(
      { error: "Failed to load collection" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/music-library/collections/[id]
 *
 * Rename/describe/activate, and set membership. `trackIds`, when supplied,
 * replaces the membership wholesale and defines the sequential order.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = (await request.json()) as {
      name?: string;
      description?: string | null;
      is_active?: boolean;
      trackIds?: string[];
    };

    const updates: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) {
      updates.name = body.name.trim();
    }
    if (body.description !== undefined) {
      updates.description =
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim()
          : null;
    }
    if (typeof body.is_active === "boolean") {
      updates.is_active = body.is_active;
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date();
      const [updated] = await db
        .update(musicCollections)
        .set(updates)
        .where(eq(musicCollections.id, id))
        .returning();
      if (!updated) {
        return NextResponse.json(
          { error: "Collection not found" },
          { status: 404 },
        );
      }
    }

    if (Array.isArray(body.trackIds)) {
      const trackIds = body.trackIds.filter(
        (t) => typeof t === "string" && t.length > 0,
      );

      // Reject unknown ids explicitly rather than silently dropping them —
      // a half-applied membership change is worse than a rejected one.
      if (trackIds.length > 0) {
        const found = await db
          .select({ id: musicLibrary.id })
          .from(musicLibrary)
          .where(inArray(musicLibrary.id, trackIds));
        const foundIds = new Set(found.map((f) => f.id));
        const missing = trackIds.filter((t) => !foundIds.has(t));
        if (missing.length > 0) {
          return NextResponse.json(
            { error: `Unknown track ids: ${missing.join(", ")}` },
            { status: 400 },
          );
        }
      }

      await db
        .delete(musicCollectionTracks)
        .where(eq(musicCollectionTracks.collection_id, id));

      if (trackIds.length > 0) {
        await db.insert(musicCollectionTracks).values(
          trackIds.map((track_id, i) => ({
            collection_id: id,
            track_id,
            sort_order: i,
          })),
        );
      }
    }

    const [collection] = await db
      .select()
      .from(musicCollections)
      .where(eq(musicCollections.id, id));

    if (!collection) {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ collection });
  } catch (error) {
    console.error("[music-library/collections] update error:", error);
    return NextResponse.json(
      { error: "Failed to update collection" },
      { status: 500 },
    );
  }
}

/** DELETE /api/music-library/collections/[id] — tracks themselves are kept. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const deleted = await db
      .delete(musicCollections)
      .where(eq(musicCollections.id, id))
      .returning({ id: musicCollections.id });

    if (deleted.length === 0) {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[music-library/collections] delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete collection" },
      { status: 500 },
    );
  }
}
