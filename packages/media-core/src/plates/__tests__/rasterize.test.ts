import { join, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  METRICS_ELEMENT_ID,
  buildPlateHtml,
  buildRasteriseArgs,
  chromiumCandidates,
  escapeHtml,
  isHeadlessShell,
  parsePlateMetrics,
  probePngHeader,
  remotionPlatformToken,
} from "../rasterize.js";
import { PlateError } from "../types.js";

const NO_PACKAGE_JSON = (): boolean => false;

describe("remotionPlatformToken", () => {
  it("mirrors Remotion's own platform tokens", () => {
    expect(remotionPlatformToken("win32", "x64")).toBe("win64");
    expect(remotionPlatformToken("linux", "x64")).toBe("linux64");
    expect(remotionPlatformToken("linux", "arm64")).toBe("linux-arm64");
    expect(remotionPlatformToken("darwin", "arm64")).toBe("mac-arm64");
    expect(remotionPlatformToken("darwin", "x64")).toBe("mac-x64");
  });

  it("throws on a platform Remotion publishes no build for", () => {
    expect(() => remotionPlatformToken("aix", "x64")).toThrow(PlateError);
  });
});

describe("chromiumCandidates", () => {
  it("puts the repo's own override variable first", () => {
    const candidates = chromiumCandidates({
      platform: "linux",
      arch: "x64",
      env: {
        REMOTION_BROWSER_EXECUTABLE: "/opt/chrome/chrome",
        CHROME_PATH: "/usr/bin/chromium",
      },
      startDir: "/srv/app",
      hasPackageJson: NO_PACKAGE_JSON,
    });
    expect(candidates[0]?.path).toBe("/opt/chrome/chrome");
    expect(candidates[0]?.source).toBe("$REMOTION_BROWSER_EXECUTABLE");
    expect(candidates.map((c) => c.path)).toContain("/usr/bin/chromium");
  });

  it("offers Remotion's download cache at every package.json anchor", () => {
    // Built with node:path so the expectation holds on the Windows dev box and
    // on the Linux render box alike.
    const repo = resolve(sep, "repo");
    const app = join(repo, "apps", "worker-render");
    const cachePath = (anchor: string): string =>
      join(
        anchor,
        "node_modules",
        ".remotion",
        "chrome-headless-shell",
        "linux64",
        "chrome-headless-shell-linux64",
        "chrome-headless-shell",
      );

    const paths = chromiumCandidates({
      platform: "linux",
      arch: "x64",
      env: {},
      startDir: app,
      hasPackageJson: (dir) => dir === repo || dir === app,
    }).map((c) => c.path);

    expect(paths).toContain(cachePath(app));
    expect(paths).toContain(cachePath(repo));
    // The nearest anchor is tried before the repo root.
    expect(paths.indexOf(cachePath(app))).toBeLessThan(
      paths.indexOf(cachePath(repo)),
    );
  });

  it("falls back to the system Chrome the render box hardcodes", () => {
    const candidates = chromiumCandidates({
      platform: "linux",
      arch: "x64",
      env: {},
      startDir: "/srv",
      hasPackageJson: NO_PACKAGE_JSON,
    });
    expect(candidates.map((c) => c.path)).toContain("/usr/bin/google-chrome");
  });

  it("ignores a blank override rather than trying an empty path", () => {
    const candidates = chromiumCandidates({
      platform: "linux",
      arch: "x64",
      env: { REMOTION_BROWSER_EXECUTABLE: "   " },
      startDir: "/srv",
      hasPackageJson: NO_PACKAGE_JSON,
    });
    expect(candidates.every((c) => c.path.trim().length > 0)).toBe(true);
  });
});

describe("isHeadlessShell", () => {
  it("recognises both names Remotion ships", () => {
    expect(isHeadlessShell("/x/chrome-headless-shell")).toBe(true);
    expect(isHeadlessShell("C:\\x\\chrome-headless-shell.exe")).toBe(true);
    expect(isHeadlessShell("/x/headless_shell")).toBe(true);
  });

  it("does not mistake a full Chrome for one", () => {
    expect(isHeadlessShell("/usr/bin/google-chrome")).toBe(false);
  });
});

