import type { Job, Queue } from "bullmq";
import { eq } from "drizzle-orm";
import type { SceneAnalysisPayload } from "@repo/contracts";
import {
  SceneAnalysisPayloadSchema,
  getPacingConfig,
  getPacingZone,
  buildErrorDetail,
} from "@repo/contracts";
import type { PacingConfig } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { contentJobs, contentTemplates, environments } from "@repo/db";
import { updateJobStatus } from "../utils/update-job-status.js";
import { callLLM } from "../utils/llm-client.js";
import {
  buildEnrichedImagePrompt,
  buildIllustrationImagePrompt,
  recommendShotType,
  recommendCameraAngle,
  assignPreliminaryLayouts,
  normalizeComparison,
} from "@repo/domain";
import type {
  ShotType,
  CameraAngle,
  VisualTheme,
  PreliminaryLayoutEntry,
} from "@repo/domain";
import type { LayoutType } from "@repo/contracts";

/**
 * Scene Analysis Processor
 *
 * Decomposes a generated script into a structured scene list using Claude.
 * Runs in the dedicated queue-scene-analysis lane (separate from queue-ai-generation
 * to isolate LLM orchestration work from other AI tasks).
 *
 * Input: completed script from content_jobs.script
 * Output: content_jobs.assembly_manifest populated with N scenes, each containing:
 *   - paragraph:       Script text for this scene
 *   - visual_type:     AVATAR_ON_CAMERA | BROLL_IMAGE (BROLL_VIDEO reserved for Phase 2)
 *   - image_prompt:    AI image generation prompt for BROLL_IMAGE scenes (null for avatar)
 *   - ticker_headline: Short news ticker text for the scene
 *   - visual_asset_key: null (populated later by asset-collection)
 *   - start/end/duration_frames: null (computed by render worker from HeyGen duration)
 *
 * Design note on modularity:
 * The VisualType enum and scene structure are intentionally open. Future scene types
 * (LOWER_THIRD_ONLY, SPLIT_SCREEN, DATA_CHART, etc.) extend the enum without
 * changing this processor's contract. Asset collection and render routing
 * dispatch on visual_type, keeping this processor format-agnostic.
 *
 * After writing assembly_manifest, re-triggers asset collection to begin
 * parallel image generation + thumbnail dispatch.
 */
