export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  musicAssignments,
  musicCollections,
  musicCollectionTracks,
  musicLibrary,
} from "@repo/db/schema";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/app/(authenticated)/_lib/v2-auth";
import { pickAssignment, selectTracks } from "../_lib/resolve";

/**
 * GET /api/music-library/resolve
 *
 * The one selection API every format uses to ask "what music should this job
 * use?". Callers pass their scope and how much music they need; the resolver
 * finds the most specific active assignment and picks tracks from its
 * collection.
 *
 * Query: format, channelId, targetSeconds (default 0)
 *
 * Contract notes, deliberate:
 *  - When nothing is assigned, this returns `assignment: null` and an empty
 *    track list. It does NOT quietly fall back to "any random track in the
 *    library" — a format silently getting the wrong music is exactly the class
 *    of bug the provider-fallback incident produced.
 *  - When the collection cannot cover `targetSeconds`, `short` is true and
 *    `missingSeconds` says by how much. Tracks are never repeated to disguise
 *    the shortfall; the caller decides whether to generate more or fail.
 *  - Tracks whose file is missing from disk are excluded and reported in
 *    `unavailableTrackIds`, so a dangling row is visible rather than fatal.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sp = request.nextUrl.searchParams;
    const format = sp.get("format")?.trim() || null;
    const channelId = sp.get("channelId")?.trim() || null;
    const targetRaw = Number.parseInt(sp.get("targetSeconds") ?? "0", 10);
    const targetSeconds =
      Number.isFinite(targetRaw) && targetRaw > 0 ? targetRaw : 0;

    const all = await db
      .select({
        id: musicAssignments.id,
        collection_id: musicAssignments.collection_id,
        format: musicAssignments.format,
        channel_id: musicAssignments.channel_id,
        is_active: musicAssignments.is_active,
        selection_mode: musicAssignments.selection_mode,
        volume_db: musicAssignments.volume_db,
      })
      .from(musicAssignments)
      .innerJoin(
        musicCollections,
        eq(musicCollections.id, musicAssignments.collection_id),
      )
      .where(eq(musicCollections.is_active, true));

    const assignment = pickAssignment(all, { format, channelId });

    if (!assignment) {
      return NextResponse.json({
        assignment: null,
        tracks: [],
        totalSeconds: 0,
        short: targetSeconds > 0,
        missingSeconds: targetSeconds,
        unavailableTrackIds: [],
        reason: `No music collection is assigned to format=${format ?? "*"}, channel=${channelId ?? "*"}, and no global default is set.`,
      });
    }

    const rows = await db
      .select({
        id: musicLibrary.id,
        name: musicLibrary.name,
        file_path: musicLibrary.file_path,
        duration_seconds: musicLibrary.duration_seconds,
        creator: musicLibrary.creator,
        source: musicLibrary.source,
        license: musicLibrary.license,
        source_url: musicLibrary.source_url,
        attribution_required: musicLibrary.attribution_required,
        attribution_text: musicLibrary.attribution_text,
        sort_order: musicCollectionTracks.sort_order,
      })
      .from(musicCollectionTracks)
      .innerJoin(
        musicLibrary,
        eq(musicLibrary.id, musicCollectionTracks.track_id),
      )
      .where(
        and(
          eq(musicCollectionTracks.collection_id, assignment.collection_id),
          eq(musicLibrary.is_active, true),
        ),
      );

    // Exclude rows whose audio is not actually on disk. This library contains
    // historical rows whose files were pruned; handing one to a renderer would
    // fail deep in ffmpeg instead of here.
    const { stat } = await import("fs/promises");
    const available: typeof rows = [];
    const unavailableTrackIds: string[] = [];
    for (const row of rows) {
      try {
        const s = await stat(row.file_path);
        if (s.isFile() && s.size > 0) available.push(row);
        else unavailableTrackIds.push(row.id);
      } catch {
        unavailableTrackIds.push(row.id);
      }
    }

    const selection = selectTracks({
      tracks: available.map((r) => ({
        id: r.id,
        duration_seconds: r.duration_seconds,
        sort_order: r.sort_order,
      })),
      targetSeconds,
      mode: assignment.selection_mode,
    });

    const byId = new Map(available.map((r) => [r.id, r]));

    return NextResponse.json({
      assignment: {
        id: assignment.id,
        collectionId: assignment.collection_id,
        format: assignment.format,
        channelId: assignment.channel_id,
        selectionMode: assignment.selection_mode,
        volumeDb: assignment.volume_db,
      },
      tracks: selection.tracks.map((t) => byId.get(t.id)).filter(Boolean),
      totalSeconds: selection.totalSeconds,
      short: selection.short,
      missingSeconds: Math.max(0, targetSeconds - selection.totalSeconds),
      unavailableTrackIds,
    });
  } catch (error) {
    console.error("[music-library/resolve] error:", error);
    return NextResponse.json(
      { error: "Failed to resolve music for this scope" },
      { status: 500 },
    );
  }
}
