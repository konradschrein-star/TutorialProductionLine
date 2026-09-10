import { resolveTutorialChannelTargets } from '@repo/contracts';

type Channel = { id: string; language: string; isPrimary: boolean; metadata: unknown };
/** No guessed network, no implicit default languages, no ambiguous destinations. */
export function localizationTargets(primaryChannelId: string | null, channels: Channel[]) {
  return resolveTutorialChannelTargets(primaryChannelId, channels.map(channel => ({...channel,enabled:true}))).targets;
}

export function boundedMissingLocales<T extends { canAct?: boolean; createdAt: string | null; targetLanguages?: string[]; translations: Array<{ language: string | null }> }>(sources: T[], throughDate: string, limit: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(throughDate) || !Number.isInteger(limit) || limit < 1 || limit > 20) return [];
  const cutoff = Date.parse(`${throughDate}T23:59:59.999Z`);
  if (!Number.isFinite(cutoff) || new Date(cutoff).toISOString().slice(0, 10) !== throughDate) return [];
  let remaining = limit;
  return sources.flatMap(source => {
    if (source.canAct === false || !source.createdAt || Date.parse(source.createdAt) > cutoff || !Number.isFinite(Date.parse(source.createdAt))) return [];
    const languages = [...new Set(source.targetLanguages ?? [])].filter(language => !source.translations.some(child => child.language === language)).slice(0, remaining);
    remaining -= languages.length;
    return languages.length ? [{ source, languages }] : [];
  });
}