export function createSceneAnalysisProcessor(
  db: DrizzleClient,
  queues: { assetCollection: Queue },
) {
  return async (job: Job<SceneAnalysisPayload>) => {
    console.log(
      JSON.stringify({
        level: "info",
        message: "Scene analysis processor started",
        job_id: job.data.job_id,
      }),
    );

    const parseResult = SceneAnalysisPayloadSchema.safeParse(job.data);
    if (!parseResult.success) {
      throw new Error(`Invalid payload: ${parseResult.error.message}`);
    }

    const { job_id, template_id, script } = parseResult.data;

    try {
      // 1. Fetch template for scene_analysis prompt + pipeline config
      const [template] = await db
        .select()
        .from(contentTemplates)
        .where(eq(contentTemplates.id, template_id))
        .limit(1);

      if (!template) {
        throw new Error(`Template ${template_id} not found`);
      }

      const prompts = template.prompts as Record<string, string>;

      // TECH_COMPARISON uses a single-call analysis path (full script + procedural rules
      // in one Claude call) rather than the per-paragraph parallelism used by other formats.
      if ((template as any).format === "TECH_COMPARISON") {
        // Comparison format requires scene_analysis prompt for procedural generation
        if (!prompts["scene_analysis"]) {
          throw new Error(
            `TECH_COMPARISON template ${template_id} requires scene_analysis prompt`,
          );
        }
        await analyzeComparisonScript(db, job_id, template, script, queues);
        return;
      }

      // Other formats use built-in per-paragraph analysis prompts (buildPerSceneSystemPrompt,
      // buildIllustrationSceneSystemPrompt).
      // They don't use template.prompts["scene_analysis"], so we don't require it.

      // Read image_style and force_layout flags from render_config
      // These drive the illustration-mode routing for formats like CASUALLY_EXPLAINED
      const renderConfig = (template?.render_config as any) ?? {};
      const imageStyle: "illustration" | "photorealistic" =
        renderConfig.image_style ?? "photorealistic";
      const forceLayout = renderConfig.force_layout as LayoutType | undefined;

      // 2. Split script into paragraphs — one scene per paragraph
      const contentDomainPrompt: string | undefined =
        prompts["content_domain"] ?? undefined;
      const paragraphs = splitIntoParagraphs(script);
      const totalScenes = paragraphs.length;

      // Read pacing config from template render_config
      const pacingConfig = getPacingConfig(template.render_config);

      // Fetch job record early — needed for productionVersion and style guidelines
      const [jobRecord] = await db
        .select()
        .from(contentJobs)
        .where(eq(contentJobs.id, job_id))
        .limit(1);
      const productionVersion = (jobRecord as any)?.production_version ?? "V2";

      // Style context for image generation prompts.
      // Modern jobs use style_text_guidelines from Style Collections (preferred).
      // Legacy jobs use style_asset_context from deprecated Style Assets system.
      const styleTextGuidelines: string | undefined =
        (jobRecord as any)?.metadata?.style_text_guidelines ?? undefined;
      const legacyStyleAssetContext: string | undefined =
        (jobRecord as any)?.metadata?.style_asset_context ?? undefined;

      const styleAssetContext = styleTextGuidelines ?? legacyStyleAssetContext;

      if (!styleTextGuidelines && legacyStyleAssetContext) {
        console.warn(
          `[scene-analysis] Job ${job_id} using deprecated style_asset_context. ` +
            `Migrate to style_collections for better style management.`,
        );
      }

      // Optional environment — resolved once for the whole job.
      // Provides a consistent visual setting description and spatial hints (safe zone
      // for AVATAR_PIP overlay) baked into every enriched image prompt.
      const environmentId: string | undefined =
        (jobRecord as any)?.metadata?.environment_id ?? undefined;

      let envDescription: string | undefined;
      let envSafeZoneRight: number | undefined;

      if (environmentId) {
        const [envRow] = await db
          .select()
          .from(environments)
          .where(eq(environments.id, environmentId))
          .limit(1);

        if (envRow) {
          envDescription = `${envRow.name}: ${envRow.description}`;
          const hints = envRow.spatial_hints as Record<string, unknown> | null;
          const rawPct = hints?.["safe_zone_right_percent"];
          if (typeof rawPct === "number" && rawPct > 0) {
            envSafeZoneRight = rawPct;
          }
        }
      }

      // 2b. Assign preliminary layouts BEFORE making Claude calls.
      //     This lets us skip image prompts for layouts that don't show B-roll
      //     (AVATAR_FULLSCREEN). Assumes portrait avatar (HeyGen default 9:16);
      //     the final composition plan at render time uses the same masterSeed
      //     and will reproduce the same layout sequence with real Whisper timings.
      //     If forceLayout is set (e.g. CASUALLY_EXPLAINED locks to AVATAR_PIP),
      //     the biome algorithm is bypassed and all scenes get the forced layout.
      const estimatedWPM = 130;
      const estimatedDurationSeconds =
        (script.trim().split(/\s+/).length / estimatedWPM) * 60;
      const masterSeed = Math.abs(
        job_id
          .split("")
          .reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0),
      );
      const prelimLayouts: PreliminaryLayoutEntry[] = assignPreliminaryLayouts(
        totalScenes,
        masterSeed,
        estimatedDurationSeconds,
        undefined,
        undefined,
        forceLayout,
      );
      const layoutByScene = new Map(
        prelimLayouts.map((e) => [e.scene_index, e]),
      );

      console.log(
        JSON.stringify({
          level: "info",
          message: "Preliminary layout assignment complete",
          job_id,
          scene_count: totalScenes,
          estimated_duration_s: Math.round(estimatedDurationSeconds),
          master_seed: masterSeed,
          no_image_scenes: prelimLayouts.filter((e) => !e.needs_image).length,
        }),
      );

      // Analyze each paragraph with one Claude API call (parallelized, max 4 concurrent)
      const ANALYSIS_CONCURRENCY = 4;
      const results: ParagraphAnalysisResult[] = new Array(totalScenes);
      const tasks = paragraphs.map((para, idx) => async () => {
        const layoutEntry = layoutByScene.get(idx);

        // Retry logic: attempt scene analysis up to 2 times if JSON parse or validation fails
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            results[idx] = await analyzeOneParagraph(
              para,
              idx,
              totalScenes,
              pacingConfig,
              contentDomainPrompt,
              layoutEntry?.needs_image ?? true,
              imageStyle,
              (jobRecord as any)?.format,
            );
            return; // Success - exit retry loop
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt === 0) {
              // First failure - log and retry
              console.warn(
                JSON.stringify({
                  level: "warn",
                  message: "Scene analysis failed on first attempt, retrying",
                  scene_index: idx,
                  error: lastError.message,
                }),
              );
            } else {
              // Second failure - propagate error
              console.error(
                JSON.stringify({
                  level: "error",
                  message: "Scene analysis failed after retry",
                  scene_index: idx,
                  error: lastError.message,
                }),
              );
              throw lastError;
            }
          }
        }
      });

      // Run tasks with concurrency limit
      await (async () => {
        let next = 0;
        let active = 0;
        await new Promise<void>((resolve, reject) => {
          function runNext() {
            while (active < ANALYSIS_CONCURRENCY && next < tasks.length) {
              const task = tasks[next++]!;
              active++;
              task()
                .then(() => {
                  active--;
                  if (active === 0 && next >= tasks.length) resolve();
                  else runNext();
                })
                .catch(reject);
            }
            if (next >= tasks.length && active === 0) resolve();
          }
          runNext();
        });
      })();

      // Build rawScenes array compatible with downstream assembly manifest construction
      const rawScenes: RawScene[] = paragraphs.map((paragraph, idx) => {
        const analysis = results[idx]!;
        return {
          scene_index: idx,
          paragraph,
          visual_type: analysis.visual_type,
          // scene-level image_prompt is kept for V1 backward compat — V1 uses this single prompt;
          // V2 uses sentence_images entries individually.
          image_prompt: analysis.sentence_images[0]?.image_prompt ?? null,
          ticker_headline: analysis.ticker_headline,
          shot_type: (analysis.shot_type as ShotType) ?? null,
          camera_angle: analysis.camera_angle,
          visual_theme: analysis.visual_theme,
          sentence_images: analysis.sentence_images,
        };
      });

      console.log(
        JSON.stringify({
          level: "info",
          message: "Scene analysis complete",
          job_id,
          scene_count: rawScenes.length,
        }),
      );

      // 3. Build assembly_manifest (no timing yet — computed at render time)
      //    Enrich image prompts — routing to illustration or photorealistic path
      //    depending on the template's image_style flag.
      const stylePrefix = (template.metadata as any)?.style_preset
        ?.prompt_prefix;
      const styleSuffix = (template.metadata as any)?.style_preset
        ?.prompt_suffix;

      // Extract global visual theme from first scene that has one (Claude infers per scene)
      const globalVisualTheme =
        rawScenes.find((s) => s.visual_theme)?.visual_theme ?? null;

      // Prompt builder router — illustration formats skip broadcast photography enrichment.
      // layoutType is passed for photorealistic scenes so the PIP spatial constraint is only
      // injected when the avatar overlay will actually be visible.
      const jobFormat: string | undefined = (jobRecord as any)?.format;
      const buildScenePrompt = (
        raw: string,
        shotType: ShotType,
        cameraAngle: string,
        visualTheme: VisualTheme | undefined,
        layoutType?: LayoutType,
      ): string => {
        if (imageStyle === "illustration") {
          if (raw.startsWith("PHOTO:")) {
            const photoRaw = raw.slice(6).trim();
            // PHOTO: scenes (CASUALLY_EXPLAINED-only in practice) request a
            // photorealistic named object. The template's illustration-flavored
            // stylePrefix/styleSuffix (e.g. "no photorealism, no photography")
            // directly contradicts that — buildEnrichedImagePrompt already
            // supplies its own photographic realism modifiers, so skip them here.
            return buildEnrichedImagePrompt({
              rawDescription: photoRaw,
              shotType,
              cameraAngle: cameraAngle as CameraAngle,
              visualTheme,
            });
          }
          return buildIllustrationImagePrompt({
            rawDescription: raw,
            stylePrefix,
            styleSuffix,
            styleAssetContext,
            hybridStyle: jobFormat === "CASUALLY_EXPLAINED",
          });
        }
        // Only inject the PIP safe-zone constraint for AVATAR_PIP scenes
        const preserveRight =
          layoutType === "AVATAR_PIP" ? envSafeZoneRight : undefined;
        return buildEnrichedImagePrompt({
          rawDescription: raw,
          shotType,
          cameraAngle: cameraAngle as CameraAngle,
          visualTheme,
          stylePrefix,
          styleSuffix,
          environmentDescription: envDescription,
          preserveRightPercent: preserveRight,
        });
      };

      const assemblyManifest = {
        render_seed: masterSeed, // stored so render uses same seed → same layout sequence
        scenes: rawScenes.map((scene: RawScene, i: number) => {
          const needsImage =
            scene.visual_type === "BROLL_IMAGE" ||
            scene.visual_type === "AVATAR_PIP";
          const shotType =
            scene.shot_type ?? recommendShotType(i, rawScenes.length);
          const cameraAngle =
            scene.camera_angle ?? recommendCameraAngle(i, rawScenes.length);
          const visualTheme =
            scene.visual_theme ?? globalVisualTheme ?? undefined;
          // Known layout for this scene (used to conditionally inject PIP spatial constraint)
          const layoutType = layoutByScene.get(i)?.layout_type;

          // Build enriched prompt (photorealistic or illustration depending on template)
          let enrichedImagePrompt: string | null = null;
          if (scene.visual_type !== "AVATAR_ON_CAMERA" && scene.image_prompt) {
            enrichedImagePrompt = buildScenePrompt(
              scene.image_prompt,
              shotType,
              cameraAngle,
              visualTheme,
              layoutType,
            );
          }

          // Enrich per-sentence image prompts
          const enrichedSentenceImages = scene.sentence_images.map(
            (si, sentenceIdx) => {
              const enrichedPrompt = buildScenePrompt(
                si.image_prompt,
                shotType,
                cameraAngle,
                visualTheme,
                layoutType,
              );

              // Special handling for Scene 0: first 1-2 sentences get scene-level layout,
              // remaining sentences get AVATAR_PIP for faster pace after intro
              let sentenceLayout = layoutType;
              if (
                i === 0 &&
                sentenceIdx >= 2 &&
                layoutType === "AVATAR_FULLSCREEN"
              ) {
                sentenceLayout = "AVATAR_PIP" as const;
              }

              return {
                sentence_text: si.sentence_text,
                image_prompt: si.image_prompt,
                enriched_image_prompt: enrichedPrompt,
                layout_type: sentenceLayout,
                is_key_fact: si.is_key_fact,
                key_fact_text: si.key_fact_text,
              };
            },
          );

          return {
            scene_index: i,
            start_frame: null,
            end_frame: null,
            duration_frames: null,
            paragraph: scene.paragraph,
            visual_type: scene.visual_type,
            image_prompt: scene.image_prompt ?? null,
            enriched_image_prompt: enrichedImagePrompt,
            ticker_headline: scene.ticker_headline ?? null,
            visual_asset_key: null,
            shot_type: shotType,
            camera_angle: cameraAngle,
            visual_theme: visualTheme ?? null,
            sentence_images: enrichedSentenceImages,
          };
        }),
        global_visual_theme: globalVisualTheme,
      };

      // 3b. Simple layout override: force all scenes to AVATAR_PIP, remove ticker headlines
      // NEW: Check template.render_config.workflow first, fallback to production_version
      const workflow = (renderConfig as any)?.workflow;
      const requiresSimpleLayout =
        workflow === "clean-layout" || productionVersion === "V1";

      if (requiresSimpleLayout) {
        assemblyManifest.scenes = assemblyManifest.scenes.map((scene: any) => {
          // For scenes that had no image_prompt (were AVATAR_ON_CAMERA), generate one
          // from the full paragraph text — never truncate or use vague "related to" language
          const imagePrompt: string = scene.image_prompt ?? scene.paragraph;
          const shotType =
            scene.shot_type ??
            recommendShotType(
              scene.scene_index,
              assemblyManifest.scenes.length,
            );
          const cameraAngle = (scene.camera_angle ??
            recommendCameraAngle(
              scene.scene_index,
              assemblyManifest.scenes.length,
            )) as CameraAngle;
          const enrichedPrompt: string =
            scene.enriched_image_prompt ??
            buildEnrichedImagePrompt({
              rawDescription: imagePrompt,
              shotType,
              cameraAngle,
              visualTheme: scene.visual_theme ?? globalVisualTheme ?? undefined,
              stylePrefix,
              styleSuffix,
              environmentDescription: envDescription,
              preserveRightPercent: envSafeZoneRight, // V1 = all AVATAR_PIP
            });

          // V1 uses scene-level prompts, but asset-collection reads sentence_images.
          // Create a single sentence_image entry with the scene prompt so asset-collection
          // dispatches generation correctly.
          const v1SentenceImages = [
            {
              sentence_text: scene.paragraph,
              image_prompt: imagePrompt,
              enriched_image_prompt: enrichedPrompt,
              layout_type: "AVATAR_PIP" as const,
              is_key_fact: false,
              key_fact_text: null,
            },
          ];

          return {
            ...scene,
            visual_type: "AVATAR_PIP",
            image_prompt: imagePrompt,
            enriched_image_prompt: enrichedPrompt,
            ticker_headline: null, // V1 has no ticker
            sentence_images: v1SentenceImages, // Populate for asset-collection compatibility
          };
        });

        console.log(
          JSON.stringify({
            level: "info",
            message:
              "Simple layout override applied: all scenes set to AVATAR_PIP",
            job_id,
            scene_count: assemblyManifest.scenes.length,
            workflow: workflow || null,
            production_version: productionVersion,
            reason:
              workflow === "clean-layout"
                ? "Template workflow=clean-layout"
                : "Legacy production_version=V1",
          }),
        );
      }

      // 4. Write assembly_manifest to DB
      await db
        .update(contentJobs)
        .set({
          assembly_manifest: assemblyManifest,
          updated_at: new Date(),
        })
        .where(eq(contentJobs.id, job_id));

      console.log(
        JSON.stringify({
          level: "info",
          message: "Assembly manifest saved",
          job_id,
          broll_count: rawScenes.filter(
            (s: RawScene) => s.visual_type === "BROLL_IMAGE",
          ).length,
          avatar_pip_count: rawScenes.filter(
            (s: RawScene) => s.visual_type === "AVATAR_PIP",
          ).length,
          avatar_count: rawScenes.filter(
            (s: RawScene) => s.visual_type === "AVATAR_ON_CAMERA",
          ).length,
        }),
      );

      // 5. Re-trigger asset collection — will now dispatch image gen for BROLL scenes
      await queues.assetCollection.add("collect-assets", { job_id });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({
          level: "error",
          message: "Scene analysis failed",
          job_id,
          error: errorMessage,
          template_id,
        }),
      );
      await updateJobStatus(
        db,
        job_id,
        "FAILED_GENERAL",
        errorMessage,
        buildErrorDetail({
          code: "SCENE_ANALYSIS_FAILED",
          message: errorMessage,
          category: "external_service",
          retryable: true,
          context: { template_id, job_id },
        }),
      );
      throw error;
    }
  };
}

