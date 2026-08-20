import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const MEDIA_ROOT = process.env.MEDIA_ROOT ?? "/opt/content-forge/media";
const SIDECAR_URL =
  process.env.AUDIO_FACE_SIDECAR_URL ?? "http://localhost:8766";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DetectBodySchema = z.object({
  algorithm: z.string().min(1),
});

export async function POST(
  request: NextRequest,
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = DetectBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Missing algorithm field" },
      { status: 400 },
    );
  }

  const videoPath = `${MEDIA_ROOT}/clips/sources/${videoId}.mp4`;

  try {
    const res = await fetch(`${SIDECAR_URL}/benchmark/detect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 10-minute timeout — some algorithms (TransNetV2 on 90-min videos) are slow.
      // For the 4-min SWTOR trailer all algorithms complete in < 60s.
      signal: AbortSignal.timeout(10 * 60 * 1000),
      body: JSON.stringify({
        video_path: videoPath,
        algorithm: parsed.data.algorithm,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json(
        { error: `Sidecar error: ${err.slice(0, 400)}` },
        { status: res.status },
      );
    }

    return NextResponse.json(await res.json());
  } catch (err) {
    console.error(`benchmark/detect [${parsed.data.algorithm}] error:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Detection failed" },
      { status: 500 },
    );
  }
}
