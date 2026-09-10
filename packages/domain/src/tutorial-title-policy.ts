/** Opt-in generation policy. Never applies itself to existing/manual/approved titles. */
export const TUTORIAL_TITLE_SUFFIXES_2026 = [
  'Step-by-Step 2026', 'Easy Guide 2026', '2026 Guide', 'Quick Guide 2026', "Beginner's Guide 2026",
] as const;
export type TutorialTitleSuffix = typeof TUTORIAL_TITLE_SUFFIXES_2026[number];

/** Stable, varied suffix choice for machine-generated keyword titles. */
export function recommendTutorialTitleSuffix(subject: string, seed = subject): TutorialTitleSuffix {
  const value = subject.toLowerCase();
  if (/\b(beginner|beginners|getting started|first time)\b/.test(value)) return "Beginner's Guide 2026";
  if (/\b(fix|repair|recover|restore|error|problem|password)\b/.test(value)) return 'Quick Guide 2026';
  if (/\b(set up|setup|create|add|configure|install|connect|export|import)\b/.test(value)) return 'Step-by-Step 2026';
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return TUTORIAL_TITLE_SUFFIXES_2026[hash % TUTORIAL_TITLE_SUFFIXES_2026.length]!;
}
export function buildGeneratedTutorialTitle(subject: string, suffix: TutorialTitleSuffix, maxLength = 100): string {
  if (!(TUTORIAL_TITLE_SUFFIXES_2026 as readonly string[]).includes(suffix)) throw new Error('Choose an approved compact tutorial title suffix');
  const base = subject.trim().replace(/\s+/g, ' ').replace(/\s*(?:[-–—|:(]\s*)?(?:(?:only\s+)?step[ -]by[ -]step|easy guide|quick guide|beginner['’]s guide|2026 guide)(?:\s+2026)?\)?\s*$/i, '').replace(/\s*[-–—|:(]+\s*$/, '').trim();
  if (!base) throw new Error('A specific tutorial subject is required');
  const title = `${base} - ${suffix}`;
  if (!Number.isInteger(maxLength) || maxLength < 1 || title.length > maxLength) throw new Error('Shorten the tutorial subject; do not truncate the title or suffix');
  return title;
}
