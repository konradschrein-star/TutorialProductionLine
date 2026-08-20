import type { Job, Queue } from "bullmq";
import type { ChildProcess } from "node:child_process";
import { eq, sql, and } from "drizzle-orm";
import type { AIGenerationPayload } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import {
  contentJobs,
  contentTemplates,
  systemEvents,
  formatStyleLibraryAssets,
  assets,
} from "@repo/db";
import { updateJobStatus } from "../utils/update-job-status.js";
import { updateJobStatusAndDispatch } from "../utils/update-and-dispatch.js";
import { AIGenerationPayloadSchema, buildErrorDetail } from "@repo/contracts";
import {
  PipelineValidationError as ValidationError,
  PipelineErrorCode,
} from "@repo/domain";
import {
  createAnthropicClient,
  generateScript,
  generateScriptWithGemini,
} from "../utils/anthropic-client.js";
import {
  createR2Client,
  uploadToR2,
  downloadFromR2,
  buildR2Key,
} from "../utils/r2-client.js";
import { loadConfig } from "@repo/config";
import type { Env } from "@repo/config";
import Anthropic from "@anthropic-ai/sdk";
import {
  sanitizePrompt,
  buildReferenceInjectedPrompt,
  parseResearchFiles,
  REFERENCE_INJECTION_ORDER,
} from "@repo/domain";
import type { WordTimestamp } from "@repo/contracts";
import { loadReferenceImage } from "../utils/per-video-assets.js";
import type { ResolvedAssetRef } from "../utils/per-video-assets.js";
import {
  requestImageBuffer,
  toGatewayFormat,
  type GatewayFormat,
} from "../utils/media-gateway/index.js";
import { generateMetadata } from "../youtube-metadata/index.js";
import type { GenerationLogEntry } from "../youtube-metadata/index.js";

/**
 * Select the best-matching asset ref from a list by scanning the prompt text
 * for keywords from each ref's description. Falls back to refs[0] if no match.
 * Never throws — always returns a valid ref or undefined.
 */
/**
 * Map the worker's resolved Buffer reference images into fast-gen data URIs.
 * Reference image content arrives as raw PNG bytes from per-video assets.
 */
function refBuffersToDataUris(
  refs: Uint8Array[] | undefined,
): string[] | undefined {
  if (!refs || refs.length === 0) return undefined;
  return refs.map(
    (u8) => `data:image/png;base64,${Buffer.from(u8).toString("base64")}`,
  );
}

/**
 * Coerce a generic aspect-ratio string to the fast-gen gateway's accepted
 * union. Anything other than the three landscape/portrait/square shapes
 * defaults to 16:9 — the gateway upstream providers only accept those.
 */
function toGatewayAspect(
  raw: string | null | undefined,
): "16:9" | "9:16" | "1:1" {
  if (raw === "9:16") return "9:16";
  if (raw === "1:1") return "1:1";
  return "16:9";
}

/**
 * Run a generation through the centralized media gateway (forge-api/VEO
 * primary, fastgen fallback until expiry — backend failover happens inside
 * the gateway). Returns the raw image bytes on success, or the error string
 * so the caller's retry/failed-marking logic can classify it. There is no
 * other image provider.
 */
async function tryFastGenImage(
  prompt: string,
  refs: Uint8Array[] | undefined,
  aspect: string,
  format: GatewayFormat,
  context: string,
): Promise<{ buffer: Buffer | null; error?: string }> {
  try {
    const buffer = await requestImageBuffer(prompt, {
      format,
      aspectRatio: toGatewayAspect(aspect),
      referenceImages: refBuffersToDataUris(refs),
      context,
    });
    return { buffer };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        level: "error",
        message: "media gateway image generation failed",
        context,
        error: message.slice(0, 300),
      }),
    );
    return { buffer: null, error: message };
  }
}

function selectBestRef(
  refs: ResolvedAssetRef[],
  promptText: string,
): ResolvedAssetRef | undefined {
  if (refs.length === 0) return undefined;
  if (refs.length === 1) return refs[0];
  const lowerPrompt = promptText.toLowerCase();
  for (const ref of refs) {
    if (!ref.description) continue;
    const keywords = ref.description.slice(0, 50).toLowerCase().split(/\s+/);
    if (keywords.some((kw) => kw.length > 3 && lowerPrompt.includes(kw))) {
      return ref;
    }
  }
  return refs[0];
}

/**
 * AI Generation Processor
 *
 * Processes queue-ai-generation jobs - TTS, LLM API calls, external AI services.
 *
 * Image generation now includes Google Gemini fallback for reliability.
 *
 * Real integrations:
 * - script: Claude Sonnet 4.5 API (Anthropic) for script generation
 * - tts: AI33 API for text-to-speech + R2 asset upload
 * - translation: Placeholder for future translation API integration
 *
 * Flow:
 * 1. Validate payload
 * 2. Load config and initialize clients
 * 3. Process each generation type:
 *    - script: Fetch template prompt, call Claude, save script, transition to ASSET_COLLECTION
 *    - tts: Call AI33 TTS, upload audio to R2, update asset manifest (no status change)
 *    - translation: Placeholder (stub implementation)
 * 4. Error handling: Use updateJobStatus with FAILED_GENERAL status
 *
 * @param db - Drizzle client
 * @param queues - Queue instances for dispatch
 * @returns Processor function for AI generation queue
 */
