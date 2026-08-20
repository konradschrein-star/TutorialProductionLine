#!/usr/bin/env tsx
/**
 * Patch: Fix template metadata
 *
 * Patches 4 template rows in PostgreSQL:
 * 1. CASUALLY_EXPLAINED (154304ff): add image_style: "illustration" to render_config,
 *    add "no text" to style_preset.prompt_suffix in metadata
 * 2. EXPLAINER d5797567: fix prompt_prefix (remove "Casually Explained style"),
 *    add image_style: "illustration" to render_config, add "no text" to prompt_suffix
 * 3. POLITICAL_COMMENTARY V1 (c863eeab): FULL REPLACEMENT of render_config (was corrupted by
 *    TEXT→JSONB || spread into char-indexed keys "0","1",...). Sets engine, settings, workflow,
 *    image_style, captions_enabled, hook fields. Sets needs_scene_analysis: true in pipeline_config.
 * 4. STICKMAN_ANIMATION templates: add image_style: "stickman" to render_config
 *
 * NOTE on column structure:
 * - render_config is a TOP-LEVEL column (not nested inside metadata)
 * - metadata is a separate TOP-LEVEL column containing pipeline_config and style_preset
 *
 * Run via SSH tunnel:
 *   DATABASE_URL="postgresql://postgres:content_forge_prod@127.0.0.1:5433/content_forge" \
 *     npx tsx packages/db/src/patch-template-metadata.ts
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { contentTemplates } from "./schema/content-templates.js";
import { eq, sql } from "drizzle-orm";

const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://postgres:content_forge_prod@127.0.0.1:5432/content_forge";

const client = postgres(DATABASE_URL);
const db = drizzle(client);

async function patch() {
  // 1. CASUALLY_EXPLAINED (154304ff):
  //    - render_config: add image_style: "illustration"
  //    - metadata.style_preset.prompt_suffix: add "no text, no labels, no writing, no watermarks"
  await db
    .update(contentTemplates)
    .set({
      render_config: sql`render_config || '{"image_style":"illustration"}'::jsonb`,
      metadata: sql`jsonb_set(
        COALESCE(metadata, '{}'),
        '{style_preset,prompt_suffix}',
        '"clean off-white background, hand-drawn feel, no photorealism, no photography, no text, no labels, no writing, no watermarks"'::jsonb
      )`,
    })
    .where(eq(contentTemplates.id, "154304ff-814a-4efc-b558-824fdb8f4253"));
  console.log("✓ CASUALLY_EXPLAINED patched");

  // 2. EXPLAINER d5797567:
  //    - render_config: add image_style: "illustration"
  //    - metadata.style_preset.prompt_prefix: fix (remove "Casually Explained style")
  //    - metadata.style_preset.prompt_suffix: add "no text"
  await db
    .update(contentTemplates)
    .set({
      render_config: sql`render_config || '{"image_style":"illustration"}'::jsonb`,
      metadata: sql`jsonb_set(
        jsonb_set(
          COALESCE(metadata, '{}'),
          '{style_preset,prompt_prefix}',
          '"Educational flat-design infographic illustration,"'::jsonb
        ),
        '{style_preset,prompt_suffix}',
        '"clean off-white background, no photorealism, no text, no labels, no writing, no watermarks, multiple elements on canvas, 16:9 aspect ratio, high quality illustration"'::jsonb
      )`,
    })
    .where(eq(contentTemplates.id, "d5797567-52af-4973-be00-aa72b1971b32"));
  console.log("✓ EXPLAINER d5797567 patched");

  // 3. POLITICAL_COMMENTARY V1 (c863eeab):
  //    - render_config: FULL REPLACEMENT (previous run corrupted it via || on a TEXT string,
  //      spreading it character-by-character into keys "0","1","2",...).
  //      Correct value reconstructed from seed-political-commentary-v1.ts + required fields.
  //    - metadata.pipeline_config.needs_scene_analysis: true
  //
  //    IMPORTANT: Use a literal assignment, NOT `render_config || '...'::jsonb`,
  //    because if render_config is a TEXT string at rest the || operator spreads it char-by-char.
  await db
    .update(contentTemplates)
    .set({
      render_config: sql`'{"engine":"REMOTION","settings":{"fps":30,"width":1920,"height":1080},"captions_enabled":true,"hook_scene_seconds":1.5,"hook_duration_seconds":30,"workflow":"clean-layout","image_style":"illustration"}'::jsonb`,
      metadata: sql`jsonb_set(
        COALESCE(metadata, '{}'),
        '{pipeline_config,needs_scene_analysis}',
        'true'::jsonb
      )`,
    })
    .where(eq(contentTemplates.id, "c863eeab-b0f3-4c52-aa00-ea828209a65b"));
  console.log(
    "✓ POLITICAL_COMMENTARY V1 patched (render_config fully replaced, not merged)",
  );

  // 4. STICKMAN_ANIMATION: add image_style: "stickman" to render_config for all templates
  const stickmanTemplates = await client`
    SELECT id FROM content_templates WHERE format = 'STICKMAN_ANIMATION'
  `;
  if (stickmanTemplates.length === 0) {
    console.log("~ STICKMAN_ANIMATION: no templates found, skipping");
  } else {
    for (const row of stickmanTemplates) {
      await db
        .update(contentTemplates)
        .set({
          render_config: sql`render_config || '{"image_style":"stickman"}'::jsonb`,
        })
        .where(eq(contentTemplates.id, row.id as string));
    }
    console.log(
      `✓ STICKMAN_ANIMATION templates patched (${stickmanTemplates.length} rows)`,
    );
  }

  await client.end();
  console.log("All template patches applied.");
}

patch().catch((e) => {
  console.error(e);
  process.exit(1);
});
