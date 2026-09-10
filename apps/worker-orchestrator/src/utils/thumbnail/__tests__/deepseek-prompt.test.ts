import { describe, it, expect, vi } from "vitest";

vi.mock("../../llm-client.js", () => ({
  requestLLMText: vi.fn(
    async () => "A cinematic thumbnail prompt describing the scene.",
  ),
}));

import { authorThumbnailPrompt } from "../deepseek-prompt.js";
import { requestLLMText } from "../../llm-client.js";

describe("authorThumbnailPrompt", () => {
  it("passes channel/title/excerpt into the LLM and returns its text", async () => {
    const result = await authorThumbnailPrompt({
      format: "TUTORIAL_STUDIO",
      title: "Docker in 5 minutes",
      topic: "Docker basics",
      scriptExcerpt: "Docker packages your app. It runs anywhere.",
      personaDescription: null,
      extraNotes: null,
    });
    expect(result).toContain("cinematic thumbnail prompt");
    const [prompt] = (requestLLMText as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(prompt).toContain("Docker in 5 minutes");
    expect(prompt).toContain("Docker packages your app");
    expect(prompt).toContain("readable at 320x180");
    expect(prompt).not.toContain("Text must be black");
  });
});
