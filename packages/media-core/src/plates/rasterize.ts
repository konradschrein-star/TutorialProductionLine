/**
 * BUSINESS_PLAN_HUB — still rasteriser.
 *
 * Turns an SVG document or an HTML fragment into a transparent PNG at an exact
 * pixel size, using the Chromium that Remotion already ships. One process per
 * plate, no CDP, no puppeteer: `chrome-headless-shell --screenshot` writes the
 * PNG and `--dump-dom` hands back the measurements the page took of its own
 * layout, in the SAME invocation (verified on this box — both flags are honoured
 * in one run).
 *
 * Why a browser at all: it is the only text layout engine in the stack. FFmpeg's
 * `drawtext` has no wrapping, no font fallback and no letter-spacing, and
 * `media-core` has no image library (there is no `sharp` here, and this repo's
 * ffmpeg is built WITHOUT librsvg — verified 2026-08-15, `-i head-mark.svg`
 * fails with "no decoder found for: svg"). Chromium is already on the box for
 * Remotion, so a handful of still rasterisations per video is the cheapest
 * correct answer.
 *
 * Fail-closed rules in this file:
 * - No Chromium resolvable → throw listing every path tried. Never a placeholder.
 * - Non-zero exit, or no file written → throw with the browser's stderr.
 * - The produced PNG is PROBED: signature, IHDR dimensions and colour type are
 *   read off the bytes. A plate that was supposed to be transparent and came
 *   back without an alpha channel throws rather than being composited as an
 *   opaque rectangle over the scene.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { PLATE_LOG_PREFIX, PlateError } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Chromium resolution
// ─────────────────────────────────────────────────────────────────────────────

/** A candidate browser binary and where the idea came from. */
export interface ChromiumCandidate {
  path: string;
  /** Human-readable provenance, used in the "nothing found" diagnostic. */
  source: string;
}

/** Inputs to {@link chromiumCandidates}. Injected so the search is unit-testable. */
export interface ChromiumSearchContext {
  platform: NodeJS.Platform;
  arch: string;
  env: NodeJS.ProcessEnv;
  /** Directory the walk up towards the repo root starts from. */
  startDir: string;
  /** Predicate used to find the package.json anchors Remotion caches next to. */
  hasPackageJson: (dir: string) => boolean;
}

/**
 * Remotion's platform token for its browser cache directory.
 *
 * Mirrors `getPlatform()` in
 * `@remotion/renderer/dist/browser/BrowserFetcher.js`.
 *
 * @throws {PlateError} On a platform Remotion does not publish a build for.
 */
export function remotionPlatformToken(
  platform: NodeJS.Platform,
  arch: string,
): string {
  switch (platform) {
    case "darwin":
      return arch === "arm64" ? "mac-arm64" : "mac-x64";
    case "linux":
      return arch === "arm64" ? "linux-arm64" : "linux64";
    case "win32":
      return "win64";
    default:
      throw new PlateError(
        `${PLATE_LOG_PREFIX} unsupported platform ${JSON.stringify(platform)}: Remotion ` +
          `publishes no Chromium build for it, so no plate can be rasterised here.`,
      );
  }
}

/**
 * Every place a Chromium might live, in priority order.
 *
 * PURE — touches no filesystem. {@link resolveChromiumExecutable} is what picks
 * the first candidate that exists.
 *
 * Order, and why:
 *  1. `REMOTION_BROWSER_EXECUTABLE` — the variable the rest of this repo already
 *     honours (`workflows/caption-overlay-pass.ts:214`). An operator override
 *     must win.
 *  2. `PUPPETEER_EXECUTABLE_PATH` / `CHROME_PATH` — the two conventional names,
 *     accepted so a box configured for another tool needs no second variable.
 *  3. Remotion's own download cache, `node_modules/.remotion/...`, for every
 *     package.json anchor from the process cwd up to the filesystem root. This
 *     is the binary `ensureBrowser()` fetches, and the reason this module needs
 *     no download of its own.
 *  4. The system Chrome. `/usr/bin/google-chrome` is what
 *     `remotion/render.ts:27` hardcodes on the render box.
 */
