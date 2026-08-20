export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  musicAssignments,
  musicCollections,
  MUSIC_SELECTION_MODES,
} from "@repo/db/schema";
import type { MusicSelectionMode } from "@repo/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getSession } from "@/app/(authenticated)/_lib/v2-auth";

/**
 * GET /api/music-library/assignments
 *
 * Which collection a format/channel draws music from. Same shape as the
 * subtitle preset assignments, resolved most-specific-first:
 *   format + channel > channel > format > global default
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const assignments = await db
      .select({
        id: musicAssignments.id,
        collection_id: musicAssignments.collection_id,
        collection_name: musicCollections.name,
        format: musicAssignments.format,
        channel_id: musicAssignments.channel_id,
        is_active: musicAssignments.is_active,
        selection_mode: musicAssignments.selection_mode,
        volume_db: musicAssignments.volume_db,
        created_at: musicAssignments.created_at,
      })
      .from(musicAssignments)
      .innerJoin(
        musicCollections,
        eq(musicCollections.id, musicAssignments.collection_id),
      )
      .orderBy(asc(musicAssignments.format), asc(musicCollections.name));

    return NextResponse.json({ assignments });
  } catch (error) {
    console.error("[music-library/assignments] list error:", error);
    return NextResponse.json(
      { error: "Failed to list assignments" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/music-library/assignments
 *
 * Upsert the binding for a scope. Null format/channel mean "any"; both null
 * is the global default bed.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      collectionId?: string;
      format?: string | null;
      channelId?: string | null;
      selectionMode?: string;
      volumeDb?: number;
      isActive?: boolean;
    };

    const collectionId = body.collectionId?.trim();
    if (!collectionId) {
      return NextResponse.json(
        { error: "collectionId is required" },
        { status: 400 },
      );
    }

    const selectionMode = body.selectionMode ?? "random";
    if (!(MUSIC_SELECTION_MODES as readonly string[]).includes(selectionMode)) {
      return NextResponse.json(
        {
          error: `Invalid selectionMode "${selectionMode}". Expected one of: ${MUSIC_SELECTION_MODES.join(", ")}`,
        },
        { status: 400 },
      );
    }

    const volumeDb = body.volumeDb ?? -18;
    if (!Number.isFinite(volumeDb) || volumeDb > 0 || volumeDb < -60) {
      return NextResponse.json(
        { error: "volumeDb must be between -60 and 0" },
        { status: 400 },
      );
    }

    const [collection] = await db
      .select({ id: musicCollections.id })
      .from(musicCollections)
      .where(eq(musicCollections.id, collectionId));
    if (!collection) {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 404 },
      );
    }

    const format = body.format?.trim() || null;
    const channelId = body.channelId?.trim() || null;

    // One assignment per scope, enforced in the DB by the expression index
    // `uq_music_assignments_scope`. That index cannot be named as an
    // ON CONFLICT target (it is on COALESCE(...) expressions, not columns),
    // so the upsert is done explicitly: find the row for this exact scope,
    // then update it or insert a new one.
    const existing = await db
      .select({ id: musicAssignments.id })
      .from(musicAssignments)
      .where(
        and(
          format === null
            ? isNull(musicAssignments.format)
            : eq(musicAssignments.format, format),
          channelId === null
            ? isNull(musicAssignments.channel_id)
            : eq(musicAssignments.channel_id, channelId),
        ),
      );

    const values = {
      collection_id: collectionId,
      selection_mode: selectionMode as MusicSelectionMode,
      volume_db: volumeDb,
      is_active: body.isActive ?? true,
    };

    const current = existing[0];
    const [assignment] = current
      ? await db
          .update(musicAssignments)
          .set({ ...values, updated_at: new Date() })
          .where(eq(musicAssignments.id, current.id))
          .returning()
      : await db
          .insert(musicAssignments)
          .values({ ...values, format, channel_id: channelId })
          .returning();

    return NextResponse.json({ assignment }, { status: current ? 200 : 201 });
  } catch (error) {
    console.error("[music-library/assignments] upsert error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save the assignment",
      },
      { status: 500 },
    );
  }
}

/** DELETE /api/music-library/assignments?id=... */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const deleted = await db
      .delete(musicAssignments)
      .where(eq(musicAssignments.id, id))
      .returning({ id: musicAssignments.id });

    if (deleted.length === 0) {
      return NextResponse.json(
        { error: "Assignment not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[music-library/assignments] delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete assignment" },
      { status: 500 },
    );
  }
}
