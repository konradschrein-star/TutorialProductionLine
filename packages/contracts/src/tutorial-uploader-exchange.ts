import { z } from "zod";

export const TUTORIAL_UPLOADER_JOB_VERSION =
  "tutorial-uploader-job/1" as const;
export const TUTORIAL_UPLOADER_RECEIPT_VERSION =
  "tutorial-uploader-receipt/1" as const;

const SAFE_KEY = /^[a-z][a-z0-9_-]{0,63}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const UTC_WIRE_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const APPLIED_ATTRIBUTE_NAMES = new Set([
  "title",
  "description",
  "tags",
  "visibility",
  "made_for_kids",
  "monetization",
  "ad_suitability",
  "thumbnail",
]);

function withoutYoutubeAngleBrackets(value: string): boolean {
  return !value.includes("<") && !value.includes(">");
}

export const TutorialUploaderAttributesSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .max(100)
      .refine(withoutYoutubeAngleBrackets, "YouTube rejects angle brackets")
      .refine((title) => title === title.trim(), "title must be trimmed")
      .refine(
        (title) => title === title.replace(/\s+/g, " "),
        "title must use normalized whitespace",
      ),
    description: z
      .string()
      .max(5_000)
      .refine(withoutYoutubeAngleBrackets, "YouTube rejects angle brackets"),
    tags: z
      .array(
        z
          .string()
          .min(1)
          .max(100)
          .refine((tag) => tag === tag.trim(), "tags must be trimmed")
          .refine((tag) => !tag.includes(","), "tags must not contain commas")
          .refine(
            (tag) => tag === tag.replace(/\s+/g, " "),
            "tags must use normalized whitespace",
          ),
      )
      .max(100),
    visibility: z.enum(["private", "unlisted"]),
    made_for_kids: z.literal(false),
    monetization: z.enum(["on", "off"]).optional(),
    ad_suitability: z.literal("none").optional(),
  })
  .strict()
  .superRefine((attributes, context) => {
    const totalTagCharacters =
      attributes.tags.reduce((total, tag) => total + tag.length, 0) +
      Math.max(0, attributes.tags.length - 1);
    if (totalTagCharacters > 500) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tags"],
        message: "tags plus separators must be at most 500 characters",
      });
    }
    if (
      attributes.monetization === "on" &&
      attributes.ad_suitability !== "none"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ad_suitability"],
        message: "monetization=on requires an explicit ad suitability declaration",
      });
    }
    if (
      attributes.monetization !== "on" &&
      attributes.ad_suitability !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ad_suitability"],
        message: "ad suitability is only valid with monetization=on",
      });
    }
  });

export const TutorialUploaderAssetSchema = z
  .object({
    key: z.string().regex(SAFE_KEY),
    role: z.enum(["video", "thumbnail"]),
    file_name: z
      .string()
      .min(1)
      .max(255)
      .refine(
        (value) =>
          value !== "." &&
          value !== ".." &&
          !value.includes("/") &&
          !value.includes("\\") &&
          !Array.from(value).some((character) => character.charCodeAt(0) < 32),
        "file_name must be a safe basename",
      ),
    size_bytes: z.number().int().positive(),
    sha256: z.string().regex(SHA256),
    media_type: z.string().min(1).max(255),
  })
  .strict();

export const TutorialUploaderJobSchema = z
  .object({
    version: z.literal(TUTORIAL_UPLOADER_JOB_VERSION),
    job_id: z.string().uuid(),
    revision: z.number().int().min(1),
    idempotency_key: z.string().regex(IDEMPOTENCY_KEY),
    // Pydantic removes a zero millisecond suffix when it canonicalizes this
    // value. Normalize it here too so the JS and Python manifest hashes agree.
    // Other offsets and sub-millisecond precision are deliberately rejected:
    // they are valid timestamps but do not have one byte-for-byte wire form.
    created_at: z
      .string()
      .datetime({ offset: true })
      .regex(UTC_WIRE_TIMESTAMP)
      .transform((value) => value.replace(/\.000Z$/, "Z")),
    operation: z.literal("upload"),
    channel_id: z.string().regex(SAFE_KEY),
    target_video_id: z.null(),
    assets: z.array(TutorialUploaderAssetSchema).length(2),
    attributes: TutorialUploaderAttributesSchema,
  })
  .strict()
  .superRefine((job, context) => {
    const roles = job.assets.map((asset) => asset.role);
    if (roles.filter((role) => role === "video").length !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assets"],
        message: "upload must contain exactly one video",
      });
    }
    if (roles.filter((role) => role === "thumbnail").length !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assets"],
        message: "upload must contain exactly one thumbnail",
      });
    }
    if (new Set(job.assets.map((asset) => asset.key)).size !== job.assets.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assets"],
        message: "asset keys must be unique",
      });
    }
    if (
      new Set(job.assets.map((asset) => asset.file_name.toLocaleLowerCase()))
        .size !== job.assets.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assets"],
        message: "asset file names must be unique",
      });
    }
  });

