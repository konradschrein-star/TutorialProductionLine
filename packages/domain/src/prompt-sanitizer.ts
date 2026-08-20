/**
 * Prompt Sanitizer & Progressive Simplifier
 *
 * Handles image generation failures by progressively simplifying prompts.
 * Also sanitizes prompts for content policy compliance.
 *
 * Pure functions. No IO.
 */

// ---------------------------------------------------------------------------
// Policy Patterns — terms that trigger content policy violations
// ---------------------------------------------------------------------------

const POLICY_VIOLATION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Specific political figures → generic descriptions
  { pattern: /\b(Trump|Biden|Obama|Clinton|Harris|Pence|Pelosi|McConnell)\b/gi, replacement: "a political leader" },
  { pattern: /\b(Putin|Zelensky|Xi Jinping|Macron|Merkel|Johnson)\b/gi, replacement: "a world leader" },
  // Violence/weapons
  { pattern: /\b(gun|rifle|pistol|weapon|bomb|explosion|missile|drone strike)\b/gi, replacement: "military equipment" },
  { pattern: /\b(blood|gore|wound|corpse|dead body|casualty)\b/gi, replacement: "aftermath" },
  // Sensitive content
  { pattern: /\b(terrorist|terrorism|extremist|radical)\b/gi, replacement: "security threat" },
  { pattern: /\b(drug|cocaine|heroin|meth|opioid)\b/gi, replacement: "controlled substance" },
  // Real people by description (e.g., "the president of the United States")
  { pattern: /the (president|prime minister|chancellor) of [A-Z][a-z]+/gi, replacement: "a national leader" },
];

// ---------------------------------------------------------------------------
// Sanitize
// ---------------------------------------------------------------------------

/**
 * Remove or replace known policy-violating patterns from a prompt.
 * This is a rule-based pre-validation step, not AI-powered rewriting.
 */
export function sanitizePrompt(prompt: string): string {
  let sanitized = prompt;
  for (const { pattern, replacement } of POLICY_VIOLATION_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

// ---------------------------------------------------------------------------
// Progressive Simplification
// ---------------------------------------------------------------------------

/**
 * Progressively simplify an image generation prompt.
 *
 * Level 1: Remove production reality modifiers and AI-tell avoidance
 *          (keep core description + camera specs)
 *
 * Level 2: Strip camera specs, reduce to core subject + setting + lighting
 *          (remove all technical photography language)
 *
 * Level 3: Ultra-simple — just the core subject in a generic professional setting
 *          (last resort before giving up)
 */
export function simplifyPrompt(prompt: string, level: 1 | 2 | 3): string {
  switch (level) {
    case 1:
      return simplifyLevel1(prompt);
    case 2:
      return simplifyLevel2(prompt);
    case 3:
      return simplifyLevel3(prompt);
  }
}

/**
 * Level 1: Remove production modifiers, keep structure.
 * Strips: reality modifiers, AI-tell avoidance, weather, imperfections
 */
function simplifyLevel1(prompt: string): string {
  // Remove common reality modifier phrases
  const modifierPatterns = [
    /,?\s*natural imperfections[^,.]*/gi,
    /,?\s*no perfect symmetry[^,.]*/gi,
    /,?\s*no oversaturation[^,.]*/gi,
    /,?\s*realistic skin texture[^,.]*/gi,
    /,?\s*environmental clutter[^,.]*/gi,
    /,?\s*slight (noise|grain|motion blur|lens flare|vignetting|distortion)[^,.]*/gi,
    /,?\s*subtle (lens|chromatic|natural)[^,.]*/gi,
    /,?\s*(film grain|ISO \d+)[^,.]*/gi,
    /,?\s*production reality[^,.]*/gi,
    /,?\s*weather:[^,.]*/gi,
  ];

  let simplified = prompt;
  for (const pattern of modifierPatterns) {
    simplified = simplified.replace(pattern, "");
  }

  // Clean up double commas and trailing commas
  simplified = simplified.replace(/,\s*,/g, ",").replace(/,\s*$/g, "").trim();
  return simplified || prompt; // fallback to original if over-stripped
}

/**
 * Level 2: Strip to core description + basic setting.
 * Removes camera specs, lens details, aperture, composition rules.
 */
function simplifyLevel2(prompt: string): string {
  // Extract core subject by removing technical photography language
  const techPatterns = [
    /,?\s*shot on[^,.]*/gi,
    /,?\s*\d+mm[^,.]*/gi,
    /,?\s*f\/[\d.]+[^,.]*/gi,
    /,?\s*camera angle:[^,.]*/gi,
    /,?\s*rule of thirds[^,.]*/gi,
    /,?\s*leading lines[^,.]*/gi,
    /,?\s*negative space[^,.]*/gi,
    /,?\s*depth (cues|of field)[^,.]*/gi,
    /,?\s*(establishing|medium|close-up|detail|wide|macro|over-the-shoulder) shot (of|showing)/gi,
    /,?\s*mood:[^,.]*/gi,
    /,?\s*color palette:[^,.]*/gi,
    /,?\s*headroom[^,.]*/gi,
    /,?\s*composition[^,.]*/gi,
  ];

  let simplified = prompt;

  // First apply level 1
  simplified = simplifyLevel1(simplified);

  // Then strip technical specs
  for (const pattern of techPatterns) {
    simplified = simplified.replace(pattern, "");
  }

  // Clean up
  simplified = simplified.replace(/,\s*,/g, ",").replace(/,\s*$/g, "").replace(/^\s*,/, "").trim();

  if (!simplified || simplified.length < 20) {
    // Over-stripped — extract core subject
    return `Professional photograph of ${extractCoreSubject(prompt)}, high quality, 16:9 framing`;
  }

  return `${simplified}, professional photography, 16:9 framing`;
}

/**
 * Level 3: Ultra-simple generic prompt.
 * Last resort before giving up entirely.
 */
function simplifyLevel3(prompt: string): string {
  const subject = extractCoreSubject(prompt);
  return `Professional news photograph of ${subject}, studio quality, clean composition, 16:9 aspect ratio, photorealistic`;
}

// ---------------------------------------------------------------------------
// Core Subject Extraction
// ---------------------------------------------------------------------------

/**
 * Extract the main subject noun phrase from a complex prompt.
 * Used as a fallback when progressive simplification strips too much.
 */
export function extractCoreSubject(prompt: string): string {
  // Strategy: take the first meaningful clause before any commas/technical specs
  // Remove shot type prefixes
  let cleaned = prompt
    .replace(/^(wide|medium|close-up|detail|establishing|macro|over-the-shoulder)\s+(shot|view)\s+(of|showing)\s+/i, "")
    .trim();

  // Take text before the first technical marker
  const techMarkers = [
    "shot on",
    "camera",
    "lens",
    "f/",
    "aperture",
    "lighting",
    "rule of thirds",
    "natural imperfections",
    "mood:",
    "color palette:",
  ];

  for (const marker of techMarkers) {
    const idx = cleaned.toLowerCase().indexOf(marker);
    if (idx > 10) {
      // Only cut if we'd keep at least 10 chars
      cleaned = cleaned.substring(0, idx).trim();
      break;
    }
  }

  // Remove trailing comma/period
  cleaned = cleaned.replace(/[,.]$/, "").trim();

  // If still too long, take first 100 chars at a word boundary
  if (cleaned.length > 100) {
    cleaned = cleaned.substring(0, 100).replace(/\s\S*$/, "").trim();
  }

  // Fallback
  if (!cleaned || cleaned.length < 5) {
    return "a professional news scene";
  }

  return cleaned;
}
