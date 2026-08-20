import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { videoStitchJobs, musicPresets } from "@repo/db";
import { VideoStitchPayloadSchema } from "@repo/contracts";
import { createRedisConnection, createVideoStitchQueue } from "@repo/queue";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// Music track schema for music chaining
const musicTrackSchema = z
  .object({
    library_track_id: z.string().uuid().optional(),
    custom_file_path: z.string().optional(),
    start_time_seconds: z.number().min(0).optional().default(0),
    fade_in_seconds: z.number().min(0).max(10).optional().default(0),
    fade_out_seconds: z.number().min(0).max(10).optional().default(2),
    volume: z.number().min(-40).max(20).optional().default(0),
  })
  .refine((data) => data.library_track_id || data.custom_file_path, {
    message: "Either library_track_id or custom_file_path required",
  });

// Request body schema for creating a video stitch job
const CreateJobRequestSchema = z.object({
  input_videos: z.array(
    z.object({
      upload_id: z.string().uuid(),
      filename: z.string(),
      duration_seconds: z.number(),
      width: z.number().int(),
      height: z.number().int(),
      fps: z.number(),
      order_index: z.number().int(),
      metadata: z
        .object({
          recorded_at: z.string().optional(),
        })
        .optional(),
    }),
  ),
  output_filename: z.string().min(1),
  voiceover_enabled: z.boolean(),
  voiceover_upload_id: z.string().uuid().optional(),
  voiceover_filename: z.string().optional(),
  music_enabled: z.boolean(),
  music_upload_id: z.string().uuid().optional(),
  music_filename: z.string().optional(),
  music_preset_id: z.string().uuid().optional(),
  music_volume: z.number().int().min(0).max(100).default(50),
  music_tracks: z.array(musicTrackSchema).optional(),
  captions_enabled: z.boolean(),
  caption_preset_id: z.string().uuid().optional(),
  caption_config: z
    .object({
      window_size: z.number().int().min(1).max(8).optional(),
      font_family: z.enum(["Montserrat", "Inter", "Arial"]).optional(),
      font_size: z.number().int().min(48).max(96).optional(),
      vertical_offset_percent: z.number().min(10).max(30).optional(),
      outline_width: z.number().min(2).max(6).optional(),
    })
    .optional(),
  caption_renderer: z.enum(["ffmpeg", "remotion"]).optional().default("ffmpeg"),
  remotion_preset_id: z.string().uuid().optional().nullable(),
  transition_type: z.enum([
    "hard_cut",
    "fade",
    "fadeblack",
    "wipeleft",
    "wiperight",
  ]),
  transition_duration_seconds: z.number().min(0).default(0),
  speed_adjust_mode: z
    .enum(["audio_to_video", "video_to_audio"])
    .default("audio_to_video"),
});

type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;