export function createAIGenerationProcessor(
  db: DrizzleClient,
  queues: {
    aiGeneration: Queue;
    assetCollection?: Queue;
    sceneAnalysis?: Queue;
    techFootageCollection?: Queue;
  },
) {
  console.log("🔧 [DEBUG] createAIGenerationProcessor called - FUNCTION ENTRY");
  // Load config and initialize clients once
  const config = loadConfig();
  console.log("🔧 [DEBUG] Config loaded");
  const anthropicClient = createAnthropicClient(config);
  console.log("🔧 [DEBUG] Anthropic client created");
  const r2Client = createR2Client(config);
  console.log("🔧 [DEBUG] R2 client created");
  console.log("🔧 [DEBUG] Returning processor function");

  return async (job: Job<AIGenerationPayload>) => {
    console.log(`🎯 [DEBUG] PROCESSOR FUNCTION CALLED for job ${job.id}`);
    try {
      console.log(
        JSON.stringify({
          level: "info",
          message: "Processing AI generation job",
          job_id: job.id,
          payload: job.data,
        }),
      );

      // 1. Validate payload
      const parseResult = AIGenerationPayloadSchema.safeParse(job.data);
      if (!parseResult.success) {
        const errorMessage = `Invalid payload: ${parseResult.error.message}`;
        console.error(
          JSON.stringify({
            level: "error",
            message: errorMessage,
            job_id: job.id,
            errors: parseResult.error.errors,
          }),
        );
        throw new Error(errorMessage);
      }

      const payload = parseResult.data;

      console.log(
        JSON.stringify({
          level: "debug",
          message: "AI generation processor - about to enter switch",
          job_id: job.id,
          generation_type: payload.generation_type,
        }),
      );

      // 2. Handle each generation type
      switch (payload.generation_type) {
        case "script": {
          console.log(
            JSON.stringify({
              level: "debug",
              message: "Entering handleScriptGeneration",
              job_id: job.id,
            }),
          );
          await handleScriptGeneration(db, anthropicClient, payload, queues);
          break;
        }

        case "tts": {
          console.log(
            JSON.stringify({
              level: "debug",
              message: "Entering handleTTSGeneration",
              job_id: job.id,
            }),
          );
          await handleTTSGeneration(db, config, r2Client, payload, queues);
          console.log(
            JSON.stringify({
              level: "debug",
              message: "handleTTSGeneration returned successfully",
              job_id: job.id,
            }),
          );
          break;
        }

        case "scene_image": {
          console.log(
            JSON.stringify({
              level: "debug",
              message: "Entering handleSceneImageGeneration",
              job_id: job.id,
            }),
          );
          await handleSceneImageGeneration(
            db,
            config,
            r2Client,
            payload,
            queues,
          );
          break;
        }

        case "sentence_image": {
          console.log(
            JSON.stringify({
              level: "debug",
              message: "Entering handleSentenceImageGeneration",
              job_id: job.id,
            }),
          );
          await handleSentenceImageGeneration(
            db,
            config,
            r2Client,
            payload,
            queues,
          );
          break;
        }

        case "youtube_metadata": {
          console.log(
            JSON.stringify({
              level: "debug",
              message: "Entering handleYouTubeMetadataGeneration",
              job_id: job.id,
            }),
          );
          await handleYouTubeMetadataGeneration(db, config, payload);
          break;
        }

        case "script_from_research": {
          console.log(
            JSON.stringify({
              level: "debug",
              message: "Entering handleScriptFromResearchGeneration",
              job_id: job.id,
            }),
          );
          await handleScriptFromResearchGeneration(
            db,
            anthropicClient,
            r2Client,
            payload,
            queues,
          );
          break;
        }

        default: {
          // TypeScript exhaustiveness check
          const _exhaustive: never = payload;
          throw new Error(
            `Unknown generation type: ${(_exhaustive as any).generation_type}`,
          );
        }
      }

      console.log(
        JSON.stringify({
          level: "info",
          message: "AI generation job completed",
          job_id: job.id,
          generation_type: payload.generation_type,
        }),
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error(
        JSON.stringify({
          level: "error",
          message: "AI generation processor caught unhandled error",
          job_id: job.id,
          error: errorMessage,
          stack: errorStack,
          generation_type: job.data?.generation_type,
        }),
      );

      // Try to update job status if we have a job_id
      if (job.data?.job_id) {
        try {
          await updateJobStatus(
            db,
            job.data.job_id,
            "FAILED_GENERAL",
            errorMessage,
            buildErrorDetail({
              code: "AI_GENERATION_PROCESSOR_ERROR",
              message: errorMessage,
              category: "orchestration",
              retryable: true,
              context: {
                generation_type: job.data.generation_type,
                job_id: job.data.job_id,
                error_stack: errorStack?.split("\n").slice(0, 5).join("\n"),
              },
            }),
          );
        } catch (updateError) {
          console.error(
            JSON.stringify({
              level: "error",
              message: "Failed to update job status after error",
              job_id: job.data.job_id,
              update_error:
                updateError instanceof Error
                  ? updateError.message
                  : String(updateError),
            }),
          );
        }
      }

      // Re-throw to let BullMQ handle retry logic
      throw error;
    }
  };
}

/**
 * Which LLM writes the script: the template's declared provider, then env
 * LLM_PROVIDER, then claude_pool. Gemini pool is no longer a valid default.
 *
 * Extracted so the two script-writing call sites cannot drift apart again.
 * They already had: `handleScriptGeneration` honoured the template and
 * `handleScriptFromResearchGeneration` did not, so TECH_COMPARISON silently
 * used env LLM_PROVIDER ("anthropic", dead key) no matter what its template
 * said, and every job of that format 401'd.
 */
function resolveScriptProvider(
  pipelineConfig: Record<string, unknown> | undefined | null,
): string {
  return (
    (pipelineConfig?.["script_provider"] as string | undefined) ??
    process.env["LLM_PROVIDER"] ??
    "claude_pool"
  );
}

/**
 * Run a script prompt against the resolved provider, using the SAME ladder for
 * every caller. Returns the raw text and the provider that actually served it
 * — callers record that on the job, so a downgrade is never silent.
 */
async function runScriptProvider(args: {
  provider: string;
  prompt: string;
  context: string;
  scriptFormat?: string;
  anthropicClient: Anthropic;
}): Promise<{ text: string; provider: string }> {
  const { provider, prompt, context, scriptFormat } = args;

  if (provider === "deepseek") {
    // Budgets measured in production — see the note in handleScriptGeneration.
    // A reasoning model spends max_tokens on its chain of thought too, and a
    // tight ceiling TRUNCATES rather than failing, so headroom is the defence.
    const { requestLLMText } = await import("../utils/llm-client.js");
    const text = await requestLLMText(prompt, {
      tier: "standard",
      maxTokens: 32_768,
      timeoutMs: 300_000,
      context,
    });
    return { text, provider: "deepseek" };
  }

  if (
    provider === "gemini_pool" ||
    provider === "claude_pool" ||
    provider === "ollama" ||
    provider === "anthropic"
  ) {
    // gemini_pool is dead — redirect to the env default.
    const { callLLM } = await import("../utils/llm-client.js");
    const effective =
      provider === "gemini_pool"
        ? (process.env["LLM_PROVIDER"] ?? "claude_pool")
        : provider;
    const text = await callLLM(prompt, {
      maxTokens: 8_000,
      timeoutMs: 300_000,
      provider: effective as never,
      scriptFormat,
    });
    return { text, provider: effective };
  }

  if (provider === "gemini") {
    const geminiApiKey = process.env["GEMINI_API_KEY"];
    if (!geminiApiKey) {
      throw new Error(
        "Template requires Gemini script generation but GEMINI_API_KEY is not configured",
      );
    }
    const result = await generateScriptWithGemini(prompt, geminiApiKey);
    return { text: result.script, provider: "gemini" };
  }

  const result = await generateScript(
    args.anthropicClient,
    prompt,
    "",
    scriptFormat,
  );
  return { text: result.script, provider: result.provider ?? "claude" };
}

/**
 * Handle script generation via Claude API (Task 7)
 *
 * Flow:
 * 1. Fetch template by ID
 * 2. Extract script prompt from template
 * 3. Call Claude with topic-injected prompt
 * 4. Save generated script to database
 * 5. Transition job status to ASSET_COLLECTION
 * 6. Dispatch to next queue stage
 */
async function handleScriptGeneration(
  db: DrizzleClient,
  anthropicClient: Anthropic,
  payload: Extract<AIGenerationPayload, { generation_type: "script" }>,
  queues: { aiGeneration: Queue },
): Promise<void> {
  try {
    console.log(
      JSON.stringify({
        level: "info",
        message: "Starting script generation",
        job_id: payload.job_id,
        template_id: payload.template_id,
        topic: payload.topic,
      }),
    );

    // 1. Fetch template + job metadata + current job state
    const [[template], [jobData]] = await Promise.all([
      db
        .select()
        .from(contentTemplates)
        .where(eq(contentTemplates.id, payload.template_id))
        .limit(1),
      db
        .select({
          metadata: contentJobs.metadata,
          script: contentJobs.script,
          r2_asset_manifest: contentJobs.r2_asset_manifest,
          channel_id: contentJobs.channel_id,
          language: contentJobs.language,
        })
        .from(contentJobs)
        .where(eq(contentJobs.id, payload.job_id))
        .limit(1),
    ]);

    if (!template) {
      throw new Error(`Template ${payload.template_id} not found`);
    }

    // 1a-pre. BUSINESS_PLAN_HUB writes its own script.
    //
    // The asset stage (processors/business-hub/pipeline.ts → script.ts) owns
    // scriptwriting for this format: outline-then-expand across chapters, with
    // the [[SOURCE: …]] citation gate applied per claim. Its template carries a
    // POINTER in prompts.script ("script generation is owned by the claude-pool
    // WriterSpec"), not a prompt — running the generic path here would send that
    // sentence to an LLM and persist the answer as the video's script, and the
    // asset stage trusts a non-empty content_jobs.script. So this stage does
    // nothing but move the job on.
    if (template.format === "BUSINESS_PLAN_HUB") {
      console.log(
        JSON.stringify({
          level: "info",
          message:
            "BUSINESS_PLAN_HUB: skipping generic script generation — the asset stage writes the script",
          job_id: payload.job_id,
          template_id: payload.template_id,
        }),
      );
      const businessHubQueues: {
        aiGeneration: Queue;
        assetCollection?: Queue;
      } = { aiGeneration: queues.aiGeneration };
      const businessHubAssetQueue = (queues as { assetCollection?: Queue })
        .assetCollection;
      if (businessHubAssetQueue) {
        businessHubQueues.assetCollection = businessHubAssetQueue;
      }

      // YouTube metadata still has to be generated.
      //
      // The generic path dispatches this AFTER the block we are returning from
      // (step 5, "Dispatch YouTube metadata generation in parallel"), and the
      // ingest `script_text` branch is not taken for this format either — it
      // routes through SCRIPTING like everything else. So without this the job
      // reaches AWAITING_UPLOADER with no description and no tags, and
      // pre-upload QMS rejects it on both: description < 100 chars and empty
      // generated_tags. Only the title survives, as the truncated initial_topic
      // written at ingest.
      //
      // Non-blocking and low priority, exactly as the generic path runs it: it
      // completes in seconds, long before this format's asset stage finishes.
      const [businessHubJob] = await db
        .select({ language: contentJobs.language })
        .from(contentJobs)
        .where(eq(contentJobs.id, payload.job_id))
        .limit(1);
      await queues.aiGeneration.add(
        "youtube-metadata",
        {
          generation_type: "youtube_metadata",
          job_id: payload.job_id,
          topic: payload.topic,
          format: template.format,
          language: businessHubJob?.language ?? "en",
        },
        { priority: 5 },
      );

      await updateJobStatusAndDispatch(
        db,
        payload.job_id,
        "ASSET_COLLECTION",
        businessHubQueues,
      );
      return;
    }

    // 1a. Load character roster when template supports character tracking.
    // Characters come from the format style library linked to the template.
    let characterRoster: Array<{
      id: string;
      name: string;
      description: string;
    }> = [];

    if (
      template.supports_character_tracking &&
      template.default_style_library_id
    ) {
      const charAssets = await db
        .select({
          id: formatStyleLibraryAssets.asset_id,
          name: assets.name,
          description: assets.description,
        })
        .from(formatStyleLibraryAssets)
        .innerJoin(assets, eq(formatStyleLibraryAssets.asset_id, assets.id))
        .where(
          and(
            eq(
              formatStyleLibraryAssets.library_id,
              template.default_style_library_id,
            ),
            eq(formatStyleLibraryAssets.ref_type, "character"),
          ),
        );

      characterRoster = charAssets.map((a) => ({
        id: a.id,
        name: a.name ?? "Character",
        description: a.description ?? "",
      }));

      console.log(
        JSON.stringify({
          level: "info",
          message: "Character roster loaded for character-tracking template",
          job_id: payload.job_id,
          character_count: characterRoster.length,
          template_id: payload.template_id,
        }),
      );
    }

    const templateMeta = (template.metadata as Record<string, unknown>) ?? {};
    const pipelineConfig =
      (templateMeta.pipeline_config as Record<string, unknown>) ?? {};

    // 2. Extract script prompt — for comparison format, use pre-filled prompt stored by research handler
    const meta = (jobData?.metadata as Record<string, unknown> | null) ?? {};
    const prefilledPrompt = meta.comparison_prefilled_script_prompt as
      | string
      | undefined;

    // Support both "script_generation" (explainer) and "script" (political commentary) keys
    const prompts = template.prompts as Record<string, string>;
    const templateScriptPrompt =
      prompts["script_generation"] ?? prompts["script"];

    if (!prefilledPrompt && !templateScriptPrompt) {
      throw new Error(
        `No script prompt found in template ${payload.template_id} (checked keys: script_generation, script)`,
      );
    }

    // Use pre-filled prompt if available (comparison format: contains research JSON already injected)
    // Otherwise fall back to template prompt with topic + metadata substitution
    let scriptPrompt = prefilledPrompt ?? templateScriptPrompt!;

    // 3. For non-prefilled prompts: replace template placeholders with job metadata
    if (!prefilledPrompt) {
      const complexityLevel =
        (meta.complexity_level as string | undefined) ?? "intermediate";
      const targetDuration =
        (meta.target_duration_seconds as number | undefined) ?? 180;
      const wordCount = Math.round(targetDuration * 2.5); // ~150 WPM / 60 sec = 2.5 WPM

      // Validate required fields for TECH_COMPARISON format
      if (template.format === "TECH_COMPARISON") {
        if (
          !("product_a_name" in payload) ||
          !(payload as any).product_a_name
        ) {
          throw new ValidationError(
            PipelineErrorCode.MISSING_REQUIRED_FIELD,
            "product_a_name is required for TECH_COMPARISON format",
            "product_a_name",
            undefined,
          );
        }
        if (
          !("product_b_name" in payload) ||
          !(payload as any).product_b_name
        ) {
          throw new ValidationError(
            PipelineErrorCode.MISSING_REQUIRED_FIELD,
            "product_b_name is required for TECH_COMPARISON format",
            "product_b_name",
            undefined,
          );
        }
      }

      scriptPrompt = scriptPrompt
        .replaceAll("${topic}", payload.topic)
        .replaceAll("${complexity_level}", complexityLevel)
        .replaceAll("${target_duration_seconds}", String(targetDuration))
        .replaceAll("${word_count}", String(wordCount))
        .replaceAll("${product_a_name}", (payload as any).product_a_name ?? "")
        .replaceAll("${product_b_name}", (payload as any).product_b_name ?? "");

      // RANKING: substitute ${itemsList}, ${brief} and ${context} from
      // metadata.ranking. The generic ${topic} replace above already ran.
      // Two modes:
      //   - Operator gave explicit items → list them, LLM ranks exactly those.
      //   - No items (freeform brief) → instruct the LLM to DECIDE the items
      //     itself from the brief and emit them in the JSON `items` array.
      // Without this substitution the LLM sees literal "${itemsList}" strings
      // and never emits real placements.
      if (template.format === "RANKING") {
        const ranking = meta.ranking as
          | {
              items?: Array<{
                id: string;
                name: string;
                pronunciation?: string;
              }>;
              brief?: string;
              context?: string;
              tierConfig?: {
                tiers?: Array<{ name: string; order: number }>;
              };
            }
          | undefined;
        const items = ranking?.items ?? [];
        const brief = (ranking?.brief ?? "").trim();

        // No hard minimum any more: empty items is the freeform path. We only
        // fail if there is nothing at all to work from (no items AND no brief
        // AND no topic) — the LLM would have zero signal.
        if (items.length < 2 && !brief && !payload.topic?.trim()) {
          throw new ValidationError(
            PipelineErrorCode.MISSING_REQUIRED_FIELD,
            "RANKING requires either explicit items, a brief, or a topic to rank",
            "items",
            undefined,
          );
        }

        const itemsList =
          items.length >= 2
            ? items
                .map(
                  (i) =>
                    `- id: ${i.id} | name: ${i.name}` +
                    (i.pronunciation
                      ? ` (pronounced: ${i.pronunciation})`
                      : ""),
                )
                .join("\n")
            : `(No items were provided. YOU must decide the items to rank from the brief/topic. Choose a sensible set (typically 5-12), assign each a stable id "item-1", "item-2", … in the order you introduce them, and EMIT them in the JSON "items" array as { "id", "name", "pronunciation"? }. Your placements MUST reference exactly those ids.

"name" MUST be the product's real model name, written the way a buyer would type it into a search box — "Sony SRS-XB100", "Fezibo Dual Motor Standing Desk", "Keychron V1". It is used verbatim to search for footage of the product.
  · NEVER spell a model number out in words. "Sony S R S X B one hundred" found nothing, so that item rendered as a single frozen still for its entire 40-second segment and the video failed QA. If the name is awkward to say, put the phonetic version in "pronunciation" — that field exists for exactly this and never reaches the search.
  · Keep it to brand + model. Marketing spec adjectives you invent ("Pro Series Dual Motor", "55-inch") are not part of the product's name and only make it harder to find.)`;

        // Tier labels come from the JOB's tierConfig, not from prose baked into
        // the prompt. The old prompt hard-coded "Instant Buy → Hard Pass", which
        // forced every ranking into a product-purchase frame and silently
        // diverged from metadata.ranking.tierConfig — the labels the board
        // actually renders. Substituting them keeps the narration and the
        // on-screen board describing the same tiers.
        const tiers = (ranking?.tierConfig?.tiers ?? [])
          .slice()
          .sort((a, b) => a.order - b.order);
        if (tiers.length < 2) {
          throw new ValidationError(
            PipelineErrorCode.MISSING_REQUIRED_FIELD,
            `RANKING job ${payload.job_id}: metadata.ranking.tierConfig.tiers must define at least 2 tiers (got ${tiers.length}). The narration names the tiers out loud and the board renders them; guessing a default here would make the voice describe tiers the render never draws.`,
            "tierConfig.tiers",
            undefined,
          );
        }
        const tierList = tiers
          .map(
            (t, idx) =>
              `- tierIndex ${t.order}: "${t.name}"` +
              (idx === 0
                ? " (best)"
                : idx === tiers.length - 1
                  ? " (worst)"
                  : ""),
          )
          .join("\n");

        scriptPrompt = scriptPrompt
          .replaceAll("${itemsList}", itemsList)
          .replaceAll("${brief}", brief)
          .replaceAll("${context}", ranking?.context ?? "")
          .replaceAll("${tierList}", tierList)
          .replaceAll("${language}", jobData?.language ?? "en");
      }
    }

    // 3.5. Append character roster section when template supports character tracking.
    // This informs the script writer which characters exist so they can reference them
    // by name consistently. Scene-level character_ids are assigned in scene-analysis.
    if (characterRoster.length > 0) {
      const characterRosterSection =
        `\n\nCHARACTER ROSTER (reference these characters by name in the script):\n` +
        characterRoster
          .map(
            (c) =>
              `- ID: ${c.id}\n  Name: ${c.name}\n  Description: ${c.description}`,
          )
          .join("\n") +
        `\n\nUse the character names above consistently when referring to characters in the script.`;
      scriptPrompt = `${scriptPrompt}${characterRosterSection}`;
    }

    // 4. Call script generation — provider determined by template.metadata.pipeline_config.script_provider,
    //    then env LLM_PROVIDER, defaulting to claude_pool. Gemini pool is no longer a valid default.
    const scriptProvider = resolveScriptProvider(pipelineConfig);
    const scriptStartedAt = new Date();
    const effectiveTopic = "";

    let generatedScript: string;
    let scriptInputTokens: number;
    let scriptOutputTokens: number;
    let actualProvider: string;

    if (scriptProvider === "deepseek") {
      // DeepSeek was UNREACHABLE from here until now. The old chain had no
      // "deepseek" branch, so a template declaring script_provider: "deepseek"
      // (RANKING does) fell through to generateScript(), which calls callLLM()
      // WITHOUT a provider — i.e. env LLM_PROVIDER, which is "anthropic" on the
      // VPS. The template's declared provider was silently discarded.
      //
      // Routed through the "standard" tier ladder (deepseek → ollama) rather
      // than a pinned provider, which is what the RANKING template's own
      // comment promises ("falls back to ollama via the LLM router ladder").
      //
      // Budgets, both copied from the tutorial path that has these measured in
      // production (utils/tutorial/llm-registry.ts + processors/tutorial/
      // generate.ts SCRIPT_MAX_TOKENS_SINGLE_SHOT):
      //
      //   max_tokens 32768 — deepseek-v4-pro is a reasoning model, so this cap
      //     covers its chain of thought as well as the script, and the reasoning
      //     spend swings wildly on identical prompts (413 vs 1671 measured). A
      //     tight ceiling does not fail, it TRUNCATES, so headroom is the
      //     defence and callDeepSeek now throws on finish_reason=length.
      //   timeoutMs 300000 — a real ~1,500-word script measured 137.8s
      //     wall-clock against the live API. The 120s default aborted every
      //     single tutorial job before this was raised.
      const { requestLLMText } = await import("../utils/llm-client.js");
      const rawText = await requestLLMText(scriptPrompt, {
        tier: "standard",
        maxTokens: 32_768,
        timeoutMs: 300_000,
        context: `script:${template.format ?? "unknown"}:${payload.job_id}`,
      });
      generatedScript = rawText.trim();
      scriptInputTokens = 0;
      scriptOutputTokens = 0;
      actualProvider = "deepseek";
    } else if (
      scriptProvider === "gemini_pool" ||
      scriptProvider === "claude_pool" ||
      scriptProvider === "ollama"
    ) {
      // gemini_pool is dead — redirect to env-default provider (claude_pool or ollama).
      // claude_pool and ollama route through callLLM directly.
      const { callLLM } = await import("../utils/llm-client.js");
      const effectiveProvider =
        scriptProvider === "gemini_pool"
          ? (process.env["LLM_PROVIDER"] ?? "claude_pool")
          : scriptProvider;
      const rawText = await callLLM(scriptPrompt, {
        maxTokens: 8_000,
        timeoutMs: 300_000,
        provider: effectiveProvider as any,
        scriptFormat: template.format ?? undefined,
      });
      generatedScript = rawText.trim();
      scriptInputTokens = 0;
      scriptOutputTokens = 0;
      actualProvider = effectiveProvider;
    } else if (scriptProvider === "gemini") {
      const geminiApiKey = process.env["GEMINI_API_KEY"];
      if (!geminiApiKey) {
        throw new Error(
          "Template requires Gemini script generation but GEMINI_API_KEY is not configured",
        );
      }
      const geminiResult = await generateScriptWithGemini(
        scriptPrompt,
        geminiApiKey,
      );
      generatedScript = geminiResult.script;
      scriptInputTokens = geminiResult.input_tokens;
      scriptOutputTokens = geminiResult.output_tokens;
      actualProvider = "gemini";
    } else {
      const claudeResult = await generateScript(
        anthropicClient,
        scriptPrompt,
        effectiveTopic,
        template.format ?? undefined,
      );
      generatedScript = claudeResult.script;
      scriptInputTokens = claudeResult.input_tokens;
      scriptOutputTokens = claudeResult.output_tokens;
      actualProvider = claudeResult.provider ?? "claude";
    }
    const scriptCompletedAt = new Date();

    // Fetch job for language + existing generation_log before updating
    const [jobForLog] = await db
      .select({
        language: contentJobs.language,
        generation_log: contentJobs.generation_log,
      })
      .from(contentJobs)
      .where(eq(contentJobs.id, payload.job_id))
      .limit(1);

    const scriptLogEntry: GenerationLogEntry = {
      stage: "script",
      started_at: scriptStartedAt.toISOString(),
      completed_at: scriptCompletedAt.toISOString(),
      duration_ms: scriptCompletedAt.getTime() - scriptStartedAt.getTime(),
      model:
        actualProvider === "gemini" || actualProvider === "gemini_pool"
          ? "gemini-2.0-flash"
          : actualProvider === "deepseek"
            ? "deepseek-v4-flash"
            : "claude-sonnet-4-6",
      prompt_system: scriptPrompt,
      prompt_user: payload.topic,
      raw_output: generatedScript.slice(0, 10_000),
      success: true,
      input_tokens: scriptInputTokens,
      output_tokens: scriptOutputTokens,
    };

    const existingLog =
      (jobForLog?.generation_log as GenerationLogEntry[] | null) ?? [];

    // 4. Save generated script + log entry + preserve initial_topic
    await db
      .update(contentJobs)
      .set({
        script: generatedScript,
        initial_topic: payload.topic,
        generation_log: [...existingLog, scriptLogEntry] as any,
        updated_at: new Date(),
      })
      .where(eq(contentJobs.id, payload.job_id));

    console.log(
      JSON.stringify({
        level: "info",
        message: "Script generated and saved",
        job_id: payload.job_id,
        script_length: generatedScript.length,
        duration_ms: scriptLogEntry.duration_ms,
      }),
    );

    // 4.5. RANKING: parse the LLM's JSON block into a validated RankingPlan and
    // persist it to metadata.ranking.rankingPlan. Overwrite `script` with the
    // clean narration (JSON fence stripped) so downstream TTS reads prose only.
    // Throws on malformed output — no silent fallback; renderRankingComposition
    // hard-throws without a plan anyway, so failing here is the honest path.
    if (template.format === "RANKING") {
      const { parseRankingScript } =
        await import("./ranking/ranking-analysis.js");
      const ranking = (meta.ranking ?? {}) as {
        items?: Array<{
          id: string;
          name?: string;
          pronunciation?: string;
          [k: string]: unknown;
        }>;
        [k: string]: unknown;
      };
      const existingItems = ranking.items ?? [];
      const itemIds = existingItems.map((i) => i.id);
      // knownItemIds empty → freeform mode: parseRankingScript derives the id
      // space from the LLM-emitted plan.items instead of validating against ours.
      const plan = parseRankingScript(generatedScript, itemIds);

      // In freeform mode, backfill metadata.ranking.items from the items the
      // LLM chose so footage-collection + render have real names/ids. Preserve
      // any operator-supplied fields (userFootageUrls etc.) when merging by id.
      let mergedItems = existingItems;
      if (existingItems.length < 2 && plan.items && plan.items.length > 0) {
        const byId = new Map(existingItems.map((i) => [i.id, i]));
        mergedItems = plan.items.map((pi) => ({
          ...(byId.get(pi.id) ?? {}),
          id: pi.id,
          name: pi.name,
          ...(pi.pronunciation ? { pronunciation: pi.pronunciation } : {}),
        }));
      }

      // TTS hygiene. `script` here is spoken VERBATIM by Fish Audio in
      // ranking-tts.ts — nothing between this write and the voice engine
      // touches it. Ranking content is inherently list-shaped, which is exactly
      // the shape that makes a model reach for bold, bullets and "Number 5:"
      // labels, and every one of those gets read out loud. The prompt forbids
      // them; this is the defence-in-depth layer behind it. It only ever
      // REMOVES formatting characters — it never rewrites, shortens or invents
      // spoken words, so it cannot mask a bad script the way a synthetic
      // fallback would. What it stripped is logged so the prompt-side problem
      // stays visible instead of being quietly papered over.
      const { sanitizeScriptText } =
        await import("../utils/tutorial/sanitize-script.js");
      const { normalizeDashesForSpeech } =
        await import("./ranking/ranking-analysis.js");
      const sanitized = sanitizeScriptText(
        normalizeDashesForSpeech(plan.scriptText),
      );
      if (sanitized.report.changed) {
        console.log(
          JSON.stringify({
            level: "warn",
            message:
              "RANKING narration contained formatting the voice would have read aloud — stripped before TTS",
            job_id: payload.job_id,
            removed: sanitized.report.removed,
          }),
        );
      }
      if (sanitized.text.trim().length < 200) {
        throw new Error(
          `ranking script for job ${payload.job_id} is only ${sanitized.text.trim().length} characters after sanitising. ` +
            `A ranking narration is 900+ words; this is a truncated or empty generation, ` +
            `not a script. Most likely the model spent its max_tokens budget on ` +
            `reasoning before emitting prose. Do not ship it — retry SCRIPTING.`,
        );
      }

      await db
        .update(contentJobs)
        .set({
          script: sanitized.text,
          metadata: {
            ...meta,
            ranking: {
              ...ranking,
              items: mergedItems,
              rankingPlan: { ...plan, scriptText: sanitized.text },
            },
          } as any,
          updated_at: new Date(),
        })
        .where(eq(contentJobs.id, payload.job_id));
      console.log(
        JSON.stringify({
          level: "info",
          message: "RANKING plan parsed and persisted",
          job_id: payload.job_id,
          placements: plan.placements.length,
          items: mergedItems.length,
          derived_items: existingItems.length < 2,
          target_runtime_s: plan.targetRuntimeSeconds,
          script_words: sanitized.text.split(/\s+/).filter(Boolean).length,
          sanitized: sanitized.report.removed,
        }),
      );
    }

    // 5. Dispatch YouTube metadata generation in parallel (non-blocking)
    // Runs concurrently with ASSET_COLLECTION — completes in ~5s, well before pre-upload QMS
    await queues.aiGeneration.add(
      "youtube-metadata",
      {
        generation_type: "youtube_metadata",
        job_id: payload.job_id,
        topic: payload.topic,
        format: template.format,
        language: jobForLog?.language ?? "en",
      },
      { priority: 5 }, // Lower priority than image/TTS generation
    );

    // 5.5. CRITICAL: Assemble per_video_assets BEFORE transitioning to ASSET_COLLECTION
    // This ensures reference images are ready when asset collection starts dispatching image generation jobs.
    // Fixes race condition where images were generated before per_video_assets was populated.
    const [jobRecord] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, payload.job_id))
      .limit(1);
    if (jobRecord && jobRecord.archetype_id) {
      const { assemblePerVideoAssets } =
        await import("../utils/per-video-assets.js");
      const { join } = await import("node:path");
      const localMediaRoot =
        process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";
      const refDir = join(localMediaRoot, payload.job_id, "ref");

      try {
        const perVideoAssets = await assemblePerVideoAssets(
          db,
          {
            channel_id: jobRecord.channel_id ?? undefined,
            archetype_id: jobRecord.archetype_id,
            format: jobRecord.format ?? undefined,
          },
          refDir,
        );

        const currentMeta =
          (jobRecord.metadata as Record<string, unknown>) ?? {};
        await db
          .update(contentJobs)
          .set({
            metadata: {
              ...currentMeta,
              per_video_assets: perVideoAssets,
            } as any,
            updated_at: new Date(),
          })
          .where(eq(contentJobs.id, payload.job_id));

        console.log(
          JSON.stringify({
            level: "info",
            message: "per_video_assets assembled during script completion",
            job_id: payload.job_id,
            style_guide_count: perVideoAssets.style_guide ? 1 : 0,
            character_count: perVideoAssets.characters?.length ?? 0,
            layout_reference_count: perVideoAssets.layout_reference ? 1 : 0,
          }),
        );
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: "warn",
            message:
              "per_video_assets assembly failed during script completion - will retry in asset collection",
            job_id: payload.job_id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    // 6. Transition to ASSET_COLLECTION status and dispatch to next queue
    const dispatchQueues: any = {
      aiGeneration: queues.aiGeneration,
    };
    const assetQueue = (queues as any).assetCollection;
    if (assetQueue) {
      dispatchQueues.assetCollection = assetQueue;
    }
    await updateJobStatusAndDispatch(
      db,
      payload.job_id,
      "ASSET_COLLECTION",
      dispatchQueues,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        level: "error",
        message: "Script generation failed",
        job_id: payload.job_id,
        error: errorMessage,
      }),
    );
    await updateJobStatus(
      db,
      payload.job_id,
      "FAILED_GENERAL",
      errorMessage,
      buildErrorDetail({
        code: "SCRIPT_GENERATION_FAILED",
        message: errorMessage,
        category: "external_service",
        retryable: true,
        context: { generation_type: "script", job_id: payload.job_id },
      }),
    );
    throw error;
  }
}

