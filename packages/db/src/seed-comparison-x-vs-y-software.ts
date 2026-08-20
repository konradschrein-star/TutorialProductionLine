#!/usr/bin/env tsx
/**
 * Seed: Comparison X vs Y — Software Template
 *
 * Inserts (or upserts) the TECH_COMPARISON content template for software comparisons.
 *
 * Pipeline config flags (stored in template.metadata.pipeline_config):
 *   needs_scene_analysis:        true   → scene-analysis runs after research + scripting
 *   awaiting_va_after_automated: true   → job parks at AWAITING_PRODUCTION_VA for:
 *                                          • product hero image upload
 *                                          • data grid audit
 *                                          • source URL verification
 *   comparison_subformat:        TECH_SOFTWARE
 *   requires_data_grid_audit:    true   → QMS blocks render until audited_at is set
 *   requires_product_images:     true   → QMS blocks render until both hero_asset_keys are set
 *
 * Procedural structure rules (enforced in scene_analysis prompt):
 *   - HOOK: exactly 1, always index 0
 *   - PRODUCT_INTRO: 1 per product (2 total)
 *   - HEAD_TO_HEAD: 1–2 scenes
 *   - FEATURE_SPOTLIGHT: ≥ 30% of scenes, 1 per dimension
 *   - VERDICT: exactly 1, second-to-last
 *   - CTA: exactly 1, last
 *   - No more than 2 consecutive scenes of the same block type
 *   - Total: 10–18 scenes based on dimension count + script length
 *   - Block sequence seeded from render_seed for reproducibility
 *
 * Usage:
 *   pnpm --filter @repo/db seed:comparison-software
 *   OR
 *   tsx packages/db/src/seed-comparison-x-vs-y-software.ts
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { contentTemplates } from "./schema/content-templates.js";
import { eq } from "drizzle-orm";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "../../../.env");
config({ path: envPath });

import { loadConfig, getConfig } from "@repo/config";

async function seedTemplate() {
  console.log("[seed-template] Loading config...");
  try { loadConfig(); } catch (e) { console.error(e); process.exit(1); }

  const { DATABASE_URL } = getConfig();
  const sql = postgres(DATABASE_URL);
  const db = drizzle(sql);

  const templateName = "Comparison X vs Y — Software";

  const [existing] = await db
    .select({ id: contentTemplates.id })
    .from(contentTemplates)
    .where(eq(contentTemplates.name, templateName))
    .limit(1);

  const templateData = {
    name: templateName,
    description:
      "Side-by-side software comparison video. AI researches both products, generates a structured data grid and procedural scene breakdown. VA audits data before render. Comparison-specific Remotion blocks: hook split, product intro, spec table, feature cards, verdict reveal.",
    format: "TECH_COMPARISON" as const,

    pipeline_stages: [
      "AWAITING_RESEARCH",
      "RESEARCH_UPLOADED",
      "SCRIPTING",
      "ASSET_COLLECTION",
      "AWAITING_PRODUCTION_VA",
      "QMS_VALIDATING",
      "ROUTING_RENDER",
      "RENDERING_REMOTION",
      "AWAITING_QC",
    ],

    prompts: {
      /**
       * RESEARCH PROMPT
       *
       * Called by comparison_research handler in ai-generation.ts.
       * Returns structured JSON consumed by ComparisonDataGridSchema.
       * Template variables: ${product_a_name}, ${product_b_name}, ${subformat}
       */
      research: `You are a product research analyst producing structured comparison data for a YouTube comparison video.

Compare the following two software products:
- Product A: \${product_a_name}
- Product B: \${product_b_name}

Your task is to produce accurate, factual, up-to-date research data in strict JSON format.

IMPORTANT: Every fact must be verifiable. Do not invent specifications, pricing, or feature claims.
If a fact is uncertain, use a conservative estimate and flag it with a "(verify)" suffix on the value.

Return ONLY this JSON object, no markdown, no explanation:
{
  "dimensions": [
    "Ease of Use",
    "Feature Depth",
    "Collaboration",
    "Offline Access",
    "Price Value",
    "Customization",
    "Performance",
    "Mobile Experience"
  ],
  "scores": {
    "A": {
      "Ease of Use": <0-10 score>,
      "Feature Depth": <0-10 score>,
      "Collaboration": <0-10 score>,
      "Offline Access": <0-10 score>,
      "Price Value": <0-10 score>,
      "Customization": <0-10 score>,
      "Performance": <0-10 score>,
      "Mobile Experience": <0-10 score>
    },
    "B": {
      <same dimensions>
    }
  },
  "raw_specs": {
    "A": {
      "Platform Support": "Windows, macOS, Linux, iOS, Android, Web",
      "Free Tier": "Yes — limited blocks",
      "Paid Plan": "$10/mo (Plus)",
      "Real-time Collaboration": "Yes",
      "Offline Mode": "Limited",
      "API Access": "Yes",
      "Storage": "Unlimited (Plus)",
      "Export Formats": "PDF, Markdown, HTML, CSV"
    },
    "B": {
      <same fields for Product B>
    }
  },
  "pricing": {
    "A": "Free tier available · $10/mo (Plus) · $18/mo (Business)",
    "B": "Free (self-hosted) · $50/yr (Catalyst) · $96/yr (Insider)"
  },
  "facts_sources": [
    "<URL to Product A pricing page>",
    "<URL to Product B pricing page>",
    "<URL to a credible third-party comparison or review>"
  ]
}

Scoring guidelines (0–10):
- 9–10: Best-in-class, clear market leader for this dimension
- 7–8: Strong, above average, minor weaknesses
- 5–6: Average, adequate for most users, notable trade-offs
- 3–4: Below average, significant weaknesses
- 1–2: Poor, major limitation or missing feature
- 0: Feature does not exist

Be precise. Do not round all scores to 7. Show real differentiation.`,

      /**
       * SCRIPT PROMPT
       *
       * Called after research completes. Receives research JSON as context.
       * Template variables: ${product_a_name}, ${product_b_name}, ${research_json}
       */
      script: `You are a YouTube scriptwriter specializing in software comparison videos. Your videos feel like they were made by a knowledgeable, opinionated human reviewer — not a robot reading a spec sheet.

You are writing the voice-over script for a comparison video between \${product_a_name} and \${product_b_name}.

Research data (use this as your factual foundation — do not invent facts beyond it):
\${research_json}

Requirements:
- Length: 900–1400 words (approximately 6–9 minutes at 155 words per minute)
- Tone: Direct, confident, conversational — like a sharp YouTuber who has used both products
- Perspective: You have a clear opinion but you show your reasoning, not just assertions
- Structure: Guided by natural comparison rhythm, not rigid section labels. The script should feel like a single flowing argument, not a product manual.
- Authenticity markers: Use specific numbers, specific feature names, specific user scenarios. "The graph database" not "a feature". "$8 per month" not "low cost".
- Avoid: "In conclusion", "As we can see", "Let's dive in", "Without further ado", marketing clichés, AI-sounding phrases
- Voice: 2nd person where helpful ("if you work solo…", "when your team needs…")
- Verdict: Must be earned by the preceding argument. State a clear recommendation with a reason.

CRITICAL TTS REQUIREMENTS:
- Do NOT include section headers like "Introduction", "Comparison", "Verdict"
- Do NOT include standalone product names as titles (e.g., "NOTION:" or "Product A:")
- Do NOT include formatting markers (**, ##, --, etc.)
- Do NOT include meta-commentary about the script structure
- Output ONLY the spoken narration text, formatted as natural paragraphs
- Imagine you are speaking directly to the viewer — everything you write will be read aloud by text-to-speech

Output the script text only. No headers, no labels, no markdown, no meta-commentary.`,

      /**
       * SCENE ANALYSIS PROMPT
       *
       * Procedural rule-governed scene decomposition.
       * The AI executes the rules — it does not decide the rules.
       * Block type distribution rules are hard constraints.
       * The render_seed is used to select which dimensions become FEATURE_SPOTLIGHT scenes
       * and to shuffle non-mandatory ordering within constraints.
       *
       * Template variables: ${script}, ${product_a_name}, ${product_b_name},
       *                     ${dimensions}, ${render_seed}
       */
      scene_analysis: `You are decomposing a comparison video script into scenes for a Remotion-rendered video.

Products: \${product_a_name} vs \${product_b_name}
Comparison dimensions: \${dimensions}
Render seed (use for deterministic choices): \${render_seed}

Script:
\${script}

STRUCTURAL RULES — these are hard constraints, not suggestions:

Block type vocabulary:
- HOOK           — side-by-side reveal opener, first scene only
- PRODUCT_INTRO  — single product focus: identity, core use case, key strengths
- HEAD_TO_HEAD   — animated spec/feature comparison across both products
- FEATURE_SPOTLIGHT — deep-dive into exactly one comparison dimension
- VERDICT        — winner reveal, score summary, recommendation
- CTA            — affiliate links, subscribe, sign-off

Mandatory structure:
1. HOOK: exactly 1, always scene_index 0
2. PRODUCT_INTRO: exactly 2 (one per product, A before B), always before any HEAD_TO_HEAD
3. HEAD_TO_HEAD: 1 or 2 scenes (use render_seed % 2 to decide: even = 1, odd = 2)
4. FEATURE_SPOTLIGHT: at least 30% of total scenes. Use render_seed to select which dimensions from the list become spotlight scenes. Prefer dimensions with score differences ≥ 2.
5. VERDICT: exactly 1, always second-to-last scene
6. CTA: exactly 1, always last scene
7. Constraint: no more than 2 consecutive scenes of the same block type (except FEATURE_SPOTLIGHT may run up to 3 in a row if dimension count requires it)
8. Total scenes: 10–18. Scale with dimension count: (2 PRODUCT_INTROs) + (HEAD_TO_HEAD count) + (spotlight count) + (VERDICT + CTA) + (fill remaining to reach target count with additional HEAD_TO_HEAD or varied spotlights)

For each scene, the paragraph field must contain the exact script text that plays during that scene.
Split the script paragraphs to align with block type transitions.

Return ONLY a JSON array. No markdown, no explanation.
Each element:
{
  "scene_index": <integer starting at 0>,
  "paragraph": "<exact script text for this scene>",
  "visual_type": "BROLL_IMAGE",
  "comparison_block_type": "<HOOK|PRODUCT_INTRO|HEAD_TO_HEAD|FEATURE_SPOTLIGHT|VERDICT|CTA>",
  "comparison_product_slot": <"A" | "B" | null>,
  "comparison_dimension": <"dimension name" | null>,
  "image_prompt": "<visual description for background/B-roll — ignored for chart-heavy blocks, used for atmosphere>",
  "ticker_headline": null,
  "shot_type": "medium",
  "camera_angle": "eye_level"
}

comparison_product_slot: set to "A" or "B" only for PRODUCT_INTRO scenes (indicates which product). Null for all others.
comparison_dimension: set to the dimension name only for FEATURE_SPOTLIGHT scenes. Null for all others.
image_prompt: brief atmospheric description. For HOOK: "split screen, two product logos facing each other, dark studio background". For PRODUCT_INTRO: describe the product's environment/use case. For HEAD_TO_HEAD/FEATURE_SPOTLIGHT: describe a relevant technology workspace background. For VERDICT: "winner podium, single spotlight, dark background". For CTA: "clean minimal desk setup, subscribe button visible".`,
    },

    render_config: {
      engine: "REMOTION" as const,
      aspect_ratio: "16:9",
      target_duration_seconds: 480,
      settings: {
        fps: 30,
        width: 1920,
        height: 1080,
      },
      captions_enabled: false, // comparison blocks render their own text; TTS captions separate concern for Phase 2
    },

    required_assets: [
      "audio/tts",
      "image/product-hero-selected", // gated by VA hero image selection
    ],

    metadata: {
      pipeline_config: {
        needs_scene_analysis: true,
        awaiting_va_after_automated: true,   // always parks at AWAITING_PRODUCTION_VA
        no_tts: false,
        scene_count: null,                   // determined procedurally by scene_analysis
        comparison_subformat: "TECH_SOFTWARE",
        requires_data_grid_audit: true,
        requires_product_images: true,
        heygen_optional: true,               // VA can optionally add avatar clips for HOOK + VERDICT
      },
    },

    is_active: true,
  };

  if (existing) {
    await db
      .update(contentTemplates)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(templateData as any)
      .where(eq(contentTemplates.id, existing.id));
    console.log(`[seed-template] Updated existing template: ${existing.id}`);
  } else {
    const [inserted] = await db
      .insert(contentTemplates)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values(templateData as any)
      .returning({ id: contentTemplates.id });
    console.log(`[seed-template] Inserted new template: ${inserted.id}`);
  }

  console.log("[seed-template] Done.");
  await sql.end();
  process.exit(0);
}

seedTemplate().catch((err) => {
  console.error("[seed-template] Fatal:", err);
  process.exit(1);
});
