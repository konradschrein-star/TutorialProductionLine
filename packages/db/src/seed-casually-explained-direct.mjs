#!/usr/bin/env node
/**
 * Direct SQL seed for Casually Explained templates
 *
 * Bypasses Drizzle ORM to ensure templates are actually inserted.
 * Creates two templates:
 *   1. Casually Explained - Automated (fully AI-generated)
 *   2. Casually Explained - Editorial (VA-assisted with photo replacement)
 *
 * Both use format='CASUALLY_EXPLAINED' and link to FLAT_ILLUSTRATION archetype.
 *
 * Usage:
 *   node packages/db/src/seed-casually-explained-direct.mjs
 *   OR
 *   pnpm --filter @repo/db tsx src/seed-casually-explained-direct.mjs
 */

import postgres from "postgres";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "../../../.env");
config({ path: envPath });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[seed-casually-explained-direct] ERROR: DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

async function seed() {
  console.log("[seed-casually-explained-direct] Starting seed...");

  // 1. Get FLAT_ILLUSTRATION archetype ID
  const [archetype] = await sql`
    SELECT id FROM archetypes WHERE image_style = 'illustration' LIMIT 1
  `;

  if (!archetype) {
    console.error("[seed-casually-explained-direct] ERROR: FLAT_ILLUSTRATION archetype not found. Run seed:archetypes first.");
    await sql.end();
    process.exit(1);
  }

  console.log(`[seed-casually-explained-direct] Found FLAT_ILLUSTRATION archetype: ${archetype.id}`);

  // 2. Define template data
  const templates = [
    {
      name: "Casually Explained - Automated",
      description: "Fully AI-generated Casually Explained style with hybrid stick figure + photorealistic compositions. Uses Nano Banana 2 for fast generation. No human QC required - optimized for high-volume automated production.",
      format: "CASUALLY_EXPLAINED",
      pipeline_stages: [
        "SCRIPTING",
        "ASSET_COLLECTION",
        "QMS_VALIDATING",
        "ROUTING_RENDER",
        "RENDERING_FFMPEG",
        "AWAITING_UPLOADER",
      ],
      prompts: {
        script_generation: `You are an expert comedy educational content writer creating Casually Explained-style video scripts.

Topic: \${topic}
Complexity Level: \${complexity_level}
Target Duration: \${target_duration_seconds} seconds

Tone Guidelines:
- Dry, deadpan humor with self-aware narrator
- Ironic observations and unexpected comparisons
- Relatable modern life references
- Understatement and casual language
- Occasional absurdist tangents that circle back to the point

Structure:
- Hook: Relatable observation or ironic statement (10-15 sec)
- Main content: Educational explanation with humor mixed in
- Running gags or callback jokes throughout
- Summary: Dry conclusion with final punchline (10-15 sec)

Guidelines:
- Each paragraph should be 2-4 sentences (visual scene boundary)
- Total word count: ~\${word_count} words (based on target duration)
- Natural pauses for visual transitions
- Suggest 2-3 visual elements per scene for hybrid composition

Output the script as plain text paragraphs. Each paragraph = one hybrid visual scene.`,

        scene_description: `You are an expert at creating hybrid composition descriptions combining stick figures AND photorealistic elements in Casually Explained style.

Script paragraph: \${paragraph}

Generate a structured visual layout description for hybrid AI image generation:

Layout options: 2x2 grid, 3-panel split, center-focus-with-sides, stacked-layers

For each element specify:
- Type: stick_figure OR photorealistic
- Description: what to generate
- Position: where in the layout

Guidelines for stick figures:
- Simple stick figures with large circular heads
- Big round eyes, thick black outlines
- Hand-drawn, minimal detail feel
- Various poses: confused, pointing, thinking, excited, etc.

Guidelines for photorealistic elements:
- Professional photography quality
- Proper lighting and realistic textures
- Charts, graphs, screenshots, objects, environments
- Should look like real photographs

Output as JSON with layout and elements array.`,

        visual_search_query: `Extract 2-4 keyword search terms from this hybrid composition for finding reference images. Focus on photorealistic elements only (ignore stick figures).`,
      },
      render_config: {
        engine: "FFMPEG",
        image_style: "illustration",
        image_model_override: {
          id: "gemini-3.1-flash-image-preview",
          resolution: "1K",
        },
        qc_image_review_required: false,
        settings: {
          fps: 30,
          width: 1920,
          height: 1080,
          video_codec: "libx264",
          audio_codec: "aac",
          crf: 23,
          preset: "medium",
          ken_burns_enabled: true,
          ken_burns_intensity: 0.6,
        },
        captions_enabled: true,
      },
      required_assets: [
        "audio/tts",
        "image/composite",
        "layout_reference/reference-design",
        "document/script",
        "subtitle/ass",
      ],
      metadata: {
        archetype_id: archetype.id,
        production_config: {
          supports_avatar: false,
          requires_avatar: false,
          typical_duration_range: [60, 600],
          typical_scene_count_range: [5, 30],
          needs_scene_analysis: true,
          scene_pacing_strategy: "word-aligned",
          supports_composite_layouts: true,
          supports_reference_images: true,
        },
        style_preset: {
          name: "Casually Explained Hybrid (Automated)",
          prompt_prefix: "Hybrid composition combining simple stick figures AND photorealistic elements,",
          prompt_suffix: "stick figures: thick black outlines, large circular heads, big round eyes, hand-drawn minimal feel; photorealistic elements: professional quality photography, proper lighting, realistic textures; clean off-white background #FAFAFA, 16:9 aspect ratio, high quality",
          caption_style: {
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            textColor: "#FFFFFF",
            accentColor: "#4A90E2",
            position: "bottom-center",
          },
        },
      },
    },
    {
      name: "Casually Explained - Editorial",
      description: "Editorial Casually Explained style with VA-assisted photo replacement workflow. Production VA manually replaces AI-generated photos with higher-quality alternatives from reference collection. Requires human QC gate.",
      format: "CASUALLY_EXPLAINED",
      pipeline_stages: [
        "SCRIPTING",
        "ASSET_COLLECTION",
        "AWAITING_IMAGE_QC",
        "QMS_VALIDATING",
        "ROUTING_RENDER",
        "RENDERING_FFMPEG",
        "AWAITING_UPLOADER",
      ],
      prompts: {
        script_generation: `You are an expert comedy educational content writer creating Casually Explained-style video scripts.

Topic: \${topic}
Complexity Level: \${complexity_level}
Target Duration: \${target_duration_seconds} seconds

Tone Guidelines:
- Dry, deadpan humor with self-aware narrator
- Ironic observations and unexpected comparisons
- Relatable modern life references
- Understatement and casual language
- Occasional absurdist tangents that circle back to the point

Structure:
- Hook: Relatable observation or ironic statement (10-15 sec)
- Main content: Educational explanation with humor mixed in
- Running gags or callback jokes throughout
- Summary: Dry conclusion with final punchline (10-15 sec)

Guidelines:
- Each paragraph should be 2-4 sentences (visual scene boundary)
- Total word count: ~\${word_count} words (based on target duration)
- Natural pauses for visual transitions
- Suggest 2-3 visual elements per scene for hybrid composition

Output the script as plain text paragraphs. Each paragraph = one hybrid visual scene.`,

        scene_description: `You are an expert at creating hybrid composition descriptions combining stick figures AND photorealistic elements in Casually Explained style.

Script paragraph: \${paragraph}

Generate a structured visual layout description for hybrid AI image generation:

Layout options: 2x2 grid, 3-panel split, center-focus-with-sides, stacked-layers

For each element specify:
- Type: stick_figure OR photorealistic
- Description: what to generate
- Position: where in the layout

Guidelines for stick figures:
- Simple stick figures with large circular heads
- Big round eyes, thick black outlines
- Hand-drawn, minimal detail feel
- Various poses: confused, pointing, thinking, excited, etc.

Guidelines for photorealistic elements:
- Professional photography quality
- Proper lighting and realistic textures
- Charts, graphs, screenshots, objects, environments
- Should look like real photographs

Output as JSON with layout and elements array.`,

        visual_search_query: `Extract 2-4 keyword search terms from this hybrid composition for finding reference images. Focus on photorealistic elements only (ignore stick figures).`,
      },
      render_config: {
        engine: "FFMPEG",
        image_style: "illustration",
        image_model_override: {
          id: "gemini-3.1-flash-image-preview",
          resolution: "1K",
        },
        qc_image_review_required: true,
        settings: {
          fps: 30,
          width: 1920,
          height: 1080,
          video_codec: "libx264",
          audio_codec: "aac",
          crf: 23,
          preset: "medium",
          ken_burns_enabled: true,
          ken_burns_intensity: 0.6,
        },
        captions_enabled: true,
      },
      required_assets: [
        "audio/tts",
        "image/composite",
        "layout_reference/reference-design",
        "document/script",
        "subtitle/ass",
      ],
      metadata: {
        archetype_id: archetype.id,
        production_config: {
          supports_avatar: false,
          requires_avatar: false,
          typical_duration_range: [60, 600],
          typical_scene_count_range: [5, 30],
          needs_scene_analysis: true,
          scene_pacing_strategy: "word-aligned",
          supports_composite_layouts: true,
          supports_reference_images: true,
          requires_human_qc: true,
        },
        style_preset: {
          name: "Casually Explained Hybrid (Editorial)",
          prompt_prefix: "Hybrid composition combining simple stick figures AND photorealistic elements,",
          prompt_suffix: "stick figures: thick black outlines, large circular heads, big round eyes, hand-drawn minimal feel; photorealistic elements: professional quality photography, proper lighting, realistic textures; clean off-white background #FAFAFA, 16:9 aspect ratio, high quality",
          caption_style: {
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            textColor: "#FFFFFF",
            accentColor: "#4A90E2",
            position: "bottom-center",
          },
        },
      },
    },
  ];

  // 3. Upsert templates
  for (const template of templates) {
    // Check if template already exists
    const [existing] = await sql`
      SELECT id FROM content_templates WHERE name = ${template.name} LIMIT 1
    `;

    let result;
    if (existing) {
      // Update existing
      result = await sql`
        UPDATE content_templates SET
          description = ${template.description},
          format = ${template.format},
          pipeline_stages = ${JSON.stringify(template.pipeline_stages)},
          prompts = ${JSON.stringify(template.prompts)},
          render_config = ${JSON.stringify(template.render_config)},
          required_assets = ${JSON.stringify(template.required_assets)},
          metadata = ${JSON.stringify(template.metadata)},
          is_active = true,
          updated_at = NOW()
        WHERE id = ${existing.id}
        RETURNING id, name
      `;
      console.log(`[seed-casually-explained-direct] ✓ Updated template: ${result[0].name} (${result[0].id})`);
    } else {
      // Insert new
      result = await sql`
        INSERT INTO content_templates (
          name,
          description,
          format,
          pipeline_stages,
          prompts,
          render_config,
          required_assets,
          metadata,
          is_active,
          created_at,
          updated_at
        ) VALUES (
          ${template.name},
          ${template.description},
          ${template.format},
          ${JSON.stringify(template.pipeline_stages)},
          ${JSON.stringify(template.prompts)},
          ${JSON.stringify(template.render_config)},
          ${JSON.stringify(template.required_assets)},
          ${JSON.stringify(template.metadata)},
          true,
          NOW(),
          NOW()
        )
        RETURNING id, name
      `;
      console.log(`[seed-casually-explained-direct] ✓ Inserted template: ${result[0].name} (${result[0].id})`);
    }
  }

  console.log("[seed-casually-explained-direct] Done. Verifying...");

  // 4. Verify insertion
  const verification = await sql`
    SELECT id, name, format FROM content_templates WHERE format = 'CASUALLY_EXPLAINED' ORDER BY name
  `;

  if (verification.length === 0) {
    console.error("[seed-casually-explained-direct] ERROR: No templates found after insertion!");
  } else {
    console.log(`[seed-casually-explained-direct] Verification: Found ${verification.length} templates:`);
    verification.forEach(t => console.log(`  - ${t.name} (${t.id})`));
  }

  await sql.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error("[seed-casually-explained-direct] Fatal:", err);
  process.exit(1);
});
