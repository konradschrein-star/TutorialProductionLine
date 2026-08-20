import { z } from "zod";

/** Aspect ratios the media gateway accepts for images. */
export const ThumbnailAspectSchema = z.enum(["16:9", "9:16", "1:1"]);
export type ThumbnailAspect = z.infer<typeof ThumbnailAspectSchema>;

/** Output resolution tier. 1K is the operator's shipping default. */
export const ThumbnailResolutionSchema = z.enum(["1k", "2k", "4k"]);
export type ThumbnailResolution = z.infer<typeof ThumbnailResolutionSchema>;

export const ThumbnailPayloadSchema = z.object({
  subjectKind: z.enum(["content_job", "tutorial_job", "studio", "test"]),
  subjectId: z.string().uuid(),
  format: z.string().min(1),
  /** Optional: Studio renders need not belong to a channel. */
  channelId: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  topic: z.string().optional(),
  /** The literal text to burn onto the thumbnail, if not the title. */
  headlineText: z.string().optional(),
  scriptExcerpt: z.string().optional(),
  archetypeId: z.string().uuid().optional(),
  promptMode: z
    .enum(["programmatic", "deepseek", "authored", "manual"])
    .optional(),
  editedPrompt: z.string().optional(),
  referenceOverride: z.string().optional(),
  /** Extra i2i references (absolute local paths, data: or http(s) URIs). */
  extraReferences: z.array(z.string()).optional(),
  instructions: z.string().optional(),
  logoSubject: z.string().optional(),
  aspectRatio: ThumbnailAspectSchema.optional(),
  resolution: ThumbnailResolutionSchema.optional(),
  /** Pin a media-gateway backend. Recorded as `requested_backend` so a
   *  downgrade to a different provider stays visible, never silent. */
  backend: z
    .enum(["veo_fleet", "veoforge", "vup", "forge", "fastgen", "ai33"])
    .optional(),
  /** Iteration lineage — the thumbnail this one was derived from. */
  parentThumbnailId: z.string().uuid().optional(),
  /**
   * How this row is produced (DECISIONS §3.2.5). Iterate references the
   * parent's OUTPUT; Regenerate references the parent's ORIGINAL archetype.
   * Omitted => inferred from the other fields for back-compat.
   */
  generationKind: z
    .enum(["original", "variant", "iterate", "regenerate", "localize"])
    .optional(),
  /** Groups the variants of one submission (§3.2.6). */
  requestGroupId: z.string().uuid().optional(),
  variantIndex: z.number().int().min(0).optional(),
  /** Fallback policy for this request (§2.6): allow | warn | fail. */
  onFallback: z.enum(["allow", "warn", "fail"]).optional(),
  language: z.string().default("en"),
  targetLanguage: z.string().optional(),
  localizeFromThumbnailId: z.string().uuid().optional(),
});

export type ThumbnailPayload = z.infer<typeof ThumbnailPayloadSchema>;
