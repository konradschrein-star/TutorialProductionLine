import { describe, it, expect } from "vitest";
import {
  WORDS_PER_MINUTE,
  estimateMinutes,
  splitPartIfTooLong,
  parseOutline,
  buildOutlinePrompt,
  buildExpansionPrompt,
} from "../long-form.js";

describe("estimateMinutes", () => {
  it("estimates from word count at WORDS_PER_MINUTE", () => {
    const words = Array.from(
      { length: WORDS_PER_MINUTE * 8 },
      () => "word",
    ).join(" ");
    expect(Math.round(estimateMinutes(words))).toBe(8);
  });
});

describe("splitPartIfTooLong", () => {
  it("returns the text unchanged when within target", () => {
    const text = "Sentence one. Sentence two. Sentence three.";
    expect(splitPartIfTooLong(text, 8)).toEqual([text]);
  });

  it("never splits mid-sentence — every chunk ends on sentence punctuation", () => {
    const sentence = Array.from({ length: 30 }, () => "word").join(" ") + ".";
    const longText = Array.from(
      { length: Math.ceil((WORDS_PER_MINUTE * 21) / 30) },
      () => sentence,
    ).join(" ");
    const parts = splitPartIfTooLong(longText, 8);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.trim()).toMatch(/[.!?]$/);
    }
    expect(parts.join(" ").replace(/\s+/g, " ").trim()).toBe(
      longText.replace(/\s+/g, " ").trim(),
    );
  });
});

describe("parseOutline", () => {
  it("parses a valid N-part outline JSON", () => {
    const json = JSON.stringify({
      parts: [
        { title: "Intro", summary: "what we cover" },
        { title: "Setup", summary: "install things" },
      ],
    });
    const out = parseOutline(json);
    expect(out.parts).toHaveLength(2);
    expect(out.parts[0]!.title).toBe("Intro");
  });

  it("strips ```json fences before parsing", () => {
    const json = '```json\n{"parts":[{"title":"A","summary":"b"}]}\n```';
    expect(parseOutline(json).parts).toHaveLength(1);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseOutline("not json")).toThrow();
  });

  it("repairs a part missing its title (backfills) instead of throwing", () => {
    const json = JSON.stringify({
      parts: [
        { title: "Intro", summary: "the basics" },
        { title: "Setup", summary: "install it" },
        { summary: "wrap it all up" }, // model forgot the title
      ],
    });
    const out = parseOutline(json);
    expect(out.parts).toHaveLength(3);
    expect(out.parts[2]!.title.length).toBeGreaterThan(0);
    expect(out.parts[2]!.summary).toBe("wrap it all up");
  });

  it("drops empty/extra part objects but keeps valid ones", () => {
    const json = JSON.stringify({
      parts: [{ title: "A", summary: "a" }, {}, { title: "B", summary: "b" }],
    });
    const out = parseOutline(json);
    expect(out.parts.map((p) => p.title)).toEqual(["A", "B"]);
  });
});

describe("prompt builders", () => {
  /**
   * The arc changed on 2026-08-05 and this test changed with it.
   *
   * It used to pin "OPENS" and "WRAPS UP" — a deliberate final chapter that
   * "covers the last material and recaps". That recap chapter is one of the
   * things Gemini flagged in our own 45-minute video, and a chapter whose
   * content is a review of earlier chapters is a wasted chapter in a format
   * where nobody reaches the end anyway. The final chapter now teaches real
   * material like every other one and only then closes.
   */
  it("buildOutlinePrompt asks for exactly N chapters of the target length", () => {
    const p = buildOutlinePrompt("base instructions", "step list", 5, 8);
    expect(p).toContain("5");
    expect(p).toContain("8");
    expect(p).toContain("step list");
    // Chapter one still opens the video over the finished result.
    expect(p).toMatch(/Chapter 1 opens the video/);
    // ...but the final chapter is no longer a recap.
    expect(p).toMatch(/NOT a summary chapter/);
    expect(p).not.toContain("WRAPS UP");
  });
  it("buildExpansionPrompt includes the part title, summary and plain-text rule", () => {
    const p = buildExpansionPrompt(
      "base instructions",
      { title: "Setup", summary: "install" },
      8,
    );
    expect(p).toContain("Setup");
    expect(p).toContain("install");
    // Spoken-words-only guarantee now comes from the shared TTS_OUTPUT_RULE.
    expect(p).toContain("Output the spoken words");
  });

  const part = { title: "Chapter", summary: "stuff" };

  /**
   * 2026-08-03: chapter one used to be told to write a presenter-style SEO
   * opener plus a like-and-subscribe nudge. A LONG_FORM tutorial is a screen
   * recording like every other mode — the ask belongs at the very end.
   */
  it("opening chapter carries the introduction but never the CTA", () => {
    const p = buildExpansionPrompt("base", part, 8, { index: 0, total: 4 });
    expect(p).toContain("OPENING chapter");
    expect(p).toContain("NO like-and-subscribe ask");
    expect(p).not.toContain("FINAL chapter");
  });

  it("final chapter closes out and carries the ask, does not re-introduce", () => {
    const p = buildExpansionPrompt("base", part, 8, { index: 3, total: 4 });
    expect(p).toContain("FINAL chapter");
    expect(p).toContain("CLOSE AND THE\nASK");
    expect(p).toContain("mid-flow");
  });

  it("middle chapter flows on without intro or sign-off", () => {
    const p = buildExpansionPrompt("base", part, 8, { index: 1, total: 4 });
    expect(p).toContain("MIDDLE chapter");
    expect(p).not.toContain("like-and-subscribe");
    expect(p).not.toContain("sign-off");
  });

  it("lists prior chapters for continuity when provided", () => {
    const p = buildExpansionPrompt("base", part, 8, { index: 2, total: 4 }, [
      { title: "Intro", summary: "the basics" },
      { title: "Setup", summary: "installing" },
    ]);
    expect(p).toContain("ALREADY COVERED");
    expect(p).toContain("Intro");
    expect(p).toContain("Setup");
  });
});
