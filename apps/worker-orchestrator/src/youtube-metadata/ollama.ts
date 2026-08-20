/**
 * Ollama Client — YouTube Metadata Service
 *
 * Thin IO wrapper around the Ollama /api/chat endpoint.
 * Single responsibility: make the HTTP call and return the raw content string.
 * All parsing and validation happens in parser.ts.
 */

import type { OllamaConfig } from "./types.js";

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Call Ollama /api/chat and return the raw response content string.
 *
 * @throws {Error} On HTTP error, Ollama-reported error, or timeout
 */
export async function callOllama(
  config: OllamaConfig,
  messages: OllamaMessage[],
  timeoutMs = 30_000,
): Promise<string> {
  const response = await fetch(`${config.url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      format: "json",
      options: {
        temperature: 0.4,
        num_predict: 1_024,
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`Ollama HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const body = (await response.json()) as {
    message?: { content?: string };
    error?: string;
  };

  if (body.error) {
    throw new Error(`Ollama error: ${body.error}`);
  }

  return body.message?.content ?? "";
}
