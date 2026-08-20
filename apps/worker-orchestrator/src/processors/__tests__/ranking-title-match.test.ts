import { describe, it, expect } from "vitest";
import {
  titleMatchesProduct,
  categoryTokensFromTopic,
} from "../ranking/ranking-footage-collection.js";

/**
 * Real failures from RANKING job 75c0cbe8 ("Best budget standing desks under
 * 400", 2026-08-05), where the relevance gate was simultaneously too strict and
 * too loose: it discarded every correct video for two of the five items (which
 * then shipped with no footage), and attached a video of a CHAIR to a desk.
 */
describe("categoryTokensFromTopic", () => {
  it("reduces a VA's topic line to the nouns being ranked", () => {
    expect(
      categoryTokensFromTopic("Best budget standing desks under 400"),
    ).toEqual(expect.arrayContaining(["standing", "desk"]));
  });

  it("singularises so a title saying 'keyboard' matches a topic saying 'keyboards'", () => {
    expect(
      categoryTokensFromTopic("Best budget mechanical keyboards under 150"),
    ).toContain("keyboard");
  });

  it("drops prices, filler and ranking words", () => {
    const t = categoryTokensFromTopic("Best budget standing desks under 400");
    expect(t).not.toContain("best");
    expect(t).not.toContain("budget");
    expect(t).not.toContain("under");
    expect(t).not.toContain("400");
  });
});

describe("titleMatchesProduct", () => {
  const DESKS = categoryTokensFromTopic("Best budget standing desks under 400");

  describe("sizes are not model designators", () => {
    it("matches the right brand's desk even though the name carries an inch size", () => {
      // Was rejected: "55" was treated as a mandatory model token.
      expect(
        titleMatchesProduct(
          "Fezibo Dual Motor White Standing Desk Review",
          "Fezibo Dual Motor 55-inch",
          DESKS,
        ),
      ).toBe(true);
    });

    it("still rejects a genuinely different model number", () => {
      expect(titleMatchesProduct("iPhone 11 Review", "iPhone 12", [])).toBe(
        false,
      );
      expect(
        titleMatchesProduct("Keychron V1 Max Review", "Keychron V3", []),
      ).toBe(false);
    });
  });

  describe("partial matches are decided by the ranking's category", () => {
    it("accepts brand + right category when the reviewer skipped the spec words", () => {
      // "SANODESK 79x32" is a dimension pair, not a model — and the title never
      // repeats "Pro Series Dual Motor". Brand + 'standing desk' is a match.
      expect(
        titleMatchesProduct(
          "SANODESK 79x32 - The Ultimate Large Standing Desk? (2026 Review)",
          "Sanodesk Pro Series Dual Motor",
          DESKS,
        ),
      ).toBe(true);
    });

    it("rejects the same brand's product from a different category", () => {
      // This one scored 2/4 on the old >=half rule and was attached to a
      // standing-desk ranking flagged productMatched:true.
      expect(
        titleMatchesProduct(
          "Monoprice Workstream Ergonomic Budget Mesh Back Chair [Assembly]",
          "Monoprice Workstream Single Motor",
          DESKS,
        ),
      ).toBe(false);
    });
  });

  describe("strong matches never consult the category", () => {
    it("accepts a verified model number even if the title omits the category noun", () => {
      expect(
        titleMatchesProduct(
          "Unboxing and Review - Redragon K552 TKL Mechanical Gaming Keyboard",
          "Redragon K552 Kumara",
          categoryTokensFromTopic("Best budget mechanical keyboards under 150"),
        ),
      ).toBe(true);
      expect(
        titleMatchesProduct(
          "Sony WH-1000XM5 Review",
          "Sony WH-1000XM5",
          categoryTokensFromTopic("Best noise cancelling headphones under 300"),
        ),
      ).toBe(true);
    });

    it("accepts when every word token is present", () => {
      expect(
        titleMatchesProduct(
          "Anker Soundcore Motion Review - Big Sound",
          "Anker Soundcore Motion",
          categoryTokensFromTopic("Best bluetooth speakers under 200"),
        ),
      ).toBe(true);
    });
  });

  it("rejects a title sharing nothing with the product", () => {
    expect(
      titleMatchesProduct(
        "I Tested 7 Standing Desks To Find The Best One",
        "Fezibo Dual Motor 55-inch",
        DESKS,
      ),
    ).toBe(false);
  });

  it("without a category, behaves like the original >=half threshold", () => {
    expect(
      titleMatchesProduct(
        "Monoprice Workstream Ergonomic Mesh Back Chair",
        "Monoprice Workstream Single Motor",
        [],
      ),
    ).toBe(true);
  });
});
