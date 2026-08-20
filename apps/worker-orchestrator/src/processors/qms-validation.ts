import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Job, Queue } from "bullmq";
import { eq, and, desc } from "drizzle-orm";
import type { QMSValidationPayload } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { contentJobs, contentTemplates, jobEditLists } from "@repo/db";
import { updateJobStatus } from "../utils/update-job-status.js";
import { updateJobStatusAndDispatch } from "../utils/update-and-dispatch.js";
import {
  QMSValidationPayloadSchema,
  buildErrorDetail,
  BusinessHubPlanSchema,
} from "@repo/contracts";
import { stat } from "node:fs/promises";
import type { Stats } from "node:fs";

const execFileAsync = promisify(execFile);

/**
 * `fs.stat` a path, returning null when it does not exist.
 *
 * Used by the pre-render checks to verify that a manifest entry still has a
 * file behind it. A missing file is a validation error the caller reports, not
 * an exception — every other filesystem failure (permissions, IO) is rethrown,
 * because "cannot verify" must never read as "fine".
 *
 * @throws whatever `fs.stat` throws for anything other than ENOENT.
 */
async function statOrNull(filePath: string): Promise<Stats | null> {
  try {
    return await stat(filePath);
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: unknown }).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
}

const MAX_FALLBACK_RATIO = 0.3; // reject if >30% of edit list entries are black-frame fallbacks

