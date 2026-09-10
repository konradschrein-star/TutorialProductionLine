import { normalizeTutorialLanguage } from "@repo/contracts";

export interface LocaleChannel { id: string; language: string | null }

/** A workspace chooses its locale set; global defaults must not invent targets. */
export function configuredTutorialLocales(mapping: unknown, existing: readonly { language: string | null }[]): string[] {
  const configured = mapping && typeof mapping === "object" && !Array.isArray(mapping) ? Object.keys(mapping) : [];
  return [...new Set([...configured, ...existing.map(row => row.language)].map(normalizeTutorialLanguage).filter((language): language is string => Boolean(language && language !== "en")))].sort();
}

/** Explicit per-source-channel routing wins. Legacy single-network installs
 * may use their unique language channel; ambiguity never picks a random one. */
export function resolveLocaleChannel(language: string, channels: readonly LocaleChannel[], configured: unknown): LocaleChannel {
  const mapping = configured && typeof configured === "object" && !Array.isArray(configured)
    ? configured as Record<string, unknown> : {};
  const expected = mapping[language];
  const matching = channels.filter((channel) => normalizeTutorialLanguage(channel.language) === language && (expected === undefined || channel.id === expected));
  if (matching.length !== 1) throw new Error(`${language}: ${expected !== undefined ? "configured destination is unavailable or has the wrong language" : matching.length ? "multiple destination channels; ask an Admin to configure this source channel's locale routing" : "destination channel is missing"}`);
  return matching[0]!;
}