export function chromiumCandidates(
  ctx: ChromiumSearchContext,
): ChromiumCandidate[] {
  const out: ChromiumCandidate[] = [];

  for (const name of [
    "REMOTION_BROWSER_EXECUTABLE",
    "PUPPETEER_EXECUTABLE_PATH",
    "CHROME_PATH",
  ] as const) {
    const value = ctx.env[name];
    if (typeof value === "string" && value.trim().length > 0) {
      out.push({ path: value.trim(), source: `$${name}` });
    }
  }

  const token = remotionPlatformToken(ctx.platform, ctx.arch);
  const shellNames =
    ctx.platform === "win32"
      ? ["chrome-headless-shell.exe"]
      : // Remotion ships `headless_shell` on linux-arm64 and Amazon Linux 2023,
        // `chrome-headless-shell` elsewhere. Both are tried; only one exists.
        ["chrome-headless-shell", "headless_shell"];
  const chromeNames =
    ctx.platform === "win32"
      ? [join(`chrome-${token}`, "chrome.exe")]
      : ctx.platform === "darwin"
        ? [
            join(
              `chrome-${token}`,
              "Google Chrome for Testing.app",
              "Contents",
              "MacOS",
              "Google Chrome for Testing",
            ),
          ]
        : [join(`chrome-${token}`, "chrome")];

  for (const anchor of packageJsonAnchors(ctx.startDir, ctx.hasPackageJson)) {
    const remotionDir = join(anchor, "node_modules", ".remotion");
    for (const shell of shellNames) {
      out.push({
        path: join(
          remotionDir,
          "chrome-headless-shell",
          token,
          `chrome-headless-shell-${token}`,
          shell,
        ),
        source: `Remotion browser cache under ${anchor}`,
      });
    }
    for (const chrome of chromeNames) {
      out.push({
        path: join(remotionDir, "chrome-for-testing", token, chrome),
        source: `Remotion browser cache under ${anchor}`,
      });
    }
  }

  for (const systemPath of systemChromePaths(ctx.platform, ctx.env)) {
    out.push({ path: systemPath, source: "system Chrome install" });
  }

  return out;
}