/**
 * Handle YouTube metadata generation via local Gemma model.
 *
 * Flow:
 * 1. Fetch job script and language from DB
 * 2. Call generateMetadata() from youtube-metadata service
 * 3. If successful: overwrite title, description, generated_tags with Gemma output
 * 4. Always: append GenerationLogEntry to generation_log (prompt + raw output + timing)
 * 5. Never changes job status — enrichment only
 *
 * Failure is soft: log the error entry, leave existing placeholder metadata intact.
 * The pre-upload QMS check will surface missing/placeholder metadata to the operator.
 */
async function handleYouTubeMetadataGeneration(
  db: DrizzleClient,
  config: Env,
  payload: Extract<
    AIGenerationPayload,
    { generation_type: "youtube_metadata" }
  >,
): Promise<void> {
  const { job_id, topic, format, language } = payload;

  console.log(
    JSON.stringify({
      level: "info",
      message: "Starting YouTube metadata generation",
      job_id,
    }),
  );

  // 1. Fetch script from DB
  const [job] = await db
    .select({
      script: contentJobs.script,
      generation_log: contentJobs.generation_log,
    })
    .from(contentJobs)
    .where(eq(contentJobs.id, job_id))
    .limit(1);

  if (!job) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "youtube_metadata: job not found",
        job_id,
      }),
    );
    return;
  }

  if (!job.script || job.script.trim().length < 50) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message:
          "youtube_metadata: script too short or missing, skipping metadata generation",
        job_id,
        script_length: job.script?.length ?? 0,
      }),
    );
    return;
  }

  // 2. Generate metadata via Gemma
  const { metadata, logEntry } = await generateMetadata(
    { script: job.script, topic, format, language },
    {
      url: (config as any).OLLAMA_URL as string,
      model: (config as any).OLLAMA_MODEL as string,
    },
  );

  const existingLog = (job.generation_log as GenerationLogEntry[] | null) ?? [];

  // 3. Build the DB update — always append log, only update metadata on success
  const updatePayload: Record<string, unknown> = {
    generation_log: [...existingLog, logEntry] as any,
    updated_at: new Date(),
  };

  if (metadata) {
    updatePayload.title = metadata.title;
    updatePayload.description = metadata.description;
    updatePayload.generated_tags = metadata.tags;
  }

  await db
    .update(contentJobs)
    .set(updatePayload as any)
    .where(eq(contentJobs.id, job_id));

  if (metadata) {
    console.log(
      JSON.stringify({
        level: "info",
        message: "YouTube metadata generated and saved",
        job_id,
        title: metadata.title,
        description_length: metadata.description.length,
        tag_count: metadata.tags.length,
        duration_ms: logEntry.duration_ms,
      }),
    );
  } else {
    console.warn(
      JSON.stringify({
        level: "warn",
        message:
          "YouTube metadata generation failed — placeholder metadata preserved",
        job_id,
        error: logEntry.error,
        duration_ms: logEntry.duration_ms,
      }),
    );
  }
}

