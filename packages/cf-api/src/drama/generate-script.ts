import { callGeminiPool } from "../integrations/gemini-pool.js";

/**
 * FacelessOS anti-slop guidance, distilled to a tight system block.
 * Source: C:\Users\konra\OneDrive\YouTube\Wissen\SCRIPTING. Boiled-down
 * version that's safe to put on every API call.
 */
const FACELESS_OS_GUIDANCE = `Hard rules from FacelessOS (these override anything else if they conflict):
- Sound like a friend telling a story at a bar, not like a copywriter.
- Hook in the first 60 seconds: name + age + concrete scene + the inciting twist that makes the rest worth watching.
- Avoid AI-slop tells: "No X. No Y. No Z." fragments; "Most people think…"; "It's not X, it's Y" (max one per script); "Here's the thing:"; suspiciously specific percentages (47%, 73%); empty words ("powerful", "game-changing", "transformational"); "Let that sink in"; "I spent the last [week/month/year]…" openers.
- Concrete details over abstractions. Real apartment > "modest home". $18 million > "wealthy". Specific names, ages, jobs, neighborhoods.
- One emotional beat per paragraph. Don't stack three reveals in one sentence.
- Body sections every ~90 seconds shift the focus: new scene, new character, new twist. Don't let any one beat outstay its welcome.
- End with a quiet payoff scene, not a pat moral. Show the protagonist's new normal.`;

export interface GenerateDramaScriptInput {
  topic: string;
  systemPrompt: string;
  targetMinutes: number;
  /** Optional full reference script body to anchor pacing/tone. */
  referenceText?: string | null;
}

export async function generateDramaScript(
  input: GenerateDramaScriptInput,
): Promise<string> {
  const targetWords = Math.round(input.targetMinutes * 130);

  // Construct the prompt in deterministic sections so the LLM sees a
  // consistent shape regardless of which optional inputs are present.
  const parts: string[] = [];
  parts.push(input.systemPrompt.trim());
  parts.push(FACELESS_OS_GUIDANCE);

  if (input.referenceText) {
    // Reference content can be very long (47-72 KB in our seeds).
    // Gemini-pool gemini-2.5-flash has plenty of input budget; we pass
    // the whole thing rather than truncate, so the model sees full
    // pacing not just the hook. The output cap is what limits length,
    // not the input.
    parts.push(
      `Stylistic reference (match the tone, pacing, and concrete-detail density of this script — DO NOT copy its plot, characters, or specifics):\n----- REFERENCE START -----\n${input.referenceText.trim()}\n----- REFERENCE END -----`,
    );
  }

  parts.push(`Topic: ${input.topic}`);
  parts.push(
    `Target length: roughly ${targetWords.toLocaleString()} words of spoken script (drama TTS pacing is ~130 wpm).`,
  );
  parts.push(
    "Output ONLY the spoken-narration prose. No headings. No character labels. No scene markers. Plain paragraphs separated by blank lines.",
  );

  return await callGeminiPool(parts.join("\n\n"));
}
