import { describe, expect, it } from "vitest";
import { selectTranslationChannel } from "../thumbnail-context.js";

describe("translation channel selection", () => {
  it("returns the one explicitly configured language channel", () => {
    expect(
      selectTranslationChannel("de", [{ id: "german", language: "German" }]),
    ).toEqual({ id: "german", language: "German" });
  });

  it("fails closed when target-channel state is missing or ambiguous", () => {
    expect(() => selectTranslationChannel("sv", [])).toThrow("missing");
    expect(() =>
      selectTranslationChannel("fr", [
        { id: "fr-1", language: "fr" },
        { id: "fr-2", language: "French" },
      ]),
    ).toThrow("ambiguous (2 matches)");
  });
});
