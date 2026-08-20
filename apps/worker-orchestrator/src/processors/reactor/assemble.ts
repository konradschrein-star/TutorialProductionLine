import type { Job, Queue } from "bullmq";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { ReactorAssemblePayload } from "@repo/contracts";
import { ReactorAssemblePayloadSchema } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { contentJobs, eq } from "@repo/db";
import { getConfig } from "@repo/config";
import { updateJobStatus } from "../../utils/update-job-status.js";
import { updateJobMetadata } from "../../utils/job-helpers.js";
import type { ReactorScript } from "./script.js";

interface ManifestEntry {
  key: string;
  type: string;
  size_bytes?: number;
  commentary_index?: number;
}

export interface ReactorAssemblyManifest {
  reference_video_path: string;
  intro_clips: Array<{ start: number; end: number }>;
  segments: Array<{
    clip: { start: number; end: number };
    commentary_audio_path: string;
    amplitude_data: number[];
    duration_seconds: number;
    commentary_text?: string;
  }>;
  cta_segment: {
    clip: { start: number; end: number };
    commentary_audio_path: string;
    amplitude_data: number[];
    duration_seconds: number;
    commentary_text?: string;
  };
  outro_clips: Array<{ start: number; end: number }>;
  settings: {
    avatar_path: string | null;
    avatar_mouth_paths: { closed: string; half: string; open: string } | null;
    avatar_animation: { intensity: number; max_scale_delta: number };
    overlay_saturation_boost: number;
    layout_seed: number;
    source_attribution: string;
  };
}

/**
 * Extract a per-frame (30fps) loudness envelope from an audio file.
 *
 * We read the audio at a real sample rate (16kHz mono f32) and compute the RMS
 * energy over each 1/30s window. Naively resampling the waveform to 30Hz
 * (`-ar 30`) low-pass-filters all speech energy (>100Hz) down to ~zero, which
 * makes the "amplitude" useless for driving animation — RMS windowing gives a
 * true 0..~1 loudness envelope (speech ~0.05–0.3, silence ~0.001).
 */
const AMP_SAMPLE_RATE = 16000;

function extractAmplitudeData(audioPath: string): Promise<number[]> {
  const ffmpeg = process.env["FFMPEG_PATH"] ?? "ffmpeg";
  const args = [
    "-i",
    audioPath,
    "-ar",
    String(AMP_SAMPLE_RATE),
    "-ac",
    "1",
    "-f",
    "f32le",
    "-",
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args);
    const chunks: Buffer[] = [];
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => chunks.push(d));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    proc.on("error", (e) => reject(new Error(`ffmpeg error: ${e.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg amplitude extraction exited ${code}: ${stderr.slice(-300)}`,
          ),
        );
        return;
      }
      const buffer = Buffer.concat(chunks);
      const totalSamples = Math.floor(buffer.byteLength / 4);
      const windowSize = AMP_SAMPLE_RATE / 30; // samples per 30fps video frame
      const frameCount = Math.floor(totalSamples / windowSize);
      const amplitudes: number[] = [];
      for (let f = 0; f < frameCount; f++) {
        const start = Math.floor(f * windowSize);
        const end = Math.floor((f + 1) * windowSize);
        let sumSq = 0;
        for (let i = start; i < end; i++) {
          const v = buffer.readFloatLE(i * 4);
          sumSq += v * v;
        }
        amplitudes.push(Math.sqrt(sumSq / Math.max(1, end - start)));
      }
      resolve(amplitudes);
    });
  });
}

