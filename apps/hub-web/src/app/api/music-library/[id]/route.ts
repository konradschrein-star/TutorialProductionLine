export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { musicLibrary, MUSIC_SOURCES } from "@repo/db/schema";
import type { MusicSource } from "@repo/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/app/(authenticated)/_lib/v2-auth";
import { unlink, stat } from "fs/promises";

/**
 * GET /api/music-library/[id]
 * Full detail for one track, including whether its file is actually present.
 */
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
    const [track] = await db
      .select()
      .from(musicLibrary)
      .where(eq(musicLibrary.id, id));

    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    // Surface a dangling row rather than letting it look playable. The library
    // currently contains rows whose audio was pruned from disk long ago.
    let fileExists = false;
    let fileBytes: number | null = null;
    try {
      const s = await stat(track.file_path);
      fileExists = s.isFile();
      fileBytes = s.size;
    } catch {
      fileExists = false;
    }

    return NextResponse.json({ track, fileExists, fileBytes });
  } catch (error) {
    console.error("[music-library] Detail error:", error);
    return NextResponse.json(
      { error: "Failed to load track" },
      { status: 500 },
    );
  }
}

/** Fields an operator is allowed to edit after upload. */
interface PatchBody {
  name?: string;
  creator?: string | null;
  source?: string;
  license?: string | null;
  source_url?: string | null;
  attribution_required?: boolean;
  attribution_text?: string | null;
  genre?: string | null;
  format?: string | null;
  mood?: string[];
  tags?: string[];
  bpm?: number | null;
  is_active?: boolean;
}

/**
 * PATCH /api/music-library/[id]
 *
 * Edit track metadata — above all `creator`, which is the field that lets us
 * credit artists automatically later. Immutable by design: id, file_path,
 * duration_seconds (probed from the file, not an opinion), and the generation
 * provenance columns.
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
    const body = (await request.json()) as PatchBody;

    const updates: Record<string, unknown> = {};

    const setText = (key: keyof PatchBody, column: string) => {
      if (!(key in body)) return;
      const v = body[key];
      if (v === null) {
        updates[column] = null;
      } else if (typeof v === "string") {
        const t = v.trim();
        updates[column] = t.length > 0 ? t : null;
      }
    };

    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json(
          { error: "Track name cannot be empty" },
          { status: 400 },
        );
      }
      updates.name = name;
    }

    setText("creator", "creator");
    setText("license", "license");
    setText("source_url", "source_url");
    setText("attribution_text", "attribution_text");
    setText("genre", "genre");
    setText("format", "format");

    if (body.source !== undefined) {
      if (!(MUSIC_SOURCES as readonly string[]).includes(body.source)) {
        return NextResponse.json(
          {
            error: `Invalid source "${body.source}". Expected one of: ${MUSIC_SOURCES.join(", ")}`,
          },
          { status: 400 },
        );
      }
      updates.source = body.source as MusicSource;
    }

    if (typeof body.attribution_required === "boolean") {
      updates.attribution_required = body.attribution_required;
    }
    if (typeof body.is_active === "boolean") {
      updates.is_active = body.is_active;
    }
    if (Array.isArray(body.mood)) {
      updates.mood = body.mood.map((m) => String(m).trim()).filter(Boolean);
    }
    if (Array.isArray(body.tags)) {
      updates.tags = body.tags.map((t) => String(t).trim()).filter(Boolean);
    }
    if (body.bpm === null) {
      updates.bpm = null;
    } else if (typeof body.bpm === "number" && Number.isFinite(body.bpm)) {
      updates.bpm = Math.round(body.bpm);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No editable fields supplied" },
        { status: 400 },
      );
    }
    updates.updated_at = new Date();

    const [track] = await db
      .update(musicLibrary)
      .set(updates)
      .where(eq(musicLibrary.id, id))
      .returning();

    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    return NextResponse.json({ track });
  } catch (error) {
    console.error("[music-library] Update failed:", error);
    return NextResponse.json(
      { error: "Failed to update track" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/music-library/[id]
 *
 * Removes the row and its file. Pass ?soft=1 to retire the track instead —
 * safer when the track may already be referenced by a published video, since
 * the attribution export still needs to be able to name it.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const [track] = await db
      .select()
      .from(musicLibrary)
      .where(eq(musicLibrary.id, id));

    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    if (request.nextUrl.searchParams.get("soft") === "1") {
      const [updated] = await db
        .update(musicLibrary)
        .set({ is_active: false, updated_at: new Date() })
        .where(eq(musicLibrary.id, id))
        .returning();
      return NextResponse.json({ success: true, track: updated });
    }

    // Report file removal honestly instead of swallowing the failure — an
    // orphaned file on disk is worth knowing about.
    let fileDeleted = true;
    let fileError: string | null = null;
    try {
      await unlink(track.file_path);
    } catch (error) {
      fileDeleted = false;
      fileError = error instanceof Error ? error.message : String(error);
    }

    await db.delete(musicLibrary).where(eq(musicLibrary.id, id));

    return NextResponse.json({ success: true, fileDeleted, fileError });
  } catch (error) {
    console.error("[music-library] Delete failed:", error);
    return NextResponse.json(
      { error: "Failed to delete track" },
      { status: 500 },
    );
  }
}
