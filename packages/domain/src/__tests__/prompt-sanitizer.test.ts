/**
 * Prompt Sanitizer Tests
 *
 * Tests for sanitizePrompt, simplifyPrompt, and extractCoreSubject.
 */

import { describe, it, expect } from "vitest";
import {
  sanitizePrompt,
  simplifyPrompt,
  extractCoreSubject,
} from "../prompt-sanitizer.js";

// ---------------------------------------------------------------------------
// sanitizePrompt — trigger word replacements
// ---------------------------------------------------------------------------

describe("sanitizePrompt — political figure replacements", () => {
  it("replaces 'Trump' with 'a political leader'", () => {
    const result = sanitizePrompt("Trump is speaking at the podium.");
    expect(result).not.toContain("Trump");
    expect(result).toContain("a political leader");
  });

  it("replaces 'Biden' with 'a political leader'", () => {
    const result = sanitizePrompt("Biden signed the executive order.");
    expect(result).not.toContain("Biden");
    expect(result).toContain("a political leader");
  });

  it("replaces 'Obama' with 'a political leader'", () => {
    const result = sanitizePrompt("Obama gave a speech.");
    expect(result).not.toContain("Obama");
    expect(result).toContain("a political leader");
  });

  it("replaces 'Harris' with 'a political leader'", () => {
    const result = sanitizePrompt("Harris addressed the nation.");
    expect(result).toContain("a political leader");
  });

  it("replaces 'Putin' with 'a world leader'", () => {
    const result = sanitizePrompt("Putin announced new policies.");
    expect(result).not.toContain("Putin");
    expect(result).toContain("a world leader");
  });

  it("replaces 'Zelensky' with 'a world leader'", () => {
    const result = sanitizePrompt("Zelensky spoke to parliament.");
    expect(result).not.toContain("Zelensky");
    expect(result).toContain("a world leader");
  });

  it("is case-insensitive for political figure names", () => {
    expect(sanitizePrompt("trump called a press conference.")).toContain("a political leader");
    expect(sanitizePrompt("TRUMP announced plans.")).toContain("a political leader");
  });
});

describe("sanitizePrompt — violence and weapons replacements", () => {
  it("replaces 'gun' with 'military equipment'", () => {
    const result = sanitizePrompt("The soldier carried a gun.");
    expect(result).not.toContain(" gun");
    expect(result).toContain("military equipment");
  });

  it("replaces 'rifle' with 'military equipment'", () => {
    const result = sanitizePrompt("A sniper with a rifle.");
    expect(result).toContain("military equipment");
  });

  it("replaces 'bomb' with 'military equipment'", () => {
    const result = sanitizePrompt("The bomb exploded downtown.");
    expect(result).toContain("military equipment");
  });

  it("replaces 'blood' with 'aftermath'", () => {
    const result = sanitizePrompt("There was blood on the street.");
    expect(result).not.toContain("blood");
    expect(result).toContain("aftermath");
  });
});

describe("sanitizePrompt — sensitive content replacements", () => {
  it("replaces 'terrorist' with 'security threat'", () => {
    const result = sanitizePrompt("A terrorist attack occurred.");
    expect(result).not.toContain("terrorist");
    expect(result).toContain("security threat");
  });

  it("replaces 'drug' with 'controlled substance'", () => {
    const result = sanitizePrompt("Police seized drug shipments.");
    expect(result).not.toContain("drug");
    expect(result).toContain("controlled substance");
  });

  it("replaces 'cocaine' with 'controlled substance'", () => {
    const result = sanitizePrompt("Cocaine was found at the scene.");
    expect(result).toContain("controlled substance");
  });
});

describe("sanitizePrompt — title/role pattern replacement", () => {
  it("replaces 'the president of France' with 'a national leader'", () => {
    const result = sanitizePrompt("Speech by the president of France.");
    expect(result).not.toContain("the president of France");
    expect(result).toContain("a national leader");
  });

  it("replaces 'the prime minister of Germany' with 'a national leader'", () => {
    const result = sanitizePrompt("the prime minister of Germany announced.");
    expect(result).toContain("a national leader");
  });
});

describe("sanitizePrompt — multiple replacements in one string", () => {
  it("applies all replacements in a single pass", () => {
    const prompt = "Trump and Putin discussed the gun policy.";
    const result = sanitizePrompt(prompt);
    expect(result).not.toContain("Trump");
    expect(result).not.toContain("Putin");
    expect(result).not.toContain(" gun ");
    expect(result).toContain("a political leader");
    expect(result).toContain("a world leader");
    expect(result).toContain("military equipment");
  });
});

