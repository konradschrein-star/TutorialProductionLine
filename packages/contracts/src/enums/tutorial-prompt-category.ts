import { z } from "zod";
export const TutorialPromptCategory = z.enum([
  "THREE_MIN",
  "SIX_MIN",
  "SIX_MIN_STITCH",
  "LONG_FORM",
  "SHORT_MATCH",
  "SHORT_PLUS",
]);
export type TutorialPromptCategory = z.infer<typeof TutorialPromptCategory>;
