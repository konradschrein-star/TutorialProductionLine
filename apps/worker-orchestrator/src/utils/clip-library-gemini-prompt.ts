/**
 * Gemini prompt for universal clip library analysis.
 *
 * Receives frames (25%, 50%, 75% through the clip) + clip metadata.
 * Returns structured JSON with complete metadata or a rejection.
 */

export interface ClipAnalysisInput {
  source_title: string;
  source_franchise?: string;
  source_type: string;
  source_year?: number;
  source_episode?: string;
  clip_duration_seconds: number;
  library_context?: string;
  /**
   * Scene context of the immediately previous clip in this source video.
   * Lets Gemini anchor sub-second / micro-clips that lack a self-evident
   * subject. Plumbed in by the clip-label-batch processor.
   */
  prev_clip_context?: string;
}

export type ClipAnalysisResult =
  | {
      accepted: true;
      source_title: string;
      source_franchise: string | null;
      source_type:
        | "film"
        | "tv_series"
        | "documentary"
        | "short_film"
        | "news"
        | "stream"
        | "commercial"
        | "music_video"
        | "video_game_cutscene"
        | "other";
      source_year: number | null;
      source_episode: string | null;
      source_studio: string | null;
      is_real_footage: boolean;
      media_type:
        | "live_action"
        | "animation_2d"
        | "animation_3d"
        | "cgi"
        | "mixed_media"
        | "stop_motion";
      has_watermark: boolean;
      has_burned_subtitles: boolean;
      has_letterbox: boolean;
      quality_tier: "broadcast" | "web" | "degraded" | "poor";
      shot_scale:
        | "extreme_close_up"
        | "close_up"
        | "medium_close_up"
        | "medium"
        | "medium_wide"
        | "wide"
        | "extreme_wide";
      camera_movement:
        | "static"
        | "pan"
        | "tilt"
        | "zoom"
        | "dolly"
        | "handheld"
        | "tracking"
        | "aerial"
        | "crane"
        | "mixed";
      lighting_style:
        | "natural"
        | "studio"
        | "high_key"
        | "low_key"
        | "dark"
        | "neon"
        | "mixed";
      color_temperature: "warm" | "neutral" | "cool" | "desaturated" | "mixed";
      motion_level: "static" | "low" | "medium" | "high" | "very_high";
      is_slow_motion: boolean;
      dominant_mood: string;
      face_count: number;
      has_dialogue: boolean;
      has_music: boolean;
      audio_type:
        | "dialogue_heavy"
        | "music_heavy"
        | "ambient"
        | "silent"
        | "mixed";
      tags_characters: string[];
      tags_location: string[];
      tags_action: string[];
      tags_mood: string[];
      tags_themes: string[];
      tags_objects: string[];
      keywords: string[];
      clip_type:
        | "action"
        | "dialogue"
        | "establishing"
        | "reaction"
        | "montage"
        | "transition"
        | "exposition"
        | "b_roll";
      scene_context: string;
      ai_description: string;
      confidence: number;
    }
  | {
      accepted: false;
      rejection_reason:
        | "credits"
        | "title_card"
        | "watermark"
        | "logo_screen"
        | "black_frame"
        | "test_pattern"
        | "aspect_ratio_error"
        | "too_short"
        | "too_dark"
        | "heavily_compressed"
        | "behind_scenes_lower_third"
        | "other";
      rejection_detail: string;
    };

