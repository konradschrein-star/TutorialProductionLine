/**
 * Research Prompt Generation Template
 *
 * Builds a Claude prompt that generates 1-3 intelligent Perplexity research prompts
 * tailored to the specific products and subformat (software/hardware/SaaS).
 *
 * This is a pure function - no IO, no side effects.
 */

export interface ResearchPromptInput {
  productA: string;
  productB: string;
  subformat: 'TECH_SOFTWARE' | 'TECH_HARDWARE' | 'TECH_SAAS';
}

export function buildResearchPromptGenerationPrompt(input: ResearchPromptInput): string {
  const { productA, productB, subformat } = input;

  const categoryGuidance = {
    TECH_SOFTWARE: 'software tools or applications',
    TECH_HARDWARE: 'physical hardware products',
    TECH_SAAS: 'cloud-based SaaS platforms',
  }[subformat];

  return `You are an expert research prompt generator for YouTube comparison videos.

Generate 1-3 comprehensive Perplexity research prompts for comparing ${productA} vs ${productB}.
These are ${categoryGuidance}.

Requirements:
- Each prompt should be detailed and specific (100-300 words)
- Cover different aspects: features/specs, pricing, user experience, ecosystem
- Prompts should guide toward factual, comparative research
- Include instructions to cite sources and include real user feedback
- Maximum 3 prompts (use fewer if the comparison is narrow)

Output format (JSON):
{
  "prompts": [
    "Prompt 1 text here...",
    "Prompt 2 text here...",
    "Prompt 3 text here..." (optional)
  ],
  "reasoning": "Brief explanation of why you chose this structure"
}

Return ONLY valid JSON, no markdown formatting.`;
}