interface RawScene {
  scene_index: number;
  paragraph: string;
  visual_type: "AVATAR_ON_CAMERA" | "AVATAR_PIP" | "BROLL_IMAGE";
  image_prompt: string | null;
  ticker_headline: string | null;
  shot_type: ShotType | null;
  camera_angle: string | null;
  visual_theme: VisualTheme | null;
  sentence_images: Array<{
    sentence_text: string;
    image_prompt: string;
    is_key_fact: boolean;
    key_fact_text: string | null;
  }>;
}

/** Split a script into its constituent paragraphs (double-newline separated, with single-newline fallback). */
function splitIntoParagraphs(script: string): string[] {
  const paragraphs = script
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 30);
  if (paragraphs.length >= 4) return paragraphs;
  // Fallback: split by single newlines if no double-newline structure
  return script
    .split(/\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 30);
}

function buildPerSceneSystemPrompt(
  zone: "hook" | "early_body" | "late_body",
  useSubSentences: boolean,
  contentDomainPrompt?: string,
): string {
  const splitInstruction =
    zone === "hook" && useSubSentences
      ? `Split at CLAUSE level — commas, semicolons, and em-dashes are valid split points in addition to sentence-ending punctuation. Each clause (even short ones like 3-5 words) gets its own image prompt. Aim for maximum visual variety in the intro.`
      : zone === "late_body"
        ? `You may group 2–3 consecutive sentences into a single image entry if they describe the same continuous visual subject. Use judgment — do not group if the sentences describe clearly different visuals. Each group produces one image prompt.`
        : `Split at SENTENCE level — each complete sentence (ending in . ? !) gets its own image prompt. Do not group sentences.`;

  return `You are generating scene imagery for one paragraph of a professional video script.

Your task: split this paragraph into visual segments and generate one photorealistic image prompt per segment.

${splitInstruction}

Return ONLY a valid JSON object — no markdown fences, no explanation. Schema:
{
  "visual_type": "AVATAR_ON_CAMERA" | "BROLL_IMAGE" | "AVATAR_PIP",
  "ticker_headline": "Short news ticker text, max 120 chars",
  "shot_type": "establishing" | "wide" | "medium" | "medium_closeup" | "closeup" | "detail" | "over_shoulder",
  "camera_angle": "eye_level" | "slight_low_angle" | "high_angle" | "low_angle" | "dutch_angle" | "profile" | "over_shoulder" | "three_quarter",
  "visual_theme": {
    "setting": "Location/environment description",
    "time_of_day": "daytime | golden_hour | evening | night | overcast",
    "color_palette": "Brief palette description",
    "mood": "Brief mood description"
  },
  "sentence_images": [
    {
      "sentence_text": "Exact text of this sentence or clause from the paragraph",
      "image_prompt": "Detailed photorealistic image prompt with camera/lens/lighting specs",
      "is_key_fact": false,
      "key_fact_text": null
    }
  ]
}

Rules for visual_type:
- AVATAR_ON_CAMERA: narrator speaks directly to camera. Use for openings, sign-offs, strong editorial statements. Set sentence_images to [].
- BROLL_IMAGE: full-screen B-roll with voice-over. Use for factual exposition, establishing locations, data.
- AVATAR_PIP: narrator in small corner PIP, B-roll fills screen. Use when visual illustration helps comprehension.

Rules for sentence_images:
- For AVATAR_ON_CAMERA: sentence_images must be an empty array []
- For BROLL_IMAGE and AVATAR_PIP: one entry per sentence or clause per the split instructions above
- sentence_text must contain exact text from the paragraph
- image_prompt must include: shot type, specific subject, camera/lens spec, lighting, angle, composition, realism modifiers
- is_key_fact: true ONLY if the sentence contains a striking statistic, percentage, dollar amount, or specific named fact worth highlighting as text
- key_fact_text: if is_key_fact=true, a concise 5-12 word rendition for on-screen display; otherwise null

FORBIDDEN imagery: TV studios, news desks, social media screens, podcast setups, editing software, cameras pointed at cameras.

${contentDomainPrompt ? `Content domain rules:\n${contentDomainPrompt}\n` : ""}`;
}

