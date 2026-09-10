import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { resolveTutorialChannelTargets, normalizeTutorialLanguage } from "@repo/contracts";
import { tutorialJobs, thumbnails, channels, tutorialThumbnailFanout } from "./schema/index.js";
import type { DrizzleClient } from "./client.js";
type Transaction = Parameters<Parameters<DrizzleClient["transaction"]>[0]>[0];
export type ApprovedEnglishThumbnail = { sourceJobId: string; thumbnailId: string; sourcePath: string; sha256: string; size: number };
export const THUMBNAIL_FANOUT_LANGUAGES = ["de", "fr", "it", "sv"] as const;

export function resolveThumbnailFanoutTargets(mapping: unknown, children: readonly { language: string | null; channel_id: string | null }[], destinations: readonly { id: string; language: string }[]) {
  const configured = mapping && typeof mapping === "object" && !Array.isArray(mapping) ? mapping as Record<string, unknown> : {};
  const languages = [...new Set([...Object.keys(configured), ...children.map(child => child.language)])].filter((language): language is string => typeof language === "string" && language !== "en");
  const targets: Array<{ language: string; channelId: string }> = [], blocked: string[] = [];
  for (const language of languages) {
    const family = children.filter(child => child.language === language);
    const mapped = typeof configured[language] === "string" ? configured[language] as string : null;
    const channelId = mapped ?? (family.length === 1 ? family[0]!.channel_id : null);
    if (!/^[a-z]{2}$/.test(language) || family.length > 1 || !channelId || (mapped && family.some(child => child.channel_id !== mapped)) || !destinations.some(channel => channel.id === channelId && channel.language === language)) { blocked.push(language); continue; }
    targets.push({ language, channelId });
  }
  return { targets, blocked };
}

export function englishThumbnailApprovalRevision(input: ApprovedEnglishThumbnail, channelId: string) {
  if (!/^[a-f0-9]{64}$/.test(input.sha256) || !Number.isSafeInteger(input.size) || input.size <= 0 || input.size > 32 * 1024 ** 2 || !input.sourcePath) throw new Error("Exact bounded English thumbnail fingerprint required");
  return createHash("sha256").update(JSON.stringify([input.sourceJobId, channelId, input.thumbnailId, input.sourcePath, input.sha256, input.size])).digest("hex");
}

/** Caller holds the original row lock and exact-file media lease through commit. */
export async function recordApprovedEnglishThumbnailFanout(tx: Transaction, input: ApprovedEnglishThumbnail) {
  const [source] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, input.sourceJobId)).limit(1);
  if (!source || source.source_job_id || source.language !== "en" || !source.channel_id || source.status === "CANCELLED" || source.va_review_status === "rework_requested") throw new Error("An active English original is required");
  const selected = await tx.select().from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, source.id), eq(thumbnails.language, "en"), eq(thumbnails.is_selected, true)));
  const image = selected[0];
  if (selected.length !== 1 || !image || image.id !== input.thumbnailId || image.channel_id !== source.channel_id || image.output_path !== input.sourcePath || image.status !== "completed" || !["acceptable", "strong"].includes(image.review_verdict)) throw new Error("Approve exactly this English candidate before localization");
  const revision = englishThumbnailApprovalRevision(input, source.channel_id);
  const children = await tx.select().from(tutorialJobs).where(and(eq(tutorialJobs.source_job_id, source.id), eq(tutorialJobs.created_by, source.created_by)));
  const destinations = await tx.select({ id: channels.id, language: channels.language, isPrimary: channels.is_primary, enabled: channels.accepts_tutorials, metadata: channels.metadata }).from(channels).where(eq(channels.accepts_tutorials, true));
  const configured = resolveTutorialChannelTargets(source.channel_id, destinations);
  const targets = configured.targets.filter(target => {
    const family = children.filter(child => normalizeTutorialLanguage(child.language) === target.language);
    return family.length === 1 && family[0]!.channel_id === target.channelId;
  });
  const blocked = [...new Set([
    ...configured.blocked.map(item => item.language),
    ...configured.targets.filter(target => {
      const family = children.filter(child => normalizeTutorialLanguage(child.language) === target.language);
      return family.length !== 1 || family[0]!.channel_id !== target.channelId;
    }).map(target => target.language),
  ])];
  if (targets.length) await tx.insert(tutorialThumbnailFanout).values(targets.map(({ language, channelId }) => ({
    source_job_id: source.id, source_thumbnail_id: input.thumbnailId, approval_revision: revision,
    source_path: input.sourcePath, source_sha256: input.sha256, source_size: input.size, target_language: language, target_channel_id: channelId,
  }))).onConflictDoNothing();
  return { approvalRevision: revision, languages: targets.map(target => target.language), blockedLocales: blocked };
}
