/**
 * buildMetadataPrompt — unit tests
 *
 * Pure function: no IO, no mocks needed.
 * Covers prompt structure, format-tone injection, language lines,
 * script truncation, and required JSON instruction.
 */

import { buildMetadataPrompt } from "../../youtube-metadata/prompt-builder.js";
import type { MetadataInput } from "../../youtube-metadata/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SCRIPT_EXCERPT_CHARS = 3_500; // mirrors the constant in prompt-builder.ts

function makeInput(overrides: Partial<MetadataInput> = {}): MetadataInput {
  return {
    script: "This is a short test script about quantum computing.",
    topic: "Quantum Computing",
    format: "EXPLAINER",
    language: "en",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Return shape
// ═══════════════════════════════════════════════════════════════════════════════

describe("return shape", () => {
  it("returns an object with system and user string properties", () => {
    const result = buildMetadataPrompt(makeInput());

    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("user");
    expect(typeof result.system).toBe("string");
    expect(typeof result.user).toBe("string");
  });

  it("returns non-empty strings for both system and user", () => {
    const { system, user } = buildMetadataPrompt(makeInput());

    expect(system.length).toBeGreaterThan(0);
    expect(user.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// System prompt — required content
// ═══════════════════════════════════════════════════════════════════════════════

describe("system prompt content", () => {
  it("instructs the model to respond with valid JSON only", () => {
    const { system } = buildMetadataPrompt(makeInput());

    expect(system).toContain("valid JSON");
  });

  it("includes the required JSON key names in the JSON schema example", () => {
    const { system } = buildMetadataPrompt(makeInput());

    expect(system).toContain('"title"');
    expect(system).toContain('"description"');
    expect(system).toContain('"tags"');
  });

  it("includes TITLE RULES section", () => {
    const { system } = buildMetadataPrompt(makeInput());

    expect(system).toContain("TITLE RULES");
  });

  it("includes DESCRIPTION RULES section", () => {
    const { system } = buildMetadataPrompt(makeInput());

    expect(system).toContain("DESCRIPTION RULES");
  });

  it("includes TAGS RULES section", () => {
    const { system } = buildMetadataPrompt(makeInput());

    expect(system).toContain("TAGS RULES");
  });

  it("mentions the 100-character hard maximum for the title", () => {
    const { system } = buildMetadataPrompt(makeInput());

    expect(system).toContain("100");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Format-tone injection
// ═══════════════════════════════════════════════════════════════════════════════

describe("format-tone injection", () => {
  it("injects EXPLAINER tone guidance into the system prompt", () => {
    const { system } = buildMetadataPrompt(makeInput({ format: "EXPLAINER" }));

    expect(system).toContain("curious and educational");
  });

  it("injects DOCUMENTARY tone guidance into the system prompt", () => {
    const { system } = buildMetadataPrompt(
      makeInput({ format: "DOCUMENTARY" }),
    );

    expect(system).toContain("cinematic");
  });

  it("injects TECH_COMPARISON tone guidance into the system prompt", () => {
    const { system } = buildMetadataPrompt(
      makeInput({ format: "TECH_COMPARISON" }),
    );

    expect(system).toContain("practical");
  });

  it("injects VIDEO_ESSAY tone guidance into the system prompt", () => {
    const { system } = buildMetadataPrompt(
      makeInput({ format: "VIDEO_ESSAY" }),
    );

    expect(system).toContain("thoughtful");
  });

  it("uses a fallback tone line for an unknown format", () => {
    const { system } = buildMetadataPrompt(
      makeInput({ format: "UNKNOWN_FORMAT_XYZ" }),
    );

    // Should not throw; should fall back gracefully
    expect(system.length).toBeGreaterThan(0);
    expect(system).toContain("Tone");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Language line
// ═══════════════════════════════════════════════════════════════════════════════

describe("language line", () => {
  it("does NOT include an output language line for English (en)", () => {
    const { system } = buildMetadataPrompt(makeInput({ language: "en" }));

    expect(system).not.toContain("Output language");
  });

  it("includes an output language line for non-English languages", () => {
    const { system } = buildMetadataPrompt(makeInput({ language: "de" }));

    expect(system).toContain("Output language");
    expect(system).toContain("de");
  });

  it("specifies that title, description, and tags must all be in the target language", () => {
    const { system } = buildMetadataPrompt(makeInput({ language: "fr" }));

    expect(system).toContain("fr");
    expect(system).toContain("Title");
    expect(system).toContain("description");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// User prompt — topic and script
// ═══════════════════════════════════════════════════════════════════════════════

describe("user prompt content", () => {
  it("includes the topic in the user prompt", () => {
    const { user } = buildMetadataPrompt(makeInput({ topic: "Black Holes" }));

    expect(user).toContain("Black Holes");
  });

  it("includes the full script when it is within the excerpt limit", () => {
    const script = "This is a short script.";
    const { user } = buildMetadataPrompt(makeInput({ script }));

    expect(user).toContain(script);
    expect(user).not.toContain("[...script continues...]");
  });

  it("truncates a script longer than 3500 characters and appends a continuation marker", () => {
    const script = "word ".repeat(800); // 5 × 800 = 4000 chars > 3500
    expect(script.length).toBeGreaterThan(SCRIPT_EXCERPT_CHARS);

    const { user } = buildMetadataPrompt(makeInput({ script }));

    expect(user).toContain("[...script continues...]");
    // The prompt body should contain the first 3500 chars
    expect(user).toContain(script.slice(0, SCRIPT_EXCERPT_CHARS));
  });

  it("does not include script content beyond 3500 characters in the user prompt", () => {
    const unique = "UNIQUE_MARKER_BEYOND_3500";
    const script = "a".repeat(SCRIPT_EXCERPT_CHARS) + unique;

    const { user } = buildMetadataPrompt(makeInput({ script }));

    expect(user).not.toContain(unique);
  });

  it("does not append continuation marker for a script exactly at the limit", () => {
    const script = "x".repeat(SCRIPT_EXCERPT_CHARS);

    const { user } = buildMetadataPrompt(makeInput({ script }));

    expect(user).not.toContain("[...script continues...]");
  });

  it("includes the instruction to write YouTube metadata", () => {
    const { user } = buildMetadataPrompt(makeInput());

    expect(user.toLowerCase()).toContain("youtube metadata");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Determinism
// ═══════════════════════════════════════════════════════════════════════════════

describe("determinism", () => {
  it("produces identical output for identical input on repeated calls", () => {
    const input = makeInput({ format: "VIDEO_ESSAY", language: "en" });

    const first = buildMetadataPrompt(input);
    const second = buildMetadataPrompt(input);

    expect(first.system).toBe(second.system);
    expect(first.user).toBe(second.user);
  });
});