describe("buildRasteriseArgs", () => {
  const base = {
    executablePath: "/x/chrome-headless-shell",
    htmlPath: "/tmp/plate.html",
    screenshotPath: "/tmp/plate.png",
    width: 1920,
    height: 1080,
    virtualTimeBudgetMs: 2500,
    dumpDom: true,
  };

  it("asks for a TRANSPARENT background — the alpha byte is the point", () => {
    expect(buildRasteriseArgs(base)).toContain(
      "--default-background-color=00000000",
    );
  });

  it("pins the plate size and a 1:1 device scale", () => {
    const args = buildRasteriseArgs(base);
    expect(args).toContain("--window-size=1920,1080");
    expect(args).toContain("--force-device-scale-factor=1");
  });

  it("uses the bare --headless for a headless-shell build", () => {
    expect(buildRasteriseArgs(base)[0]).toBe("--headless");
  });

  it("uses --headless=new for a full Chrome, which ignores the bare flag", () => {
    const args = buildRasteriseArgs({
      ...base,
      executablePath: "/usr/bin/google-chrome",
    });
    expect(args[0]).toBe("--headless=new");
  });

  it("writes the screenshot and loads the page as a file URL, in that order", () => {
    const args = buildRasteriseArgs(base);
    const screenshot = args.findIndex((a) => a.startsWith("--screenshot="));
    const url = args.findIndex((a) => a.startsWith("file://"));
    expect(screenshot).toBeGreaterThan(-1);
    expect(url).toBe(args.length - 1);
    expect(screenshot).toBeLessThan(url);
  });

  it("only dumps the DOM when measurements are wanted", () => {
    expect(buildRasteriseArgs({ ...base, dumpDom: false })).not.toContain(
      "--dump-dom",
    );
    expect(buildRasteriseArgs(base)).toContain("--dump-dom");
  });

  it("throws on a canvas or budget that cannot be rendered", () => {
    expect(() => buildRasteriseArgs({ ...base, width: 0 })).toThrow(PlateError);
    expect(() => buildRasteriseArgs({ ...base, height: 10.5 })).toThrow(
      PlateError,
    );
    expect(() =>
      buildRasteriseArgs({ ...base, virtualTimeBudgetMs: 0 }),
    ).toThrow(PlateError);
  });
});

describe("buildPlateHtml", () => {
  it("keeps html and body transparent so the alpha reaches the PNG", () => {
    const html = buildPlateHtml({
      width: 100,
      height: 50,
      css: "",
      body: "<div></div>",
    });
    expect(html).toMatch(/html, body \{[\s\S]*background: transparent;/);
    expect(html).toContain("width: 100px");
    expect(html).toContain("height: 50px");
  });

  it("hides the metrics element so it can never reach the screenshot", () => {
    const html = buildPlateHtml({
      width: 10,
      height: 10,
      css: "",
      body: "",
      measureScript: "metrics = { a: 1 };",
    });
    expect(html).toContain(`#${METRICS_ELEMENT_ID} { display: none; }`);
    expect(html).toContain(`<pre id="${METRICS_ELEMENT_ID}"></pre>`);
  });

  it("omits the script entirely when nothing is measured", () => {
    const html = buildPlateHtml({ width: 10, height: 10, css: "", body: "" });
    expect(html).not.toContain("<script>");
  });
});

describe("escapeHtml", () => {
  it("neutralises markup in model-written copy", () => {
    expect(escapeHtml("<b>\"x\" & 'y'</b>")).toBe(
      "&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;",
    );
  });
});

describe("parsePlateMetrics", () => {
  it("reads the page's own measurements back out of a dumped DOM", () => {
    const dom = `<html><body><pre id="${METRICS_ELEMENT_ID}">{"usedWidth":10,"usedHeight":20}</pre></body></html>`;
    expect(parsePlateMetrics(dom)).toEqual({ usedWidth: 10, usedHeight: 20 });
  });

  it("returns null when the plate asked for no measurement", () => {
    expect(parsePlateMetrics("<html><body></body></html>")).toBeNull();
    expect(
      parsePlateMetrics(`<pre id="${METRICS_ELEMENT_ID}"></pre>`),
    ).toBeNull();
  });

  it("throws when the page's script blew up rather than trusting the PNG", () => {
    const dom = `<pre id="${METRICS_ELEMENT_ID}">{"error":"boom"}</pre>`;
    expect(() => parsePlateMetrics(dom)).toThrow(/threw in the browser/);
  });

  it("throws on a payload that is not JSON", () => {
    const dom = `<pre id="${METRICS_ELEMENT_ID}">not json</pre>`;
    expect(() => parsePlateMetrics(dom)).toThrow(PlateError);
  });
});

describe("probePngHeader", () => {
  function png(colorType: number, width = 4, height = 3): Buffer {
    const buf = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buf, 0);
    buf.writeUInt32BE(13, 8);
    buf.write("IHDR", 12, "ascii");
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    buf[24] = 8;
    buf[25] = colorType;
    return buf;
  }

  it("reports alpha for RGBA and grey+alpha", () => {
    expect(probePngHeader(png(6)).hasAlpha).toBe(true);
    expect(probePngHeader(png(4)).hasAlpha).toBe(true);
  });

  it("reports NO alpha for RGB and palette", () => {
    expect(probePngHeader(png(2)).hasAlpha).toBe(false);
    expect(probePngHeader(png(3)).hasAlpha).toBe(false);
  });

  it("reads the real dimensions off the IHDR", () => {
    const header = probePngHeader(png(6, 1920, 1080));
    expect(header.width).toBe(1920);
    expect(header.height).toBe(1080);
    expect(header.bitDepth).toBe(8);
  });

  it("throws on a truncated file, a bad signature and a missing IHDR", () => {
    expect(() => probePngHeader(Buffer.alloc(10))).toThrow(/too short/);
    const wrongSig = png(6);
    wrongSig[1] = 0;
    expect(() => probePngHeader(wrongSig)).toThrow(/PNG signature/);
    const wrongChunk = png(6);
    wrongChunk.write("IDAT", 12, "ascii");
    expect(() => probePngHeader(wrongChunk)).toThrow(/not IHDR/);
  });
});
