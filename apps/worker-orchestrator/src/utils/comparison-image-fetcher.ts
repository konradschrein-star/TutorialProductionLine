/**
 * Fetches hero images for TECH_COMPARISON products.
 *
 * Strategy (in order):
 *  1. Pexels search with product-tailored queries (landscape, high-res)
 *  2. DuckDuckGo image search fallback (product screenshots / logos)
 *
 * Downloads the best result to LOCAL_MEDIA_ROOT and returns the local path
 * so it can be stored in metadata.comparison.products[].hero_asset_key.
 */

import { join } from "node:path";
import { searchPexelsPhotos, downloadUrlToFile } from "./pexels-client.js";
import { searchDDGImages } from "./duckduckgo-images.js";

export interface ProductImageResult {
  slot: string;
  name: string;
  localPath: string;
  source: "pexels" | "duckduckgo";
  sourceUrl: string;
}

/**
 * Build Pexels search queries for a product name.
 * Tries increasingly generic queries until images are found.
 */
function buildPexelsQueries(productName: string): string[] {
  const lower = productName.toLowerCase();
  return [
    `${productName} software screenshot`,
    `${productName} application interface`,
    `${lower} computer screen`,
    "developer coding laptop screen",
    "software development workspace",
  ];
}

/**
 * Build DuckDuckGo search queries for a product name.
 * More specific — DDG works well for product screenshots.
 */
function buildDDGQueries(productName: string): string[] {
  return [
    `${productName} screenshot interface`,
    `${productName} logo official`,
    `${productName} software`,
  ];
}

/**
 * Fetch a hero image for one product. Tries Pexels first, then DDG.
 * Returns null if all attempts fail (caller decides what to do).
 */
export async function fetchProductHeroImage(
  productName: string,
  slot: string,
  destDir: string,
  pexelsApiKey: string,
): Promise<ProductImageResult | null> {
  const ext = "jpg";
  const filename = `hero_${slot.toLowerCase()}.${ext}`;
  const destPath = join(destDir, filename);

  // ── 1. Pexels ──────────────────────────────────────────────────────────────
  const pexelsQueries = buildPexelsQueries(productName);
  for (const query of pexelsQueries) {
    try {
      const photos = await searchPexelsPhotos(query, pexelsApiKey, {
        perPage: 3,
        orientation: "landscape",
      });
      if (photos.length === 0) continue;

      const photo = photos[0]!;
      await downloadUrlToFile(photo.download_url, destPath);

      console.log(
        `[comparison-images] ${productName} (${slot}): Pexels "${query}" → ${destPath}`,
      );
      return {
        slot,
        name: productName,
        localPath: destPath,
        source: "pexels",
        sourceUrl: photo.attribution.source_url,
      };
    } catch (err) {
      console.warn(
        `[comparison-images] Pexels query "${query}" failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ── 2. DuckDuckGo fallback ─────────────────────────────────────────────────
  const ddgQueries = buildDDGQueries(productName);
  for (const query of ddgQueries) {
    try {
      const results = await searchDDGImages(query, 5);
      // Prefer larger images (>= 600px wide)
      const best =
        results.find((r) => r.width >= 600 && r.height >= 400) ?? results[0];
      if (!best) continue;

      await downloadUrlToFile(best.url, destPath);

      console.log(
        `[comparison-images] ${productName} (${slot}): DDG "${query}" → ${destPath}`,
      );
      return {
        slot,
        name: productName,
        localPath: destPath,
        source: "duckduckgo",
        sourceUrl: best.source,
      };
    } catch (err) {
      console.warn(
        `[comparison-images] DDG query "${query}" failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  console.error(
    `[comparison-images] All image sources exhausted for "${productName}" (${slot})`,
  );
  return null;
}

/**
 * Fetch hero images for all products in a comparison job.
 * Returns a map of slot → localPath for products that succeeded.
 */
export async function fetchComparisonHeroImages(
  products: Array<{
    slot: string;
    name: string;
    hero_asset_key?: string | null;
  }>,
  destDir: string,
  pexelsApiKey: string,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  for (const product of products) {
    if (product.hero_asset_key) {
      // Already has an image — skip
      results.set(product.slot, product.hero_asset_key);
      continue;
    }

    const result = await fetchProductHeroImage(
      product.name,
      product.slot,
      destDir,
      pexelsApiKey,
    );

    if (result) {
      results.set(product.slot, result.localPath);
    }
  }

  return results;
}