/**
 * System prompt for illustration-mode scene analysis (e.g. CASUALLY_EXPLAINED).
 *
 * Instructs Claude to generate simple illustration descriptions rather than
 * photorealistic image prompts. All scenes are AVATAR_PIP — the host is
 * always visible in the bottom-right corner.
 */
function buildIllustrationSceneSystemPrompt(
  zone: "hook" | "early_body" | "late_body",
  useSubSentences: boolean,
  format?: string,
): string {
  const splitInstruction =
    zone === "hook" && useSubSentences
      ? `Split at CLAUSE level — commas, semicolons, and em-dashes are valid split points. Each clause (even short ones like 3-5 words) gets its own illustration prompt for maximum visual variety in the intro.`
      : zone === "late_body"
        ? `You may group 2–3 consecutive sentences into a single illustration entry if they describe the same continuous visual subject. Use judgment — do not group if they describe clearly different visuals.`
        : `Split at SENTENCE level — each complete sentence (ending in . ? !) gets its own illustration prompt.`;

  return `You are generating scene illustrations for one paragraph of a video script.

The video style is minimalist stick figure art in the style of "Casually Explained" YouTube channel — simple black line drawings on pure white backgrounds, hand-drawn MS Paint aesthetic, crude shapes, no gradients or shading. The narrator is always visible in the bottom-right corner.

Your task: split this paragraph into visual segments and describe one simple illustration per segment.

${splitInstruction}

Return ONLY a valid JSON object — no markdown fences, no explanation. Schema:
{
  "visual_type": "AVATAR_PIP",
  "ticker_headline": null,
  "shot_type": "medium",
  "camera_angle": "eye_level",
  "visual_theme": null,
  "sentence_images": [
    {
      "sentence_text": "Exact text of this sentence or clause from the paragraph",
      "image_prompt": "Illustration description: what to draw. Specify characters present and their actions, any objects or diagrams, and the background style. NEVER ask for text, numbers, or labels to appear in the image itself — AI image generation cannot render legible text and it always comes out garbled. Write as art direction for a graphic artist.",
      "is_key_fact": false,
      "key_fact_text": null
    }
  ]
}

CRITICAL RULES:
- visual_type MUST be exactly "AVATAR_PIP" - DO NOT use "AVATAR_ON_CAMERA" or "BROLL_IMAGE"
- sentence_images array MUST contain at least one entry - NEVER return an empty array []

Rules for sentence_images:
- One entry per sentence or clause per the split instructions above.
- sentence_text must contain exact text from the paragraph.
- image_prompt describes what to DRAW: stick figures, simple shapes, diagrams, arrows. Always assume pure white background.
- NEVER describe text, numbers, captions, or axis/data labels appearing IN the image — AI image models cannot render legible text and it comes out garbled every time. A graph is "a simple upward-trending line" or "a bar chart with three bars, tallest on the right" — never "a graph labeled 'Q3 Revenue' showing 45% growth". If a specific number or fact matters, either say it in sentence_text (the narrator states it) or give that clause its own is_key_fact sentence_image so it renders as a text card instead of being baked into a diagram.
- Keep descriptions simple and crude — this is hand-drawn MS Paint style, not polished digital art.
- Humor is appropriate if it fits the deadpan explanatory tone.
- is_key_fact: true ONLY for striking statistics or named facts worth highlighting as text.
- NO FACES on inanimate objects: cars, planes, rockets, buildings, boxes, and generic objects must NOT have eyes, mouths, or expressions. Only human/humanoid stick figures get faces.
- VARY the narrator character's pose every scene: use sitting, pointing, gesturing, facepalming, shrugging, arms-crossed, jumping, running, holding objects — never the same standing pose twice in a row.

COMPOSITE LAYOUT GUIDANCE (EXPLAINER format only):
When the format is EXPLAINER and image_style is "illustration", structure multi-element scenes as follows:

1. Parse the scene_description for layout instructions (e.g., "Layout: 3 horizontal panels")
2. Extract individual element descriptions (Element 1, Element 2, etc.)
3. For each sentence_image:
   - Set image_prompt to the composite layout description
   - Include all elements from scene_description in a single prompt
   - Add "@img6 layout reference" at the start if layout_reference is available
   - DO NOT split elements into separate sentence_images — one prompt = one composite image
   - Describe every element (including any "graph"/"chart"/"data" element) as pure shape and
     motion — never write a number, word, or label that the image model would need to render
     as text. This is the single biggest source of garbled-looking composite scenes.

Example:
Input scene_description: "Layout: 2x2 grid\\nElement 1: Stick figure...\\nElement 2: Graph..."
Output sentence_image.image_prompt: "@img6 2x2 grid layout: top-left shows stick figure examining chart, top-right shows upward trending graph, bottom-left shows money stack growing, bottom-right shows happy stick figure celebrating"

${
  format === "CASUALLY_EXPLAINED"
    ? `STYLE BLEND (CASUALLY_EXPLAINED format):
Images should blend two visual styles — drawn stick-figure illustration AND real-life photographic elements. The drawn character (narrator/stick figures) always appears on a photographic or illustrated background. This creates the signature hybrid look: hand-drawn figures against real or richly illustrated environments.

PHOTO: PREFIX RULE:
When the script mentions a specific, identifiable real-world object — a named vehicle model (e.g., "SR-71 Blackbird"), a specific branded product, a famous landmark or building — generate it photorealistically instead.

To trigger photorealistic generation, prefix image_prompt with "PHOTO:" and write a photorealistic description of that specific object.

Use PHOTO: ONLY for concrete, nameable real-world objects. Do NOT use it for:
- People, characters, stick figures, abstract concepts
- Generic objects (a car, a building, a pill) without a specific identity
- Situations or scenes

HYBRID SCENES (use when no PHOTO: applies):
Instead of a plain white background, place stick figures against a real-looking or richly detailed environment. Examples:
- Stick figure narrator in front of a photorealistic aircraft hangar
- Drawn character standing on a detailed illustrated runway with real planes taxiing in the background
- Hand-drawn diagram overlaid on a photographic cockpit interior

Describe the background explicitly in image_prompt. Format: "[drawn stick figure action], [background: photorealistic/detailed illustration of environment]"

Examples:
- "SR-71 Blackbird" → PHOTO: SR-71 Blackbird in flight above clouds, photorealistic
- "the fastest plane" (generic concept) → Stick figure pilot gesturing proudly at a jet silhouette, background: photorealistic blue sky with contrails
- "aerodynamics explanation" → Stick figure in lab coat drawing airflow arrows, background: detailed illustration of wind tunnel cross-section

FORBIDDEN for non-PHOTO prompts: camera angles, lens specs, aperture, f-stop, bokeh, film grain, ISO, photojournalistic, broadcast, depth of field, photorealistic.`
    : `FORBIDDEN in image_prompt: camera angles, lens specs, aperture, f-stop, bokeh, film grain, ISO, photojournalistic, broadcast, depth of field, photorealistic.`
}`;
}

