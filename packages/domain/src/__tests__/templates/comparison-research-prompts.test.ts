/**
 * Research Prompt Generation Tests
 *
 * Tests for buildResearchPromptGenerationPrompt - a pure function that
 * generates Claude prompts for Perplexity research prompt generation.
 */

import { describe, it, expect } from "vitest";
import {
  buildResearchPromptGenerationPrompt,
  type ResearchPromptInput,
} from "../../templates/comparison-research-prompts.js";

describe("buildResearchPromptGenerationPrompt", () => {
  describe("TECH_SOFTWARE subformat", () => {
    it("generates prompt with correct software category guidance", () => {
      const input: ResearchPromptInput = {
        productA: "VS Code",
        productB: "Sublime Text",
        subformat: "TECH_SOFTWARE",
      };

      const prompt = buildResearchPromptGenerationPrompt(input);

      expect(prompt).toContain("VS Code vs Sublime Text");
      expect(prompt).toContain("software tools or applications");
      expect(prompt).not.toContain("hardware");
      expect(prompt).not.toContain("SaaS");
    });

    it("includes all required prompt elements for software", () => {
      const input: ResearchPromptInput = {
        productA: "Photoshop",
        productB: "GIMP",
        subformat: "TECH_SOFTWARE",
      };

      const prompt = buildResearchPromptGenerationPrompt(input);

      // Check for key requirements
      expect(prompt).toContain("expert research prompt generator");
      expect(prompt).toContain("Perplexity research prompts");
      expect(prompt).toContain("1-3 comprehensive");
      expect(prompt).toContain("100-300 words");
      expect(prompt).toContain("features/specs, pricing, user experience, ecosystem");
      expect(prompt).toContain("cite sources");
      expect(prompt).toContain("real user feedback");
      expect(prompt).toContain("JSON");
      expect(prompt).toContain('"prompts"');
      expect(prompt).toContain('"reasoning"');
      expect(prompt).toContain("ONLY valid JSON");
      expect(prompt).toContain("no markdown");
    });
  });

  describe("TECH_HARDWARE subformat", () => {
    it("generates prompt with correct hardware category guidance", () => {
      const input: ResearchPromptInput = {
        productA: "iPhone 15 Pro",
        productB: "Samsung Galaxy S24",
        subformat: "TECH_HARDWARE",
      };

      const prompt = buildResearchPromptGenerationPrompt(input);

      expect(prompt).toContain("iPhone 15 Pro vs Samsung Galaxy S24");
      expect(prompt).toContain("physical hardware products");
      expect(prompt).not.toContain("software tools");
      expect(prompt).not.toContain("SaaS");
    });

    it("includes all required prompt elements for hardware", () => {
      const input: ResearchPromptInput = {
        productA: "MacBook Pro M3",
        productB: "Dell XPS 15",
        subformat: "TECH_HARDWARE",
      };

      const prompt = buildResearchPromptGenerationPrompt(input);

      expect(prompt).toContain("expert research prompt generator");
      expect(prompt).toContain("MacBook Pro M3 vs Dell XPS 15");
      expect(prompt).toContain("physical hardware products");
    });
  });

  describe("TECH_SAAS subformat", () => {
    it("generates prompt with correct SaaS category guidance", () => {
      const input: ResearchPromptInput = {
        productA: "Notion",
        productB: "Obsidian",
        subformat: "TECH_SAAS",
      };

      const prompt = buildResearchPromptGenerationPrompt(input);

      expect(prompt).toContain("Notion vs Obsidian");
      expect(prompt).toContain("cloud-based SaaS platforms");
      expect(prompt).not.toContain("software tools or applications");
      expect(prompt).not.toContain("hardware");
    });

    it("includes all required prompt elements for SaaS", () => {
      const input: ResearchPromptInput = {
        productA: "Slack",
        productB: "Microsoft Teams",
        subformat: "TECH_SAAS",
      };

      const prompt = buildResearchPromptGenerationPrompt(input);

      expect(prompt).toContain("Slack vs Microsoft Teams");
      expect(prompt).toContain("cloud-based SaaS platforms");
      expect(prompt).toContain("1-3 comprehensive Perplexity research prompts");
    });
  });

  describe("product name handling", () => {
    it("handles products with special characters", () => {
      const input: ResearchPromptInput = {
        productA: "Node.js",
        productB: "Deno.js",
        subformat: "TECH_SOFTWARE",
      };

      const prompt = buildResearchPromptGenerationPrompt(input);

      expect(prompt).toContain("Node.js vs Deno.js");
    });

    it("handles products with spaces", () => {
      const input: ResearchPromptInput = {
        productA: "Visual Studio Code",
        productB: "IntelliJ IDEA",
        subformat: "TECH_SOFTWARE",
      };

      const prompt = buildResearchPromptGenerationPrompt(input);

      expect(prompt).toContain("Visual Studio Code vs IntelliJ IDEA");
    });

    it("handles products with numbers", () => {
      const input: ResearchPromptInput = {
        productA: "iPhone 15 Pro Max",
        productB: "Galaxy S24 Ultra",
        subformat: "TECH_HARDWARE",
      };

      const prompt = buildResearchPromptGenerationPrompt(input);

      expect(prompt).toContain("iPhone 15 Pro Max vs Galaxy S24 Ultra");
    });

    it("handles single-word product names", () => {
      const input: ResearchPromptInput = {
        productA: "Rust",
        productB: "Go",
        subformat: "TECH_SOFTWARE",
      };

      const prompt = buildResearchPromptGenerationPrompt(input);

      expect(prompt).toContain("Rust vs Go");
    });
  });

  describe("prompt structure validation", () => {
    it("returns a string", () => {
      const input: ResearchPromptInput = {
        productA: "Product A",
        productB: "Product B",
        subformat: "TECH_SOFTWARE",
      };

      const prompt = buildResearchPromptGenerationPrompt(input);

      expect(typeof prompt).toBe("string");
    });

    it("returns a non-empty string", () => {
      const input: ResearchPromptInput = {
        productA: "A",
        productB: "B",
        subformat: "TECH_HARDWARE",
      };

      const prompt = buildResearchPromptGenerationPrompt(input);

      expect(prompt.length).toBeGreaterThan(0);
    });

    it("contains JSON structure hints", () => {
      const input: ResearchPromptInput = {
        productA: "X",
        productB: "Y",
        subformat: "TECH_SAAS",
      };

      const prompt = buildResearchPromptGenerationPrompt(input);

      // Should show example JSON structure
      expect(prompt).toMatch(/\{\s*"prompts":/);
      expect(prompt).toMatch(/"reasoning":/);
    });

    it("specifies maximum of 3 prompts", () => {
      const input: ResearchPromptInput = {
        productA: "Foo",
        productB: "Bar",
        subformat: "TECH_SOFTWARE",
      };

      const prompt = buildResearchPromptGenerationPrompt(input);

      expect(prompt).toContain("Maximum 3 prompts");
    });

    it("specifies word count range", () => {
      const input: ResearchPromptInput = {
        productA: "Alpha",
        productB: "Beta",
        subformat: "TECH_HARDWARE",
      };

      const prompt = buildResearchPromptGenerationPrompt(input);

      expect(prompt).toContain("100-300 words");
    });
  });

  describe("all subformats produce valid prompts", () => {
    const subformats: Array<"TECH_SOFTWARE" | "TECH_HARDWARE" | "TECH_SAAS"> = [
      "TECH_SOFTWARE",
      "TECH_HARDWARE",
      "TECH_SAAS",
    ];

    subformats.forEach((subformat) => {
      it(`produces valid prompt for ${subformat}`, () => {
        const input: ResearchPromptInput = {
          productA: "Product A",
          productB: "Product B",
          subformat,
        };

        const prompt = buildResearchPromptGenerationPrompt(input);

        expect(prompt).toBeTruthy();
        expect(prompt).toContain("Product A vs Product B");
        expect(prompt).toContain("research prompt generator");
        expect(prompt).toContain("JSON");
      });
    });
  });

  describe("pure function behavior", () => {
    it("returns same output for same input (referential transparency)", () => {
      const input: ResearchPromptInput = {
        productA: "React",
        productB: "Vue",
        subformat: "TECH_SOFTWARE",
      };

      const prompt1 = buildResearchPromptGenerationPrompt(input);
      const prompt2 = buildResearchPromptGenerationPrompt(input);

      expect(prompt1).toBe(prompt2);
    });

    it("does not mutate input", () => {
      const input: ResearchPromptInput = {
        productA: "Original A",
        productB: "Original B",
        subformat: "TECH_SOFTWARE",
      };

      const inputCopy = { ...input };
      buildResearchPromptGenerationPrompt(input);

      expect(input).toEqual(inputCopy);
    });
  });
});
