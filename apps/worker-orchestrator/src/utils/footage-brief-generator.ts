/**
 * Footage Brief Generator
 *
 * Calls an LLM to produce a per-scene footage brief for TECH_COMPARISON jobs.
 * Each brief entry describes what footage to fetch (YouTube / Pexels video / photo)
 * for that scene, with a primary query, a fallback query, and a source preference.
 */

import { callLLM, requestLLMText } from "./llm-client.js";
import { createContextLogger } from "@repo/logger";

const logger = createContextLogger("footage-brief-generator");

export interface FootageClipRequest {
  scene_index: number;
  block_type: string;
  product_slot: "A" | "B" | null;
  product_name: string | null;
  dimension: string | null;
  /** YouTube search query or Pexels search term. */
  primary_query: string;
  source_preference: "youtube" | "pexels_video" | "pexels_photo" | "any";
  /** How many seconds of footage this scene needs. */
  duration_seconds: number;
  /** Fallback query if primary returns nothing usable. */
  fallback_query: string;
}

export type FootageBrief = FootageClipRequest[];

export interface SceneInput {
  scene_index: number;
  block_type: string;
  /** "A" or "B" or null for non-product-specific scenes. */
  product_slot?: "A" | "B" | null;
  paragraph: string;
  /** e.g. "camera", "display", "battery", "price" */
  comparison_dimension?: string | null;
  /** Estimated seconds this scene plays (used to set duration_seconds). */
  duration_seconds?: number;
}

export interface FootageBriefInput {
  product_a: string;
  product_b: string;
  scenes: SceneInput[];
}

const SOURCE_PREFERENCE_MAP: Record<
  string,
  FootageClipRequest["source_preference"]
> = {
  // Scene-analysis assigned names
  HOOK: "youtube",
  FEATURE_SPOTLIGHT: "youtube",
  VERDICT: "pexels_video",
  CTA: "pexels_photo",
  // Aliases used in inferBlockType fallback
  PRODUCT_INTRO: "youtube",
  FEATURE_HIGHLIGHT: "youtube",
  SPEC_COMPARISON: "youtube",
  PRICE_COMPARISON: "pexels_video",
  // Chart-heavy block types (data_grid-gated — see inferBlockType in
  // tech-footage-collection.ts). These render as dimmed background footage
  // behind a chart, so generic tech b-roll is preferred over a specific hunt.
  HEAD_TO_HEAD: "youtube",
  HEAD_TO_HEAD_V2: "youtube",
  DATA_COMPARISON: "pexels_video",
  DIMENSION_COMPARISON: "pexels_video",
  SCORE_OVERVIEW: "pexels_video",
  FINAL_VERDICT: "pexels_video",
};

function defaultSourcePreference(
  blockType: string,
): FootageClipRequest["source_preference"] {
  return SOURCE_PREFERENCE_MAP[blockType] ?? "any";
}

function buildPrompt(input: FootageBriefInput): string {
  const scenesJson = JSON.stringify(
    input.scenes.map((s) => ({
      scene_index: s.scene_index,
      block_type: s.block_type,
      product_slot: s.product_slot ?? null,
      comparison_dimension: s.comparison_dimension ?? null,
      paragraph: s.paragraph.slice(0, 300),
    })),
    null,
    2,
  );

  return `You are a video researcher creating footage briefs for a YouTube tech comparison video.

Products compared:
- Product A: ${input.product_a}
- Product B: ${input.product_b}

For each scene below, produce a JSON object with:
- scene_index: number (same as input)
- block_type: string (same as input)
- product_slot: "A" | "B" | null
- product_name: the full product name for this slot, or null
- dimension: comparison_dimension from input, or null
- primary_query: specific search query to find the best footage for this scene
  - For youtube: prefer official manufacturer channel queries like "${input.product_a} official launch trailer"
  - For pexels: use generic terms like "smartphone premium design"
- source_preference: one of "youtube" | "pexels_video" | "pexels_photo" | "any"
  - PRODUCT_INTRO, FEATURE_HIGHLIGHT, HEAD_TO_HEAD, HEAD_TO_HEAD_V2 → "youtube" (official trailer / hands-on demo footage)
  - PRICE_COMPARISON, VERDICT, FINAL_VERDICT, DATA_COMPARISON, DIMENSION_COMPARISON, SCORE_OVERVIEW → "pexels_video" (lifestyle/cinematic — these scenes render as dimmed background behind a chart)
  - CTA → "pexels_photo" (clean product flat-lay)
  - Anything else → "any"
- duration_seconds: how many seconds of footage needed (5–15 seconds per scene)
- fallback_query: a broader, more generic search if primary fails

Respond with ONLY a valid JSON array — no markdown fences, no explanation.

Scenes:
${scenesJson}`;
}

