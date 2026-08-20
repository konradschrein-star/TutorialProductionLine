/**
 * Style Collection Resolution Tests
 *
 * Tests for style collection tiered resolution algorithm matching
 * the resolveStyleCollectionForJob repository function.
 */

import { describe, it, expect } from "vitest";

// Mock types matching the repository interface
interface StyleCollectionContext {
  channel_id: string;
  archetype_id?: string | null;
  format: string;
}

interface ResolutionTier {
  label: string;
  priority: number;
  channel_id: string | null;
  archetype_id: string | null;
  format: string | null;
}

/**
 * Build resolution tiers in priority order for style collection lookup.
 * Matches the algorithm in style-collection-repository.ts
 */
function buildResolutionTiers(
  context: StyleCollectionContext,
): ResolutionTier[] {
  const tiers: ResolutionTier[] = [];

  // Tier 1: channel + archetype + format
  if (context.archetype_id) {
    tiers.push({
      label: "channel+archetype+format",
      priority: 1,
      channel_id: context.channel_id,
      archetype_id: context.archetype_id,
      format: context.format,
    });
  }

  // Tier 2: channel + archetype (universal format)
  if (context.archetype_id) {
    tiers.push({
      label: "channel+archetype",
      priority: 2,
      channel_id: context.channel_id,
      archetype_id: context.archetype_id,
      format: null,
    });
  }

  // Tier 3: archetype + format (universal channel)
  if (context.archetype_id) {
    tiers.push({
      label: "archetype+format",
      priority: 3,
      channel_id: null,
      archetype_id: context.archetype_id,
      format: context.format,
    });
  }

  // Tier 4: channel only
  tiers.push({
    label: "channel",
    priority: 4,
    channel_id: context.channel_id,
    archetype_id: null,
    format: null,
  });

  // Tier 5: archetype only
  if (context.archetype_id) {
    tiers.push({
      label: "archetype",
      priority: 5,
      channel_id: null,
      archetype_id: context.archetype_id,
      format: null,
    });
  }

  // Tier 6: universal (all null)
  tiers.push({
    label: "universal",
    priority: 6,
    channel_id: null,
    archetype_id: null,
    format: null,
  });

  return tiers;
}

// ---------------------------------------------------------------------------
// Full context (channel + archetype + format)
// ---------------------------------------------------------------------------

describe("buildResolutionTiers — full context", () => {
  const context: StyleCollectionContext = {
    channel_id: "ch-tech",
    archetype_id: "arch-explainer",
    format: "EXPLAINER",
  };

  it("produces 6 tiers when all dimensions are populated", () => {
    const tiers = buildResolutionTiers(context);
    expect(tiers).toHaveLength(6);
  });

  it("first tier is channel+archetype+format (highest priority)", () => {
    const tiers = buildResolutionTiers(context);
    const first = tiers[0]!;
    expect(first.label).toBe("channel+archetype+format");
    expect(first.priority).toBe(1);
    expect(first.channel_id).toBe("ch-tech");
    expect(first.archetype_id).toBe("arch-explainer");
    expect(first.format).toBe("EXPLAINER");
  });

  it("second tier is channel+archetype (universal format)", () => {
    const tiers = buildResolutionTiers(context);
    const tier = tiers[1]!;
    expect(tier.label).toBe("channel+archetype");
    expect(tier.channel_id).toBe("ch-tech");
    expect(tier.archetype_id).toBe("arch-explainer");
    expect(tier.format).toBeNull();
  });

  it("third tier is archetype+format (universal channel)", () => {
    const tiers = buildResolutionTiers(context);
    const tier = tiers[2]!;
    expect(tier.label).toBe("archetype+format");
    expect(tier.channel_id).toBeNull();
    expect(tier.archetype_id).toBe("arch-explainer");
    expect(tier.format).toBe("EXPLAINER");
  });

  it("fourth tier is channel only", () => {
    const tiers = buildResolutionTiers(context);
    const tier = tiers[3]!;
    expect(tier.label).toBe("channel");
    expect(tier.channel_id).toBe("ch-tech");
    expect(tier.archetype_id).toBeNull();
    expect(tier.format).toBeNull();
  });

  it("fifth tier is archetype only", () => {
    const tiers = buildResolutionTiers(context);
    const tier = tiers[4]!;
    expect(tier.label).toBe("archetype");
    expect(tier.channel_id).toBeNull();
    expect(tier.archetype_id).toBe("arch-explainer");
    expect(tier.format).toBeNull();
  });

  it("last tier is always universal (all null)", () => {
    const tiers = buildResolutionTiers(context);
    const last = tiers[tiers.length - 1]!;
    expect(last.label).toBe("universal");
    expect(last.channel_id).toBeNull();
    expect(last.archetype_id).toBeNull();
    expect(last.format).toBeNull();
  });

  it("tiers are ordered by ascending priority", () => {
    const tiers = buildResolutionTiers(context);
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i]!.priority).toBeGreaterThan(tiers[i - 1]!.priority);
    }
  });
});

