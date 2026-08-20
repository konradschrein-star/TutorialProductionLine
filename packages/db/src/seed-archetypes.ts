#!/usr/bin/env tsx
/**
 * Seed: Archetypes + Character State Types
 *
 * Inserts the three initial archetypes and back-fills archetype_id
 * into existing content_templates that use matching image_style values.
 *
 * Also seeds the character_state_types table (if not already done by migration).
 *
 * Archetypes seeded:
 *   FLAT_ILLUSTRATION   — image_style: "illustration"
 *   BROADCAST_NEWS      — image_style: "photorealistic"
 *
 * Usage:
 *   pnpm --filter @repo/db seed:archetypes
 *   OR
 *   tsx packages/db/src/seed-archetypes.ts
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  archetypes,
  characterStateTypes,
  contentTemplates,
} from "./schema/index.js";
import { eq, like, or } from "drizzle-orm";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "../../../.env");
config({ path: envPath });

import { loadConfig, getConfig } from "@repo/config";

async function seed() {
  console.log("[seed-archetypes] Loading config...");
  try {
    loadConfig();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  const { DATABASE_URL } = getConfig();
  const sql = postgres(DATABASE_URL);
  const db = drizzle(sql);

  // =========================================================
  // 1. Seed archetypes
  // =========================================================

  const archetypeData = [
    {
      name: "FLAT_ILLUSTRATION",
      description:
        "Flat design illustration style inspired by Casually Explained. Simple shapes, limited color palette, clean off-white backgrounds. Host avatar visible in bottom-right corner (AVATAR_PIP).",
      style_prefix:
        "Simple flat-design illustration, stick-figure art style, minimal background,",
      style_suffix:
        "clean off-white background, hand-drawn feel, no photorealism, no photography",
      image_style: "illustration",
      tags: ["#illustration", "#flat-design", "#casually-explained"],
      metadata: {
        forbidden_elements: [
          "photorealism",
          "photography",
          "bokeh",
          "film grain",
          "complex lighting",
        ],
        preferred_colors: ["#FAFAFA", "#F0F0F0", "#222222"],
        avatar_position: "bottom-right",
      },
    },
    {
      name: "BROADCAST_NEWS",
      description:
        "Professional broadcast news photography style. Photorealistic B-roll imagery with anchor/host in PIP corner overlay. Cinematic quality, editorial aesthetic.",
      style_prefix:
        "Professional broadcast news photography, photojournalistic style,",
      style_suffix:
        "broadcast color grading, 16:9 aspect ratio, editorial news aesthetic",
      image_style: "photorealistic",
      tags: ["#broadcast", "#photorealistic", "#news"],
      metadata: {
        forbidden_elements: [
          "AI tells",
          "oversaturation",
          "perfect symmetry",
          "plastic skin",
          "cartoonish",
        ],
        color_grading: "broadcast",
      },
    },
  ];

  const insertedArchetypes: Record<string, string> = {};

  for (const data of archetypeData) {
    const [existing] = await db
      .select({ id: archetypes.id })
      .from(archetypes)
      .where(eq(archetypes.name, data.name))
      .limit(1);

    if (existing) {
      await db
        .update(archetypes)
        .set({ ...data, updated_at: new Date() })
        .where(eq(archetypes.id, existing.id));
      console.log(
        `[seed-archetypes] Updated archetype: ${data.name} (${existing.id})`,
      );
      insertedArchetypes[data.image_style] = existing.id;
    } else {
      const [inserted] = await db
        .insert(archetypes)
        .values(data)
        .returning({ id: archetypes.id });
      console.log(
        `[seed-archetypes] Inserted archetype: ${data.name} (${inserted!.id})`,
      );
      insertedArchetypes[data.image_style] = inserted!.id;
    }
  }

  // =========================================================
  // 2. Back-fill archetype_id on existing content_templates
  // =========================================================

  const templates = await db.select().from(contentTemplates);

  for (const template of templates) {
    const renderConfig = (template.render_config as any) ?? {};
    const imageStyle: string | undefined = renderConfig.image_style;

    if (!imageStyle) {
      console.log(
        `[seed-archetypes] Template "${template.name}" has no image_style in render_config — skipping archetype back-fill (set render_config.image_style explicitly)`,
      );
      continue;
    }

    const archetypeId = insertedArchetypes[imageStyle];

    if (!archetypeId) {
      console.log(
        `[seed-archetypes] No archetype found for image_style="${imageStyle}" on template "${template.name}" — skipping`,
      );
      continue;
    }

    const currentMetadata =
      (template.metadata as Record<string, unknown>) ?? {};
    if (currentMetadata.archetype_id === archetypeId) {
      console.log(
        `[seed-archetypes] Template "${template.name}" already has correct archetype_id — skipping`,
      );
      continue;
    }

    await db
      .update(contentTemplates)
      .set({
        metadata: { ...currentMetadata, archetype_id: archetypeId },
        updated_at: new Date(),
      })
      .where(eq(contentTemplates.id, template.id));

    console.log(
      `[seed-archetypes] Back-filled archetype_id on template "${template.name}" → ${archetypeId}`,
    );
  }

  // =========================================================
  // 3. Seed character_state_types (idempotent — migration may have already done this)
  // =========================================================

  const states = [
    {
      name: "neutral",
      description: "Default standing/sitting pose — no strong emotion",
    },
    { name: "happy", description: "Smiling, upbeat body language" },
    { name: "sad", description: "Downcast expression, slumped posture" },
    { name: "angry", description: "Furrowed brow, tense posture" },
    {
      name: "surprised",
      description: "Wide eyes, open mouth, raised eyebrows",
    },
    { name: "walking", description: "Mid-stride movement" },
    { name: "running", description: "Fast motion, leaning forward" },
    {
      name: "pointing",
      description: "Arm extended, finger pointing at something",
    },
    {
      name: "thinking",
      description: "Hand to chin or head tilted, contemplative",
    },
    { name: "crying", description: "Tears visible, clearly distressed" },
    { name: "celebrating", description: "Arms raised, victorious pose" },
    {
      name: "confused",
      description: "Head tilted, question marks implied in posture",
    },
  ];

  for (const state of states) {
    const [existing] = await db
      .select({ id: characterStateTypes.id })
      .from(characterStateTypes)
      .where(eq(characterStateTypes.name, state.name))
      .limit(1);

    if (!existing) {
      await db.insert(characterStateTypes).values(state);
      console.log(
        `[seed-archetypes] Inserted character state type: ${state.name}`,
      );
    }
  }

  console.log("[seed-archetypes] Done.");
  await sql.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error("[seed-archetypes] Fatal:", err);
  process.exit(1);
});