/**
 * Handle TTS generation with expert splicing protocol (Task 10)
 *
 * Flow:
 * 1. Chunk script by paragraph
 * 2. Generate each chunk with TTS provider (no padding in request)
 * 3. Add 500ms silence padding to each chunk via FFmpeg
 * 4. Expert splice: strip padding, crossfade, breath pauses, normalize, analog floor
 * 5. Probe duration and calculate frames
 * 6. Upload final audio to R2
 * 7. Update manifest and duration_frames
 * 8. Cleanup temp files
 */
async function handleTTSGeneration(
  db: DrizzleClient,
  config: Env,
  r2Client: null,
  payload: Extract<AIGenerationPayload, { generation_type: "tts" }>,
  queues: { assetCollection?: Queue },
): Promise<void> {
  console.log(
    JSON.stringify({
      level: "debug",
      message: "handleTTSGeneration - function entry",
      job_id: payload.job_id,
      voice_id: payload.voice_id,
      text_length: payload.text?.length || 0,
      has_text: !!payload.text,
    }),
  );

  console.log(
    JSON.stringify({
      level: "debug",
      message: "handleTTSGeneration - importing modules",
      job_id: payload.job_id,
    }),
  );

  const [fsModule, pathModule, osModule] = await Promise.all([
    import("fs"),
    import("path"),
    import("os"),
  ]);

  console.log(
    JSON.stringify({
      level: "debug",
      message: "handleTTSGeneration - modules imported, creating temp dir",
      job_id: payload.job_id,
    }),
  );

  const tempDir = await fsModule.promises.mkdtemp(
    pathModule.join(osModule.tmpdir(), "tts-chunks-"),
  );

  console.log(
    JSON.stringify({
      level: "debug",
      message: "handleTTSGeneration - temp dir created",
      job_id: payload.job_id,
      temp_dir: tempDir,
    }),
  );

  try {
    console.log(
      JSON.stringify({
        level: "info",
        message: "Starting TTS generation with expert splicing",
        job_id: payload.job_id,
        voice_id: payload.voice_id,
        text_length: payload.text.length,
      }),
    );

    // Fetch job for channel_id
    const [job] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, payload.job_id))
      .limit(1);

    if (!job) {
      throw new Error(`Job ${payload.job_id} not found`);
    }

    // Check if custom narration is provided - skip TTS if so
    if (job.narration_source_path) {
      console.log(
        JSON.stringify({
          level: "info",
          message: "Custom narration provided, skipping TTS generation",
          job_id: payload.job_id,
          narration_path: job.narration_source_path,
        }),
      );

      // Copy custom narration to R2 and update manifest
      const fs = await import("fs");
      const narrationBuffer = await fs.promises.readFile(
        job.narration_source_path,
      );

      const r2Key = buildR2Key(job.channel_id, job.id, "custom-narration.mp3");

      await uploadToR2(null, "", r2Key, narrationBuffer, "audio/mpeg");

      console.log(
        JSON.stringify({
          level: "info",
          message: "Custom narration uploaded to R2",
          job_id: job.id,
          r2_key: r2Key,
        }),
      );

      // Update r2_asset_manifest
      // Guard: the column defaults to {} (object) not [] (array), so normalise here.
      const existingManifest = Array.isArray(job.r2_asset_manifest)
        ? (job.r2_asset_manifest as any[])
        : [];
      const updatedManifest = [
        ...existingManifest.filter((a: any) => a.type !== "audio/tts"),
        {
          type: "audio/tts",
          key: r2Key,
          size_bytes: narrationBuffer.length,
          uploaded_at: new Date().toISOString(),
        },
      ];

      await db
        .update(contentJobs)
        .set({ r2_asset_manifest: updatedManifest })
        .where(eq(contentJobs.id, job.id));

      console.log(
        JSON.stringify({
          level: "info",
          message: "Custom narration - job manifest updated, TTS skipped",
          job_id: job.id,
        }),
      );

      // Run Whisper on the narration file so downstream pacing has
      // word_timestamps + duration_frames. Without this, v3-ffmpeg renders
      // fail with "Scene 0 has no duration_frames" because the orchestrator
      // pacing step gates on word_timestamps presence.
      try {
        const { spawn } = await import("node:child_process");
        const { join, dirname } = await import("node:path");
        const { runWhisper: runWhisperOnNarration } =
          await import("@repo/media-core");
        const audioPath = join(
          dirname(job.narration_source_path),
          `${job.id}_narration_audio.wav`,
        );
        await new Promise<void>((resolve, reject) => {
          // @ts-ignore — ChildProcess type mismatch between TS versions
          const ff = spawn("ffmpeg", [
            "-i",
            job.narration_source_path as string,
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-y",
            audioPath,
          ]);
          let stderr = "";
          ff.stderr?.on("data", (d) => {
            stderr += d.toString();
          });
          ff.on("close", (code: number | null) => {
            code === 0
              ? resolve()
              : reject(
                  new Error(
                    `ffmpeg narration extract ${code}: ${stderr.slice(-200)}`,
                  ),
                );
          });
        });
        const narrationWords = await runWhisperOnNarration(audioPath);
        // Compute total duration in frames (assume 30fps unless template says
        // otherwise — we don't know fps here, so default 30; v3-ffmpeg
        // re-anchors per-template).
        const lastWord = narrationWords[narrationWords.length - 1] as
          | ((typeof narrationWords)[number] & { end_time?: number })
          | undefined;
        const durationSeconds = lastWord?.end_time ?? lastWord?.end ?? 0;
        const durationFrames = Math.max(
          1,
          Math.round((durationSeconds as number) * 30),
        );
        const currentAssemblyManifest =
          (job.assembly_manifest as Record<string, unknown>) ?? {};
        await db.execute(sql`
          UPDATE content_jobs
          SET
            duration_frames = ${durationFrames},
            assembly_manifest = ${JSON.stringify({
              ...currentAssemblyManifest,
              word_timestamps: narrationWords,
            })}::jsonb,
            updated_at = NOW()
          WHERE id = ${job.id}
        `);
        console.log(
          JSON.stringify({
            level: "info",
            message:
              "Custom narration — Whisper word_timestamps + duration_frames computed",
            job_id: job.id,
            word_count: narrationWords.length,
            duration_frames: durationFrames,
          }),
        );
      } catch (whisperErr) {
        console.error(
          JSON.stringify({
            level: "error",
            message:
              "Custom narration Whisper failed — downstream pacing will fail",
            job_id: job.id,
            error:
              whisperErr instanceof Error
                ? whisperErr.message
                : String(whisperErr),
          }),
        );
      }

      // Re-trigger asset collection so the pacing step sees the new
      // word_timestamps + duration_frames.
      if (queues.assetCollection) {
        await queues.assetCollection.add("collect-assets", {
          job_id: payload.job_id,
        });
      }

      // Cleanup temp dir and return early
      await fsModule.promises.rm(tempDir, { recursive: true, force: true });
      return;
    }

    // Step 1: Chunk script by paragraph (1-4 sentences each)
    // Filter out scene markers and separators (HOOK, ---, etc.)
    const isSceneMarker = (text: string): boolean => {
      const trimmed = text.trim();
      // Skip empty
      if (!trimmed) return true;
      // Skip separators (---, ===, ___, :::, etc.)
      if (/^[\-_=:]{3,}$/.test(trimmed)) return true;
      // Skip single-word all-caps markers (HOOK, INTRO, VERDICT, CTA, etc.)
      if (/^[A-Z_]+$/.test(trimmed) && trimmed.split(/\s+/).length === 1)
        return true;
      // Skip very short text (< 10 chars) likely to be markers
      if (trimmed.length < 10) return true;
      return false;
    };

    const paragraphs = payload.text
      .split("\n\n")
      .filter((p) => !isSceneMarker(p));
    console.log(
      JSON.stringify({
        level: "info",
        message: "Script chunked into paragraphs",
        job_id: payload.job_id,
        paragraph_count: paragraphs.length,
      }),
    );

    // Step 2 & 3: Generate each chunk and add padding
    const { addSilencePadding, expertSpliceChunks, probeAudioDuration } =
      await import("../utils/ffmpeg-tts-splicing.js");
    const fs = fsModule.promises;
    const path = pathModule;

    // VIDEO_ESSAY uses ElevenLabs via AI33 V3 proxy; all other formats use the DB voice config.
    const ELEVENLABS_ESSAY_VOICE = "iiidtqDt9FBdT1vfBluA";
    let generateChunk: (text: string) => Promise<Buffer>;

    if (job.format === "VIDEO_ESSAY") {
      const { requestTTS } = await import("../utils/tts-gateway.js");
      generateChunk = (text) =>
        requestTTS(text, ELEVENLABS_ESSAY_VOICE, { format: "VIDEO_ESSAY" });
      console.log(
        JSON.stringify({
          level: "info",
          message: "VIDEO_ESSAY: using ElevenLabs TTS via tts-gateway",
          job_id: payload.job_id,
          voice_id: ELEVENLABS_ESSAY_VOICE,
        }),
      );
    } else {
      const { getTTSVoiceByDatabaseId } = await import("@repo/db/repositories");

      const voiceConfig = await getTTSVoiceByDatabaseId(db, payload.voice_id);
      if (!voiceConfig) {
        throw new Error(`Voice ID ${payload.voice_id} not found in database`);
      }
      if (!voiceConfig.is_active) {
        throw new Error(
          `Voice ${voiceConfig.name} (${payload.voice_id}) is not active`,
        );
      }

      console.log(
        JSON.stringify({
          level: "info",
          message: "Using TTS voice from database",
          job_id: payload.job_id,
          voice_name: voiceConfig.name,
          provider: voiceConfig.provider,
          voice_id: voiceConfig.voice_id,
        }),
      );

      const providerSettings = voiceConfig.settings
        ? (JSON.parse(voiceConfig.settings) as Record<string, unknown>)
        : {};

      if (
        voiceConfig.provider === "EdgeTTS" ||
        voiceConfig.provider === "EDGE_TTS"
      ) {
        if (!config.EDGE_TTS_API_KEY || !config.EDGE_TTS_API_URL) {
          throw new Error(
            "EDGE_TTS_API_KEY and EDGE_TTS_API_URL must be configured to use Edge TTS voices",
          );
        }
        const { createTTSProvider } = await import("../utils/tts-provider.js");
        const { withTTSSlot } = await import("../utils/tts-gateway.js");
        const edgeProvider = createTTSProvider(
          config.EDGE_TTS_API_KEY,
          voiceConfig.provider,
          { ...providerSettings, apiUrl: config.EDGE_TTS_API_URL },
        );
        // EdgeTTS goes through the gateway queue too — admission control
        // only; the provider call itself is unchanged.
        generateChunk = (text) =>
          withTTSSlot(
            {
              format: toGatewayFormat(job.format as string),
              provider: "edge-tts",
              context: `job:${payload.job_id}`,
              textLength: text.length,
            },
            () => edgeProvider.generateChunk(text, voiceConfig.voice_id),
          );
      } else {
        const { requestTTS } = await import("../utils/tts-gateway.js");
        // Voice provider selects the gateway engine. "Fish" voices (managed in
        // Settings → TTS Voices, voice_id = a Fish reference_id) route to Fish
        // Audio; AI33/Minimax → minimax; everything else → elevenlabs.
        const engine: "elevenlabs" | "minimax" | "fish" =
          voiceConfig.provider === "Fish" ||
          voiceConfig.provider === "FishAudio" ||
          voiceConfig.provider === "FISH_AUDIO"
            ? "fish"
            : voiceConfig.provider === "AI33" ||
                voiceConfig.provider === "Minimax"
              ? "minimax"
              : "elevenlabs";
        generateChunk = (text) =>
          requestTTS(text, voiceConfig.voice_id, {
            format: toGatewayFormat(job.format as string),
            engine,
            speed: providerSettings["speed"] as number | undefined,
            similarity: providerSettings["similarity"] as number | undefined,
          });
      }
    }

    // Generate TTS chunks in parallel (up to 3 concurrent) for faster processing
    const { limitConcurrency } =
      await import("../utils/adaptive-rate-limiter.js");

    const chunkTasks = paragraphs.map((paragraph, i) => async () => {
      // Per-chunk retry for transient API failures
      let chunkBuffer: Buffer;
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          chunkBuffer = await generateChunk(paragraph);
          break;
        } catch (err) {
          if (attempt === maxAttempts) throw err;
          const delay = 1000 * attempt;
          console.log(
            JSON.stringify({
              level: "warn",
              message: `TTS chunk ${i} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms`,
              job_id: payload.job_id,
              chunk_index: i,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      const rawChunkPath = path.join(tempDir, `chunk_${i}_raw.mp3`);
      await fs.writeFile(rawChunkPath, chunkBuffer!);

      const paddedChunkPath = path.join(tempDir, `chunk_${i}_padded.mp3`);
      await addSilencePadding(rawChunkPath, paddedChunkPath, 500);

      console.log(
        JSON.stringify({
          level: "info",
          message: "Chunk generated and padded",
          job_id: payload.job_id,
          chunk_index: i,
          chunk_size: chunkBuffer!.length,
        }),
      );

      // Update job's updated_at timestamp to signal progress (prevents watchdog timeout)
      await db
        .update(contentJobs)
        .set({ updated_at: new Date() })
        .where(eq(contentJobs.id, payload.job_id));

      return paddedChunkPath;
    });

    const chunkResults = await limitConcurrency(chunkTasks, 3);

    // Collect results in order, fail if any chunk failed
    const paddedChunkPaths: string[] = [];
    for (let i = 0; i < chunkResults.length; i++) {
      const result = chunkResults[i];
      if (result.status === "rejected") {
        throw new Error(`TTS chunk ${i} failed: ${result.reason}`);
      }
      paddedChunkPaths.push(result.value);
    }

    // Step 4: Expert splice all chunks
    const splicedAudioPath = path.join(tempDir, "final_audio.wav");
    const paragraphBoundaries = Array.from(
      { length: paragraphs.length - 1 },
      (_, i) => i + 1,
    );

    await expertSpliceChunks(
      paddedChunkPaths,
      splicedAudioPath,
      paragraphBoundaries,
    );

    console.log(
      JSON.stringify({
        level: "info",
        message: "Expert splicing complete",
        job_id: payload.job_id,
      }),
    );

    // Step 5: Probe duration
    const durationSeconds = await probeAudioDuration(splicedAudioPath);
    const durationFrames = Math.ceil(durationSeconds * 30);

    console.log(
      JSON.stringify({
        level: "info",
        message: "Audio duration probed",
        job_id: payload.job_id,
        duration_seconds: durationSeconds,
        duration_frames: durationFrames,
      }),
    );

    // Step 6: Save to local storage
    const audioBuffer = await fs.readFile(splicedAudioPath);
    const r2Key = buildR2Key(job.channel_id, payload.job_id, "audio_tts.wav");
    await uploadToR2(r2Client, "", r2Key, audioBuffer, "audio/wav");

    console.log(
      JSON.stringify({
        level: "info",
        message: "TTS audio saved to local storage",
        job_id: payload.job_id,
        key: r2Key,
        size_bytes: audioBuffer.length,
      }),
    );

    // Step 7: Run Whisper to extract word timestamps for subtitle generation
    console.log(
      JSON.stringify({
        level: "info",
        message: "Running Whisper to extract word timestamps for subtitles",
        job_id: payload.job_id,
      }),
    );

    const { runWhisper } = await import("@repo/media-core");
    const wordTimestamps = await runWhisper(splicedAudioPath);

    console.log(
      JSON.stringify({
        level: "info",
        message: "Whisper extraction complete",
        job_id: payload.job_id,
        word_count: wordTimestamps.length,
      }),
    );

    // Step 8: Update manifest, duration_frames, and word_timestamps atomically.
    // Use jsonb_set for word_timestamps so concurrent writes to other manifest fields
    // (e.g. scenes written by tech-footage-collection) are not overwritten.
    await db.execute(sql`
      UPDATE content_jobs
      SET
        r2_asset_manifest = (
          SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(COALESCE(r2_asset_manifest, '[]'::jsonb)) = 'array'
                 THEN COALESCE(r2_asset_manifest, '[]'::jsonb)
                 ELSE '[]'::jsonb
            END
          ) AS elem
          WHERE elem->>'type' <> 'audio/tts'
        ) || ${JSON.stringify([{ key: r2Key, type: "audio/tts", size_bytes: audioBuffer.length }])}::jsonb,
        duration_frames = ${durationFrames},
        assembly_manifest = jsonb_set(
          COALESCE(assembly_manifest, '{}'::jsonb),
          '{word_timestamps}',
          ${JSON.stringify(wordTimestamps)}::jsonb,
          true
        ),
        updated_at = NOW()
      WHERE id = ${payload.job_id}
    `);

    console.log(
      JSON.stringify({
        level: "info",
        message: "TTS generation completed",
        job_id: payload.job_id,
        duration_frames: durationFrames,
      }),
    );

    // Re-trigger asset collection coordinator to check if all assets are complete
    if (queues.assetCollection) {
      await queues.assetCollection.add("collect-assets", {
        job_id: payload.job_id,
      });
      console.log(
        JSON.stringify({
          level: "info",
          message: "Re-triggered asset collection after TTS completion",
          job_id: payload.job_id,
        }),
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        level: "error",
        message: "TTS generation failed",
        job_id: payload.job_id,
        voice_id: payload.voice_id,
        language: payload.language,
        text_length: payload.text.length,
        text_snippet: payload.text.slice(0, 200),
        error: errorMessage,
      }),
    );
    await updateJobStatus(
      db,
      payload.job_id,
      "FAILED_GENERAL",
      errorMessage,
      buildErrorDetail({
        code: "TTS_GENERATION_FAILED",
        message: errorMessage,
        category: "external_service",
        retryable: true,
        context: {
          generation_type: "tts",
          job_id: payload.job_id,
          voice_id: payload.voice_id,
          language: payload.language,
          text_length: payload.text.length,
        },
      }),
    );
    throw error;
  } finally {
    // Step 8: Cleanup temp files
    try {
      const fs = await import("fs").then((m) => m.promises);
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log(
        JSON.stringify({
          level: "debug",
          message: "handleTTSGeneration - temp dir cleaned up",
          job_id: payload.job_id,
          temp_dir: tempDir,
        }),
      );
    } catch (cleanupError) {
      console.error(
        JSON.stringify({
          level: "warn",
          message: "Failed to cleanup temp dir",
          job_id: payload.job_id,
          temp_dir: tempDir,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        }),
      );
    }
  }
}

