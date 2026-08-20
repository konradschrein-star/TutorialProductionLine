import { describe, it, expect } from "vitest";
import {
  LLMProviderId,
  TTSProviderId,
  TUTORIAL_PROVIDERS,
} from "../../schemas/tutorial-provider.js";

describe("tutorial providers", () => {
  it("includes the v1 LLM providers and defaults", () => {
    expect(LLMProviderId.safeParse("gemini_pool").success).toBe(true);
    expect(LLMProviderId.safeParse("openai").success).toBe(true);
    expect(LLMProviderId.safeParse("qwen_hosted").success).toBe(true);
  });
  it("includes the v1 TTS providers", () => {
    expect(TTSProviderId.safeParse("ai33_elevenlabs").success).toBe(true);
    expect(TTSProviderId.safeParse("google_tts").success).toBe(true);
  });
  it("flags AI33 providers as potentially unreliable and marks coming-soon", () => {
    const ai33 = TUTORIAL_PROVIDERS.tts.find((p) => p.id === "ai33_elevenlabs");
    expect(ai33?.unreliable).toBe(true);
    const qwenLocal = TUTORIAL_PROVIDERS.llm.find((p) => p.id === "qwen_local");
    expect(qwenLocal?.comingSoon).toBe(true);
  });
});
