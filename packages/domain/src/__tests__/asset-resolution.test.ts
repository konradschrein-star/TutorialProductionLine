/**
 * Asset Resolution Tests
 *
 * Tests for resolveAssets (tier building) and buildReferenceInjectedPrompt.
 */

import { describe, it, expect } from "vitest";
import {
  REFERENCE_INJECTION_ORDER,
  resolveAssets,
  buildReferenceInjectedPrompt,
} from "../asset-resolution.js";
import type {
  AssetResolutionContext,
  AssetResolutionQuery,
  ResolutionTier,
} from "../asset-resolution.js";

// ---------------------------------------------------------------------------
// REFERENCE_INJECTION_ORDER
// ---------------------------------------------------------------------------

describe("REFERENCE_INJECTION_ORDER", () => {
  it("always starts with style_guide (@img1 — highest weight)", () => {
    expect(REFERENCE_INJECTION_ORDER[0]).toBe("style_guide");
  });

  it("contains character as second slot", () => {
    expect(REFERENCE_INJECTION_ORDER[1]).toBe("character");
  });

  it("contains character_state as third slot", () => {
    expect(REFERENCE_INJECTION_ORDER[2]).toBe("character_state");
  });

  it("contains sequence_seed as fourth slot", () => {
    expect(REFERENCE_INJECTION_ORDER[3]).toBe("sequence_seed");
  });

  it("contains background as fifth slot", () => {
    expect(REFERENCE_INJECTION_ORDER[4]).toBe("background");
  });

  it("contains layout_reference as sixth slot", () => {
    expect(REFERENCE_INJECTION_ORDER[5]).toBe("layout_reference");
  });

  it("has exactly 6 slots", () => {
    expect(REFERENCE_INJECTION_ORDER).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// resolveAssets — helper
// ---------------------------------------------------------------------------

function makeTierMap(tiers: ResolutionTier[]): Record<string, ResolutionTier> {
  return Object.fromEntries(tiers.map((t) => [t.label, t]));
}

// ---------------------------------------------------------------------------
// resolveAssets — full context (all 3 vectors)
// ---------------------------------------------------------------------------

describe("resolveAssets — full context", () => {
  const context: AssetResolutionContext = {
    channel_id: "ch-1",
    archetype_id: "arch-1",
    format: "EXPLAINER",
  };
  const query: AssetResolutionQuery = {
    asset_types: ["style_guide"],
    require_approved: true,
  };

  it("produces 6 tiers when all three context vectors are populated", () => {
    const spec = resolveAssets(context, query);
    expect(spec.tiers).toHaveLength(6);
  });

  it("first tier is channel+archetype+format (priority 1)", () => {
    const spec = resolveAssets(context, query);
    const first = spec.tiers[0]!;
    expect(first.label).toBe("channel+archetype+format");
    expect(first.priority).toBe(1);
    expect(first.channel_id).toBe("ch-1");
    expect(first.archetype_id).toBe("arch-1");
    expect(first.format).toBe("EXPLAINER");
  });

  it("second tier is channel+archetype", () => {
    const spec = resolveAssets(context, query);
    const tier = spec.tiers[1]!;
    expect(tier.label).toBe("channel+archetype");
    expect(tier.channel_id).toBe("ch-1");
    expect(tier.archetype_id).toBe("arch-1");
    expect(tier.format).toBeNull();
  });

  it("third tier is archetype+format", () => {
    const spec = resolveAssets(context, query);
    const tier = spec.tiers[2]!;
    expect(tier.label).toBe("archetype+format");
    expect(tier.channel_id).toBeNull();
    expect(tier.archetype_id).toBe("arch-1");
    expect(tier.format).toBe("EXPLAINER");
  });

  it("fourth tier is channel only", () => {
    const spec = resolveAssets(context, query);
    const tier = spec.tiers[3]!;
    expect(tier.label).toBe("channel");
    expect(tier.channel_id).toBe("ch-1");
    expect(tier.archetype_id).toBeNull();
    expect(tier.format).toBeNull();
  });

  it("fifth tier is archetype only", () => {
    const spec = resolveAssets(context, query);
    const tier = spec.tiers[4]!;
    expect(tier.label).toBe("archetype");
    expect(tier.channel_id).toBeNull();
    expect(tier.archetype_id).toBe("arch-1");
    expect(tier.format).toBeNull();
  });

  it("last tier is always universal (no associations)", () => {
    const spec = resolveAssets(context, query);
    const last = spec.tiers[spec.tiers.length - 1]!;
    expect(last.label).toBe("universal");
    expect(last.channel_id).toBeNull();
    expect(last.archetype_id).toBeNull();
    expect(last.format).toBeNull();
  });

  it("tiers are ordered by ascending priority", () => {
    const spec = resolveAssets(context, query);
    for (let i = 1; i < spec.tiers.length; i++) {
      expect(spec.tiers[i]!.priority).toBeGreaterThan(
        spec.tiers[i - 1]!.priority,
      );
    }
  });

  it("passes asset_types through to spec", () => {
    const spec = resolveAssets(context, query);
    expect(spec.asset_types).toEqual(["style_guide"]);
  });

  it("passes require_approved through to spec", () => {
    const spec = resolveAssets(context, query);
    expect(spec.require_approved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveAssets — partial context (channel only)
// ---------------------------------------------------------------------------

describe("resolveAssets — channel-only context", () => {
  const context: AssetResolutionContext = { channel_id: "ch-42" };
  const query: AssetResolutionQuery = { asset_types: ["background"] };

  it("produces 2 tiers: channel + universal", () => {
    const spec = resolveAssets(context, query);
    expect(spec.tiers).toHaveLength(2);
  });

  it("first tier is channel only", () => {
    const tier = resolveAssets(context, query).tiers[0]!;
    expect(tier.label).toBe("channel");
    expect(tier.channel_id).toBe("ch-42");
  });

  it("last tier is universal", () => {
    const last = resolveAssets(context, query).tiers.at(-1)!;
    expect(last.label).toBe("universal");
  });

  it("defaults require_approved to false when not set", () => {
    const spec = resolveAssets(context, query);
    expect(spec.require_approved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveAssets — archetype-only context
// ---------------------------------------------------------------------------

describe("resolveAssets — archetype-only context", () => {
  const context: AssetResolutionContext = { archetype_id: "arch-xyz" };
  const query: AssetResolutionQuery = { asset_types: ["style_guide"] };

  it("produces 2 tiers: archetype + universal", () => {
    const spec = resolveAssets(context, query);
    expect(spec.tiers).toHaveLength(2);
  });

  it("first tier is archetype only", () => {
    const tier = resolveAssets(context, query).tiers[0]!;
    expect(tier.label).toBe("archetype");
    expect(tier.archetype_id).toBe("arch-xyz");
    expect(tier.channel_id).toBeNull();
    expect(tier.format).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveAssets — empty context
// ---------------------------------------------------------------------------

describe("resolveAssets — empty context", () => {
  const query: AssetResolutionQuery = { asset_types: ["style_guide"] };

  it("produces only the universal tier when context is empty", () => {
    const spec = resolveAssets({}, query);
    expect(spec.tiers).toHaveLength(1);
    expect(spec.tiers[0]!.label).toBe("universal");
  });
});

// ---------------------------------------------------------------------------
// resolveAssets — archetype + format only (no channel)
// ---------------------------------------------------------------------------

describe("resolveAssets — archetype + format (no channel)", () => {
  const context: AssetResolutionContext = {
    archetype_id: "arch-1",
    format: "DOCUMENTARY",
  };
  const query: AssetResolutionQuery = { asset_types: ["style_guide"] };

  it("produces 3 tiers: archetype+format, archetype, universal", () => {
    const spec = resolveAssets(context, query);
    expect(spec.tiers).toHaveLength(3);
  });

  it("includes archetype+format tier", () => {
    const spec = resolveAssets(context, query);
    const tier = spec.tiers.find((t) => t.label === "archetype+format");
    expect(tier).toBeDefined();
    expect(tier!.archetype_id).toBe("arch-1");
    expect(tier!.format).toBe("DOCUMENTARY");
    expect(tier!.channel_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveAssets — tags passthrough
// ---------------------------------------------------------------------------

describe("resolveAssets — tags passthrough", () => {
  it("passes tags through to spec", () => {
    const spec = resolveAssets(
      { channel_id: "ch-1" },
      { asset_types: ["character"], tags: ["portrait", "formal"] },
    );
    expect(spec.tags).toEqual(["portrait", "formal"]);
  });

  it("tags is undefined when not provided", () => {
    const spec = resolveAssets(
      { channel_id: "ch-1" },
      { asset_types: ["character"] },
    );
    expect(spec.tags).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildReferenceInjectedPrompt
// ---------------------------------------------------------------------------

describe("buildReferenceInjectedPrompt", () => {
  const fakeBuffer = (n: number) => new Uint8Array([n]);

  it("returns base prompt unchanged when no slots provided", () => {
    const result = buildReferenceInjectedPrompt({
      basePrompt: "A detailed illustration prompt",
      slots: {},
    });
    expect(result.prompt).toBe("A detailed illustration prompt");
    expect(result.referenceImages).toHaveLength(0);
  });

  it("prepends @img1 for a single style_guide slot", () => {
    const result = buildReferenceInjectedPrompt({
      basePrompt: "Simple flat illustration",
      slots: { style_guide: fakeBuffer(1) },
    });
    expect(result.prompt).toContain("@img1");
    expect(result.referenceImages).toHaveLength(1);
  });

  it("reference image order matches REFERENCE_INJECTION_ORDER", () => {
    const styleBuf = fakeBuffer(1);
    const charBuf = fakeBuffer(2);
    const result = buildReferenceInjectedPrompt({
      basePrompt: "A scene",
      slots: {
        style_guide: styleBuf,
        character: charBuf,
      },
    });
    // style_guide is always @img1, character is @img2
    expect(result.prompt).toContain("@img1");
    expect(result.prompt).toContain("@img2");
    expect(result.referenceImages[0]).toBe(styleBuf);
    expect(result.referenceImages[1]).toBe(charBuf);
  });

  it("skips empty slots and renumbers contiguously", () => {
    // Provide style_guide and background but NOT character or character_state or sequence_seed
    const styleBuf = fakeBuffer(1);
    const bgBuf = fakeBuffer(5);
    const result = buildReferenceInjectedPrompt({
      basePrompt: "Background only test",
      slots: {
        style_guide: styleBuf,
        background: bgBuf,
      },
    });
    // 2 images total — numbered @img1 and @img2 (not @img1, @img5)
    expect(result.prompt).toContain("@img1");
    expect(result.prompt).toContain("@img2");
    expect(result.prompt).not.toContain("@img5");
    expect(result.referenceImages).toHaveLength(2);
    expect(result.referenceImages[0]).toBe(styleBuf);
    expect(result.referenceImages[1]).toBe(bgBuf);
  });

  it("prepends @imgN references before the base prompt", () => {
    const result = buildReferenceInjectedPrompt({
      basePrompt: "The actual prompt text",
      slots: { style_guide: fakeBuffer(1) },
    });
    const imgPos = result.prompt.indexOf("@img1");
    const promptPos = result.prompt.indexOf("The actual prompt text");
    expect(imgPos).toBeLessThan(promptPos);
  });

  it("handles all 5 slots being populated", () => {
    const result = buildReferenceInjectedPrompt({
      basePrompt: "Full five-slot test",
      slots: {
        style_guide: fakeBuffer(1),
        character: fakeBuffer(2),
        character_state: fakeBuffer(3),
        sequence_seed: fakeBuffer(4),
        background: fakeBuffer(5),
      },
    });
    expect(result.referenceImages).toHaveLength(5);
    expect(result.prompt).toContain("@img1");
    expect(result.prompt).toContain("@img5");
  });

  it("injects layout_reference at @img6 when all slots filled", () => {
    const styleGuide = fakeBuffer(1);
    const character = fakeBuffer(2);
    const charState = fakeBuffer(3);
    const seqSeed = fakeBuffer(4);
    const background = fakeBuffer(5);
    const layout = fakeBuffer(6);

    const result = buildReferenceInjectedPrompt({
      basePrompt: "Composite image with three sections",
      slots: {
        style_guide: styleGuide,
        character,
        character_state: charState,
        sequence_seed: seqSeed,
        background,
        layout_reference: layout,
      },
    });

    expect(result.prompt).toMatch(/^@img1 @img2 @img3 @img4 @img5 @img6 /);
    expect(result.prompt).toContain("Composite image with three sections");
    expect(result.referenceImages).toHaveLength(6);
    expect(result.referenceImages[5]).toBe(layout);
  });

  it("renumbers when middle slots are empty (layout_reference case)", () => {
    const styleGuide = fakeBuffer(1);
    const layout = fakeBuffer(6);

    const result = buildReferenceInjectedPrompt({
      basePrompt: "Simple composite",
      slots: {
        style_guide: styleGuide,
        layout_reference: layout,
      },
    });

    expect(result.prompt).toMatch(/^@img1 @img2 /);
    expect(result.prompt).toContain("Simple composite");
    expect(result.referenceImages).toHaveLength(2);
    expect(result.referenceImages[0]).toBe(styleGuide);
    expect(result.referenceImages[1]).toBe(layout);
  });
});
