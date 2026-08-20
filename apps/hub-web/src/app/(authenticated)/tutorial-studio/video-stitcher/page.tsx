import { getSession } from "../../_lib/v2-auth";
import { db } from "@/lib/db";
import {
  videoStitchJobs,
  captionPresets,
  remotionCaptionPresets,
} from "@repo/db";
import { desc, eq } from "drizzle-orm";
import { VideoStitcherPageClient } from "./page-client";

export default async function VideoStitcherPage() {
  const session = await getSession();

  // Fetch recent jobs (20 most recent)
  const jobs = await db
    .select({
      id: videoStitchJobs.id,
      status: videoStitchJobs.status,
      progress: videoStitchJobs.progress,
      output_filename: videoStitchJobs.output_filename,
      created_at: videoStitchJobs.created_at,
      updated_at: videoStitchJobs.updated_at,
      error_message: videoStitchJobs.error_message,
      output_video_path: videoStitchJobs.output_video_path,
    })
    .from(videoStitchJobs)
    .where(eq(videoStitchJobs.created_by_user_id, session.userId))
    .orderBy(desc(videoStitchJobs.created_at))
    .limit(20);

  // Fetch caption presets
  const presets = await db
    .select({
      id: captionPresets.id,
      name: captionPresets.name,
      is_default: captionPresets.is_default,
    })
    .from(captionPresets)
    .orderBy(captionPresets.name);

  // Fetch Remotion caption presets
  const remotionPresets = await db
    .select({
      id: remotionCaptionPresets.id,
      name: remotionCaptionPresets.name,
      is_default: remotionCaptionPresets.is_default,
      config: remotionCaptionPresets.config,
    })
    .from(remotionCaptionPresets)
    .orderBy(remotionCaptionPresets.name);

  return (
    <VideoStitcherPageClient
      initialJobs={jobs.map((j) => ({
        id: j.id,
        status: j.status,
        progress: j.progress ?? 0,
        output_filename: j.output_filename,
        created_at: j.created_at.toISOString(),
        updated_at: j.updated_at.toISOString(),
        error_message: j.error_message ?? undefined,
        output_video_path: j.output_video_path ?? undefined,
      }))}
      captionPresets={presets.map((p) => ({
        id: p.id,
        name: p.name,
        is_default: p.is_default ?? false,
      }))}
      remotionCaptionPresets={remotionPresets.map((p) => ({
        id: p.id,
        name: p.name,
        is_default: p.is_default ?? false,
        config: p.config,
      }))}
    />
  );
}
