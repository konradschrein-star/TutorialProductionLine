import { describe, it, expect, beforeAll } from "vitest";
import {
  normalizeComparison,
  normalizeComparisonMetadata,
  describeComparisonShape,
} from "../comparison-metadata.js";
import { bootstrapValidation, validateWith } from "../validation/index.js";

/**
 * Regression tests for the TECH_COMPARISON metadata duality.
 *
 * The bug: `metadata.comparison` arrives in two shapes, the ingest pre-flight
 * validator only accepted the flat one, and it runs ~250 lines BEFORE the
 * array→flat fallback in the ingest processor. Every job created from
 * `tech-comparison-form.tsx` (which submits `products[]`) died at ingest with
 * MISSING_REQUIRED_METADATA.
 */
describe("normalizeComparison", () => {
  it("accepts the hub-web create-form shape (products[{slot,name}])", () => {
    const n = normalizeComparison({
      subformat: "TECH_SOFTWARE",
      products: [
        { slot: "A", name: "iPhone 16 Pro", identifier_value: "iphone-16-pro" },
        { slot: "B", name: "Samsung S25 Ultra" },
      ],
    });
    expect(n.hasBothProducts).toBe(true);
    expect(n.productAName).toBe("iPhone 16 Pro");
    expect(n.productBName).toBe("Samsung S25 Ultra");
    expect(n.source).toBe("products");
    // Extra per-product fields survive normalization.
    expect(n.products[0]!["identifier_value"]).toBe("iphone-16-pro");
  });

  it("accepts the flat CLI/ingest-panel shape", () => {
    const n = normalizeComparison({
      product_a_name: "  Logitech MX Master 4 ",
      product_b_name: "Razer Basilisk V3",
    });
    expect(n.hasBothProducts).toBe(true);
    expect(n.productAName).toBe("Logitech MX Master 4");
    expect(n.source).toBe("flat");
    // Synthesizes the products[] array the renderer requires.
    expect(n.products.map((p) => p.slot)).toEqual(["A", "B"]);
  });

  it("fills gaps across shapes", () => {
    const n = normalizeComparison({
      product_a_name: "A-flat",
      products: [{ slot: "B", name: "B-array" }],
    });
    expect(n.productAName).toBe("A-flat");
    expect(n.productBName).toBe("B-array");
    expect(n.source).toBe("mixed");
  });

  it("carries an optional third product and preserves extra slots", () => {
    const n = normalizeComparison({
      products: [
        { slot: "B", name: "B" },
        { slot: "A", name: "A" },
        { slot: "C", name: "C" },
        { slot: "D", name: "D" },
      ],
    });
    expect(n.products.map((p) => p.slot)).toEqual(["A", "B", "C", "D"]);
    expect(n.productCName).toBe("C");
  });

  it("never guesses: missing/blank names report false, not a placeholder", () => {
    expect(normalizeComparison(undefined).hasBothProducts).toBe(false);
    expect(normalizeComparison({}).hasBothProducts).toBe(false);
    expect(
      normalizeComparison({ products: [{ slot: "A", name: "  " }] })
        .hasBothProducts,
    ).toBe(false);
    expect(
      normalizeComparison({ product_a_name: "A", product_b_name: "" })
        .hasBothProducts,
    ).toBe(false);
  });

  it("defaults the subformat and passes data_grid through untouched", () => {
    const grid = { dimensions: ["speed"], scores: { A: { speed: 9 } } };
    const n = normalizeComparison({
      product_a_name: "A",
      product_b_name: "B",
      data_grid: grid,
    });
    expect(n.subformat).toBe("TECH_SOFTWARE");
    expect(n.dataGrid).toBe(grid);
  });

  it("normalizeComparisonMetadata reads the slice off whole job metadata", () => {
    const n = normalizeComparisonMetadata({
      comparison: { product_a_name: "A", product_b_name: "B" },
      unrelated: 1,
    });
    expect(n.hasBothProducts).toBe(true);
  });

  it("describeComparisonShape reports what was actually received", () => {
    expect(describeComparisonShape(undefined)).toContain("missing");
    expect(
      describeComparisonShape({ products: [{ slot: "A", name: "x" }] }),
    ).toContain("products slots: [A]");
  });
});

describe("ingest pre-flight validator — TECH_COMPARISON", () => {
  beforeAll(() => {
    bootstrapValidation();
  });

  const base = {
    channel_id: "11111111-1111-4111-8111-111111111111",
    template_id: "22222222-2222-4222-8222-222222222222",
    format: "TECH_COMPARISON",
  };

  const run = (metadata: unknown) =>
    validateWith(
      "ingest-payload-validator",
      { ...base, metadata },
      {
        jobId: "test",
        stage: "ingest",
        format: "TECH_COMPARISON",
        environment: "production",
      },
    );

  it("accepts the create-form products[] payload (the regression)", async () => {
    const res = await run({
      comparison: {
        subformat: "TECH_SOFTWARE",
        products: [
          { slot: "A", name: "iPhone 16 Pro" },
          { slot: "B", name: "Samsung S25 Ultra" },
        ],
      },
    });
    expect(res.success).toBe(true);
  });

  it("still accepts the flat payload", async () => {
    const res = await run({
      comparison: { product_a_name: "A", product_b_name: "B" },
    });
    expect(res.success).toBe(true);
  });

  it("still rejects a genuinely empty comparison", async () => {
    const res = await run({ comparison: { products: [] } });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors.map((e) => e.code)).toContain("MISSING_PRODUCT_NAMES");
    }
  });

  it("still rejects a missing comparison slice", async () => {
    const res = await run({});
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors.map((e) => e.code)).toContain(
        "MISSING_COMPARISON_METADATA",
      );
    }
  });
});
