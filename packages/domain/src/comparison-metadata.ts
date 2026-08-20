/**
 * TECH_COMPARISON metadata normalizer — THE single source of truth.
 *
 * ## The bug this exists to kill
 *
 * `metadata.comparison` arrives in TWO shapes and always has:
 *
 *   flat:  { product_a_name: "X", product_b_name: "Y" }   ← CLI injectors,
 *                                                           smoke tests, the
 *                                                           /formats ingestion
 *                                                           panel
 *   array: { products: [{ slot: "A", name: "X" }, …] }    ← the hub-web job
 *                                                           create form and the
 *                                                           renderer
 *
 * Four separate places re-implemented the array→flat fallback
 * (`processors/ingest.ts`, `processors/scene-analysis.ts`,
 * `processors/tech-footage-collection.ts`, `workflows/v2-composition.ts`) — and
 * the one place that ran FIRST, the ingest pre-flight validator, did not. So
 * every TECH_COMPARISON job created from its own create form died at ingest
 * with MISSING_REQUIRED_METADATA, ~250 lines before the fallback that would
 * have saved it.
 *
 * The fix is not a fifth copy. Every consumer calls this.
 *
 * Pure, zero-IO, zero-dependency — safe to import from validators, processors,
 * render workflows and the browser.
 */

/** A product slot as the renderer expects it. */
export interface ComparisonProduct {
  slot: string;
  name: string;
  identifier_type?: string;
  identifier_value?: string;
  price_usd?: number | null;
  official_url?: string | null;
  hero_asset_key?: string | null;
  hero_asset_candidates?: unknown[];
  [key: string]: unknown;
}

export interface NormalizedComparison {
  /** Product A name, trimmed. Empty string when absent. */
  productAName: string;
  /** Product B name, trimmed. Empty string when absent. */
  productBName: string;
  /** Optional third product name, trimmed. Empty string when absent. */
  productCName: string;
  /**
   * Canonical products array in slot order (A, B, then C…), preserving any
   * extra per-product fields the caller supplied. Built from `products[]` when
   * present, otherwise synthesized from the flat names.
   */
  products: ComparisonProduct[];
  /** `metadata.comparison.subformat`, defaulted to TECH_SOFTWARE. */
  subformat: string;
  /** Raw `metadata.comparison.data_grid`, untouched (may be undefined). */
  dataGrid: unknown;
  /** True when both A and B resolved to a non-empty name. */
  hasBothProducts: boolean;
  /** Which shape the names actually came from — for diagnostics/logging. */
  source: "flat" | "products" | "mixed" | "none";
}

export const DEFAULT_COMPARISON_SUBFORMAT = "TECH_SOFTWARE";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Pull the `comparison` slice out of a job's `metadata` column. Accepts the
 * whole metadata object; returns null when there is no comparison slice.
 */
export function extractComparison(
  metadata: unknown,
): Record<string, unknown> | null {
  const meta = asRecord(metadata);
  if (!meta) return null;
  return asRecord(meta["comparison"]);
}

/**
 * Normalize a `metadata.comparison` object (NOT the whole metadata) into the
 * canonical shape every consumer wants.
 *
 * Never throws and never guesses a product name — a missing name comes back as
 * `""` with `hasBothProducts === false`, so the caller decides whether that is
 * fatal. (Ingest and footage collection treat it as fatal; the validator turns
 * it into a structured error.)
 */
export function normalizeComparison(comparison: unknown): NormalizedComparison {
  const cmp = asRecord(comparison) ?? {};

  const flatA = trimmedString(cmp["product_a_name"]);
  const flatB = trimmedString(cmp["product_b_name"]);
  const flatC = trimmedString(cmp["product_c_name"]);

  const rawProducts = Array.isArray(cmp["products"])
    ? (cmp["products"] as unknown[])
    : [];
  const bySlot = new Map<string, ComparisonProduct>();
  for (const raw of rawProducts) {
    const p = asRecord(raw);
    if (!p) continue;
    const slot = trimmedString(p["slot"]).toUpperCase();
    const name = trimmedString(p["name"]);
    if (!slot || !name) continue;
    if (!bySlot.has(slot)) {
      bySlot.set(slot, { ...(p as ComparisonProduct), slot, name });
    }
  }

  const arrayA = bySlot.get("A")?.name ?? "";
  const arrayB = bySlot.get("B")?.name ?? "";
  const arrayC = bySlot.get("C")?.name ?? "";

  // Flat names win when present (they are what the validator historically
  // required and what smoke-test injectors set); the array fills the gaps.
  const productAName = flatA || arrayA;
  const productBName = flatB || arrayB;
  const productCName = flatC || arrayC;

  // Which shape each resolved name actually came from.
  const usedFlat = Boolean(flatA || flatB);
  const usedArray = Boolean((!flatA && arrayA) || (!flatB && arrayB));
  let source: NormalizedComparison["source"] = "none";
  if (productAName || productBName) {
    if (usedFlat && usedArray) source = "mixed";
    else if (usedFlat) source = "flat";
    else source = "products";
  }

  // Canonical products array: start from any supplied product objects (so
  // price_usd / hero_asset_key / identifier_* survive), then ensure A and B
  // exist using the resolved names.
  const products: ComparisonProduct[] = [];
  const ensure = (slot: string, name: string) => {
    if (!name) return;
    const existing = bySlot.get(slot);
    products.push(
      existing
        ? { ...existing, slot, name }
        : {
            slot,
            name,
            price_usd: null,
            hero_asset_key: null,
          },
    );
  };
  ensure("A", productAName);
  ensure("B", productBName);
  ensure("C", productCName);
  // Preserve any additional slots (D, E, …) the caller supplied.
  for (const [slot, p] of bySlot) {
    if (slot === "A" || slot === "B" || slot === "C") continue;
    products.push(p);
  }

  return {
    productAName,
    productBName,
    productCName,
    products,
    subformat: trimmedString(cmp["subformat"]) || DEFAULT_COMPARISON_SUBFORMAT,
    dataGrid: cmp["data_grid"],
    hasBothProducts: Boolean(productAName && productBName),
    source,
  };
}

/**
 * Convenience: normalize straight from a job's whole `metadata` column.
 */
export function normalizeComparisonMetadata(
  metadata: unknown,
): NormalizedComparison {
  return normalizeComparison(extractComparison(metadata));
}

/**
 * Human-readable diagnostic for a comparison slice that failed to yield both
 * product names. Used verbatim in thrown errors so an operator can see WHICH
 * shape was received rather than "missing product names".
 */
export function describeComparisonShape(comparison: unknown): string {
  const cmp = asRecord(comparison);
  if (!cmp) return "metadata.comparison is missing or not an object";
  const keys = Object.keys(cmp).sort().join(", ") || "(no keys)";
  const products = Array.isArray(cmp["products"])
    ? (cmp["products"] as unknown[])
    : null;
  const slots = products
    ? products
        .map((p) => trimmedString(asRecord(p)?.["slot"]) || "?")
        .join(", ")
    : "(no products array)";
  return `metadata.comparison keys: [${keys}]; products slots: [${slots}]`;
}
