import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { clips, clipLibraries } from "@repo/db";
import { searchClips } from "@repo/db/repositories";

export const dynamic = "force-dynamic";

const SearchBodySchema = z.object({
  query: z.string().min(1).max(1000),
  filters: z
    .object({
      shot_scale_preference: z.array(z.string()).optional(),
      avoid_audio_classes: z.array(z.string()).optional(),
      character_filter: z.array(z.string()).optional(),
      min_duration_ms: z.number().int().nonnegative().optional(),
      max_duration_ms: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .optional(),
});

const EMBED_SIDECAR_URL =
  process.env["EMBED_SIDECAR_URL"] ?? "http://localhost:8001";

/**
 * POST /api/clip-library/[libraryId]/search
 *
 * Semantic / hybrid search over clips.
 * Body: { query: string, filters?: {...} }
 * Response: { results: [{ clip, rrf_score, match_reason }] }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ libraryId: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { libraryId } = await params;
    if (!libraryId || !/^[0-9a-f-]{36}$/i.test(libraryId)) {
      return NextResponse.json(
        { error: "Invalid library ID" },
        { status: 400 },
      );
    }

    // Verify library exists
    const [library] = await db
      .select({ id: clipLibraries.id })
      .from(clipLibraries)
      .where(eq(clipLibraries.id, libraryId))
      .limit(1);

    if (!library) {
      return NextResponse.json({ error: "Library not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = SearchBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { query, filters = {} } = parsed.data;

    // Embed the query via sidecar
    let queryDense: number[] = [];
    let querySparse: { indices: number[]; values: number[] } = {
      indices: [],
      values: [],
    };

    try {
      const embedRes = await fetch(`${EMBED_SIDECAR_URL}/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: query }),
        signal: AbortSignal.timeout(10_000),
      });
      if (embedRes.ok) {
        const embedData = await embedRes.json();
        queryDense = embedData.dense ?? [];
        querySparse = embedData.sparse ?? { indices: [], values: [] };
      }
    } catch {
      // Sidecar unavailable — fallback to text-only search
    }

    // If no dense vector, return text-search-only results
    if (queryDense.length === 0) {
      // Simple text search fallback using ILIKE
      const { sql } = await import("drizzle-orm");
      const safeQuery = `%${query.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;

      const rows = await db
        .select()
        .from(clips)
        .where(
          and(
            eq(clips.library_id, libraryId),
            sql`(${clips.ai_description} ILIKE ${safeQuery} OR ${clips.transcript} ILIKE ${safeQuery})`,
          ),
        )
        .limit(filters.limit ?? 20);

      return NextResponse.json({
        results: rows.map((clip) => ({
          clip,
          rrf_score: 0,
          dense_rank: null,
          sparse_rank: null,
          text_rank: 1,
          match_reason: "text-fallback (sidecar unavailable)",
        })),
        query_mode: "text_fallback",
        total: rows.length,
      });
    }

    // Run hybrid search
    const searchResults = await searchClips(db, {
      library_id: libraryId,
      query_dense: queryDense,
      query_sparse: querySparse,
      query_text: query,
      limit: filters.limit ?? 20,
      shot_scale_preference: filters.shot_scale_preference ?? [],
      avoid_audio_classes: filters.avoid_audio_classes ?? [],
      character_filter: filters.character_filter ?? [],
      min_duration_ms: filters.min_duration_ms ?? 0,
      max_duration_ms: filters.max_duration_ms ?? 600_000,
    });

    if (searchResults.length === 0) {
      return NextResponse.json({ results: [], query_mode: "hybrid", total: 0 });
    }

    // Fetch full clip data for the results
    const clipIds = searchResults.map((r) => r.clip_id);
    const clipRows = await db
      .select()
      .from(clips)
      .where(inArray(clips.id, clipIds));

    const clipMap = new Map(clipRows.map((c) => [c.id, c]));

    const results = searchResults
      .map((r) => {
        const clip = clipMap.get(r.clip_id);
        if (!clip) return null;
        return {
          clip,
          rrf_score: r.rrf_score,
          dense_rank: r.dense_rank,
          sparse_rank: r.sparse_rank,
          text_rank: r.text_rank,
          match_reason: r.match_reason,
        };
      })
      .filter(Boolean);

    return NextResponse.json({
      results,
      query_mode: "hybrid",
      total: results.length,
    });
  } catch (error) {
    console.error("POST /api/clip-library/[libraryId]/search error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
