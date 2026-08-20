/**
 * AI33 v3 ElevenLabs TTS client — https://api.ai33.pro/v3/text-to-speech
 *
 * AI33 migrated to the unified v3 TTS endpoint; the old
 * `/v1/text-to-speech/{voice_id}` path now returns
 * `{"success":false,"message":"please use api v3 for this endpoint"}`.
 * v3 takes multipart FormData with a provider-prefixed `voice_id`
 * (`elevenlabs_<id>`) and the `xi-api-key` header (verified working
 * 2026-07-11). See reference-ai33-api.md.
 *
 * Flow:
 *   1. POST /v3/text-to-speech (FormData: text, voice_id, speed?, with_transcript)
 *      → { success: true, task_id }
 *   2. Poll GET /v1/task/{task_id} until status === "done"
 *   3. Download audio from metadata.audio_url
 */

const AI33_BASE = "https://api.ai33.pro";
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 240; // 20 min cap — matches V3 cap

export interface ElevenLabsTTSSettings {
  speed?: number;
  similarity?: number;
  /** ElevenLabs model id — default eleven_multilingual_v2 */
  modelId?: string;
}

interface Ai33SubmitResponse {
  success: boolean;
  task_id?: string;
  message?: string;
  error?: { code?: string; message?: string };
}

interface Ai33TaskResponse {
  id: string;
  status: string;
  progress?: number | null;
  metadata?: {
    audio_url?: string | null;
  };
  error_code?: string;
  error?: { code?: string; message?: string; retryable?: boolean };
}

export async function generateElevenLabsTTS(
  apiKey: string,
  voiceId: string,
  text: string,
  settings: ElevenLabsTTSSettings = {},
): Promise<Buffer> {
  // v3 voice IDs are provider-prefixed. Keep a recognized prefix as-is
  // (elevenlabs_/kokoro_); prepend "elevenlabs_" to a bare ElevenLabs id.
  const v3VoiceId =
    voiceId.startsWith("elevenlabs_") || voiceId.startsWith("kokoro_")
      ? voiceId
      : `elevenlabs_${voiceId}`;

  const form = new FormData();
  form.append("text", text);
  form.append("voice_id", v3VoiceId);
  if (settings.speed != null) {
    // v3 accepts 0.5–1.5
    form.append("speed", String(Math.min(1.5, Math.max(0.5, settings.speed))));
  }
  form.append("with_transcript", "false");

  const submitRes = await fetch(`${AI33_BASE}/v3/text-to-speech`, {
    method: "POST",
    // No Content-Type — fetch sets the multipart boundary for FormData.
    headers: { "xi-api-key": apiKey },
    body: form,
  });

  if (!submitRes.ok) {
    const body = await submitRes.text();
    throw new Error(
      `ElevenLabs v3 TTS submit failed (${submitRes.status}): ${body.slice(0, 300)}`,
    );
  }

  const submitData = (await submitRes.json()) as Ai33SubmitResponse;

  if (!submitData.success || !submitData.task_id) {
    throw new Error(
      `ElevenLabs v3 TTS submit returned no task_id: ${JSON.stringify(submitData).slice(0, 200)}`,
    );
  }

  const taskId = submitData.task_id;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await fetch(`${AI33_BASE}/v1/task/${taskId}`, {
      headers: { "xi-api-key": apiKey },
    });

    if (!pollRes.ok) {
      continue;
    }

    // V1 returns the task object directly at the root, not wrapped in { data }.
    const taskData = (await pollRes.json()) as Ai33TaskResponse;

    if (!taskData?.status) continue;

    if (taskData.status === "done") {
      const audioUrl = taskData.metadata?.audio_url;
      if (!audioUrl) {
        throw new Error(`TTS task ${taskId} done but no audio_url in metadata`);
      }

      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) {
        throw new Error(
          `Failed to download TTS audio from ${audioUrl}: ${audioRes.status}`,
        );
      }
      return Buffer.from(await audioRes.arrayBuffer());
    }

    if (taskData.status === "error") {
      const errCode = taskData.error_code ?? taskData.error?.code ?? "unknown";
      throw new Error(`TTS task ${taskId} failed: ${errCode}`);
    }
  }

  throw new Error(
    `TTS task ${taskId} did not complete within ${(POLL_INTERVAL_MS * MAX_POLL_ATTEMPTS) / 1000}s`,
  );
}
