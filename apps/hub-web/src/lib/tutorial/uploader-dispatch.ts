import { stat } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import { z } from "zod";
import {
  TutorialUploaderAttributesSchema,
  type TutorialUploaderAttributes,
} from "@repo/contracts";
import { DEFAULT_STANDARD_LANGUAGES } from "./languages";
import { UPLOADER_CHANNEL_KEY_PATTERN } from "./uploader-channel-key";

export const AUTOMATIC_TRANSLATION_LANGUAGES = [
  ...DEFAULT_STANDARD_LANGUAGES,
] as const;

export const DispatchRequestSchema = z
  .object({
    visibility: z.enum(["private", "unlisted"]),
    made_for_kids: z.literal(false),
    monetization: z.enum(["on", "off"]),
    ad_suitability_confirmed: z.literal(true).optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.monetization === "on" &&
      request.ad_suitability_confirmed !== true
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ad_suitability_confirmed"],
        message: "monetization=on requires ad-suitability confirmation",
      });
    }
  });

export type DispatchRequest = z.infer<typeof DispatchRequestSchema>;

export interface DispatchCandidate {
  status: string;
  isUploaded: boolean | null;
  sourceJobId: string | null;
  language: string | null;
  channelLanguage: string | null;
  title: string;
  description: string | null;
  tags: unknown;
  finalPath: string | null;
  uploaderChannelKey: string | null;
}

const LANGUAGE_ALIASES: Record<string, string> = {
  english: "en",
  german: "de",
  french: "fr",
  spanish: "es",
  japanese: "ja",
  korean: "ko",
};

export class DispatchGateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DispatchGateError";
  }
}

function normalizedLanguage(language: string | null): string {
  const value = language?.trim().toLowerCase() || "en";
  return LANGUAGE_ALIASES[value] ?? value;
}

/**
 * Validate only durable record state. Filesystem checks happen separately so
 * this function stays deterministic and cheap to unit test.
 */
export function validateDispatchCandidate(
  candidate: DispatchCandidate,
  request: DispatchRequest,
): TutorialUploaderAttributes {
  if (candidate.status !== "COMPLETED") {
    throw new DispatchGateError(
      "tutorial_not_completed",
      `Tutorial is ${candidate.status}, not COMPLETED`,
    );
  }
  if (candidate.isUploaded) {
    throw new DispatchGateError(
      "tutorial_already_uploaded",
      "Tutorial is already marked as uploaded and cannot be queued again",
    );
  }

  const language = normalizedLanguage(candidate.language);
  if (candidate.sourceJobId) {
    if (!AUTOMATIC_TRANSLATION_LANGUAGES.some((code) => code === language)) {
      throw new DispatchGateError(
        "unsupported_translation_language",
        `Translated tutorials may dispatch only in ${AUTOMATIC_TRANSLATION_LANGUAGES.join(", ")}`,
      );
    }
  } else if (language !== "en") {
    throw new DispatchGateError(
      "source_not_english",
      "Original tutorials must be English; other languages must be localized children",
    );
  }

  if (
    candidate.channelLanguage &&
    normalizedLanguage(candidate.channelLanguage) !== language
  ) {
    throw new DispatchGateError(
      "channel_language_mismatch",
      "Tutorial language does not match its assigned channel",
    );
  }

  const channelKey = candidate.uploaderChannelKey?.trim() ?? "";
  if (!channelKey) {
    throw new DispatchGateError(
      "uploader_channel_unmapped",
      "Channel has no explicit uploader channel key",
    );
  }
  if (!UPLOADER_CHANNEL_KEY_PATTERN.test(channelKey)) {
    throw new DispatchGateError(
      "uploader_channel_key_invalid",
      "Channel uploader key is not a valid provider-neutral profile key",
    );
  }

  const title = candidate.title.trim();
  const description = candidate.description?.trim() ?? "";
  if (
    !Array.isArray(candidate.tags) ||
    candidate.tags.length === 0 ||
    candidate.tags.some(
      (tag) => typeof tag !== "string" || tag.trim().length === 0,
    )
  ) {
    throw new DispatchGateError(
      "localized_metadata_incomplete",
      "Localized title, description, and tags must all be nonempty",
    );
  }
  const tags = candidate.tags.map((tag) => (tag as string).trim());
  if (!title || !description) {
    throw new DispatchGateError(
      "localized_metadata_incomplete",
      "Localized title, description, and tags must all be nonempty",
    );
  }
  if (!candidate.finalPath?.trim()) {
    throw new DispatchGateError(
      "final_video_missing",
      "Tutorial has no final video path",
    );
  }

  const attributes = {
    title,
    description,
    tags,
    visibility: request.visibility,
    made_for_kids: false as const,
    monetization: request.monetization,
    ...(request.monetization === "on"
      ? { ad_suitability: "none" as const }
      : {}),
  };
  const parsed = TutorialUploaderAttributesSchema.safeParse(attributes);
  if (!parsed.success) {
    throw new DispatchGateError(
      "youtube_metadata_invalid",
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  return parsed.data;
}

const ALLOWED_EXTENSIONS = {
  video: new Set([".mp4"]),
  thumbnail: new Set([".jpg", ".jpeg", ".png", ".webp"]),
} as const;

/** Ensure a database path still identifies the exact usable local artifact. */
export async function assertLocalDispatchAsset(
  path: string,
  role: keyof typeof ALLOWED_EXTENSIONS,
): Promise<void> {
  if (!isAbsolute(path)) {
    throw new DispatchGateError(
      `${role}_path_not_absolute`,
      `${role === "video" ? "Final video" : "Selected thumbnail"} path must be absolute`,
    );
  }
  if (!ALLOWED_EXTENSIONS[role].has(extname(path).toLowerCase())) {
    throw new DispatchGateError(
      `${role}_type_invalid`,
      `${role === "video" ? "Final video" : "Selected thumbnail"} has an unsupported file type`,
    );
  }
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size <= 0) {
      throw new DispatchGateError(
        `${role}_file_invalid`,
        `${role === "video" ? "Final video" : "Selected thumbnail"} is not a nonempty file`,
      );
    }
  } catch (error) {
    if (error instanceof DispatchGateError) throw error;
    throw new DispatchGateError(
      `${role}_file_unavailable`,
      `${role === "video" ? "Final video" : "Selected thumbnail"} is not readable on this server`,
    );
  }
}
