/**
 * AI33 dubbing client — dub an audio file into a target language.
 *
 * AI33 is the LAST-RESORT backend; this is an on-demand utility.
 *
 * Endpoint (docs/api/AI 33 Elevanlabs API.md):
 *   POST /v1/task/dubbing  (multipart)
 *     file, target_lang, source_lang?, num_speakers?, disable_voice_cloning?
 *   → { success, task_id }; poll GET /v1/task/{id} → metadata.audio_url + srt_url
 *
 * File limit: audio only (.mp3/.m4a), max 20MB or 5 minutes.
 */

import {
  submitAi33Form,
  pollAi33Task,
  resolveAudioUrl,
  downloadAi33Result,
  toBlob,
} from "./ai33-task.js";

export interface DubbingOptions {
  /** Source audio (.mp3/.m4a, ≤20MB / ≤5min). */
  input: Buffer | Uint8Array | Blob;
  /** Upload filename. */
  filename: string;
  /** Target language to dub into (e.g. "es", "de"). */
  targetLang: string;
  /** Source language; default "auto" (auto-detect). */
  sourceLang?: string;
  /** Number of speakers; 0 = auto-detect (default). */
  numSpeakers?: number;
  /**
   * Use a similar ElevenLabs library voice instead of cloning the source
   * voice. Default false (clone the source voice).
   */
  disableVoiceCloning?: boolean;
}

export interface DubbingResult {
  audio: Buffer;
  srtUrl?: string;
  creditCost?: number;
}

export async function dubAudio(
  apiKey: string,
  opts: DubbingOptions,
): Promise<DubbingResult> {
  const form = new FormData();
  form.append("file", toBlob(opts.input), opts.filename);
  form.append("target_lang", opts.targetLang);
  form.append("source_lang", opts.sourceLang ?? "auto");
  form.append("num_speakers", String(opts.numSpeakers ?? 0));
  form.append(
    "disable_voice_cloning",
    String(opts.disableVoiceCloning ?? false),
  );

  const taskId = await submitAi33Form(apiKey, "/v1/task/dubbing", form);
  // Dubbing is slower than TTS — allow the full 20 min cap.
  const task = await pollAi33Task(apiKey, taskId, { label: "dubbing" });

  const audioUrl = resolveAudioUrl(task);
  if (!audioUrl) {
    throw new Error(`AI33 dubbing task ${taskId} done but no audio_url`);
  }
  return {
    audio: await downloadAi33Result(audioUrl),
    srtUrl: task.metadata?.srt_url ?? undefined,
    creditCost: task.credit_cost,
  };
}
