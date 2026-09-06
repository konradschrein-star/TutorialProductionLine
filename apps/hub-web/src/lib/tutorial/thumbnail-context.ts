import { normalizeTutorialLanguage } from "@repo/contracts";

export interface TutorialThumbnailVariantInput {
  id: string;
  sourceJobId: string | null;
  language: string | null;
  channelId: string | null;
  channelLanguage: string | null;
  thumbnailTextTop: string | null;
  thumbnailTextBottom: string | null;
}

export interface TutorialThumbnailVariantContext {
  language: string;
  channelId: string;
  thumbnailTextTop: string;
  thumbnailTextBottom: string;
}

/** Validate the identity and localized copy owned by one tutorial variant. */
export function resolveTutorialThumbnailVariant(
  variant: TutorialThumbnailVariantInput,
): TutorialThumbnailVariantContext {
  const language = normalizeTutorialLanguage(variant.language);
  if (!language) throw new Error("tutorial language is missing");
  if (variant.sourceJobId === null && language !== "en") {
    throw new Error("an original tutorial must be English");
  }
  if (variant.sourceJobId !== null && language === "en") {
    throw new Error("a translation child cannot be English");
  }
  if (!variant.channelId || !variant.channelLanguage) {
    throw new Error("tutorial channel is missing");
  }
  if (normalizeTutorialLanguage(variant.channelLanguage) !== language) {
    throw new Error("tutorial language does not match its channel language");
  }
  const thumbnailTextTop = variant.thumbnailTextTop?.trim();
  const thumbnailTextBottom = variant.thumbnailTextBottom?.trim();
  if (!thumbnailTextTop || !thumbnailTextBottom) {
    throw new Error("localized two-line thumbnail copy is incomplete");
  }
  return {
    language,
    channelId: variant.channelId,
    thumbnailTextTop,
    thumbnailTextBottom,
  };
}
