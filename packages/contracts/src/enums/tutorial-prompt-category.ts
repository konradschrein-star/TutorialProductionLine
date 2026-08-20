import { z } from "zod";
export const TutorialPromptCategory = z.enum([
  "THREE_MIN",
  "SIX_MIN",
  "SIX_MIN_STITCH",
]);
export type TutorialPromptCategory = z.infer<typeof TutorialPromptCategory>;
