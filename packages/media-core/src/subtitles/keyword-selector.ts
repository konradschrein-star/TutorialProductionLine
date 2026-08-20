import nlp from "compromise";
import type { CaptionPlan, CaptionWord } from "./types.js";
import type { RemotionSubtitleConfig } from "@repo/db";

type KeywordConfig = RemotionSubtitleConfig["keyword"];
type WordClass = "noun" | "verb" | "adjective" | "adverb" | "number";

// ===========================================================================
// Keyword selector — POS-tag words via `compromise` (runs in Node + browser),
// pick the most salient `aggressiveness`% of eligible words, and colour them by
// rotating the palette within each chunk.
// Spec: docs/superpowers/specs/2026-07-26-global-subtitle-system-design.md §3.3
// ===========================================================================

/**
 * Map a raw token to its word class using compromise, or null when it is not
 * one of the classes we highlight. Numbers are checked first (a cardinal like
 * "42" carries Value/Cardinal tags, not Noun). Tagging uses the RAW token so a
 * textCase transform (e.g. UPPER) does not degrade POS accuracy.
 *
 * TUNING NOTE: we tag each token independently. Per-token tagging is fully
 * deterministic and trivially aligns back to CaptionWords; the small loss of
 * sentence context is acceptable for keyword highlighting.
 */
function classifyToken(raw: string): {
  cls: WordClass | null;
  proper: boolean;
} {
  const clean = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, "");
  if (!clean) return { cls: null, proper: false };

  // compromise's .json() already includes per-term `tags`; the typed options
  // arg omits it, so we read the result via a narrow structural cast.
  const term = nlp(clean).terms().json()[0] as
    | { terms?: Array<{ tags?: Iterable<string> }> }
    | undefined;
  const rawTags = term?.terms?.[0]?.tags;
  const tagList: string[] = rawTags ? Array.from(rawTags) : [];
  const has = (t: string) => tagList.includes(t);
  const proper = has("ProperNoun");

  let cls: WordClass | null = null;
  if (has("Value") || has("Cardinal") || has("NumericValue") || has("Number")) {
    cls = "number";
  } else if (has("Noun")) {
    cls = "noun";
  } else if (has("Verb")) {
    cls = "verb";
  } else if (has("Adjective")) {
    cls = "adjective";
  } else if (has("Adverb")) {
    cls = "adverb";
  }
  return { cls, proper };
}

const CLASS_BASE: Record<WordClass, number> = {
  noun: 3,
  number: 3,
  verb: 2,
  adjective: 1.5,
  adverb: 1,
};

/**
 * Salience score — higher = more important. So that LOW aggressiveness still
 * picks the MOST important words (not random ones), we prefer proper nouns
 * (sentence subjects/objects) and longer/rarer words.
 * TUNING NOTE: rarity is approximated by token length (no frequency table).
 */
function salience(cls: WordClass, proper: boolean, word: string): number {
  return CLASS_BASE[cls] + (proper ? 1.5 : 0) + word.length * 0.1;
}

interface Eligible {
  word: CaptionWord;
  score: number;
  order: number; // stable tiebreak
}

export function selectKeywords(
  plan: CaptionPlan,
  keywordConfig: KeywordConfig,
): CaptionPlan {
  if (!keywordConfig.enabled) return plan;

  const allowed = new Set<WordClass>(keywordConfig.wordClasses as WordClass[]);

  // 1. Collect eligible words with salience scores.
  const eligible: Eligible[] = [];
  let order = 0;
  for (const chunk of plan) {
    for (const word of chunk.words) {
      const { cls, proper } = classifyToken(word.raw);
      if (cls && allowed.has(cls)) {
        eligible.push({
          word,
          score: salience(cls, proper, word.word),
          order: order,
        });
      }
      order++;
    }
  }

  // 2. Select the top aggressiveness% by salience.
  const selectCount = Math.round(
    (keywordConfig.aggressiveness / 100) * eligible.length,
  );
  if (selectCount <= 0) return plan;

  const ranked = [...eligible].sort(
    (a, b) => b.score - a.score || a.order - b.order,
  );
  const selected = new Set<CaptionWord>(
    ranked.slice(0, selectCount).map((e) => e.word),
  );

  // 3. Assign colours by rotating the palette within each chunk.
  const colors = keywordConfig.colors;
  for (const chunk of plan) {
    let rot = 0;
    for (const word of chunk.words) {
      if (selected.has(word)) {
        word.role = "keyword";
        if (colors.length > 0) {
          word.keywordColor = colors[rot % colors.length];
        }
        rot++;
      }
    }
  }

  return plan;
}