describe("sanitizePrompt — passthrough for clean input", () => {
  it("returns the original string when no violations are present", () => {
    const clean = "A busy city street at dusk with pedestrians.";
    expect(sanitizePrompt(clean)).toBe(clean);
  });

  it("does not mutate non-matching content", () => {
    const input = "An economist explaining GDP growth on a whiteboard.";
    expect(sanitizePrompt(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// simplifyPrompt — level 1
// ---------------------------------------------------------------------------

describe("simplifyPrompt — level 1", () => {
  it("removes 'natural imperfections' modifier", () => {
    const prompt = "Medium shot of a busy street, natural imperfections, no perfect symmetry, shot on 50mm lens";
    const result = simplifyPrompt(prompt, 1);
    expect(result).not.toContain("natural imperfections");
  });

  it("removes 'no perfect symmetry' modifier", () => {
    const prompt = "Close-up shot of a CEO, no perfect symmetry, shot on 85mm";
    const result = simplifyPrompt(prompt, 1);
    expect(result).not.toContain("no perfect symmetry");
  });

  it("preserves core description content", () => {
    const prompt = "Medium shot of a busy city street, natural imperfections, environmental clutter";
    const result = simplifyPrompt(prompt, 1);
    expect(result).toContain("Medium shot of a busy city street");
  });

  it("returns a non-empty string", () => {
    const prompt = "Wide shot of a parliament building, natural imperfections, no oversaturation";
    const result = simplifyPrompt(prompt, 1);
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// simplifyPrompt — level 2
// ---------------------------------------------------------------------------

describe("simplifyPrompt — level 2", () => {
  it("removes 'shot on' camera specs", () => {
    const prompt = "Medium shot of a politician, shot on Sony A7S III, 50mm lens, f/2.8 aperture, camera angle: eye level";
    const result = simplifyPrompt(prompt, 2);
    expect(result).not.toContain("shot on");
  });

  it("removes mm lens specs", () => {
    // Use a longer, richer description so the fallback (extractCoreSubject) is not triggered
    const prompt = "Wide shot of a crowded stadium with thousands of spectators cheering, 24mm wide angle lens, f/4-f/5.6 aperture, camera angle: high angle looking down, rule of thirds, leading lines using stadium rows, natural imperfections, no perfect symmetry";
    const result = simplifyPrompt(prompt, 2);
    expect(result).not.toMatch(/\d+mm/);
  });

  it("removes 'camera angle:' text", () => {
    // Use a longer description that survives the over-strip check (>20 chars after stripping)
    const prompt = "Medium shot of a large crowd of protesters filling the streets, camera angle: eye level, rule of thirds, leading lines, natural imperfections, no perfect symmetry, environmental clutter";
    const result = simplifyPrompt(prompt, 2);
    expect(result.toLowerCase()).not.toContain("camera angle");
  });

  it("appends 'professional photography, 16:9 framing' or falls back gracefully", () => {
    const prompt = "Medium shot of a doctor in hospital, camera angle: slight low angle, 50mm lens, f/2.8 aperture, rule of thirds composition, natural imperfections";
    const result = simplifyPrompt(prompt, 2);
    // Either professional photography is appended, or core subject fallback was triggered
    const hasProfessional = result.includes("professional") || result.includes("Professional");
    expect(hasProfessional).toBe(true);
  });

  it("returns a non-empty string", () => {
    const prompt = "Close-up shot of factory workers, shot on Canon C300, 85mm lens, f/2.8";
    const result = simplifyPrompt(prompt, 2);
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// simplifyPrompt — level 3
// ---------------------------------------------------------------------------

describe("simplifyPrompt — level 3", () => {
  it("returns a concise prompt with 'Professional news photograph of'", () => {
    const prompt = "Wide establishing shot of a legislative chamber during session, camera angle: high angle, 24mm lens, f/5.6, rule of thirds, natural imperfections";
    const result = simplifyPrompt(prompt, 3);
    expect(result).toContain("Professional news photograph of");
  });

  it("includes 'photorealistic' in level 3 output", () => {
    const prompt = "Close-up shot of a scientist holding a test tube, 85mm lens";
    const result = simplifyPrompt(prompt, 3);
    expect(result).toContain("photorealistic");
  });

  it("output is much shorter than the original", () => {
    const longPrompt = "Wide establishing shot of a massive government complex at dawn, camera angle: high angle looking down over sprawling buildings, shot on Sony FX9, 24mm wide angle lens, f/4-f/5.6, rule of thirds, subject on left third, leading lines using architecture, natural imperfections, no perfect symmetry, environmental clutter".repeat(3);
    const result = simplifyPrompt(longPrompt, 3);
    expect(result.length).toBeLessThan(longPrompt.length);
  });
});

// ---------------------------------------------------------------------------
// extractCoreSubject
// ---------------------------------------------------------------------------

describe("extractCoreSubject", () => {
  it("strips 'Wide shot of' prefix", () => {
    const result = extractCoreSubject("Wide shot of a city skyline at dusk");
    expect(result).not.toMatch(/^Wide shot/i);
    expect(result).toContain("city skyline");
  });

  it("strips 'Medium shot of' prefix", () => {
    const result = extractCoreSubject("Medium shot of a doctor reviewing patient files");
    expect(result).not.toMatch(/^Medium shot/i);
  });

  it("strips 'Close-up shot of' prefix", () => {
    const result = extractCoreSubject("Close-up shot of a hand signing documents");
    expect(result).not.toMatch(/^Close-up/i);
  });

  it("strips 'Establishing shot of' prefix", () => {
    const result = extractCoreSubject("Establishing shot of a parliament building");
    expect(result).not.toMatch(/^Establishing/i);
  });

  it("truncates at the first technical marker", () => {
    const result = extractCoreSubject("A judge in courtroom, camera angle: eye level, 50mm lens, f/2.8");
    expect(result).not.toContain("camera");
    expect(result).not.toContain("f/2.8");
    expect(result).toContain("judge in courtroom");
  });

  it("returns a non-empty fallback for empty input", () => {
    const result = extractCoreSubject("");
    expect(result).toBe("a professional news scene");
  });

  it("returns a non-empty fallback for very short input", () => {
    const result = extractCoreSubject("ok");
    expect(result).toBe("a professional news scene");
  });

  it("handles string with only technical content gracefully", () => {
    const result = extractCoreSubject("camera angle: overhead, 24mm, f/4, natural imperfections");
    expect(result.length).toBeGreaterThan(0);
  });

  it("truncates output to at most 100 characters at a word boundary", () => {
    const longDescription = "A very detailed scene of a massive government building filled with officials and journalists and staff members who are all wearing suits and ties and formal attire for the occasion of the annual budget announcement";
    const result = extractCoreSubject(longDescription);
    expect(result.length).toBeLessThanOrEqual(100);
  });
});
