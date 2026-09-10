/** Deployment-level stop for tutorial AI only; manual/procedural renderers are independent. */
export function tutorialAiThumbnailsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TUTORIAL_AI_THUMBNAILS_ENABLED !== "false";
}