interface ParagraphAnalysisResult {
  visual_type: "AVATAR_ON_CAMERA" | "BROLL_IMAGE" | "AVATAR_PIP";
  ticker_headline: string | null;
  shot_type: string | null;
  camera_angle: string | null;
  visual_theme: {
    setting: string;
    timeOfDay: string;
    colorPalette: string;
    mood: string;
  } | null;
  sentence_images: Array<{
    sentence_text: string;
    image_prompt: string;
    is_key_fact: boolean;
    key_fact_text: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// Comparison format — single-call scene analysis
// ---------------------------------------------------------------------------

interface ComparisonSceneRaw {
  scene_index?: number;
  paragraph?: string;
  visual_type?: string;
  comparison_block_type?: string;
  comparison_product_slot?: string | null;
  comparison_dimension?: string | null;
  image_prompt?: string | null;
  ticker_headline?: string | null;
  shot_type?: string;
  camera_angle?: string;
}

/**
 * Validate structural rules for a comparison scene list.
 * Returns an error string describing the first violation, or null if valid.
 *
 * Hard rules (same as what is encoded in the template's scene_analysis prompt):
 * - HOOK: exactly 1, scene_index 0
 * - VERDICT: exactly 1, second-to-last
 * - CTA: exactly 1, last
 * - FEATURE_SPOTLIGHT: ≥ 30% of total scenes
 * - No more than 2 consecutive scenes of the same block type
 *   (FEATURE_SPOTLIGHT may run 3 in a row when dimension count requires it)
 * - Product slots must reference valid products (A or B)
 * - Dimensions must exist in data_grid.dimensions
 * - Paragraphs must not be empty
 */
function validateComparisonScenes(
  scenes: ComparisonSceneRaw[],
  products: Array<{ slot: string; name: string }>,
  dimensions: string[],
): string | null {
  if (scenes.length === 0) return "No scenes returned";
  if (scenes.length < 6) return `Too few scenes: ${scenes.length} (minimum 6)`;

  if (scenes[0]?.comparison_block_type !== "HOOK") {
    return `First scene must be HOOK (got: ${scenes[0]?.comparison_block_type})`;
  }

  if (scenes[scenes.length - 1]?.comparison_block_type !== "CTA") {
    return `Last scene must be CTA (got: ${scenes[scenes.length - 1]?.comparison_block_type})`;
  }

  if (scenes[scenes.length - 2]?.comparison_block_type !== "VERDICT") {
    return `Second-to-last scene must be VERDICT (got: ${scenes[scenes.length - 2]?.comparison_block_type})`;
  }

  const spotlightCount = scenes.filter(
    (s) => s.comparison_block_type === "FEATURE_SPOTLIGHT",
  ).length;
  const minSpotlight = Math.ceil(scenes.length * 0.3);
  if (spotlightCount < minSpotlight) {
    return `Insufficient FEATURE_SPOTLIGHT scenes: ${spotlightCount} (need ≥ ${minSpotlight} for ${scenes.length} total scenes)`;
  }

  // Consecutive same-type check (FEATURE_SPOTLIGHT exempt from the 3-in-a-row rule)
  for (let i = 2; i < scenes.length; i++) {
    const bt = scenes[i]?.comparison_block_type;
    if (
      bt !== "FEATURE_SPOTLIGHT" &&
      bt === scenes[i - 1]?.comparison_block_type &&
      bt === scenes[i - 2]?.comparison_block_type
    ) {
      return `Three consecutive ${bt} scenes starting at index ${i - 2}`;
    }
  }

  // Additional comparison-specific validation
  const validSlots = products.map((p) => p.slot);

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!;

    // Validate product slot references actual product
    if (scene.comparison_product_slot != null) {
      const slot = scene.comparison_product_slot;
      if (!validSlots.includes(slot)) {
        return `Scene ${i}: Invalid product_slot "${slot}" (valid: ${validSlots.join(", ")})`;
      }
    }

    // Validate dimension exists in data_grid (only when dimensions are pre-defined;
    // jobs created without a research phase have no data_grid and dimensions=[])
    if (scene.comparison_dimension != null && dimensions.length > 0) {
      const dim = scene.comparison_dimension;
      if (!dimensions.includes(dim)) {
        return `Scene ${i}: Invalid dimension "${dim}" (valid: ${dimensions.join(", ")})`;
      }
    }

    // Validate paragraph not empty
    if (!scene.paragraph?.trim()) {
      return `Scene ${i}: Empty paragraph`;
    }
  }

  return null;
}

/**
 * Comparison-format scene analysis.
 *
 * Sends the entire script + procedural rule prompt to Claude in a single call.
 * Claude returns a complete scene breakdown JSON array with comparison_block_type
 * assigned per scene. Structural rules are validated; on failure the call is
 * retried once before proceeding with a warning (VA audit acts as safety net).
 */
async function analyzeComparisonScript(
  db: DrizzleClient,
  job_id: string,
  template: Record<string, unknown>,
  script: string,
  queues: { assetCollection: Queue },
): Promise<void> {
  // Fetch job record to read comparison metadata (products, data_grid)
  const [jobRecord] = await db
    .select()
    .from(contentJobs)
    .where(eq(contentJobs.id, job_id))
    .limit(1);

  if (!jobRecord) {
    throw new Error(`Job ${job_id} not found for comparison scene analysis`);
  }

  const meta = (jobRecord as any).metadata ?? {};
  const comparisonMeta = meta.comparison ?? {};
  // Both supported shapes (flat product_a_name/product_b_name ↔
  // products[{slot,name}]) resolved by the ONE shared normalizer in
  // @repo/domain — this used to be a hand-rolled copy of the same fallback.
  const normalizedComparison = normalizeComparison(comparisonMeta);
  const products: Array<{ slot: string; name: string }> =
    normalizedComparison.products;
  const dataGrid = (normalizedComparison.dataGrid ?? null) as {
    dimensions?: string[];
    scores?: Record<string, Record<string, number>>;
  } | null;

  const productA = products.find((p) => p.slot === "A");
  const productB = products.find((p) => p.slot === "B");

  if (!productA || !productB) {
    throw new Error(
      `Comparison job ${job_id} missing product A or B in metadata.comparison.products`,
    );
  }

  const dimensions: string[] = dataGrid?.dimensions ?? [];

  // Derive render_seed deterministically from job_id (same algorithm as the main path)
  const renderSeed = Math.abs(
    job_id
      .split("")
      .reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0),
  );