// ---------------------------------------------------------------------------
// Partial context (channel only, no archetype)
// ---------------------------------------------------------------------------

describe("buildResolutionTiers — channel-only context", () => {
  const context: StyleCollectionContext = {
    channel_id: "ch-news",
    archetype_id: null,
    format: "DOCUMENTARY",
  };

  it("produces 2 tiers when archetype is missing", () => {
    const tiers = buildResolutionTiers(context);
    expect(tiers).toHaveLength(2);
  });

  it("first tier is channel only", () => {
    const tiers = buildResolutionTiers(context);
    const first = tiers[0]!;
    expect(first.label).toBe("channel");
    expect(first.channel_id).toBe("ch-news");
    expect(first.archetype_id).toBeNull();
    expect(first.format).toBeNull();
  });

  it("last tier is universal", () => {
    const tiers = buildResolutionTiers(context);
    const last = tiers[tiers.length - 1]!;
    expect(last.label).toBe("universal");
    expect(last.channel_id).toBeNull();
    expect(last.archetype_id).toBeNull();
    expect(last.format).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("buildResolutionTiers — edge cases", () => {
  it("handles undefined archetype_id as null", () => {
    const context: StyleCollectionContext = {
      channel_id: "ch-1",
      archetype_id: undefined,
      format: "TECH_COMPARISON",
    };

    const tiers = buildResolutionTiers(context);
    expect(tiers).toHaveLength(2); // channel + universal
    expect(tiers[0]!.label).toBe("channel");
    expect(tiers[1]!.label).toBe("universal");
  });

  it("never produces duplicate tiers", () => {
    const context: StyleCollectionContext = {
      channel_id: "ch-1",
      archetype_id: "arch-1",
      format: "EXPLAINER",
    };

    const tiers = buildResolutionTiers(context);
    const labels = tiers.map((t) => t.label);
    const uniqueLabels = new Set(labels);
    expect(uniqueLabels.size).toBe(labels.length);
  });

  it("all tiers have unique priorities", () => {
    const context: StyleCollectionContext = {
      channel_id: "ch-1",
      archetype_id: "arch-1",
      format: "EXPLAINER",
    };

    const tiers = buildResolutionTiers(context);
    const priorities = tiers.map((t) => t.priority);
    const uniquePriorities = new Set(priorities);
    expect(uniquePriorities.size).toBe(priorities.length);
  });
});

// ---------------------------------------------------------------------------
// Specific format scenarios
// ---------------------------------------------------------------------------

describe("buildResolutionTiers — format variations", () => {
  it("handles EXPLAINER format correctly", () => {
    const context: StyleCollectionContext = {
      channel_id: "ch-tech",
      archetype_id: "arch-educational",
      format: "EXPLAINER",
    };

    const tiers = buildResolutionTiers(context);
    expect(tiers[0]!.format).toBe("EXPLAINER");
    expect(tiers[2]!.format).toBe("EXPLAINER"); // archetype+format tier
  });

  it("handles DOCUMENTARY format correctly", () => {
    const context: StyleCollectionContext = {
      channel_id: "ch-news",
      archetype_id: "arch-anchor",
      format: "DOCUMENTARY",
    };

    const tiers = buildResolutionTiers(context);
    expect(tiers[0]!.format).toBe("DOCUMENTARY");
  });

  it("handles TECH_COMPARISON format correctly", () => {
    const context: StyleCollectionContext = {
      channel_id: "ch-tech",
      archetype_id: "arch-review",
      format: "TECH_COMPARISON",
    };

    const tiers = buildResolutionTiers(context);
    expect(tiers[0]!.format).toBe("TECH_COMPARISON");
  });
});
