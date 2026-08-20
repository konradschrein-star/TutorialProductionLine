/**
 * Target languages for tutorial localization.
 *
 * Launch set: German, French, Spanish, Japanese, Korean. This list is the single
 * source of truth for the Localize UI + the translate API — extend it with any
 * language that has a decent RPM / large viewership (the owner's plan is "every
 * conceivable language" over time).
 */
export interface TargetLanguage {
  code: string; // BCP-47-ish short code, stored on tutorial_jobs.language
  name: string; // English name (for owner/admin UI)
  native: string; // endonym (shown to VAs)
}

export const TARGET_LANGUAGES: TargetLanguage[] = [
  { code: "de", name: "German", native: "Deutsch" },
  { code: "fr", name: "French", native: "Français" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "ko", name: "Korean", native: "한국어" },
];

export const TARGET_LANGUAGE_CODES = TARGET_LANGUAGES.map((l) => l.code);

export function languageName(code: string): string {
  return TARGET_LANGUAGES.find((l) => l.code === code)?.name ?? code.toUpperCase();
}

export function isSupportedTargetLanguage(code: string): boolean {
  return TARGET_LANGUAGE_CODES.includes(code);
}
