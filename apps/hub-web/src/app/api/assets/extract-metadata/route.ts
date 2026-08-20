export const dynamic = "force-dynamic";
/**
 * Metadata Extraction API Endpoint
 *
 * POST /api/assets/extract-metadata
 *
 * Extracts metadata from uploaded media files before saving to database.
 * Returns duration (video/audio) and dimensions (video/image).
 *
 * Used by AssetUploadDrawer to populate metadata fields automatically.
 */

import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "node:fs/promises";
import { extractAudioDuration } from "@/lib/services/waveform-service";
import { getSession } from "@/lib/auth/session";
import sharp from "sharp";
import { execa } from "execa";
import path from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";

// Zod schema for ffprobe JSON output
const ffprobeOutputSchema = z.object({
  streams: z
    .array(
      z.object({
        width: z.number().optional(),
        height: z.number().optional(),
        duration: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .optional(),
});

export async function POST(request: NextRequest) {
  // Middleware-exempt (/api/assets) — must self-authenticate. Runs ffprobe/sharp
  // on an attacker-supplied file, so it must not be reachable unauthenticated.
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let tempFilePath: string | null = null;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const assetType = formData.get("asset_type") as string;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!assetType || !["video", "audio", "image"].includes(assetType)) {
      return NextResponse.json(
        { error: "Invalid asset_type. Must be: video, audio, or image" },
        { status: 400 },
      );
    }

    // Save to temp file
    const buffer = Buffer.from(await file.arrayBuffer());
    tempFilePath = path.join(tmpdir(), `metadata-${Date.now()}-${file.name}`);
    await writeFile(tempFilePath, buffer);

    let metadata: any = {
      duration_seconds: null,
      width: null,
      height: null,
    };

    if (assetType === "video") {
      // Extract duration, width, height using ffprobe
      try {
        const probe = await execa(
          "ffprobe",
          [
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,duration",
            "-of",
            "json",
            tempFilePath,
          ],
          { timeout: 5000 },
        );

        // Parse and validate ffprobe output
        let parsedData;
        try {
          parsedData = JSON.parse(probe.stdout);
        } catch (parseError) {
          console.error(
            "[Metadata Extraction] Invalid JSON from ffprobe:",
            parseError,
          );
          throw new Error("FFprobe returned invalid JSON");
        }

        const validationResult = ffprobeOutputSchema.safeParse(parsedData);
        if (!validationResult.success) {
          console.error(
            "[Metadata Extraction] FFprobe output validation failed:",
            validationResult.error,
          );
          throw new Error("FFprobe output does not match expected schema");
        }

        const data = validationResult.data;
        const stream = data.streams?.[0];

        if (stream) {
          metadata = {
            duration_seconds: stream.duration
              ? Math.round(parseFloat(String(stream.duration)))
              : null,
            width: stream.width || null,
            height: stream.height || null,
          };
        }
      } catch (error) {
        console.error("[Metadata Extraction] FFprobe failed for video:", error);
        // Continue with null values
      }
    } else if (assetType === "audio") {
      // Extract duration using shared service
      try {
        const duration = await extractAudioDuration(tempFilePath);
        metadata = {
          duration_seconds: Math.round(duration),
          width: null,
          height: null,
        };
      } catch (error) {
        console.error(
          "[Metadata Extraction] Duration extraction failed for audio:",
          error,
        );
        // Continue with null values
      }
    } else if (assetType === "image") {
      // Extract dimensions using sharp
      try {
        const image = sharp(tempFilePath);
        const imageMetadata = await image.metadata();
        metadata = {
          duration_seconds: null,
          width: imageMetadata.width || null,
          height: imageMetadata.height || null,
        };
      } catch (error) {
        console.error("[Metadata Extraction] Sharp failed for image:", error);
        // Continue with null values
      }
    }

    return NextResponse.json({
      success: true,
      metadata,
    });
  } catch (error) {
    console.error("[Metadata Extraction] Error:", error);
    return NextResponse.json(
      {
        error: "Metadata extraction failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  } finally {
    // Clean up temp file
    if (tempFilePath) {
      await unlink(tempFilePath).catch(() => {});
    }
  }
}
