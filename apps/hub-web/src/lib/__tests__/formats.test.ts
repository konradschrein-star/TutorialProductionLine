import { describe, it, expect } from "vitest";
import { titleCase } from "../formats.js";

describe("titleCase", () => {
  it("maps a format id to a friendly label", () => {
    expect(titleCase("TECH_COMPARISON")).toBe("Tech Comparison");
    expect(titleCase("TUTORIAL_STUDIO")).toBe("Tutorial Studio");
    expect(titleCase("RANKING")).toBe("Ranking");
  });
});