/**
 * Handle scene image generation via AI33 API (Task 11)
 *
 * Called for each scene during parallel asset generation.
 * Implements 4-level progressive fallback on failure:
 *   Level 0: Enriched prompt (full photography specs)
 *   Level 1: Simplified (remove reality modifiers)
 *   Level 2: Stripped (core subject + setting only)
 *   Level 3: Ultra-simple generic (last resort)
 */
async function handleSceneImageGeneration(
  db: DrizzleClient,
  config: Env,
  r2Client: null,
  payload: Extract<AIGenerationPayload, { generation_type: "scene_image" }>,
  queues: { aiGeneration: Queue; assetCollection?: Queue },
): Promise<void> {
  try {
    // Use enriched prompt if available, fall back to raw prompt
    const primaryPrompt = sanitizePrompt(
      payload.enriched_image_prompt ?? payload.image_prompt,
    );

    // Fetch job + template for channel_id and image model config
    const [job] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, payload.job_id))
      .limit(1);

    if (!job) {
      throw new Error(`Job ${payload.job_id} not found`);
    }

    // MANUAL MODE: Skip image generation, leave visual_asset_key null for VA upload
    if (job.image_generation_mode === "manual") {
      console.log(
        JSON.stringify({
          level: "info",
          message:
            "Skipping scene image generation (manual mode) - prompt stored, VA will upload via Hub UI",
          job_id: payload.job_id,
          scene_index: payload.scene_index,
          image_generation_mode: job.image_generation_mode,
        }),
      );

      // Mark the scene as awaiting manual upload in assembly_manifest
      await db.execute(sql`
        UPDATE content_jobs
        SET assembly_manifest = jsonb_set(
          assembly_manifest,
          ${`{scenes}`}::text[],
          (
            SELECT jsonb_agg(
              CASE
                WHEN (scene->>'scene_index')::int = ${payload.scene_index}
                THEN jsonb_set(
                  scene,
                  ${`{generation_status}`}::text[],
                  '"awaiting_manual_upload"'::jsonb
                )
                ELSE scene
              END
            )
            FROM jsonb_array_elements(assembly_manifest->'scenes') AS scene
          )
        )
        WHERE id = ${payload.job_id}
      `);

      // Re-trigger convergence check so it knows this scene is in manual mode
      if (queues.assetCollection) {
        await queues.assetCollection.add("collect-assets", {
          job_id: payload.job_id,
        });
      }
      return;
    }

    // Read image model preference from template render_config
    const [template] = await db
      .select()
      .from(contentTemplates)
      .where(eq(contentTemplates.id, job.template_id))
      .limit(1);

    const templateRenderConfig = (template?.render_config as any) ?? {};
    const imageModelPref: string = templateRenderConfig.image_model ?? "nanob2";

    const MODEL_MAP: Record<
      string,
      { id: string; resolution: string } | undefined
    > = {
      // TEMPORARY (~2026-05-28): pro model while Google credits last; switch to AI33 after.
      nanob2: { id: "gemini-3-pro-image-preview", resolution: "2K" },
      seedream: { id: "bytedance-seedream-4.5", resolution: "2K" },
      "seedream-4.5-1k": { id: "bytedance-seedream-4.5", resolution: "1K" },
    };
    const modelOverride = MODEL_MAP[imageModelPref];

    console.log(
      JSON.stringify({
        level: "info",
        message: "Starting scene image generation",
        job_id: payload.job_id,
        scene_index: payload.scene_index,
        has_enriched_prompt: !!payload.enriched_image_prompt,
        model_preference: imageModelPref,
        actual_model_id: modelOverride?.id ?? "default",
      }),
    );

    // PRIMARY: Google Gemini Pro image generation (gemini-3-pro-image-preview)
    let imageBuffer: Buffer | null = null;
    let provider = "unknown";

    // ── Reference image injection ─────────────────────────────────────────────
    // Load per-video reference assets (assembled by asset-collection processor)
    // and inject them into the prompt in canonical order (@img1 = style guide, etc.)
    let resolvedPrompt = primaryPrompt;
    let resolvedReferenceImages: Uint8Array[] | undefined;

    const perVideoAssets = (job.metadata as any)?.per_video_assets;
    if (perVideoAssets) {
      const slots: Partial<Record<string, Buffer>> = {};

      if (perVideoAssets.style_guide?.file_path) {
        const buf = await loadReferenceImage(
          perVideoAssets.style_guide.file_path,
        );
        if (buf) slots["style_guide"] = buf;
      }

      // Load layout_reference for composite PowerPoint-style images (Explainer V2)
      if (perVideoAssets.layout_reference?.file_path) {
        const buf = await loadReferenceImage(
          perVideoAssets.layout_reference.file_path,
        );
        if (buf) slots["layout_reference"] = buf;
      }

      // Select character ref: use scene-level character_ids when template supports
      // character tracking; fall back to first character asset otherwise.
      const supportsCharTracking =
        (template?.metadata as any)?.supports_character_tracking === true;
      const sceneForCharIds = (job.assembly_manifest as any)?.scenes?.[
        payload.scene_index
      ];
      const sceneCharIds: string[] = sceneForCharIds?.character_ids ?? [];
      const characterAssets: ResolvedAssetRef[] =
        perVideoAssets.characters ?? [];

      let charRef: ResolvedAssetRef | undefined;
      if (supportsCharTracking && sceneCharIds.length > 0) {
        charRef = characterAssets.find((c) =>
          sceneCharIds.includes(c.asset_id),
        );
      }
      // Fall back to first character if no scene assignment or tracking disabled
      charRef ??= characterAssets[0];

      if (charRef?.file_path) {
        const buf = await loadReferenceImage(charRef.file_path);
        if (buf) slots["character"] = buf;
      }

      // Inject background ref (previously loaded but not injected — now actually used)
      const bgRef: ResolvedAssetRef | undefined =
        perVideoAssets.backgrounds?.[0];
      if (bgRef?.file_path) {
        const buf = await loadReferenceImage(bgRef.file_path);
        if (buf) slots["background"] = buf;
      }

      if (Object.keys(slots).length > 0) {
        const injected = buildReferenceInjectedPrompt({
          basePrompt: primaryPrompt,
          slots: slots as any,
        });
        resolvedPrompt = injected.prompt;
        resolvedReferenceImages = injected.referenceImages;
      }
    }

    // ── Style suffix injection ────────────────────────────────────────────────
    // Append template style_preset.prompt_suffix to suppress photorealistic language
    // (e.g. "no photorealism, no photography, no text, no labels...") at generation
    // time so the stored enriched_image_prompt is left unchanged.
    const styleSuffix: string | undefined = (template?.metadata as any)
      ?.style_preset?.prompt_suffix;
    if (styleSuffix?.trim()) {
      resolvedPrompt = `${resolvedPrompt}, ${styleSuffix.trim()}`;
    }

    // The media gateway is the ONLY image provider (forge-api/VEO primary,
    // fastgen fallback until expiry) — see docs/MEDIA_GATEWAYS.md. The
    // deprecated GoogleDirect fallback was removed 2026-07.
    if (!imageBuffer) {
      const genResult = await tryFastGenImage(
        resolvedPrompt,
        resolvedReferenceImages,
        payload.aspect_ratio,
        toGatewayFormat(job.format as string),
        `scene:${payload.scene_index}`,
      );
      imageBuffer = genResult.buffer;
      if (imageBuffer) provider = "media-gateway";
    }

    if (!imageBuffer) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Scene image generation failed on all providers",
          job_id: payload.job_id,
          scene_index: payload.scene_index,
        }),
      );

      // Mark this scene's image as failed in the manifest
      await db.execute(sql`
        UPDATE content_jobs
        SET assembly_manifest = jsonb_set(
          assembly_manifest,
          ${`{scenes}`}::text[],
          (
            SELECT jsonb_agg(
              CASE
                WHEN (scene->>'scene_index')::int = ${payload.scene_index}
                THEN jsonb_set(
                  scene,
                  ${`{generation_status}`}::text[],
                  '"failed"'::jsonb
                )
                ELSE scene
              END
            )
            FROM jsonb_array_elements(assembly_manifest->'scenes') AS scene
          )
        )
        WHERE id = ${payload.job_id}
      `);

      // Re-trigger convergence check
      if (queues.assetCollection) {
        await queues.assetCollection.add("collect-assets", {
          job_id: payload.job_id,
        });
      }
      return;
    }

    console.log(
      JSON.stringify({
        level: "info",
        message: "Scene image generated",
        job_id: payload.job_id,
        scene_index: payload.scene_index,
        image_size_bytes: imageBuffer.length,
        provider,
      }),
    );

    // Build R2 key and upload
    const r2Key = buildR2Key(
      job.channel_id,
      payload.job_id,
      `scene_${payload.scene_index}_broll.png`,
    );
    await uploadToR2(r2Client, "", r2Key, imageBuffer, "image/png");

    console.log(
      JSON.stringify({
        level: "info",
        message: "Scene image uploaded to R2",
        job_id: payload.job_id,
        scene_index: payload.scene_index,
        r2_key: r2Key,
      }),
    );

    // Atomic updates to prevent race conditions with concurrent scene image completions
    // 1. Append to r2_asset_manifest array atomically
    // 2. Set visual_asset_key on the specific scene in assembly_manifest atomically
    // 3. If a video_timelines row exists, flip the latest regen_request status to "complete"
    //    and update preview_r2_key for the scene so the editor canvas reflects the new image.
    // 4. Emit pg_notify so the Hub SSE layer pushes a scene_image_complete event to the editor.
    await db.execute(sql`
      UPDATE content_jobs
      SET
        r2_asset_manifest = CASE WHEN jsonb_typeof(COALESCE(r2_asset_manifest, '[]'::jsonb)) = 'array'
                                 THEN COALESCE(r2_asset_manifest, '[]'::jsonb)
                                 ELSE '[]'::jsonb
                            END || ${JSON.stringify({
                              key: r2Key,
                              type: "image/broll",
                              size_bytes: imageBuffer.length,
                              scene_index: payload.scene_index,
                            })}::jsonb,
        assembly_manifest = jsonb_set(
          COALESCE(assembly_manifest, '{"scenes":[]}'::jsonb),
          ${`{scenes,${payload.scene_index},visual_asset_key}`},
          ${JSON.stringify(r2Key)}::jsonb
        ),
        updated_at = NOW()
      WHERE id = ${payload.job_id}
    `);

    // Update the video_timelines edit layer if one exists:
    // - Set preview_r2_key for the regenerated scene
    // - Flip the most-recent regeneration_request status to "complete"
    //
    // PostgreSQL jsonb_set does NOT support negative array indices (-1), so we
    // first SELECT the current regen request count, then UPDATE using the explicit
    // last index. Two queries is cleaner than a CTE with string-concatenated paths.
    const regenCountResult = await db.execute(sql`
      SELECT COALESCE(
        jsonb_array_length(
          timeline_data->'scenes'->${payload.scene_index}->'regeneration_requests'
        ), 0
      ) AS cnt
      FROM video_timelines
      WHERE job_id = ${payload.job_id}
        AND jsonb_array_length(timeline_data->'scenes') > ${payload.scene_index}
    `);
    const regenCount = Number((regenCountResult[0] as any)?.cnt ?? 0);
    const lastRegenIdx = regenCount - 1;

    if (regenCount > 0) {
      // Flip the last regen request to "complete" and update the preview key
      await db.execute(sql`
        UPDATE video_timelines
        SET
          timeline_data = jsonb_set(
            jsonb_set(
              timeline_data,
              ${`{scenes,${payload.scene_index},preview_r2_key}`},
              ${JSON.stringify(r2Key)}::jsonb
            ),
            ${`{scenes,${payload.scene_index},regeneration_requests,${lastRegenIdx},status}`},
            '"complete"'::jsonb
          ),
          updated_at = NOW()
        WHERE job_id = ${payload.job_id}
          AND jsonb_array_length(timeline_data->'scenes') > ${payload.scene_index}
      `);
    } else {
      // No regen requests (manual refresh or first generation) — just update the preview key
      await db.execute(sql`
        UPDATE video_timelines
        SET
          timeline_data = jsonb_set(
            timeline_data,
            ${`{scenes,${payload.scene_index},preview_r2_key}`},
            ${JSON.stringify(r2Key)}::jsonb
          ),
          updated_at = NOW()
        WHERE job_id = ${payload.job_id}
          AND jsonb_array_length(timeline_data->'scenes') > ${payload.scene_index}
      `);
    }

    // Emit a pg_notify so the Hub SSE infrastructure pushes the completion event
    // to any operator currently viewing the timeline editor for this job.
    const notifyPayload = JSON.stringify({
      event_type: "scene_image_complete",
      job_id: payload.job_id,
      id: `scene_image_complete_${payload.job_id}_${payload.scene_index}_${Date.now()}`,
      payload: {
        scene_index: payload.scene_index,
        r2_key: r2Key,
      },
      timestamp: new Date().toISOString(),
    });
    await db.execute(sql`SELECT pg_notify('system_events', ${notifyPayload})`);

    console.log(
      JSON.stringify({
        level: "info",
        message: "Scene image generation completed",
        job_id: payload.job_id,
        scene_index: payload.scene_index,
        r2_key: r2Key,
      }),
    );

    // Re-trigger asset collection — checks if all scenes are now done
    const assetCollectionQueue = queues.assetCollection;
    if (assetCollectionQueue) {
      await assetCollectionQueue.add("collect-assets", {
        job_id: payload.job_id,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        level: "error",
        message: "Scene image generation failed",
        job_id: payload.job_id,
        scene_index: payload.scene_index,
        error: errorMessage,
      }),
    );
    // Don't fail the entire job for one scene image — asset collection handles retry
  }
}

