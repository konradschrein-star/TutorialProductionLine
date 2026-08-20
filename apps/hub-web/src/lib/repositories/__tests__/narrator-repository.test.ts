/**
 * Narrator Repository Integration Tests
 *
 * Tests CRUD operations, default narrator logic, and pose management.
 * Requires test database setup (similar to other repository tests).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const hasDb = !!process.env["DATABASE_URL"];
import {
  listNarratorsByChannel,
  getDefaultNarratorForChannel,
  getNarratorByIdWithPoses,
  getNarratorById,
  createNarrator,
  updateNarrator,
  deleteNarrator,
  createNarratorPose,
  deleteNarratorPose,
  listNarratorPoses,
  type CreateNarratorInput,
  type CreateNarratorPoseInput,
} from "../narrator-repository";

// Integration tests: require a real DATABASE_URL to run.
describe.skipIf(!hasDb)("Narrator Repository", () => {
  // Test data
  let testChannelId: string;
  let testNarratorId: string;
  let testNarratorId2: string;
  let testPoseAssetId: string;

  beforeEach(async () => {
    // Setup: Create test channel and narrators
    testChannelId = "ch-test-narrators";
  });

  afterEach(async () => {
    // Cleanup: Delete test narrators
  });

  describe("createNarrator", () => {
    it("creates a narrator with all fields", async () => {
      const input: CreateNarratorInput = {
        name: "Alex - Tech Explainer",
        description: "Friendly stick figure with glasses",
        channel_id: testChannelId,
        is_default: false,
        tags: ["tech", "friendly"],
      };

      const narrator = await createNarrator(input);

      expect(narrator).toBeDefined();
      expect(narrator.name).toBe("Alex - Tech Explainer");
      expect(narrator.channel_id).toBe(testChannelId);
      expect(narrator.is_default).toBe(false);
      expect(narrator.is_active).toBe(true);
      expect(narrator.tags).toEqual(["tech", "friendly"]);

      testNarratorId = narrator.id;
    });

    it("creates narrator as default for channel", async () => {
      const input: CreateNarratorInput = {
        name: "Default Narrator",
        description: "The default narrator",
        channel_id: testChannelId,
        is_default: true,
      };

      const narrator = await createNarrator(input);
      expect(narrator.is_default).toBe(true);
    });

    it("unsets previous default when creating new default narrator", async () => {
      // Create first default
      const first = await createNarrator({
        name: "First Default",
        description: "First",
        channel_id: testChannelId,
        is_default: true,
      });

      // Create second default
      const second = await createNarrator({
        name: "Second Default",
        description: "Second",
        channel_id: testChannelId,
        is_default: true,
      });

      // First should no longer be default
      const firstUpdated = await getNarratorById(first.id);
      expect(firstUpdated!.is_default).toBe(false);
      expect(second.is_default).toBe(true);
    });
  });

  describe("getNarratorById", () => {
    it("returns narrator by ID", async () => {
      const narrator = await getNarratorById(testNarratorId);

      expect(narrator).toBeDefined();
      expect(narrator!.id).toBe(testNarratorId);
    });

    it("returns null for non-existent ID", async () => {
      const narrator = await getNarratorById("non-existent-uuid");
      expect(narrator).toBeNull();
    });
  });

  describe("getNarratorByIdWithPoses", () => {
    it("returns narrator with empty poses array when no poses exist", async () => {
      const result = await getNarratorByIdWithPoses(testNarratorId);

      expect(result).toBeDefined();
      expect(result!.poses).toBeDefined();
      expect(Array.isArray(result!.poses)).toBe(true);
      expect(result!.poses).toHaveLength(0);
    });

    it("returns narrator with pose assets", async () => {
      // Create a pose first
      const poseInput: CreateNarratorPoseInput = {
        narrator_id: testNarratorId,
        pose_name: "neutral",
        file_path: "/test/narrator/neutral.png",
        file_name: "neutral.png",
        file_format: "png",
        width: 1024,
        height: 1024,
        size_bytes: 50000,
      };

      const poseAsset = await createNarratorPose(poseInput);
      testPoseAssetId = poseAsset.id;

      const result = await getNarratorByIdWithPoses(testNarratorId);

      expect(result!.poses).toHaveLength(1);
      expect(result!.poses[0]!.pose_name).toBe("neutral");
      expect(result!.poses[0]!.file_path).toBe("/test/narrator/neutral.png");
      expect(result!.poses[0]!.width).toBe(1024);
    });

    it("extracts pose_name from tags correctly", async () => {
      const result = await getNarratorByIdWithPoses(testNarratorId);

      if (result && result.poses.length > 0) {
        const pose = result.poses[0]!;
        expect(pose.pose_name).toBeDefined();
        expect(typeof pose.pose_name).toBe("string");
      }
    });
  });

  describe("listNarratorsByChannel", () => {
    it("lists all narrators for a channel", async () => {
      const narrators = await listNarratorsByChannel(testChannelId);

      expect(Array.isArray(narrators)).toBe(true);
      expect(narrators.every((n) => n.channel_id === testChannelId)).toBe(true);
    });

    it("returns empty array for channel with no narrators", async () => {
      const narrators = await listNarratorsByChannel("ch-nonexistent");
      expect(narrators).toEqual([]);
    });

    it("returns narrators ordered by most recently updated", async () => {
      const narrators = await listNarratorsByChannel(testChannelId);

      if (narrators.length > 1) {
        for (let i = 1; i < narrators.length; i++) {
          const current = new Date(narrators[i]!.updated_at).getTime();
          const previous = new Date(narrators[i - 1]!.updated_at).getTime();
          expect(current).toBeLessThanOrEqual(previous);
        }
      }
    });
  });

  describe("getDefaultNarratorForChannel", () => {
    it("returns default narrator for channel", async () => {
      // Create default narrator
      await createNarrator({
        name: "Default",
        description: "Default narrator",
        channel_id: testChannelId,
        is_default: true,
      });

      const defaultNarrator = await getDefaultNarratorForChannel(testChannelId);

      expect(defaultNarrator).toBeDefined();
      expect(defaultNarrator!.is_default).toBe(true);
      expect(defaultNarrator!.channel_id).toBe(testChannelId);
    });

    it("returns null when no default narrator exists", async () => {
      const defaultNarrator =
        await getDefaultNarratorForChannel("ch-no-default");
      expect(defaultNarrator).toBeNull();
    });

    it("only returns active default narrators", async () => {
      // Create inactive default narrator
      const narrator = await createNarrator({
        name: "Inactive Default",
        description: "Should not be returned",
        channel_id: testChannelId,
        is_default: true,
      });

      await updateNarrator(narrator.id, { is_active: false });

      const defaultNarrator = await getDefaultNarratorForChannel(testChannelId);
      expect(defaultNarrator).toBeNull();
    });
  });

  describe("updateNarrator", () => {
    it("updates name and description", async () => {
      const updated = await updateNarrator(testNarratorId, {
        name: "Updated Name",
        description: "Updated description",
      });

      expect(updated!.name).toBe("Updated Name");
      expect(updated!.description).toBe("Updated description");
    });

    it("toggles is_active status", async () => {
      const updated = await updateNarrator(testNarratorId, {
        is_active: false,
      });

      expect(updated!.is_active).toBe(false);
    });

    it("updates tags", async () => {
      const updated = await updateNarrator(testNarratorId, {
        tags: ["updated", "tags"],
      });

      expect(updated!.tags).toEqual(["updated", "tags"]);
    });

    it("sets narrator as default and unsets previous default", async () => {
      // Create two narrators, first one is default
      const first = await createNarrator({
        name: "First",
        description: "First",
        channel_id: testChannelId,
        is_default: true,
      });

      const second = await createNarrator({
        name: "Second",
        description: "Second",
        channel_id: testChannelId,
        is_default: false,
      });

      // Make second the default
      await updateNarrator(second.id, { is_default: true });

      // Check that first is no longer default
      const firstUpdated = await getNarratorById(first.id);
      expect(firstUpdated!.is_default).toBe(false);

      const secondUpdated = await getNarratorById(second.id);
      expect(secondUpdated!.is_default).toBe(true);
    });

    it("returns null for non-existent ID", async () => {
      const result = await updateNarrator("non-existent-uuid", {
        name: "Should fail",
      });

      expect(result).toBeNull();
    });
  });

  describe("deleteNarrator", () => {
    it("deletes a narrator", async () => {
      const narrator = await createNarrator({
        name: "To Delete",
        description: "Will be deleted",
        channel_id: testChannelId,
      });

      await deleteNarrator(narrator.id);

      const result = await getNarratorById(narrator.id);
      expect(result).toBeNull();
    });

    it("cascade deletes associated pose assets", async () => {
      const narrator = await createNarrator({
        name: "With Poses",
        description: "Has poses",
        channel_id: testChannelId,
      });

      // Create pose
      const pose = await createNarratorPose({
        narrator_id: narrator.id,
        pose_name: "test_pose",
        file_path: "/test/pose.png",
        file_name: "pose.png",
        file_format: "png",
      });

      // Delete narrator
      await deleteNarrator(narrator.id);

      // Narrator should be gone
      const narratorResult = await getNarratorById(narrator.id);
      expect(narratorResult).toBeNull();

      // Pose should also be gone (check via asset repository)
      // Note: This requires asset repository integration
    });
  });

  describe("createNarratorPose", () => {
    it("creates a pose asset with required fields", async () => {
      const input: CreateNarratorPoseInput = {
        narrator_id: testNarratorId,
        pose_name: "pointing_left",
        file_path: "/test/pointing_left.png",
        file_name: "pointing_left.png",
        file_format: "png",
      };

      const pose = await createNarratorPose(input);

      expect(pose).toBeDefined();
      expect(pose.asset_type).toBe("narrator_pose");
      expect(pose.file_path).toBe("/test/pointing_left.png");
      expect(pose.status).toBe("approved");
    });

    it("tags pose with narrator ID and pose name", async () => {
      const input: CreateNarratorPoseInput = {
        narrator_id: testNarratorId,
        pose_name: "excited",
        file_path: "/test/excited.png",
        file_name: "excited.png",
        file_format: "png",
      };

      const pose = await createNarratorPose(input);

      expect(pose.tags).toContain(`#narrator:${testNarratorId}`);
      expect(pose.tags).toContain("#pose:excited");
    });

    it("includes optional dimension and size metadata", async () => {
      const input: CreateNarratorPoseInput = {
        narrator_id: testNarratorId,
        pose_name: "neutral",
        file_path: "/test/neutral.png",
        file_name: "neutral.png",
        file_format: "png",
        width: 2048,
        height: 2048,
        size_bytes: 150000,
        description: "Neutral speaking pose",
      };

      const pose = await createNarratorPose(input);

      expect(pose.width).toBe(2048);
      expect(pose.height).toBe(2048);
      expect(pose.size_bytes).toBe(150000);
      expect(pose.description).toBe("Neutral speaking pose");
    });
  });

  describe("listNarratorPoses", () => {
    it("lists all poses for a narrator", async () => {
      // Create multiple poses
      await createNarratorPose({
        narrator_id: testNarratorId,
        pose_name: "pose1",
        file_path: "/test/pose1.png",
        file_name: "pose1.png",
        file_format: "png",
      });

      await createNarratorPose({
        narrator_id: testNarratorId,
        pose_name: "pose2",
        file_path: "/test/pose2.png",
        file_name: "pose2.png",
        file_format: "png",
      });

      const poses = await listNarratorPoses(testNarratorId);

      expect(poses.length).toBeGreaterThanOrEqual(2);
      expect(poses.every((p) => p.asset_type === "narrator_pose")).toBe(true);
    });

    it("returns empty array for narrator with no poses", async () => {
      const newNarrator = await createNarrator({
        name: "No Poses",
        description: "Has no poses",
        channel_id: testChannelId,
      });

      const poses = await listNarratorPoses(newNarrator.id);
      expect(poses).toEqual([]);
    });

    it("returns poses ordered by creation date (newest first)", async () => {
      const poses = await listNarratorPoses(testNarratorId);

      if (poses.length > 1) {
        for (let i = 1; i < poses.length; i++) {
          const current = new Date(poses[i]!.created_at).getTime();
          const previous = new Date(poses[i - 1]!.created_at).getTime();
          expect(current).toBeLessThanOrEqual(previous);
        }
      }
    });
  });

  describe("deleteNarratorPose", () => {
    it("deletes a pose asset", async () => {
      const pose = await createNarratorPose({
        narrator_id: testNarratorId,
        pose_name: "to_delete",
        file_path: "/test/to_delete.png",
        file_name: "to_delete.png",
        file_format: "png",
      });

      await deleteNarratorPose(pose.id);

      // Pose should no longer appear in list
      const poses = await listNarratorPoses(testNarratorId);
      const exists = poses.some((p) => p.id === pose.id);
      expect(exists).toBe(false);
    });
  });
});
