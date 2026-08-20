/**
 * GET  /api/business-hub/studio/head-mark  — the on-disk head mark + its hash.
 * POST /api/business-hub/studio/head-mark  — rasterise it to `mark/head-mark@2x.png`.
 *
 * WHY THE GET RETURNS A HASH:
 * The Studio's live preview does not fetch this SVG — the mark's geometry is
 * inlined into `_lib/head-mark.tsx` so the preview paints with no network round
 * trip and no `<img>` decode. An inlined copy can silently drift from the asset
 * it was copied out of, so the Studio fetches the hash and warns when the two
 * disagree. It refuses to pretend the preview is authoritative when it is not.
 *
 * WHY THE POST EXISTS:
 * `docs/superpowers/handoff/R3.md` §2 — `buildPresenterTrack` needs the head as
 * a raster because the ffmpeg on these boxes is built WITHOUT librsvg
 * (`no decoder found for: svg`). media-core has no image library and adding one
 * is a new runtime dependency; hub-web already ships `sharp`. So the Studio,
 * which is the tool that owns the presenter assets anyway, exports the PNG.
 *
 * `themeHeadMarkSvg()` resolves `var(--mark-bg)` / `var(--mark-fg)` to literals
 * first: no rasteriser honours CSS custom properties that are never declared,
 * so without it the mark always comes out in its fallback blue.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { themeHeadMarkSvg } from "@repo/media-core";

import { guardStudio, studioErrorResponse } from "../_lib/guard";
import { markDir, PresenterStoreError } from "../_lib/presenter-store";

export const dynamic = "force-dynamic";

const HEAD_MARK_SVG = "head-mark.svg";

/**
 * Exported raster size, in pixels, square.
 *
 * R3: "The PNG must be at least the largest head diameter any scene uses, or the
 * mark upscales and reads soft." The design puts the head at ~170px in a 1080p
 * frame; 512 leaves headroom for a `presenter-solo` close crop and for the 9:16
 * repurpose, at ~200 KB.
 */
const DEFAULT_EXPORT_PX = 512;
const MAX_EXPORT_PX = 2048;

const ExportSchema = z.object({
  /** `--mark-bg`: the disc. */
  markBg: z.string().min(1),
  /** `--mark-fg`: the bars, hook and dot. */
  markFg: z.string().min(1),
  sizePx: z
    .number()
    .int()
    .min(32)
    .max(MAX_EXPORT_PX)
    .default(DEFAULT_EXPORT_PX),
  /** Output file name inside `mark/`. */
  fileName: z
    .string()
    .regex(
      /^[A-Za-z0-9@._-]+\.png$/,
      "fileName must be a simple .png name with no path separators",
    )
    .default("head-mark@2x.png"),
});

export async function GET(): Promise<NextResponse> {
  const denied = await guardStudio("read");
  if (denied) return denied;

  try {
    const svg = await readHeadMarkSvg();
    return NextResponse.json(
      {
        svg,
        sha256: createHash("sha256").update(svg, "utf8").digest("hex"),
        path: path.join(markDir(), HEAD_MARK_SVG),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return studioErrorResponse(error, "Reading the head mark failed");
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const denied = await guardStudio("write");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch (error) {
    return NextResponse.json(
      {
        error: `Request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 400 },
    );
  }

  const parsed = ExportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues
          .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  }

  try {
    const svg = await readHeadMarkSvg();
    const themed = themeHeadMarkSvg(svg, {
      markBg: parsed.data.markBg,
      markFg: parsed.data.markFg,
    });

    const png = await sharp(Buffer.from(themed, "utf8"), { density: 384 })
      .resize({
        width: parsed.data.sizePx,
        height: parsed.data.sizePx,
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toBuffer();

    const outPath = path.join(markDir(), parsed.data.fileName);
    await writeFile(outPath, png);

    return NextResponse.json({
      written: outPath,
      sizePx: parsed.data.sizePx,
      bytes: png.byteLength,
    });
  } catch (error) {
    return studioErrorResponse(error, "Rasterising the head mark failed");
  }
}

/**
 * Read `mark/head-mark.svg`.
 *
 * @throws PresenterStoreError 404 when the asset is absent — the Studio must not
 *         invent a mark, and a render composited with a placeholder head is
 *         worse than one that failed.
 */
async function readHeadMarkSvg(): Promise<string> {
  const svgPath = path.join(markDir(), HEAD_MARK_SVG);
  try {
    return await readFile(svgPath, "utf8");
  } catch (error) {
    throw new PresenterStoreError(
      `Head mark not found at "${svgPath}". ` +
        `(${error instanceof Error ? error.message : String(error)})`,
      404,
    );
  }
}
