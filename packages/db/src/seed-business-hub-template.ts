#!/usr/bin/env tsx
/**
 * Seed: BUSINESS_PLAN_HUB Template ("Business Plan Hub Default")
 *
 * Educational marketing videos for the Business Plan Hub tool: business plan
 * writing, SBA loan applications, EB-5 / E-2 visa plans. Photographic presenter
 * torso with a flat logo head, reaching over a persistent surface onto which
 * charts, clippings and cards are placed.
 *
 * Render spine is FFmpeg (`workflow: "business-hub"`); Remotion renders motion
 * -graphics ISLANDS only, cached by content hash. A 15-minute video is ~27,000
 * frames and there is no working GPU — rendering every frame through Chromium
 * is the one thing that makes the volume target impossible.
 *
 * Upsert is BY NAME: re-running this script updates the existing row rather
 * than inserting a duplicate, so it is safe to run against production.
 *
 * Usage:
 *   pnpm --filter @repo/db seed:business-hub
 *   OR
 *   tsx packages/db/src/seed-business-hub-template.ts
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
  console.log("[seed-business-hub] Loading config...");
  try {
    loadConfig();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  const { DATABASE_URL } = getConfig();
  const sql = postgres(DATABASE_URL);
  const db = drizzle(sql);

  const templateName = "Business Plan Hub Default";

  const [existing] = await db
    .select({ id: contentTemplates.id })
    .from(contentTemplates)
    .where(eq(contentTemplates.name, templateName))
    .limit(1);

  const templateData = {
    name: templateName,
    description:
      "Long-form educational marketing for the Business Plan Hub tool: how to write a business plan for a given industry and funding purpose (SBA 7(a), 504, EB-5, E-2, investor). A photographic presenter torso with a flat logo head works over a persistent surface while charts, clippings and cards are placed on it. FFmpeg owns the render spine; Remotion renders motion-graphics islands only, cached by content hash. Every stat, formula, quote, comparison and checklist must carry a source or the job fails closed.",
    format: "BUSINESS_PLAN_HUB" as const,

    pipeline_stages: [
      "SCRIPTING",
      "ASSET_COLLECTION",
      "QMS_VALIDATING",
      "ROUTING_RENDER",
      "RENDERING_FFMPEG",
      "AWAITING_UPLOADER",
    ],

    prompts: {
      // DELIBERATELY A POINTER, NOT A PROMPT.
      //
      // The real scriptwriting SOP for BUSINESS_PLAN_HUB lives in the
      // claude-pool WriterSpec at
      //   apps/claude-pool/src/writers/business-plan-hub.ts
      // (registered in apps/claude-pool/src/writers/index.ts, and gated by
      // "BUSINESS_PLAN_HUB" in CLAUDE_POOL_SUPPORTED_FORMATS in
      // apps/worker-orchestrator/src/utils/llm-client.ts).
      //
      // That spec owns the system prompt, the words-per-minute figure, the
      // target runtime, and — critically — validate(), which rejects a draft
      // that states a figure without a source. Copying the prompt body in here
      // would create two prompts that silently drift apart, and the one the
      // pipeline actually uses is the WriterSpec. If you want to change how
      // these scripts are written, change the WriterSpec. Do not edit this
      // string expecting it to take effect.
      script:
        "Script generation for BUSINESS_PLAN_HUB is owned by the claude-pool WriterSpec at apps/claude-pool/src/writers/business-plan-hub.ts. This template does not carry a script prompt; edit the WriterSpec instead.",
    },

    render_config: {
      engine: "FFMPEG" as const,
      // Explicit workflow. New formats bind to a renderer via
      // render_config.workflow — render-processor.ts looks this key up in its
      // workflowDispatch registry ("business-hub" -> renderBusinessHub). There
      // is deliberately NO formatOverride entry for this format; those exist
      // for legacy reasons only.
      //
      // Setting it here also makes the compatibility guard live: with the
      // workflow set, render-processor runs validateRendererCompatibility(),
      // which THROWS unless packages/domain/src/renderer-compatibility.ts has a
      // BUSINESS_PLAN_HUB entry listing "business-hub" as compatible. Leaving
      // workflow unset is what keeps a missing entry latent instead of loud.
      workflow: "business-hub",
      settings: {
        fps: 30,
        width: 1920,
        height: 1080,
      },
      captions_enabled: true,
    },

    required_assets: [],

    metadata: {
      pipeline_config: {
        // The business-hub planner builds its own typed scene plan from the
        // script; the generic scene-analysis pass would fight it.
        needs_scene_analysis: false,
        no_tts: false,
        // Fish Audio, same voice as the existing tutorial channels.
        tts_engine: "fish",
        // PREFERRED: "claude_pool" — Claude CLI pool (OAuth, not an API key).
        // 15-minute scripts use the outline-then-expand pattern, and
        // BUSINESS_PLAN_HUB is a registered claude-pool writer (see
        // CLAUDE_POOL_SUPPORTED_FORMATS in worker-orchestrator/src/utils/
        // llm-client.ts), so that path runs the writer's SOP + validate() +
        // --resume self-correction. Single-shot at that length is unreliable.
        //
        // RECORDED FALLBACK: as of 2026-08-16 the claude-pool service on :8092
        // is DOWN, so claude_pool cannot produce a script at all. The live
        // template row (2ad9ad0f-64cf-4807-9651-f402a3782f09) was switched to
        // "deepseek" to unblock the first end-to-end render. The fallback is
        // written here rather than left only in the DB, so the seed does not
        // silently disagree with production.
        //
        // "deepseek" is a first-class branch in processors/ai-generation.ts
        // (RANKING uses it) with measured budgets — max_tokens 32768,
        // timeoutMs 300000 — routed through the "standard" tier ladder
        // (deepseek -> gemini_direct -> ollama), so it degrades on its own.
        //
        // REVERT TO "claude_pool" once :8092 is back up; quality there is
        // better for long-form.
        script_provider: "deepseek",
        business_hub: {
          // Keyword-matrix family this template targets by default:
          // [industry] x [purpose]. See the format design doc, section 2.
          family: "how-to-write-for",
          target_minutes: 15,
          // "none" is DELIBERATE and TEMPORARY — it is not the intended look.
          //
          // The intended mode is "suit": the presenter overlay track (suit PNG
          // pose + SVG head, head scaled by narration RMS, composited by one
          // FFmpeg overlay pass). But that mode requires calibrated poses, and
          // as of 2026-08-16 `media/style-assets/presenter/poses/poses.json`
          // holds 16 poses of which **0** are calibrated — every entry is
          // `anchor_status: "needs-calibration"` with a null head anchor.
          //
          // Seeding "suit" against that state does not degrade gracefully: it
          // is a guaranteed hard failure. `PoseRotation.next()` throws
          // NO_CALIBRATED_POSE in the PLANNER (business-hub/planner.ts), so the
          // job dies during ASSET_COLLECTION, before a single frame exists.
          // Shipping a default that cannot ever succeed is worse than shipping
          // a plainer one that can.
          //
          // FLIP THIS BACK TO "suit" once poses are calibrated in the Presenter
          // Studio (/business-hub-studio). That is an operator task, not a code
          // change — the Studio writes poses.json via
          // apps/hub-web/src/app/api/business-hub/studio/_lib/presenter-store.ts.
          // Calibrate per INTENT, not just one pose, or the planner throws
          // NO_POSE_FOR_INTENT instead. "suit" additionally needs a
          // `presenter_placement` (target_collar_px / bottom_anchor /
          // side_inset) — nothing derives those and the pipeline refuses to
          // invent them.
          presenter_mode: "none",
        },
      },
    },

    is_active: true,
  };

  if (existing) {
    await db
      .update(contentTemplates)
      .set({ ...templateData, updated_at: new Date() })
      .where(eq(contentTemplates.id, existing.id));
    console.log(`[seed-business-hub] Updated template: ${existing.id}`);
  } else {
    const [inserted] = await db
      .insert(contentTemplates)
      .values(templateData)
      .returning({ id: contentTemplates.id });
    console.log(`[seed-business-hub] Inserted template: ${inserted.id}`);
  }

  console.log("[seed-business-hub] Done.");
  await sql.end();
  process.exit(0);
}

seedTemplate().catch((err) => {
  console.error("[seed-business-hub] Fatal:", err);
  process.exit(1);
});
