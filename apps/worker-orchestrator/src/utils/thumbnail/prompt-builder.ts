const MAX_PROMPT_CHARS = 5000;

export interface ProgrammaticPromptInput {
  headline: string; // the thumbnail's main text (job title in v1)
  topic: string; // the video topic
  layoutInstructions: string | null;
  basePrompt: string | null;
  personaDescription: string | null;
  featuresLogo: boolean;
  logoSubject: string | null;
  extraNotes: string | null;
}

function sanitize(text: string, maxLength: number): string {
  return (text ?? "")
    .trim()
    .slice(0, maxLength)
    .replace(/[\r\n]+/g, " ");
}

/** Ported from Thumbnail Creator V2 `buildFullPrompt`, with archetype config injected. */
export function buildProgrammaticPrompt(
  input: ProgrammaticPromptInput,
): string {
  const headline = sanitize(input.headline, 80);
  const topic = sanitize(input.topic, 150);

  let prompt = `Create a YouTube thumbnail matching the reference image's visual style, layout, and composition.

Replace ONLY the main text in the reference thumbnail with "${headline}". Adjust everything else (logos, secondary text,...) to match the new topic: "${topic}". Completely disregard and replace the unrelated topic from the reference thumbnail.`;

  if (input.personaDescription) {
    prompt += `\nReplace any character in the reference image with this: ${sanitize(
      input.personaDescription,
      1500,
    )}. Match their pose and position.`;
  }

  if (input.featuresLogo && input.logoSubject?.trim()) {
    const subject = sanitize(input.logoSubject, 80);
    prompt += `\nReplace any software logo or branding in the reference image with ${subject}'s official logo, colors, and branding. Make it clearly recognizable as ${subject}.`;
  }

  if (input.layoutInstructions?.trim()) {
    prompt += `\nLayout guidance: ${sanitize(input.layoutInstructions, 600)}`;
  }
  if (input.basePrompt?.trim()) {
    prompt += `\nStyle notes: ${sanitize(input.basePrompt, 600)}`;
  }
  if (input.extraNotes?.trim()) {
    prompt += `\nChannel notes: ${sanitize(input.extraNotes, 400)}`;
  }

  prompt += `

If there are style instructions in the reference image, follow them and don't keep them.

Style: Ensure an extremely premium, high-end visual aesthetic. It should look highly curated, flawless, and exclusive.

Match the reference image's composition, lighting, color scheme (topic adjusted), and visual energy. Use vibrant colors and high contrast.
Text must be black for contrast and have no mistakes. Only one person on the Thumbnail.`;

  return prompt.trim().slice(0, MAX_PROMPT_CHARS);
}

/** Ported iterate prompt: use the (bad) thumbnail as reference, apply only changes. */
export function buildIteratePrompt(instructions: string): string {
  return `Use the reference image as the base and apply ONLY the requested changes. Keep everything else the same.

ITERATION REQUEST: ${sanitize(instructions, 1000)}`.trim();
}

/** Localizes an existing thumbnail for a new language/market, translating text while keeping it a unique piece. */
export function buildLocalizePrompt(language: string, market?: string): string {
  const aud = market?.trim() ? ` (${sanitize(market, 60)} audience)` : "";
  return `Recreate this thumbnail localized for ${sanitize(language, 40)}${aud}. Translate all visible text to ${sanitize(language, 40)}. Change the colors and layout slightly so it becomes its own unique piece (not a copy), adapted to the topic and the target-language market's audience. Keep the same subject and premium quality.`;
}

/** First N sentence chunks (split on ". " / "! " / "? "), trimmed. */
export function firstNSentences(script: string, n: number): string {
  const parts = script.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (!parts) return script.trim();
  return parts
    .slice(0, n)
    .map((s) => s.trim())
    .join(" ")
    .trim();
}
