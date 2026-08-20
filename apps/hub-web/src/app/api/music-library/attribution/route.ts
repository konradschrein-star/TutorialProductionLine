export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { musicLibrary, musicCollectionTracks } from "@repo/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/app/(authenticated)/_lib/v2-auth";
import {
  buildAttributionReport,
  renderCreditsBlock,
  hasBlockingAttributionGaps,
} from "../_lib/attribution";

/**
 * POST /api/music-library/attribution
 *
 * Render the credits for a set of tracks — the thing that lets artist credits
 * be generated automatically instead of hand-written once operations scale.
 *
 * Body (one of):
 *   { trackIds: string[] }
 *   { collectionId: string }
 * Optional: { heading?: string, format?: 'json' | 'text' }
 *
 * The response separates three cases on purpose:
 *   lines           credits to publish
 *   unattributable  tracks that legally need a credit we cannot produce —
 *                   a publishing blocker, surfaced rather than swallowed
 *   skipped         tracks with nothing to credit (self-generated etc.)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      trackIds?: string[];
      collectionId?: string;
      heading?: string;
      format?: string;
    };

    const columns = {
      id: musicLibrary.id,
      name: musicLibrary.name,
      creator: musicLibrary.creator,
      source: musicLibrary.source,
      license: musicLibrary.license,
      source_url: musicLibrary.source_url,
      attribution_required: musicLibrary.attribution_required,
      attribution_text: musicLibrary.attribution_text,
    };

    let tracks;
    if (body.collectionId) {
      tracks = await db
        .select(columns)
        .from(musicCollectionTracks)
        .innerJoin(
          musicLibrary,
          eq(musicLibrary.id, musicCollectionTracks.track_id),
        )
        .where(eq(musicCollectionTracks.collection_id, body.collectionId));
    } else {
      const trackIds = (body.trackIds ?? []).filter(
        (id) => typeof id === "string" && id.length > 0,
      );
      if (trackIds.length === 0) {
        return NextResponse.json(
          { error: "Provide either trackIds or collectionId" },
          { status: 400 },
        );
      }
      tracks = await db
        .select(columns)
        .from(musicLibrary)
        .where(inArray(musicLibrary.id, trackIds));

      // Say so when an id did not resolve, rather than quietly crediting less.
      const found = new Set(tracks.map((t) => t.id));
      const missing = trackIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `Unknown track ids: ${missing.join(", ")}` },
          { status: 400 },
        );
      }
    }

    const report = buildAttributionReport(tracks);
    const text = renderCreditsBlock(report, { heading: body.heading });

    if (body.format === "text") {
      return new NextResponse(text, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return NextResponse.json({
      ...report,
      text,
      blocked: hasBlockingAttributionGaps(report),
      trackCount: tracks.length,
    });
  } catch (error) {
    console.error("[music-library/attribution] error:", error);
    return NextResponse.json(
      { error: "Failed to build the attribution report" },
      { status: 500 },
    );
  }
}
