/**
 * Tech Footage Collection Processor
 *
 * Handles queue-tech-footage-collection jobs.
 * Runs between SCRIPTING and ASSET_COLLECTION for TECH_COMPARISON format.
 *
 * Flow:
 * 1. Load job + extract product names from metadata
 * 2. Split script into paragraph-scenes
 * 3. Call footage-brief-generator (LLM infers block_type + search queries)
 * 4. Call footage-fetcher (yt-dlp → Pexels video → Pexels photo → null)
 * 5. Save footage manifest path to job metadata
 * 6. Transition to ASSET_COLLECTION (success) or TECH_FOOTAGE_FAILED (graceful)
 *
 * On total failure: TECH_FOOTAGE_FAILED transitions to ASSET_COLLECTION anyway,
 * so the pipeline never blocks — it just continues without footage.
 */

import type { Job, Queue } from "bullmq";
import { eq } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import { contentJobs } from "@repo/db";
import { updateJobStatus } from "../utils/update-job-status.js";
import { generateFootageBrief } from "../utils/footage-brief-generator.js";
import {
  fetchFootageForJob,
  footageLocalPathToUrl,
} from "../utils/footage-fetcher.js";
import { createContextLogger } from "@repo/logger";
import { normalizeComparison, describeComparisonShape } from "@repo/domain";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import type { TechFootageCollectionPayload } from "@repo/contracts";
import { TechFootageCollectionPayloadSchema } from "@repo/contracts";

const logger = createContextLogger("tech-footage-collection");

export function createTechFootageCollectionProcessor(
  db: DrizzleClient,
  queues: { assetCollection: Queue },
) {
  return async (job: Job<TechFootageCollectionPayload>) => {
    const { job_id } = TechFootageCollectionPayloadSchema.parse(job.data);
    try {
      return await runTechFootageCollection(db, queues, job, job_id);
    } catch (err) {
      /**
       * ── The graceful path the header has always promised ──────────────────
       * This processor had ZERO catch blocks. Its own header said "On total
       * failure: TECH_FOOTAGE_FAILED transitions to ASSET_COLLECTION anyway,
       * so the pipeline never blocks" — but nothing ever wrote that status,
       * its worker has no onFailed hook (only assetCollectionWorker does), and
       * TECH_FOOTAGE_COLLECTING has no stale-job-watchdog rule. So a throw
       * meant three silent BullMQ attempts and then a row sitting in
       * TECH_FOOTAGE_COLLECTING with no error recorded, until job-auto-delete
       * removed it at 48h. Observed live on job c65abcfe (2026-08-06).
       *
       * The failure is now RECORDED — status plus the message on the job — and
       * only then does the pipeline continue, which asset-collection.ts:826
       * already knows how to accept. A comparison video without b-roll is a
       * poor video; a job that vanishes without a trace is an unfixable one.
       */
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { job_id, error: message },
        "tech-footage-collection FAILED — recording TECH_FOOTAGE_FAILED and continuing without footage",
      );
      try {
        await db
          .update(contentJobs)
          .set({ error_message: `Footage collection failed: ${message}` })
          .where(eq(contentJobs.id, job_id));
        await updateJobStatus(db, job_id, "TECH_FOOTAGE_FAILED");
        await queues.assetCollection.add("collect-assets", { job_id });
      } catch (recordErr) {
        // If we cannot even record the failure, let BullMQ retry — a job that
        // is invisible in BOTH the queue and the database is the one outcome
        // with no route back.
        logger.error(
          {
            job_id,
            error:
              recordErr instanceof Error
                ? recordErr.message
                : String(recordErr),
          },
          "tech-footage-collection could not record its own failure",
        );
        throw err;
      }
    }
  };
}

