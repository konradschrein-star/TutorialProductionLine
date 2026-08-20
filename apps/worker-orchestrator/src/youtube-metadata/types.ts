/**
 * YouTube Metadata Service — Shared Types
 *
 * Internal types for the youtube-metadata module. Not exported from the worker
 * package boundary — consumers import from ./index.ts only.
 */

export interface MetadataInput {
  script: string;
  topic: string;
  /** ContentFormat string value, e.g. "EXPLAINER" */
  format: string;
  /** BCP-47 language code, e.g. "en", "de" */
  language: string;
}

export interface YouTubeMetadata {
  /** ≤100 chars (DB constraint). Targeting ≤60 for search preview visibility. */
  title: string;
  /** Full description. Hook first line, body, CTA, hashtags at bottom only. */
  description: string;
  /** Clean tag terms, no # prefix. Stored in content_jobs.generated_tags. */
  tags: string[];
}

/** Word-level Whisper timestamp. Matches AssemblyManifest.word_timestamps shape. */
export interface WordTimestamp {
  word: string;
  /** Start time in seconds from audio start */
  start: number;
  /** End time in seconds from audio start */
  end: number;
}

/** A single YouTube chapter marker, ready for embedding in description. */
export interface YouTubeChapter {
  /** "M:SS" or "H:MM:SS" format, first chapter always "0:00" */
  timestamp: string;
  /** Short title for the chapter, ≤50 chars */
  title: string;
}

export interface OllamaConfig {
  url: string;
  model: string;
}

/**
 * A single entry in content_jobs.generation_log.
 *
 * Captures the full context of one AI generation call:
 * exact prompts sent, raw model output, timing, success/failure.
 * Stored verbatim — no summarization. Text storage is cheap.
 */
export interface GenerationLogEntry {
  /** Pipeline stage name: "script", "youtube_metadata", "tts", "scene_image", etc. */
  stage: string;
  started_at: string; // ISO 8601
  completed_at: string; // ISO 8601
  duration_ms: number;
  /** Model identifier, e.g. "claude-sonnet-4-6", "gemma3:4b", "eleven_multilingual_v2" */
  model: string;
  /** Full system prompt sent to the model (verbatim) */
  prompt_system?: string;
  /** Full user prompt sent to the model (verbatim) */
  prompt_user?: string;
  /** Raw model response, up to 10,000 chars */
  raw_output?: string;
  success: boolean;
  error?: string;
  /** Input tokens consumed (for LLM calls). Undefined for TTS/image calls. */
  input_tokens?: number;
  /** Output tokens consumed (for LLM calls). */
  output_tokens?: number;
}
