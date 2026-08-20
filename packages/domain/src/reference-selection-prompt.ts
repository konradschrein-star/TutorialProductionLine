/**
 * Reference Selection Prompt Builder
 *
 * Builds prompts for Claude to intelligently select style references and narrator poses
 * for each scene based on context.
 *
 * **Design:**
 * - Pure function - no IO, no side effects
 * - Takes scene text, layout type, and available references
 * - Returns prompt string for Claude API call
 * - Expected response: JSON with selected filenames + reasoning
 */

export interface StyleRefOption {
  file_name: string;
  ref_type: string; // "logo", "typography", "color_palette", "scene_example"
  description?: string;
}

export interface NarratorPoseOption {
  file_name: string;
  pose_name: string; // "pointing_left", "neutral", "excited", "explaining", etc.
  description?: string;
}

export interface ReferenceSelectionInput {
  sceneText: string;
  layoutType: "FILLED" | "UNFILLED" | "STACK_FILLED" | "AVATAR_FULLSCREEN";
  styleRefs: StyleRefOption[];
  narratorPoses: NarratorPoseOption[];
}

export interface ReferenceSelectionResponse {
  selected_style_ref: string | null; // filename or null
  selected_narrator_pose: string | null; // filename or null
  reasoning: string;
}

/**
 * Build reference selection prompt for Claude
 *
 * @param input Scene context and available references
 * @returns Prompt string for Claude API call
 */
export function buildReferenceSelectionPrompt(
  input: ReferenceSelectionInput
): string {
  const { sceneText, layoutType, styleRefs, narratorPoses } = input;

  // Build style references list
  const styleRefsList =
    styleRefs.length > 0
      ? styleRefs
          .map(
            (ref) =>
              `- ${ref.file_name}: ${ref.ref_type}${ref.description ? ` — ${ref.description}` : ""}`
          )
          .join("\n")
      : "(No style references available)";

  // Build narrator poses list
  const narratorPosesList =
    narratorPoses.length > 0
      ? narratorPoses
          .map(
            (pose) =>
              `- ${pose.file_name}: ${pose.pose_name}${pose.description ? ` — ${pose.description}` : ""}`
          )
          .join("\n")
      : "(No narrator poses available)";

  // Layout context hints
  const layoutHints: Record<typeof layoutType, string> = {
    FILLED:
      "Single full-frame image with narrator overlay possible. Narrator should integrate naturally into scene.",
    UNFILLED:
      "B-roll image only, no narrator overlay. Select style reference based purely on scene content.",
    STACK_FILLED:
      "Multiple sub-images for mini-animation sequence. Select cohesive style for visual continuity.",
    AVATAR_FULLSCREEN:
      "Full-screen avatar video, no background image. Narrator pose is critical; style reference not applicable.",
  };

  const prompt = `You are selecting reference images for AI image generation to ensure visual consistency.

**Scene Content:**
"${sceneText}"

**Layout Type:** ${layoutType}
${layoutHints[layoutType]}

**Available Style References:**
${styleRefsList}

**Available Narrator Poses:**
${narratorPosesList}

**Selection Rules:**
1. **Style Reference:** Select ONE style reference that best matches the scene's visual requirements. Consider:
   - Scene content (tech/corporate/casual/etc.)
   - Visual theme (minimalist/detailed/colorful/etc.)
   - Ref type appropriateness (logo for branding, scene_example for composition)
   - If no good match, return null

2. **Narrator Pose:** Select ONE narrator pose (or NONE) based on:
   - Does the scene benefit from narrator presence?
   - Which pose matches the scene action/emotion?
   - Narrator should appear in MOST scenes, but not all
   - If scene is purely visual (landscape, abstract concept), skip narrator
   - If no good match or narrator not needed, return null

3. **Reasoning:** Explain your selection briefly (1-2 sentences)

**Response Format (JSON only, no markdown):**
{
  "selected_style_ref": "${styleRefs[0]?.file_name || "null"}",
  "selected_narrator_pose": "${narratorPoses[0]?.file_name || "null"}",
  "reasoning": "Scene involves X, so Y style fits. Narrator in Z pose because..."
}

Return ONLY valid JSON. No markdown, no code blocks, no extra text.`;

  return prompt;
}

/**
 * Parse Claude's response into structured format
 *
 * @param response Raw text response from Claude
 * @returns Parsed selection or error
 */
export function parseReferenceSelectionResponse(
  response: string
): ReferenceSelectionResponse | { error: string } {
  try {
    // Strip markdown code blocks if present
    let cleaned = response.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.replace(/^```json\n?/, "").replace(/\n?```$/, "");
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(cleaned) as ReferenceSelectionResponse;

    // Validate structure
    if (
      typeof parsed !== "object" ||
      !("selected_style_ref" in parsed) ||
      !("selected_narrator_pose" in parsed) ||
      !("reasoning" in parsed)
    ) {
      return { error: "Invalid response structure" };
    }

    // Normalize null strings to actual null
    if (parsed.selected_style_ref === "null") {
      parsed.selected_style_ref = null;
    }
    if (parsed.selected_narrator_pose === "null") {
      parsed.selected_narrator_pose = null;
    }

    return parsed;
  } catch (err) {
    return {
      error: `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
