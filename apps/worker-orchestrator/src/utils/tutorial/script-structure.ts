/**
 * Script STRUCTURE — the part of a tutorial script that is not the words.
 *
 * WHY THIS EXISTS
 * `tutorial_jobs.script_text` is one flat text column. The only structured
 * intermediate the pipeline ever had was the LONG_FORM outline
 * (`{parts:[{title,summary}]}`), and generate.ts destroyed it immediately by
 * `parts.join("\n\n")`. Everything the owner wants next — subtopic banners,
 * YouTube chapters/timestamps, "highlight the important parts", per-section QA,
 * and AI-avatar segments at intro/CTA/outro/subtopic starts — is the same
 * missing feature: script structure carried through to the timeline. This module
 * preserves it.
 *
 * THE HARD CONSTRAINT
 * `script_text` is fed to TTS VERBATIM. So structure is stored ALONGSIDE the
 * prose, never inside it: `extractScriptStructure` returns marker-free text
 * (byte-identical to what the old code would have persisted, modulo the markers
 * themselves) plus character/word offsets into that text. Nothing downstream of
 * `script_text` changes. See EXTENSION-POINTS.md — "any markers must be excluded
 * from TTS input".
 *
 * WHAT IT DOES NOT DO
 * It does not insert anything into the video. `processors/tutorial/splice.ts`
 * time-scales the WHOLE screen recording by one factor (ttsDuration /
 * effectiveRecording) to match ONE continuous TTS track, so any segment spliced
 * into the middle would desynchronise every step after it. Offsets are recorded
 * so a future feature CAN do that work properly; this module deliberately stops
 * short of it.
 */

export type ScriptSectionKind = "intro" | "subtopic" | "outro" | "body";

export interface ScriptSection {
  kind: ScriptSectionKind;
  /** Plain-text section name (subtopics/chapters); null for intro/outro/body. */
  title: string | null;
  /** Inclusive character offset into the marker-free script text. */
  char_start: number;
  /** Exclusive character offset into the marker-free script text. */
  char_end: number;
  /** Inclusive 0-based word index into the marker-free script text. */
  word_start: number;
  /** Exclusive word index. */
  word_end: number;
  word_count: number;
}

export interface ScriptStructure {
  version: 1;
  /**
   * How the structure was recovered:
   *   "markers" — the writer emitted [[INTRO]] / [[SUBTOPIC: x]] / [[OUTRO]]
   *   "outline" — derived from the LONG_FORM chapter outline
   *   "none"    — no structure was recoverable; one whole-script section
   * Recorded honestly so a consumer can tell real structure from a degenerate
   * single section instead of assuming every script is structured.
   */
  source: "markers" | "outline" | "none";
  sections: ScriptSection[];
  total_words: number;
}

/**
 * Section markers the script prompt asks for. `SECTION` and `CHAPTER` are
 * accepted aliases of `SUBTOPIC` because models substitute them freely.
 */
const MARKER_RE =
  /\[\[[ \t]*(INTRO|OUTRO|SUBTOPIC|SECTION|CHAPTER|CTA)[ \t]*(?::[ \t]*([^\]]*?))?[ \t]*\]\]/gi;

/** Any leftover [[…]] token, so a mis-typed marker never reaches TTS. */
const STRAY_MARKER_RE = /\[\[[^\]\n]{0,80}\]\]/g;

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function kindOf(tag: string): ScriptSectionKind {
  const t = tag.toUpperCase();
  if (t === "INTRO") return "intro";
  if (t === "OUTRO" || t === "CTA") return "outro";
  return "subtopic";
}

interface RawSegment {
  kind: ScriptSectionKind;
  title: string | null;
  text: string;
}

/**
 * Split marker-annotated script text into (marker-free text, structure).
 *
 * Guarantees:
 *  - the returned text contains NO markers at all (including malformed ones),
 *    because it is what goes to TTS;
 *  - offsets index that returned text exactly;
 *  - a script with no markers is not an error — it yields one "body" section and
 *    `source: "none"`, so the caller can log that the writer ignored the format
 *    instead of pretending the script was structured.
 */