export function buildClipAnalysisPrompt(input: ClipAnalysisInput): string {
  const libraryNote = input.library_context
    ? `\nLibrary context: ${input.library_context}`
    : "";
  const prevNote = input.prev_clip_context
    ? `\nImmediately previous clip in this source video: ${input.prev_clip_context}`
    : "";
  const microNote =
    input.clip_duration_seconds < 1.0
      ? `\nNOTE: this clip is under 1 second long — focus on the single action/transition rather than describing a full scene. Use the previous-clip context (when present) to anchor what's happening.`
      : "";

  return `You are a professional video archivist and metadata specialist building a searchable clip library for AI-assisted video production.

You are analyzing a video clip from:
- Source: ${input.source_title}${input.source_franchise ? ` (${input.source_franchise} franchise)` : ""}
- Type: ${input.source_type}${input.source_year ? `, ${input.source_year}` : ""}${input.source_episode ? `, ${input.source_episode}` : ""}
- Duration: ${input.clip_duration_seconds.toFixed(1)} seconds${libraryNote}${prevNote}${microNote}

You are given EITHER:
- the actual video clip (up to 30 seconds), in which case you can read motion, pacing, camera movement, and temporal action directly, OR
- 3 still frames sampled at 25%, 50%, and 75% through the clip (fallback path)

When you receive the video, prefer judging motion_level and camera_movement from observed motion rather than inferring from a single frame.

---

STEP 1 — REJECTION CHECK

First, determine if this clip should be rejected. Reject immediately (set accepted: false) if ANY of the following are true:

- Credits sequence: rolling credits, end titles, cast lists, crew credits
- Title card or studio logo: studio ident, chapter title card, episode title screen
- Persistent watermark: a channel logo, streaming service bug, or copyright stamp covering meaningful content
- Black or near-black frames: more than half the clip is black (not a dramatic dark scene — actually black/empty)
- Test pattern or technical content: color bars, slates, countdowns
- Heavily degraded: severe VHS noise, extreme compression artifacts making the clip unusable
- Letterbox/pillarbox artifact frame: if the clip is ONLY black bars with no content
- Too short to be useful: under 1.5 seconds with no clear content
- News lower third: a clip dominated by a news ticker or chyron that obscures the content
- Behind-the-scenes marker: visible clapperboard, "TAKE X" overlay, visible boom mic in a way that breaks the scene

If the clip passes all rejection criteria, set accepted: true and continue to Step 2.

---

STEP 2 — FULL ANALYSIS

Fill in every field precisely. Use your knowledge of the source material for narrative context. Be specific — vague answers degrade search quality.

FIELD GUIDE:

**source_title** — Confirm or correct the title if you can identify it from the frames. Use the official full title.

**is_real_footage** — true ONLY if this depicts the real physical world (live documentary, news, real people in real locations). false for anything fictional, animated, CGI, or acted.

**media_type** — How was this made?
  live_action: real camera, real actors, practical sets (even if VFX added)
  animation_2d: traditional or digital 2D animation
  animation_3d: 3D CGI animation (Pixar style)
  cgi: photorealistic CGI or virtual production (The Mandalorian volume)
  mixed_media: combination (live action + significant CGI integration)
  stop_motion: physical stop-motion animation

**shot_scale** — The dominant framing:
  extreme_close_up: eyes/mouth only
  close_up: face fills frame
  medium_close_up: chest up
  medium: waist up
  medium_wide: knees up, showing some environment
  wide: full body visible with significant environment
  extreme_wide: environment dominant, person small or absent

**camera_movement** — The dominant movement across the clip. "mixed" only if it genuinely changes multiple times.

**motion_level** — How much is moving within the frame:
  static: nothing moves (static shot, static subject)
  low: subtle movement (talking, slow walk)
  medium: moderate movement (walking, light action)
  high: significant movement (running, fighting, vehicles)
  very_high: intense action, rapid cuts, chaotic movement

**tags_characters** — Every named individual you can identify with reasonable confidence. Use their full canonical name. For unknown or background characters, omit rather than guess.

**tags_location** — Specific locations, not generic. "Geonosis Arena" not "arena". "Coruscant Senate Chamber" not "senate".

**tags_action** — Active verbs describing what is specifically happening. Be precise: "lightsaber duel" not "fighting". "force choke" not "gesture". List 2-6 actions.

**tags_themes** — Abstract thematic elements: "betrayal", "sacrifice", "power struggle", "redemption". 1-4 themes.

**tags_objects** — Significant props or objects: "lightsaber", "hologram table", "Death Star controls".

**keywords** — Anything else that would be a useful search term. Free-form, 3-8 entries.

**clip_type** — The primary narrative function:
  action: physical conflict, chase, combat
  dialogue: two or more characters talking (dialogue is the focus)
  establishing: shows a location, sets a scene, no character focus
  reaction: character reacting to something (close up of face/emotion)
  montage: rapid sequence of images, training, time passing
  transition: between scenes, travel shot
  exposition: information delivery, narration, explainer
  b_roll: supplementary footage, background action

**scene_context** — THE MOST IMPORTANT FIELD. One to three sentences describing what is happening in NARRATIVE terms — not what is visually on screen, but what this means in the story. Use your knowledge of the source material.
  GOOD: "Anakin Skywalker's first encounter with Count Dooku ends in catastrophic defeat — he loses his right arm and is only saved by Yoda's arrival, a moment that plants the seeds of his eventual fall to the dark side."
  BAD: "Two men with lightsabers fighting in a dark room."

**ai_description** — What is literally, visually on screen. Describe composition, color, atmosphere. 2-4 sentences. Complement scene_context, don't repeat it.

**dominant_mood** — Single most accurate mood word. Choose precisely: "dread" not "scary". "grief" not "sad".

**confidence** — Your confidence in the overall analysis, 0.0 to 1.0. Reduce for: partial frames, very dark clips, unfamiliar source material.

---

OUTPUT FORMAT

Reply with ONLY valid JSON, no markdown fences, no commentary.

If rejecting:
{"accepted":false,"rejection_reason":"credits","rejection_detail":"Rolling end credits with cast and crew names over black background."}

If accepting, return the complete object with all fields filled. Never omit a field. Use null only where explicitly allowed. Empty arrays [] are acceptable for tags when genuinely nothing applies (rare).`;
}