  const prompts = template.prompts as Record<string, string>;
  const rawPrompt = prompts["scene_analysis"];
  if (!rawPrompt) {
    throw new Error(
      `No scene_analysis prompt in template ${template.id} for comparison job`,
    );
  }

  // Substitute all comparison-specific template variables
  const filledPrompt = rawPrompt
    .replaceAll("${script}", script)
    .replaceAll("${product_a_name}", productA.name)
    .replaceAll("${product_b_name}", productB.name)
    .replaceAll("${dimensions}", dimensions.join(", "))
    .replaceAll("${render_seed}", String(renderSeed));

  console.log(
    JSON.stringify({
      level: "info",
      message: "Calling Claude for comparison scene analysis",
      job_id,
      product_a: productA.name,
      product_b: productB.name,
      dimensions_count: dimensions.length,
      render_seed: renderSeed,
    }),
  );

  const runAnalysis = async (): Promise<ComparisonSceneRaw[]> => {
    let rawText = await callLLM(filledPrompt);

    // First try to extract JSON from code fence
    const codeFenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeFenceMatch) {
      rawText = codeFenceMatch[1].trim();
    } else {
      // No code fence - try to find JSON array/object
      const jsonMatch = rawText.match(/(\[[\s\S]*\])/);
      if (jsonMatch) {
        rawText = jsonMatch[1].trim();
      } else {
        // Last resort - remove everything before first [ and after last ]
        const firstBracket = rawText.indexOf("[");
        const lastBracket = rawText.lastIndexOf("]");
        if (firstBracket !== -1 && lastBracket !== -1) {
          rawText = rawText.slice(firstBracket, lastBracket + 1).trim();
        }
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error(
        `Comparison scene analysis JSON parse failed. Raw snippet: ${rawText.slice(0, 300)}`,
      );
    }

    if (!Array.isArray(parsed)) {
      throw new Error(
        `Comparison scene analysis must return a JSON array (got: ${typeof parsed})`,
      );
    }

    return parsed as ComparisonSceneRaw[];
  };

  let scenes = await runAnalysis();
  let validationError = validateComparisonScenes(scenes, products, dimensions);