/**
 * POST /api/video-stitch/jobs
 *
 * Create a new video stitch job and dispatch to queue.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:job")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to parse JSON body: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    );
  }

  // Validate request body
  const parseResult = CreateJobRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        details: parseResult.error.errors,
      },
      { status: 400 },
    );
  }

  const data = parseResult.data;

  // Validate that we have at least one input video
  if (data.input_videos.length === 0) {
    return NextResponse.json(
      { error: "At least one input video is required" },
      { status: 400 },
    );
  }

  // Validate voiceover configuration
  if (
    data.voiceover_enabled &&
    (!data.voiceover_upload_id || !data.voiceover_filename)
  ) {
    return NextResponse.json(
      {
        error:
          "voiceover_upload_id and voiceover_filename are required when voiceover is enabled",
      },
      { status: 400 },
    );
  }

  // Validate music configuration
  if (
    data.music_enabled &&
    !data.music_preset_id &&
    (!data.music_upload_id || !data.music_filename)
  ) {
    return NextResponse.json(
      {
        error:
          "music_upload_id and music_filename (or music_preset_id) are required when music is enabled",
      },
      { status: 400 },
    );
  }

  // Validate caption configuration
  if (data.captions_enabled && !data.caption_preset_id) {
    return NextResponse.json(
      { error: "caption_preset_id is required when captions are enabled" },
      { status: 400 },
    );
  }

  // Debug log caption config
  console.warn("[API] Creating job with caption config:", {
    captions_enabled: data.captions_enabled,
    caption_config: data.caption_config,
    caption_preset_id: data.caption_preset_id,
  });

  let redis: ReturnType<typeof createRedisConnection> | undefined;

  try {
    // Construct full file paths from upload_ids and filenames (server-side only)
    const mediaRoot =
      process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";

    const voiceoverFilePath =
      data.voiceover_upload_id && data.voiceover_filename
        ? `${mediaRoot}/stitch-uploads/${data.voiceover_upload_id}/original${data.voiceover_filename.substring(data.voiceover_filename.lastIndexOf(".")).toLowerCase()}`
        : undefined;

    let musicFilePath: string | undefined = undefined;
    if (data.music_preset_id) {
      // Use preset file path
      const [preset] = await db
        .select()
        .from(musicPresets)
        .where(eq(musicPresets.id, data.music_preset_id));
      if (preset) {
        musicFilePath = preset.file_path;
      }
    } else if (data.music_upload_id && data.music_filename) {
      // Use uploaded file
      musicFilePath = `${mediaRoot}/stitch-uploads/${data.music_upload_id}/original${data.music_filename.substring(data.music_filename.lastIndexOf(".")).toLowerCase()}`;
    }

    // Insert job into database
    const [job] = await db
      .insert(videoStitchJobs)
      .values({
        created_by_user_id: session.userId,
        status: "PENDING",
        input_videos: data.input_videos.map((v) => ({
          upload_id: v.upload_id,
          filename: v.filename,
          duration_seconds: v.duration_seconds,
          width: v.width,
          height: v.height,
          fps: v.fps,
          order_index: v.order_index,
          metadata: v.metadata ?? {},
        })),
        output_filename: data.output_filename,
        transition_type: data.transition_type,
        transition_duration_seconds: data.transition_duration_seconds,
        voiceover_enabled: data.voiceover_enabled,
        voiceover_file_path: voiceoverFilePath,
        music_enabled: data.music_enabled,
        music_file_path: musicFilePath,
        music_volume: data.music_volume,
        music_tracks: data.music_tracks,
        captions_enabled: data.captions_enabled,
        caption_preset_id: data.caption_preset_id,
        caption_config: data.caption_config,
        remotion_enabled: data.caption_renderer === "remotion" ? true : false,
        remotion_preset_id: data.remotion_preset_id,
        speed_adjust_mode: data.speed_adjust_mode,
      })
      .returning();

    if (!job) {
      throw new Error("Failed to create job");
    }

    // Dispatch to queue
    const redisUrl = process.env["REDIS_URL"];
    if (!redisUrl) {
      throw new Error("REDIS_URL environment variable not configured");
    }
    redis = createRedisConnection({ url: redisUrl, mode: "queue" });
    const queue = createVideoStitchQueue(redis);

    const payload = VideoStitchPayloadSchema.parse({
      job_id: job.id,
      priority: 5,
    });

    await queue.add("video-stitch", payload, {
      jobId: job.id,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    });

    return NextResponse.json({
      job_id: job.id,
      status: job.status,
    });
  } catch (err) {
    console.error("Failed to create video stitch job", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      userId: session.userId,
    });

    // Return generic error to avoid leaking implementation details
    return NextResponse.json(
      { error: "Failed to create job" },
      { status: 500 },
    );
  } finally {
    if (redis) {
      await redis.quit();
    }
  }
}

/**
 * GET /api/video-stitch/jobs
 *
 * List video stitch jobs for the current user.
 */
export async function GET(request: NextRequest) {
  // Allow tutorial VAs too — the list query below filters to the caller's
  // own jobs, so a VA only sees their own long-form stitch jobs.
  const session = await getSession();
  if (
    !session ||
    (!hasPermission(session, "view:jobs") &&
      !hasPermission(session, "create:tutorial-job"))
  ) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const jobs = await db
      .select({
        id: videoStitchJobs.id,
        status: videoStitchJobs.status,
        progress: videoStitchJobs.progress,
        output_filename: videoStitchJobs.output_filename,
        output_video_path: videoStitchJobs.output_video_path,
        created_at: videoStitchJobs.created_at,
        updated_at: videoStitchJobs.updated_at,
        error_message: videoStitchJobs.error_message,
      })
      .from(videoStitchJobs)
      .where(eq(videoStitchJobs.created_by_user_id, session.userId))
      .orderBy(desc(videoStitchJobs.created_at))
      .limit(100); // Limit to 100 most recent jobs

    return NextResponse.json(
      jobs.map((j) => ({
        id: j.id,
        status: j.status,
        progress: j.progress,
        output_filename: j.output_filename,
        output_video_path: j.output_video_path,
        created_at: j.created_at.toISOString(),
        updated_at: j.updated_at.toISOString(),
        error_message: j.error_message,
      })),
    );
  } catch (err) {
    console.error("Failed to list video stitch jobs", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      userId: session.userId,
    });

    // Return generic error to avoid leaking implementation details
    return NextResponse.json({ error: "Failed to list jobs" }, { status: 500 });
  }
}
