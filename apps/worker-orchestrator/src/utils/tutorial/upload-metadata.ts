import { generateScript } from "./llm-registry.js";

/**
 * Generate the YouTube description and tags for a tutorial.
 *
 * ## Why this exists
 *
 * `content_jobs` has had `description` and `generated_tags` since forever, fed
 * by `youtube-metadata/`. That generator is wired exclusively to content jobs,
 * so tutorials had neither column and neither value. A VA opening a finished
 * tutorial's Drive folder got the video, the raw recording, a transcript — and
 * a LOWERCASE SLUG as the only title. "Open Drive and upload" was therefore not
 * an achievable instruction.
 *
 * ## Why it returns nulls instead of throwing
 *
 * This runs on the script stage, which is the expensive one. A tutorial with a
 * good script and no description is still a useful tutorial — the upload sheet
 * prints "(NOT GENERATED)" and the VA regenerates from the app. A tutorial that
 * FAILED because its description call 429'd is a wasted script. So a failure
 * here degrades the metadata, never the video.
 *
 * ## Why it never fabricates
 *
 * If the model returns something unparseable we return nulls. We do NOT fall
 * back to "a tutorial about {title}" or to tags split from the title. A
 * plausible-looking description that nobody wrote gets published under the
 * owner's channel; a visible blank costs thirty seconds and is obviously a gap.
 */

export interface TutorialUploadMetadata {
  description: string | null;
  tags: string[] | null;
}

export interface GenerateUploadMetadataParams {
  title: string;
  scriptText: string;
  provider: string;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  language?: string | null;
}

/** Tags YouTube will accept: non-empty, <=30 chars, deduped, max 15. */
function normaliseTags(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const tag = entry.trim().replace(/^#/, "");
    if (tag === "" || tag.length > 30) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 15) break;
  }
  return out.length > 0 ? out : null;
}

/**
 * Pull the JSON object out of a model response. Models wrap JSON in prose and
 * fenced code blocks regardless of instructions, so we take the outermost
 * braces rather than trusting the whole string to parse.
 */
export function parseUploadMetadataResponse(
  raw: string,
): TutorialUploadMetadata {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return { description: null, tags: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { description: null, tags: null };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { description: null, tags: null };
  }
  const obj = parsed as Record<string, unknown>;
  const description =
    typeof obj["description"] === "string" && obj["description"].trim() !== ""
      ? obj["description"].trim()
      : null;
  return { description, tags: normaliseTags(obj["tags"]) };
}

export function buildUploadMetadataPrompt(
  title: string,
  scriptText: string,
  language: string | null | undefined,
): string {
  // The script can be an hour long; the opening carries the topic and promise,
  // which is all the description needs. Sending the whole thing would burn
  // tokens for no gain and risks the reasoning-token truncation documented in
  // llm-registry.ts.
  const excerpt = scriptText.slice(0, 4000);
  const lang = language && language !== "en" ? language : "English";

  return [
    "You write YouTube metadata for a screen-recorded software tutorial.",
    "",
    `Video title: ${title}`,
    "",
    "Script (may be truncated):",
    '"""',
    excerpt,
    '"""',
    "",
    `Write the description and tags in ${lang}.`,
    "",
    "DESCRIPTION rules:",
    "- 3 to 5 short paragraphs, plain text, no markdown, no emoji spam.",
    "- Open with one sentence saying exactly what the viewer will be able to do",
    "  after watching. No 'In this video we will'.",
    "- Then a short bulleted list (use '- ') of the concrete steps covered.",
    "- Close with one line inviting a comment if they get stuck.",
    "- Never invent features, prices, links or timestamps that are not in the",
    "  script. If you are unsure of a detail, leave it out.",
    "",
    "TAGS rules:",
    "- 8 to 15 tags, lowercase, each under 30 characters.",
    "- Real search phrases a person would type, not hashtags.",
    "",
    "Return ONLY a JSON object, no prose around it:",
    '{"description": "...", "tags": ["...", "..."]}',
  ].join("\n");
}

export async function generateTutorialUploadMetadata(
  params: GenerateUploadMetadataParams,
): Promise<TutorialUploadMetadata> {
  const { title, scriptText, provider, apiKey, model, timeoutMs, language } =
    params;

  if (!title.trim() || !scriptText.trim()) {
    return { description: null, tags: null };
  }

  try {
    const raw = await generateScript({
      provider,
      apiKey,
      prompt: buildUploadMetadataPrompt(title, scriptText, language),
      ...(model !== undefined ? { model } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      maxTokens: 2000,
    });
    const result = parseUploadMetadataResponse(raw);
    if (result.description === null && result.tags === null) {
      console.warn(
        JSON.stringify({
          level: "warn",
          message:
            "tutorial upload metadata unparseable — leaving description/tags null rather than inventing them",
          title,
          provider,
        }),
      );
    }
    return result;
  } catch (err) {
    // Deliberately non-fatal: a good script with no description still ships.
    console.warn(
      JSON.stringify({
        level: "warn",
        message:
          "tutorial upload metadata generation failed — script is unaffected",
        title,
        provider,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { description: null, tags: null };
  }
}
