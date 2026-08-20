/**
 * Strip formatting artefacts from a generated script before it reaches TTS.
 *
 * WHY: script_text is spoken verbatim. Any markdown that survives is read out
 * or mangled by the voice provider, so `click **Automations**` becomes audible
 * junk in the middle of a recorded tutorial. Production already carried this at
 * a low rate before the 2026-07-30 prompt work — 22 of 2260 scripts contained
 * bold, e.g. job f59d3ec3: "click **Automations** in the left sidebar" — and
 * asking the writer for exact button and menu names (which the walkthrough rules
 * now do) makes a model reach for bold far more often.
 *
 * The prompt forbids markdown; this is the defence-in-depth layer behind it. It
 * only ever REMOVES formatting characters — it never rewrites, invents, shortens
 * or paraphrases the spoken words, so it cannot mask a bad script the way a
 * synthetic fallback would. Callers log what it stripped so the prompt-side
 * problem stays visible instead of being silently papered over.
 */

/** What `sanitizeScriptText` changed, so the caller can log it. */
export interface SanitizeReport {
  /** Formatting markers removed, e.g. ["bold", "heading"]. */
  removed: string[];
  /** True when anything at all was stripped. */
  changed: boolean;
}

export interface SanitizeResult {
  text: string;
  report: SanitizeReport;
}

/**
 * Emphasis spans deliberately require a non-space character immediately inside
 * the markers. That is what keeps code syntax intact: in "using /* and *​/ to
 * remind me", the opening `*` is followed by a space, so it is left alone.
 */
const RULES: Array<{ name: string; re: RegExp; to: string }> = [
  // Bold/italic combinations, longest markers first.
  { name: "bold-italic", re: /\*\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*\*/g, to: "$1" },
  { name: "bold", re: /\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/g, to: "$1" },
  { name: "bold", re: /__(?!\s)([^_\n]+?)(?<!\s)__/g, to: "$1" },
  { name: "italic", re: /\*(?!\s)([^*\n]+?)(?<!\s)\*/g, to: "$1" },
  // Inline code / code fences — backticks are never spoken.
  { name: "code-fence", re: /^[ \t]*```[^\n]*$/gm, to: "" },
  { name: "inline-code", re: /`([^`\n]+)`/g, to: "$1" },
  // Markdown links: keep the label, drop the URL.
  { name: "link", re: /\[([^\]\n]+)\]\((?:[^)\n]*)\)/g, to: "$1" },
  // Leading ATX heading markers.
  { name: "heading", re: /^[ \t]*#{1,6}[ \t]+/gm, to: "" },
  // Leading list bullets (never "- " mid-sentence, only at line start).
  { name: "bullet", re: /^[ \t]*[-*•][ \t]+/gm, to: "" },
  // Em/en dash used as a dramatic pause. The single most reliable AI tell in
  // this pipeline, and the one instruction the model would not follow.
  //
  // The prompt bans it explicitly. A script generated immediately after that
  // ban shipped with SEVEN of them ("Tracking mileage in Expensify[dash]here is
  // exactly how it works"). Asking did not work, so this stops asking.
  //
  // A comma rather than a period: it can never split a sentence into a
  // fragment, and it is what the pause was standing in for. It is also better
  // for TTS, which reads a dash inconsistently and sometimes not at all.
  //
  // Matches U+2014/U+2013 only, so hyphens in "twenty-five" survive.
  { name: "dash-pause", re: /\s*[—–]\s*/g, to: ", " },
];

/**
 * Remove markdown/formatting artefacts from spoken script text.
 * Returns the cleaned text plus a report of what was stripped.
 */
export function sanitizeScriptText(input: string): SanitizeResult {
  const removed = new Set<string>();
  let text = input;

  for (const { name, re, to } of RULES) {
    // Reset lastIndex: these are module-level /g regexes reused across calls.
    re.lastIndex = 0;
    if (!re.test(text)) continue;
    re.lastIndex = 0;
    text = text.replace(re, to);
    removed.add(name);
  }

  // Collapse any blank lines a stripped fence/heading left behind, and trim
  // trailing spaces the bullet rule can expose. Never touch paragraph breaks.
  if (removed.size > 0) {
    text = text
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return {
    text,
    report: { removed: [...removed], changed: removed.size > 0 },
  };
}
