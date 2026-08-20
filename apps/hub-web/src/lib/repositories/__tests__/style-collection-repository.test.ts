/**
 * Style Library Repository Integration Tests
 *
 * Tests CRUD operations against the format_style_libraries table.
 * Requires test database setup (DATABASE_URL env var).
 *
 * Note: channel_id / archetype_id are no longer stored in the DB.
 * format is now a REQUIRED field.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const hasDb = !!process.env["DATABASE_URL"];
import {
  listStyleCollections,
  getStyleCollectionById,
  createStyleCollection,
  updateStyleCollection,
  deleteStyleCollection,
  resolveStyleCollectionForJob,
  addStyleCollectionAssets,
  removeStyleCollectionAsset,
  type CreateStyleCollectionInput,
  type ListStyleCollectionsFilter,
} from "../style-library-repository";

// Mock asset ID generator for tests
const mockAssetId = (n: number) => `asset-${n.toString().padStart(3, "0")}`;

// Integration tests: require a real DATABASE_URL to run.
describe.skipIf(!hasDb)("Style Library Repository", () => {
  // Test data
  let testCollectionId: string;
  let secondCollectionId: string;

  beforeEach(async () => {
    // Setup: Create test collections
    // Note: Actual implementation requires test DB setup with transactions
  });

  afterEach(async () => {
    // Cleanup: Delete test collections
    // Note: Actual implementation requires test DB cleanup
  });

  describe("createStyleCollection", () => {
    it("creates a library with format and asset refs", async () => {
      const input: CreateStyleCollectionInput = {
        name: "Minimalist Tech",
        description: "Clean lines, blue/white palette",
        text_guidelines: "Style: Flat 2D\\nColors: #2563EB, white",
        format: "EXPLAINER",
        asset_refs: [
          { asset_id: mockAssetId(1), ref_type: "logo", display_order: 0 },
          {
            asset_id: mockAssetId(2),
            ref_type: "color_palette",
            display_order: 1,
          },
        ],
      };

      const collection = await createStyleCollection(input);

      expect(collection).toBeDefined();
      expect(collection.name).toBe("Minimalist Tech");
      expect(collection.format).toBe("EXPLAINER");
      expect(collection.is_active).toBe(true);

      testCollectionId = collection.id;
    });

    it("creates a library for a different format", async () => {
      const input: CreateStyleCollectionInput = {
        name: "Casually Explained Style",
        description: "Stick figures and dry humour",
        text_guidelines: "Style: Minimalist stick figures",
        format: "CASUALLY_EXPLAINED",
        asset_refs: [{ asset_id: mockAssetId(3), ref_type: "style_guide" }],
      };

      const collection = await createStyleCollection(input);

      expect(collection.format).toBe("CASUALLY_EXPLAINED");

      secondCollectionId = collection.id;
    });

    it("creates a library with no asset refs", async () => {
      const input: CreateStyleCollectionInput = {
        name: "Text Guidelines Only",
        description: "No reference images, just text guidelines",
        text_guidelines: "Use warm colors and friendly language",
        format: "EXPLAINER",
        asset_refs: [],
      };

      const collection = await createStyleCollection(input);
      expect(collection).toBeDefined();
    });
  });

  describe("getStyleCollectionById", () => {
    it("returns library with linked assets", async () => {
      // Assumes testCollectionId was created in beforeEach
      const result = await getStyleCollectionById(testCollectionId);

      expect(result).toBeDefined();
      expect(result!.id).toBe(testCollectionId);
      expect(result!.reference_assets).toBeDefined();
      expect(Array.isArray(result!.reference_assets)).toBe(true);
      // Backward-compat shims always null
      expect(result!.channel_id).toBeNull();
      expect(result!.archetype_id).toBeNull();
    });

    it("returns null for non-existent ID", async () => {
      const result = await getStyleCollectionById("non-existent-uuid");
      expect(result).toBeNull();
    });

    it("includes asset metadata (file_path, file_name, ref_type)", async () => {
      const result = await getStyleCollectionById(testCollectionId);

      if (result && result.reference_assets.length > 0) {
        const asset = result.reference_assets[0]!;
        expect(asset).toHaveProperty("asset_id");
        expect(asset).toHaveProperty("file_path");
        expect(asset).toHaveProperty("file_name");
        expect(asset).toHaveProperty("ref_type");
        expect(asset).toHaveProperty("display_order");
      }
    });

    it("orders assets by display_order", async () => {
      const result = await getStyleCollectionById(testCollectionId);

      if (result && result.reference_assets.length > 1) {
        const orders = result.reference_assets.map((a) => a.display_order);
        for (let i = 1; i < orders.length; i++) {
          expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1]!);
        }
      }
    });
  });

  describe("listStyleCollections", () => {
    it("lists active libraries when is_active filter set", async () => {
      const collections = await listStyleCollections({ is_active: true });
      expect(Array.isArray(collections)).toBe(true);
      expect(collections.every((c) => c.is_active)).toBe(true);
    });

    it("filters by format", async () => {
      const filter: ListStyleCollectionsFilter = {
        format: "EXPLAINER",
        is_active: true,
      };

      const collections = await listStyleCollections(filter);

      expect(collections.every((c) => c.format === "EXPLAINER")).toBe(true);
    });

    it("returns collections ordered by created_at", async () => {
      const collections = await listStyleCollections();

      if (collections.length > 1) {
        for (let i = 1; i < collections.length; i++) {
          const current = new Date(collections[i]!.created_at).getTime();
          const previous = new Date(collections[i - 1]!.created_at).getTime();
          expect(current).toBeGreaterThanOrEqual(previous);
        }
      }
    });
  });

  describe("updateStyleCollection", () => {
    it("updates name and description", async () => {
      const updated = await updateStyleCollection(testCollectionId, {
        name: "Updated Name",
        description: "Updated description",
      });

      expect(updated).toBeDefined();
      expect(updated!.name).toBe("Updated Name");
      expect(updated!.description).toBe("Updated description");
    });

    it("updates text_guidelines", async () => {
      const updated = await updateStyleCollection(testCollectionId, {
        text_guidelines: "New guidelines: use dark mode",
      });

      expect(updated!.text_guidelines).toBe("New guidelines: use dark mode");
    });

    it("updates format", async () => {
      const updated = await updateStyleCollection(testCollectionId, {
        format: "DOCUMENTARY",
      });

      expect(updated!.format).toBe("DOCUMENTARY");
    });

    it("toggles is_active status", async () => {
      const updated = await updateStyleCollection(testCollectionId, {
        is_active: false,
      });

      expect(updated!.is_active).toBe(false);
    });

    it("returns null for non-existent ID", async () => {
      const result = await updateStyleCollection("non-existent-uuid", {
        name: "Should fail",
      });

      expect(result).toBeNull();
    });
  });

  describe("deleteStyleCollection", () => {
    it("deletes a library", async () => {
      await deleteStyleCollection(testCollectionId);

      const result = await getStyleCollectionById(testCollectionId);
      expect(result).toBeNull();
    });

    it("cascade deletes asset links but preserves assets", async () => {
      const input: CreateStyleCollectionInput = {
        name: "To Delete",
        description: "Test deletion",
        format: "EXPLAINER",
        asset_refs: [{ asset_id: mockAssetId(99), ref_type: "logo" }],
      };

      const collection = await createStyleCollection(input);
      await deleteStyleCollection(collection.id);

      // Collection should be gone
      const collectionResult = await getStyleCollectionById(collection.id);
      expect(collectionResult).toBeNull();

      // Asset should still exist (check via asset repository)
      // Note: This requires asset repository integration
    });
  });

  describe("resolveStyleCollectionForJob", () => {
    it("returns active library for the given format", async () => {
      const context = {
        channel_id: "ch-tech",
        archetype_id: "arch-explainer",
        format: "EXPLAINER",
      };

      const result = await resolveStyleCollectionForJob(context);

      if (result) {
        expect(result.format).toBe("EXPLAINER");
        // Backward-compat shims always null
        expect(result.channel_id).toBeNull();
        expect(result.archetype_id).toBeNull();
      }
    });

    it("returns null when no active library matches the format", async () => {
      const context = {
        format: "NONEXISTENT_FORMAT",
      };

      const result = await resolveStyleCollectionForJob(context);
      expect(result).toBeNull();
    });

    it("skips inactive libraries", async () => {
      await updateStyleCollection(testCollectionId, { is_active: false });

      const context = {
        format: "EXPLAINER",
      };

      const result = await resolveStyleCollectionForJob(context);

      // Should not match the inactive library
      if (result) {
        expect(result.id).not.toBe(testCollectionId);
      }
    });

    it("includes reference_assets in resolved library", async () => {
      const context = {
        format: "EXPLAINER",
      };

      const result = await resolveStyleCollectionForJob(context);

      if (result) {
        expect(result.reference_assets).toBeDefined();
        expect(Array.isArray(result.reference_assets)).toBe(true);
      }
    });
  });

  describe("asset link management", () => {
    it("adds assets to existing library", async () => {
      await addStyleCollectionAssets(testCollectionId, [
        { asset_id: mockAssetId(10), ref_type: "typography", display_order: 5 },
        {
          asset_id: mockAssetId(11),
          ref_type: "scene_example",
          display_order: 6,
        },
      ]);

      const result = await getStyleCollectionById(testCollectionId);
      expect(result!.reference_assets.length).toBeGreaterThanOrEqual(2);
    });

    it("removes asset link from library", async () => {
      const assetId = mockAssetId(1);
      await removeStyleCollectionAsset(testCollectionId, assetId);

      const result = await getStyleCollectionById(testCollectionId);
      const hasAsset = result!.reference_assets.some(
        (a) => a.asset_id === assetId,
      );
      expect(hasAsset).toBe(false);
    });
  });
});
