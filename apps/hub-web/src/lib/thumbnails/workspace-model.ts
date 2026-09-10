import type { TutorialThumbnailMode } from "@repo/contracts";

export const THUMBNAIL_LANGUAGE_COLUMNS = ["en", "de", "fr", "it", "sv"] as const;
export const THUMBNAIL_LANGUAGE_NAMES: Record<string, string> = { en: "English", de: "German", fr: "French", it: "Italian", sv: "Swedish" };
export const THUMBNAIL_COLUMN_WIDTH = { compact: 178, comfortable: 356, large: 456 } as const;

/**
 * Channel profiles are the editor source of truth. The global generation
 * setting remains a fallback for old channels that have not stored a profile
 * mode yet, so opening an older tutorial does not expose a workflow its server
 * does not support.
 */
export function thumbnailEditorAvailability(
  profileMode: TutorialThumbnailMode | null | undefined,
  legacyGenerationMode: "ai" | "manual" | null | undefined,
): { procedural: boolean; ai: boolean } {
  const mode = profileMode ?? (legacyGenerationMode === "ai" ? "ai" : "procedural");
  return {
    procedural: mode === "procedural" || mode === "both",
    ai: mode === "ai" || mode === "both",
  };
}

export function thumbnailEditorUrl(jobId: string, language?: string): string {
  const params = new URLSearchParams({ jobId });
  if (language && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(language)) params.set("language", language.toLowerCase());
  return `/thumbnails?${params}`;
}

/** UI affordance only: server revision and ownership checks remain authoritative. */
export function hasCompleteThumbnailPack(variants: readonly { language: string; thumbnailId: string | null }[], expectedLanguages: readonly string[] = THUMBNAIL_LANGUAGE_COLUMNS): boolean {
  return variants.length === expectedLanguages.length && expectedLanguages.every((language) => {
    const matching = variants.filter((variant) => variant.language === language);
    return matching.length === 1 && Boolean(matching[0]?.thumbnailId);
  });
}

export function thumbnailCanvasScale(viewportWidth: number, canvasWidth: number, portrait: boolean, zoom: "fit" | "100", viewportHeight = 1080): number {
  if (zoom === "100") return 1;
  const canvasHeight = portrait ? 800 : 450;
  return Math.min(portrait ? .85 : 1.5, Math.max(.1, (viewportWidth - 40) / canvasWidth), Math.max(220, viewportHeight - 320) / canvasHeight);
}
