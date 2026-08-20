import { z } from "zod";
export const SecretCapability = z.enum(["LLM", "TTS"]);
export type SecretCapability = z.infer<typeof SecretCapability>;
