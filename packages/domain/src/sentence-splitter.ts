/**
 * Smart sentence splitter.
 *
 * Two modes:
 *   splitSentences    — splits at . ? ! only (abbreviation-protected)
 *   splitSubSentences — additionally splits at , ; : — (for intro/hook clause-level imagery)
 *
 * Abbreviation protection prevents false splits on "Dr.", "U.S.", "vs.", etc.
 */

/** Tokens that should never be treated as sentence-ending periods. */
const ABBREVIATIONS = new Set([
  // Titles
  "mr", "mrs", "ms", "dr", "prof", "rev", "sr", "jr",
  // Latin / common
  "vs", "etc", "i.e", "e.g", "a.m", "p.m", "no",
  // Organizations / geo
  "inc", "ltd", "corp", "co", "dept", "govt", "est",
  "u.s", "u.k", "e.u", "u.n", "d.c",
  // Months
  "jan", "feb", "mar", "apr", "jun", "jul",
  "aug", "sep", "oct", "nov", "dec",
  // Misc
  "approx", "nat", "intl", "vol", "fig", "pp", "op",
]);

function isAbbreviation(wordBeforePeriod: string): boolean {
  const lower = wordBeforePeriod.toLowerCase().replace(/\.$/, "");
  if (ABBREVIATIONS.has(lower)) return true;
  // Single uppercase letter (initials like "J.")
  if (/^[A-Z]$/.test(wordBeforePeriod.replace(/\.$/, ""))) return true;
  // Already contains interior dots (U.S.A., N.A.T.O.)
  if ((wordBeforePeriod.match(/\./g) ?? []).length > 1) return true;
  return false;
}

/**
 * Split text into sentence-level segments.
 * Handles abbreviations, ellipses, and trailing punctuation.
 */
export function splitSentences(text: string): string[] {
  const tokens = text.split(/(\s+)/);
  const sentences: string[] = [];
  let current = "";

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    current += token;

    // Check if this token ends with sentence-final punctuation
    const sentenceEnd = /[.!?]["\u201d\u2019]?\s*$/.test(token);
    if (!sentenceEnd) continue;

    // If it ends with a period, check for abbreviation
    if (/\.\s*$/.test(token)) {
      const word = token.trim();
      if (isAbbreviation(word)) continue;
      // Skip if next non-whitespace token starts with lowercase
      const next = tokens.slice(i + 1).find((t) => t.trim().length > 0);
      if (next && /^[a-z]/.test(next)) continue;
    }

    const trimmed = current.trim();
    if (trimmed.length > 0) sentences.push(trimmed);
    current = "";
  }

  const remaining = current.trim();
  if (remaining.length > 0) sentences.push(remaining);

  return sentences.filter((s) => s.length > 0);
}

/**
 * Split text into clause-level segments (sub-sentences).
 * First applies sentence splitting, then additionally splits on , ; : —
 * Used for hook/intro zones where faster image cuts are needed.
 */
export function splitSubSentences(text: string): string[] {
  const sentences = splitSentences(text);
  const result: string[] = [];

  for (const sentence of sentences) {
    // Split on clause boundaries but protect numeric commas like 1,000 and 3.5%
    const clauses = sentence
      .split(/(?<!\d)[,;:\u2014](?!\d)\s*/)
      .map((c) => c.trim())
      .filter((c) => c.length > 4);
    result.push(...(clauses.length > 1 ? clauses : [sentence]));
  }

  return result;
}
