import { requestLLMText } from "../llm-client.js";

export interface DeepSeekPromptInput {
  format: string;
  title: string;
  topic: string;
  scriptExcerpt: string;
  personaDescription: string | null;
  /** True when the host's photo is attached as the SECOND i2i reference. */
  personaImageAttached?: boolean;
  extraNotes: string | null;
  /**
   * Hard ceiling for the authored prompt. Every backend that can serve a
   * referenced image request REFUSES prompts above 2000 characters, so the
   * author has to be told the limit — an over-long prompt is not a worse
   * thumbnail, it is no thumbnail.
   */
  maxChars?: number;
}

const SYSTEM_RULES = `You write a single image-generation prompt for a YouTube thumbnail that will be produced image-to-image from a reference thumbnail. Rules:
- Copy the reference's style, layout, and composition; NEVER copy its original topic or text.
- Replace the main text with the video's headline and adapt all content to the new topic.
- The prompt MUST demand that every word of the headline is FULLY VISIBLE, inside the frame, with clear margin on all four edges, and that no letter is cropped by the image border. Image models routinely run headline text off the left edge: a real thumbnail shipped reading "NEVER MISS / NLY A TASK" because the leading O of ONLY was cut off. Half a word is worse than no word — it reads as a broken image and costs the click outright.
- Keep the headline SHORT. Fewer words render legibly at the 168x94 a phone actually shows, and short text is far less likely to be cropped or garbled.
- Aim for a high-CTR, premium, high-contrast, vibrant 16:9 thumbnail.
- ALWAYS write the human subject in the SINGULAR. Your prompt must state that EXACTLY ONE person appears in the image and must forbid a second person, a second face anywhere in the frame, and extra hands or arms. Plural phrasing ("people", "characters", "the team") makes the model add a crowd — the owner rejected a batch for exactly that.
- If the topic names a specific software product, your prompt MUST demand that product's official logo, drawn accurately and LARGE (at least a fifth of the frame wide), and must let the product's real brand colour lead the palette. A viewer has to know which software this is from across the room.
- Text must be black for contrast and have no mistakes. Only one person on the Thumbnail.
- Output ONLY the prompt text, no preamble.`;

/**
 * Appended when a persona image rides along as reference #2. Without this the
 * authored prompt describes a single reference, the model reads the second
 * image as decoration, and the channel's host silently does not appear.
 */
const PERSONA_IMAGE_RULES = `
- TWO reference images are attached. The FIRST is the style/layout reference; the SECOND is a photo of the CHANNEL HOST.
- Your prompt MUST instruct the model to replace the character in the first reference with the person from the second reference (singular — one host, alone), matching their pose and position and keeping their face, hair and build exactly.
- Your prompt MUST tell the model to take ONLY the person from the second reference — not its background, framing or text.`;

export async function authorThumbnailPrompt(
  input: DeepSeekPromptInput,
): Promise<string> {
  const personaLine = input.personaDescription
    ? `\nHost/persona: ${input.personaDescription}`
    : "";
  const notesLine = input.extraNotes
    ? `\nChannel notes: ${input.extraNotes}`
    : "";
  const limit = input.maxChars ?? 2000;
  const lengthRule = `
- HARD LIMIT: the prompt you output must be at most ${limit} characters. The image backend REFUSES a longer prompt outright, so going over produces no image at all.`;
  const userPrompt = `${SYSTEM_RULES}${
    input.personaImageAttached ? PERSONA_IMAGE_RULES : ""
  }${lengthRule}

Format: ${input.format}
Video title (use as the main thumbnail text): ${input.title}
Topic: ${input.topic}
First lines of the script (for context on the hook): ${input.scriptExcerpt}${personaLine}${notesLine}`;

  const text = await requestLLMText(userPrompt, {
    provider: "deepseek",
    context: "thumbnail:prompt-author",
  });
  // Truncating an authored prompt can cut the persona directive off the end,
  // which is precisely the failure this module now guards against — so the
  // caller's length gate decides, not a silent slice here.
  return text.trim();
}
