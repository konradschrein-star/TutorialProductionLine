/**
 * AI33 ElevenLabs "extras" client — sound-effect, voice-changer, voice-isolate.
 *
 * These are the ElevenLabs audio tools exposed by AI33 beyond plain TTS
 * (which lives in `elevenlabs-client.ts`). AI33 is the last-resort backend,
 * so these are on-demand utilities rather than hot-path calls.
 *
 * All three are async tasks on the v1 surface:
 *   1. POST /v1/task/{sound-effect|voice-changer|voice-isolate}
 *      → { success, task_id, ec_remain_credits }
 *   2. Poll GET /v1/task/{task_id} until status === "done"
 *   3. Download the result audio.
 *
 * The result field differs per endpoint (verified against docs/api/AI 33
 * Elevanlabs API.md, 2026-07-11):
 *   sound-effect  → metadata.output_uri
 *   voice-changer → metadata.audio_url
 *   voice-isolate → output_uri at the ROOT of the task object
 * `resolveResultUrl()` checks all three so a shape change on AI33's side
 * degrades gracefully instead of silently returning empty audio.
 *
 * Auth header: `xi-api-key`. See reference-ai33-api.md.
 */

const AI33_BASE_URL = "https://api.ai33.pro";
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 120; // 10 min cap — voice-changer on long files is slow

interface Ai33SubmitResponse {
  success?: boolean;
  task_id?: string;
  ec_remain_credits?: number | string;
  message?: string;
  error?: { code?: string; message?: string };
}

interface Ai33TaskResponse {
  id?: string;
  status?: string;
  progress?: number | null;
  error_message?: string | null;
  // voice-isolate returns the result URI at the root of the task object.
  output_uri?: string | null;
  metadata?: {
    audio_url?: string | null;
    output_uri?: string | null;
    duration?: number | null;
    duration_seconds?: number | null;
  } | null;
  error_code?: string;
  error?: { code?: string; message?: string; retryable?: boolean };
}

/** Pull the finished-audio URL out of a done task across the endpoints' differing shapes. */
function resolveResultUrl(task: Ai33TaskResponse): string | undefined {
  return (
    task.metadata?.audio_url ??
    task.metadata?.output_uri ??
    task.output_uri ??
    undefined
  );
}

