/**
 * The ONE end-to-end test in this module: it starts a real Chromium, rasterises
 * real plates, and probes the bytes that come back.
 *
 * Everything else about the plate baker is a pure function and is tested as one.
 * This test exists because "the argv is correct" and "a transparent PNG lands on
 * disk" are different claims, and the second one is the one the render depends
 * on.
 *
 * It SKIPS ITSELF (loudly, with a console note) when no Chromium can be
 * resolved, so a machine without one reports "not verified here" rather than a
 * red test — but it never passes silently: if a browser IS present, the
 * assertions run.
 */

import {
  mkdtemp,
  rm,
  stat,
  readFile,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSegmentCache } from "../../cache/segment-cache.js";
import { bakePlates } from "../index.js";
import { probePngHeader, resolveChromiumExecutable } from "../rasterize.js";
import { PlateError } from "../types.js";

/** The real lockup, inlined so the test does not depend on the gitignored media tree. */
const WATERMARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 152 114" width="152" height="114">
  <g transform="translate(-30,-34)" fill="currentColor">
    <rect x="38" y="112" width="16" height="28" rx="3"/>
    <rect x="59" y="94"  width="16" height="46" rx="3"/>
    <rect x="80" y="76"  width="16" height="64" rx="3"/>
    <circle cx="142" cy="122" r="9"/>
    <g transform="translate(92,36)" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round">
      <path d="M 26,38 A 24,24 0 1 1 50,62 L 50,70"/>
    </g>
  </g>
</svg>`;

let chromium: string | null = null;
let root = "";

beforeAll(async () => {
  try {
    chromium = resolveChromiumExecutable();
  } catch (err) {
    chromium = null;
    console.warn(
      `[plates e2e] SKIPPED — no Chromium on this machine, so rasterisation was NOT ` +
        `verified here: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
    );
  }
  root = await mkdtemp(join(tmpdir(), "bh-plates-"));
});

afterAll(async () => {
  if (root.length > 0) await rm(root, { recursive: true, force: true });
});

/** A minimal but REAL plan: one title card, one b-roll caption, one mg island. */
function plan() {
  return {
    topic: "How to write an SBA business plan",
    family: "how-to-write-for" as const,
    targetSeconds: 900,
    scenes: [
      {
        id: "s01",
        beat: "cold-open",
        kind: "title" as const,
        layout: "studio-set" as const,
        text: {
          eyebrow: "SBA 7(a)",
          headline: "What lenders check first",
          body: "Three ratios decide the file.",
        },
        grade: "ground-default",
        narration: "Lenders check three things before anything else.",
      },
      {
        id: "s02",
        beat: "office-broll",
        kind: "broll" as const,
        layout: "broll-defocus" as const,
        text: { headline: "The file lands on a desk" },
        grade: "ground-inverse",
        narration: "Your plan lands on a desk with forty others.",
      },
      {
        id: "s03",
        beat: "dscr-formula",
        kind: "mg" as const,
        layout: "framed-chart" as const,
        element: "FormulaReveal",
        data: { numerator: "NOI", denominator: "Debt service" },
        source: {
          kind: "primary" as const,
          ref: "https://www.sba.gov/sop-50-10-7",
        },
        text: { headline: "DSCR is one division" },
        grade: "ground-default",
        narration: "DSCR is one division.",
      },
    ],
  };
}

