import { EdgeTTSProvider } from "./edge-tts-provider.js";

/**
 * TTS Provider Interface
 *
 * Abstraction for text-to-speech generation.
 * Enables swapping between AI33, ElevenLabs, Minimax, etc.
 */
export interface TTSProvider {
  name: string;
  generateChunk(text: string, voiceId: string): Promise<Buffer>;
}

/**
 * AI33 TTS Provider Implementation
 */
export class AI33TTSProvider implements TTSProvider {
  name = "AI33";

  constructor(private apiKey: string) {}

  async generateChunk(text: string, voiceId: string): Promise<Buffer> {
    // Reuse existing AI33 client
    const { generateTTS } = await import("./ai33-client.js");
    return generateTTS(this.apiKey, voiceId, text);
  }
}

/**
 * Minimax TTS Provider Implementation
 */
export class MinimaxTTSProvider implements TTSProvider {
  name = "Minimax";

  constructor(
    private apiKey: string,
    private options: {
      model?: string;
      speed?: number;
      pitch?: number;
      volume?: number;
      languageBoost?: string;
    } = {},
  ) {}

  async generateChunk(text: string, voiceId: string): Promise<Buffer> {
    const { generateMinimaxTTS } = await import("./minimax-client.js");
    return generateMinimaxTTS(this.apiKey, voiceId, text, this.options);
  }
}

/**
 * ElevenLabs via AI33 TTS Provider Implementation
 *
 * Routes ElevenLabs TTS requests through the AI33 gateway.
 * Voice IDs are ElevenLabs-specific (e.g., "3jR9BuQAOPMWUjWpi0ll").
 */
export class ElevenLabsAI33TTSProvider implements TTSProvider {
  name = "ElevenLabs";

  constructor(
    private apiKey: string,
    private options: { modelId?: string } = {},
  ) {}

  async generateChunk(text: string, voiceId: string): Promise<Buffer> {
    const { generateTTSElevenLabs } = await import("./ai33-client.js");
    return generateTTSElevenLabs(
      this.apiKey,
      voiceId,
      text,
      this.options.modelId,
    );
  }
}

/**
 * Factory function to get TTS provider based on config
 */
export function createTTSProvider(
  apiKey: string,
  provider: string = "AI33",
  options?: {
    model?: string;
    speed?: number;
    pitch?: number;
    volume?: number;
    languageBoost?: string;
    apiUrl?: string; // For EdgeTTS
    responseFormat?: string; // For EdgeTTS
  },
): TTSProvider {
  switch (provider) {
    case "AI33":
      return new AI33TTSProvider(apiKey);
    case "Minimax":
      return new MinimaxTTSProvider(apiKey, options);
    case "ElevenLabs":
    case "ELEVENLABS":
      return new ElevenLabsAI33TTSProvider(apiKey, {
        modelId: options?.model,
      });
    case "EdgeTTS":
    case "EDGE_TTS": {
      if (!options?.apiUrl) {
        throw new Error("EdgeTTS provider requires apiUrl in options");
      }
      return new EdgeTTSProvider(options.apiUrl, apiKey, {
        speed: options.speed,
        responseFormat: options.responseFormat,
      });
    }
    default:
      throw new Error(`Unknown TTS provider: ${provider}`);
  }
}
