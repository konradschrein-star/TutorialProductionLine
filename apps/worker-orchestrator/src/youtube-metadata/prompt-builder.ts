/**
 * YouTube Metadata Prompt Builder
 *
 * Pure function — no IO, no side effects.
 * Builds the system + user prompt pair sent to Gemma for metadata generation.
 *
 * Humanization strategy:
 * The prompt explicitly names the AI tells to avoid so Gemma learns by contrast,
 * not just by vague instruction. Format-specific tone guidance is injected so a
 * political commentary channel sounds different from an explainer channel.
 */

import type { MetadataInput } from "./types.js";

/** Maps content format to tone guidance injected into the system prompt. */
const FORMAT_TONE: Record<string, string> = {
  EXPLAINER:
    "Tone is curious and educational. Titles pose an interesting question or state a surprising fact. Avoid jargon.",
  DOCUMENTARY:
    "Tone is serious and cinematic. Titles are evocative, not clickbait. Read like a film title, not a blog post.",
  TECH_COMPARISON:
    "Tone is practical and decisive. Titles tell the reader which wins or what they need to know. Numbers help.",
  VIDEO_ESSAY:
    "Tone is thoughtful and analytical. Titles are specific claims or reframings of a familiar topic.",
  CASUALLY_EXPLAINED:
    "Tone is dry, self-aware, slightly absurdist. Titles are often deadpan or understate the content.",
};

const SCRIPT_EXCERPT_CHARS = 3_500;

export function buildMetadataPrompt(input: MetadataInput): {
  system: string;
  user: string;
} {
  const toneLine =
    FORMAT_TONE[input.format] ?? "Tone matches the content naturally.";
  const langLine =
    input.language !== "en"
      ? `\nOutput language: ${input.language}. Title, description, and tags must all be in this language.`
      : "";

  const system = `You are a senior YouTube channel editor with 10 years of experience. You write metadata that gets videos discovered and clicked. Your work is indistinguishable from a skilled human creator.

${toneLine}${langLine}

TITLE RULES:
- Maximum 60 characters (YouTube truncates here in search results)
- Hard maximum 100 characters (database constraint — never exceed this)
- Specific and direct — no vague claims like "Everything You Need to Know"
- No em-dashes (—), no colons splitting "Topic: Subtopic"
- No "In this video", "Watch as", "See how", "Join us"
- No ALL CAPS words
- No excessive punctuation (!!!, ???)
- A real person typed this title — it reads that way

DESCRIPTION RULES:
- Line 1: one punchy hook sentence (YouTube shows this in search previews — make it count)
- Lines 2–4: 2–3 sentences of context explaining what the video covers
- Final line: one short, natural call to action (not "Don't forget to like and subscribe")
- 3–5 hashtags at the very bottom, on their own line, prefixed with #
- No bullet points, no bold/italic markdown, no numbered lists
- No timestamps or chapters
- No "In this video we will explore", "Today I'll show you", "Welcome to"
- The description sounds like it was written by the person who made the video

TAGS RULES (stored separately from description hashtags):
- 10–15 terms total
- Mix: broad single-word topics + specific 2–4 word phrases from the content
- Plain text only — no # prefix (these are stored as clean strings)
- Lowercase unless a proper noun (country, person, brand)

Respond ONLY with valid JSON — no markdown fences, no explanation:
{"title": "...", "description": "...", "tags": ["..."]}`;

  const scriptExcerpt = input.script.slice(0, SCRIPT_EXCERPT_CHARS);
  const truncated = input.script.length > SCRIPT_EXCERPT_CHARS;

  const user = `Topic: ${input.topic}

Script:
${scriptExcerpt}${truncated ? "\n[...script continues...]" : ""}

Write the YouTube metadata for this video.`;

  return { system, user };
}
