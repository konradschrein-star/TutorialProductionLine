import type { AssemblyManifest, VideoTimeline, TimelineScene, TimelineFrame, TextOverlay, AvatarPip, Voiceover } from "@repo/contracts";

/**
 * Minimal frame sequence input type for the hydration function.
 * Mirrors the shape of the scene_frame_sequences DB row without importing @repo/db
 * (domain must stay free of infrastructure dependencies).
 */
export interface FrameSequenceInput {
  id: string;
  scene_index: number;
  frame_index: number;
  asset_id: string | null;
  hold_duration_ms: number;
  transition_type: string;
  prompt_delta: string | null;
}

/**
 * Timeline Hydration — Pure Domain Function
 *
 * Converts the raw assembly_manifest + scene_frame_sequences into
 * a VideoTimeline (the human-editable edit layer).
 *
 * This is a one-way transformation: manifest → timeline.
 * The operator then mutates the timeline; mutations are saved separately.
 *
 * Pure function — no IO, no side effects.
 */

export interface HydrationParams {
  jobId: string;
  manifest: AssemblyManifest;
  frameSequences: FrameSequenceInput[];
  fps: number;
  targetDurationSeconds: number;
}

/**
 * Build a stable scene_id for a job + scene_index combination.
 * Used as the identity key in the timeline editor.
 */
function buildSceneId(jobId: string, sceneIndex: number): string {
  return `${jobId}:scene_${sceneIndex}`;
}

/**
 * Compute scene timing (start_ms, duration_ms) from the manifest.
 *
 * Priority order:
 * 1. start_frame / duration_frames from scene (populated by render worker)
 * 2. Paragraph-length weighted distribution across targetDurationSeconds
 */
function computeSceneTimings(
  manifest: AssemblyManifest,
  fps: number,
  targetDurationSeconds: number
): Array<{ start_ms: number; duration_ms: number }> {
  const scenes = manifest.scenes;
  const totalMs = targetDurationSeconds * 1000;

  // Check if render worker has already computed frame-accurate timing
  const hasFrameTiming = scenes.every(
    (s) => s.start_frame !== null && s.duration_frames !== null
  );

  if (hasFrameTiming && fps > 0) {
    return scenes.map((s) => ({
      start_ms: Math.round((s.start_frame! / fps) * 1000),
      duration_ms: Math.round((s.duration_frames! / fps) * 1000),
    }));
  }

  // Fallback: weight by paragraph length (character count)
  const totalChars = scenes.reduce((sum, s) => sum + s.paragraph.length, 0);
  if (totalChars === 0) {
    // All equal if text is missing
    const even = Math.round(totalMs / scenes.length);
    return scenes.map((_, i) => ({
      start_ms: i * even,
      duration_ms: even,
    }));
  }

  let cursor = 0;
  return scenes.map((s, i) => {
    const weight = s.paragraph.length / totalChars;
    const duration_ms = i === scenes.length - 1
      ? totalMs - cursor                           // Force last scene to fill exactly
      : Math.round(weight * totalMs);
    const start_ms = cursor;
    cursor += duration_ms;
    return { start_ms, duration_ms };
  });
}

/**
 * Build TimelineFrame[] for a given scene from the frame sequences.
 * Returns empty array if no sequences exist (single still frame scene).
 */
function buildVideoFrames(
  sceneIndex: number,
  frameSequences: FrameSequenceInput[]
): TimelineFrame[] {
  return frameSequences
    .filter((fs) => fs.scene_index === sceneIndex)
    .sort((a, b) => a.frame_index - b.frame_index)
    .map((fs) => ({
      frame_sequence_id: fs.id,
      frame_index: fs.frame_index,
      asset_id: fs.asset_id ?? null,
      hold_duration_ms: fs.hold_duration_ms,
      transition_type: (fs.transition_type as "cut" | "dissolve" | "hold") ?? "cut",
      prompt_delta: fs.prompt_delta ?? null,
    }));
}

