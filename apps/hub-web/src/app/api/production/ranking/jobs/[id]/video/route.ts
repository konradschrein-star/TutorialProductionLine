import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, contentJobs } from "@/lib/db";
import { getHubConfig } from "@/lib/config";
import {
  parseRange,
  resolveRankingVideo,
  UUID_RE,
} from "../../../_lib/ranking-artifacts";

export const dynamic = "force-dynamic";

/**
 * GET /api/production/ranking/jobs/[id]/video
 *
 * Stream a rendered RANKING video. `?inline=1` serves it for playback
 * (Content-Disposition: inline, HTTP Range honoured); without it, a download.
 *
 * ## Why a RANKING-specific route was needed
 *
 * There was no way to watch one. The two generic paths both fail for this
 * format:
 *
 *   - `/api/production/jobs/[id]/download` reads `tutorial_jobs`. A RANKING
 *     job is a `content_jobs` row; the id simply does not resolve.
 *   - `/api/assets/[id]/[...key]` requires the file to be listed in
 *     `r2_asset_manifest`, and the RANKING workflow never writes one, so it
 *     answers "Asset not found in manifest" for every ranking ever rendered.
 *
 * `/api/media/<path>` would serve the bytes, but only if the caller already
 * knows the on-disk path — which is the thing that is not recorded. This route
 * resolves the path the same way the detail endpoint reports it (see
 * `_lib/ranking-artifacts.ts`) and streams whatever genuinely exists.
 *
 * Range support is not a nicety: a `<video>` issues `Range: bytes=0-` on load
 * and further ranges to seek, and a server that answers 200-with-the-whole-file
 * gives a player that cannot scrub and, on Safari, will not start at all.
 *
 * The file is streamed off disk rather than buffered — renders run to hundreds
 * of megabytes and `readFile()` would OOM hub-web.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
  }

  const [job] = await db
    .select({
      id: contentJobs.id,
      title: contentJobs.title,
      format: contentJobs.format,
      channel_id: contentJobs.channel_id,
      final_video_path: contentJobs.final_video_path,
      r2_asset_manifest: contentJobs.r2_asset_manifest,
    })
    .from(contentJobs)
    .where(eq(contentJobs.id, id))
    .limit(1);

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (job.format !== "RANKING") {
    return NextResponse.json(
      { error: "This endpoint only serves RANKING jobs." },
      { status: 400 },
    );
  }

  const video = await resolveRankingVideo(
    {
      id: job.id,
      channel_id: job.channel_id,
      final_video_path: job.final_video_path ?? null,
      r2_asset_manifest: job.r2_asset_manifest,
    },
    getHubConfig().LOCAL_MEDIA_ROOT,
  );

  if (!video.path || video.sizeBytes === null) {
    // Say what was looked for. A bare 404 here is what made this format feel
    // broken with no way to find out why.
    return NextResponse.json(
      {
        error: "No rendered video exists for this ranking.",
        checked: video.checked,
      },
      { status: 404 },
    );
  }

  const size = video.sizeBytes;
  const safeTitle = (job.title ?? "ranking").replace(/[^a-z0-9]/gi, "_");
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  const disposition = `${inline ? "inline" : "attachment"}; filename="${safeTitle}.mp4"`;

  try {
    const range = inline ? parseRange(req.headers.get("range"), size) : null;

    if (range) {
      const nodeStream = createReadStream(video.path, {
        start: range.start,
        end: range.end,
      });
      return new NextResponse(
        Readable.toWeb(nodeStream) as unknown as ReadableStream,
        {
          status: 206,
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(range.end - range.start + 1),
            "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
            "Accept-Ranges": "bytes",
            "Content-Disposition": disposition,
            "Cache-Control": "private, max-age=3600",
          },
        },
      );
    }

    const nodeStream = createReadStream(video.path);
    return new NextResponse(
      Readable.toWeb(nodeStream) as unknown as ReadableStream,
      {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(size),
          "Accept-Ranges": "bytes",
          "Content-Disposition": disposition,
          ...(inline ? { "Cache-Control": "private, max-age=3600" } : {}),
        },
      },
    );
  } catch (err) {
    console.error("[production/ranking video] read failed", err);
    return NextResponse.json(
      { error: "Failed to read the video file." },
      { status: 500 },
    );
  }
}
