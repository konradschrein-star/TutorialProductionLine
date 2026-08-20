import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import {
  createCfFinishingRenderQueue,
  createRedisConnection,
} from "@repo/queue";
import { withApiAuth } from "../../../_lib/auth";
import { db } from "@/lib/db";
import { cfFinishingVariants } from "@repo/db";
import { getHubConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/clip-forge/variants/:id
 *   Returns the single variant row. Used by the Studio screen to hydrate
 *   its recipe form before edits.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiAuth(_req, async () => {
    const [variant] = await db
      .select()
      .from(cfFinishingVariants)
      .where(eq(cfFinishingVariants.id, id))
      .limit(1);
    if (!variant) {
      return new Response(JSON.stringify({ error: "variant not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return { variant };
  });
}

/**
 * PATCH /api/v1/clip-forge/variants/:id
 *   Body: { caption_text?, subtitle_style_id?, caption_style_id?,
 *           layout_preset?, layout_options? }
 *   Updates the variant row in place (only the fields provided) and enqueues
 *   a cf-finishing-render job so the worker re-renders the MP4 with the new
 *   fields. An empty body is the "just re-render with current fields" path
 *   used by the Inspector's ↻ button.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiAuth(req, async () => {
    const body = (await req.json().catch(() => ({}))) as {
      caption_text?: string;
      subtitle_style_id?: string;
      caption_style_id?: string;
      layout_preset?: "fullscreen" | "zones";
      layout_options?: Record<string, unknown>;
    };

    const patch: Record<string, unknown> = {};
    if (body.caption_text !== undefined) patch.caption_text = body.caption_text;
    if (body.subtitle_style_id !== undefined)
      patch.subtitle_style_id = body.subtitle_style_id;
    if (body.caption_style_id !== undefined)
      patch.caption_style_id = body.caption_style_id;
    if (body.layout_preset !== undefined)
      patch.layout_preset = body.layout_preset;
    if (body.layout_options !== undefined)
      patch.layout_options = body.layout_options;

    let updated;
    if (Object.keys(patch).length === 0) {
      // Pure re-render: confirm the row exists, skip the no-op UPDATE.
      [updated] = await db
        .select()
        .from(cfFinishingVariants)
        .where(eq(cfFinishingVariants.id, id))
        .limit(1);
    } else {
      [updated] = await db
        .update(cfFinishingVariants)
        .set(patch)
        .where(eq(cfFinishingVariants.id, id))
        .returning();
    }

    if (!updated) {
      return new Response(JSON.stringify({ error: "variant not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Enqueue a finishing-render job so the worker rebuilds the MP4 with
    // the new settings. Studio's "Save" action lands here.
    const cfg = getHubConfig();
    const conn = createRedisConnection({ url: cfg.REDIS_URL, mode: "queue" });
    try {
      const queue = createCfFinishingRenderQueue(conn);
      await queue.add("cf-finishing-render", { variant_id: id });
      await queue.close();
    } finally {
      await conn.quit().catch(() => {});
    }

    return { variant: updated, queued: true };
  });
}
