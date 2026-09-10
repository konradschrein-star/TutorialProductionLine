import { extname } from "node:path";
import { openTutorialAssetStream } from "@/lib/tutorial/media-access";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeDeliveryConnector, DeliveryError, getScheduledAsset } from "@/lib/uploader/scheduled-delivery";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; role: string }> }) {
  if (!await authorizeDeliveryConnector(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = z.object({ id: z.string().uuid(), role: z.enum(["video", "thumbnail"]) }).safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid asset" }, { status: 400 });
  try {
    const asset = await getScheduledAsset(parsed.data.id, parsed.data.role);
    const mediaType = parsed.data.role === "video" ? "video/mp4" : ({ ".png": "image/png", ".webp": "image/webp" }[extname(asset.path).toLowerCase()] ?? "image/jpeg");
    // Consumer must independently verify both size and SHA-256 before provider upload.
    const media = await openTutorialAssetStream({ jobId: asset.jobId, kind: parsed.data.role === "video" ? "final_video" : "thumbnail", path: asset.path, expectedContent: { sha256: asset.sha256, size: asset.size } });
    return new Response(media.stream, { headers: { "Content-Type": mediaType, "Content-Length": String(media.contentLength), "X-Content-SHA256": asset.sha256, "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof DeliveryError ? error.message : "Approved asset unavailable. No replacement bytes were served." }, { status: error instanceof DeliveryError ? error.status : 500 }); }
}
