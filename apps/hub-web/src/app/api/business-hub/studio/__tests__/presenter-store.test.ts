import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  PresenterStoreError,
  listSampleNarration,
  manifestRevision,
  readPoseManifest,
  resolvePoseImage,
  resolvePresenterRoot,
  safeJoinInside,
  writePoseManifest,
} from "../_lib/presenter-store";

/**
 * These run against a REAL temporary presenter directory, not a mocked fs: the
 * behaviour under test is "what actually lands on disk, and what is refused
 * before it does", and a mocked filesystem would only assert that the mock was
 * called.
 */

let root: string;
let posesDir: string;
const ORIGINAL_ROOT = process.env["BUSINESS_HUB_PRESENTER_ROOT"];
const ORIGINAL_MEDIA = process.env["LOCAL_MEDIA_ROOT"];

/** One entry shaped exactly like the real `poses.json` rows on disk. */
function poseRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    source: "Headless_male_figure_in_suit.jpeg",
    source_size: [2752, 1536],
    crop: [992, 125, 769, 1411],
    coverage: 0.1906,
    soft_edge_px: 43781,
    head_anchor: null,
    slug: "arms-at-side",
    file: "arms-at-side.png",
    size: [769, 1411],
    anchor_status: "needs-calibration",
    ...overrides,
  };
}

/** A complete, legal hitbox set. */
function fullHitboxes(): Record<string, unknown> {
  return {
    head: { center: { x: 0.5, y: 0.09 }, radius: 0.11 },
    collar: { width: 0.24 },
    pointOrigin: { x: 0.62, y: 0.43 },
    pointDirection: { x: 0.8, y: -0.6 },
    safeRegion: { x: 0.02, y: 0.05, w: 0.5, h: 0.8 },
    crop: { x: 0, y: 0, w: 1, h: 1 },
  };
}

async function writeManifest(rows: unknown[]): Promise<void> {
  await writeFile(
    path.join(posesDir, "poses.json"),
    JSON.stringify(rows, null, 2),
    "utf8",
  );
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "cf-presenter-"));
  posesDir = path.join(root, "poses");
  await mkdir(posesDir, { recursive: true });
  await writeFile(path.join(posesDir, "arms-at-side.png"), "not-a-real-png");
  await writeFile(path.join(posesDir, "pointing-up.png"), "not-a-real-png");
  process.env["BUSINESS_HUB_PRESENTER_ROOT"] = root;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  if (ORIGINAL_ROOT === undefined)
    delete process.env["BUSINESS_HUB_PRESENTER_ROOT"];
  else process.env["BUSINESS_HUB_PRESENTER_ROOT"] = ORIGINAL_ROOT;
  if (ORIGINAL_MEDIA === undefined) delete process.env["LOCAL_MEDIA_ROOT"];
  else process.env["LOCAL_MEDIA_ROOT"] = ORIGINAL_MEDIA;
});

describe("resolvePresenterRoot", () => {
  it("prefers the explicit override", () => {
    expect(resolvePresenterRoot()).toBe(path.resolve(root));
  });

  it("falls back to LOCAL_MEDIA_ROOT/style-assets/presenter", () => {
    delete process.env["BUSINESS_HUB_PRESENTER_ROOT"];
    process.env["LOCAL_MEDIA_ROOT"] = path.join(root, "media");
    expect(resolvePresenterRoot()).toBe(
      path.resolve(path.join(root, "media", "style-assets", "presenter")),
    );
  });

  it("throws rather than guessing a media root", () => {
    delete process.env["BUSINESS_HUB_PRESENTER_ROOT"];
    delete process.env["LOCAL_MEDIA_ROOT"];
    expect(() => resolvePresenterRoot()).toThrow(/will not guess/);
  });
});

describe("readPoseManifest", () => {
  it("reads and validates the manifest", async () => {
    await writeManifest([poseRow()]);
    const loaded = await readPoseManifest();
    expect(loaded.poses).toHaveLength(1);
    expect(loaded.poses[0]?.slug).toBe("arms-at-side");
    expect(loaded.poses[0]?.hitboxes).toBeUndefined();
    expect(loaded.revision).toHaveLength(16);
  });

  it("throws a 404 with the path when the manifest is absent", async () => {
    await expect(readPoseManifest()).rejects.toThrow(/Pose manifest not found/);
  });

  it("refuses to proceed on malformed JSON instead of resetting the file", async () => {
    await writeFile(path.join(posesDir, "poses.json"), "{ not json", "utf8");
    await expect(readPoseManifest()).rejects.toThrow(/not valid JSON/);
  });

  it("rejects duplicate slugs", async () => {
    await writeManifest([poseRow(), poseRow({ file: "pointing-up.png" })]);
    await expect(readPoseManifest()).rejects.toThrow(/duplicate pose slug/);
  });
});

