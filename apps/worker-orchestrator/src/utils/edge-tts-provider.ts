/**
 * Edge TTS Provider Implementation
 *
 * Free TTS provider using Microsoft Edge backend via OpenAI-compatible API.
 * Suitable for testing/development, not production use.
 *
 * API: https://github.com/travisvn/openai-edge-tts
 */

import type { TTSProvider } from "./tts-provider.js";

export class EdgeTTSProvider implements TTSProvider {
  name = "EdgeTTS";

  constructor(
    private apiUrl: string,
    private apiKey: string,
    private options: {
      speed?: number;
      responseFormat?: string;
    } = {},
  ) {}

  async generateChunk(text: string, voiceId: string): Promise<Buffer> {
    const speed = this.options.speed ?? 1.0;
    const responseFormat = this.options.responseFormat ?? "wav";

    const response = await fetch(`${this.apiUrl}/v1/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: text,
        voice: voiceId,
        response_format: responseFormat,
        speed: speed,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Edge TTS API request failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
