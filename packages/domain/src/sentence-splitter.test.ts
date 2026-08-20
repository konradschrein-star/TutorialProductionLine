import { describe, it, expect } from "vitest";
import { splitSentences, splitSubSentences } from "./sentence-splitter.js";

describe("splitSentences", () => {
  it("splits basic sentences", () => {
    const result = splitSentences("The dog ran. The cat slept. Birds flew.");
    expect(result).toEqual(["The dog ran.", "The cat slept.", "Birds flew."]);
  });

  it("does not split on Dr.", () => {
    const result = splitSentences("Dr. Smith arrived. He was late.");
    expect(result).toEqual(["Dr. Smith arrived.", "He was late."]);
  });

  it("does not split on U.S.", () => {
    const result = splitSentences("The U.S. economy grew. Markets responded.");
    expect(result).toEqual(["The U.S. economy grew.", "Markets responded."]);
  });

  it("does not split on vs.", () => {
    const result = splitSentences("The Apple vs. Samsung case ended. Both sides appealed.");
    expect(result).toEqual(["The Apple vs. Samsung case ended.", "Both sides appealed."]);
  });

  it("handles question marks and exclamation marks", () => {
    const result = splitSentences("Is this working? Yes! It works.");
    expect(result).toEqual(["Is this working?", "Yes!", "It works."]);
  });

  it("returns single sentence unchanged", () => {
    const result = splitSentences("Only one sentence here");
    expect(result).toEqual(["Only one sentence here"]);
  });

  it("handles empty string", () => {
    expect(splitSentences("")).toEqual([]);
  });
});

describe("splitSubSentences", () => {
  it("splits on commas within a sentence", () => {
    const result = splitSubSentences("First came the rain, then thunder, then silence.");
    expect(result.length).toBeGreaterThan(1);
    expect(result.some((s) => s.includes("rain"))).toBe(true);
    expect(result.some((s) => s.includes("thunder"))).toBe(true);
  });

  it("does not split on numeric commas like 1,000", () => {
    const result = splitSubSentences("The fund raised $1,000 this year. Then $2,000 next year.");
    expect(result.every((s) => !s.startsWith("000"))).toBe(true);
    expect(result.every((s) => !s.startsWith("000"))).toBe(true);
  });

  it("splits on semicolons", () => {
    const result = splitSubSentences("Rain fell; winds howled; the storm passed.");
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("filters out tiny clause fragments", () => {
    const result = splitSubSentences("A, very long sentence with many, commas, inside.");
    expect(result.every((s) => s.length > 4)).toBe(true);
  });
});