/** Directories from `startDir` up to the root that contain a package.json. */
function packageJsonAnchors(
  startDir: string,
  hasPackageJson: (dir: string) => boolean,
): string[] {
  const anchors: string[] = [];
  let dir = resolve(startDir);
  for (;;) {
    if (hasPackageJson(dir)) anchors.push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return anchors;
}

/** Conventional install locations of a full Chrome/Chromium, per platform. */
function systemChromePaths(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  switch (platform) {
    case "linux":
      return [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
      ];
    case "darwin":
      return [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ];
    case "win32": {
      const roots = [
        env["ProgramFiles"],
        env["ProgramFiles(x86)"],
        env["LOCALAPPDATA"],
      ].filter((r): r is string => typeof r === "string" && r.length > 0);
      return roots.map((root) =>
        join(root, "Google", "Chrome", "Application", "chrome.exe"),
      );
    }
    default:
      return [];
  }
}

/** Options for {@link resolveChromiumExecutable}. */
export interface ResolveChromiumOptions {
  /** Skip the search entirely and use this binary. Must exist. */
  executablePath?: string;
  /** Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to `process.cwd()`. */
  startDir?: string;
}

/**
 * Find the Chromium to rasterise with.
 *
 * @returns The first candidate from {@link chromiumCandidates} that exists on disk.
 * @throws {PlateError} If nothing exists, listing every path tried. The list is
 *   the point: "no Chromium" on a render box is an install problem, and a
 *   diagnostic that does not say where it looked cannot be acted on.
 */
export function resolveChromiumExecutable(
  options: ResolveChromiumOptions = {},
): string {
  if (options.executablePath !== undefined) {
    if (!existsSync(options.executablePath)) {
      throw new PlateError(
        `${PLATE_LOG_PREFIX} the Chromium executable passed in does not exist: ` +
          `${options.executablePath}`,
      );
    }
    return options.executablePath;
  }

  const candidates = chromiumCandidates({
    platform: process.platform,
    arch: process.arch,
    env: options.env ?? process.env,
    startDir: options.startDir ?? process.cwd(),
    hasPackageJson: (dir) => existsSync(join(dir, "package.json")),
  });

  for (const candidate of candidates) {
    if (existsSync(candidate.path)) return candidate.path;
  }

  throw new PlateError(
    `${PLATE_LOG_PREFIX} no Chromium could be resolved, so no plate can be baked. ` +
      `Set REMOTION_BROWSER_EXECUTABLE, or run Remotion's ensureBrowser() once to ` +
      `populate node_modules/.remotion. Tried:\n` +
      candidates.map((c) => `  - ${c.path}  (${c.source})`).join("\n"),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// argv
// ─────────────────────────────────────────────────────────────────────────────

/**
 * True when the binary is a headless-shell build.
 *
 * It decides the headless flag: `chrome-headless-shell` is headless by
 * construction and takes the bare `--headless`, while a full Chrome from 132
 * onwards ignores the bare flag and would open a WINDOW — which on a headless
 * render box means the screenshot never happens.
 */
export function isHeadlessShell(executablePath: string): boolean {
  const name = basename(executablePath).toLowerCase();
  return (
    name.startsWith("chrome-headless-shell") ||
    name.startsWith("headless_shell")
  );
}

/** Inputs to {@link buildRasteriseArgs}. */
export interface RasteriseArgsParams {
  executablePath: string;
  /** Absolute path of the HTML file to load. */
  htmlPath: string;
  /** Absolute path the PNG is written to. */
  screenshotPath: string;
  width: number;
  height: number;
  /**
   * Virtual clock the page is allowed to burn before the screenshot. Fonts,
   * layout and any `requestAnimationFrame` settle inside it; the process exits
   * as soon as the budget is spent, so a bigger number costs nothing on a page
   * that settles immediately.
   */
  virtualTimeBudgetMs: number;
  /** Also print the settled DOM to stdout, to read the page's own measurements back. */
  dumpDom: boolean;
}

/**
 * The exact argv used to rasterise one plate.
 *
 * PURE, and unit-tested, because this argv IS the rendering contract: the
 * transparent background comes from `--default-background-color=00000000` (RGBA
 * hex — the alpha byte is the whole point), the plate size from `--window-size`,
 * and the 1:1 pixel mapping from `--force-device-scale-factor=1`. Getting any of
 * the three wrong produces a plate that composites wrong rather than one that
 * fails, which is why they are asserted in a test rather than eyeballed.
 *
 * @throws {PlateError} If the canvas is not positive integers, or the virtual
 *   time budget is not a positive finite number.
 */
export function buildRasteriseArgs(params: RasteriseArgsParams): string[] {
  if (!Number.isInteger(params.width) || params.width <= 0) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} buildRasteriseArgs: width must be a positive integer, got ` +
        `${String(params.width)}.`,
    );
  }
  if (!Number.isInteger(params.height) || params.height <= 0) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} buildRasteriseArgs: height must be a positive integer, got ` +
        `${String(params.height)}.`,
    );
  }
  if (
    !Number.isFinite(params.virtualTimeBudgetMs) ||
    params.virtualTimeBudgetMs <= 0
  ) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} buildRasteriseArgs: virtualTimeBudgetMs must be > 0, got ` +
        `${String(params.virtualTimeBudgetMs)}.`,
    );
  }

  const args = [
    isHeadlessShell(params.executablePath) ? "--headless" : "--headless=new",
    "--disable-gpu",
    // The render box runs workers as root; without this Chromium refuses to start.
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    // RGBA. The alpha byte is what makes the plate composite over the scene
    // instead of blanking it.
    "--default-background-color=00000000",
    `--window-size=${params.width},${params.height}`,
    `--virtual-time-budget=${Math.round(params.virtualTimeBudgetMs)}`,
  ];
  if (params.dumpDom) args.push("--dump-dom");
  args.push(`--screenshot=${params.screenshotPath}`);
  args.push(pathToFileURL(params.htmlPath).href);
  return args;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML
// ─────────────────────────────────────────────────────────────────────────────

/** Id of the element the page writes its own measurements into. */
export const METRICS_ELEMENT_ID = "bh-metrics";

/** Escape text for interpolation into an HTML text node or attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Inputs to {@link buildPlateHtml}. */
export interface PlateHtmlParams {
  /** Plate width in px. Becomes the viewport and the `<body>` size. */
  width: number;
  /** Plate height in px. */
  height: number;
  /** CSS for the plate. Injected verbatim into a `<style>`. */
  css: string;
  /** Markup for the plate. Injected verbatim into `<body>`. */
  body: string;
  /**
   * A script body that must assign a JSON-serialisable object to `metrics`.
   * It runs after layout; its result is printed by `--dump-dom` and read back by
   * {@link parsePlateMetrics}. Omit for a plate that needs no measurement.
   */
  measureScript?: string;
}

/**
 * Build the standalone HTML document for one plate.
 *
 * PURE, and unit-tested. `background: transparent` on `html`/`body` is what lets
 * `--default-background-color=00000000` reach the PNG; a plate that sets a body
 * background would come back opaque and blank the layer beneath it.
 *
 * The metrics element is `display:none` so it can never appear in the
 * screenshot, and its content is plain JSON (digits, quotes, letters) so DOM
 * serialisation cannot escape any of it.
 */
export function buildPlateHtml(params: PlateHtmlParams): string {
  const measure =
    params.measureScript === undefined
      ? ""
      : `<script>
