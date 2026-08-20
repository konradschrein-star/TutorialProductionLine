import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "@repo/config";
import { callLLM } from "./llm-client.js";

export function createAnthropicClient(config: Env): Anthropic {
  return new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
}

export interface GenerateScriptResult {
  script: string;
  input_tokens: number;
  output_tokens: number;
  provider?: "gemini-pool";
}

export async function generateScript(
  _client: Anthropic,
  prompt: string,
  topic: string,
  scriptFormat?: string,
): Promise<GenerateScriptResult> {
  if (!prompt.trim()) throw new Error("Script prompt cannot be empty");

  const filledPrompt = topic ? prompt.replaceAll("${topic}", topic) : prompt;

  const text = await callLLM(filledPrompt, { maxTokens: 8000, scriptFormat });

  return {
    script: text.trim(),
    input_tokens: 0,
    output_tokens: 0,
  };
}

export async function generateScriptWithGemini(
  prompt: string,
  _geminiApiKey: string,
): Promise<GenerateScriptResult> {
  const text = await callLLM(prompt, { maxTokens: 8000 });
  return {
    script: text.trim(),
    input_tokens: 0,
    output_tokens: 0,
  };
}
