import Anthropic from "@anthropic-ai/sdk";

export interface Scene {
  scene_index: number;
  paragraph: string;
  image_prompt: string;
  start_frame: number;
  end_frame: number;
  duration_frames: number;
}

/**
 * Scene Decomposer Interface
 *
 * MVP: Simple paragraph-based splitting
 * Future: Full LLM-driven subscene breakdown with timing data
 */
export interface SceneDecomposer {
  decomposeScript(script: string, totalFrames: number): Promise<Scene[]>;
}

/**
 * MVP Scene Decomposer
 *
 * Splits script by paragraph, uses Claude to generate image prompt for each.
 * Divides frames evenly across scenes.
 */
export class SimpleSceneDecomposer implements SceneDecomposer {
  constructor(private anthropicClient: Anthropic) {}

  async decomposeScript(script: string, totalFrames: number): Promise<Scene[]> {
    // Split by paragraph
    const paragraphs = script.split("\n\n").filter(p => p.trim().length > 0);

    if (paragraphs.length === 0) {
      throw new Error("Script has no paragraphs");
    }

    // Divide frames evenly
    const framesPerScene = Math.floor(totalFrames / paragraphs.length);
    const scenes: Scene[] = [];

    for (let i = 0; i < paragraphs.length; i++) {
      const startFrame = i * framesPerScene;
      const endFrame = i === paragraphs.length - 1
        ? totalFrames
        : (i + 1) * framesPerScene;

      // Generate image prompt via Claude
      const imagePrompt = await this.generateImagePrompt(paragraphs[i]);

      scenes.push({
        scene_index: i,
        paragraph: paragraphs[i],
        image_prompt: imagePrompt,
        start_frame: startFrame,
        end_frame: endFrame,
        duration_frames: endFrame - startFrame,
      });
    }

    return scenes;
  }

  private async generateImagePrompt(paragraph: string): Promise<string> {
    const systemPrompt =
      "You are a visual director. Generate a single, vivid image generation prompt " +
      "for the given scene. The prompt should be 1-2 sentences, highly descriptive, " +
      "and optimized for AI image generation. Focus on visual elements, composition, " +
      "lighting, and mood.";

    const userPrompt =
      `Generate a visual description for this scene:\n\n"${paragraph}"\n\n` +
      `Output only the image generation prompt, nothing else.`;

    const response = await this.anthropicClient.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 200,
      temperature: 0.7,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type from Claude");
    }

    return content.text.trim();
  }
}

/**
 * Factory function to create scene decomposer
 *
 * Returns MVP version now, can be swapped for full LLM version in Phase 2.
 */
export function createSceneDecomposer(anthropicClient: Anthropic): SceneDecomposer {
  return new SimpleSceneDecomposer(anthropicClient);
}
