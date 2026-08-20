import { describe, it, expect } from "vitest";
import {
  assessPosture,
  GENERATED_LICENCE,
  isPublishable,
  normaliseLicence,
  requiresAttribution,
  UNKNOWN_LICENCE,
} from "../licence.js";

describe("isPublishable", () => {
  const publishable = [
    GENERATED_LICENCE,
    "Pexels License",
    "CC0",
    "CC0 1.0",
    "cc-by-4.0",
    "CC BY 4.0",
    "CC BY-SA 4.0",
    "cc_by_sa_3.0",
    "Public domain",
    "PD-USGov",
    "No known copyright restrictions",
    "US Government work",
  ];
  for (const licence of publishable) {
    it(`accepts "${licence}"`, () => {
      expect(isPublishable(licence)).toBe(true);
    });
  }

  const refused = [
    "",
    "   ",
    UNKNOWN_LICENCE,
    "CC BY-NC 4.0",
    "CC BY-NC-SA 4.0",
    "CC BY-ND 4.0",
    "All rights reserved",
    "fair use",
    "GFDL",
    "Some licence nobody has heard of",
  ];
  for (const licence of refused) {
    it(`refuses "${licence}"`, () => {
      expect(isPublishable(licence)).toBe(false);
    });
  }

  it("defaults to refusing an unrecognised licence family (fails closed)", () => {
    expect(isPublishable("Bespoke Studio Licence v2")).toBe(false);
  });
});

describe("normaliseLicence", () => {
  it("collapses case, separators and whitespace", () => {
    expect(normaliseLicence("  CC_BY/SA   4.0 ")).toBe("cc by sa 4.0");
  });
});

describe("requiresAttribution", () => {
  it("does not demand credit for CC0, public domain, Pexels or generated", () => {
    expect(requiresAttribution("CC0 1.0")).toBe(false);
    expect(requiresAttribution("Public domain")).toBe(false);
    expect(requiresAttribution("Pexels License")).toBe(false);
    expect(requiresAttribution(GENERATED_LICENCE)).toBe(false);
  });

  it("demands credit for any CC BY variant", () => {
    expect(requiresAttribution("CC BY 4.0")).toBe(true);
    expect(requiresAttribution("CC BY-SA 4.0")).toBe(true);
  });
});

describe("assessPosture", () => {
  it("passes a permissive licence from an authoritative provider", () => {
    const result = assessPosture("wikimedia", "CC BY-SA 4.0");
    expect(result.posture).toBe("publishable");
    expect(result.reason).toBeNull();
  });

  it("flags google results for QC even when the licence string looks fine", () => {
    const result = assessPosture("google", "CC0");
    expect(result.posture).toBe("needs-review");
    expect(result.reason).toContain("authoritative");
  });

  it("flags web results, which are always unknown-licence", () => {
    const result = assessPosture("web", UNKNOWN_LICENCE);
    expect(result.posture).toBe("needs-review");
  });

  it("flags a non-allowlisted licence from an authoritative provider", () => {
    const result = assessPosture("wikimedia", "CC BY-NC 3.0");
    expect(result.posture).toBe("needs-review");
    expect(result.reason).toContain("publishable allowlist");
  });

  it("treats a generated asset as publishable — no third party holds rights", () => {
    expect(assessPosture("generated", GENERATED_LICENCE).posture).toBe(
      "publishable",
    );
  });
});
