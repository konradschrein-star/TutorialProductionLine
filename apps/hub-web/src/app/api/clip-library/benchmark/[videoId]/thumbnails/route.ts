import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const MEDIA_ROOT = process.env.MEDIA_ROOT ?? "/opt/content-forge/media";
const SIDECAR_URL =
  process.env.AUDIO_FACE_SIDECAR_URL ?? "http://localhost:8766";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ videoId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { videoId } = await params;
  if (!UUID_RE.test(videoId)) {
    return NextResponse.json({ error: "Invalid video ID" }, { status: 400 });
  }

  const videoPath = `${MEDIA_ROOT}/clips/sources/${videoId}.mp4`;

  try {
    const res = await fetch(`${SIDECAR_URL}/benchmark/thumbnails`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 90s timeout — ffmpeg thumbnail extraction on a 4-min video ≈ 10-20s
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({ video_path: videoPath, step_s: 4 }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json(
        { error: `Sidecar error: ${err.slice(0, 200)}` },
        { status: res.status },
      );
    }

    return NextResponse.json(await res.json());
  } catch (err) {
    console.error("benchmark/thumbnails error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Thumbnail generation failed",
      },
      { status: 500 },
    );
  }
}
