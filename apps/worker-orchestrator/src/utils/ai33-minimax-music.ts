/**
 * AI33 Minimax music generation client.
 *
 * A cheaper/alternative music generator to Suno (ai33-suno.ts). AI33 is the
 * LAST-RESORT backend; this is an on-demand utility.
 *
 * Endpoint (docs/api/Minimax doc.md):
 *   POST /v1m/task/music-generation (JSON) → { success, task_id }
 *   Poll GET /v1/task/{id} → metadata.music_result.data[].audio_url
 *
 * Requires at least `idea` (style/description) or `lyrics`. When
 * `instrumental` is true, lyrics must be empty (music-2.5+ only).
 */

import {
  submitAi33Json,
  pollAi33Task,
  downloadAi33Result,
} from "./ai33-task.js";

export type MinimaxMusicModel = "music-2.5+" | "music-2.5" | "music-2.0";

export interface MinimaxMusicOptions {
  /** Style/description (max 2000 chars). Required if no lyrics. */
  idea?: string;
  /** Song lyrics (max 3500 chars). Required if no idea; empty if instrumental. */
  lyrics?: string;
  /** Song title (max 40 chars). */
  title?: string;
  /** Model. Default music-2.5+. */
  model?: MinimaxMusicModel;
  /** Instrumental only (music-2.5+ only). Default false. */
  instrumental?: boolean;
  /** Number of tracks (1–3). Default 1. */
  n?: number;
}

export interface MinimaxMusicTrack {
  audioUrl: string;
  title?: string;
  /** Duration in seconds (Minimax reports milliseconds; normalized here). */
  durationSeconds?: number;
  musicId?: string;
}

interface MinimaxMusicMetadata {
  music_result?: {
    data?: Array<{
      audio_url?: string;
      title?: string;
      duration?: number; // milliseconds
      music_id?: string;
    }>;
  };
}

/**
 * Generate music via Minimax and return the track URLs (not downloaded).
 * Use `generateMinimaxMusicBuffer` for the first track as a Buffer.
 */
export async function generateMinimaxMusic(
  apiKey: string,
  opts: MinimaxMusicOptions,
): Promise<MinimaxMusicTrack[]> {
  const instrumental = opts.instrumental ?? false;
  if (!opts.idea && !opts.lyrics) {
    throw new Error(
      "generateMinimaxMusic: at least one of `idea` or `lyrics` is required",
    );
  }
  if (instrumental && opts.lyrics) {
    throw new Error(
      "generateMinimaxMusic: `lyrics` must be empty when `instrumental` is true",
    );
  }

  const body: Record<string, unknown> = {
    model: opts.model ?? "music-2.5+",
    generation_type: 1,
    rewrite_idea_switch: false,
    instrumental,
    n: Math.min(3, Math.max(1, opts.n ?? 1)),
  };
  if (opts.idea) body["idea"] = opts.idea;
  if (opts.lyrics && !instrumental) body["lyrics"] = opts.lyrics;
  if (opts.title) body["title"] = opts.title;

  const taskId = await submitAi33Json(
    apiKey,
    "/v1m/task/music-generation",
    body,
  );
  const task = await pollAi33Task(apiKey, taskId, { label: "minimax-music" });

  const meta = (task.metadata ?? {}) as MinimaxMusicMetadata;
  const data = meta.music_result?.data ?? [];
  const tracks: MinimaxMusicTrack[] = data
    .filter((d) => d.audio_url)
    .map((d) => ({
      audioUrl: d.audio_url as string,
      title: d.title,
      durationSeconds:
        typeof d.duration === "number"
          ? Math.round(d.duration / 1000)
          : undefined,
      musicId: d.music_id,
    }));

  if (tracks.length === 0) {
    throw new Error(
      `AI33 minimax-music task ${taskId} done but no audio_url in music_result`,
    );
  }
  return tracks;
}

/** Convenience: generate and download the first Minimax music track. */
export async function generateMinimaxMusicBuffer(
  apiKey: string,
  opts: MinimaxMusicOptions,
): Promise<{ audio: Buffer; track: MinimaxMusicTrack }> {
  const [track] = await generateMinimaxMusic(apiKey, opts);
  if (!track) throw new Error("AI33 minimax-music returned no track");
  return { audio: await downloadAi33Result(track.audioUrl), track };
}