export const TutorialUploaderReceiptStateSchema = z.enum([
  "accepted",
  "materializing",
  "staged",
  "queued",
  "active",
  "applied_reported",
  "succeeded",
  "failed",
  "uncertain",
  "rejected",
]);

export const TutorialUploaderReceiptErrorSchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    message: z.string().min(1).max(1_000),
    retryable: z.boolean().default(false),
  })
  .strict();

export const TutorialUploaderReceiptResultSchema = z
  .object({
    video_id: z.string().regex(YOUTUBE_VIDEO_ID),
    video_url: z.string().url().max(500),
    applied_attributes: z
      .array(z.string())
      .refine(
        (attributes) =>
          attributes.every((attribute) => APPLIED_ATTRIBUTE_NAMES.has(attribute)),
        "applied attributes contain an unsupported name",
      )
      .refine(
        (attributes) => new Set(attributes).size === attributes.length,
        "applied attributes must be unique",
      ),
    proof_ref: z
      .string()
      .min(1)
      .max(500)
      .refine(
        (value) =>
          !value.startsWith("/") &&
          !value.includes("\\") &&
          !value.includes("?") &&
          !value.includes("#") &&
          !value.split("/").includes(".."),
        "proof_ref must be a safe provider-neutral relative path",
      ),
  })
  .strict()
  .superRefine((result, context) => {
    const accepted = new Set([
      `https://www.youtube.com/watch?v=${result.video_id}`,
      `https://youtube.com/watch?v=${result.video_id}`,
      `https://youtu.be/${result.video_id}`,
    ]);
    if (!accepted.has(result.video_url)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["video_url"],
        message: "video_url must identify the same video_id",
      });
    }
  });

export const TutorialUploaderReceiptSchema = z
  .object({
    version: z.literal(TUTORIAL_UPLOADER_RECEIPT_VERSION),
    job_id: z.string().uuid(),
    revision: z.number().int().min(1),
    idempotency_key: z.string().regex(IDEMPOTENCY_KEY),
    manifest_sha256: z.string().regex(SHA256),
    sequence: z.number().int().min(1),
    state: TutorialUploaderReceiptStateSchema,
    occurred_at: z.string().datetime({ offset: true }),
    progress: z.number().min(0).max(1),
    message: z.string().min(1).max(1_000),
    result: TutorialUploaderReceiptResultSchema.nullable(),
    error: TutorialUploaderReceiptErrorSchema.nullable(),
  })
  .strict()
  .superRefine((receipt, context) => {
    const terminalFailure = ["failed", "uncertain", "rejected"].includes(
      receipt.state,
    );
    if (
      receipt.state === "succeeded" &&
      (receipt.result === null || receipt.error !== null || receipt.progress !== 1)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "succeeded requires result, progress=1 and no error",
      });
    } else if (
      terminalFailure &&
      (receipt.error === null || receipt.result !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${receipt.state} requires error and no result`,
      });
    } else if (
      receipt.state !== "succeeded" &&
      !terminalFailure &&
      (receipt.result !== null || receipt.error !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "progress receipts cannot contain result or error",
      });
    }
  });

export type TutorialUploaderAttributes = z.infer<
  typeof TutorialUploaderAttributesSchema
>;
export type TutorialUploaderAsset = z.infer<
  typeof TutorialUploaderAssetSchema
>;
export type TutorialUploaderJob = z.infer<typeof TutorialUploaderJobSchema>;
export type TutorialUploaderReceipt = z.infer<
  typeof TutorialUploaderReceiptSchema
>;
export type TutorialUploaderReceiptState = z.infer<
  typeof TutorialUploaderReceiptStateSchema
>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        // Default string sort is deterministic for our ASCII wire keys;
        // localeCompare can vary with the host locale.
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

/** Byte-for-byte JSON form used by the uploader's Python contract hash. */
export function canonicalTutorialUploaderJob(job: TutorialUploaderJob): string {
  return JSON.stringify(stableValue(TutorialUploaderJobSchema.parse(job)));
}

export function tutorialUploaderReceiptFileName(
  receipt: TutorialUploaderReceipt,
): string {
  return `${receipt.job_id}.r${receipt.revision}.${receipt.manifest_sha256.slice(0, 12)}.s${String(receipt.sequence).padStart(6, "0")}.${receipt.state}.json`;
}
