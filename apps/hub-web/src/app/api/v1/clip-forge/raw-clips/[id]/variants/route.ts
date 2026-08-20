import type { NextRequest } from "next/server";
import { desc, eq, max } from "drizzle-orm";
import {
  createCfFinishingRenderQueue,
  createRedisConnection,
} from "@repo/queue";
import { withApiAuth } from "../../../../_lib/auth";
import { db } from "@/lib/db";
import { cfFinishingVariants, cfRawClips } from "@repo/db";
import { getHubConfig } from "@/lib/config";
import { statArtifacts } from "../../../_lib/artifacts";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/clip-forge/raw-clips/:id/variants
 *      Lists every cf_finishing_variants row that belongs to the clip,
 *      newest first. Used by Inspector to render the per-clip variant grid.
 *
 *      Each row carries `rendered_mp4_present` — a real filesystem check, not
 *      a `rendered_mp4_key != null` guess. The Inspector previously treated a
 *      populated key as "rendered" and showed a dead <video> for every clip
 *      whose file had been deleted.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiAuth(req, async () => {
    const rows = await db
      .select()
      .from(cfFinishingVariants)
      .where(eq(cfFinishingVariants.raw_clip_id, id))
      .orderBy(desc(cfFinishingVariants.created_at));
    const artifacts = await statArtifacts(rows.map((v) => v.rendered_mp4_key));
    const variants = rows.map((v) => ({
      ...v,
      rendered_mp4_present: !!(
        v.rendered_mp4_key && artifacts.get(v.rendered_mp4_key)?.present
      ),
      rendered_mp4_size_bytes: v.rendered_mp4_key
        ? (artifacts.get(v.rendered_mp4_key)?.size_bytes ?? null)
        : null,
    }));
    return { variants };
  });
}

interface CreateVariantBody {
  platform?: "tiktok" | "instagram" | "youtube_shorts";
  layout_preset?: "fullscreen" | "zones";
  subtitle_style_id?: string;
  caption_style_id?: string;
  caption_text?: string;
  layout_options?: Record<string, unknown>;
}

/**
 * POST /api/v1/clip-forge/raw-clips/:id/variants
 *
 *   Creates a new finishing variant for the clip with the requested recipe
 *   (or sensible defaults) and immediately enqueues a cf-finishing-render
 *   job so the worker produces the MP4. The Inspector's "Make new variant"
 *   action lands here.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiAuth(req, async () => {
    const body = (await req.json().catch(() => ({}))) as CreateVariantBody;

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

    // Stable monotonic seed per clip so re-renders don't collide when there
    // are already variants.
    const [seedAgg] = await db
      .select({ max_seed: max(cfFinishingVariants.variant_seed) })
      .from(cfFinishingVariants)
      .where(eq(cfFinishingVariants.raw_clip_id, id));
    const nextSeed = (seedAgg?.max_seed ?? 0) + 1;

    const platform = body.platform ?? "tiktok";
    const layoutPreset = body.layout_preset ?? "fullscreen";
    const subtitleStyleId = body.subtitle_style_id ?? "komika-yellow";
    const captionStyleId = body.caption_style_id ?? "white-pill-black";
    const layoutOptions = body.layout_options ?? { fullscreenFit: "auto" };

    const [variant] = await db
      .insert(cfFinishingVariants)
      .values({
        raw_clip_id: id,
        platform,
        variant_seed: nextSeed,
        layout_preset: layoutPreset,
        subtitle_style_id: subtitleStyleId,
        caption_style_id: captionStyleId,
        layout_options: layoutOptions,
        caption_text: body.caption_text ?? clip.suggested_caption ?? null,
        subtitle_style: {},
      })
      .returning();

    const cfg = getHubConfig();
    const conn = createRedisConnection({ url: cfg.REDIS_URL, mode: "queue" });
    try {
      const queue = createCfFinishingRenderQueue(conn);
      await queue.add("cf-finishing-render", { variant_id: variant.id });
      await queue.close();
    } finally {
      await conn.quit().catch(() => {});
    }

    return { variant, queued: true };
  });
}
