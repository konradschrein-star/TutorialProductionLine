import { z } from "zod";

export const VoiceSettingsSchema = z
  .object({
    model: z.string().optional(),
    speed: z.number().min(0.5).max(2.5).optional(),
    stability: z.number().min(0).max(1).optional(),
    similarity: z.number().min(0).max(1).optional(),
    pitch: z.number().min(-12).max(12).optional(),
    volume: z.number().min(0).max(2).optional(),
    language: z.string().optional(),
  })
  .strict();

export type VoiceSettings = z.infer<typeof VoiceSettingsSchema>;
