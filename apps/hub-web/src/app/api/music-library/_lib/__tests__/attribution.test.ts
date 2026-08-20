import { describe, it, expect } from "vitest";
import {
  renderCreditLine,
  buildAttributionReport,
  renderCreditsBlock,
  hasBlockingAttributionGaps,
  type AttributableTrack,
} from "../attribution";

function track(over: Partial<AttributableTrack> = {}): AttributableTrack {
  return {
    id: "t1",
    name: "Some Track",
    creator: null,
    source: "upload",
    license: null,
    source_url: null,
    attribution_required: false,
    attribution_text: null,
    ...over,
  };
}

describe("renderCreditLine", () => {
  it("returns null when there is no creator and no explicit text", () => {
    expect(renderCreditLine(track())).toBeNull();
  });

  it("composes name + creator", () => {
    expect(renderCreditLine(track({ creator: "Kevin MacLeod" }))).toBe(
      '"Some Track" by Kevin MacLeod',
    );
  });

  it("includes the licence when known", () => {
    expect(
      renderCreditLine(
        track({ creator: "Kevin MacLeod", license: "CC BY 4.0" }),
      ),
    ).toBe('"Some Track" by Kevin MacLeod (CC BY 4.0)');
  });

  it("includes the source URL when known", () => {
    expect(
      renderCreditLine(
        track({
          creator: "Kevin MacLeod",
          license: "CC BY 4.0",
          source_url: "https://incompetech.com/x",
        }),
      ),
    ).toBe(
      '"Some Track" by Kevin MacLeod (CC BY 4.0) — https://incompetech.com/x',
    );
  });

  it("uses attribution_text verbatim when set, ignoring composed fields", () => {
    expect(
      renderCreditLine(
        track({
          creator: "Someone Else",
          license: "CC BY 4.0",
          attribution_text: "Music: Exact Wording Required By Licence",
        }),
      ),
    ).toBe("Music: Exact Wording Required By Licence");
  });

  it("treats whitespace-only attribution_text as absent", () => {
    expect(
      renderCreditLine(track({ creator: "A", attribution_text: "   " })),
    ).toBe('"Some Track" by A');
  });

  it("treats a whitespace-only creator as absent", () => {
    expect(renderCreditLine(track({ creator: "  " }))).toBeNull();
  });
});

describe("buildAttributionReport", () => {
  it("skips self-generated Suno tracks — nobody to credit", () => {
    const r = buildAttributionReport([
      track({ id: "s1", source: "suno_ai33", creator: "Suno (AI33)" }),
    ]);
    expect(r.lines).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]?.reason).toMatch(/self-generated/);
  });

  it("still credits a Suno track when the operator forced attribution", () => {
    const r = buildAttributionReport([
      track({
        id: "s1",
        source: "suno_ai33",
        creator: "Suno (AI33)",
        attribution_required: true,
      }),
    ]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]?.required).toBe(true);
  });

  it("still credits a Suno track that carries explicit attribution text", () => {
    const r = buildAttributionReport([
      track({
        id: "s1",
        source: "suno_ai33",
        attribution_text: "Generated with Suno",
      }),
    ]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]?.text).toBe("Generated with Suno");
  });

  it("flags a track that legally needs credit but has no creator", () => {
    const r = buildAttributionReport([
      track({ id: "u1", attribution_required: true }),
    ]);
    expect(r.lines).toHaveLength(0);
    expect(r.unattributable).toHaveLength(1);
    expect(r.unattributable[0]?.trackId).toBe("u1");
    expect(hasBlockingAttributionGaps(r)).toBe(true);
  });

  it("does not flag an uncredited track when attribution is not required", () => {
    const r = buildAttributionReport([track({ id: "u1" })]);
    expect(r.unattributable).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect(hasBlockingAttributionGaps(r)).toBe(false);
  });

  it("de-duplicates identical credit lines across tracks", () => {
    const t = { creator: "Artist X", license: "CC BY 4.0" };
    const r = buildAttributionReport([
      track({ id: "a", name: "Same", ...t }),
      track({ id: "b", name: "Same", ...t }),
      track({ id: "c", name: "Same", ...t }),
    ]);
    expect(r.lines).toHaveLength(1);
  });

  it("keeps distinct lines for distinct tracks by the same artist", () => {
    const r = buildAttributionReport([
      track({ id: "a", name: "One", creator: "Artist X" }),
      track({ id: "b", name: "Two", creator: "Artist X" }),
    ]);
    expect(r.lines).toHaveLength(2);
  });

  it("keeps the strictest requirement when duplicates disagree", () => {
    const r = buildAttributionReport([
      track({
        id: "a",
        name: "Same",
        creator: "X",
        attribution_required: false,
      }),
      track({
        id: "b",
        name: "Same",
        creator: "X",
        attribution_required: true,
      }),
    ]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]?.required).toBe(true);
  });

  it("handles an empty input", () => {
    const r = buildAttributionReport([]);
    expect(r).toEqual({ lines: [], unattributable: [], skipped: [] });
    expect(hasBlockingAttributionGaps(r)).toBe(false);
  });

  it("handles a realistic mixed set", () => {
    const r = buildAttributionReport([
      track({ id: "1", source: "suno_ai33", creator: "Suno (AI33)" }),
      track({
        id: "2",
        name: "Sunny Day",
        source: "upload",
        creator: "Kevin MacLeod",
        license: "CC BY 4.0",
        source_url: "https://incompetech.com",
        attribution_required: true,
      }),
      track({ id: "3", source: "seed", creator: null }),
    ]);
    expect(r.lines).toHaveLength(1);
    expect(r.skipped).toHaveLength(2);
    expect(r.unattributable).toHaveLength(0);
    expect(renderCreditsBlock(r)).toBe(
      'Music\n· "Sunny Day" by Kevin MacLeod (CC BY 4.0) — https://incompetech.com',
    );
  });
});

describe("renderCreditsBlock", () => {
  it("returns an empty string when nothing needs crediting", () => {
    expect(renderCreditsBlock(buildAttributionReport([]))).toBe("");
  });

  it("accepts a custom heading", () => {
    const r = buildAttributionReport([track({ creator: "A" })]);
    expect(renderCreditsBlock(r, { heading: "Soundtrack" })).toBe(
      'Soundtrack\n· "Some Track" by A',
    );
  });
});
