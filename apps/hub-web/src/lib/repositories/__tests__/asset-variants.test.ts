import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, assets } from "../../db";
import {
  createAsset,
  getAssetWithVariants,
  getParentAsset,
  getVariants,
  type CreateAssetInput,
} from "../asset-repository";

// Integration tests: require a real DATABASE_URL to run.
const hasDb = !!process.env["DATABASE_URL"];

describe.skipIf(!hasDb)("Asset Variants", () => {
  let parentAsset: any;
  let variantAsset1: any;
  let variantAsset2: any;

  beforeEach(async () => {
    // Clean up any existing test assets
    await db.delete(assets);

    // Create parent asset
    const parentInput: CreateAssetInput = {
      name: "Original Video",
      description: "High quality original",
      asset_type: "video",
      file_name: "original.mp4",
      file_format: "mp4",
      size_bytes: 100_000_000,
      width: 1920,
      height: 1080,
      duration_seconds: 120,
    };
    parentAsset = await createAsset(parentInput);

    // Create variant 1: Compressed
    const variant1Input: CreateAssetInput = {
      name: "Compressed Video",
      description: "Compressed version",
      asset_type: "video",
      file_name: "compressed.mp4",
      file_format: "mp4",
      size_bytes: 20_000_000,
      width: 1920,
      height: 1080,
      duration_seconds: 120,
      parent_asset_id: parentAsset.id,
      variant_type: "compressed",
      variant_metadata: { bitrate: "2M", resolution: "1920x1080" },
    };
    variantAsset1 = await createAsset(variant1Input);

    // Create variant 2: Mobile
    const variant2Input: CreateAssetInput = {
      name: "Mobile Video",
      description: "Mobile optimized",
      asset_type: "video",
      file_name: "mobile.mp4",
      file_format: "mp4",
      size_bytes: 5_000_000,
      width: 720,
      height: 1280,
      duration_seconds: 120,
      parent_asset_id: parentAsset.id,
      variant_type: "mobile",
      variant_metadata: { bitrate: "1M", resolution: "720x1280" },
    };
    variantAsset2 = await createAsset(variant2Input);
  });

  describe("getAssetWithVariants", () => {
    it("should return asset with all variants", async () => {
      const result = await getAssetWithVariants(parentAsset.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(parentAsset.id);
      expect(result?.variants).toHaveLength(2);
      expect(result?.variants.map((v: any) => v.id)).toContain(
        variantAsset1.id,
      );
      expect(result?.variants.map((v: any) => v.id)).toContain(
        variantAsset2.id,
      );
    });

    it("should return null for non-existent asset", async () => {
      const result = await getAssetWithVariants(
        "00000000-0000-0000-0000-000000000000",
      );
      expect(result).toBeNull();
    });

    it("should return asset with empty variants array if no variants", async () => {
      const result = await getAssetWithVariants(variantAsset1.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(variantAsset1.id);
      expect(result?.variants).toHaveLength(0);
    });
  });

  describe("getParentAsset", () => {
    it("should return parent asset for a variant", async () => {
      const result = await getParentAsset(variantAsset1.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(parentAsset.id);
      expect(result?.name).toBe("Original Video");
    });

    it("should return null for asset without parent", async () => {
      const result = await getParentAsset(parentAsset.id);
      expect(result).toBeNull();
    });

    it("should return null for non-existent asset", async () => {
      const result = await getParentAsset(
        "00000000-0000-0000-0000-000000000000",
      );
      expect(result).toBeNull();
    });
  });

  describe("getVariants", () => {
    it("should return all variants of a parent asset", async () => {
      const variants = await getVariants(parentAsset.id);

      expect(variants).toHaveLength(2);
      expect(variants.map((v) => v.id)).toContain(variantAsset1.id);
      expect(variants.map((v) => v.id)).toContain(variantAsset2.id);

      const compressed = variants.find((v) => v.variant_type === "compressed");
      expect(compressed?.variant_metadata).toMatchObject({
        bitrate: "2M",
        resolution: "1920x1080",
      });

      const mobile = variants.find((v) => v.variant_type === "mobile");
      expect(mobile?.variant_metadata).toMatchObject({
        bitrate: "1M",
        resolution: "720x1280",
      });
    });

    it("should return empty array for asset without variants", async () => {
      const variants = await getVariants(variantAsset1.id);
      expect(variants).toHaveLength(0);
    });

    it("should return empty array for non-existent asset", async () => {
      const variants = await getVariants(
        "00000000-0000-0000-0000-000000000000",
      );
      expect(variants).toHaveLength(0);
    });
  });

  describe("variant metadata", () => {
    it("should preserve variant type and metadata", async () => {
      const result = await getAssetWithVariants(parentAsset.id);

      const compressed = result?.variants.find(
        (v: any) => v.variant_type === "compressed",
      );
      expect(compressed?.variant_type).toBe("compressed");
      expect(compressed?.variant_metadata).toMatchObject({
        bitrate: "2M",
        resolution: "1920x1080",
      });

      const mobile = result?.variants.find(
        (v: any) => v.variant_type === "mobile",
      );
      expect(mobile?.variant_type).toBe("mobile");
      expect(mobile?.variant_metadata).toMatchObject({
        bitrate: "1M",
        resolution: "720x1280",
      });
    });
  });
});