async function runTechFootageCollection(
  db: DrizzleClient,
  queues: { assetCollection: Queue },
  job: Job<TechFootageCollectionPayload>,
  job_id: string,
): Promise<void> {
  logger.info({ job_id }, "tech-footage-collection processor started");

  const [contentJob] = await db
    .select()
    .from(contentJobs)
    .where(eq(contentJobs.id, job_id))
    .limit(1);

  if (!contentJob) throw new Error(`Job ${job_id} not found`);

  const metadata = (contentJob.metadata ?? {}) as Record<string, unknown>;
  const comparison = metadata["comparison"];

  // Both supported shapes resolved by the ONE shared normalizer in
  // @repo/domain (flat product_a_name/product_b_name ↔ products[{slot,name}]).
  const normalized = normalizeComparison(comparison);
  const productA = normalized.productAName;
  const productB = normalized.productBName;

  if (!normalized.hasBothProducts) {
    throw new Error(
      `Job ${job_id}: missing product names in metadata — comparison.product_a_name and comparison.product_b_name (or comparison.products array) are required. ` +
        describeComparisonShape(comparison),
    );
  }

  const scriptText = contentJob.script ?? "";
  if (!scriptText.trim()) {
    throw new Error(
      `Job ${job_id}: script is empty — footage collection cannot proceed without script text`,
    );
  }

  // Read an optional VA-audited data_grid (packages/db comparison-data-grid-editor.tsx
  // writes here). Chart-heavy block types only enter rotation when this is populated —
  // without real scores/dimensions those blocks would render empty or zeroed out.
  const dataGridRaw = normalized.dataGrid as
    | {
        dimensions?: string[];
        scores?: Record<string, Record<string, number>>;
      }
    | undefined;
  const dgDimensions = Array.isArray(dataGridRaw?.dimensions)
    ? (dataGridRaw!.dimensions as string[])
    : [];
  const dgScores = dataGridRaw?.scores ?? {};
  const hasDataGrid =
    dgDimensions.length > 0 && Object.keys(dgScores).length > 0;
  const winnerSlot = hasDataGrid
    ? computeWinnerSlot(dgScores, productA, productB)
    : null;

  // Split script into paragraphs and infer block types procedurally.
  const paragraphs = scriptText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 20);

  let dimensionCursor = 0;
  const scenes = paragraphs.map((paragraph, i) => {
    const blockType = inferBlockType(i, paragraphs.length, hasDataGrid);
    let dimension: string | null = null;
    if (blockType === "FEATURE_HIGHLIGHT" && dgDimensions.length > 0) {
      dimension = dgDimensions[dimensionCursor % dgDimensions.length] ?? null;
      dimensionCursor += 1;
    }
    return {
      scene_index: i,
      block_type: blockType,
      paragraph,
      product_slot: inferProductSlot(i, blockType, winnerSlot),
      comparison_dimension: dimension,
      duration_seconds: 10,
    };
  });

  // Build assembly_manifest scenes
  const assemblyScenes = scenes.map((s) => {
    const sentenceParts = s.paragraph
      .split(/(?<=[.!?])\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 10);

    const texts =
      sentenceParts.length > 0 ? sentenceParts : [s.paragraph.slice(0, 200)];

    const sentenceImages = texts.map((text) => ({
      sentence_text: text,
      image_prompt: buildTechImagePrompt(
        text,
        s.block_type,
        productA,
        productB,
      ),
      enriched_image_prompt: null,
      is_key_fact: false,
      key_fact_text: null,
      group_index: null,
      r2_key: null,
    }));

    return {
      scene_index: s.scene_index,
      comparison_block_type: s.block_type,
      comparison_product_slot: s.product_slot,
      comparison_dimension: s.comparison_dimension,
      paragraph: s.paragraph,
      start_frame: null as number | null,
      end_frame: null as number | null,
      duration_frames: null as number | null,
      sentence_images: sentenceImages,
      visual_asset_key: null as string | null,
    };
  });

  const existingManifest =
    (contentJob.assembly_manifest as Record<string, unknown> | null) ?? {};

  let footageManifestPath: string | null = null;

  // NOTE: the job is already at TECH_FOOTAGE_COLLECTING by the time this
  // processor runs — both real dispatchers (ai-generation.ts's
  // script_from_research handler) set that status *before* enqueueing here.
  // A same-state updateJobStatus() call used to sit here and unconditionally
  // threw "Invalid transition from TECH_FOOTAGE_COLLECTING to
  // TECH_FOOTAGE_COLLECTING" (self-transitions aren't in TRANSITION_MAP),
  // crashing every real TECH_COMPARISON job before footage collection ever
  // started. There is nothing to transition here — removed.

  const brief = await generateFootageBrief({
    product_a: productA,
    product_b: productB,
    scenes,
  });

  const manifest = await fetchFootageForJob(
    brief,
    contentJob.channel_id,
    job_id,
  );

  const localMediaRoot =
    process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";
  footageManifestPath = join(
    localMediaRoot,
    contentJob.channel_id,
    job_id,
    "footage",
    "manifest.json",
  );

  const manifestWithUrls = {
    ...manifest,
    scenes: manifest.scenes.map((s) => ({
      ...s,
      public_url: footageLocalPathToUrl(s.local_path),
    })),
  };

  const urlManifestPath = join(
    localMediaRoot,
    contentJob.channel_id,
    job_id,
    "footage",
    "manifest-urls.json",
  );
  await mkdir(join(localMediaRoot, contentJob.channel_id, job_id, "footage"), {
    recursive: true,
  });
  await writeFile(urlManifestPath, JSON.stringify(manifestWithUrls, null, 2));

  const fetched = manifest.scenes.length;
  logger.info(
    { job_id, fetched, total: manifest.scenes.length },
    "footage collection complete",
  );

  await db
    .update(contentJobs)
    .set({
      metadata: {
        ...metadata,
        footage_manifest_path: footageManifestPath,
        footage_manifest_urls_path: urlManifestPath,
        footage_fetched_count: fetched,
        footage_total_scenes: manifest.scenes.length,
      },
      assembly_manifest: {
        ...existingManifest,
        render_seed: Math.floor(Math.random() * 10000),
        scenes: assemblyScenes,
      },
      updated_at: new Date(),
    })
    .where(eq(contentJobs.id, job_id));

  await updateJobStatus(db, job_id, "ASSET_COLLECTION");
  await queues.assetCollection.add("asset-collection", { job_id });

  logger.info({ job_id, fetched }, "transitioned to ASSET_COLLECTION");
}