function isTemporaryError(error: unknown): boolean {
  const errMsg = error instanceof Error ? error.message : String(error);
  const lower = errMsg.toLowerCase();
  if (
    lower.includes("high demand") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("resource_exhausted") ||
    lower.includes("429")
  )
    return true;
  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("circuit breaker")
  )
    return true;
  return false;
}

async function scheduleImageRetry(
  db: DrizzleClient,
  queues: { aiGeneration: Queue; assetCollection?: Queue },
  job_id: string,
  scene_index: number,
  img_index: number,
  error: string,
): Promise<void> {
  const [job] = await db
    .select({
      metadata: contentJobs.metadata,
      assembly_manifest: contentJobs.assembly_manifest,
    })
    .from(contentJobs)
    .where(eq(contentJobs.id, job_id))
    .limit(1);
  const retryState = (job?.metadata as any)?.image_retry_state ?? {};
  const imageKey = `${scene_index}-${img_index}`;
  const currentRetry = retryState[imageKey] ?? { attempts: 0 };
  const nextAttempt = currentRetry.attempts + 1;
  if (nextAttempt > 20) {
    await markImageAsFailed(db, queues, job_id, scene_index, img_index);
    return;
  }
  const backoffMinutes = Math.min(60, Math.pow(2, nextAttempt - 1));
  const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
  retryState[imageKey] = {
    attempts: nextAttempt,
    next_retry_at: nextRetryAt.toISOString(),
    last_error: error.slice(0, 200),
    last_attempt_at: new Date().toISOString(),
  };
  await db
    .update(contentJobs)
    .set({
      metadata: sql`metadata || jsonb_build_object('image_retry_state', ${JSON.stringify(retryState)}::jsonb)`,
      updated_at: new Date(),
      status_updated_at: new Date(),
    })
    .where(eq(contentJobs.id, job_id));
  console.log(
    JSON.stringify({
      level: "warn",
      message: "Scheduling retry",
      job_id,
      scene_index,
      img_index,
      attempt: nextAttempt,
      retry_in_minutes: backoffMinutes,
    }),
  );
  await db.insert(systemEvents).values({
    event_type: "google_api.rate_limited",
    job_id,
    payload: {
      service: "google-gemini",
      retry_seconds: backoffMinutes * 60,
      retry_at: nextRetryAt.toISOString(),
      attempt: nextAttempt,
      image_key: imageKey,
    },
  });

  // Extract enriched_image_prompt from assembly_manifest
  const manifest = job?.assembly_manifest as any;
  const scene = manifest?.scenes?.[scene_index];
  const sentImg = scene?.sentence_images?.[img_index];
  const enrichedPrompt =
    sentImg?.enriched_image_prompt || sentImg?.image_prompt || "";

  // Guard against self-dedup: if the computed retry-N job ID already exists in
  // BullMQ (active/waiting/delayed), bump to retry-(N+1) so we don't silently
  // drop the dispatch. This happens when DB.attempts is behind the current job
  // suffix (e.g. after pre-advancing counters or stall-induced re-runs).
  let safeAttempt = nextAttempt;
  let candidateJobId = `${job_id}-scene-${scene_index}-img-${img_index}-retry-${safeAttempt}`;
  const candidate = await queues.aiGeneration.getJob(candidateJobId);
  if (candidate) {
    const state = await candidate.getState();
    if (
      state === "active" ||
      state === "waiting" ||
      state === "delayed" ||
      state === "prioritized"
    ) {
      safeAttempt = nextAttempt + 1;
      candidateJobId = `${job_id}-scene-${scene_index}-img-${img_index}-retry-${safeAttempt}`;
      // Also sync the DB counter to match the bumped attempt
      retryState[imageKey] = { ...retryState[imageKey], attempts: safeAttempt };
      await db
        .update(contentJobs)
        .set({
          metadata: sql`metadata || jsonb_build_object('image_retry_state', ${JSON.stringify(retryState)}::jsonb)`,
          updated_at: new Date(),
        })
        .where(eq(contentJobs.id, job_id));
    }
  }

  await queues.aiGeneration.add(
    "generate-sentence-image",
    {
      generation_type: "sentence_image",
      job_id,
      scene_index,
      img_index,
      group_index: img_index, // Same as img_index since grouping is disabled
      image_prompt: enrichedPrompt,
      aspect_ratio: "16:9",
    },
    {
      delay: backoffMinutes * 60 * 1000,
      jobId: candidateJobId,
    },
  );
}

async function markImageAsFailed(
  db: DrizzleClient,
  queues: { aiGeneration: Queue; assetCollection?: Queue },
  job_id: string,
  scene_index: number,
  img_index: number,
): Promise<void> {
  await db.execute(
    sql`UPDATE content_jobs SET assembly_manifest = jsonb_set(assembly_manifest, ${`{scenes}`}::text[], (SELECT jsonb_agg(CASE WHEN (scene->>'scene_index')::int = ${scene_index} THEN jsonb_set(scene, ${`{sentence_images,${img_index},generation_status}`}::text[], '"failed"'::jsonb) ELSE scene END) FROM jsonb_array_elements(assembly_manifest->'scenes') AS scene)) WHERE id = ${job_id}`,
  );
  if (queues.assetCollection)
    await queues.assetCollection.add("collect-assets", { job_id });
}

