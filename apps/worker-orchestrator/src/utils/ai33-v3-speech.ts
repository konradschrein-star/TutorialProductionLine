/**
 * AI33 v3 speech surface — multi-speaker dialogue TTS, speech-to-text, and
 * instant voice cloning. These are the richer v3 capabilities beyond plain
 * single-voice TTS (which lives in elevenlabs-client.ts / minimax-client.ts).
 *
 * AI33 is the LAST-RESORT backend; these are on-demand utilities.
 *
 * Endpoints (see docs/providers/ai33-v3-api.md):
 *   POST /v3/text-to-speech/dialogue   → { success, task_id }
 *   POST /v3/speech-to-text            → { success, task_id } (srt_url + json_url)
 *   POST /v3/text-to-speech/voice-clone→ { success, data: { voice_id } } (sync)
 *   DELETE /v3/text-to-speech/voice-clone/{id}
 *
 * All create endpoints use FormData. Do NOT set Content-Type manually.
 */

import {
  AI33_BASE_URL,
  submitAi33Form,
  pollAi33Task,
  resolveAudioUrl,
  downloadAi33Result,
  toBlob,
} from "./ai33-task.js";

// ---------------------------------------------------------------------------
// Dialogue TTS — multi-speaker conversation (A>/B>/C> labels)
// ---------------------------------------------------------------------------

export interface DialogueSpeaker {
  /** Provider-prefixed voice id (elevenlabs_/minimax_/clone_/edge_/kokoro_). */
  voiceId: string;
  /** 0.5–1.5. */
  speed?: number;
  /** 0–4 (ElevenLabs/Minimax only; omit for edge/kokoro). */
  similarity?: number;
}

export interface DialogueTTSOptions {
  /**
   * Script using `A>`, `B>`, `C>` speaker labels. Labels map to `speakers`
   * by array index (A=0, B=1, …). `*` inserts a 0.5s pause.
   */
  text: string;
  /** Ordered speakers; index maps to the A>/B>/C> label. */
  speakers: DialogueSpeaker[];
  /** Inter-line delay in seconds. */
  delay?: number;
  /** Return an SRT/JSON transcript alongside the audio. */
  withTranscript?: boolean;
}

export interface DialogueTTSResult {
  audio: Buffer;
  srtUrl?: string;
  jsonUrl?: string;
  creditCost?: number;
}

export async function generateDialogueTTS(
  apiKey: string,
  opts: DialogueTTSOptions,
): Promise<DialogueTTSResult> {
  if (opts.speakers.length === 0) {
    throw new Error("generateDialogueTTS: at least one speaker required");
  }

  const form = new FormData();
  form.append("text", opts.text);
  form.append(
    "speakers",
    JSON.stringify(
      opts.speakers.map((s) => {
        const speaker: Record<string, unknown> = { voice_id: s.voiceId };
        if (s.speed != null) speaker["speed"] = s.speed;
        if (s.similarity != null) speaker["similarity"] = s.similarity;
        return speaker;
      }),
    ),
  );
  if (opts.delay != null) form.append("delay", String(opts.delay));
  form.append("with_transcript", String(opts.withTranscript ?? false));

  const taskId = await submitAi33Form(
    apiKey,
    "/v3/text-to-speech/dialogue",
    form,
  );
  const task = await pollAi33Task(apiKey, taskId, { label: "dialogue" });

  const audioUrl = resolveAudioUrl(task);
  if (!audioUrl) {
    throw new Error(`AI33 dialogue task ${taskId} done but no audio_url`);
  }
  return {
    audio: await downloadAi33Result(audioUrl),
    srtUrl: task.metadata?.srt_url ?? undefined,
    jsonUrl: task.metadata?.json_url ?? undefined,
    creditCost: task.credit_cost,
  };
}

// ---------------------------------------------------------------------------
// Speech-to-text — transcribe audio → SRT + JSON transcript
// ---------------------------------------------------------------------------

export interface SpeechToTextOptions {
  /** Source audio (mp3/aac/wav/webm/flac/m4a/…, ≤200MB). */
  input: Buffer | Uint8Array | Blob;
  /** Upload filename (extension matters for AI33's format sniffing). */
  filename: string;
  /** Tag non-speech audio events in the transcript. Default true. */
  tagAudioEvents?: boolean;
}

export interface SpeechToTextResult {
  /** SRT subtitle file URL. */
  srtUrl?: string;
  /** JSON transcript URL. */
  jsonUrl?: string;
  creditCost?: number;
}

export async function transcribeSpeech(
  apiKey: string,
  opts: SpeechToTextOptions,
): Promise<SpeechToTextResult> {
  const form = new FormData();
  form.append("file", toBlob(opts.input), opts.filename);
  form.append("tag_audio_events", String(opts.tagAudioEvents ?? true));

  const taskId = await submitAi33Form(apiKey, "/v3/speech-to-text", form);
  const task = await pollAi33Task(apiKey, taskId, { label: "speech-to-text" });

  const srtUrl = task.metadata?.srt_url ?? undefined;
  const jsonUrl = task.metadata?.json_url ?? undefined;
  if (!srtUrl && !jsonUrl) {
    throw new Error(
      `AI33 speech-to-text task ${taskId} done but no transcript url`,
    );
  }
  return { srtUrl, jsonUrl, creditCost: task.credit_cost };
}

// ---------------------------------------------------------------------------
// Instant voice clone — register a voice from a sample, then use it in TTS
// as `clone_<voice_id>`.
// ---------------------------------------------------------------------------

export interface VoiceCloneOptions {
  /** Display name for the cloned voice. */
  voiceName: string;
  /** Reference audio sample. */
  audio: Buffer | Uint8Array | Blob;
  /** Upload filename. */
  filename: string;
}

/**
 * Create an instant voice clone. Returns the raw `voice_id`; prefix it with
 * `clone_` when passing to a TTS/dialogue call.
 */
export async function cloneVoice(
  apiKey: string,
  opts: VoiceCloneOptions,
): Promise<{ voiceId: string; ttsVoiceId: string }> {
  const form = new FormData();
  form.append("voice_name", opts.voiceName);
  form.append("audio_file", toBlob(opts.audio), opts.filename);

  const res = await fetch(`${AI33_BASE_URL}/v3/text-to-speech/voice-clone`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `AI33 voice-clone create failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as {
    success?: boolean;
    data?: { voice_id?: string };
    voice_id?: string;
  };
  const voiceId = data.data?.voice_id ?? data.voice_id;
  if (!voiceId) {
    throw new Error(
      `AI33 voice-clone create returned no voice_id: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return { voiceId, ttsVoiceId: `clone_${voiceId}` };
}

/** Delete a cloned voice by its raw voice id (without the `clone_` prefix). */
export async function deleteClonedVoice(
  apiKey: string,
  voiceId: string,
): Promise<void> {
  // Accept either the raw id or the `clone_`-prefixed TTS form.
  const rawId = voiceId.startsWith("clone_")
    ? voiceId.slice("clone_".length)
    : voiceId;

  const res = await fetch(
    `${AI33_BASE_URL}/v3/text-to-speech/voice-clone/${encodeURIComponent(rawId)}`,
    { method: "DELETE", headers: { "xi-api-key": apiKey } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `AI33 voice-clone delete failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
}
