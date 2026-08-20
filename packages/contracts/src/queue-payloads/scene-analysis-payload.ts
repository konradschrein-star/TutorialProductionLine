import { z } from "zod";

/**
 * Scene Analysis Queue Payload
 *
 * Dispatched to queue-scene-analysis after script generation completes.
 * The processor calls Claude with the scene_analysis prompt from the template
 * to decompose the script into structured scenes.
 *
 * Output: assembly_manifest populated in content_jobs with N scenes,
 * each having paragraph, visual_type, image_prompt, ticker_headline.
 * Timing fields are null — computed later by the render worker.
 */
export const SceneAnalysisPayloadSchema = z.object({
  job_id: z.string().uuid().describe("Content job ID"),
  template_id: z.string().uuid().describe("Template ID — used to fetch scene_analysis prompt"),
  script: z.string().min(1).max(500_000).describe("Generated script text to decompose into scenes"),
});

export type SceneAnalysisPayload = z.infer<typeof SceneAnalysisPayloadSchema>;
