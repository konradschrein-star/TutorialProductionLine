import { z } from "zod";
export const TutorialMode = z.enum(["THREE_MIN", "SIX_MIN", "SIX_MIN_STITCH"]);
export type TutorialMode = z.infer<typeof TutorialMode>;
