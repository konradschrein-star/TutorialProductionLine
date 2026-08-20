/**
 * Minimax Client Utility
 *
 * Wrapper for Minimax TTS API via AI33 proxy.
 * Uses polling pattern for task completion.
 */

const AI33_BASE_URL = "https://api.ai33.pro";
const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds
const MAX_POLL_ATTEMPTS = 120; // Max 10 minutes (120 * 5s)

/**
 * Minimax Task Status Response
 */
interface MinimaxTaskResponse {
  id: string;
  status: "doing" | "done" | "error";
  progress?: number | null;
  credit_cost?: number;
  error_message?: string;
  metadata?: {
    audio_url?: string;
    srt_url?: string;
  };
  type: string;
}

/**
 * Generate TTS audio via Minimax API
 *
 * @param apiKey - AI33 API key (used for Minimax proxy)
 * @param voiceId - Minimax Voice ID
 * @param text - Text to convert to speech
 * @param options - Voice settings (speed, pitch, volume)
 * @returns Promise<Buffer> - Audio file content
 */
export async function generateMinimaxTTS(
  apiKey: string,
  voiceId: string,
  text: string,
  options: {
    model?: string;
    speed?: number;
    pitch?: number;
    volume?: number;
    languageBoost?: string;
  } = {},
): Promise<Buffer> {
  const {
    model = "speech-2.8-hd",
    speed = 1.24,
    pitch = 0,
    volume = 1.0,
    languageBoost = "Auto",
  } = options;

  console.log(
    JSON.stringify({
      level: "info",
      message: "Starting TTS generation via Minimax",
      voice_id: voiceId,
      text_length: text.length,
      model,
      speed,
      pitch,
      volume,
    }),
  );

  // 1. Submit Minimax TTS job
  const submitResponse = await fetch(
    `${AI33_BASE_URL}/v1m/task/text-to-speech`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model,
        effects: {
          robotic: false,
          nasal_crisp: 0,
          spacious_echo: false,
          deepen_lighten: 0,
          lofi_telephone: false,
          auditorium_echo: false,
          stronger_softer: 0,
        },
        audio_setting: {},
        voice_setting: {
          voice_id: voiceId,
          vol: volume,
          pitch,
          speed,
        },
        language_boost: languageBoost,
      }),
    },
  );

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    throw new Error(
      `Minimax TTS submission failed: ${submitResponse.status} ${errorText}`,
    );
  }

  const submitData = (await submitResponse.json()) as {
    success?: boolean;
    task_id?: string;
    ec_remain_credits?: number;
  };

  if (!submitData.success || !submitData.task_id) {
    throw new Error(
      `Minimax TTS submission failed: ${JSON.stringify(submitData)}`,
    );
  }

  const taskId = submitData.task_id;

  console.log(
    JSON.stringify({
      level: "info",
      message: "Minimax TTS task submitted",
      task_id: taskId,
      credits_remaining: submitData.ec_remain_credits,
    }),
  );

  // 2. Poll for completion (same endpoint as AI33)
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const pollResponse = await fetch(`${AI33_BASE_URL}/v1/task/${taskId}`, {
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
    });

    if (!pollResponse.ok) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Minimax task polling failed",
          task_id: taskId,
          status: pollResponse.status,
          attempt,
        }),
      );
      throw new Error(`Minimax task polling failed: ${pollResponse.status}`);
    }

    const taskData = (await pollResponse.json()) as MinimaxTaskResponse;

    console.log(
      JSON.stringify({
        level: "info",
        message: "Minimax task poll",
        task_id: taskId,
        status: taskData.status,
        progress: taskData.progress,
        attempt,
      }),
    );

    if (taskData.status === "error") {
      throw new Error(
        `Minimax TTS failed: ${taskData.error_message || "unknown error"}`,
      );
    }

    if (taskData.status === "done") {
      const audioUrl = taskData.metadata?.audio_url;
      if (!audioUrl) {
        throw new Error("Minimax TTS completed but no audio URL provided");
      }

      // 3. Download audio file
      const audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok) {
        throw new Error(
          `Failed to download Minimax audio: ${audioResponse.status}`,
        );
      }

      const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

      console.log(
        JSON.stringify({
          level: "info",
          message: "Minimax TTS audio downloaded",
          task_id: taskId,
          size_bytes: audioBuffer.length,
          credit_cost: taskData.credit_cost,
        }),
      );

      return audioBuffer;
    }
  }

  throw new Error(
    `Minimax task polling timeout after ${MAX_POLL_ATTEMPTS} attempts`,
  );
}
