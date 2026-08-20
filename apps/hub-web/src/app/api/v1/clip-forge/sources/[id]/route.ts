import type { NextRequest } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";
import { withApiAuth } from "../../../_lib/auth";
import { db } from "@/lib/db";
import {
  cfFinishingVariants,
  cfPersonas,
  cfRawClips,
  cfSources,
} from "@repo/db";
import { statArtifacts } from "../../_lib/artifacts";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/clip-forge/sources/:id
 *
 * Full source-detail bundle for the source-detail screen: the source row
 * itself (including portrait_crops + facecam_layout JSONB), the persona name,
 * every cf_raw_clip belonging to the source, and per-clip variant counts.
 *
 * Counts distinguish variant ROWS from variants that actually have a playable
 * MP4 on disk. They are not the same thing and conflating them is how the
 * console ended up reporting a fully-rendered source that could not play a
 * single clip: the files had been deleted, the rows had not.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiAuth(req, async () => {
    const [source] = await db
      .select()
      .from(cfSources)
      .where(eq(cfSources.id, id))
      .limit(1);
    if (!source) {
      return new Response(JSON.stringify({ error: "source not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const [persona] = await db
      .select()
      .from(cfPersonas)
      .where(eq(cfPersonas.id, source.persona_id))
      .limit(1);

    const clips = await db
      .select()
      .from(cfRawClips)
      .where(eq(cfRawClips.source_id, source.id))
      .orderBy(asc(cfRawClips.start_sec));

    // Variants for THIS source's clips only. The previous version grouped over
    // the entire cf_finishing_variants table on every request and then threw
    // away all the foreign rows client-side.
    const clipIds = clips.map((c) => c.id);
    const variants = clipIds.length
      ? await db
          .select({
            id: cfFinishingVariants.id,
            raw_clip_id: cfFinishingVariants.raw_clip_id,
            rendered_mp4_key: cfFinishingVariants.rendered_mp4_key,
            created_at: cfFinishingVariants.created_at,
          })
          .from(cfFinishingVariants)
          .where(inArray(cfFinishingVariants.raw_clip_id, clipIds))
      : [];

    // One filesystem pass for every artifact this screen will claim exists.
    const artifacts = await statArtifacts([
      ...clips.map((c) => c.raw_mp4_key),
      ...variants.map((v) => v.rendered_mp4_key),
    ]);
    const present = (key: string | null) =>
      !!(key && artifacts.get(key)?.present);

    const variantStatsMap = new Map<
      string,
      {
        variant_count: number;
        playable_variant_count: number;
        last_rendered_at: Date | null;
      }
    >();
    for (const v of variants) {
      const entry = variantStatsMap.get(v.raw_clip_id) ?? {
        variant_count: 0,
        playable_variant_count: 0,
        last_rendered_at: null as Date | null,
      };
      entry.variant_count += 1;
      if (present(v.rendered_mp4_key)) entry.playable_variant_count += 1;
      if (!entry.last_rendered_at || v.created_at > entry.last_rendered_at) {
        entry.last_rendered_at = v.created_at;
      }
      variantStatsMap.set(v.raw_clip_id, entry);
    }

    const clipsWithStats = clips.map((c) => {
      const s = variantStatsMap.get(c.id);
      return {
        ...c,
        variant_count: s?.variant_count ?? 0,
        playable_variant_count: s?.playable_variant_count ?? 0,
        last_rendered_at: s?.last_rendered_at ?? null,
        // False whenever the row claims a key but the file is gone. The UI
        // uses this to offer "re-render" instead of a broken <video>.
        raw_mp4_present: present(c.raw_mp4_key),
        raw_mp4_size_bytes: c.raw_mp4_key
          ? (artifacts.get(c.raw_mp4_key)?.size_bytes ?? null)
          : null,
      };
    });

    // Last-mine timestamp: latest cf_raw_clips.created_at on this source
    const lastMined = clips.reduce<Date | null>((acc, c) => {
      if (!acc || c.created_at > acc) return c.created_at;
      return acc;
    }, null);

    return {
      source,
      persona: persona ? { id: persona.id, name: persona.name } : null,
      clips: clipsWithStats,
      stats: {
        total_clips: clips.length,
        // Raw trims that are actually on disk right now.
        clips_with_raw_mp4: clipsWithStats.filter((c) => c.raw_mp4_present)
          .length,
        // Variant rows vs variant rows with a playable file. A gap between
        // these two is the signal that a batch re-render is needed.
        rendered_variants: variants.length,
        playable_variants: variants.filter((v) => present(v.rendered_mp4_key))
          .length,
        last_mined_at: lastMined,
      },
    };
  });
}