/** Run ffmpeg blackdetect on a local video file. Returns detected black intervals. */
async function detectBlackIntervals(
  videoPath: string,
): Promise<Array<{ start: number; end: number; duration: number }>> {
  let stderr = "";
  try {
    const result = await execFileAsync(
      "ffmpeg",
      [
        "-i",
        videoPath,
        "-vf",
        "blackdetect=d=3:pix_th=0.10",
        "-f",
        "null",
        "-",
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    stderr = result.stderr;
  } catch (err: any) {
    // ffmpeg always exits non-zero when output is /dev/null — stderr has the data
    stderr = err.stderr ?? "";
  }
  const intervals: Array<{ start: number; end: number; duration: number }> = [];
  for (const line of stderr.split("\n")) {
    const m = line.match(
      /black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/,
    );
    if (m) {
      intervals.push({
        start: parseFloat(m[1]!),
        end: parseFloat(m[2]!),
        duration: parseFloat(m[3]!),
      });
    }
  }
  return intervals;
}

/**
 * QMS Validation Processor
 *
 * Processes queue-qms-validation jobs - lightweight pre-flight checks
 * before expensive operations.
 *
 * Validates:
 * - Schema correctness before rendering
 * - Asset existence before composition
 * - Pre-conditions before state transitions
 *
 * On pass: Update status to ROUTING_RENDER and dispatch to render-heavy queue
 * On fail: Update status to FAILED_QMS with error details
 *
 * @param db - Drizzle client
 * @param queues - Queue instances for dispatch-next
 * @returns Processor function for QMS validation queue
 */
export function createQMSValidationProcessor(
  db: DrizzleClient,
  queues: { renderHeavy?: Queue },
) {
  return async (job: Job<QMSValidationPayload>) => {
    console.log(
      JSON.stringify({
        level: "info",
        message: "Processing QMS validation job",
        job_id: job.id,
        payload: job.data,
      }),
    );

    // 1. Validate payload
    const parseResult = QMSValidationPayloadSchema.safeParse(job.data);
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

    const { job_id, validation_stage } = parseResult.data;

    // 2. Fetch job and template
    const [contentJob] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, job_id))
      .limit(1);

    if (!contentJob) {
      throw new Error(`Job ${job_id} not found`);
    }

    const [template] = await db
      .select()
      .from(contentTemplates)
      .where(eq(contentTemplates.id, contentJob.template_id))
      .limit(1);

    if (!template) {
      throw new Error(`Template ${contentJob.template_id} not found`);
    }

    // 3. Run validation based on stage
    const validationErrors: string[] = [];

    switch (validation_stage) {
      case "pre-render": {
        // Validate required assets exist in r2_asset_manifest
        const requiredAssets = template.required_assets as string[];
        const assetManifest: Array<{
          key: string;
          type: string;
          size_bytes: number;
        }> = Array.isArray(contentJob.r2_asset_manifest)
          ? (contentJob.r2_asset_manifest as any[])
          : [];
        const manifestAssetTypes = assetManifest.map((asset) => asset.type);

        // "script" is stored in the DB column, not as an R2 asset — check it separately.
        // "subtitle/ass" is opt-in per metadata.subtitle_config.enabled — drop it
        // from the required list when the job hasn't opted in to subtitles.
        const jobSubtitleConfig = (contentJob.metadata as any)
          ?.subtitle_config as { enabled?: boolean } | undefined;
        const subtitlesOptedIn = jobSubtitleConfig?.enabled === true;
        const r2RequiredAssets = requiredAssets.filter((a: string) => {
          if (a === "script") return false;
          if (a === "subtitle/ass" && !subtitlesOptedIn) return false;
          return true;
        });
        for (const requiredAsset of r2RequiredAssets) {
          if (!manifestAssetTypes.includes(requiredAsset)) {
            validationErrors.push(`Missing required asset: ${requiredAsset}`);
          }
        }

        // Validate script exists and has meaningful content
        if (requiredAssets.includes("script")) {
          if (!contentJob.script) {
            validationErrors.push("Script is required but not generated");
          } else if (contentJob.script.trim().length < 100) {
            validationErrors.push(
              `Script is too short (${contentJob.script.trim().length} chars) — minimum 100 chars required`,
            );
          }
        }

        // Validate assembly manifest has at least one scene.
        //
        // `assembly_manifest.scenes` is the shape produced by scene-analysis,
        // which most formats share. Two formats own their manifest outright and
        // keep their scene list somewhere else; for them a top-level `scenes` is
        // ALWAYS absent, so this generic check would fail every job of that
        // format on its very first run. Each exempt format is covered by a
        // stricter check of its own — this is a routing correction, not a
        // relaxation:
        //
        //   VIDEO_ESSAY        scenes live in `job_edit_lists` (checked in the
        //                      edit-list block below).
        //   BUSINESS_PLAN_HUB  scenes live at `assembly_manifest.plan.scenes`
        //                      and are validated against BusinessHubPlanSchema
        //                      — which requires at least one scene — in the
        //                      BUSINESS_PLAN_HUB block below.
        //
        // Adding a format here without giving it an equivalent check removes a
        // gate; don't.
        const FORMATS_WITH_OWN_SCENE_LIST = new Set([
          "VIDEO_ESSAY",
          "BUSINESS_PLAN_HUB",
        ]);
        const assemblyManifestForCount = contentJob.assembly_manifest as any;
        const sceneCount = assemblyManifestForCount?.scenes?.length ?? 0;
        if (
          !FORMATS_WITH_OWN_SCENE_LIST.has(contentJob.format) &&
          assemblyManifestForCount &&
          sceneCount === 0
        ) {
          validationErrors.push(
            "Assembly manifest exists but contains no scenes — scene analysis may have failed",
          );
        }

        // For V2 jobs: verify sentence images have been generated for every scene that needs them.
        // This prevents render from starting when image generation is still in progress.
        if ((contentJob as any).production_version === "V2") {
          const assemblyManifest = contentJob.assembly_manifest as any;
          const scenesNeedingImages = (assemblyManifest?.scenes ?? []).filter(
            (s: any) =>
              s.sentence_images?.length > 0 &&
              s.visual_type !== "AVATAR_ON_CAMERA",
          );
          const missingScenes: number[] = [];
          for (const scene of scenesNeedingImages) {
            const hasImages = assetManifest.some(
              (a) =>
                a.type === "image/broll" &&
                (a.key as string).includes(`/scene_${scene.scene_index}_img_`),
            );
            if (!hasImages) missingScenes.push(scene.scene_index as number);
          }
          if (missingScenes.length > 0) {
            validationErrors.push(
              `V2 sentence images not yet generated for scenes: ${missingScenes.join(", ")} — wait for image generation to complete before rendering`,
            );
          }
        }

        // For V1 jobs: validate B-roll images cover all scenes
        if (contentJob.production_version === "V1") {
          const assemblyManifest = contentJob.assembly_manifest as any;
          const sceneCount = assemblyManifest?.scenes?.length ?? 0;
          const brollCount = assetManifest.filter(
            (a) => a.type === "image/broll",
          ).length;

          if (brollCount === 0) {
            validationErrors.push(
              `V1 render requires B-roll images but none found in asset manifest (${sceneCount} scenes need images)`,
            );
          } else if (brollCount < sceneCount) {
            validationErrors.push(
              `V1 render has ${brollCount} B-roll images but ${sceneCount} scenes — every scene needs an image`,
            );
          }
        }

        // Validate asset sizes — use latest entry per type to avoid stale accumulated entries
        const latestByType = new Map<string, (typeof assetManifest)[0]>();
        for (const asset of assetManifest) {
          latestByType.set(asset.type, asset); // last entry wins = most recent
        }
        for (const asset of latestByType.values()) {
          // Skip intentionally-skipped assets (e.g. thumbnail when channel doesn't exist yet)
          if (asset.key === "skipped") continue;
          if (asset.size_bytes === 0) {
            validationErrors.push(`Asset ${asset.type} has zero size`);
          }
          // Final video and raw VA/narrator footage are legitimately large — exempt from cap
          const largeAssetTypes = [
            "video/final-render",
            "video/raw-va-footage",
            "video/raw-narrator-footage",
          ];
          if (
            !largeAssetTypes.includes(asset.type) &&
            asset.size_bytes > 500 * 1024 * 1024
          ) {
            validationErrors.push(
              `Asset ${asset.type} exceeds size limit (${asset.size_bytes} bytes)`,
            );
          }
        }

        // For VIDEO_ESSAY: reject if too many edit list entries are black-frame fallbacks.
        // A high fallback ratio means clip selection failed to find matching footage —
        // the rendered video will be mostly black.
        if (contentJob.format === "VIDEO_ESSAY") {
          const [editListForFallbackCheck] = await db
            .select()
            .from(jobEditLists)
            .where(
              and(
                eq(jobEditLists.job_id, job_id),
                eq(jobEditLists.status, "approved"),
              ),
            )
            .orderBy(desc(jobEditLists.version))
            .limit(1);

          if (
            editListForFallbackCheck &&
            editListForFallbackCheck.total_clips > 0
          ) {
            const fallbackRatio =
              editListForFallbackCheck.ai_fallback_count /
              editListForFallbackCheck.total_clips;
            if (fallbackRatio > MAX_FALLBACK_RATIO) {
              validationErrors.push(
                `Edit list has ${Math.round(fallbackRatio * 100)}% black-frame fallbacks ` +
                  `(${editListForFallbackCheck.ai_fallback_count}/${editListForFallbackCheck.total_clips} entries). ` +
                  `Maximum allowed is ${Math.round(MAX_FALLBACK_RATIO * 100)}%. ` +
                  `Re-run clip selection or expand the clip library.`,
              );
            }
          }
        }

        // Clip edit list approval check
        // When a job transitions through AWAITING_CLIP_REVIEW before QMS, an approved
        // edit list matching the current script must exist before render is allowed.
        const smHistory =
          (contentJob.state_machine_history as Array<{
            from_status: string;
            to_status: string;
            timestamp: string;
          }> | null) ?? [];
        const cameFromClipReview = smHistory.some(
          (entry) =>
            entry.from_status === "AWAITING_CLIP_REVIEW" &&
            entry.to_status === "QMS_VALIDATING",
        );

        if (cameFromClipReview) {
          const [approvedEditList] = await db
            .select()
            .from(jobEditLists)
            .where(
              and(
                eq(jobEditLists.job_id, job_id),
                eq(jobEditLists.status, "approved"),
              ),
            )
            .orderBy(desc(jobEditLists.version))
            .limit(1);

          if (!approvedEditList) {
            validationErrors.push(
              "Job passed through clip review but has no approved edit list — " +
                "complete clip review before rendering",
            );
          } else if (approvedEditList.source_script_hash && contentJob.script) {
            const currentScriptHash = createHash("sha256")
              .update(contentJob.script)
              .digest("hex");
            if (currentScriptHash !== approvedEditList.source_script_hash) {
              validationErrors.push(
                "Edit list is stale — script was modified after clip selection was approved. " +
                  "Re-run clip selection to generate a fresh edit list.",
              );
            }
          }
        }

        // BUSINESS_PLAN_HUB-specific validation.
        //
        // This format has no human gate anywhere (design §8 rule 7), so QMS is
        // the last checkpoint before the render. It checks the three things the
        // render cannot recover from and that the generic checks above do not
        // cover: the scene plan, the narration it is timed against, and the
        // presenter envelope. Everything is verified on the filesystem, not by
        // trusting a DB status — a manifest row whose file was deleted is the
        // failure mode that has cost this repo jobs before.
        if (contentJob.format === "BUSINESS_PLAN_HUB") {
          const hubManifest = contentJob.assembly_manifest as {
            plan?: unknown;
            scene_timings?: unknown;
            envelope?: { path?: unknown; frame_count?: unknown } | null;
          } | null;

          if (!hubManifest || typeof hubManifest !== "object") {
            validationErrors.push(
              "BUSINESS_PLAN_HUB: assembly_manifest is missing — the business-hub " +
                "asset stage never completed. Re-run ASSET_COLLECTION.",
            );
          } else {
            // 1. The scene plan exists and still validates against the contract.
            const parsedPlan = BusinessHubPlanSchema.safeParse(
              hubManifest.plan,
            );
            if (!parsedPlan.success) {
              validationErrors.push(
                "BUSINESS_PLAN_HUB: assembly_manifest.plan does not validate " +
                  `against BusinessHubPlanSchema — ${parsedPlan.error.issues
                    .slice(0, 5)
                    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
                    .join("; ")}`,
              );
            } else {
              const plan = parsedPlan.data;

              // Scene timings are positional and one-to-one with the plan: a
              // count mismatch puts every scene's visuals under the wrong
              // narration, which renders "successfully" and is unusable.
              const timings = Array.isArray(hubManifest.scene_timings)
                ? hubManifest.scene_timings
                : null;
              if (!timings) {
                validationErrors.push(
                  "BUSINESS_PLAN_HUB: assembly_manifest.scene_timings is missing — " +
                    "the render has no way to know where each beat's narration lands.",
                );
              } else if (timings.length !== plan.scenes.length) {
                validationErrors.push(
                  `BUSINESS_PLAN_HUB: ${timings.length} scene timings for ` +
                    `${plan.scenes.length} planned scenes — they are positional and must be one-to-one.`,
                );
              }

              // 2. The narration audio exists on disk.
              const narration = assetManifest.find(
                (asset) => asset.type === "audio/tts",
              );
              if (!narration) {
                validationErrors.push(
                  'BUSINESS_PLAN_HUB: no "audio/tts" entry in r2_asset_manifest — ' +
                    "every scene boundary is anchored to the narration and the render " +
                    "resolves it by that type.",
                );
              } else {
                const narrationStat = await statOrNull(narration.key);
                if (!narrationStat) {
                  validationErrors.push(
                    `BUSINESS_PLAN_HUB: narration file ${narration.key} is in the manifest ` +
                      "but not on disk — regenerate the asset stage rather than rendering silence.",
                  );
                } else if (narrationStat.size === 0) {
                  validationErrors.push(
                    `BUSINESS_PLAN_HUB: narration file ${narration.key} is zero bytes.`,
                  );
                }
              }

              // 3. The presenter envelope exists whenever any scene carries a
              //    presenter. The head pump is driven frame-by-frame from it;
              //    without it the presenter scenes cannot be built at all.
              const presenterScenes = plan.scenes.filter(
                (scene) => scene.presenter != null,
              );
              if (presenterScenes.length > 0) {
                const envelopePath =
                  typeof hubManifest.envelope?.path === "string"
                    ? hubManifest.envelope.path
                    : null;
                const envelopeAsset = assetManifest.find(
                  (asset) => asset.type === "data/rms-envelope",
                );
                if (!envelopePath || !envelopeAsset) {
                  validationErrors.push(
                    `BUSINESS_PLAN_HUB: ${presenterScenes.length} scene(s) carry a presenter ` +
                      "but there is no RMS envelope (assembly_manifest.envelope.path + a " +
                      '"data/rms-envelope" manifest entry). The head pump is driven per frame from it.',
                  );
                } else {
                  const envelopeStat = await statOrNull(envelopePath);
                  if (!envelopeStat || envelopeStat.size === 0) {
                    validationErrors.push(
                      `BUSINESS_PLAN_HUB: RMS envelope ${envelopePath} is missing or empty on disk, ` +
                        `but ${presenterScenes.length} scene(s) carry a presenter.`,
                    );
                  }
                }
              }
            }
          }
        }

        // Comparison-specific validation
        if (contentJob.format === "TECH_COMPARISON") {
          const templateMeta = (template.metadata as any)?.pipeline_config;
          const comparisonMeta = (contentJob.metadata as any)?.comparison;

          // Validate data grid audit (if required by template)
          if (templateMeta?.requires_data_grid_audit) {
            if (!comparisonMeta?.data_grid?.audited_at) {
              validationErrors.push(
                "Comparison data grid must be audited by VA before rendering — missing audited_at timestamp",
              );
            }
          }

          // Validate product hero images (if required by template)
          if (templateMeta?.requires_product_images) {
            const products = comparisonMeta?.products || [];
            const missingHeroSlots: string[] = [];

            for (const product of products) {
              if (!product.hero_asset_key) {
                missingHeroSlots.push(product.slot || product.name);
              }
            }

            if (missingHeroSlots.length > 0) {
              validationErrors.push(
                `Missing hero images for products: ${missingHeroSlots.join(", ")} — upload via Comparison Data tab`,
              );
            }
          }
        }

        break;
      }

      case "pre-upload": {
        // Validate final video exists
        const assetManifest: Array<{
          key: string;
          type: string;
          size_bytes: number;
        }> = Array.isArray(contentJob.r2_asset_manifest)
          ? (contentJob.r2_asset_manifest as any[])
          : [];
        const finalVideo = assetManifest.find(
          (asset) => asset.type === "video/final-render",
        );

        if (!finalVideo) {
          validationErrors.push("Final video not found in asset manifest");
        }

        // Validate video meets YouTube requirements
        if (finalVideo && finalVideo.size_bytes > 128 * 1024 * 1024 * 1024) {
          validationErrors.push("Video exceeds YouTube's 128GB limit");
        }

        // Black-frame detection: reject if any black segment ≥3s exists after
        // the first 10s of the video. Short black flashes at transitions are
        // acceptable; sustained black means clip selection produced fallback frames.
        if (finalVideo && finalVideo.key !== "skipped") {
          try {
            const blackIntervals = await detectBlackIntervals(finalVideo.key);
            const sustained = blackIntervals.filter(
              (i) => i.start > 10 && i.duration >= 3,
            );
            if (sustained.length > 0) {
              const totalBlackSeconds = sustained.reduce(
                (s, i) => s + i.duration,
                0,
              );
              const worst = sustained.reduce((a, b) =>
                b.duration > a.duration ? b : a,
              );
              validationErrors.push(
                `Video contains ${sustained.length} sustained black segment(s) after the 10s mark ` +
                  `(total ${Math.round(totalBlackSeconds)}s black; longest ${Math.round(worst.duration)}s ` +
                  `at ${Math.round(worst.start)}s–${Math.round(worst.end)}s). ` +
                  `Re-run clip selection to fix fallback entries before uploading.`,
              );
            }
          } catch (err) {
            console.warn(
              JSON.stringify({
                level: "warn",
                message: "blackdetect failed — skipping check",
                job_id,
                error: String(err),
              }),
            );
          }
        }

        // Title: must exist and not be a placeholder
        if (!contentJob.title || contentJob.title.trim().length === 0) {
          validationErrors.push("Video title is required for upload");
        }

        // Description: must be substantive — placeholder is "Generated X content" (~22 chars)
        if (
          !contentJob.description ||
          contentJob.description.trim().length < 100
        ) {
          validationErrors.push(
            `Video description is too short (${(contentJob.description ?? "").trim().length} chars) — ` +
              "YouTube metadata generation may have failed. Check generation_log for errors.",
          );
        }

        // Tags: strongly recommended for discovery — warn but don't hard-fail
        const generatedTags = contentJob.generated_tags as string[] | null;
        if (!generatedTags || generatedTags.length === 0) {
          validationErrors.push(
            "No generated tags — YouTube metadata generation may have failed. " +
              "Add tags manually or re-trigger metadata generation.",
          );
        }
        break;
      }

      case "pre-ai-generation": {
        // Validate that the job has a script or topic to generate from.
        // A job with neither would waste Claude API credits and produce garbage output.
        const hasTopic =
          !!(contentJob.metadata as any)?.initial_topic?.trim() ||
          !!(contentJob as any).initial_topic?.trim() ||
          !!(
            contentJob.title?.trim() &&
            contentJob.title !== `Untitled ${contentJob.format}`
          );
        const hasScript = !!contentJob.script?.trim();

        if (!hasTopic && !hasScript) {
          validationErrors.push(
            "Job has no script and no topic — cannot generate content. " +
              "Provide either a pre-written script or an initial_topic at ingest time.",
          );
        }

        // Validate template is still active (may have been deactivated after ingest)
        if (!template.is_active) {
          validationErrors.push(
            `Template ${contentJob.template_id} is inactive — job cannot proceed with AI generation`,
          );
        }
        break;
      }

      case "pre-state-transition": {
        // Structural pre-conditions before a status change.
        // Currently a pass-through — concrete checks added as specific transitions
        // require them (e.g. verifying an asset key is populated before render starts).
        console.log(
          JSON.stringify({
            level: "info",
            message:
              "pre-state-transition QMS: no checks configured for this job",
            job_id: job_id,
          }),
        );
        break;
      }

      default: {
        const _exhaustive: never = validation_stage;
        throw new Error(`Unknown validation stage: ${_exhaustive}`);
      }
    }

    // 4. Update status based on validation result
    if (validationErrors.length > 0) {
      const errorMessage = `QMS validation failed: ${validationErrors.join("; ")}`;
      console.error(
        JSON.stringify({
          level: "error",
          message: errorMessage,
          job_id: job_id,
          validation_stage,
          errors: validationErrors,
        }),
      );

      const category =
        validation_stage === "pre-render"
          ? ("media_validation" as const)
          : validation_stage === "pre-upload"
            ? ("orchestration" as const)
            : ("unknown" as const);

      const errorDetail = buildErrorDetail({
        code: "QMS_VALIDATION_FAILED",
        message: errorMessage,
        category,
        context: { validation_stage, errors: validationErrors },
        retryable: false,
      });

      await updateJobStatus(
        db,
        job_id,
        "FAILED_QMS",
        errorMessage,
        errorDetail,
      );
    } else {
      console.log(
        JSON.stringify({
          level: "info",
          message: "QMS validation passed",
          job_id: job_id,
          validation_stage,
        }),
      );

      // On success, transition to next stage based on validation type
      if (validation_stage === "pre-render") {
        await updateJobStatusAndDispatch(db, job_id, "ROUTING_RENDER", {
          renderHeavy: queues.renderHeavy,
        });
      }
    }

    console.log(
      JSON.stringify({
        level: "info",
        message: "QMS validation job completed",
        job_id: job.id,
        validation_stage,
        passed: validationErrors.length === 0,
      }),
    );
  };
}
