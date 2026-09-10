/**
 * Thumbnail headline condensing.
 *
 * WHY THIS EXISTS
 * ---------------
 * The second review of generated tutorial thumbnails (2026-08-06) was mostly
 * one complaint said eleven ways: the thumbnail was printing the VIDEO TITLE.
 * Verbatim:
 *
 *   "There is sometimes tons and tons of text, way too much text. Four words is
 *    the maximum for the shorter tutorials. Something like 'QuickBooks Online,
 *    Get Paid Faster' is something which we could theoretically compress into
 *    'Get Paid Faster' with the big logo of QuickBooks."
 *
 *   "I reckon the problem that causes this is using the prompt that we write,
 *    using the title directly as what's supposed to be on there but that doesn't
 *    make sense. There are a few rules and we'd have to definitely differentiate
 *    stuff: the words that are on the thumbnail compared to what's actually on
 *    there."
 *
 * That is exactly right, and it was structural: when the headline LLM was
 * unavailable `deriveHeadline` fell back to `trimWords(title, maxWords)` — the
 * first N words of the title, verbatim — and when the LLM WAS available nothing
 * checked that it had obeyed. Both paths now run through `condenseHeadline`.
 *
 * THE TWO RULES THAT DO THE WORK
 * ------------------------------
 * 1. FILLER IS NOISE. "Finally", "made easy", "step by step", "painless" — none
 *    of them survive a 168x94 thumbnail and all of them cost the words that do.
 * 2. THE LOGO ALREADY SAYS THE BRAND. A giant Sage logo next to the word "Sage"
 *    spends the most valuable space in the frame saying the same thing twice:
 *    "We have the Sage logo at the bottom. We do not need to repeat it."
 *
 * Rule 2 is NOT absolute, and the two-word floor below is how the nuance is
 * kept. The owner accepted "Notion SOPs" and "Triple Whale Funnel" in the same
 * review that rejected "Gusto" + "Gusto Payroll". The difference is grammatical:
 * a name that is part of the phrase earns its place, a name sitting next to its
 * own logo as a label does not. So the brand is dropped only while something
 * meaningful is left standing without it.
 *
 * PURE module: no DB, no network, no LLM. Unit-tested.
 */

/**
 * Multi-word filler, matched as phrases. Order matters only in that longer
 * phrases must be removed before their constituent words are.
 */
const FILLER_PHRASES: readonly RegExp[] = [
  /\bstep[\s-]by[\s-]step\b/gi,
  /\bmade (?:easy|simple|painless)\b/gi,
  /\bthe easy way\b/gi,
  /\bonce and for all\b/gi,
  /\bfrom scratch\b/gi,
  /\bfull (?:guide|tutorial|walkthrough|course)\b/gi,
  /\b(?:complete|ultimate|definitive) (?:guide|tutorial|walkthrough)\b/gi,
];

/** Single filler words. Deliberately short — over-stripping loses meaning. */
const FILLER_WORDS: ReadonlySet<string> = new Set([
  "finally",
  "actually",
  "really",
  "easily",
  "simply",
  "quickly",
  "painless",
  "painlessly",
  "effortless",
  "effortlessly",
  "ultimate",
  "definitive",
  "complete",
  "guide",
  "tutorial",
  "walkthrough",
  "explained",
  "tips",
  "hacks",
]);

/**
 * Leading scaffolding. A thumbnail headline is a noun/verb phrase, not a
 * sentence — "How To Reconcile Bank Transactions" reads as "Reconcile Bank
 * Transactions" with three characters' worth of type saved per word dropped.
 */
const LEAD_PATTERNS: readonly RegExp[] = [
  /^(?:how (?:to|i)|learn how to|the way to)\s+/i,
  /^(?:a |an |the )?(?:complete|ultimate|definitive|beginners?'?s?)\s+(?:guide|tutorial|walkthrough)\s+(?:to|for)\s+/i,
  /^(?:heres?|here is|this is)\s+(?:how\s+)?/i,
];

/** Words that must not start or end a headline — they dangle. */
const CONNECTIVES: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "in",
  "on",
  "at",
  "to",
  "of",
  "for",
  "with",
  "and",
  "or",
  "your",
  "my",
  "from",
  "into",
  "using",
  "via",
  "by",
  "that",
  "this",
  "is",
  "are",
]);

