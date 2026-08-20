import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { fetchYouTubeTranscript, TranscriptError } from "./yt-transcript";

/**
 * POST /api/production/transcript
 *
 * Fetch a reference video's transcript for the Create form, at the moment the
 * VA picks the keyword — rather than at script time, minutes later, in a worker
 * whose failure the VA never sees.
 *
 * The owner: "we can fetch the transcript already by as soon as the keyword is
 * selected, we can fetch the transcript and have it show up in the reference
 * transcript box already with placing the leave blank... and the leave blank
 * stuff will not appear if we are not able to fetch it, then the VA can manually
 * fetch it."
 *
 * ## This is a preview, not a new source of truth
 *
 * The worker still resolves the transcript itself at script time
 * (`resolveSourceTranscript`), preferring any transcript stored on the job. So
 * what this returns either becomes `reference_transcript` on the job — because
 * the VA saw it and submitted it — or nothing happens and the worker fetches the
 * same captions the same way. There is no path where this route's answer and the
 * worker's disagree silently.
 *
 * ## Failure is an answer
 *
 * Every failure returns 4xx with a `code` and an operator-actionable `error`
 * string. Nothing here ever returns an empty or placeholder transcript: a form
 * that shows a blank box after a failed fetch is indistinguishable from one that
 * fetched an empty video, and the VA would submit it.
 *
 * ## Auth
 *
 * `/api/production` is on the middleware's auth-BYPASS list, so this handler
 * MUST authenticate itself. It does, below, with the same `view:production`
 * grant the rest of the Tutorial Studio API uses.
 */

export const dynamic = "force-dynamic";
// Spawns the yt-dlp binary — cannot run on the edge runtime.
export const runtime = "nodejs";
// yt-dlp probes then downloads; each call has its own 60s cap inside.
export const maxDuration = 150;

const BodySchema = z.object({
  url: z.string().min(1, "A reference video URL is required."),
  /** The job's spoken language, used to pick the caption track. */
  language: z.string().optional(),
});

/** HTTP status per failure kind — the UI branches on `code`, not on this. */
const STATUS_FOR_CODE: Record<string, number> = {
  NOT_YOUTUBE: 400,
  NO_CAPTIONS: 422,
  TRANSCRIPT_TOO_SHORT: 422,
  FETCH_FAILED: 502,
};

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400 },
    );
  }

  try {
    const result = await fetchYouTubeTranscript({
      url: parsed.data.url,
      language: parsed.data.language ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof TranscriptError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: STATUS_FOR_CODE[err.code] ?? 502 },
      );
    }
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        code: "FETCH_FAILED",
      },
      { status: 502 },
    );
  }
}
