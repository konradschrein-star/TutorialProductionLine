/**
 * YouTube Metadata Service
 *
 * Isolated module for generating and enriching YouTube video metadata.
 *
 * Phase 1 (now):
 *   generateMetadata() — script → humanized title, description, tags via local Gemma.
 *   Returns both the result and a GenerationLogEntry with full prompt/output/timing
 *   context for storage in content_jobs.generation_log.
 *
 * Phase 2 (ready, not yet wired):
 *   buildChapters() — word-level Whisper transcript + scenes → YouTube chapter markers.
 *   formatChaptersForDescription() — formats chapters for embedding in description.
 *   Activation: wire into render worker after word_timestamps are persisted in
 *   assembly_manifest (already happens for V2 renders).
 *
 * Public API — import from here, not from sub-modules.
 */

export type {
  MetadataInput,
  YouTubeMetadata,
  WordTimestamp,
  YouTubeChapter,
  OllamaConfig,
  GenerationLogEntry,
} from "./types.js";

export { buildChapters, formatChaptersForDescription } from "./chapter-builder.js";

import { buildMetadataPrompt } from "./prompt-builder.js";
import { callOllama } from "./ollama.js";
import { parseMetadataResponse } from "./parser.js";
import type { MetadataInput, YouTubeMetadata, OllamaConfig, GenerationLogEntry } from "./types.js";

export interface GenerateMetadataResult {
  /** null if Gemma failed or returned unparseable output */
  metadata: YouTubeMetadata | null;
  /** Always populated — stored in generation_log regardless of success */
  logEntry: GenerationLogEntry;
}

/**
 * Generate humanized YouTube metadata from a finished script.
 *
 * Calls the local Gemma model via Ollama. Never throws — returns null metadata
 * on failure so the pipeline continues. The logEntry is always populated with
 * the full prompt, raw output, and error (if any) for debugging.
 *
 * Intended to run in parallel with ASSET_COLLECTION (dispatched to queue-ai-generation
 * as generation_type "youtube_metadata"). Completes in ~5s, well before pre-upload QMS.
 */
export async function generateMetadata(
  input: MetadataInput,
  config: OllamaConfig,
): Promise<GenerateMetadataResult> {
  const startedAt = new Date();
  const { system, user } = buildMetadataPrompt(input);

  let rawOutput = "";
  let metadata: YouTubeMetadata | null = null;
  let error: string | undefined;

  try {
    rawOutput = await callOllama(
      config,
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    );

    metadata = parseMetadataResponse(rawOutput);

    if (!metadata) {
      error = `Parser rejected response — likely malformed JSON or missing fields. Raw (first 300 chars): ${rawOutput.slice(0, 300)}`;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const completedAt = new Date();

  const logEntry: GenerationLogEntry = {
    stage: "youtube_metadata",
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: completedAt.getTime() - startedAt.getTime(),
    model: config.model,
    prompt_system: system,
    prompt_user: user,
    // Store full raw output up to 10k chars — never summarize, text is cheap
    raw_output: rawOutput.slice(0, 10_000),
    success: metadata !== null,
    error,
  };

  return { metadata, logEntry };
}