  if (validationError) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "Comparison scene analysis validation failed — retrying once",
        job_id,
        validation_error: validationError,
        scene_count: scenes.length,
      }),
    );

    scenes = await runAnalysis();
    validationError = validateComparisonScenes(scenes, products, dimensions);

    if (validationError) {
      // Validation failed after retry — fail the job
      console.error(
        JSON.stringify({
          level: "error",
          message:
            "Comparison scene analysis retry also failed validation — failing job",
          job_id,
          validation_error: validationError,
          scene_count: scenes.length,
        }),
      );

      await updateJobStatus(
        db,
        job_id,
        "FAILED_GENERAL",
        `Scene validation failed: ${validationError}`,
      );

      throw new Error(`Scene validation failed: ${validationError}`);
    }
  }

  // Count block types for observability
  const blockTypeCounts = scenes.reduce<Record<string, number>>((acc, s) => {
    const bt = s.comparison_block_type ?? "UNKNOWN";
    acc[bt] = (acc[bt] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    JSON.stringify({
      level: "info",
      message: "Comparison scene analysis complete",
      job_id,
      scene_count: scenes.length,
      block_types: blockTypeCounts,
      render_seed: renderSeed,
    }),
  );

  // Build assembly manifest — comparison scenes always use BROLL_IMAGE visual_type
  // because the Remotion composition renders the comparison block (chart, spec table, etc.)
  // as the visual layer; there is no per-scene avatar video unless HeyGen segments are present.
  const assemblyManifest = {
    render_seed: renderSeed,
    scenes: scenes.map((scene, i) => ({
      scene_index: i,
      start_frame: null,
      end_frame: null,
      duration_frames: null,
      paragraph: scene.paragraph ?? "",
      visual_type: "BROLL_IMAGE" as const,
      comparison_block_type: scene.comparison_block_type ?? null,
      comparison_product_slot: scene.comparison_product_slot ?? null,
      comparison_dimension: scene.comparison_dimension ?? null,
      image_prompt: scene.image_prompt ?? null,
      enriched_image_prompt: null, // no enrichment needed — Remotion renders its own visuals
      ticker_headline: null,
      visual_asset_key: null,
      shot_type: scene.shot_type ?? "medium",
      camera_angle: scene.camera_angle ?? "eye_level",
      visual_theme: null,
      sentence_images: [],
    })),
    global_visual_theme: null,
  };

  await db
    .update(contentJobs)
    .set({
      assembly_manifest: assemblyManifest,
      updated_at: new Date(),
    })
    .where(eq(contentJobs.id, job_id));

  console.log(
    JSON.stringify({
      level: "info",
      message: "Comparison assembly manifest saved",
      job_id,
      scene_count: assemblyManifest.scenes.length,
    }),
  );

  // Re-trigger asset collection — comparison path gates on product images + TTS
  await queues.assetCollection.add("collect-assets", { job_id });
}

// ---------------------------------------------------------------------------

async function analyzeOneParagraph(
  paragraph: string,
  sceneIndex: number,
  totalScenes: number,
  pacingConfig: PacingConfig,
  contentDomainPrompt?: string,
  needsImage: boolean = true,
  imageStyle: "illustration" | "photorealistic" = "photorealistic",
  format?: string,
): Promise<ParagraphAnalysisResult> {
  const zone = getPacingZone(sceneIndex, totalScenes, pacingConfig);

  // If this scene's layout doesn't show B-roll images (e.g. AVATAR_FULLSCREEN),
  // skip the expensive image prompt generation and return a lightweight result.
  if (!needsImage) {
    const systemPrompt = `You are generating metadata for one paragraph of a video script that will show ONLY the narrator (no B-roll imagery).

Return ONLY a valid JSON object:
{
  "visual_type": "AVATAR_ON_CAMERA",
  "ticker_headline": "Short news ticker text, max 120 chars",
  "shot_type": "medium",
  "camera_angle": "eye_level",
  "visual_theme": null,
  "sentence_images": []
}`;
    const rawText0 = await callLLM(
      `${systemPrompt}\n\nParagraph:\n\n${paragraph}`,
    );
    // Robust JSON extraction - same approach as main analysis path
    let rawText = rawText0;

    // First try to extract JSON from code fence
    const codeFenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeFenceMatch) {
      rawText = codeFenceMatch[1].trim();
    } else {
      // No code fence - try to find JSON object
      const jsonMatch = rawText.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        rawText = jsonMatch[1].trim();
      } else {
        // Last resort - remove everything before first { and after last }
        const firstBrace = rawText.indexOf("{");
        const lastBrace = rawText.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1) {
          rawText = rawText.slice(firstBrace, lastBrace + 1).trim();
        }
      }
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Avatar on-camera shot analysis JSON parse failed",
          scene_index: sceneIndex,
          error: err instanceof Error ? err.message : String(err),
          raw_snippet: rawText.slice(0, 200),
        }),
      );
      throw new Error(
        `Scene ${sceneIndex} (avatar shot): Claude returned invalid JSON - ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {
      visual_type: "AVATAR_ON_CAMERA",
      ticker_headline:
        typeof parsed["ticker_headline"] === "string"
          ? parsed["ticker_headline"].slice(0, 120)
          : null,
      shot_type: "medium",
      camera_angle: "eye_level",
      visual_theme: null,
      sentence_images: [],
    };
  }

  const systemPrompt =
    imageStyle === "illustration"
      ? buildIllustrationSceneSystemPrompt(
          zone,
          pacingConfig.hook_use_subsentences,
          format,
        )
      : buildPerSceneSystemPrompt(
          zone,
          pacingConfig.hook_use_subsentences,
          contentDomainPrompt,
        );

  const rawText0 = await callLLM(
    `${systemPrompt}\n\nParagraph:\n\n${paragraph}`,
  );

  // Robust JSON extraction - same approach as comparison format
  let rawText = rawText0;

  // DEBUG: Log raw Claude response
  console.log(
    JSON.stringify({
      level: "debug",
      message: "[DEBUG] Raw Claude response before JSON extraction",
      scene_index: sceneIndex,
      raw_response: rawText0.substring(0, 1500),
      full_length: rawText0.length,
    }),
  );

  // First try to extract JSON from code fence
  const codeFenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeFenceMatch) {
    rawText = codeFenceMatch[1].trim();
  } else {
    // No code fence - try to find JSON object
    const jsonMatch = rawText.match(/(\{[\s\S]*\})/);
    if (jsonMatch) {
      rawText = jsonMatch[1].trim();
    } else {
      // Last resort - remove everything before first { and after last }
      const firstBrace = rawText.indexOf("{");
      const lastBrace = rawText.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1) {
        rawText = rawText.slice(firstBrace, lastBrace + 1).trim();
      }
    }
  }

  // DEBUG: Log extracted JSON
  console.log(
    JSON.stringify({
      level: "debug",
      message: "[DEBUG] Extracted JSON before parsing",
      scene_index: sceneIndex,
      extracted_json: rawText.substring(0, 1500),
    }),
  );

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawText) as Record<string, unknown>;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Scene analysis JSON parse failed",
        scene_index: sceneIndex,
        system_prompt_snippet: systemPrompt.slice(0, 200),
        response_snippet: rawText.slice(0, 500),
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    throw new Error(
      `Scene ${sceneIndex}: Claude returned invalid JSON - ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Validate structure: must have sentence_images array with valid entries
  const rawSentenceImagesForValidation = parsed.sentence_images as any[];

  // DEBUG: Log imageStyle and sentence_images state
  console.log(
    JSON.stringify({
      level: "debug",
      message: "[DEBUG] Before workaround check",
      scene_index: sceneIndex,
      imageStyle,
      has_sentence_images: Array.isArray(rawSentenceImagesForValidation),
      sentence_images_length: Array.isArray(rawSentenceImagesForValidation)
        ? rawSentenceImagesForValidation.length
        : -1,
    }),
  );

  // WORKAROUND: If Claude returned AVATAR_ON_CAMERA (which requires empty sentence_images),
  // convert it to AVATAR_PIP and create a synthetic sentence_image entry.
  // This handles Claude Sonnet 4.6's tendency to ignore the "ALWAYS AVATAR_PIP" instruction.
  // Apply for all imageStyles since the archetype configuration may not match the expected format.
  if (
    !Array.isArray(rawSentenceImagesForValidation) ||
    rawSentenceImagesForValidation.length === 0
  ) {
    console.log(
      JSON.stringify({
        level: "warn",
        message:
          "Claude returned empty sentence_images for illustration format, applying workaround",
        scene_index: sceneIndex,
        original_visual_type: parsed.visual_type,
      }),
    );

    // Force AVATAR_PIP and create a synthetic sentence_image
    // Generate a generic prompt based on the paragraph content
    const genericPrompt = `Simple flat illustration in Casually Explained style: minimalist stick figure character explaining the concept. Clean off-white background with minimal abstract visual elements related to the topic. Deadpan explanatory aesthetic. Topic: ${paragraph.substring(0, 100).replace(/"/g, "'")}...`;

    parsed.visual_type = "AVATAR_PIP";
    parsed.sentence_images = [
      {
        sentence_text: paragraph,
        image_prompt: genericPrompt,
        is_key_fact: false,
        key_fact_text: null,
      },
    ];
  }

  // Now validate after applying workaround
  const sentenceImagesAfterWorkaround = parsed.sentence_images as any[];
  if (
    !Array.isArray(sentenceImagesAfterWorkaround) ||
    sentenceImagesAfterWorkaround.length === 0
  ) {
    console.error(
      JSON.stringify({
        level: "error",
        message:
          "Scene analysis returned empty or missing sentence_images array",
        scene_index: sceneIndex,
        parsed_keys: Object.keys(parsed),
      }),
    );
    throw new Error(
      `Scene ${sceneIndex}: No sentence_images in Claude response`,
    );
  }

  // Validate each sentence_image has required fields
  for (let i = 0; i < rawSentenceImagesForValidation.length; i++) {
    const si = rawSentenceImagesForValidation[i];
    if (
      !si.sentence_text ||
      typeof si.sentence_text !== "string" ||
      si.sentence_text.length === 0
    ) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Scene analysis sentence_image has invalid sentence_text",
          scene_index: sceneIndex,
          image_index: i,
          sentence_text: si.sentence_text,
        }),
      );
      throw new Error(`Scene ${sceneIndex}, image ${i}: sentence_text missing`);
    }
    if (
      !si.image_prompt ||
      typeof si.image_prompt !== "string" ||
      si.image_prompt.length < 10
    ) {
      // Fall back to sentence_text rather than failing the whole job
      console.warn(
        JSON.stringify({
          level: "warn",
          message:
            "Scene analysis sentence_image missing image_prompt — using sentence_text as fallback",
          scene_index: sceneIndex,
          image_index: i,
          image_prompt: si.image_prompt,
          fallback: si.sentence_text.slice(0, 60),
        }),
      );
      si.image_prompt = si.sentence_text;
    }
  }

  // Illustration mode: always AVATAR_PIP regardless of what Claude returned
  // (defense-in-depth alongside the system prompt instruction)
  const visualType: ParagraphAnalysisResult["visual_type"] =
    imageStyle === "illustration"
      ? "AVATAR_PIP"
      : (["AVATAR_ON_CAMERA", "BROLL_IMAGE", "AVATAR_PIP"] as const).includes(
            parsed["visual_type"] as
              | "AVATAR_ON_CAMERA"
              | "BROLL_IMAGE"
              | "AVATAR_PIP",
          )
        ? (parsed["visual_type"] as ParagraphAnalysisResult["visual_type"])
        : "BROLL_IMAGE";

  const rawImages = Array.isArray(parsed["sentence_images"])
    ? parsed["sentence_images"]
    : [];
  const sentenceImages = rawImages
    .map((img: unknown) => {
      const item = img as Record<string, unknown>;
      return {
        sentence_text:
          typeof item["sentence_text"] === "string"
            ? item["sentence_text"]
            : "",
        image_prompt:
          typeof item["image_prompt"] === "string" ? item["image_prompt"] : "",
        is_key_fact: item["is_key_fact"] === true,
        key_fact_text:
          typeof item["key_fact_text"] === "string"
            ? item["key_fact_text"]
            : null,
      };
    })
    .filter((img) => img.sentence_text.length > 0);

  const rawTheme = parsed["visual_theme"] as
    | Record<string, unknown>
    | null
    | undefined;

  return {
    visual_type: visualType,
    ticker_headline:
      typeof parsed["ticker_headline"] === "string"
        ? parsed["ticker_headline"].slice(0, 120)
        : null,
    shot_type:
      typeof parsed["shot_type"] === "string" ? parsed["shot_type"] : null,
    camera_angle:
      typeof parsed["camera_angle"] === "string"
        ? parsed["camera_angle"]
        : null,
    visual_theme: rawTheme
      ? {
          setting: String(rawTheme["setting"] ?? ""),
          timeOfDay: String(
            rawTheme["time_of_day"] ?? rawTheme["timeOfDay"] ?? "daytime",
          ),
          colorPalette: String(
            rawTheme["color_palette"] ?? rawTheme["colorPalette"] ?? "",
          ),
          mood: String(rawTheme["mood"] ?? ""),
        }
      : null,
    sentence_images: sentenceImages,
  };
}
