import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { PoseManifestSchema } from "@repo/contracts";
import { themeHeadMarkSvg } from "@repo/media-core";

/**
 * Checks the Studio's server-side pieces against the REAL presenter assets.
 *
 * `media/` is gitignored, so these are skipped wherever it is absent (CI, a
 * fresh clone) rather than failing there. They are not skipped on a box that has
 * the library — which is the box where a Studio bug matters.
 *
 * What they catch that the unit tests cannot: that `poses.json` as it actually
 * exists satisfies the contract the save route validates against, and that every
 * pose's declared `size` matches the PNG on disk. If those disagree, EVERY
 * normalised hitbox is authored against the wrong denominator and the figure is
 * misplaced by exactly that ratio — silently.
 */

const PRESENTER_ROOT = (() => {
  const override = process.env["BUSINESS_HUB_PRESENTER_ROOT"];
  if (override && override.trim().length > 0) return path.resolve(override);
  const media = process.env["LOCAL_MEDIA_ROOT"];
  if (!media) return null;
  return path.resolve(path.join(media, "style-assets", "presenter"));
})();

const HAVE_ASSETS =
  PRESENTER_ROOT !== null &&
  existsSync(path.join(PRESENTER_ROOT, "poses", "poses.json"));

describe.skipIf(!HAVE_ASSETS)("real presenter assets", () => {
  const root = PRESENTER_ROOT as string;

  it("poses.json satisfies the contract the save route enforces", async () => {
    const raw = await readFile(path.join(root, "poses", "poses.json"), "utf8");
    const parsed = PoseManifestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(
        `poses.json does not parse: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
    }
    expect(parsed.data.length).toBeGreaterThan(0);
  });

  it("every declared pose size matches the PNG on disk", async () => {
    const raw = await readFile(path.join(root, "poses", "poses.json"), "utf8");
    const poses = PoseManifestSchema.parse(JSON.parse(raw));
    const mismatches: string[] = [];
    for (const pose of poses) {
      const meta = await sharp(path.join(root, "poses", pose.file)).metadata();
      if (meta.width !== pose.size[0] || meta.height !== pose.size[1]) {
        mismatches.push(
          `${pose.slug}: declared ${pose.size.join("x")}, actual ${meta.width}x${meta.height}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("thumbnails the widest pose without enlarging it", async () => {
    const raw = await readFile(path.join(root, "poses", "poses.json"), "utf8");
    const poses = PoseManifestSchema.parse(JSON.parse(raw));
    const widest = poses.reduce((a, b) => (a.size[0] >= b.size[0] ? a : b));
    const thumb = await sharp(path.join(root, "poses", widest.file))
      .resize({ width: 128, withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const meta = await sharp(thumb).metadata();
    expect(meta.width).toBe(128);
    expect(thumb.byteLength).toBeLessThan(200_000);
  });

  it("rasterises the head mark with its CSS variables resolved", async () => {
    const svg = await readFile(
      path.join(root, "mark", "head-mark.svg"),
      "utf8",
    );
    const themed = themeHeadMarkSvg(svg, {
      markBg: "#1272b0",
      markFg: "#ffffff",
    });
    expect(themed).not.toContain("var(--mark-");

    const png = await sharp(Buffer.from(themed, "utf8"), { density: 384 })
      .resize({
        width: 512,
        height: 512,
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
    expect(meta.hasAlpha).toBe(true);
  });
});