(function () {
  var out = document.getElementById(${JSON.stringify(METRICS_ELEMENT_ID)});
  try {
    var metrics = null;
    ${params.measureScript}
    out.textContent = JSON.stringify(metrics);
  } catch (err) {
    out.textContent = JSON.stringify({ error: String((err && err.message) || err) });
  }
})();
</script>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: ${params.width}px;
    height: ${params.height}px;
    background: transparent;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  #${METRICS_ELEMENT_ID} { display: none; }
${params.css}
</style>
</head>
<body>
${params.body}
<pre id="${METRICS_ELEMENT_ID}"></pre>
${measure}
</body>
</html>
`;
}

/** Whatever the page measured. Shape is decided by the caller's measure script. */
export type PlateMetrics = Record<string, unknown>;

/**
 * Pull the measurement JSON back out of a `--dump-dom` payload.
 *
 * @returns The parsed object, or `null` when the document carried no metrics
 *   element (a plate that asked for no measurement).
 * @throws {PlateError} If the element is present but its content is not valid
 *   JSON, or the page's own measure script recorded an error. Both mean the
 *   layout never happened, and a plate whose layout never happened must not be
 *   trusted just because a PNG appeared next to it.
 */
export function parsePlateMetrics(dom: string): PlateMetrics | null {
  const match = new RegExp(
    `<pre id="${METRICS_ELEMENT_ID}"[^>]*>([\\s\\S]*?)</pre>`,
  ).exec(dom);
  if (match === null) return null;
  const raw = (match[1] ?? "").trim();
  if (raw.length === 0 || raw === "null") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} the page's measurement payload is not valid JSON: ${raw.slice(0, 400)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} the page's measurement payload is not an object: ${raw.slice(0, 400)}`,
    );
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record["error"] === "string") {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} the plate's measure script threw in the browser: ` +
        `${record["error"]}`,
    );
  }
  return record;
}

// ─────────────────────────────────────────────────────────────────────────────
// PNG probe
// ─────────────────────────────────────────────────────────────────────────────

