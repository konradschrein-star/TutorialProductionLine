import { z } from "zod";

// Bill Oxley – ElevenLabs eleven_multilingual_v2, speed 0.96, guidance_scale 1.7
export const DRAMA_BILL_OXLEY_VOICE_ID = "iiidtqDt9FBdT1vfBluA";
/** @deprecated use DRAMA_BILL_OXLEY_VOICE_ID */
export const DRAMA_BIKER_VOICE_ID = "R23cI2hqxAhT17IXmY7O";

export const LongFormDramaConfigSchema = z.object({
  script: z.string().min(100).max(500000).describe("Full story script text"),
  channelId: z.string().uuid().describe("Target YouTube channel ID"),
  characterIds: z
    .array(z.string().uuid())
    .min(1)
    .max(10)
    .describe("Character IDs from drama_characters table"),
  voiceId: z
    .string()
    .default(DRAMA_BILL_OXLEY_VOICE_ID)
    .describe("ElevenLabs voice ID"),
  ttsSpeed: z.number().min(0.5).max(2.0).default(0.96).describe("TTS speed"),
  musicEnabled: z.boolean().default(false).describe("Enable background music"),
  musicVolumeDb: z
    .number()
    .min(-60)
    .max(0)
    .default(-30)
    .describe("Music volume in dB"),
  musicGenreHint: z
    .string()
    .max(200)
    .default(
      "Emotional dramatic background music, slow piano, strings, cinematic, no lyrics, subtle",
    )
    .describe("Suno music prompt"),
  referenceImagesEnabled: z
    .boolean()
    .default(false)
    .describe("Phase 2: use character reference images"),
  renderMode: z
    .enum([
      "KEN_BURNS",
      "SLOW_VIDEO",
      "DIRECT_T2V",
      "STOCK_CHAIN_FULL",
      "STOCK_CHAIN_HOOKED",
    ])
    .default("KEN_BURNS")
    .describe(
      "KEN_BURNS = animated stills; SLOW_VIDEO = Veo i2v per clip; DIRECT_T2V = skip image-gen, send the prompt straight to Veo text-to-video.",
    ),
});
export type LongFormDramaConfig = z.infer<typeof LongFormDramaConfigSchema>;

export const DramaTTSPayloadSchema = z.object({
  jobId: z.string().uuid(),
  config: LongFormDramaConfigSchema,
});
export type DramaTTSPayload = z.infer<typeof DramaTTSPayloadSchema>;

export const DramaTranscribePayloadSchema = z.object({
  jobId: z.string().uuid(),
  audioPath: z.string(),
  script: z.string(),
});
export type DramaTranscribePayload = z.infer<
  typeof DramaTranscribePayloadSchema
>;

export const DramaPromptGenPayloadSchema = z.object({
  jobId: z.string().uuid(),
});
export type DramaPromptGenPayload = z.infer<typeof DramaPromptGenPayloadSchema>;

export const DramaImageGenPayloadSchema = z.object({
  jobId: z.string().uuid(),
});
export type DramaImageGenPayload = z.infer<typeof DramaImageGenPayloadSchema>;

export const DramaVideoGenPayloadSchema = z.object({
  jobId: z.string().uuid(),
  audioPath: z.string(),
  renderMode: z
    .enum([
      "KEN_BURNS",
      "SLOW_VIDEO",
      "DIRECT_T2V",
      "STOCK_CHAIN_FULL",
      "STOCK_CHAIN_HOOKED",
    ])
    .default("KEN_BURNS"),
});
export type DramaVideoGenPayload = z.infer<typeof DramaVideoGenPayloadSchema>;

export const DramaAssemblePayloadSchema = z.object({
  jobId: z.string().uuid(),
  audioPath: z.string(),
  renderMode: z
    .enum([
      "KEN_BURNS",
      "SLOW_VIDEO",
      "DIRECT_T2V",
      "STOCK_CHAIN_FULL",
      "STOCK_CHAIN_HOOKED",
    ])
    .default("KEN_BURNS"),
});
export type DramaAssemblePayload = z.infer<typeof DramaAssemblePayloadSchema>;

export const DramaQCPayloadSchema = z.object({
  jobId: z.string().uuid(),
  outputPath: z.string(),
  audioPath: z.string(),
});
export type DramaQCPayload = z.infer<typeof DramaQCPayloadSchema>;

export const DramaThumbnailPayloadSchema = z.object({
  jobId: z.string().uuid(),
});
export type DramaThumbnailPayload = z.infer<typeof DramaThumbnailPayloadSchema>;