async function submitTask(
  apiKey: string,
  path: string,
  body: string | FormData,
  headers: Record<string, string>,
): Promise<string> {
  const res = await fetch(`${AI33_BASE_URL}${path}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, ...headers },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI33 ${path} submit failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as Ai33SubmitResponse;
  if (!data.success || !data.task_id) {
    throw new Error(
      `AI33 ${path} returned no task_id: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return data.task_id;
}

async function pollAndDownload(apiKey: string, taskId: string, label: string): Promise<Buffer> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${AI33_BASE_URL}/v1/task/${taskId}`, {
      headers: { "xi-api-key": apiKey },
    });
    if (!res.ok) continue;

    const task = (await res.json()) as Ai33TaskResponse;
    if (!task?.status) continue;

    if (task.status === "done") {
      const url = resolveResultUrl(task);
      if (!url) {
        throw new Error(
          `AI33 ${label} task ${taskId} done but no result URL: ${JSON.stringify(task.metadata ?? {}).slice(0, 300)}`,
        );
      }
      const audioRes = await fetch(url);
      if (!audioRes.ok) {
        throw new Error(`Failed to download AI33 ${label} audio from ${url}: ${audioRes.status}`);
      }
      return Buffer.from(await audioRes.arrayBuffer());
    }

    if (task.status === "error") {
      const err =
        task.error_message ?? task.error_code ?? task.error?.code ?? "unknown";
      throw new Error(`AI33 ${label} task ${taskId} failed: ${err}`);
    }
  }

  throw new Error(
    `AI33 ${label} task ${taskId} did not complete within ${(POLL_INTERVAL_MS * MAX_POLL_ATTEMPTS) / 1000}s`,
  );
}

/** Coerce a Buffer/Uint8Array/Blob input into a Blob for FormData upload. */
function toBlob(input: Buffer | Uint8Array | Blob): Blob {
  if (input instanceof Blob) return input;
  // Copy into a fresh Uint8Array so the Blob owns a clean ArrayBuffer slice.
  return new Blob([new Uint8Array(input)]);
}

// ---------------------------------------------------------------------------
// Sound effect — text → sound (JSON body)
// ---------------------------------------------------------------------------

export interface SoundEffectOptions {
  /** Sound prompt, max 450 chars. */
  text: string;
  /** 0.5–30s, or omit for auto (auto costs 200 credits; specified costs 50/sec). */
  durationSeconds?: number;
  /** Prompt adherence 0–1. Default 0.3. */
  promptInfluence?: number;
  /** Create a seamless loop. Default false. */
  loop?: boolean;
  /** Override model. Default eleven_text_to_sound_v2. */
  modelId?: string;
}

export async function generateSoundEffect(
  apiKey: string,
  opts: SoundEffectOptions,
): Promise<Buffer> {
  const body: Record<string, unknown> = {
    text: opts.text,
    prompt_influence: opts.promptInfluence ?? 0.3,
    loop: opts.loop ?? false,
    model_id: opts.modelId ?? "eleven_text_to_sound_v2",
  };
  if (opts.durationSeconds != null) {
    body["duration_seconds"] = Math.min(30, Math.max(0.5, opts.durationSeconds));
  }

  const taskId = await submitTask(
    apiKey,
    "/v1/task/sound-effect",
    JSON.stringify(body),
    { "Content-Type": "application/json" },
  );
  return pollAndDownload(apiKey, taskId, "sound-effect");
}

// ---------------------------------------------------------------------------
// Voice changer — speech-to-speech (multipart)
// ---------------------------------------------------------------------------

export interface VoiceChangerOptions {
  /** Source audio (MP3/M4A/WAV, ≤300MB). */
  input: Buffer | Uint8Array | Blob;
  /** Upload filename (extension matters for AI33's format sniffing). */
  filename: string;
  /** Target ElevenLabs voice id (bare id, e.g. 21m00Tcm4TlvDq8ikWAM). */
  voiceId: string;
  /** Override model. Default eleven_multilingual_sts_v2. */
  modelId?: string;
  /** ElevenLabs voice_settings — serialized to JSON for the request. */
  voiceSettings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
  };
  /** Strip background noise from the source before conversion. Default false. */
  removeBackgroundNoise?: boolean;
}

export async function changeVoice(
  apiKey: string,
  opts: VoiceChangerOptions,
): Promise<Buffer> {
  const form = new FormData();
  form.append("file", toBlob(opts.input), opts.filename);
  form.append("voice_id", opts.voiceId);
  form.append("model_id", opts.modelId ?? "eleven_multilingual_sts_v2");
  if (opts.voiceSettings) {
    form.append("voice_settings", JSON.stringify(opts.voiceSettings));
  }
  if (opts.removeBackgroundNoise != null) {
    form.append("remove_background_noise", String(opts.removeBackgroundNoise));
  }

  // No Content-Type — fetch sets the multipart boundary for FormData.
  const taskId = await submitTask(apiKey, "/v1/task/voice-changer", form, {});
  return pollAndDownload(apiKey, taskId, "voice-changer");
}

// ---------------------------------------------------------------------------
// Voice isolate — strip background noise, keep the voice (multipart)
// ---------------------------------------------------------------------------

export interface VoiceIsolateOptions {
  /** Source audio (MP3/M4A/WAV, ≤300MB, ≥5s). */
  input: Buffer | Uint8Array | Blob;
  /** Upload filename. */
  filename: string;
}

export async function isolateVoice(
  apiKey: string,
  opts: VoiceIsolateOptions,
): Promise<Buffer> {
  const form = new FormData();
  form.append("file", toBlob(opts.input), opts.filename);

  const taskId = await submitTask(apiKey, "/v1/task/voice-isolate", form, {});
  return pollAndDownload(apiKey, taskId, "voice-isolate");
}
