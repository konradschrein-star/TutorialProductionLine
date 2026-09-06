import { describe, it, expect } from "vitest";
import { condenseHeadline, stripBrand } from "../headline.js";
import { deriveHeadline } from "../brief.js";

/**
 * Every case below is a REAL rejected thumbnail from the owner's review of
 * 2026-08-06, quoted in the test name. The expected values are his own proposed
 * replacements where he gave one.
 */

const T = { maxWords: 4 };

describe("condenseHeadline — the owner's rejections", () => {
  it("'QuickBooks Online, Get Paid Faster' -> the outcome, logo carries the brand", () => {
    // "something which we could theoretically compress into 'get paid faster'
    //  with the big logo of QuickBooks"
    expect(
      condenseHeadline("QuickBooks Online, Get Paid Faster", {
        ...T,
        logoSubject: "QuickBooks",
      }),
    ).toBe("Get Paid Faster");
  });

  it("'NetSuite Multi Entity Consolidations Made Easy' -> drops the brand and the filler", () => {
    // "It is way easier to have multi-entity consolidations."
    expect(
      condenseHeadline("NetSuite Multi Entity Consolidations Made Easy", {
        ...T,
        logoSubject: "NetSuite",
      }),
    ).toBe("Multi Entity Consolidations");
  });

  it("'Sage Accounting Painless Month Ends' -> 'Accounting Month Ends'", () => {
    // "we do not really need the 'painless' in this. 'Accounting month ends'
    //  makes a little bit more sense"
    expect(
      condenseHeadline("Sage Accounting Painless Month Ends", {
        ...T,
        logoSubject: "Sage",
      }),
    ).toBe("Accounting Month Ends");
  });

  it("'QuickBooks Reconciliation Finally Made Easy' -> keeps the brand, because the phrase collapses without it", () => {
    // "I wouldn't definitely have 'finally' on there and the 'made easy' is
    //  also not really quick. Having just a really big 'QuickBooks
    //  reconciliation' is, in most cases, more effective."
    expect(
      condenseHeadline("QuickBooks Reconciliation Finally Made Easy", {
        ...T,
        logoSubject: "QuickBooks",
      }),
    ).toBe("QuickBooks Reconciliation");
  });

  it("'Notion SOPs Without The Grind' survives intact — the owner approved it", () => {
    // "In this case Notion SOPs without the grind makes sense."
    expect(
      condenseHeadline("Notion SOPs Without The Grind", {
        ...T,
        logoSubject: "Notion",
      }),
    ).toBe("SOPs Without The Grind");
  });

  it("'Canva Brand Kit Setup Step By Step Guide' -> drops the trailing scaffolding", () => {
    // "I just wouldn't have the step-by-step guide. I would make the rest of
    //  the text bigger."
    expect(
      condenseHeadline("Canva Brand Kit Setup Step By Step Guide", {
        ...T,
        logoSubject: "Canva",
      }),
    ).toBe("Brand Kit Setup");
  });
});

describe("condenseHeadline — mechanics", () => {
  it("never exceeds the ceiling, whatever the model returns", () => {
    const out = condenseHeadline(
      "The Absolutely Definitive Way To Rebuild Your Entire Accounting Stack",
      { maxWords: 4 },
    );
    expect(out.split(/\s+/)).toHaveLength(4);
  });

  it("strips the 'How To' scaffolding that a title always carries", () => {
    expect(condenseHeadline("How To Track Mileage", { maxWords: 4 })).toBe(
      "Track Mileage",
    );
  });

  it("never leaves a dangling connective at either end", () => {
    // Truncating at the ceiling is what produces these: "Close Books At Month"
    // ending on "At" would read as an unfinished sentence.
    const out = condenseHeadline("Close The Books At Month End In Sage", {
      maxWords: 4,
    });
    expect(out).not.toMatch(/^(the|at|in|of|for|and)\b/i);
    expect(out).not.toMatch(/\b(the|at|in|of|for|and)$/i);
  });

  it("is idempotent — condensing a condensed headline changes nothing", () => {
    const once = condenseHeadline("QuickBooks Online, Get Paid Faster", {
      ...T,
      logoSubject: "QuickBooks",
    });
    expect(condenseHeadline(once, { ...T, logoSubject: "QuickBooks" })).toBe(
      once,
    );
  });

  it("strips the quotes and trailing punctuation models love to add", () => {
    expect(condenseHeadline('  "Get Paid Faster."  ', { maxWords: 4 })).toBe(
      "Get Paid Faster",
    );
  });

  it("returns empty rather than inventing words when nothing survives", () => {
    expect(condenseHeadline("the ultimate guide", { maxWords: 4 })).toBe("");
  });
});

describe("stripBrand", () => {
  it("takes the product qualifier with the name — no stray 'Online'", () => {
    expect(
      stripBrand(
        "Reconcile Bank Transactions In QuickBooks Online",
        "QuickBooks",
      ),
    ).toBe("Reconcile Bank Transactions");
  });

  it("handles multi-word brands, and takes the preposition that introduced them", () => {
    expect(
      stripBrand("Edit Videos In DaVinci Resolve Fast", "DaVinci Resolve"),
    ).toBe("Edit Videos Fast");
  });

  it("leaves an unrelated phrase alone", () => {
    expect(stripBrand("Build A Cash Flow Forecast", "QuickBooks")).toBe(
      "Build A Cash Flow Forecast",
    );
  });

  it("does not match a brand name inside a longer word", () => {
    expect(stripBrand("Sagebrush Reporting Basics", "Sage")).toBe(
      "Sagebrush Reporting Basics",
    );
  });
});

describe("deriveHeadline", () => {
  const base = {
    title: "How To Close The Books At Month End In Sage Accounting",
    operatorHeadline: null,
    maxWords: 4,
    textPolicy: null,
    format: "TUTORIAL_STUDIO",
    logoSubject: "Sage",
  };

  it("condenses what the LLM returns — asking for 3 words is not the same as getting them", () => {
    const result = deriveHeadline({
      ...base,
      llm: async () => "Sage Accounting Month Ends Made Painless Finally",
    });
    return result.then((r) => {
      expect(r.source).toBe("derived");
      expect(r.headline).toBe("Accounting Month Ends");
    });
  });

  it("caps an operator headline at the thumbnail's hard word limit", async () => {
    const r = await deriveHeadline({
      ...base,
      operatorHeadline: "Sage Sage Sage Sage Sage Sage",
      llm: async () => "ignored",
    });
    expect(r).toEqual({
      headline: "Sage Sage Sage Sage",
      source: "operator",
    });
  });

  it("falls back to a CONDENSED title, not the first four words of it", async () => {
    const r = await deriveHeadline({ ...base, llm: undefined });
    expect(r.source).toBe("title_fallback");
    // The old fallback returned "How To Close The" — scaffolding and an article.
    expect(r.headline).not.toMatch(/^How To/i);
    expect(r.headline!.split(/\s+/).length).toBeLessThanOrEqual(4);
  });

  it("still records title_fallback when the LLM throws, and still condenses", async () => {
    const r = await deriveHeadline({
      ...base,
      llm: async () => {
        throw new Error("deepseek 401");
      },
    });
    expect(r.source).toBe("title_fallback");
    expect(r.headline).not.toMatch(/^How To/i);
  });

  it("returns no headline at all when the format asks for none", async () => {
    const r = await deriveHeadline({ ...base, maxWords: 0 });
    expect(r).toEqual({ headline: null, source: "none" });
  });
});
