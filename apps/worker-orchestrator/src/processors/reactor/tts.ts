import type { Job, Queue } from "bullmq";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { ReactorTTSPayload } from "@repo/contracts";
import { ReactorTTSPayloadSchema } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { contentJobs, eq } from "@repo/db";
import { getConfig } from "@repo/config";
import { requestTTS } from "../../utils/tts-gateway.js";
import { updateJobStatus } from "../../utils/update-job-status.js";
import { updateJobMetadata } from "../../utils/job-helpers.js";
import type { ReactorScript } from "./script.js";

interface ManifestEntry {
  key: string;
  type: string;
  size_bytes: number;
  commentary_index?: number;
}

export function createReactorTTSProcessor(
  db: DrizzleClient,
  queues: { reactorAssemble: Queue },
) {
  return async (job: Job<ReactorTTSPayload>) => {
    const { job_id } = ReactorTTSPayloadSchema.parse(job.data);

    console.log(
      JSON.stringify({
        level: "info",
        message: "Reactor TTS processor started",
        job_id,
      }),
    );

    try {
      const [contentJob] = await db
        .select()
        .from(contentJobs)
        .where(eq(contentJobs.id, job_id))
        .limit(1);

      if (!contentJob) throw new Error(`Job ${job_id} not found`);

      const meta = (contentJob.metadata ?? {}) as Record<string, unknown>;
      const reactorScript = meta["reactor_script"] as ReactorScript | undefined;
      if (!reactorScript)
        throw new Error(`No reactor_script in metadata for ${job_id}`);

      const ttsProvider =
        (meta["tts_provider"] as string | undefined) ?? "elevenlabs";
      const ttsVoiceId = meta["tts_voice_id"] as string | undefined;
      if (!ttsVoiceId)
        throw new Error(`No tts_voice_id in metadata for ${job_id}`);

      const engine =
        ttsProvider === "minimax"
          ? ("minimax" as const)
          : ("elevenlabs" as const);

      const config = getConfig();
      const outputDir = join(
        config.LOCAL_MEDIA_ROOT,
        contentJob.channel_id,
        job_id,
      );
      await mkdir(outputDir, { recursive: true });

      // Build ordered list of commentary texts: segments then cta
      const commentaryItems = [
        ...reactorScript.segments.map((s, i) => ({
          index: i,
          text: s.comment,
        })),
        {
          index: reactorScript.segments.length,
          text: reactorScript.cta_segment.comment,
        },
      ];

      const manifest = (contentJob.r2_asset_manifest ?? []) as ManifestEntry[];
      const ttsManifestEntries: ManifestEntry[] = [];
      const ttsSegmentPaths: string[] = [];

      for (const item of commentaryItems) {
        const filename = `commentary_${item.index}.mp3`;
        const filePath = join(outputDir, filename);
        const manifestKey = join(contentJob.channel_id, job_id, filename);

        console.log(
          JSON.stringify({
            level: "info",
            message: "Generating reactor TTS segment",
            job_id,
            index: item.index,
            text_length: item.text.length,
            engine,
          }),
        );

        const audioBuffer = await requestTTS(item.text, ttsVoiceId, {
          format: "POLITICAL_COMMENTARY_REACTOR",
          engine,
          context: `reactor-${job_id}-${item.index}`,
        });

        await writeFile(filePath, audioBuffer);

        ttsManifestEntries.push({
          key: manifestKey,
          type: "audio/commentary-segment",
          size_bytes: audioBuffer.length,
          commentary_index: item.index,
        });

        ttsSegmentPaths.push(filePath);
      }

      const updatedManifest = [...manifest, ...ttsManifestEntries];
      await db
        .update(contentJobs)
        .set({ r2_asset_manifest: updatedManifest })
        .where(eq(contentJobs.id, job_id));

      await updateJobMetadata(db, job_id, {
        reactor_tts_segment_count: commentaryItems.length,
      });

      await updateJobStatus(db, job_id, "REACTOR_ASSEMBLING");
      await queues.reactorAssemble.add("reactor-assemble", { job_id });

      console.log(
        JSON.stringify({
          level: "info",
          message: "Reactor TTS complete",
          job_id,
          segment_count: commentaryItems.length,
          engine,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        JSON.stringify({
          level: "error",
          message: "Reactor TTS failed",
          job_id,
          error: msg,
        }),
      );
      await updateJobStatus(db, job_id, "FAILED_REACTOR_PIPELINE", msg).catch(
        () => {},
      );
      throw err;
    }
  };
}
