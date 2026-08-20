import { z } from "zod";

export const TutorialJobStatus = z.enum([
  "QUEUED",
  "GENERATING_SCRIPT",
  "GENERATING_AUDIO",
  "READY_TO_RECORD",
  "AWAITING_UPLOAD",
  "SPLICING",
  "COMPLETED",
  "FAILED_SCRIPT",
  "FAILED_AUDIO",
  "FAILED_SPLICE",
  "CANCELLED",
]);

export type TutorialJobStatus = z.infer<typeof TutorialJobStatus>;
