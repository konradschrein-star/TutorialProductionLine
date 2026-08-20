import type { Job } from "bullmq";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { DramaThumbnailPayload } from "@repo/contracts";
import { DramaThumbnailPayloadSchema } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { contentJobs } from "@repo/db";
import {
  getDramaClipsByJob,
  getDramaCharactersByIds,
} from "@repo/db/repositories";
import {
  requestImage,
  downloadMedia,
} from "../../utils/media-gateway/index.js";
import { updateJobMetadata } from "../../utils/job-helpers.js";
import { buildCharacterBlock } from "./prompt-gen.js";

const MEDIA_BASE =
  process.env["DRAMA_MEDIA_DIR"] ?? "/opt/content-forge/media/long-form-drama";

export function createDramaThumbnailProcessor(db: DrizzleClient) {
  return async (job: Job<DramaThumbnailPayload>) => {
    const { jobId } = DramaThumbnailPayloadSchema.parse(job.data);

    try {
      const [jobRow] = await db
        .select({ metadata: contentJobs.metadata })
        .from(contentJobs)
        .where(eq(contentJobs.id, jobId))
        .limit(1);
      if (!jobRow) throw new Error(`Job ${jobId} not found`);

      const meta = jobRow.metadata as Record<string, unknown>;
      const dramaConfig = meta["drama_config"] as { characterIds: string[] };

      const characters = await getDramaCharactersByIds(
        dramaConfig.characterIds ?? [],
      );
      const clips = await getDramaClipsByJob(jobId);
      const bodyClips = clips.filter(
        (c) => c.section_type === "body" && c.image_prompt,
      );
      const thumbnailClip =
        bodyClips[Math.floor(bodyClips.length * 0.15)] ?? bodyClips[0];

      const characterBlock = buildCharacterBlock(characters);
      const thumbnailPrompt = `${thumbnailClip?.image_prompt ?? "A dramatic confrontation scene"}
${characterBlock}
Close-up framing emphasizing emotional tension. Ultra-photorealistic, cinematic, 8K, sharp eyes, expressive face, dramatic studio lighting, shallow depth of field.`;

      const outputDir = join(MEDIA_BASE, jobId);
      await mkdir(outputDir, { recursive: true });
      const thumbnailPath = join(outputDir, "thumbnail.jpg");
      const imageRef = await requestImage(thumbnailPrompt, {
        format: "LONG_FORM_DRAMA",
        context: `drama:thumbnail:${jobId}`,
      });
      await downloadMedia(imageRef, thumbnailPath);

      await updateJobMetadata(db, jobId, {
        drama_thumbnail_path: thumbnailPath,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        JSON.stringify({
          level: "error",
          message: "Thumbnail gen failed (non-fatal)",
          job_id: jobId,
          error: msg,
        }),
      );
      // Non-fatal — don't rethrow
    }
  };
}