export function extractScriptStructure(input: string): {
  text: string;
  structure: ScriptStructure;
} {
  const segments: RawSegment[] = [];
  let cursor = 0;
  let pendingKind: ScriptSectionKind | null = null;
  let pendingTitle: string | null = null;

  MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER_RE.exec(input)) !== null) {
    const before = input.slice(cursor, match.index);
    if (before.trim()) {
      segments.push({
        kind: pendingKind ?? "body",
        title: pendingTitle,
        text: before.trim(),
      });
    }
    pendingKind = kindOf(match[1] ?? "");
    pendingTitle = match[2]?.trim() || null;
    cursor = match.index + match[0].length;
  }
  const tail = input.slice(cursor);
  if (tail.trim()) {
    segments.push({
      kind: pendingKind ?? "body",
      title: pendingTitle,
      text: tail.trim(),
    });
  }

  const hadMarkers = segments.some((s) => s.kind !== "body");

  // Leading prose before the first marker is the opening, not a mystery body.
  if (hadMarkers && segments[0]?.kind === "body") {
    segments[0].kind = "intro";
  }

  if (segments.length === 0) {
    return {
      text: "",
      structure: { version: 1, source: "none", sections: [], total_words: 0 },
    };
  }

  return assemble(
    segments.map((s) => ({ ...s, text: stripStrayMarkers(s.text) })),
    hadMarkers ? "markers" : "none",
  );
}

function stripStrayMarkers(text: string): string {
  STRAY_MARKER_RE.lastIndex = 0;
  if (!STRAY_MARKER_RE.test(text)) return text;
  return text
    .replace(STRAY_MARKER_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Join segments with a blank line and record exact offsets as we go. */
function assemble(
  segments: RawSegment[],
  source: ScriptStructure["source"],
): { text: string; structure: ScriptStructure } {
  const SEP = "\n\n";
  const sections: ScriptSection[] = [];
  let text = "";
  let words = 0;

  for (const seg of segments) {
    if (!seg.text) continue;
    if (text) text += SEP;
    const charStart = text.length;
    text += seg.text;
    const segWords = countWords(seg.text);
    sections.push({
      kind: seg.kind,
      title: seg.title,
      char_start: charStart,
      char_end: text.length,
      word_start: words,
      word_end: words + segWords,
      word_count: segWords,
    });
    words += segWords;
  }

  return {
    text,
    structure: { version: 1, source, sections, total_words: words },
  };
}

/**
 * Build the same structure from the LONG_FORM outline + its expanded chapters.
 *
 * This is the structure generate.ts used to throw away at `parts.join("\n\n")`.
 * The joined text is produced here in exactly the same way, so `script_text` is
 * unchanged and the TTS/child-part path is untouched — we simply also keep the
 * chapter titles and where each chapter starts.
 */
export function structureFromParts(
  parts: Array<{ title: string | null; text: string }>,
): { text: string; structure: ScriptStructure } {
  const segments: RawSegment[] = parts
    .map((p, i) => ({
      kind: (i === 0
        ? "intro"
        : i === parts.length - 1
          ? "outro"
          : "subtopic") as ScriptSectionKind,
      title: p.title?.trim() || null,
      text: p.text.trim(),
    }))
    .filter((s) => s.text);

  if (segments.length === 0) {
    return {
      text: "",
      structure: { version: 1, source: "none", sections: [], total_words: 0 },
    };
  }
  // A single chapter is the whole video: it is not an "intro".
  if (segments.length === 1 && segments[0]) segments[0].kind = "body";
  return assemble(segments, "outline");
}

/** Fraction of the script's words each section kind occupies (0–1). */
export function sectionShares(
  structure: ScriptStructure,
): Record<ScriptSectionKind, number> {
  const shares: Record<ScriptSectionKind, number> = {
    intro: 0,
    subtopic: 0,
    outro: 0,
    body: 0,
  };
  if (structure.total_words === 0) return shares;
  for (const s of structure.sections) {
    shares[s.kind] += s.word_count / structure.total_words;
  }
  return shares;
}
