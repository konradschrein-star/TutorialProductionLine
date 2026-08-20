import { describe, it, expect } from "vitest";
import {
  brandHintFor,
  brandingDirective,
  BRANDING_FROM_TOPIC_FALLBACK,
} from "../brand-hints.js";

describe("brandHintFor", () => {
  it("matches a product inside a longer subject string", () => {
    expect(brandHintFor("Google Meet walkthrough")).toBe("Google Meet green");
    expect(brandHintFor("microsoft excel")).toBe("Excel green");
  });

  it("prefers the longest matching alias", () => {
    // "google sheets" must not lose to a shorter accidental match.
    expect(brandHintFor("Google Sheets")).toBe("Google Sheets green");
  });

  it("returns null for anything it is not sure about — never a guess", () => {
    expect(brandHintFor("Obscure Internal Tool v4")).toBeNull();
    expect(brandHintFor("")).toBeNull();
    expect(brandHintFor(null)).toBeNull();
  });
});

describe("brandingDirective", () => {
  it("demands a large, accurate, officially-coloured logo", () => {
    const d = brandingDirective("QuickBooks", false)!;
    expect(d).toContain("Brand it as QuickBooks");
    expect(d).toContain("a fifth of the frame wide");
    expect(d).toContain("QuickBooks green");
    // No adjective may sit in front of the product name. "ONE big, official,
    // accurately drawn QuickBooks logo" made the model print the words
    // "official quickbooks" into the thumbnail, wordmark and all.
    expect(d).not.toMatch(
      /(official|big|accurate\w*|large)[,\s]+\w*\s*QuickBooks/i,
    );
    // One mark, not several small ones — "rather one big logo than multiple
    // smaller ones", and never a logo inherited from the reference image (a
    // QuickBooks tutorial shipped with the EXCEL logo on 2026-08-06).
    expect(d).toContain("No second copy of it anywhere");
    expect(d).toContain("no other product's logo");
  });

  it("keeps the brand colour off the background — accent, not field", () => {
    // "Why the fuck is the background this washed-out AI yellow?" The old
    // wording was "Lead the palette with Google Slides yellow", and a model
    // leads a palette by flooding the field with it.
    // The white field itself is stated once, by the palette line in the
    // rendered prompt (see brief.test.ts) — saying it here too cost 28
    // characters the archetype's template description needed. What this
    // directive must never do is send the colour anywhere but the accents.
    const d = brandingDirective("Google Slides", false)!;
    expect(d).not.toMatch(/lead the palette/i);
    expect(d).toContain("on the logo, the type and one accent shape");
    expect(d).toContain("nowhere else");
  });

  it("keeps orange inside the logo even when orange IS the brand", () => {
    // The owner rejected orange twice across two reviews. An orange brand still
    // gets an accurate logo; the colour simply stops at its edge.
    const d = brandingDirective("Zapier", false)!;
    expect(d).toContain("Zapier orange appears on the logo ONLY");
    expect(d).not.toMatch(/orange on the logo, the type/i);
  });

  it("puts the logo in the headline lockup when the archetype features one", () => {
    expect(brandingDirective("Notion", true)).toContain(
      "inline in the headline lockup",
    );
    expect(brandingDirective("Notion", false)).toContain(
      "beside the headline or the host",
    );
  });

  it("never invents a colour for an unknown product", () => {
    const d = brandingDirective("Fathom Analytics", false)!;
    expect(d).toContain("never invent one");
    expect(d).toMatch(/Fathom Analytics's own real logo/);
  });

  it("returns null with no subject, so the caller can fall back honestly", () => {
    expect(brandingDirective(null, true)).toBeNull();
    expect(brandingDirective("   ", true)).toBeNull();
    expect(BRANDING_FROM_TOPIC_FALLBACK).toContain(
      "If the topic names a specific software product",
    );
  });
});
