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
  flag: string; // emoji flag for quick visual scanning
}

/**
 * Standard launch set: 5 core languages (German, French, Spanish, Japanese, Korean).
 * Auto-translation ("Translate everything missing" / "Translate all") strictly targets
 * these standard languages by default.
 */
export const DEFAULT_STANDARD_LANGUAGES: readonly string[] =
  AUTOMATIC_TUTORIAL_LANGUAGE_CODES;

export const ALL_TARGET_LANGUAGES: TargetLanguage[] = [
  { code: "de", name: "German", native: "Deutsch", flag: "🇩🇪" },
  { code: "fr", name: "French", native: "Français", flag: "🇫🇷" },
  { code: "it", name: "Italian", native: "Italiano", flag: "🇮🇹" },
  { code: "es", name: "Spanish", native: "Español", flag: "🇪🇸" },
  { code: "nl", name: "Dutch", native: "Nederlands", flag: "🇳🇱" },
  { code: "sv", name: "Swedish", native: "Svenska", flag: "🇸🇪" },
  { code: "no", name: "Norwegian", native: "Norsk", flag: "🇳🇴" },
  { code: "da", name: "Danish", native: "Dansk", flag: "🇩🇰" },
  { code: "pt", name: "Portuguese", native: "Português", flag: "🇵🇹" },
  { code: "pl", name: "Polish", native: "Polski", flag: "🇵🇱" },
  { code: "cs", name: "Czech", native: "Čeština", flag: "🇨🇿" },
  { code: "ru", name: "Russian", native: "Русский", flag: "🇷🇺" },
  { code: "ar", name: "Arabic", native: "العربية", flag: "🇸🇦" },
  { code: "zh", name: "Chinese", native: "中文", flag: "🇨🇳" },
  { code: "ja", name: "Japanese", native: "日本語", flag: "🇯🇵" },
  { code: "ko", name: "Korean", native: "한국어", flag: "🇰🇷" },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia", flag: "🇮🇩" },
];

/** Backwards-compatible alias for the full language catalog. */
export const TARGET_LANGUAGES = ALL_TARGET_LANGUAGES;

export const TARGET_LANGUAGE_CODES = ALL_TARGET_LANGUAGES.map((l) => l.code);

export const STANDARD_LANGUAGES: TargetLanguage[] = ALL_TARGET_LANGUAGES.filter((l) =>
  DEFAULT_STANDARD_LANGUAGES.includes(l.code),
);

export const STANDARD_LANGUAGE_CODES = STANDARD_LANGUAGES.map((l) => l.code);

export function languageName(code: string): string {
  return ALL_TARGET_LANGUAGES.find((l) => l.code === code)?.name ?? code.toUpperCase();
}

export function isSupportedTargetLanguage(code: string): boolean {
  return TARGET_LANGUAGE_CODES.includes(code);
}

export function isStandardTargetLanguage(code: string, standardList: readonly string[] = DEFAULT_STANDARD_LANGUAGES): boolean {
  return standardList.includes(code);
}

import { AUTOMATIC_TUTORIAL_LANGUAGE_CODES } from "@repo/contracts";
