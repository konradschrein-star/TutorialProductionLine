/**
 * GET /api/business-hub/studio/poses/image/<file>.png[?w=<px>]
 *
 * Serves a pose PNG out of `media/style-assets/presenter/poses/`. `media/` is
 * gitignored and lives outside `public/`, so it can neither be imported nor
 * served statically — it has to stream through a route.
 *
 * `?w=` returns a `sharp`-resized copy for the pose LIST. The originals run to
 * 3.5 MB each and 16 of them at full size is ~34 MB of thumbnails; the canvas
 * still gets the untouched original so hitboxes are placed against real pixels.
 *
 * The URL ends in `.png` on purpose. `src/middleware.ts`'s matcher excludes
 * image extensions, so this route is reachable even before `/api/business-hub`
 * is added to `API_ROUTES` — and it therefore authenticates itself, exactly as
 * `app/api/media/[...key]/route.ts` does for the same reason.
 */

import { NextResponse, type NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

import { guardStudio, studioErrorResponse } from "../../../_lib/guard";
import { resolvePoseImage } from "../../../_lib/presenter-store";

export const dynamic = "force-dynamic";

/** Widest thumbnail the list may ask for. Beyond this, fetch the original. */
const MAX_THUMBNAIL_WIDTH = 512;

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ file: string }> },
): Promise<NextResponse> {
  const denied = await guardStudio("read");
  if (denied) return denied;

  try {
    const { file } = await context.params;
    const { absPath, pose } = await resolvePoseImage(decodeURIComponent(file));

    const rawWidth = req.nextUrl.searchParams.get("w");
    if (rawWidth === null) {
      const bytes = await readFile(absPath);
      return pngResponse(bytes, pose.slug);
    }

    const width = Number(rawWidth);
    if (!Number.isInteger(width) || width <= 0 || width > MAX_THUMBNAIL_WIDTH) {
      return NextResponse.json(
        {
          error:
            `?w= must be an integer in 1..${MAX_THUMBNAIL_WIDTH}, got "${rawWidth}". ` +
            "Omit it entirely to receive the untouched original.",
        },
        { status: 400 },
      );
    }

    // `withoutEnlargement` so a small pose is never upscaled into a soft
    // thumbnail; alpha is preserved because the poses are matted RGBA.
    const resized = await sharp(absPath)
      .resize({ width, withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();

    return pngResponse(resized, pose.slug);
  } catch (error) {
    return studioErrorResponse(error, "Serving a pose image failed");
  }
}

function pngResponse(bytes: Buffer, slug: string): NextResponse {
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(bytes.byteLength),
      // Private: the pose library is product artwork, not public assets. Short
      // max-age because the Studio is where these files get replaced.
      "Cache-Control": "private, max-age=60",
      "X-Pose-Slug": slug,
    },
  });
}