/**
 * Handle sentence-level image generation via AI33 API (Task 6)
 *
 * Called for each sentence image dispatch during V2 pipeline asset collection.
 * Writes the resulting R2 key to scene.sentence_images[img_index].r2_key atomically.
 *
 * Key difference from handleSceneImageGeneration:
 * - scene_image writes r2_key to scene.visual_asset_key
 * - sentence_image writes r2_key to scene.sentence_images[img_index].r2_key
 *
 * On generation failure: logs and returns without throwing — the asset-collection
 * convergence check handles missing r2_keys and determines overall pipeline health.
 */
async function handleSentenceImageGeneration(
  db: DrizzleClient,
  config: Env,
  r2Client: null,
  payload: Extract<AIGenerationPayload, { generation_type: "sentence_image" }>,
  queues: { aiGeneration: Queue; assetCollection?: Queue },
): Promise<void> {
  const {
    job_id,
    scene_index,
    img_index,
    image_prompt,
    enriched_image_prompt,
    aspect_ratio,
  } = payload;

  // Fetch job for channel_id (needed for R2 key) and template (needed for image model pref)
  const [job] = await db
    .select()
    .from(contentJobs)
    .where(eq(contentJobs.id, job_id))
    .limit(1);
  if (!job) throw new Error(`Job ${job_id} not found`);

  // MANUAL MODE: Skip image generation, leave r2_key null for VA upload
  if (job.image_generation_mode === "manual") {
    console.log(
      JSON.stringify({
        level: "info",
        message:
          "Skipping sentence image generation (manual mode) - prompt stored, VA will upload via Hub UI",
        job_id,
        scene_index,
        img_index,
        image_generation_mode: job.image_generation_mode,
      }),
    );

    // Mark this image as awaiting manual upload in the manifest
    await db.execute(sql`
      UPDATE content_jobs
      SET assembly_manifest = jsonb_set(
        assembly_manifest,
        ${`{scenes}`}::text[],
        (
          SELECT jsonb_agg(
            CASE
              WHEN (scene->>'scene_index')::int = ${scene_index}
              THEN jsonb_set(
                scene,
                ${`{sentence_images,${img_index},generation_status}`}::text[],
                '"awaiting_manual_upload"'::jsonb
              )
              ELSE scene
            END
          )
          FROM jsonb_array_elements(assembly_manifest->'scenes') AS scene
        )
      )
      WHERE id = ${job_id}
    `);

    // Re-trigger convergence check
    if (queues.assetCollection) {
      await queues.assetCollection.add("collect-assets", { job_id });
    }
    return;
  }

  const [template] = await db
    .select()
    .from(contentTemplates)
    .where(eq(contentTemplates.id, job.template_id))
    .limit(1);

  // Use enriched prompt if available, sanitize
  const primaryPrompt = sanitizePrompt(enriched_image_prompt ?? image_prompt);

  // ── Reference image injection ───────────────────────────────────────────────
  let resolvedPrompt = primaryPrompt;
  let resolvedReferenceImages: Uint8Array[] | undefined;

  console.log(
    JSON.stringify({
      level: "debug",
      message: "DEBUG: Checking for per_video_assets",
      job_id,
      scene_index,
      img_index,
      has_metadata: !!job.metadata,
      metadata_keys: job.metadata ? Object.keys(job.metadata as any) : [],
      has_per_video_assets: !!(job.metadata as any)?.per_video_assets,
    }),
  );

  // ── VALIDATION: Reference images required if archetype exists ──────────────
  const archetypeId = (job as any).archetype_id;
  const perVideoAssets = (job.metadata as any)?.per_video_assets;

  if (archetypeId && !perVideoAssets) {
    const errorMsg =
      `Reference image system failure: Job has archetype_id (${archetypeId.slice(0, 8)}) ` +
      `but per_video_assets not assembled in metadata. ` +
      `Check asset-collection processor logs for archetype_id propagation issues.`;

    console.error(
      JSON.stringify({
        level: "error",
        message:
          "Blocking image generation: reference images required but missing",
        job_id,
        scene_index,
        img_index,
        archetype_id: archetypeId,
        has_per_video_assets: false,
        validation_failed: "REFERENCE_IMAGES_REQUIRED",
      }),
    );

    throw new Error(errorMsg);
  }
  if (perVideoAssets) {
    const slots: Partial<Record<string, Buffer>> = {};
    if (perVideoAssets.style_guide?.file_path) {
      const buf = await loadReferenceImage(
        perVideoAssets.style_guide.file_path,
      );
      if (buf) slots["style_guide"] = buf;
    }
    // Select character ref: use scene-level character_ids when template supports
    // character tracking; fall back to first character asset otherwise.
    const supportsCharTracking =
      (template?.metadata as any)?.supports_character_tracking === true;
    const sceneForCharIds = (job.assembly_manifest as any)?.scenes?.[
      scene_index
    ];
    const sceneCharIds: string[] = sceneForCharIds?.character_ids ?? [];
    const characterAssets: ResolvedAssetRef[] = perVideoAssets.characters ?? [];

    let charRef: ResolvedAssetRef | undefined;
    if (supportsCharTracking && sceneCharIds.length > 0) {
      charRef = characterAssets.find((c) => sceneCharIds.includes(c.asset_id));
    }
    // Fall back to first character if no scene assignment or tracking disabled
    charRef ??= characterAssets[0];

    if (charRef?.file_path) {
      const buf = await loadReferenceImage(charRef.file_path);
      if (buf) slots["character"] = buf;
    }
    // Load layout reference for composite PowerPoint-style images
    if (perVideoAssets.layout_reference?.file_path) {
      const buf = await loadReferenceImage(
        perVideoAssets.layout_reference.file_path,
      );
      if (buf) slots["layout_reference"] = buf;
    }
    // Inject background ref (previously not included in sentence images — now added)
    const bgRefSentence: ResolvedAssetRef | undefined =
      perVideoAssets.backgrounds?.[0];
    if (bgRefSentence?.file_path) {
      const buf = await loadReferenceImage(bgRefSentence.file_path);
      if (buf) slots["background"] = buf;
    }
    if (Object.keys(slots).length > 0) {
      const injected = buildReferenceInjectedPrompt({
        basePrompt: primaryPrompt,
        slots: slots as any,
      });
      resolvedPrompt = injected.prompt;
      resolvedReferenceImages = injected.referenceImages;

      console.log(
        JSON.stringify({
          level: "info",
          message: "Reference images injected into prompt",
          job_id,
          scene_index,
          img_index,
          reference_count: resolvedReferenceImages.length,
          reference_types: Object.keys(slots),
          prompt_snippet: resolvedPrompt.slice(0, 150),
        }),
      );
    } else {
      console.log(
        JSON.stringify({
          level: "warn",
          message: "NO reference images available for injection",
          job_id,
          scene_index,
          img_index,
          per_video_assets_present: !!perVideoAssets,
          per_video_assets_keys: perVideoAssets
            ? Object.keys(perVideoAssets)
            : [],
        }),
      );
    }
  }

  // ── Resolved reference slots for audit logging ───────────────────────────────
  // For archetype-based jobs the slots come from perVideoAssets.
  const resolvedReferenceSlots: string[] = (() => {
    if (!perVideoAssets || !resolvedReferenceImages) return [];
    return REFERENCE_INJECTION_ORDER.filter((slot) => {
      if (slot === "style_guide")
        return !!(perVideoAssets as any).style_guide?.file_path;
      if (slot === "character")
        return !!((perVideoAssets as any).characters?.length > 0);
      if (slot === "layout_reference")
        return !!(perVideoAssets as any).layout_reference?.file_path;
      if (slot === "background")
        return !!((perVideoAssets as any).backgrounds?.length > 0);
      return false;
    });
  })();

  // ── Quality Assurance Pre-flight Checks ─────────────────────────────────────
  const { runPreflightChecks, createAPICallAuditLog, validateAPICallAuditLog } =
    await import("@repo/domain");

  const preflightResult = runPreflightChecks({
    prompt: resolvedPrompt,
    referenceImages: resolvedReferenceImages,
    referenceSlots: resolvedReferenceSlots,
  });

  console.log(
    JSON.stringify({
      level: preflightResult.passed ? "info" : "warn",
      message: "QA pre-flight check completed",
      job_id,
      scene_index,
      img_index,
      qa_passed: preflightResult.passed,
      qa_score: preflightResult.score,
      qa_failures: preflightResult.failures,
      qa_warnings: preflightResult.warnings,
    }),
  );

  // Log failures and warnings but DO NOT block generation (observability mode)
  // In future, we can add a qa_enforcement flag to block low-quality prompts
  if (!preflightResult.passed) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message:
          "QA pre-flight check failed - proceeding anyway (observability mode)",
        job_id,
        scene_index,
        img_index,
        qa_score: preflightResult.score,
        failures: preflightResult.failures,
      }),
    );
  }

  // NO PROMPT FALLBACKS - use the real prompt or fail loudly
  let imageBuffer: Buffer | null = null;
  let provider = "unknown";
  let lastError: string | null = null;

  // The media gateway is the ONLY image provider (forge-api/VEO primary,
  // fastgen fallback until expiry) — see docs/MEDIA_GATEWAYS.md. The
  // deprecated GoogleDirect + AI33 fallback chains were removed 2026-07.
  const genResult = await tryFastGenImage(
    resolvedPrompt,
    resolvedReferenceImages,
    aspect_ratio ?? "16:9",
    toGatewayFormat(job.format as string),
    `sentence:${scene_index}:${img_index}`,
  );
  imageBuffer = genResult.buffer;
  lastError = genResult.error ?? null;
  if (imageBuffer) provider = "media-gateway";

  if (!imageBuffer) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Sentence image generation failed on all providers",
        job_id,
        scene_index,
        img_index,
        last_error: lastError
          ? lastError.slice(0, 300)
          : "Google API failed (see logs above)",
        prompt_snippet: resolvedPrompt.slice(0, 200),
        has_reference_images: !!resolvedReferenceImages,
        model: "gemini-3-pro-image-preview",
      }),
    );

    // SMART RETRY SYSTEM: Route to retry or permanent failure
    const errorToCheck = lastError ?? "Google API failed";
    if (isTemporaryError(errorToCheck)) {
      await scheduleImageRetry(
        db,
        queues,
        job_id,
        scene_index,
        img_index,
        errorToCheck,
      );
    } else {
      await markImageAsFailed(db, queues, job_id, scene_index, img_index);
    }
    return;
  }

  // Upload to R2
  const r2Key = buildR2Key(
    job.channel_id,
    job_id,
    `scene_${scene_index}_img_${img_index}.png`,
  );
  await uploadToR2(r2Client, "", r2Key, imageBuffer, "image/png");

  console.log(
    JSON.stringify({
      level: "info",
      message: "Sentence image generation completed",
      job_id,
      scene_index,
      img_index,
      r2_key: r2Key,
      provider,
    }),
  );

  // Write r2_key into scene.sentence_images[img_index] atomically using a
  // SELECT FOR UPDATE → mutate in JS → UPDATE pattern. This avoids complex
  // nested JSONB path expressions and correctly handles the scene_index lookup
  // (scenes are found by scene_index value, not array position).
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ assembly_manifest: contentJobs.assembly_manifest })
      .from(contentJobs)
      .where(eq(contentJobs.id, job_id))
      .for("update")
      .limit(1);

    if (!current) throw new Error(`Job ${job_id} not found in transaction`);

    // Cast as any: AssemblyManifest Zod schema doesn't include sentence_images yet
    // (it's defined as a plain interface in @repo/contracts). Mutate in place then write back.
    const manifest = current.assembly_manifest as any;
    const scenes: Array<{
      scene_index: number;
      sentence_images?: Array<{
        r2_key?: string | null;
        enriched_image_prompt?: string | null;
      }>;
    }> = manifest.scenes;
    const scene = scenes.find((s) => s.scene_index === scene_index);
    if (!scene)
      throw new Error(`Scene ${scene_index} not in manifest for job ${job_id}`);
    if (!scene.sentence_images)
      throw new Error(`Scene ${scene_index} has no sentence_images`);

    const sentImg = scene.sentence_images[img_index];
    if (!sentImg)
      throw new Error(
        `sentence_images[${img_index}] missing in scene ${scene_index}`,
      );

    sentImg.r2_key = r2Key;
    delete (sentImg as any).generation_status; // clear any prior failure marker
    if (enriched_image_prompt && !sentImg.enriched_image_prompt) {
      sentImg.enriched_image_prompt = enriched_image_prompt;
    }

    await tx
      .update(contentJobs)
      .set({
        assembly_manifest: manifest as any,
        updated_at: new Date(),
      })
      .where(eq(contentJobs.id, job_id));
  });

  // Append to r2_asset_manifest for garbage collection tracking (atomic JSONB append)
  // Guard: the column defaults to {} (object) not [] (array), normalise with jsonb_typeof.
  await db
    .update(contentJobs)
    .set({
      r2_asset_manifest: sql`CASE WHEN jsonb_typeof(COALESCE(${contentJobs.r2_asset_manifest}, '[]'::jsonb)) = 'array' THEN COALESCE(${contentJobs.r2_asset_manifest}, '[]'::jsonb) ELSE '[]'::jsonb END || ${JSON.stringify(
        [
          {
            key: r2Key,
            type: "image/broll",
            size_bytes: imageBuffer.length,
          },
        ],
      )}::jsonb`,
    })
    .where(eq(contentJobs.id, job_id));

  // Trigger asset-collection re-check so convergence logic runs after each image lands.
  // No dedup key — each completion fires its own check to avoid the static dedup key
  // being swallowed when two images complete close together.
  if (queues.assetCollection) {
    await queues.assetCollection.add("collect-assets", { job_id });
  }
}

