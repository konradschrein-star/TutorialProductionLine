import { describe, it, expect } from "vitest";
import {
  extractScriptStructure,
  structureFromParts,
  sectionShares,
} from "../script-structure.js";

/**
 * `script_text` is ONE FLAT TEXT COLUMN and it is fed to TTS verbatim. The
 * owner's roadmap (subtopic banners, YouTube chapters, "highlight the important
 * parts", per-section QA, avatar segments) all need the same missing thing:
 * script structure carried through to the timeline.
 *
 * The non-negotiable property these tests protect: whatever structure we keep,
 * the text that reaches TTS must contain NO markers and must still read exactly
 * like the script the model wrote.
 */
describe("extractScriptStructure", () => {
  const script = [
    "[[INTRO]]",
    "",
    "To rename a Notion database you click its title and type.",
    "",
    "[[SUBTOPIC: Open the database menu]]",
    "",
    "Hover over the database name until the six-dot handle appears, then click it.",
    "",
    "[[SUBTOPIC: Rename and confirm]]",
    "",
    "Type the new name and press Enter. The tab title updates immediately.",
    "",
    "[[OUTRO]]",
    "",
    "That is renaming done. Next, try the same trick on a linked view.",
  ].join("\n");

  const { text, structure } = extractScriptStructure(script);

  it("removes every marker from the text that goes to TTS", () => {
    expect(text).not.toMatch(/\[\[/);
    expect(text).not.toMatch(/\]\]/);
    expect(text).not.toMatch(/SUBTOPIC/);
    expect(text).not.toMatch(/INTRO|OUTRO/);
  });

  it("keeps the spoken words intact and in order", () => {
    expect(text).toContain("To rename a Notion database you click its title");
    expect(text).toContain("press Enter");
    expect(text.indexOf("Hover over")).toBeLessThan(
      text.indexOf("press Enter"),
    );
  });

  it("records intro, subtopics and outro", () => {
    expect(structure.source).toBe("markers");
    expect(structure.sections.map((s) => s.kind)).toEqual([
      "intro",
      "subtopic",
      "subtopic",
      "outro",
    ]);
    expect(structure.sections[1]?.title).toBe("Open the database menu");
    expect(structure.sections[2]?.title).toBe("Rename and confirm");
  });

  it("offsets index the marker-free text exactly", () => {
    for (const s of structure.sections) {
      const slice = text.slice(s.char_start, s.char_end);
      expect(slice.trim()).toBe(slice);
      expect(slice.length).toBeGreaterThan(0);
    }
    const first = structure.sections[0]!;
    expect(text.slice(first.char_start, first.char_end)).toContain(
      "To rename a Notion database",
    );
  });

  it("word offsets are contiguous and sum to the total", () => {
    let cursor = 0;
    for (const s of structure.sections) {
      expect(s.word_start).toBe(cursor);
      expect(s.word_end - s.word_start).toBe(s.word_count);
      cursor = s.word_end;
    }
    expect(cursor).toBe(structure.total_words);
    expect(structure.total_words).toBe(
      text.split(/\s+/).filter(Boolean).length,
    );
  });

  it("treats prose before the first marker as the opening", () => {
    const { structure: s } = extractScriptStructure(
      "Straight into it.\n\n[[SUBTOPIC: Do the thing]]\n\nClick the button.",
    );
    expect(s.sections[0]?.kind).toBe("intro");
    expect(s.sections[1]?.kind).toBe("subtopic");
  });

  it("accepts SECTION and CHAPTER as aliases models reach for", () => {
    const { structure: s } = extractScriptStructure(
      "[[INTRO]]\nHi.\n[[SECTION: One]]\nDo A.\n[[CHAPTER: Two]]\nDo B.",
    );
    expect(s.sections.map((x) => x.kind)).toEqual([
      "intro",
      "subtopic",
      "subtopic",
    ]);
    expect(s.sections[2]?.title).toBe("Two");
  });

  it("strips a stray/malformed marker rather than speaking it", () => {
    const { text: t } = extractScriptStructure(
      "[[INTRO]]\nClick save. [[NOTE TO SELF]] Then close the panel.",
    );
    expect(t).not.toMatch(/\[\[/);
    expect(t).toContain("Click save.");
    expect(t).toContain("Then close the panel.");
  });

  it("does not fail an unmarked script — it reports source 'none'", () => {
    const plain = "Click the gear icon. Then choose Export. You are done.";
    const { text: t, structure: s } = extractScriptStructure(plain);
    expect(t).toBe(plain);
    expect(s.source).toBe("none");
    expect(s.sections).toHaveLength(1);
    expect(s.sections[0]?.kind).toBe("body");
  });
});

describe("structureFromParts (LONG_FORM outline preservation)", () => {
  const parts = [
    { title: "Getting set up", text: "First part text." },
    { title: "Doing the work", text: "Second part text." },
    { title: "Wrapping up", text: "Third part text." },
  ];
  const { text, structure } = structureFromParts(parts);

  it("produces exactly the flat script the old join() produced", () => {
    expect(text).toBe(parts.map((p) => p.text).join("\n\n"));
  });

  it("keeps the chapter titles that used to be thrown away", () => {
    expect(structure.source).toBe("outline");
    expect(structure.sections.map((s) => s.title)).toEqual([
      "Getting set up",
      "Doing the work",
      "Wrapping up",
    ]);
  });

  it("marks first/last as opening and close", () => {
    expect(structure.sections.map((s) => s.kind)).toEqual([
      "intro",
      "subtopic",
      "outro",
    ]);
  });

  it("a single chapter is the whole video, not an intro", () => {
    const one = structureFromParts([{ title: "All of it", text: "Words." }]);
    expect(one.structure.sections[0]?.kind).toBe("body");
  });
});

describe("sectionShares", () => {
  it("reports the share of words per section kind", () => {
    const { structure } = structureFromParts([
      { title: "a", text: "one two three four" },
      { title: "b", text: "five six" },
      { title: "c", text: "seven eight" },
    ]);
    const shares = sectionShares(structure);
    expect(shares.intro).toBeCloseTo(0.5, 5);
    expect(shares.subtopic).toBeCloseTo(0.25, 5);
    expect(shares.outro).toBeCloseTo(0.25, 5);
  });
});
