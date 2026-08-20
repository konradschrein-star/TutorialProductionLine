/**
 * GET  /api/business-hub/studio/narration — list sample narration clips.
 * POST /api/business-hub/studio/narration — upload one (multipart/form-data).
 *
 * The head-pump preview is driven by a REAL RMS envelope of REAL narration
 * (design §4.3). There is no synthesised tone and no canned waveform: if the
 * operator has not put a clip in `media/style-assets/presenter/sample-narration/`
 * the preview says so and offers to upload one. An empty list is a true state,
 * reported as an empty list — never as a silently fabricated default.
 *
 * Fish Audio output from any tutorial job is a good sample; so is a raw TTS
 * render. Anything ffmpeg can decode works, because the envelope is computed by
 * the same `computeRmsEnvelope` the renderer uses.
 */

import { NextResponse, type NextRequest } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { guardStudio, studioErrorResponse } from "../_lib/guard";
import {
  listSampleNarration,
  ensureSampleNarrationDir,
  sampleNarrationDir,
  safeJoinInside,
  NARRATION_EXTENSIONS,
  PresenterStoreError,
} from "../_lib/presenter-store";

export const dynamic = "force-dynamic";

/** 40 MB — several minutes of mp3, far more than a calibration sample needs. */
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

export async function GET(): Promise<NextResponse> {
  const denied = await guardStudio("read");
  if (denied) return denied;

  try {
    const files = await listSampleNarration();
    return NextResponse.json(
      { files, directory: sampleNarrationDir() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return studioErrorResponse(error, "Listing sample narration failed");
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const denied = await guardStudio("write");
  if (denied) return denied;

  try {
    const form = await req.formData();
    const entry = form.get("file");
    if (!(entry instanceof File)) {
      return NextResponse.json(
        { error: 'multipart/form-data must carry a "file" part.' },
        { status: 400 },
      );
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!(NARRATION_EXTENSIONS as readonly string[]).includes(ext)) {
      return NextResponse.json(
        {
          error:
            `"${entry.name}" has extension "${ext}", which is not a supported narration ` +
            `container. Allowed: ${NARRATION_EXTENSIONS.join(", ")}.`,
        },
        { status: 400 },
      );
    }
    if (entry.size === 0) {
      return NextResponse.json(
        {
          error: `"${entry.name}" is 0 bytes. An empty file has no envelope; nothing would animate.`,
        },
        { status: 400 },
      );
    }
    if (entry.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error:
            `"${entry.name}" is ${entry.size} bytes, over the ${MAX_UPLOAD_BYTES}-byte limit ` +
            "for a calibration sample. A 30-second clip is enough to judge the pump.",
        },
        { status: 413 },
      );
    }

    const dir = await ensureSampleNarrationDir();
    // Strip the browser-supplied directory component and any separator before
    // it can reach the filesystem; safeJoinInside then proves containment.
    const safeName = sanitiseName(path.basename(entry.name));
    const absPath = safeJoinInside(dir, safeName);

    await writeFile(absPath, Buffer.from(await entry.arrayBuffer()));

    const files = await listSampleNarration();
    return NextResponse.json({ saved: safeName, files, directory: dir });
  } catch (error) {
    if (error instanceof PresenterStoreError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return studioErrorResponse(error, "Uploading sample narration failed");
  }
}

/**
 * Reduce a user-supplied name to `[A-Za-z0-9._-]`, preserving the extension.
 *
 * @throws PresenterStoreError if nothing usable survives.
 */
function sanitiseName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+/, "");
  if (cleaned.length === 0 || cleaned === path.extname(cleaned)) {
    throw new PresenterStoreError(
      `File name "${name}" contains no usable characters.`,
      400,
    );
  }
  return cleaned;
}
