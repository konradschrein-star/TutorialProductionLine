import { describe, it, expect } from "vitest";
import {
  BusinessHubPlanSchema,
  BusinessHubSceneSchema,
  SourceRefSchema,
  VisualRefSchema,
  extractSourceHost,
  isAllowlistedPrimarySource,
  requiresSource,
  sourceKindForElement,
  HEADLINE_MAX_CHARS,
} from "../../schemas/business-hub-scene.js";

const validVisual = {
  provider: "pexels" as const,
  assetKey: "pexels/8386440.mp4",
  sourceUrl: "https://www.pexels.com/video/8386440/",
  licence: "Pexels License",
  retrievedAt: "2026-08-15T09:31:00.000Z",
};

const titleScene = {
  id: "s01",
  beat: "hook-what-lenders-check",
  kind: "title" as const,
  layout: "clipping" as const,
  text: { eyebrow: "SBA 7(a)", headline: "What the lender actually reads" },
  presenter: null,
  grade: null,
  narration: "Before we get to the numbers, here is what a lender opens first.",
};

const mgStatScene = {
  id: "s07",
  beat: "why-1-25-is-the-number",
  kind: "mg" as const,
  layout: "framed-chart" as const,
  text: { headline: "1.25 is not a preference" },
  element: "FormulaReveal",
  data: { steps: [{ id: "step-1", latex: "DSCR = NOI / ADS" }] },
  presenter: { pose: "holding-pointer", side: "right" as const, pointsAt: "step-2" },
  grade: "cool",
  source: { kind: "primary" as const, ref: "https://www.sba.gov/sop-50-10-7#dscr" },
  narration: "Debt service coverage is net operating income over annual debt service.",
};

const brollScene = {
  id: "s12",
  beat: "bakery-storefront",
  kind: "broll" as const,
  layout: "broll-defocus" as const,
  text: {},
  visual: validVisual,
  presenter: { pose: "arms-at-side", side: "center" as const, pointsAt: null },
  grade: null,
  narration: "Take a bakery doing four hundred thousand a year.",
};

const validPlan = {
  topic: "how to write a business plan for a bakery sba 7a",
  family: "how-to-write-for" as const,
  targetSeconds: 900,
  scenes: [titleScene, mgStatScene, brollScene],
};

describe("BusinessHubPlanSchema", () => {
  it("parses a valid plan", () => {
    const result = BusinessHubPlanSchema.safeParse(validPlan);
    if (!result.success) throw new Error(JSON.stringify(result.error.issues, null, 2));
    expect(result.data.scenes).toHaveLength(3);
    expect(result.data.targetSeconds).toBe(900);
    // null presenter/grade normalise to undefined, not to a fabricated value
    expect(result.data.scenes[0]?.presenter).toBeUndefined();
    expect(result.data.scenes[0]?.grade).toBeUndefined();
  });

  it("rejects duplicate scene ids", () => {
    const result = BusinessHubPlanSchema.safeParse({
      ...validPlan,
      scenes: [titleScene, { ...brollScene, id: "s01" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("duplicate scene id"))).toBe(true);
    }
  });

  it("rejects an empty scene list and a non-positive target", () => {
    expect(BusinessHubPlanSchema.safeParse({ ...validPlan, scenes: [] }).success).toBe(false);
    expect(BusinessHubPlanSchema.safeParse({ ...validPlan, targetSeconds: 0 }).success).toBe(false);
  });
});

describe("BusinessHubSceneSchema — source gate", () => {
  it("REJECTS an mg scene whose element is a stat and has no source", () => {
    const { source: _omitted, ...noSource } = mgStatScene;
    const result = BusinessHubSceneSchema.safeParse({
      ...noSource,
      element: "StatCard",
      data: { value: 1.25, caption: "minimum DSCR" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("source"));
      expect(issue).toBeDefined();
      expect(issue?.message).toContain("requires a source");
    }
  });

  it("REJECTS a formula/quote/comparison/checklist element with no source", () => {
    const { source: _omitted, ...noSource } = mgStatScene;
    for (const element of [
      "FormulaReveal",
      "QuoteCard",
      "ComparisonTable",
      "RequirementChecklist",
    ]) {
      const result = BusinessHubSceneSchema.safeParse({ ...noSource, element });
      expect(result.success, `${element} should require a source`).toBe(false);
    }
  });

  it("accepts an unregistered decorative element with no source", () => {
    const { source: _omitted, ...noSource } = mgStatScene;
    const result = BusinessHubSceneSchema.safeParse({
      ...noSource,
      element: "TimelineWalkGround",
      data: { years: [1, 2, 3] },
    });
    expect(result.success).toBe(true);
  });

  it("REJECTS an mg scene missing data", () => {
    const { data: _omitted, ...noData } = mgStatScene;
    const result = BusinessHubSceneSchema.safeParse(noData);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("data"))).toBe(true);
    }
  });

  it("REJECTS an mg scene missing element", () => {
    const { element: _omitted, ...noElement } = mgStatScene;
    expect(BusinessHubSceneSchema.safeParse(noElement).success).toBe(false);
  });

  it("rejects a non-kebab-case beat and an over-budget headline", () => {
    expect(BusinessHubSceneSchema.safeParse({ ...titleScene, beat: "Hook Scene" }).success).toBe(
      false,
    );
    expect(
      BusinessHubSceneSchema.safeParse({
        ...titleScene,
        text: { headline: "x".repeat(HEADLINE_MAX_CHARS + 1) },
      }).success,
    ).toBe(false);
  });
});

