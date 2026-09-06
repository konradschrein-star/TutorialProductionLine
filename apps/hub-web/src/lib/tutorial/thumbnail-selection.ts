import { normalizeTutorialLanguage } from "@repo/contracts";

export interface TutorialThumbnailOwner {
  language: string | null;
  channelId: string | null;
}

export interface TutorialThumbnailCandidate {
  id: string;
  language: string | null;
  channelId: string | null;
  status: string;
  isSelected: boolean;
  outputPath: string | null;
}

export interface TutorialThumbnailSelection {
  ready: boolean;
  thumbnail: TutorialThumbnailCandidate | null;
  reasons: string[];
}

/**
 * Resolve the one thumbnail that belongs to a publishing variant. A tutorial
 * source can temporarily contain historical/pre-localization thumbnails for
 * other languages, so subject id alone is not an ownership boundary.
 */
export function assessTutorialThumbnailSelection(
  owner: TutorialThumbnailOwner,
  candidates: readonly TutorialThumbnailCandidate[],
): TutorialThumbnailSelection {
  const reasons: string[] = [];
  const language = normalizeTutorialLanguage(owner.language);
  if (!language) reasons.push("tutorial language is missing");
  if (!owner.channelId) reasons.push("tutorial channel is missing");
  if (!language || !owner.channelId) {
    return { ready: false, thumbnail: null, reasons };
  }

  const selectedCompleted = candidates.filter(
    (candidate) =>
      candidate.isSelected &&
      candidate.status === "completed" &&
      normalizeTutorialLanguage(candidate.language) === language,
  );
  if (selectedCompleted.length !== 1) {
    reasons.push(
      `exactly one selected completed ${language} thumbnail is required; found ${selectedCompleted.length}`,
    );
    return { ready: false, thumbnail: null, reasons };
  }

  const thumbnail = selectedCompleted[0]!;
  if (thumbnail.channelId !== owner.channelId) {
    reasons.push("selected thumbnail belongs to a different channel");
  }
  if (!thumbnail.outputPath?.trim()) {
    reasons.push("selected completed thumbnail has no output path");
  }

  return {
    ready: reasons.length === 0,
    thumbnail: reasons.length === 0 ? thumbnail : null,
    reasons,
  };
}