/**
 * Product qualifiers that trail a brand name and mean nothing without it —
 * "QuickBooks Online" minus "QuickBooks" must not leave a stray "Online".
 */
const BRAND_QUALIFIERS: readonly string[] = [
  "online",
  "pro",
  "plus",
  "desktop",
  "cloud",
  "app",
  "studio",
  "suite",
  "workspace",
  "premium",
  "enterprise",
  "business",
  "template",
  "templates",
];

function tokenise(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function stripEdgeConnectives(words: string[]): string[] {
  let start = 0;
  let end = words.length;
  const bare = (w: string): string => w.toLowerCase().replace(/[^a-z0-9]/g, "");
  while (start < end && CONNECTIVES.has(bare(words[start]!))) start += 1;
  while (end > start && CONNECTIVES.has(bare(words[end - 1]!))) end -= 1;
  return words.slice(start, end);
}

/**
 * Remove the product name (and any qualifier trailing it) from a phrase.
 * Returns the words that remain — the caller decides whether losing the brand
 * left enough behind to be worth it.
 */
export function stripBrand(text: string, logoSubject: string): string {
  const brandWords = tokenise(
    logoSubject.toLowerCase().replace(/[^\w\s.]/g, ""),
  ).filter(Boolean);
  while (brandWords.length > 1 && BRAND_QUALIFIERS.includes(brandWords[brandWords.length - 1]!)) brandWords.pop();
  if (brandWords.length === 0) return text;

  const words = tokenise(text);
  const bare = (w: string): string =>
    w.toLowerCase().replace(/[^a-z0-9.]/g, "");
  const out: string[] = [];
  for (let i = 0; i < words.length; ) {
    const window = words.slice(i, i + brandWords.length).map(bare);
    const matches =
      window.length === brandWords.length &&
      window.every((w, k) => w === brandWords[k]);
    if (!matches) {
      out.push(words[i]!);
      i += 1;
      continue;
    }
    /**
     * The preposition that INTRODUCED the brand goes with it. "Edit Videos In
     * DaVinci Resolve Fast" minus the brand alone is "Edit Videos In Fast" —
     * a dangling "In" mid-phrase, which the edge trim below cannot see.
     */
    const prev = out[out.length - 1];
    if (prev && CONNECTIVES.has(bare(prev))) out.pop();
    i += brandWords.length;
    // "QuickBooks Online" -> drop "Online" too; "Notion Dashboard" keeps it.
    if (i < words.length && BRAND_QUALIFIERS.includes(bare(words[i]!))) i += 1;
  }
  return stripEdgeConnectives(out).join(" ");
}

export interface CondenseOptions {
  /** Hard word ceiling from the format rule (TUTORIAL_STUDIO: 4). */
  maxWords: number;
  /**
   * The product whose logo will be rendered LARGE in the same frame. When set,
   * its name is removed from the headline — unless removing it would leave
   * fewer than two words, in which case the name is load-bearing and stays.
   */
  logoSubject?: string | null;
}

/**
 * Reduce any phrase — an LLM's answer or a raw video title — to thumbnail text.
 *
 * Deterministic and idempotent: condensing an already-condensed headline
 * returns it unchanged, so this is safe to apply to operator input as a
 * validation pass (it is not; operator text is honoured verbatim upstream).
 */
export function condenseHeadline(raw: string, opts: CondenseOptions): string {
  const ceiling = Math.max(1, opts.maxWords);
  let text = (raw ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/^["'“”‘’\s]+|["'“”‘’\s.!?:;,]+$/g, "")
    .trim();
  if (!text) return "";

  for (const lead of LEAD_PATTERNS) text = text.replace(lead, "");
  for (const phrase of FILLER_PHRASES) text = text.replace(phrase, " ");
  // Commas and colons split a title into clauses; the first clause is the one
  // that carries the subject ("QuickBooks Online, Get Paid Faster" is two).
  text = text
    .replace(/[,:;–—|]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  let words = tokenise(text).filter(
    (w) => !FILLER_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, "")),
  );
  words = stripEdgeConnectives(words);
  if (words.length === 0) return "";

  /**
   * The brand comes out only if the phrase survives it. This is the whole of
   * the "Notion SOPs is fine / Gusto next to the Gusto logo is not" rule, and
   * it is why the floor is two words rather than one: a lone noun beside a
   * giant logo reads as a caption for the logo, not as a promise.
   */
  const brand = opts.logoSubject?.trim();
  if (brand) {
    const withoutBrand = stripBrand(words.join(" "), brand);
    const remaining = tokenise(withoutBrand);
    if (remaining.length >= 2) words = remaining;
  }

  if (words.length > ceiling)
    words = stripEdgeConnectives(words.slice(0, ceiling));
  return words.join(" ");
}

/** Split compact copy without ever stranding &, +, and/or on their own line. */
export function compactHeadlineBlocks(
  raw: string,
  options: CondenseOptions & { blocks?: number },
): string[] {
  const condensed = tokenise(condenseHeadline(raw, options));
  // Connectors cost a visual beat and are the first thing to become a dangling
  // glyph when copy is split ("ACCESS CODES &" / "ID"). The two concrete
  // phrases already communicate their relationship.
  const withoutConnectors = condensed.filter((word) => !/^(?:&|\+|and|or)$/i.test(word));
  const words = withoutConnectors.length ? withoutConnectors : condensed;
  if (!words.length) return [];
  const count = Math.max(1, Math.min(options.blocks ?? 2, words.length));
  if (count === 1) return [words.join(" ")];
  const candidates: string[][] = [];
  const partition = (start: number, remaining: number, groups: string[]) => {
    if (remaining === 1) {
      candidates.push([...groups, words.slice(start).join(" ")]);
      return;
    }
    for (let end = start + 1; end <= words.length - remaining + 1; end += 1) {
      partition(end, remaining - 1, [...groups, words.slice(start, end).join(" ")]);
    }
  };
  partition(0, count, []);
  const score = (lines: string[]) => {
    const lengths = lines.map((line) => line.length);
    return Math.max(...lengths) * 1_000 + lengths.reduce((sum, length) => sum + length * length, 0);
  }
  return candidates.sort((a, b) => score(a) - score(b))[0] ?? [words.join(" ")];
}

/** Automatic procedural line policy. Short copy becomes one dominant,
 * shrink-wrapped banner; three or four words may balance across two hitboxes. */
export function proceduralHeadlineBlocks(
  raw: string,
  options: CondenseOptions,
): string[] {
  const condensed = compactHeadlineBlocks(raw, { ...options, blocks: 1 }).join(" ");
  const wordCount = tokenise(condensed).length;
  return compactHeadlineBlocks(condensed, {
    maxWords: options.maxWords,
    blocks: wordCount <= 2 ? 1 : 2,
    logoSubject: null,
  });
}

/**
 * The instruction block handed to the headline LLM.
 *
 * Kept here, next to the mechanical condenser that enforces it, because the two
 * are one policy: asking is how we get a GOOD headline, condensing is how we
 * guarantee a SHORT one. The codebase has been bitten before by asking a model
 * nicely and trusting the answer (`fix(tutorial): strip the em-dash pause
 * mechanically, since asking did not work`).
 */
export function headlineInstructions(args: {
  title: string;
  maxWords: number;
  logoSubject?: string | null;
  textPolicy?: string | null;
}): string {
  const brand = args.logoSubject?.trim();
  const ideal = Math.min(3, args.maxWords);
  return [
    "Write the TEXT PRINTED ON a YouTube tutorial thumbnail. This is not the video title and not a sentence.",
    `Video: "${args.title}"`,
    brand
      ? `A large, official ${brand} logo is already in the frame. Do NOT write "${brand}" as a label — the logo says it. Include the name only if the phrase collapses without it (e.g. "Notion SOPs").`
      : "",
    args.textPolicy ? `House style: ${args.textPolicy}` : "",
    "Rules:",
    `- ${ideal} words is the target. ${args.maxWords} is the hard maximum.`,
    "- Name the concrete thing being done or the outcome, in the words a beginner would use. A viewer must know what the video does from these words alone.",
    '- Never these: "finally", "made easy", "step by step", "explained", "guide", "tutorial", "painless", "the ultimate", "from scratch".',
    "- No punctuation, no quotes, no emoji, no year.",
    "Output only the words.",
  ]
    .filter(Boolean)
    .join("\n");
}