describe("writePoseManifest — the fail-closed save gate", () => {
  it("persists a fully calibrated pose and flips the status", async () => {
    await writeManifest([poseRow()]);
    const { revision } = await readPoseManifest();

    const saved = await writePoseManifest(
      [poseRow({ anchor_status: "calibrated", hitboxes: fullHitboxes() })],
      revision,
    );

    const onDisk: unknown = JSON.parse(
      await readFile(path.join(posesDir, "poses.json"), "utf8"),
    );
    expect(Array.isArray(onDisk)).toBe(true);
    const rows = onDisk as Array<Record<string, unknown>>;
    expect(rows[0]?.["anchor_status"]).toBe("calibrated");
    expect(rows[0]?.["hitboxes"]).toEqual(fullHitboxes());
    expect(saved.revision).toHaveLength(16);
  });

  it("REJECTS a pose marked calibrated with a hitbox missing", async () => {
    await writeManifest([poseRow()]);
    const { revision } = await readPoseManifest();

    const partial = fullHitboxes();
    delete partial["collar"];

    await expect(
      writePoseManifest(
        [poseRow({ anchor_status: "calibrated", hitboxes: partial })],
        revision,
      ),
    ).rejects.toThrow(/does not satisfy the pose contract|collar/);

    // Nothing was written.
    const stillOnDisk: unknown = JSON.parse(
      await readFile(path.join(posesDir, "poses.json"), "utf8"),
    );
    expect(
      (stillOnDisk as Array<Record<string, unknown>>)[0]?.["anchor_status"],
    ).toBe("needs-calibration");
  });

  it("REJECTS calibrated with no hitboxes key at all", async () => {
    await writeManifest([poseRow()]);
    const { revision } = await readPoseManifest();
    await expect(
      writePoseManifest([poseRow({ anchor_status: "calibrated" })], revision),
    ).rejects.toThrow(/complete hitbox set/);
  });

  it("rejects a zero pointDirection — pointing nowhere is not a direction", async () => {
    await writeManifest([poseRow()]);
    const { revision } = await readPoseManifest();
    const hitboxes = fullHitboxes();
    hitboxes["pointDirection"] = { x: 0, y: 0 };
    await expect(
      writePoseManifest(
        [poseRow({ anchor_status: "calibrated", hitboxes })],
        revision,
      ),
    ).rejects.toThrow(/zero vector/);
  });

  it("rejects a safeRegion that runs off the edge", async () => {
    await writeManifest([poseRow()]);
    const { revision } = await readPoseManifest();
    const hitboxes = fullHitboxes();
    hitboxes["safeRegion"] = { x: 0.8, y: 0.1, w: 0.5, h: 0.5 };
    await expect(
      writePoseManifest(
        [poseRow({ anchor_status: "calibrated", hitboxes })],
        revision,
      ),
    ).rejects.toThrow(/past the right edge/);
  });

  it("rejects a manifest entry naming a PNG that is not on disk", async () => {
    await writeManifest([poseRow()]);
    const { revision } = await readPoseManifest();
    await expect(
      writePoseManifest([poseRow({ file: "does-not-exist.png" })], revision),
    ).rejects.toThrow(/does not exist/);
  });

  it("409s when the file changed underneath the editor", async () => {
    await writeManifest([poseRow()]);
    const { revision } = await readPoseManifest();
    await writeManifest([poseRow({ coverage: 0.42 })]);

    let caught: unknown;
    try {
      await writePoseManifest([poseRow()], revision);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PresenterStoreError);
    expect((caught as PresenterStoreError).status).toBe(409);
    expect((caught as PresenterStoreError).message).toMatch(/changed on disk/);
  });

  it("writes a backup of the previous manifest before replacing it", async () => {
    await writeManifest([poseRow()]);
    const { revision } = await readPoseManifest();
    await writePoseManifest(
      [poseRow({ anchor_status: "calibrated", hitboxes: fullHitboxes() })],
      revision,
    );
    const backup: unknown = JSON.parse(
      await readFile(path.join(posesDir, "poses.json.bak"), "utf8"),
    );
    expect(
      (backup as Array<Record<string, unknown>>)[0]?.["anchor_status"],
    ).toBe("needs-calibration");
  });

  it("leaves an uncalibrated pose's absent hitboxes absent", async () => {
    await writeManifest([poseRow()]);
    const { revision } = await readPoseManifest();
    await writePoseManifest([poseRow()], revision);
    const rows = JSON.parse(
      await readFile(path.join(posesDir, "poses.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    expect("hitboxes" in (rows[0] ?? {})).toBe(false);
  });
});

describe("resolvePoseImage", () => {
  it("serves a file the manifest declares", async () => {
    await writeManifest([poseRow()]);
    const { absPath, pose } = await resolvePoseImage("arms-at-side.png");
    expect(absPath).toBe(path.join(posesDir, "arms-at-side.png"));
    expect(pose.slug).toBe("arms-at-side");
  });

  it("refuses a file the manifest does not declare, even if it exists", async () => {
    await writeManifest([poseRow()]);
    await expect(resolvePoseImage("pointing-up.png")).rejects.toThrow(
      /No pose in poses.json declares/,
    );
  });
});

describe("safeJoinInside", () => {
  it("blocks separators and traversal", () => {
    expect(() => safeJoinInside(root, "../secrets.txt")).toThrow(
      /path separator/,
    );
    expect(() => safeJoinInside(root, "sub/file.png")).toThrow(
      /path separator/,
    );
    expect(() => safeJoinInside(root, "")).toThrow(/Empty file name/);
  });

  it("allows a plain name", () => {
    expect(safeJoinInside(root, "a.png")).toBe(
      path.join(path.resolve(root), "a.png"),
    );
  });
});

describe("listSampleNarration", () => {
  it("returns an empty list when the directory does not exist", async () => {
    await expect(listSampleNarration()).resolves.toEqual([]);
  });

  it("lists only audio containers, sorted", async () => {
    const dir = path.join(root, "sample-narration");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "b.mp3"), "x");
    await writeFile(path.join(dir, "a.wav"), "xx");
    await writeFile(path.join(dir, "notes.txt"), "xxx");
    const files = await listSampleNarration();
    expect(files.map((f) => f.file)).toEqual(["a.wav", "b.mp3"]);
    expect(files[0]?.sizeBytes).toBe(2);
  });
});

describe("manifestRevision", () => {
  it("changes when the bytes change and is stable otherwise", () => {
    const a = manifestRevision('[{"slug":"x"}]');
    expect(manifestRevision('[{"slug":"x"}]')).toBe(a);
    expect(manifestRevision('[{"slug":"y"}]')).not.toBe(a);
  });
});
