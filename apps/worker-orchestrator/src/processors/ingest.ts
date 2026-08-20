import type { Job, Queue } from "bullmq";
import { eq } from "drizzle-orm";
import type {
  IngestPayload,
  BundestagClipAnalysisPayload,
} from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { contentTemplates, contentJobs } from "@repo/db";
import type { ReactorDownloadPayload } from "@repo/contracts";
import { updateJobStatusAndDispatch } from "../utils/update-and-dispatch.js";
import { updateJobStatus } from "../utils/update-job-status.js";
import { IngestPayloadSchema } from "@repo/contracts";
import {
  buildResearchPromptGenerationPrompt,
  validateWith,
  validationError,
  PipelineErrorCode,
  PipelineValidationError,
  normalizeComparison,
  describeComparisonShape,
} from "@repo/domain";
import { getConfig, isTestAgentMode } from "@repo/config";
import Anthropic from "@anthropic-ai/sdk";
import { createContextLogger } from "@repo/logger";

const logger = createContextLogger("ingest");

/**
 * Ingest Processor
 *
 * Processes queue-ingest jobs - initial job creation and workflow setup.
 *
 * Flow:
 * 1. Validate payload with Zod schema
 * 2. Validate template exists and is active
 * 3. Create content_jobs row with status IDEA_GENERATION
 * 4. Update status to SCRIPTING
 * 5. Dispatch to ai-generation queue for script generation
 *
 * @param db - Drizzle client
 * @param queues - Queue instances for dispatch
 * @returns Processor function for ingest queue
 */
