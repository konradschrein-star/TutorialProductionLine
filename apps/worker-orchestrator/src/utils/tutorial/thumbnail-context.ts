import { normalizeTutorialLanguage } from "@repo/contracts";
import { channels, eq, type DrizzleClient, type TutorialJob } from "@repo/db";

export interface TutorialThumbnailContext {
  language: string;
  channelId: string;
  thumbnailTextTop: string;
  thumbnailTextBottom: string;
}

/**
 * Validate the durable owner of a tutorial thumbnail before rendering. Missing
 * state is an error: generation must never assume English or borrow a channel.
 */
export async function resolveTutorialThumbnailContext(
  db: DrizzleClient,
  job: Pick<
    TutorialJob,
    | "id"
    | "source_job_id"
    | "language"
    | "channel_id"
    | "thumbnail_text_top"
    | "thumbnail_text_bottom"
  >,
): Promise<TutorialThumbnailContext> {
  const language = normalizeTutorialLanguage(job.language);
  if (!language) {
    throw new Error(
      `Tutorial ${job.id} has no explicit language; thumbnail generation will not assume English`,
    );
  }
  if (job.source_job_id === null && language !== "en") {
    throw new Error(
      `Tutorial ${job.id} is an original in ${language}; originals must be English`,
    );
  }
  if (job.source_job_id !== null && language === "en") {
    throw new Error(`Tutorial ${job.id} is a translation child marked English`);
  }
  if (!job.channel_id) {
    throw new Error(
      `Tutorial ${job.id} has no channel; channel-specific thumbnail generation is blocked`,
    );
  }
  const [channel] = await db
    .select({ id: channels.id, language: channels.language })
    .from(channels)
    .where(eq(channels.id, job.channel_id))
    .limit(1);
  if (!channel) {
    throw new Error(`Tutorial ${job.id} references a missing channel`);
  }
  if (normalizeTutorialLanguage(channel.language) !== language) {
    throw new Error(
      `Tutorial ${job.id} language ${language} does not match channel language ${channel.language}`,
    );
  }
  const thumbnailTextTop = job.thumbnail_text_top?.trim();
  const thumbnailTextBottom = job.thumbnail_text_bottom?.trim();
  if (!thumbnailTextTop || !thumbnailTextBottom) {
    throw new Error(
      `Tutorial ${job.id} is missing localized two-line thumbnail copy`,
    );
  }
  return {
    language,
    channelId: channel.id,
    thumbnailTextTop,
    thumbnailTextBottom,
  };
}

export interface TranslationChannelCandidate {
  id: string;
  language: string;
}

/** Select a target-language channel only when the configuration is unambiguous. */
export function selectTranslationChannel(
  targetLanguage: string,
  candidates: readonly TranslationChannelCandidate[],
): TranslationChannelCandidate {
  const language = normalizeTutorialLanguage(targetLanguage);
  const matches = candidates.filter(
    (candidate) => normalizeTutorialLanguage(candidate.language) === language,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Translation channel for ${targetLanguage} is ${
        matches.length === 0
          ? "missing"
          : `ambiguous (${matches.length} matches)`
      }; configure exactly one tutorial channel for this language`,
    );
  }
  return matches[0]!;
}
