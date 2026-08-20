/**
 * GET /api/business-hub/studio/envelope?file=<name>&fps=<n>
 *
 * Returns the per-frame narration RMS envelope for one sample clip, computed by
 * `computeRmsEnvelope` from `@repo/media-core` — the SAME function the presenter
 * compositor uses (R3). That is the point of doing it server-side rather than
 * with the Web Audio API in the browser: a preview computed by a second, nearly
 * identical implementation would drift from the render, and the operator would
 * be calibrating against an animation the pipeline never produces.
 *
 * FAIL-CLOSED: `computeRmsEnvelope` throws on a missing file, a zero-byte file,
 * audio shorter than one frame, or narration that is silent at the
 * normalisation percentile. None of those is smoothed over here — the error text
 * is passed through so the operator sees which clip is broken.
 */

import { NextResponse, type NextRequest } from "next/server";
import { computeRmsEnvelope } from "@repo/media-core";

import { guardStudio, studioErrorResponse } from "../_lib/guard";
import { resolveSampleNarration } from "../_lib/presenter-store";

export const dynamic = "force-dynamic";

/** Frame rates the Studio will compute an envelope at. 30 is the format's. */
const MIN_FPS = 1;
const MAX_FPS = 120;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = await guardStudio("read");
  if (denied) return denied;

  const file = req.nextUrl.searchParams.get("file");
  if (!file) {
    return NextResponse.json(
      {
        error:
          "?file= is required — name a clip returned by GET /api/business-hub/studio/narration.",
      },
      { status: 400 },
    );
  }

  const rawFps = req.nextUrl.searchParams.get("fps") ?? "30";
  const fps = Number(rawFps);
  if (!Number.isFinite(fps) || fps < MIN_FPS || fps > MAX_FPS) {
    return NextResponse.json(
      {
        error: `?fps= must be a finite number in ${MIN_FPS}..${MAX_FPS}, got "${rawFps}".`,
      },
      { status: 400 },
    );
  }

  try {
    const audioPath = await resolveSampleNarration(file);
    const envelope = await computeRmsEnvelope({ audioPath, fps });

    return NextResponse.json(
      {
        file,
        fps: envelope.fps,
        frameCount: envelope.frameCount,
        durationSec: envelope.frameCount / envelope.fps,
        reference: envelope.reference,
        percentile: envelope.percentile,
        smoothingTaps: envelope.smoothingTaps,
        sampleRate: envelope.sampleRate,
        /** Normalised 0..1, one per frame. Feed directly to the head scale. */
        values: envelope.values,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return studioErrorResponse(
      error,
      `Computing the RMS envelope for "${file}" failed`,
    );
  }
}
