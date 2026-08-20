/**
 * AI33 Edge TTS client — free Microsoft Edge neural voices via the AI33
 * gateway's dedicated `/v1e` surface.
 *
 * AI33 is the LAST-RESORT backend, and Edge TTS is explicitly for
 * testing/development (NOT production content — see
 * docs/deployment/edge-tts-deployment.md and the TTS-provider memory).
 *
 * Endpoint:
 *   POST /v1e/task/text-to-speech (JSON) → { success, task_id }
 *   Poll GET /v1/task/{id} → metadata.audio_url
 *
 * Edge voices are text-only: no `language`/`similarity` (per the v3 voice
 * matrix). `voice_id` is an Edge neural voice name (e.g.
 * `en-US-AvaNeural`) — the `edge_` prefix is stripped if present so callers
 * can pass the unified v3 id form too.
 */

import {
  submitAi33Json,
  pollAi33Task,
  resolveAudioUrl,
  downloadAi33Result,
} from "./ai33-task.js";

export interface EdgeTTSOptions {
  /** Edge neural voice, e.g. "en-US-AvaNeural" (or "edge_en-US-AvaNeural"). */
  voiceId: string;
  /** Speaking rate. Default 1. */
  speed?: number;
}

export async function generateEdgeTTS(
  apiKey: string,
  text: string,
  opts: EdgeTTSOptions,
): Promise<Buffer> {
  const voiceId = opts.voiceId.startsWith("edge_")
    ? opts.voiceId.slice("edge_".length)
    : opts.voiceId;

  const body: Record<string, unknown> = { text, voice_id: voiceId };
  if (opts.speed != null) body["speed"] = opts.speed;

  const taskId = await submitAi33Json(
    apiKey,
    "/v1e/task/text-to-speech",
    body,
  );
  const task = await pollAi33Task(apiKey, taskId, { label: "edge-tts" });

  const audioUrl = resolveAudioUrl(task);
  if (!audioUrl) {
    throw new Error(`AI33 edge-tts task ${taskId} done but no audio_url`);
  }
  return downloadAi33Result(audioUrl);
}