/** What the PNG header actually says. Read off the bytes, never assumed. */
export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  /** PNG colour type: 0 grey, 2 RGB, 3 palette, 4 grey+alpha, 6 RGBA. */
  colorType: number;
  /** True for colour types 4 and 6. */
  hasAlpha: boolean;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Read a PNG's IHDR.
 *
 * PURE. This is the "do not assume" check: Chromium is asked for a transparent
 * screenshot, and whether it actually produced one is decided by byte 25 of the
 * file, not by the flag we passed.
 *
 * @param bytes - The first bytes of the file; 33 are enough.
 * @throws {PlateError} If the signature or the IHDR chunk is not there.
 */
export function probePngHeader(bytes: Buffer): PngHeader {
  if (bytes.length < 33) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} file is ${bytes.length} bytes — too short to be a PNG.`,
    );
  }
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} file does not carry the PNG signature (starts with ` +
        `${bytes.subarray(0, 8).toString("hex")}).`,
    );
  }
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} first PNG chunk is not IHDR, so the file is not a plate ` +
        `this module produced.`,
    );
  }
  const colorType = bytes[25] ?? -1;
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24] ?? -1,
    colorType,
    hasAlpha: colorType === 4 || colorType === 6,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rasterisation
// ─────────────────────────────────────────────────────────────────────────────

/** Inputs to {@link rasterisePlate}. */
export interface RasterisePlateParams {
  /** The document, from {@link buildPlateHtml}. */
  html: string;
  /** Absolute path the PNG is written to. Its directory is created. */
  outputPath: string;
  width: number;
  height: number;
  /** Scratch directory for the temporary `.html`. Created if absent. */
  workDir: string;
  /** Named in every diagnostic (e.g. `scene "s07" (dscr-formula) copy plate`). */
  context: string;
  /** Resolved Chromium. Pass one to avoid re-resolving per plate. */
  executablePath?: string;
  /** Require an alpha channel in the result. Default `true`. */
  expectAlpha?: boolean;
  /** Default 2500ms. */
  virtualTimeBudgetMs?: number;
  /** Hard timeout for the browser process. Default 60000ms. */
  timeoutMs?: number;
}

/** What one rasterisation produced. */
export interface RasterisePlateResult {
  pngPath: string;
  bytes: number;
  header: PngHeader;
  /** Whatever the page's measure script reported, or `null`. */
  metrics: PlateMetrics | null;
}

/**
 * Rasterise one HTML document to a PNG and verify what came back.
 *
 * @returns The path, its size, its probed header and the page's own metrics.
 * @throws {PlateError} If Chromium cannot be resolved or exits non-zero, if no
 *   file is written, if the file is zero bytes, if it is not a PNG, if its
 *   dimensions are not the ones requested, or if `expectAlpha` is set and the
 *   PNG has no alpha channel. Every one of those leaves NOTHING on disk at
 *   `outputPath` — a partial plate is removed rather than left for a later stage
 *   to composite.
 */
export async function rasterisePlate(
  params: RasterisePlateParams,
): Promise<RasterisePlateResult> {
  const executablePath = params.executablePath ?? resolveChromiumExecutable();
  const expectAlpha = params.expectAlpha ?? true;

  await mkdir(params.workDir, { recursive: true });
  await mkdir(dirname(params.outputPath), { recursive: true });

  const htmlPath = join(
    params.workDir,
    `plate-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}.html`,
  );
  await writeFile(htmlPath, params.html, "utf8");

  // A stale file from an earlier attempt must not be mistaken for this one's
  // output, so the target is cleared before the browser runs.
  await rm(params.outputPath, { force: true });

  const args = buildRasteriseArgs({
    executablePath,
    htmlPath,
    screenshotPath: params.outputPath,
    width: params.width,
    height: params.height,
    virtualTimeBudgetMs: params.virtualTimeBudgetMs ?? 2500,
    dumpDom: true,
  });

  try {
    const run = await runChromium(
      executablePath,
      args,
      params.timeoutMs ?? 60_000,
    );

    if (run.code !== 0) {
      throw new PlateError(
        `${PLATE_LOG_PREFIX} ${params.context}: Chromium exited ${String(run.code)}` +
          `${run.signal === null ? "" : ` (signal ${run.signal})`} while rasterising the ` +
          `plate.\n  binary: ${executablePath}\n  stderr: ${run.stderr.slice(-2000)}`,
      );
    }

    const fileStat = await statOrNull(params.outputPath);
    if (fileStat === null) {
      throw new PlateError(
        `${PLATE_LOG_PREFIX} ${params.context}: Chromium exited 0 but wrote no file to ` +
          `${params.outputPath}.\n  stderr: ${run.stderr.slice(-2000)}`,
      );
    }
    if (fileStat.size === 0) {
      throw new PlateError(
        `${PLATE_LOG_PREFIX} ${params.context}: the rasteriser produced a ZERO-BYTE PNG at ` +
          `${params.outputPath}. A zero-byte plate is a failed render, never a plate.`,
      );
    }

    const head = await readFile(params.outputPath);
    const header = probePngHeader(head);

    if (header.width !== params.width || header.height !== params.height) {
      throw new PlateError(
        `${PLATE_LOG_PREFIX} ${params.context}: expected a ${params.width}x${params.height} ` +
          `plate but the PNG is ${header.width}x${header.height}. A mis-sized plate would be ` +
          `silently scaled by the compositor.`,
      );
    }
    if (expectAlpha && !header.hasAlpha) {
      throw new PlateError(
        `${PLATE_LOG_PREFIX} ${params.context}: the PNG has no alpha channel (colour type ` +
          `${header.colorType}). This plate is composited OVER the scene, so an opaque plate ` +
          `would blank everything under it.`,
      );
    }

    return {
      pngPath: params.outputPath,
      bytes: fileStat.size,
      header,
      metrics: parsePlateMetrics(run.stdout),
    };
  } catch (err) {
    // Never leave a half-written plate behind for a later stage to pick up.
    await rm(params.outputPath, { force: true }).catch(() => {});
    throw err;
  } finally {
    await rm(htmlPath, { force: true }).catch(() => {});
  }
}

/** Inputs to {@link rasteriseSvg}. */
export interface RasteriseSvgParams {
  /** The SVG document text. Read from disk by the caller — never imported. */
  svgText: string;
  /** Rendered width in px. */
  width: number;
  /** Rendered height in px. */
  height: number;
  outputPath: string;
  workDir: string;
  context: string;
  executablePath?: string;
  /**
   * CSS colour applied to the wrapper, so an SVG drawn in `currentColor`
   * (`watermark.svg` is) picks it up. Omit for an SVG that carries its own fills.
   */
  color?: string;
  /** 0..1, applied to the whole drawing and baked into the alpha channel. */
  opacity?: number;
}

/**
 * Rasterise an SVG document to a transparent PNG at an exact size.
 *
 * The SVG is scaled to fill the plate exactly: it is placed in a `width x height`
 * box with `width`/`height` attributes overridden by CSS, so the document's own
 * `width`/`height` attributes cannot fight the requested size.
 *
 * @throws {PlateError} From {@link rasterisePlate}, plus if `svgText` carries no
 *   `<svg` root or `opacity` is outside 0..1.
 */
export async function rasteriseSvg(
  params: RasteriseSvgParams,
): Promise<RasterisePlateResult> {
  if (!/<svg[\s>]/i.test(params.svgText)) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} ${params.context}: the supplied document has no <svg> root, so ` +
        `there is nothing to rasterise.`,
    );
  }
  const opacity = params.opacity ?? 1;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} ${params.context}: opacity must be in [0, 1], got ` +
        `${String(params.opacity)}.`,
    );
  }

  const css = `
  #bh-svg-wrap {
    position: absolute;
    inset: 0;
    display: block;
    line-height: 0;
    ${params.color === undefined ? "" : `color: ${params.color};`}
    opacity: ${opacity};
  }
  #bh-svg-wrap > svg {
    display: block;
    width: ${params.width}px;
    height: ${params.height}px;
  }`;

  return rasterisePlate({
    html: buildPlateHtml({
      width: params.width,
      height: params.height,
      css,
      body: `<div id="bh-svg-wrap">${params.svgText}</div>`,
    }),
    outputPath: params.outputPath,
    width: params.width,
    height: params.height,
    workDir: params.workDir,
    context: params.context,
    ...(params.executablePath === undefined
      ? {}
      : { executablePath: params.executablePath }),
    expectAlpha: true,
  });
}

/**
 * An SVG rasteriser for the presenter compositor.
 *
 * `packages/media-core/src/presenter/presenter-track.ts` takes an `SvgRasteriser`
 * and deliberately ships no default, because ffmpeg here has no SVG decoder and
 * media-core has no image library. This is that missing implementation, backed by
 * the same Chromium the plates use.
 *
 * @param options - Chromium override and a scratch directory.
 * @returns A function matching `SvgRasteriser` in `presenter/presenter-track.ts`.
 * @throws {PlateError} (from the returned function) if the SVG file is missing or
 *   the rasterisation fails.
 */
export function createChromiumSvgRasteriser(options: {
  workDir: string;
  executablePath?: string;
}): (params: {
  svgPath: string;
  widthPx: number;
  heightPx: number;
  outputPath: string;
}) => Promise<void> {
  return async ({ svgPath, widthPx, heightPx, outputPath }) => {
    const svgText = await readSvgFile(
      svgPath,
      `rasterise ${basename(svgPath)}`,
    );
    await rasteriseSvg({
      svgText,
      width: Math.round(widthPx),
      height: Math.round(heightPx),
      outputPath,
      workDir: options.workDir,
      context: `SVG ${basename(svgPath)}`,
      ...(options.executablePath === undefined
        ? {}
        : { executablePath: options.executablePath }),
    });
  };
}

/**
 * Read an SVG off disk.
 *
 * `media/` is gitignored, so these files exist on the authoring box and on the
 * render box but not in a clean checkout or in CI. They are therefore read at
 * runtime from a resolved path and never imported as modules.
 *
 * @throws {PlateError} If the file is absent or empty, naming the path and what
 *   depends on it.
 */
export async function readSvgFile(
  svgPath: string,
  context: string,
): Promise<string> {
  let text: string;
  try {
    text = await readFile(svgPath, "utf8");
  } catch (err) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} ${context}: cannot read the SVG at ${svgPath} ` +
        `(${err instanceof Error ? err.message : String(err)}). media/ is gitignored, so on ` +
        `a fresh box the style assets must be synced before a BUSINESS_PLAN_HUB job can ` +
        `render. Nothing is substituted for a missing brand asset.`,
    );
  }
  if (text.trim().length === 0) {
    throw new PlateError(
      `${PLATE_LOG_PREFIX} ${context}: the SVG at ${svgPath} is empty.`,
    );
  }
  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────────────────

interface ChromiumRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/** Spawn Chromium, capture both streams, and kill it if it outlives `timeoutMs`. */
function runChromium(
  executablePath: string,
  args: string[],
  timeoutMs: number,
): Promise<ChromiumRun> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executablePath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      rejectPromise(
        new PlateError(
          `${PLATE_LOG_PREFIX} Chromium did not finish within ${timeoutMs}ms and was killed. ` +
            `binary: ${executablePath}\n  stderr: ${stderr.slice(-2000)}`,
        ),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(
        new PlateError(
          `${PLATE_LOG_PREFIX} could not start Chromium at ${executablePath}: ${err.message}`,
        ),
      );
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

async function statOrNull(path: string): Promise<{ size: number } | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}