/**
 * Build TextOverlay[] from a scene's ticker_headline.
 */
function buildTextOverlays(scene: AssemblyManifest["scenes"][number]): TextOverlay[] {
  if (!scene.ticker_headline) return [];
  return [{ text: scene.ticker_headline, position: "lower-third" }];
}

/**
 * Build AvatarPip config from the composition plan entry for a scene.
 * Returns undefined if the layout doesn't include a PiP.
 */
function buildAvatarPip(layoutType: string): AvatarPip | undefined {
  if (layoutType === "AVATAR_PIP") {
    return {
      asset_id: null,          // HeyGen footage not yet linked at this layer
      position: "bottom-right",
      scale: 0.3,
      trim_start_ms: 0,
      trim_end_ms: 0,
    };
  }
  if (layoutType === "AVATAR_FULLSCREEN" || layoutType === "AVATAR_SPLIT") {
    return {
      asset_id: null,
      position: "hidden",      // Full-screen avatar managed by renderer, not PiP
      scale: 1.0,
      trim_start_ms: 0,
      trim_end_ms: 0,
    };
  }
  return undefined;
}

/**
 * Build Voiceover for a scene.
 * The TTS asset_id is not tracked at the scene level in the current schema,
 * so it starts as null and is populated by operators or future automation.
 */
function buildVoiceover(): Voiceover {
  return {
    asset_id: null,
    offset_ms: 0,
    trim_start_ms: 0,
  };
}

/**
 * Hydrate a VideoTimeline from assembly_manifest + scene_frame_sequences.
 *
 * This is the entry point called by the timeline repository when no saved
 * timeline exists yet for a job.
 */
export function hydrateTimelineFromManifest(params: HydrationParams): VideoTimeline {
  const { jobId, manifest, frameSequences, fps, targetDurationSeconds } = params;

  const timings = computeSceneTimings(manifest, fps, targetDurationSeconds);
  const totalMs = timings.reduce((sum, t) => Math.max(sum, t.start_ms + t.duration_ms), 0);

  const scenes: TimelineScene[] = manifest.scenes.map((scene, i) => {
    const timing = timings[i]!;

    // Layout from composition plan (fallback to AVATAR_PIP if plan absent)
    const planEntry = manifest.composition_plan?.entries.find(
      (e) => e.sceneIndex === scene.scene_index
    );
    const layoutType = planEntry?.layoutType ?? "AVATAR_PIP";
    const transitionIn = planEntry?.transitionIn ?? "CUT";
    const isHook = planEntry?.isHook ?? false;

    const videoFrames = buildVideoFrames(scene.scene_index, frameSequences);
    const textOverlays = buildTextOverlays(scene);
    const avatarPip = buildAvatarPip(layoutType);
    const voiceover = buildVoiceover();

    return {
      scene_index: scene.scene_index,
      scene_id: buildSceneId(jobId, scene.scene_index),
      start_ms: timing.start_ms,
      duration_ms: timing.duration_ms,
      layout_type: layoutType,
      transition_in: transitionIn,
      is_hook: isHook,
      video_frames: videoFrames,
      ...(avatarPip !== undefined ? { avatar_pip: avatarPip } : {}),
      text_overlays: textOverlays,
      voiceover,
      paragraph: scene.paragraph,
      image_prompt: scene.image_prompt ?? null,
      enriched_image_prompt: scene.enriched_image_prompt ?? null,
      shot_type: scene.shot_type ?? null,
      camera_angle: scene.camera_angle ?? null,
      // R2 key for the main visual (single-still scenes, used by compositor)
      preview_r2_key: scene.visual_asset_key ?? null,
      regeneration_requests: [],
    };
  });

  return {
    job_id: jobId,
    version: 1,
    total_duration_ms: totalMs,
    scenes,
    global_audio: {
      music_duck_db: -12,
      voiceover_gain_db: 0,
    },
  };
}
