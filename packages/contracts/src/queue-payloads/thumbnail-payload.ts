import { z } from "zod";

/** Aspect ratios the media gateway accepts for images. */
export const ThumbnailAspectSchema = z.enum(["16:9", "9:16", "1:1"]);
export type ThumbnailAspect = z.infer<typeof ThumbnailAspectSchema>;

/** Output resolution tier. 1K is the operator's shipping default. */
export const ThumbnailResolutionSchema = z.enum(["1k", "2k", "4k"]);
export type ThumbnailResolution = z.infer<typeof ThumbnailResolutionSchema>;

export const ThumbnailPayloadSchema = z
  .object({
    subjectKind: z.enum(["content_job", "tutorial_job", "studio", "test"]),
    subjectId: z.string().uuid(),
    /** Explicit operator generation must not reselect or replace approved assets. */
    manualSelection: z.boolean().optional(),
    format: z.string().min(1),
    /** Optional: Studio renders need not belong to a channel. */
    channelId: z.string().uuid().nullable().optional(),
    title: z.string().min(1),
    topic: z.string().optional(),
    /** The literal text to burn onto the thumbnail, if not the title. */
    headlineText: z.string().optional(),
    /** Durable, localized Tutorial Studio copy. These fields are a pair. */
    thumbnailTextTop: z.string().trim().min(1).max(48).optional(),
    thumbnailTextBottom: z.string().trim().min(1).max(48).optional(),
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
    language: z.string().trim().min(1).optional(),
    targetLanguage: z.string().optional(),
    localizeFromThumbnailId: z.string().uuid().optional(),
  })
  .superRefine((payload, context) => {
    if (payload.subjectKind === "tutorial_job" && !payload.language) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["language"],
        message: "tutorial thumbnails require an explicit language",
      });
    }
    if (payload.subjectKind === "tutorial_job" && !payload.channelId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["channelId"],
        message: "tutorial thumbnails require an explicit channel",
      });
    }
    if (
      payload.subjectKind === "tutorial_job" &&
      (!payload.thumbnailTextTop || !payload.thumbnailTextBottom)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["thumbnailTextTop"],
        message: "tutorial thumbnails require localized top and bottom copy",
      });
    }
    if (
      (payload.thumbnailTextTop === undefined) !==
      (payload.thumbnailTextBottom === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [
          payload.thumbnailTextTop === undefined
            ? "thumbnailTextTop"
            : "thumbnailTextBottom",
        ],
        message: "localized thumbnail copy requires both top and bottom lines",
      });
    }
  })
  .transform((payload) => ({
    ...payload,
    language: payload.language ?? "en",
  }));

export type ThumbnailPayload = z.infer<typeof ThumbnailPayloadSchema>;
