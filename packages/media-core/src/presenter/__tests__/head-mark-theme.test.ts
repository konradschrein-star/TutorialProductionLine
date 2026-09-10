import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { themeHeadMarkSvg } from "../head-mark-theme.js";

const REPO_ROOT = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
);
const HEAD_MARK_SVG = join(
  REPO_ROOT,
  "media",
  "style-assets",
  "presenter",
  "mark",
  "head-mark.svg",
);

describe("themeHeadMarkSvg", () => {
  it.skipIf(!existsSync(HEAD_MARK_SVG))("resolves both variables in the real head-mark.svg", async () => {
    const svg = await readFile(HEAD_MARK_SVG, "utf8");
    const themed = themeHeadMarkSvg(svg, {
      markBg: "#0a4174",
      markFg: "#f2f1ec",
    });

    expect(themed).not.toContain("var(--mark-bg");
    expect(themed).not.toContain("var(--mark-fg");
    expect(themed).toContain('fill="#0a4174"');
    expect(themed).toContain('fill="#f2f1ec"');
    expect(themed).toContain('stroke="#f2f1ec"');
    // Geometry is untouched.
    expect(themed).toContain('<circle cx="100" cy="100" r="100"');
  });

  it("handles var() with and without a fallback, and with whitespace", () => {
    const svg =
      '<svg><a fill="var(--mark-bg, #1272b0)"/><b fill="var( --mark-fg )"/>' +
      '<c stroke="var(--mark-fg,#fff)"/></svg>';
    expect(themeHeadMarkSvg(svg, { markBg: "BG", markFg: "FG" })).toBe(
      '<svg><a fill="BG"/><b fill="FG"/><c stroke="FG"/></svg>',
    );
  });

  it("leaves unknown custom properties alone rather than guessing", () => {
    const svg =
      '<svg><a fill="var(--mark-bg, #000)"/><b fill="var(--something-else, #f00)"/></svg>';
    const themed = themeHeadMarkSvg(svg, { markBg: "BG", markFg: "FG" });
    expect(themed).toContain('fill="BG"');
    expect(themed).toContain("var(--something-else, #f00)");
  });

  it("throws when the SVG declares no themeable variable", () => {
    expect(() =>
      themeHeadMarkSvg('<svg><circle fill="#123456"/></svg>', {
        markBg: "BG",
        markFg: "FG",
      }),
    ).toThrow(/declares neither --mark-bg nor --mark-fg/);
  });

  it("throws on empty input or a blank colour", () => {
    expect(() =>
      themeHeadMarkSvg("   ", { markBg: "BG", markFg: "FG" }),
    ).toThrow(/svgText is empty/);
    expect(() =>
      themeHeadMarkSvg('<svg fill="var(--mark-bg)"/>', {
        markBg: " ",
        markFg: "FG",
      }),
    ).toThrow(/both colours are required/);
  });
});
