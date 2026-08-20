export const dynamic = "force-dynamic";
/**
 * Waveform API Endpoint
 *
 * GET /api/assets/{id}/waveform
 *
 * Lazy waveform generation and serving:
 * 1. Check if waveform exists in database (waveform_data)
 * 2. If yes: return cached data
 * 3. If no: generate waveform, update database, return data
 *
 * Only works for audio assets. Returns error for video/image/other types.
 *
 * Response format:
 * {
 *   data: number[],        // 200 amplitude values (0-1)
 *   duration_seconds: number
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { getAssetById, updateAsset } from "@/lib/repositories/asset-repository";
import {
  generateWaveform,
  extractAudioDuration,
} from "@/lib/services/waveform-service";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  // `/api/assets` is on the middleware bypass list, so this handler is the only
  // access control — and a cache miss here spawns ffmpeg, so an unauthenticated
  // caller could trivially exhaust CPU. Same permission as GET /api/assets/[id].
  const session = await getSession();
  if (!session || !hasPermission(session, "view:settings")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const { id: assetId } = await context.params;

    // Fetch asset from database
    const asset = await getAssetById(assetId);

    if (!asset) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    // Only generate waveforms for audio
    if (asset.asset_type !== "audio/tts") {
      return NextResponse.json(
        {
          error: `Waveforms are only available for audio assets. This asset is type: ${asset.asset_type}`,
        },
        { status: 400 },
      );
    }

    // Check if waveform already cached in database
    if (asset.waveform_data && Array.isArray(asset.waveform_data)) {
      return NextResponse.json(
        {
          data: asset.waveform_data,
          duration_seconds: asset.duration_seconds || 0,
        },
        {
          headers: {
            "Cache-Control": "public, max-age=86400", // 24 hours
          },
        },
      );
    }

    // Check if source file exists
    if (!asset.file_path || !existsSync(asset.file_path)) {
      return NextResponse.json(
        { error: "Source audio file not found" },
        { status: 404 },
      );
    }

    // Generate waveform
    console.warn(`[Waveform] Generating for asset ${assetId}`);

    const waveformData = await generateWaveform(asset.file_path);
    const durationSeconds = await extractAudioDuration(asset.file_path);

    // Update database with waveform data and duration
    await updateAsset(assetId, {
      waveform_data: waveformData as any,
      duration_seconds: Math.round(durationSeconds),
    });

    console.warn(
      `[Waveform] Generated successfully for asset ${assetId} (${waveformData.length} samples, ${durationSeconds.toFixed(1)}s)`,
    );

    return NextResponse.json(
      {
        data: waveformData,
        duration_seconds: Math.round(durationSeconds),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=86400",
        },
      },
    );
  } catch (error) {
    console.error(
      `[Waveform] Generation failed for asset ${(await context.params).id}:`,
      error,
    );

    // Return empty waveform instead of error (graceful degradation)
    return NextResponse.json(
      {
        data: [],
        duration_seconds: 0,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 200 }, // 200 OK with empty data (graceful failure)
    );
  }
}
