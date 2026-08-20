/**
 * assets repository tests
 *
 * Covers:
 * - Insert with all required fields → retrievable
 * - Default field values (background_removed, status, origin, tags)
 * - Select assets by channel_id returns only that channel's assets
 * - generation_recipe JSONB round-trip
 *
 * All tests are skipped automatically when DATABASE_TEST_URL is not set.
 */

import { eq } from "drizzle-orm";
import {
  describeDb,
  getTestDb,
  truncateAll,
  closeTestDb,
} from "../setup/test-db.js";
import { channels, assets } from "../../schema/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function insertChannel(suffix?: string) {
  const db = getTestDb();
  const [channel] = await db
    .insert(channels)
    .values({
      youtube_channel_id: `yt-assets-test-${suffix ?? crypto.randomUUID()}`,
      name: `Asset Test Channel ${suffix ?? ""}`.trim(),
    })
    .returning();
  return channel!;
}

async function insertAsset(
  overrides: Partial<typeof assets.$inferInsert> = {}
) {
  const db = getTestDb();
  const [asset] = await db
    .insert(assets)
    .values({
      name: "Test Asset",
      description: "A test asset for unit tests",
      asset_type: "background",
      file_name: "test-bg.png",
      file_format: "png",
      ...overrides,
    })
    .returning();
  return asset!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeDb("assets repository", () => {
  beforeAll(async () => {
    await truncateAll();
  });

  beforeEach(async () => {
    // Only delete assets rows between tests; other fixture tables are wiped in
    // beforeAll/afterAll to avoid expensive full truncations per test.
    const db = getTestDb();
    await db.delete(assets);
  });

  afterAll(async () => {
    await truncateAll();
    await closeTestDb();
  });

  // -------------------------------------------------------------------------
  it("inserts an asset with all required fields and retrieves it", async () => {
    const db = getTestDb();
    const inserted = await insertAsset({
      name: "Office Background",
      description: "A clean office background for broadcast content",
      asset_type: "background",
      file_name: "office-bg.png",
      file_format: "png",
      file_path: "/media/assets/office-bg.png",
      width: 1920,
      height: 1080,
      size_bytes: 2048000,
    });

    expect(inserted.id).toBeTruthy();

    const [selected] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, inserted.id));

    expect(selected).toBeDefined();
    expect(selected!.name).toBe("Office Background");
    expect(selected!.asset_type).toBe("background");
    expect(selected!.file_path).toBe("/media/assets/office-bg.png");
    expect(selected!.width).toBe(1920);
    expect(selected!.height).toBe(1080);
    expect(selected!.size_bytes).toBe(2048000);
  });

  // -------------------------------------------------------------------------
  it("defaults background_removed to false", async () => {
    const asset = await insertAsset();
    expect(asset.background_removed).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("defaults status to 'draft'", async () => {
    const asset = await insertAsset();
    expect(asset.status).toBe("draft");
  });

  // -------------------------------------------------------------------------
  it("defaults origin to 'ai_generated'", async () => {
    const asset = await insertAsset();
    expect(asset.origin).toBe("ai_generated");
  });

  // -------------------------------------------------------------------------
  it("defaults tags to an empty array", async () => {
    const asset = await insertAsset();
    expect(Array.isArray(asset.tags)).toBe(true);
    expect(asset.tags).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  it("selects assets by channel_id and returns only that channel's assets", async () => {
    const db = getTestDb();
    const channelA = await insertChannel("A");
    const channelB = await insertChannel("B");

    // Insert 2 assets for channel A
    await insertAsset({
      name: "Asset A1",
      description: "Channel A asset 1",
      asset_type: "background",
      file_name: "a1.png",
      file_format: "png",
      channel_id: channelA.id,
    });
    await insertAsset({
      name: "Asset A2",
      description: "Channel A asset 2",
      asset_type: "object",
      file_name: "a2.png",
      file_format: "png",
      channel_id: channelA.id,
    });

    // Insert 1 asset for channel B
    await insertAsset({
      name: "Asset B1",
      description: "Channel B asset 1",
      asset_type: "background",
      file_name: "b1.png",
      file_format: "png",
      channel_id: channelB.id,
    });

    const channelAAssets = await db
      .select()
      .from(assets)
      .where(eq(assets.channel_id, channelA.id));

    expect(channelAAssets).toHaveLength(2);
    const names = channelAAssets.map((a) => a.name).sort();
    expect(names).toEqual(["Asset A1", "Asset A2"]);
  });

  // -------------------------------------------------------------------------
  it("round-trips a generation_recipe object (JSONB)", async () => {
    const db = getTestDb();

    const recipe = {
      model: "stable-diffusion-xl",
      prompt_template: "A minimalist flat illustration of {{subject}}",
      seed: 42,
      parameters: { steps: 30, cfg_scale: 7.5, sampler: "dpm++" },
      generated_at: new Date().toISOString(),
      cost_credits: 1,
    };

    const inserted = await insertAsset({
      name: "AI Background",
      description: "AI generated background",
      asset_type: "background",
      file_name: "ai-bg.png",
      file_format: "png",
      origin: "ai_generated",
      generation_recipe: recipe,
    });

    const [retrieved] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, inserted.id));

    expect(retrieved!.generation_recipe).toEqual(recipe);
    expect((retrieved!.generation_recipe as typeof recipe).model).toBe(
      "stable-diffusion-xl"
    );
    expect(
      (retrieved!.generation_recipe as typeof recipe).parameters.cfg_scale
    ).toBe(7.5);
  });

  // -------------------------------------------------------------------------
  it("stores and retrieves tags array", async () => {
    const db = getTestDb();

    const inserted = await insertAsset({
      name: "Tagged Asset",
      description: "Asset with tags",
      asset_type: "character_state",
      file_name: "char-neutral.png",
      file_format: "png",
      tags: ["#state:neutral", "#character:main", "#no-background"],
    });

    const [retrieved] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, inserted.id));

    expect(retrieved!.tags).toHaveLength(3);
    expect(retrieved!.tags).toContain("#state:neutral");
    expect(retrieved!.tags).toContain("#no-background");
  });
});