function buildTechImagePrompt(
  sentence: string,
  blockType: string,
  productA: string,
  productB: string,
): string {
  const snippet =
    sentence.length > 120 ? sentence.slice(0, 120) + "..." : sentence;
  const productAFirst = productA.split(" ")[0] ?? productA;
  const productBFirst = productB.split(" ")[0] ?? productB;

  if (blockType === "HOOK") {
    return `${snippet} — cinematic tech product comparison hero shot, clean studio background, dramatic lighting, 4K professional photography`;
  }
  if (blockType === "CTA") {
    return `${productA} versus ${productB} side-by-side product comparison, clean studio background, professional product photography`;
  }
  if (blockType === "VERDICT" || blockType === "FINAL_VERDICT") {
    return `Award trophy and ${productA} vs ${productB} product comparison, winner announcement, professional studio photography`;
  }

  const mentionsA = sentence
    .toLowerCase()
    .includes(productAFirst.toLowerCase());
  const mentionsB = sentence
    .toLowerCase()
    .includes(productBFirst.toLowerCase());

  if (mentionsA && !mentionsB) {
    return `${productA} laptop computer, ${snippet}, professional product photography, clean white background`;
  }
  if (mentionsB && !mentionsA) {
    return `${productB} laptop computer, ${snippet}, professional product photography, clean white background`;
  }

  return `${productA} vs ${productB}: ${snippet}, tech product comparison photography, professional studio`;
}