describe("bakePlates (end to end, real Chromium)", () => {
  it("produces non-empty transparent PNGs and the exact shape the render consumes", async () => {
    if (chromium === null) {
      expect(chromium).toBeNull();
      return;
    }

    const outDir = join(root, "job-1");
    const svgPath = join(root, "watermark.svg");
    await mkdir(outDir, { recursive: true });
    await writeFile(svgPath, WATERMARK_SVG, "utf8");

    const cache = createSegmentCache({
      mediaRoot: join(root, "media"),
      mediaExtension: "png",
    });

    const result = await bakePlates({
      plan: plan(),
      theme: "ground-default",
      aspect: "16:9",
      width: 1920,
      height: 1080,
      outDir,
      cache,
      watermarkSvgPath: svgPath,
      chromiumExecutablePath: chromium,
    });

    // ── the shape the render workflow parses ──────────────────────────────
    expect(Object.keys(result.plates).sort()).toEqual([
      "groundPlates",
      "presenter",
      "textPlates",
      "watermarkPngPath",
    ]);
    // Both mats are in play: a title on the default ground and a chapter-style
    // inverse ground reached through the job theme.
    expect(Object.keys(result.plates.groundPlates)).toContain("ground-default");
    // Copy plates exist for the two non-mg scenes that carry text, and NOT for
    // the mg scene, which typesets itself in Remotion.
    expect(Object.keys(result.plates.textPlates).sort()).toEqual([
      "s01",
      "s02",
    ]);
    expect(result.plates.presenter).toBeNull();

    // ── the bytes ─────────────────────────────────────────────────────────
    const ground = result.plates.groundPlates["ground-default"];
    expect(ground).toBeDefined();
    const groundStat = await stat(ground as string);
    expect(groundStat.size).toBeGreaterThan(0);
    const groundHeader = probePngHeader(await readFile(ground as string));
    expect(groundHeader.width).toBe(1920);
    expect(groundHeader.height).toBe(1080);

    for (const sceneId of ["s01", "s02"] as const) {
      const path = result.plates.textPlates[sceneId];
      expect(path).toBeDefined();
      const bytes = await readFile(path as string);
      expect(bytes.length).toBeGreaterThan(0);
      const header = probePngHeader(bytes);
      expect(header.width).toBe(1920);
      expect(header.height).toBe(1080);
      // The copy plate is composited OVER the ground: it must be transparent.
      expect(header.hasAlpha).toBe(true);
    }

    const markBytes = await readFile(result.plates.watermarkPngPath);
    expect(markBytes.length).toBeGreaterThan(0);
    const markHeader = probePngHeader(markBytes);
    expect(markHeader.hasAlpha).toBe(true);
    expect(markHeader.width).toBe(84);
    expect(markHeader.height).toBe(63);

    // ── the measured boxes ────────────────────────────────────────────────
    const box = result.textPlateBoxes["s01"];
    expect(box).toBeDefined();
    expect(box?.usedHeight).toBeGreaterThan(0);
    expect(box?.usedHeight).toBeLessThanOrEqual((box?.height ?? 0) + 1);
    expect(box?.usedWidth).toBeLessThanOrEqual((box?.width ?? 0) + 1);

    expect(result.cacheMisses).toBeGreaterThan(0);

    // ── the cache actually caches ─────────────────────────────────────────
    const second = await bakePlates({
      plan: plan(),
      theme: "ground-default",
      aspect: "16:9",
      width: 1920,
      height: 1080,
      outDir,
      cache,
      watermarkSvgPath: svgPath,
      chromiumExecutablePath: chromium,
    });
    expect(second.cacheMisses).toBe(0);
    expect(second.cacheHits).toBe(result.cacheHits + result.cacheMisses);
    expect(second.plates).toEqual(result.plates);
  }, 240_000);

  it("throws, and commits nothing, when a scene's copy cannot fit its box", async () => {
    if (chromium === null) {
      expect(chromium).toBeNull();
      return;
    }

    const outDir = join(root, "job-2");
    const svgPath = join(root, "watermark.svg");
    await mkdir(outDir, { recursive: true });
    await writeFile(svgPath, WATERMARK_SVG, "utf8");

    const overflowing = plan();
    // A b-roll caption band is the tightest box in the format; 40 sentences of
    // body copy cannot fit it at 32px, and the plate must refuse rather than
    // clip the tail off a published video.
    overflowing.scenes[1] = {
      ...overflowing.scenes[1],
      text: {
        headline: "The file lands on a desk",
        body: "The underwriter reads every page of it. ".repeat(40),
      },
    } as (typeof overflowing.scenes)[1];

    await expect(
      bakePlates({
        plan: overflowing,
        theme: "ground-default",
        aspect: "16:9",
        width: 1920,
        height: 1080,
        outDir,
        cache: createSegmentCache({
          mediaRoot: join(root, "media-2"),
          mediaExtension: "png",
        }),
        watermarkSvgPath: svgPath,
        chromiumExecutablePath: chromium,
      }),
    ).rejects.toThrow(PlateError);
  }, 240_000);
});
