import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { Job } from "bullmq";
import {
  ClipForgeFinishingRenderPayloadSchema,
  type ClipForgeFinishingRenderPayload,
} from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { cfFinishingVariants, cfRawClips, cfSources, eq } from "@repo/db";
import { getConfig } from "@repo/config";

/**
 * Clip Forge — Finishing Render (one variant, re-run on demand).
 *
 * Reads the variant row, builds a recipe from its stored fields
 * (layout_preset, subtitle_style_id, caption_style_id, layout_options),
 * runs the standalone Remotion variant runner, and updates the row with
 * the new rendered_mp4_key + rendered_hash.
 *
 * Studio "Save" PATCHes the row's fields then enqueues this job; the
 * worker rebuilds the artifact in-place so the Inspector grid updates
 * without an extra round of plumbing.
 */
export function createCfFinishingRenderProcessor(
  db: DrizzleClient,
  args: { variantRunnerScript: string },
) {
  return async (job: Job<ClipForgeFinishingRenderPayload>) => {
    const { variant_id } = ClipForgeFinishingRenderPayloadSchema.parse(
      job.data,
    );

    const [variant] = await db
      .select()
      .from(cfFinishingVariants)
      .where(eq(cfFinishingVariants.id, variant_id))
      .limit(1);
    if (!variant) {
      throw new Error(`cf_finishing_variants row not found: ${variant_id}`);
    }
    if (
      !variant.layout_preset ||
      !variant.subtitle_style_id ||
      !variant.caption_style_id
    ) {
      throw new Error(
        `cf_finishing_variants(${variant_id}) is missing layout_preset / *_style_id — cannot rebuild a recipe`,
      );
    }

    const [clip] = await db
      .select({ source_id: cfRawClips.source_id })
      .from(cfRawClips)
      .where(eq(cfRawClips.id, variant.raw_clip_id))
      .limit(1);
    if (!clip) {
      throw new Error(`cf_raw_clips row not found: ${variant.raw_clip_id}`);
    }
    const [source] = await db
      .select({ persona_id: cfSources.persona_id })
      .from(cfSources)
      .where(eq(cfSources.id, clip.source_id))
      .limit(1);
    if (!source) {
      throw new Error(`cf_sources row not found: ${clip.source_id}`);
    }
    const sourceId = clip.source_id;
    const personaId = source.persona_id;

    const recipe = {
      seed: variant.variant_seed,
      name: `seed${variant.variant_seed}-rerender`,
      layoutPreset: variant.layout_preset as "fullscreen" | "zones",
      subtitleStyleId: variant.subtitle_style_id,
      captionStyleId: variant.caption_style_id,
      captionTextOverride: variant.caption_text ?? undefined,
      layoutOptions: (variant.layout_options as Record<string, unknown>) ?? {},
    };

    const hash = createHash("sha1")
      .update(
        JSON.stringify({
          clip: variant.raw_clip_id,
          layout: recipe.layoutPreset,
          sub: recipe.subtitleStyleId,
          cap: recipe.captionStyleId,
          captionText: recipe.captionTextOverride ?? null,
          opts: recipe.layoutOptions,
          ts: Date.now(),
        }),
      )
      .digest("hex")
      .slice(0, 12);

    const cfg = getConfig();
    const localRelKey = join(
      "cf",
      personaId,
      sourceId,
      "variants",
      `${variant.raw_clip_id}__seed${recipe.seed}__${hash}.mp4`,
    );
    const outPath = join(cfg.LOCAL_MEDIA_ROOT, localRelKey);
    await mkdir(dirname(outPath), { recursive: true });

    console.log(
      JSON.stringify({
        level: "info",
        msg: "[cf-finishing-render] starting",
        variant_id,
        seed: recipe.seed,
        layout: recipe.layoutPreset,
        sub: recipe.subtitleStyleId,
        cap: recipe.captionStyleId,
        out: outPath,
      }),
    );

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        "node",
        [
          args.variantRunnerScript,
          "--source-id",
          sourceId,
          "--raw-clip-id",
          variant.raw_clip_id,
          "--out",
          outPath,
        ],
        { stdio: ["pipe", "inherit", "inherit"] },
      );
      proc.on("error", (e) =>
        reject(new Error(`variant runner spawn failed: ${e.message}`)),
      );
      proc.on("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`variant runner exited ${code}`)),
      );
      proc.stdin.write(JSON.stringify(recipe));
      proc.stdin.end();
    });

    const { size } = await stat(outPath);
    await db
      .update(cfFinishingVariants)
      .set({ rendered_mp4_key: localRelKey, rendered_hash: hash })
      .where(eq(cfFinishingVariants.id, variant_id));

    console.log(
      JSON.stringify({
        level: "info",
        msg: "[cf-finishing-render] complete",
        variant_id,
        size_bytes: size,
        render_hash: hash,
      }),
    );
  };
}