describe("SourceRefSchema", () => {
  it("REJECTS a primary source on a non-allowlisted domain", () => {
    const result = SourceRefSchema.safeParse({
      kind: "primary",
      ref: "https://www.bankrate.com/loans/sba-dscr/",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("not on the allowlist");
    }
  });

  it("accepts every allowlisted domain, bare or as a URL or subdomain", () => {
    const refs = [
      "sba.gov/sop-50-10-7#dscr",
      "https://www.uscis.gov/policy-manual/volume-6-part-g",
      "https://www.govinfo.gov/content/pkg/CFR-2024-title8-vol1/pdf/x.pdf",
      "ecfr.gov/current/title-8/section-204.6",
      "https://www.federalregister.gov/documents/2022/03/15/x",
      "https://www.irs.gov/pub/irs-pdf/p535.pdf",
      "https://data.sba.gov/dataset/7-a-504-foia",
    ];
    for (const ref of refs) {
      expect(SourceRefSchema.safeParse({ kind: "primary", ref }).success, ref).toBe(true);
    }
  });

  it("rejects a lookalike domain that merely ends with the allowlisted string", () => {
    expect(isAllowlistedPrimarySource("https://notsba.gov/x")).toBe(false);
    expect(isAllowlistedPrimarySource("https://sba.gov.example.com/x")).toBe(false);
    expect(SourceRefSchema.safeParse({ kind: "primary", ref: "sba.gov.co/x" }).success).toBe(false);
  });

  it("accepts a repo ref and rejects a URL posing as one", () => {
    expect(
      SourceRefSchema.safeParse({
        kind: "repo",
        ref: "docs/superpowers/specs/2026-08-15-business-plan-hub-format-design.md#7-finance-kit",
      }).success,
    ).toBe(true);
    expect(SourceRefSchema.safeParse({ kind: "repo", ref: "https://sba.gov/x" }).success).toBe(
      false,
    );
  });

  it("extractSourceHost strips scheme, www, port and path", () => {
    expect(extractSourceHost("https://www.sba.gov:443/x?y#z")).toBe("sba.gov");
    expect(extractSourceHost("docs/spec.md#anchor")).toBeUndefined();
  });
});

describe("VisualRefSchema", () => {
  it("parses a complete visual ref", () => {
    expect(VisualRefSchema.safeParse(validVisual).success).toBe(true);
  });

  it("REJECTS a visual ref missing licence", () => {
    const { licence: _omitted, ...noLicence } = validVisual;
    const result = VisualRefSchema.safeParse(noLicence);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("licence"))).toBe(true);
    }
  });

  it("REJECTS a blank licence and every other missing field", () => {
    expect(VisualRefSchema.safeParse({ ...validVisual, licence: "" }).success).toBe(false);
    for (const key of ["provider", "assetKey", "sourceUrl", "retrievedAt"] as const) {
      const partial: Record<string, unknown> = { ...validVisual };
      delete partial[key];
      expect(VisualRefSchema.safeParse(partial).success, `missing ${key}`).toBe(false);
    }
  });

  it("REJECTS a non-ISO retrievedAt", () => {
    expect(VisualRefSchema.safeParse({ ...validVisual, retrievedAt: "2026-08-15" }).success).toBe(
      false,
    );
  });
});

describe("element registry", () => {
  it("maps registered names case- and punctuation-insensitively", () => {
    expect(sourceKindForElement("FormulaReveal")).toBe("formula");
    expect(sourceKindForElement("formula_reveal")).toBe("formula");
    expect(sourceKindForElement("stat")).toBe("stat");
    expect(requiresSource("ComparisonTable")).toBe(true);
    expect(requiresSource("GroundPlate")).toBe(false);
  });
});