export function createReactorAssembleProcessor(
  db: DrizzleClient,
  queues: { renderHeavy: Queue },
) {
  return async (job: Job<ReactorAssemblePayload>) => {
    const { job_id } = ReactorAssemblePayloadSchema.parse(job.data);

    console.log(
      JSON.stringify({
        level: "info",
        message: "Reactor assemble processor started",
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

      const config = getConfig();
      const meta = (contentJob.metadata ?? {}) as Record<string, unknown>;
      const reactorScript = meta["reactor_script"] as ReactorScript | undefined;
      if (!reactorScript)
        throw new Error(`No reactor_script in metadata for ${job_id}`);

      const manifest = (contentJob.r2_asset_manifest ?? []) as ManifestEntry[];

      // Locate reference video
      const sourceAsset = manifest.find(
        (a) => a.type === "video/reference-source",
      );
      if (!sourceAsset)
        throw new Error(`No reference source video in manifest for ${job_id}`);
      const referenceVideoPath = join(config.LOCAL_MEDIA_ROOT, sourceAsset.key);

      // Locate avatar image — from manifest or metadata.avatar_path
      const avatarAsset = manifest.find(
        (a) => a.type === "image/commentator-avatar",
      );
      const metaAvatarPath = meta["avatar_path"] as string | null | undefined;
      const avatarPath = avatarAsset
        ? join(config.LOCAL_MEDIA_ROOT, avatarAsset.key)
        : (metaAvatarPath ?? null);

      // Volume-driven mouth states (closed/half/open) for the animated character.
      // Absolute paths in metadata; falls back to the single avatar above if absent.
      const mouthMeta = meta["avatar_mouth_states"] as
        | { closed?: string; half?: string; open?: string }
        | undefined;
      const avatarMouthPaths =
        mouthMeta?.closed && mouthMeta.half && mouthMeta.open
          ? {
              closed: mouthMeta.closed,
              half: mouthMeta.half,
              open: mouthMeta.open,
            }
          : null;

      // Map commentary_index → local audio file path
      const ttsAssets = manifest
        .filter((a) => a.type === "audio/commentary-segment")
        .sort((a, b) => (a.commentary_index ?? 0) - (b.commentary_index ?? 0));

      const audioPaths = ttsAssets.map((a) =>
        join(config.LOCAL_MEDIA_ROOT, a.key),
      );

      if (audioPaths.length < reactorScript.segments.length + 1) {
        throw new Error(
          `Expected ${reactorScript.segments.length + 1} TTS audio files, found ${audioPaths.length} for job ${job_id}`,
        );
      }

      // Extract amplitude data for each commentary segment
      console.log(
        JSON.stringify({
          level: "info",
          message: "Extracting amplitude data for reactor commentary",
          job_id,
          segment_count: audioPaths.length,
        }),
      );

      const amplitudeResults = await Promise.all(
        audioPaths.map((p) => extractAmplitudeData(p)),
      );

      // Assemble segments
      const assembledSegments = reactorScript.segments.map((seg, i) => {
        const amplitudeData = amplitudeResults[i] ?? [];
        return {
          clip: seg.clip,
          commentary_audio_path: audioPaths[i]!,
          amplitude_data: amplitudeData,
          duration_seconds: amplitudeData.length / 30,
          commentary_text: seg.comment,
        };
      });

      const ctaIndex = reactorScript.segments.length;
      const ctaAmplitude = amplitudeResults[ctaIndex] ?? [];
      const ctaAssembled = {
        clip: reactorScript.cta_segment.clip,
        commentary_audio_path: audioPaths[ctaIndex]!,
        amplitude_data: ctaAmplitude,
        duration_seconds: ctaAmplitude.length / 30,
        commentary_text: reactorScript.cta_segment.comment,
      };

      // Read settings from metadata
      const avatarAnimMeta = meta["avatar_animation"] as
        | { intensity: number; max_scale_delta: number }
        | undefined;
      const overlayMeta = meta["overlay"] as
        | { saturation_boost?: number; source_attribution?: string }
        | undefined;

      const assemblyManifest: ReactorAssemblyManifest = {
        reference_video_path: referenceVideoPath,
        intro_clips: reactorScript.intro_clips,
        segments: assembledSegments,
        cta_segment: ctaAssembled,
        outro_clips: reactorScript.outro_clips,
        settings: {
          avatar_path: avatarPath,
          avatar_mouth_paths: avatarMouthPaths,
          avatar_animation: {
            intensity: avatarAnimMeta?.intensity ?? 0.6,
            max_scale_delta: avatarAnimMeta?.max_scale_delta ?? 0.05,
          },
          overlay_saturation_boost: overlayMeta?.saturation_boost ?? 5,
          // Use job_id as seed for reproducible but varied layout selection
          layout_seed: parseInt(job_id.replace(/-/g, "").slice(0, 8), 16),
          source_attribution: overlayMeta?.source_attribution ?? "",
        },
      };

      await updateJobMetadata(db, job_id, {
        assembly_manifest: assemblyManifest,
      });

      await updateJobStatus(db, job_id, "ROUTING_RENDER");
      await queues.renderHeavy.add("route-render", { job_id });

      console.log(
        JSON.stringify({
          level: "info",
          message: "Reactor assemble complete",
          job_id,
          segment_count: assembledSegments.length,
          has_avatar: !!avatarPath,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        JSON.stringify({
          level: "error",
          message: "Reactor assemble failed",
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
