import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { createReadStream, statSync } from "fs";
import { resolve, sep } from "node:path";

export const dynamic = "force-dynamic";

/**
 * GET /api/timeline/image-by-key?key=<local_path>
 *
 * Serves an image by local file path for the canvas compositor.
 * Used for single-still scenes where only the visual_asset_key (local path)
 * is available in the TimelineScene (no asset UUID tracked).
 *
 * Streams the file directly from local disk with a 5-minute cache hint.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:job-detail")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = request.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json(
      { error: "Missing key parameter" },
      { status: 400 },
    );
  }

  const filePath = decodeURIComponent(key);

  // SECURITY: `key` is an attacker-controllable local path. Without this guard
  // any user with view:job-detail could read arbitrary server files
  // (e.g. ?key=/opt/content-forge/.env). Confine reads to LOCAL_MEDIA_ROOT,
  // mirroring the guard in /api/media/[...key] and /api/assets/[id]/stream.
  const mediaRoot = process.env.LOCAL_MEDIA_ROOT;
  if (!mediaRoot) {
    return NextResponse.json(
      { error: "Media storage not configured" },
      { status: 500 },
    );
  }
  const rootAbs = resolve(mediaRoot);
  const targetAbs = resolve(filePath);
  if (targetAbs !== rootAbs && !targetAbs.startsWith(rootAbs + sep)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const fileStat = statSync(targetAbs);
    const ext = targetAbs.toLowerCase();
    const contentType = ext.endsWith(".png")
      ? "image/png"
      : ext.endsWith(".webp")
        ? "image/webp"
        : ext.endsWith(".gif")
          ? "image/gif"
          : "image/jpeg";

    const stream = createReadStream(targetAbs);
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        stream.on("data", (chunk: Buffer) =>
          controller.enqueue(new Uint8Array(chunk)),
        );
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
      cancel() {
        stream.destroy();
      },
    });

    return new NextResponse(readable as unknown as BodyInit, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileStat.size),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
}
