import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { withApiAuth } from "../../../_lib/auth";
import { db } from "@/lib/db";
import { cfRawClips, cfSources } from "@repo/db";

export const dynamic = "force-dynamic";

interface WordTiming {
  w: string;
  t0: number;
  t1: number;
}

/**
 * GET /api/v1/clip-forge/raw-clips/:id
 *
 * Returns the clip + its source's portrait_crops + facecam_layout (so the
 * inspector can render hitbox overlays) + the slice of word_timings that
 * falls inside [start_sec, end_sec]. Front-end stays a thin renderer.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiAuth(req, async () => {
    const [clip] = await db
      .select()
      .from(cfRawClips)
      .where(eq(cfRawClips.id, id))
      .limit(1);
    if (!clip) {
      return new Response(JSON.stringify({ error: "clip not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const [source] = await db
      .select()
      .from(cfSources)
      .where(eq(cfSources.id, clip.source_id))
      .limit(1);

    const wordTimings = ((source?.word_timings ?? []) as WordTiming[]).filter(
      (w) => w.t0 >= clip.start_sec - 0.5 && w.t1 <= clip.end_sec + 0.5,
    );

    return {
      clip,
      source: source
        ? {
            id: source.id,
            title: source.title,
            resolution: source.resolution,
            duration_sec: source.duration_sec,
            portrait_crops: source.portrait_crops,
            facecam_layout: source.facecam_layout,
            source_url: source.source_url,
          }
        : null,
      word_timings: wordTimings,
    };
  });
}

/** Categories the DB enum accepts. Anything else is rejected outright. */
const CATEGORIES = [
  "wisdom",
  "funny",
  "controversial",
  "story",
  "educational",
  "hot_take",
  "hype",
  "insight",
  "reaction",
  "rant",
  "wholesome",
  "other",
] as const;

interface PatchBody {
  /**
   * "depool"  — reject the clip so it stops appearing as available supply.
   * "repool"  — undo a depool, putting it back to `ready`.
   */
  action?: "depool" | "repool";
  /** Replace the clip's category list (curation / mis-classification fix). */
  categories?: string[];
  /** Override the AI-suggested caption. */
  suggested_caption?: string;
}

/**
 * PATCH /api/v1/clip-forge/raw-clips/:id
 *
 * Curation actions for the Clip Pool. The pool screen shipped with `depool`,
 * `override category` and `re-classify` buttons that had no handlers at all —
 * they rendered, they were clickable, and nothing happened. Triaging 61 mined
 * clips down to the handful worth posting was therefore impossible from the
 * console. This is the write side those controls needed.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiAuth(req, async () => {
    const body = (await req.json().catch(() => ({}))) as PatchBody;

    const patch: Record<string, unknown> = {};
    if (body.action === "depool") patch.status = "rejected";
    if (body.action === "repool") patch.status = "ready";
    if (body.categories !== undefined) {
      const invalid = body.categories.filter(
        (c) => !(CATEGORIES as readonly string[]).includes(c),
      );
      if (invalid.length > 0) {
        return new Response(
          JSON.stringify({
            error: `unknown categories: ${invalid.join(", ")}`,
            allowed: CATEGORIES,
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      patch.categories = body.categories;
    }
    if (body.suggested_caption !== undefined) {
      patch.suggested_caption = body.suggested_caption;
    }

    if (Object.keys(patch).length === 0) {
      return new Response(JSON.stringify({ error: "nothing to update" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const [clip] = await db
      .update(cfRawClips)
      .set(patch)
      .where(eq(cfRawClips.id, id))
      .returning();
    if (!clip) {
      return new Response(JSON.stringify({ error: "clip not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return { clip };
  });
}
