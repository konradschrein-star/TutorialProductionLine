export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { musicLibrary } from "@repo/db/schema";
import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { getSession } from "@/app/(authenticated)/_lib/v2-auth";
import { writeFile, mkdir, unlink } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  validateUpload,
  interpretAudioProbe,
  storageFilename,
} from "./_lib/audio-file";
import { libraryDir, probeAudioFile } from "./_lib/probe";

/**
 * GET /api/music-library
 *
 * The global track list. Every format and channel draws from this one pool.
 *
 * Filters (all optional, AND-combined):
 *   q            free text over name/creator
 *   genre        exact genre
 *   creator      exact creator
 *   source       suno_ai33 | minimax_ai33 | upload | seed | unknown
 *   format       format tag the track was produced for
 *   mood         repeatable; matches when the track carries ANY of them
 *   tag          repeatable; same semantics
 *   minDuration  seconds
 *   maxDuration  seconds
 *   includeInactive  '1' to include retired tracks
 *   sort         name | created | duration   (default: created, newest first)
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;

    const conditions: SQL[] = [];

    if (sp.get("includeInactive") !== "1") {
      conditions.push(eq(musicLibrary.is_active, true));
    }

    const q = sp.get("q")?.trim();
    if (q) {
      conditions.push(
        sql`(${musicLibrary.name} ILIKE ${`%${q}%`} OR ${musicLibrary.creator} ILIKE ${`%${q}%`})`,
      );
    }

    const genre = sp.get("genre")?.trim();
    if (genre) conditions.push(eq(musicLibrary.genre, genre));

    const creator = sp.get("creator")?.trim();
    if (creator) conditions.push(eq(musicLibrary.creator, creator));

    const source = sp.get("source")?.trim();
    if (source) {
      // Compared as text; an unknown value simply matches nothing.
      conditions.push(sql`${musicLibrary.source} = ${source}`);
    }

    const format = sp.get("format")?.trim();
    if (format) conditions.push(eq(musicLibrary.format, format));

    const moods = sp.getAll("mood").filter(Boolean);
    if (moods.length > 0) {
      conditions.push(sql`${musicLibrary.mood} && ${moods}::text[]`);
    }

    const tags = sp.getAll("tag").filter(Boolean);
    if (tags.length > 0) {
      conditions.push(sql`${musicLibrary.tags} && ${tags}::text[]`);
    }

    const minDuration = Number.parseInt(sp.get("minDuration") ?? "", 10);
    if (Number.isFinite(minDuration)) {
      conditions.push(gte(musicLibrary.duration_seconds, minDuration));
    }
    const maxDuration = Number.parseInt(sp.get("maxDuration") ?? "", 10);
    if (Number.isFinite(maxDuration)) {
      conditions.push(lte(musicLibrary.duration_seconds, maxDuration));
    }

    const sort = sp.get("sort");
    const orderBy =
      sort === "name"
        ? asc(musicLibrary.name)
        : sort === "duration"
          ? desc(musicLibrary.duration_seconds)
          : desc(musicLibrary.created_at);

    const tracks = await db
      .select()
      .from(musicLibrary)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(orderBy);

    // Facets so the UI can build filter controls without a second round trip.
    const facets = {
      genres: distinct(tracks.map((t) => t.genre)),
      creators: distinct(tracks.map((t) => t.creator)),
      sources: distinct(tracks.map((t) => t.source)),
      formats: distinct(tracks.map((t) => t.format)),
      moods: distinct(tracks.flatMap((t) => t.mood ?? [])),
      tags: distinct(tracks.flatMap((t) => t.tags ?? [])),
    };

    return NextResponse.json({ tracks, facets, total: tracks.length });
  } catch (error) {
    console.error("[music-library] List error:", error);
    return NextResponse.json(
      { error: "Failed to fetch music library" },
      { status: 500 },
    );
  }
}

function distinct(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v))).sort();
}

/**
 * POST /api/music-library
 *
 * Upload a copyright-free track into the global library.
 *
 * The file is probed, not trusted: the extension is validated, then ffprobe
 * must confirm a real audio stream with a real duration. A file that fails
 * either check is deleted and the upload is rejected — we never store a row
 * whose duration was guessed, because a bad duration silently breaks the
 * music bed layout downstream.
 *
 * Fields: file, name, creator, license, source_url, attribution_required,
 *         attribution_text, genre, format, bpm, mood[], tags[]
 */
export async function POST(request: NextRequest) {
  let filePath: string | null = null;

  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No audio file was uploaded" },
        { status: 400 },
      );
    }

    const name = (formData.get("name") as string | null)?.trim();
    if (!name) {
      return NextResponse.json(
        { error: "Track name is required" },
        { status: 400 },
      );
    }

    const validation = validateUpload({
      filename: file.name,
      sizeBytes: file.size,
    });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const trackId = randomUUID();
    const dir = libraryDir();
    await mkdir(dir, { recursive: true });
    filePath = join(dir, storageFilename(trackId, validation.extension));

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // Probe the real bytes. This is the authoritative duration/format check.
    const probed = interpretAudioProbe(await probeAudioFile(filePath));
    if (!probed.ok) {
      await unlink(filePath).catch(() => {});
      filePath = null;
      return NextResponse.json({ error: probed.error }, { status: 400 });
    }

    const str = (k: string): string | null => {
      const v = formData.get(k);
      const s = typeof v === "string" ? v.trim() : "";
      return s.length > 0 ? s : null;
    };
    const list = (k: string): string[] => {
      const raw = formData.get(k);
      if (typeof raw !== "string" || !raw.trim()) return [];
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((v): v is string => typeof v === "string")
            .map((v) => v.trim())
            .filter(Boolean);
        }
      } catch {
        // Fall back to a comma-separated list.
      }
      return raw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    };

    const bpmRaw = Number.parseInt(str("bpm") ?? "", 10);

    const [track] = await db
      .insert(musicLibrary)
      .values({
        id: trackId,
        name,
        file_path: filePath,
        duration_seconds: probed.audio.durationSeconds,
        genre: str("genre"),
        format: str("format"),
        // The headline ask: remember who made it.
        creator: str("creator"),
        source: "upload",
        license: str("license"),
        source_url: str("source_url"),
        attribution_required: formData.get("attribution_required") === "true",
        attribution_text: str("attribution_text"),
        mood: list("mood"),
        tags: list("tags"),
        bpm: Number.isFinite(bpmRaw) ? bpmRaw : null,
        original_filename: file.name.slice(0, 255),
        file_bytes: file.size,
      })
      .returning();

    return NextResponse.json({ track, probe: probed.audio }, { status: 201 });
  } catch (error) {
    if (filePath) await unlink(filePath).catch(() => {});
    console.error("[music-library] Upload failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to upload track",
      },
      { status: 500 },
    );
  }
}