/**
 * Handle script generation from research files (Task 21)
 *
 * Downloads research files from local storage, parses them, and uses the
 * content as grounding context for Claude script generation. This prevents
 * hallucination by anchoring the script in provided research.
 *
 * Flow:
 * 1. Fetch job and validate research files exist
 * 2. Validate file count and size limits
 * 3. Download and parse research files (PDF/MD/TXT)
 * 4. Generate script via Claude with research context
 * 5. Save script and generation log to database
 * 6. Update status to ASSET_COLLECTION
 * 7. Dispatch to scene analysis
 */
async function handleScriptFromResearchGeneration(
  db: DrizzleClient,
  anthropicClient: Anthropic,
  r2Client: null,
  payload: Extract<
    AIGenerationPayload,
    { generation_type: "script_from_research" }
  >,
  queues: { sceneAnalysis?: Queue; techFootageCollection?: Queue },
): Promise<void> {
  // Production safety limits
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB per file
  const MAX_RESEARCH_FILES = 10; // Maximum number of research files
  const MAX_RESEARCH_CONTEXT_CHARS = 150_000; // Claude context window limit (~50k tokens)

  const { job_id, product_a_name, product_b_name, subformat } = payload;
  const skipResearch = payload.skip_research === true;

  try {
    console.log(
      JSON.stringify({
        level: "info",
        message: "Starting script generation from research",
        job_id,
        product_a_name,
        product_b_name,
        subformat,
        skip_research: skipResearch,
      }),
    );

    // 1. Fetch job to get research files
    const [job] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, job_id))
      .limit(1);

    if (!job) {
      throw new Error(`Job ${job_id} not found`);
    }

    /**
     * The template's declared script provider. Fetched here because this
     * handler never loaded the template at all — which is precisely how its
     * `script_provider` came to be ignored. A missing template is not fatal:
     * `resolveScriptProvider` falls back to the env/default ladder, which is
     * the same thing the main scripting path does.
     */
    const [researchTemplate] = payload.template_id
      ? await db
          .select()
          .from(contentTemplates)
          .where(eq(contentTemplates.id, payload.template_id))
          .limit(1)
      : [];
    const researchPipelineConfig =
      ((researchTemplate?.metadata as Record<string, unknown> | null)?.[
        "pipeline_config"
      ] as Record<string, unknown> | undefined) ?? {};

    // 2. Validate research files exist and check limits
    // Guard: the column defaults to {} (object) not [] (array), normalise here.
    const r2ManifestForResearch: Array<{
      key: string;
      type: string;
      size_bytes: number;
    }> = Array.isArray(job.r2_asset_manifest)
      ? (job.r2_asset_manifest as any[])
      : [];
    const researchAssets = r2ManifestForResearch.filter(
      (a) => a.type === "research/perplexity",
    );

    if (researchAssets.length === 0 && !skipResearch) {
      throw new Error(`Job ${job_id} has no research files`);
    }
    // skip_research: no files present is expected — the empty researchAssets
    // array flows through the (no-op) download loop and parseResearchFiles([])
    // yields empty combined_content, so researchContext ends up "". The
    // system prompt below switches to LLM-knowledge mode accordingly.

    if (researchAssets.length > MAX_RESEARCH_FILES) {
      throw new Error(
        `Job ${job_id} has ${researchAssets.length} research files (max: ${MAX_RESEARCH_FILES})`,
      );
    }

    // Validate total size before downloading
    const totalSize = researchAssets.reduce((sum, a) => sum + a.size_bytes, 0);
    if (totalSize > MAX_FILE_SIZE * MAX_RESEARCH_FILES) {
      throw new Error(
        `Job ${job_id} research files total ${Math.round(totalSize / 1024 / 1024)}MB ` +
          `(max: ${Math.round((MAX_FILE_SIZE * MAX_RESEARCH_FILES) / 1024 / 1024)}MB)`,
      );
    }

    console.log(
      JSON.stringify({
        level: "info",
        message: "Research file validation passed",
        job_id,
        file_count: researchAssets.length,
        total_size_mb: Math.round(totalSize / 1024 / 1024),
      }),
    );

    // 3. Download and parse research files
    const researchFiles: Array<{
      filename: string;
      buffer: Buffer;
      format: "pdf" | "md" | "txt";
    }> = [];
    for (const asset of researchAssets) {
      // Validate individual file size
      if (asset.size_bytes > MAX_FILE_SIZE) {
        throw new Error(
          `Research file ${asset.key} is ${Math.round(asset.size_bytes / 1024 / 1024)}MB ` +
            `(max: ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB)`,
        );
      }

      const ext = asset.key.split(".").pop()?.toLowerCase();
      const format: "pdf" | "md" | "txt" =
        ext === "pdf" ? "pdf" : ext === "md" ? "md" : "txt";

      // Download from local storage with 60s timeout to prevent stuck jobs
      const DOWNLOAD_TIMEOUT_MS = 60_000;
      let buffer: Buffer;
      try {
        buffer = await Promise.race([
          (async () => {
            const bufferIterable = await downloadFromR2(
              r2Client,
              "",
              asset.key,
            );
            const chunks: Buffer[] = [];
            for await (const chunk of bufferIterable) {
              chunks.push(chunk);
            }
            return Buffer.concat(chunks);
          })(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `Research file download timeout after ${DOWNLOAD_TIMEOUT_MS / 1000}s`,
                  ),
                ),
              DOWNLOAD_TIMEOUT_MS,
            ),
          ),
        ]);
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "error",
            message: "Research file download failed",
            job_id,
            asset_key: asset.key,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        throw new Error(
          `Failed to download research file ${asset.key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      researchFiles.push({
        filename: asset.key.split("/").pop()!,
        buffer,
        format,
      });
    }

    const parsedResearch = await parseResearchFiles(researchFiles);

    console.log(
      JSON.stringify({
        level: "info",
        message: "Research files parsed",
        job_id,
        file_count: parsedResearch.files.length,
        total_words: parsedResearch.total_word_count,
      }),
    );

    // 4. Generate script via Claude with research context
    const scriptStartedAt = new Date();

    // Truncate research content to stay within Claude's context window
    const researchContext = parsedResearch.combined_content.slice(
      0,
      MAX_RESEARCH_CONTEXT_CHARS,
    );
    const wasTruncated =
      parsedResearch.combined_content.length > MAX_RESEARCH_CONTEXT_CHARS;

    if (wasTruncated) {
      console.log(
        JSON.stringify({
          level: "warn",
          message: "Research content truncated to fit context window",
          job_id,
          original_chars: parsedResearch.combined_content.length,
          truncated_chars: MAX_RESEARCH_CONTEXT_CHARS,
        }),
      );
    }

    const systemPrompt = skipResearch
      ? `You are writing a YouTube comparison script for a tech product comparison video.

Your task: Write a 3-5 minute comparison script for ${product_a_name} vs ${product_b_name}.
Format: TECH_COMPARISON (${subformat})

Requirements:
- Write from your own knowledge of these products (no research files were provided — this is an automatic test run)
- Structure: Hook → Product intros → Head-to-head comparison → Feature spotlights → Verdict → CTA
- Tone: Informative, balanced, data-driven
- Length: 800-1200 words
- Prefer widely-known, stable facts; avoid inventing specific numbers you are unsure about

Return ONLY the script text, no markdown formatting or preamble.`
      : `You are writing a YouTube comparison script for a tech product comparison video.

Research Context:
${researchContext}

Your task: Write a 3-5 minute comparison script for ${product_a_name} vs ${product_b_name}.
Format: TECH_COMPARISON (${subformat})

Requirements:
- Use the research as your primary source of facts and details
- Structure: Hook → Product intros → Head-to-head comparison → Feature spotlights → Verdict → CTA
- Tone: Informative, balanced, data-driven
- Length: 800-1200 words
- Do NOT hallucinate facts - only use information from the research

Return ONLY the script text, no markdown formatting or preamble.`;

    /**
     * ── The same ladder the main scripting path uses ──────────────────────────
     * This call site used to be `generateScript(anthropicClient, …)`, which
     * reaches `callLLM()` with NO provider — so it fell through to env
     * LLM_PROVIDER, which is "anthropic" on the VPS, whose key is dead. Every
     * TECH_COMPARISON job died on `401 authentication_error` before writing a
     * line of script, which is why the format has zero completed jobs on
     * production despite a full pipeline and a registered Remotion composition.
     *
     * That is byte-for-byte the bug the comment in `handleScriptGeneration`
     * describes for RANKING ("the template's declared provider was silently
     * discarded"). It was fixed there and not here, because no comparison job
     * had ever run to expose it. Both call sites now share one resolver and one
     * ladder — see `runScriptProvider`.
     */
    const { text: scriptRaw, provider: scriptProvider } =
      await runScriptProvider({
        provider: resolveScriptProvider(researchPipelineConfig),
        prompt: systemPrompt,
        context: `script_from_research:TECH_COMPARISON:${job_id}`,
        scriptFormat: "TECH_COMPARISON",
        anthropicClient,
      });
    const scriptInputTokens = 0;
    const scriptOutputTokens = 0;

    const script = scriptRaw.trim();
    const scriptCompletedAt = new Date();

    // 5. Create generation log entry
    const logEntry: GenerationLogEntry = {
      stage: "script_from_research",
      started_at: scriptStartedAt.toISOString(),
      completed_at: scriptCompletedAt.toISOString(),
      duration_ms: scriptCompletedAt.getTime() - scriptStartedAt.getTime(),
      model: scriptProvider ?? "gemini-pool",
      prompt_system: systemPrompt.slice(0, 10_000),
      prompt_user: `Research-grounded comparison: ${product_a_name} vs ${product_b_name}`,
      raw_output: script.slice(0, 10_000),
      success: true,
      input_tokens: scriptInputTokens,
      output_tokens: scriptOutputTokens,
    };

    // Fetch existing generation_log before update
    const [jobForLog] = await db
      .select({ generation_log: contentJobs.generation_log })
      .from(contentJobs)
      .where(eq(contentJobs.id, job_id))
      .limit(1);

    const existingLog =
      (jobForLog?.generation_log as GenerationLogEntry[] | null) ?? [];

    // 6. Save script and log entry to database
    await db
      .update(contentJobs)
      .set({
        script,
        generation_log: [...existingLog, logEntry] as any,
        updated_at: new Date(),
      })
      .where(eq(contentJobs.id, job_id));

    console.log(
      JSON.stringify({
        level: "info",
        message: "Script generated from research",
        job_id,
        script_word_count: script.split(/\s+/).length,
        input_tokens: scriptInputTokens,
        output_tokens: scriptOutputTokens,
        duration_ms: logEntry.duration_ms,
      }),
    );

    // 7. Route to footage collection (TECH_COMPARISON) or scene analysis (all other formats)
    const isTechComparison = !!product_a_name && !!product_b_name;

    if (isTechComparison && queues.techFootageCollection) {
      // TECH_COMPARISON: footage collection runs before asset collection
      await updateJobStatus(db, job_id, "TECH_FOOTAGE_COLLECTING");
      await queues.techFootageCollection.add("tech-footage-collection", {
        job_id,
      });
      console.log(
        JSON.stringify({
          level: "info",
          message: "TECH_COMPARISON: Dispatched to footage collection",
          job_id,
        }),
      );
    } else {
      // All other formats: continue to scene analysis / asset collection
      await updateJobStatus(db, job_id, "ASSET_COLLECTION");

      if (queues.sceneAnalysis) {
        await queues.sceneAnalysis.add("analyze-scenes", {
          job_id,
          template_id: job.template_id,
          script,
        });
        console.log(
          JSON.stringify({
            level: "info",
            message: "Dispatched to scene analysis",
            job_id,
          }),
        );
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        level: "error",
        message: "Script generation from research failed",
        job_id,
        error: errorMessage,
      }),
    );
    await updateJobStatus(
      db,
      job_id,
      "FAILED_GENERAL",
      errorMessage,
      buildErrorDetail({
        code: "SCRIPT_FROM_RESEARCH_FAILED",
        message: errorMessage,
        category: "external_service",
        retryable: true,
        context: { generation_type: "script_from_research", job_id },
      }),
    );
    throw error;
  }
}