export function createIngestProcessor(
  db: DrizzleClient,
  queues: {
    aiGeneration: Queue;
    assetCollection?: Queue;
    bundestagClipAnalysis?: Queue;
    reactorDownload?: Queue;
  },
) {
  return async (job: Job<IngestPayload>) => {
    logger.info({ job_id: job.id, payload: job.data }, "Processing ingest job");

    // 1. Validate payload
    const parseResult = IngestPayloadSchema.safeParse(job.data);
    if (!parseResult.success) {
      const errorMessage = `Invalid payload: ${parseResult.error.message}`;
      logger.error(
        {
          job_id: job.id,
          errors: parseResult.error.errors,
        },
        errorMessage,
      );
      throw new Error(errorMessage);
    }

    let {
      channel_id,
      format,
      template_id,
      production_version,
      initial_topic,
      script_text,
      pre_uploaded_assets,
      skip_image_qc,
      skip_final_qc,
      skip_research,
      metadata,
      language,
      narration_source_path,
      target_duration_seconds,
      aspect_ratio,
      archetype_id,
      bundestag_clip_paths,
    } = parseResult.data;

    // Auto-enable QC skip in test-agent mode for fast iteration
    if (isTestAgentMode()) {
      skip_image_qc = true;
      skip_final_qc = true;
      skip_research = true;
      logger.info(
        { job_id: job.id },
        "Test-agent mode: auto-enabled skip_image_qc, skip_final_qc and skip_research",
      );
    }

    // 2. Pre-flight validation harness check
    // CRITICAL: Fail-fast validation BEFORE creating job
    // Catches semantic issues that Zod schema validation cannot detect
    const validationResult = await validateWith(
      "ingest-payload-validator",
      parseResult.data,
      {
        jobId: `pre-creation-${Date.now()}`,
        stage: "ingest",
        format,
        environment: isTestAgentMode() ? "test-agent" : "production",
      },
    );

    if (!validationResult.success) {
      const errorMessage = `Pre-flight validation failed:\n${validationResult.errors.map((e) => `  - [${e.code}] ${e.message}${e.suggestion ? `\n    Suggestion: ${e.suggestion}` : ""}`).join("\n")}`;

      logger.error(
        {
          job_id: job.id,
          validation_errors: validationResult.errors,
        },
        errorMessage,
      );

      throw new Error(errorMessage);
    }

    // Log validation warnings if any
    if (validationResult.warnings && validationResult.warnings.length > 0) {
      logger.warn(
        {
          job_id: job.id,
          validation_warnings: validationResult.warnings,
        },
        `Pre-flight validation passed with warnings: ${validationResult.warnings.length} warning(s)`,
      );
    } else {
      logger.info({ job_id: job.id }, "Pre-flight validation passed");
    }

    // 3. Validate template exists and is active
    const [template] = await db
      .select()
      .from(contentTemplates)
      .where(eq(contentTemplates.id, template_id))
      .limit(1);

    if (!template) {
      throw new Error(`Template ${template_id} not found`);
    }

    if (!template.is_active) {
      throw new Error(`Template ${template_id} is inactive`);
    }

    // DEBUG: Log archetype_id resolution
    logger.info(
      {
        template_id,
        template_archetype_id: template.archetype_id,
        payload_archetype_id: archetype_id,
        resolved_archetype_id: archetype_id ?? template.archetype_id ?? null,
      },
      "Archetype ID resolution",
    );

    // Log when defaults are applied
    const defaults_applied: Array<{
      field: string;
      default_value: string | number | boolean;
    }> = [];
    if (!language)
      defaults_applied.push({ field: "language", default_value: "en" });
    if (!production_version)
      defaults_applied.push({
        field: "production_version",
        default_value: "V2",
      });
    if (!aspect_ratio)
      defaults_applied.push({ field: "aspect_ratio", default_value: "16:9" });
    if (skip_image_qc === undefined)
      defaults_applied.push({ field: "skip_image_qc", default_value: false });
    if (skip_final_qc === undefined)
      defaults_applied.push({ field: "skip_final_qc", default_value: false });

    if (defaults_applied.length > 0) {
      logger.info(
        {
          job_id: job.id,
          defaults_applied,
        },
        `Using default values for ${defaults_applied.length} field(s) not specified in payload`,
      );
    }

    // 4. Create content_jobs row with status IDEA_GENERATION
    const [newJob] = await db
      .insert(contentJobs)
      .values({
        channel_id,
        template_id,
        format,
        language: language ?? "en",
        production_version: production_version ?? "V2",
        skip_image_qc: skip_image_qc ?? false,
        skip_final_qc: skip_final_qc ?? false,
        narration_source_path: narration_source_path ?? null,
        target_duration_seconds: target_duration_seconds ?? null,
        aspect_ratio: aspect_ratio ?? "16:9",
        archetype_id: archetype_id ?? template.archetype_id ?? null, // CRITICAL: Required for per_video_assets assembly
        status: "IDEA_GENERATION",
        status_updated_at: new Date(),
        initial_topic: initial_topic || null,
        // title is varchar(100); initial_topic is unbounded text. RANKING (and
        // any format whose topic is derived from a long brief/script) can exceed
        // 100 chars — truncate defensively so the insert never fails. The full
        // text is preserved verbatim in initial_topic above.
        title: (initial_topic || `Untitled ${format}`).slice(0, 100),
        description: `Generated ${format} content`,
        script: script_text || null,
        metadata: metadata ?? null,
        state_machine_history: [
          {
            from_status: "",
            to_status: "IDEA_GENERATION",
            timestamp: new Date().toISOString(),
            reason: script_text
              ? "Job created with pre-written script"
              : "Job created via ingest queue",
          },
        ],
      })
      .returning();

    // Attach pre-uploaded assets + thumbnail skip marker to manifest
    {
      const manifest: Array<{ key: string; type: string; size_bytes: number }> =
        [];

      if (pre_uploaded_assets && pre_uploaded_assets.length > 0) {
        manifest.push(
          ...pre_uploaded_assets.map((a) => ({
            key: a.key,
            type: a.type,
            size_bytes: a.size_bytes,
          })),
        );
      }

      // Add script to manifest if provided
      if (script_text) {
        const scriptSizeBytes = Buffer.byteLength(script_text, "utf8");
        manifest.push({
          key: `${channel_id}/${newJob.id}/script.txt`,
          type: "document/script",
          size_bytes: scriptSizeBytes,
        });
      }

      // Thumbnail generation disabled - managed by separate external system

      await db
        .update(contentJobs)
        .set({
          r2_asset_manifest: manifest,
          updated_at: new Date(),
        })
        .where(eq(contentJobs.id, newJob.id));
    }

    logger.info(
      {
        job_id: newJob.id,
        status: newJob.status,
        has_script: !!script_text,
        pre_uploaded_assets: pre_uploaded_assets?.length ?? 0,
      },
      "Created content job",
    );

    // 5. Format-specific routing

    // POLITICAL_COMMENTARY_REACTOR: downloads YouTube video, transcribes, generates commentary
    if (format === "POLITICAL_COMMENTARY_REACTOR") {
      const ingestMeta = (metadata ?? {}) as Record<string, unknown>;
      const youtubeUrl = ingestMeta["youtube_url"] as string | undefined;
      const localSourcePath = ingestMeta["local_source_path"] as
        | string
        | undefined;
      if (!youtubeUrl && !localSourcePath) {
        throw new Error(
          `POLITICAL_COMMENTARY_REACTOR job ${newJob.id} requires metadata.youtube_url or metadata.local_source_path`,
        );
      }
      if (!queues.reactorDownload) {
        throw new Error(
          "reactorDownload queue not available — cannot process POLITICAL_COMMENTARY_REACTOR format",
        );
      }

      const downloadPayload: ReactorDownloadPayload = { job_id: newJob.id };
      await updateJobStatus(db, newJob.id, "REACTOR_DOWNLOADING");
      await queues.reactorDownload.add("reactor-download", downloadPayload);

      logger.info(
        {
          job_id: newJob.id,
          youtube_url: youtubeUrl,
          local_source_path: localSourcePath,
        },
        "Dispatched POLITICAL_COMMENTARY_REACTOR job to reactor-download queue",
      );
      return;
    }

    // BUNDESTAG format: manual clip upload flow (Phase 1 MVP)
    if (format === "BUNDESTAG") {
      if (!bundestag_clip_paths || bundestag_clip_paths.length === 0) {
        throw new Error(
          `BUNDESTAG format requires bundestag_clip_paths — provide absolute filesystem paths to video clips`,
        );
      }

      // Store clip paths in job metadata for downstream processors
      await db
        .update(contentJobs)
        .set({
          metadata: {
            ...metadata,
            bundestag_clip_paths: bundestag_clip_paths,
          },
        })
        .where(eq(contentJobs.id, newJob.id));

      // Dispatch to bundestag-clip-analysis queue
      if (!queues.bundestagClipAnalysis) {
        throw new Error(
          "bundestagClipAnalysis queue not available — cannot process BUNDESTAG format",
        );
      }

      // Single-stream architecture (see BundestagClipAnalysisPayload) — the
      // pipeline processes exactly one video file whose camera angles are
      // already switched in the source stream. Any additional paths beyond
      // the first are not processed; kept in metadata for audit only.
      const clipAnalysisPayload: BundestagClipAnalysisPayload = {
        job_id: newJob.id,
        video_file_path: bundestag_clip_paths[0] || "",
        metadata: {
          ingested_at: new Date().toISOString(),
          submitted_clip_paths: bundestag_clip_paths,
        },
      };

      await queues.bundestagClipAnalysis.add(
        "analyze-clips",
        clipAnalysisPayload,
        {
          jobId: `bundestag-clip-analysis-${newJob.id}`,
          removeOnComplete: false,
          removeOnFail: false,
        },
      );

      logger.info(
        {
          job_id: newJob.id,
          clip_count: bundestag_clip_paths.length,
        },
        "Dispatched BUNDESTAG job to clip analysis queue",
      );

      return;
    }

    if (format === "TECH_COMPARISON" && !script_text) {
      const comparisonMeta = (
        metadata as Record<string, unknown> | undefined
      )?.["comparison"];

      // Both supported shapes — flat {product_a_name, product_b_name} (CLI
      // injectors / smoke tests / the /formats ingest panel) and the canonical
      // {products:[{slot,name}]} array (hub-web create form + renderer) — are
      // resolved by the ONE shared normalizer in @repo/domain. This used to be
      // one of five hand-rolled copies of the same fallback.
      const normalized = normalizeComparison(comparisonMeta);
      const productAName = normalized.productAName;
      const productBName = normalized.productBName;
      const subformat = normalized.subformat;

      if (!normalized.hasBothProducts) {
        throw new Error(
          `TECH_COMPARISON job ${newJob.id} missing product names in metadata.comparison — ` +
            `product_a_name/product_b_name or products:[{slot:"A"|"B",name}] are required. ` +
            describeComparisonShape(comparisonMeta),
        );
      }

      // Products array in the exact shape the renderer expects.
      const productsArray = normalized.products;

      await db
        .update(contentJobs)
        .set({
          title: `${productAName} vs ${productBName}`,
          metadata: {
            ...(metadata as Record<string, unknown>),
            comparison: {
              ...(comparisonMeta as Record<string, unknown>),
              products: productsArray,
            },
          },
        })
        .where(eq(contentJobs.id, newJob.id));

      const hasResearch = hasResearchFiles(pre_uploaded_assets);

      if (hasResearch || skip_research) {
        // Research files provided, OR skip_research set (testing / fully-auto):
        // generate the script now instead of pausing at the AWAITING_RESEARCH
        // human gate. With skip_research the script is written from the LLM's
        // own knowledge (no research context).
        await updateJobStatus(db, newJob.id, "SCRIPTING");

        if (queues.aiGeneration) {
          await queues.aiGeneration.add("script-from-research", {
            generation_type: "script_from_research",
            job_id: newJob.id,
            template_id,
            product_a_name: productAName,
            product_b_name: productBName,
            subformat,
            skip_research: !hasResearch,
          });
        }

        logger.info(
          {
            job_id: newJob.id,
            skip_research: !hasResearch,
            research_file_count: pre_uploaded_assets?.filter(
              (a) => a.type === "research/perplexity",
            ).length,
          },
          hasResearch
            ? "TECH_COMPARISON: dispatched script-from-research (research files provided)"
            : "TECH_COMPARISON: dispatched script-from-research (skip_research — LLM knowledge, no research gate)",
        );
      } else {
        // No research provided → generate prompts, wait for user
        const config = getConfig();

        const anthropic = new Anthropic({
          apiKey: config.ANTHROPIC_API_KEY,
        });

        const promptTemplate = buildResearchPromptGenerationPrompt({
          productA: productAName,
          productB: productBName,
          subformat: subformat as any,
        });

        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          messages: [{ role: "user", content: promptTemplate }],
        });

        const textBlock = message.content.find((b) => b.type === "text");
        const rawText =
          textBlock && textBlock.type === "text"
            ? textBlock.text
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/\s*```$/, "")
                .trim()
            : "{}";

        // Parse Claude response with error handling
        let prompts: string[];
        try {
          const parsed = JSON.parse(rawText);
          if (!Array.isArray(parsed.prompts) || parsed.prompts.length === 0) {
            throw new PipelineValidationError(
              PipelineErrorCode.INVALID_JSON,
              "Claude API response missing prompts array",
              "prompts",
              parsed,
            );
          }
          prompts = parsed.prompts;
        } catch (parseError) {
          logger.error(
            {
              job_id: newJob.id,
              raw_text: rawText.slice(0, 200),
              error:
                parseError instanceof Error
                  ? parseError.message
                  : String(parseError),
            },
            "Failed to parse Claude response for research prompts",
          );
          throw new PipelineValidationError(
            PipelineErrorCode.INVALID_JSON,
            `Failed to parse Claude API response: ${
              parseError instanceof Error
                ? parseError.message
                : String(parseError)
            }`,
            "rawText",
            rawText.slice(0, 200),
          );
        }

        await db
          .update(contentJobs)
          .set({
            status: "AWAITING_RESEARCH",
            status_updated_at: new Date(),
            metadata: {
              ...metadata,
              comparison: {
                ...(comparisonMeta as Record<string, unknown>),
                research_prompts: prompts,
              },
            },
          })
          .where(eq(contentJobs.id, newJob.id));

        logger.info(
          {
            job_id: newJob.id,
            prompt_count: prompts.length,
          },
          "TECH_COMPARISON: generated research prompts, job paused at AWAITING_RESEARCH",
        );

        // Do NOT dispatch to any queue - wait for user to upload research
      }
    }
    // Route based on whether script was pre-provided
    else if (script_text) {
      // Skip AI script generation — transition through SCRIPTING without dispatching
      await updateJobStatus(db, newJob.id, "SCRIPTING");

      // Dispatch YouTube metadata generation in parallel alongside asset collection.
      // Uses the same queue-ai-generation lane at low priority — completes in ~5s
      // well before pre-upload QMS needs the metadata.
      if (queues.aiGeneration) {
        await queues.aiGeneration.add(
          "youtube-metadata",
          {
            generation_type: "youtube_metadata",
            job_id: newJob.id,
            topic: initial_topic ?? format,
            format,
            language: language ?? "en",
          },
          { priority: 5 },
        );
      }

      await updateJobStatusAndDispatch(db, newJob.id, "ASSET_COLLECTION", {
        assetCollection: queues.assetCollection,
      });
      logger.info(
        { job_id: newJob.id },
        "Script pre-provided — skipped AI generation, dispatched to asset collection + metadata generation",
      );
    } else {
      // Normal flow: dispatch to ai-generation for script generation
      await updateJobStatusAndDispatch(db, newJob.id, "SCRIPTING", {
        aiGeneration: queues.aiGeneration,
      });
    }

    logger.info(
      {
        job_id: job.id,
        content_job_id: newJob.id,
      },
      "Ingest job completed",
    );
  };
}

/**
 * Smart Asset Detection Helpers
 */

function hasResearchFiles(
  preUploadedAssets:
    | Array<{ key: string; type: string; size_bytes: number }>
    | undefined,
): boolean {
  if (!preUploadedAssets) return false;
  return preUploadedAssets.some((a) => a.type === "research/perplexity");
}