/**
 * Infer a block_type based on paragraph position, procedurally covering the
 * full Remotion comparison block vocabulary (see block-type-mapper.ts in
 * worker-render). The LLM (footage-brief-generator) only refines search
 * queries per scene — it never changes block_type, so this function is the
 * single source of truth for which Remotion component each scene renders.
 *
 * Mandatory structure (mirrors the scene_analysis prompt design intent in
 * seed-comparison-x-vs-y-software.ts):
 *   - HOOK: exactly 1, scene 0
 *   - PRODUCT_INTRO: up to 2 (one per product), right after the hook
 *   - VERDICT / FINAL_VERDICT: exactly 1, second-to-last (alternates for
 *     visual variety — VERDICT_PODIUM doesn't require a data_grid, so it's
 *     always safe to use)
 *   - CTA: exactly 1, last
 *   - Everything between is a "body" cycle of content-rich block types.
 *     Chart-heavy types (spec tables, bar/radar charts, score gauges) only
 *     enter the body rotation when hasDataGrid is true — without real
 *     scores/dimensions those blocks render empty or zeroed out, which is
 *     worse than not showing one at all.
 */
function inferBlockType(
  index: number,
  total: number,
  hasDataGrid: boolean,
): string {
  if (total <= 1) return "FEATURE_HIGHLIGHT";
  if (index === 0) return "HOOK";
  if (index === total - 1) return "CTA";
  if (total >= 3 && index === total - 2) {
    return index % 2 === 0 ? "VERDICT" : "FINAL_VERDICT";
  }

  if (index === 1) return "PRODUCT_INTRO";
  if (index === 2 && total >= 6) return "PRODUCT_INTRO";

  const bodyTypes = hasDataGrid
    ? [
        "FEATURE_HIGHLIGHT",
        "HEAD_TO_HEAD",
        "PRICE_COMPARISON",
        "FEATURE_HIGHLIGHT",
        "DATA_COMPARISON",
        "FEATURE_HIGHLIGHT",
        "HEAD_TO_HEAD_V2",
        "DIMENSION_COMPARISON",
        "FEATURE_HIGHLIGHT",
        "SCORE_OVERVIEW",
      ]
    : ["FEATURE_HIGHLIGHT", "PRICE_COMPARISON"];

  const bodyStart = total >= 6 ? 3 : 1;
  const bodyIndex = Math.max(0, index - bodyStart);
  return bodyTypes[bodyIndex % bodyTypes.length]!;
}

/**
 * Infer product slot (A/B) for PRODUCT_INTRO blocks, or the computed winner
 * slot for FINAL_VERDICT (VerdictPodium reads comparison_product_slot as the
 * winner); null for every other block type.
 */
function inferProductSlot(
  index: number,
  blockType: string,
  winnerSlot: "A" | "B" | null,
): "A" | "B" | null {
  if (blockType === "PRODUCT_INTRO") return index === 1 ? "A" : "B";
  if (blockType === "FINAL_VERDICT") return winnerSlot;
  return null;
}

/**
 * Sum each product's data_grid scores and return whichever is higher.
 * Mirrors the same "sum of per-dimension scores" heuristic VerdictBuildup.tsx
 * uses at render time, so the footage/scene manifest agrees with what the
 * render will visually declare as the winner.
 */
function computeWinnerSlot(
  scores: Record<string, Record<string, number>>,
  productA: string,
  productB: string,
): "A" | "B" | null {
  const scoresA = scores[productA] ?? scores["A"] ?? {};
  const scoresB = scores[productB] ?? scores["B"] ?? {};
  const sumA = Object.values(scoresA).reduce(
    (s, v) => s + (typeof v === "number" ? v : 0),
    0,
  );
  const sumB = Object.values(scoresB).reduce(
    (s, v) => s + (typeof v === "number" ? v : 0),
    0,
  );
  if (sumA === 0 && sumB === 0) return null;
  return sumA >= sumB ? "A" : "B";
}
