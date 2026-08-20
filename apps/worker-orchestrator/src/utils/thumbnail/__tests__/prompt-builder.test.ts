import { describe, it, expect } from "vitest";
import {
  buildProgrammaticPrompt,
  buildIteratePrompt,
  buildLocalizePrompt,
  firstNSentences,
} from "../prompt-builder.js";

const baseInput = {
  headline: "This changes everything",
  topic: "The new AI coding workflow",
  layoutInstructions: null as string | null,
  basePrompt: null as string | null,
  personaDescription: null as string | null,
  featuresLogo: false,
  logoSubject: null as string | null,
  extraNotes: null as string | null,
};

describe("buildProgrammaticPrompt", () => {
  it("includes headline and topic and the anti-copy instruction", () => {
    const p = buildProgrammaticPrompt(baseInput);
    expect(p).toContain('"This changes everything"');
    expect(p).toContain('"The new AI coding workflow"');
    expect(p).toContain("Completely disregard and replace the unrelated topic");
  });

  it("adds a persona replacement line only when a persona is present", () => {
    expect(buildProgrammaticPrompt(baseInput)).not.toContain(
      "Replace any character",
    );
    const withPersona = buildProgrammaticPrompt({
      ...baseInput,
      personaDescription: "a bald man with a grey beard",
    });
    expect(withPersona).toContain(
      "Replace any character in the reference image with this: a bald man with a grey beard",
    );
  });

  it("adds a logo line only when featuresLogo and a subject are set", () => {
    expect(
      buildProgrammaticPrompt({ ...baseInput, featuresLogo: true }),
    ).not.toContain("official logo");
    const withLogo = buildProgrammaticPrompt({
      ...baseInput,
      featuresLogo: true,
      logoSubject: "Docker",
    });
    expect(withLogo).toContain("Docker's official logo");
  });

  it("injects archetype layout_instructions and base_prompt when present", () => {
    const p = buildProgrammaticPrompt({
      ...baseInput,
      layoutInstructions: "Big face left, giant text right",
      basePrompt: "Ominous red glow",
    });
    expect(p).toContain("Big face left, giant text right");
    expect(p).toContain("Ominous red glow");
  });

  it("stays within 5000 characters", () => {
    const p = buildProgrammaticPrompt({
      ...baseInput,
      personaDescription: "x".repeat(6000),
    });
    expect(p.length).toBeLessThanOrEqual(5000);
  });
});

describe("buildIteratePrompt", () => {
  it("wraps change instructions with apply-only-requested-changes", () => {
    const p = buildIteratePrompt("make the text bigger and red");
    expect(p).toContain("ITERATION REQUEST: make the text bigger and red");
    expect(p).toContain("apply ONLY the requested changes");
  });
});

describe("buildLocalizePrompt", () => {
  it("translates and makes it a unique localized piece", () => {
    const p = buildLocalizePrompt("Spanish", "LatAm");
    expect(p).toContain("Translate all visible text to Spanish");
    expect(p).toContain("its own unique piece");
    expect(p).toContain("(LatAm audience)");
  });
  it("omits the audience clause when no market is given", () => {
    expect(buildLocalizePrompt("German")).not.toContain("audience)");
  });
});

describe("firstNSentences", () => {
  it("returns the first N sentence-terminated chunks", () => {
    const script = "One. Two! Three? Four. Five.";
    expect(firstNSentences(script, 2)).toBe("One. Two!");
  });

  it("returns the whole string when it has fewer than N sentences", () => {
    expect(firstNSentences("Only one here", 5)).toBe("Only one here");
  });
});