function parseLLMResponse(raw: string, input: FootageBriefInput): FootageBrief {
  // Strip markdown fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```[a-z]*\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `LLM returned invalid JSON: ${String(err)}\nRaw: ${raw.slice(0, 500)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`LLM returned non-array: ${cleaned.slice(0, 200)}`);
  }

  return parsed.map((item: unknown, idx: number) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`Brief item ${idx} is not an object`);
    }
    const r = item as Record<string, unknown>;

    const sceneIndex =
      typeof r["scene_index"] === "number" ? r["scene_index"] : idx;
    const sceneInput = input.scenes[sceneIndex] ?? input.scenes[idx];

    const productSlot =
      r["product_slot"] === "A" || r["product_slot"] === "B"
        ? r["product_slot"]
        : null;

    const rawPref = r["source_preference"] as string | undefined;
    const sourcePreference: FootageClipRequest["source_preference"] =
      rawPref === "youtube" ||
      rawPref === "pexels_video" ||
      rawPref === "pexels_photo" ||
      rawPref === "any"
        ? rawPref
        : defaultSourcePreference(String(r["block_type"] ?? ""));

    return {
      scene_index: sceneIndex,
      block_type: String(r["block_type"] ?? sceneInput?.block_type ?? ""),
      product_slot: productSlot,
      product_name:
        typeof r["product_name"] === "string" ? r["product_name"] : null,
      dimension: typeof r["dimension"] === "string" ? r["dimension"] : null,
      primary_query: String(r["primary_query"] ?? ""),
      source_preference: sourcePreference,
      duration_seconds:
        typeof r["duration_seconds"] === "number"
          ? r["duration_seconds"]
          : (sceneInput?.duration_seconds ?? 10),
      fallback_query: String(r["fallback_query"] ?? ""),
    } satisfies FootageClipRequest;
  });
}

/**
 * Generate a footage brief for all scenes in a TECH_COMPARISON job.
 *
 * Provider controlled by FOOTAGE_BRIEF_PROVIDER, defaulting to deepseek.
 *
 * IT DEFAULTED TO "anthropic" UNTIL 2026-08-06, and the VPS's Anthropic key
 * returns 401 (verified directly against api.anthropic.com). This is the second
 * of two dead-key call sites that kept TECH_COMPARISON at zero completed jobs:
 * once the script path was fixed, a real job wrote a 1,362-word script and then
 * died here, three attempts in sixteen seconds, and — because this processor
 * has no error handling — sat at TECH_FOOTAGE_COLLECTING with no error recorded
 * (job c65abcfe, 2026-08-06 22:14).
 *
 * deepseek is the provider that actually works: the tutorial pipeline and the
 * RANKING template both run on it in production daily.
 */
export async function generateFootageBrief(
  input: FootageBriefInput,
): Promise<FootageBrief> {
  const provider = (process.env["FOOTAGE_BRIEF_PROVIDER"] ?? "deepseek") as
    | "gemini_pool"
    | "anthropic"
    | "fastgen"
    | "deepseek";

  logger.info(
    {
      product_a: input.product_a,
      product_b: input.product_b,
      scene_count: input.scenes.length,
      provider,
    },
    "generating footage brief",
  );

  const prompt = buildPrompt(input);
  /**
   * deepseek has no branch in `callLLM` — it would silently fall through to
   * fastgen — so it routes through the tier ladder like every other deepseek
   * caller. 300s because deepseek-v4-pro is a reasoning model and the 60s
   * default is under half the measured time for a comparable prompt.
   */
  const raw =
    provider === "deepseek"
      ? await requestLLMText(prompt, {
          tier: "standard",
          maxTokens: 8_000,
          timeoutMs: 300_000,
          context: "footage-brief:TECH_COMPARISON",
        })
      : await callLLM(prompt, {
          provider,
          maxTokens: 4_000,
          timeoutMs: 60_000,
        });

  const brief = parseLLMResponse(raw, input);

  logger.info(
    {
      scene_count: brief.length,
      youtube_scenes: brief.filter((b) => b.source_preference === "youtube")
        .length,
    },
    "footage brief generated",
  );

  return brief;
}
