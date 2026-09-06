import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { renderManualTutorialArtwork } from "../manual-thumbnail.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("renderManualTutorialArtwork", () => {
  it("renders a full-size office thumbnail with the bundled channel font", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tutorial-thumbnail-"));
    temporaryDirectories.push(directory);
    const publicDir = resolve(process.cwd(), "../hub-web/public");
    const outputPath = join(directory, "thumbnail.png");

    await renderManualTutorialArtwork({
      outputPath,
      backgroundPath: join(publicDir, "background/bg_1_1128207.jpg"),
      hostPath: join(publicDir, "English/american-hero.png"),
      logoPath: join(publicDir, "app_logos_png/notion.png"),
      lines: ["MASTER NOTION", "IN 10 MINUTES"],
      accent: "#00b7ff",
      hostSide: "right",
      publicDir,
    });

    const metadata = await sharp(outputPath).metadata();
    expect(metadata.width).toBe(1280);
    expect(metadata.height).toBe(720);
    expect(metadata.format).toBe("png");
  });
});
