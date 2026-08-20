import type { Env } from "@repo/config";
import { Readable } from "stream";
import { deleteTask as ai33DeleteTask } from "./ai33-management.js";
import {
  ai33CircuitBreaker,
  ai33TTSCircuitBreaker,
} from "./ai33-circuit-breaker.js";

/**
 * AI33 Client Utility
 *
 * IMPORTANT: AI33 is a unified API gateway that supports TWO TTS engines:
 *
 * 1. AI33 ElevenLabs Engine (DEPRECATED - unreliable, do NOT use):
 *    - Endpoint: POST /v1/text-to-speech/{voiceId}
 *    - Body format: { text, model_id: "eleven_multilingual_v2", with_transcript: false }
 *    - Voice IDs: ElevenLabs-specific IDs (e.g., "3jR9BuQAOPMWUjWpi0ll")
 *    - Status: Often times out, stuck in "doing" status indefinitely
 *
 * 2. AI33 Minimax Engine (CURRENT - reliable, use this):
 *    - Endpoint: POST /v1m/task/text-to-speech
 *    - Body format: { text, model: "speech-2.8-hd", voice_setting: { voice_id, speed, pitch, vol }, ... }
 *    - Voice IDs: Minimax-specific IDs (e.g., "209533299589217")
 *    - Status: Reliable, completes tasks successfully
 *
 * This file currently uses the MINIMAX ENGINE format for all TTS generation.
 */

const AI33_BASE_URL = "https://api.ai33.pro";
const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds
const MAX_POLL_ATTEMPTS = 120; // Max 10 minutes (120 * 5s)

/**
 * AI33 Task Status Response
 */
interface AI33TaskResponse {
  id: string;
  status: "doing" | "done" | "error";
  progress: number;
  credit_cost?: number;
  error_message?: string;
  metadata?: {
    audio_url?: string;
    srt_url?: string;
    json_url?: string;
    result_images?: Array<{
      id: string;
      imageUrl: string;
      previewUrl: string;
      mimeType: string;
      width: number;
      height: number;
    }>;
  };
  type: string;
}

/**
 * Generate TTS audio via AI33 Minimax Engine
 *
 * IMPORTANT: This function uses the AI33 MINIMAX engine, NOT the ElevenLabs engine.
 * See file header comments for details on the two AI33 TTS engines.
 *
 * @param apiKey - AI33 API key
 * @param voiceId - Minimax Voice ID (e.g., "209533299589217")
 * @param text - Text to convert to speech
 * @returns Promise<Buffer> - Audio file content
 */
export async function generateTTS(
  apiKey: string,
  voiceId: string,
  text: string,
): Promise<Buffer> {
  if (ai33TTSCircuitBreaker.isOpen()) {
    throw new Error(
      `AI33 TTS circuit open — service unavailable, retrying in ${Math.round(ai33TTSCircuitBreaker.getDelayMs() / 1000)}s`,
    );
  }

  console.log(
    JSON.stringify({
      level: "info",
      message: "Starting TTS generation via AI33 Minimax",
      voice_id: voiceId,
      text_length: text.length,
    }),
  );

  try {
    // 1. Submit TTS job using MINIMAX format
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
          model: "speech-2.8-hd",
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
            vol: 1.0,
            pitch: 0,
            speed: 1.24,
          },
          language_boost: "Auto",
        }),
      },
    );

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      throw new Error(
        `AI33 TTS submission failed: ${submitResponse.status} ${errorText}`,
      );
    }

    const submitData = (await submitResponse.json()) as {
      success?: boolean;
      task_id?: string;
      ec_remain_credits?: number;
    };
    if (!submitData.success || !submitData.task_id) {
      throw new Error(
        `AI33 TTS submission failed: ${JSON.stringify(submitData)}`,
      );
    }

    const taskId = submitData.task_id;

    console.log(
      JSON.stringify({
        level: "info",
        message: "TTS job submitted, polling for completion",
        task_id: taskId,
        credits_remaining: submitData.ec_remain_credits,
      }),
    );

    // 2. Poll for completion
    const taskResult = await pollTaskCompletion(apiKey, taskId);

    // 3. Download audio file
    if (!taskResult.metadata?.audio_url) {
      throw new Error("TTS task completed but no audio_url in metadata");
    }

    console.log(
      JSON.stringify({
        level: "info",
        message: "Downloading TTS audio",
        audio_url: taskResult.metadata.audio_url,
      }),
    );

    const audioResponse = await fetch(taskResult.metadata.audio_url);
    if (!audioResponse.ok) {
      throw new Error(`Failed to download TTS audio: ${audioResponse.status}`);
    }

    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

    console.log(
      JSON.stringify({
        level: "info",
        message: "TTS audio downloaded",
        size_bytes: audioBuffer.length,
        credit_cost: taskResult.credit_cost,
      }),
    );

    return audioBuffer;
  } catch (err) {
    // Don't open the circuit for circuit-already-open re-throws (shouldn't happen, but guard anyway)
    if (
      !(err instanceof Error) ||
      !err.message.startsWith("AI33 TTS circuit open")
    ) {
      await ai33TTSCircuitBreaker.onError(apiKey);
    }
    throw err;
  }
}

/**
 * Generate TTS audio via AI33 ElevenLabs Engine.
 *
 * Uses the ElevenLabs endpoint on the AI33 gateway. Returns audio as an async task
 * that must be polled until completion.
 *
 * @param apiKey - AI33 API key
 * @param voiceId - ElevenLabs voice ID (e.g., "3jR9BuQAOPMWUjWpi0ll")
 * @param text - Text to convert to speech
 * @param modelId - ElevenLabs model (default: "eleven_multilingual_v2")
 */
export async function generateTTSElevenLabs(
  apiKey: string,
  voiceId: string,
  text: string,
  modelId: string = "eleven_multilingual_v2",
): Promise<Buffer> {
  if (ai33TTSCircuitBreaker.isOpen()) {
    throw new Error(
      `AI33 TTS circuit open — service unavailable, retrying in ${Math.round(ai33TTSCircuitBreaker.getDelayMs() / 1000)}s`,
    );
  }

  console.log(
    JSON.stringify({
      level: "info",
      message: "Starting TTS generation via AI33 ElevenLabs",
      voice_id: voiceId,
      model_id: modelId,
      text_length: text.length,
    }),
  );

  try {
    const submitResponse = await fetch(
      `${AI33_BASE_URL}/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          with_transcript: false,
        }),
      },
    );

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      throw new Error(
        `AI33 ElevenLabs TTS submission failed: ${submitResponse.status} ${errorText}`,
      );
    }

    const contentType = submitResponse.headers.get("content-type") ?? "";

    // Direct audio response (sync endpoint)
    if (contentType.includes("audio/")) {
      const audioBuffer = Buffer.from(await submitResponse.arrayBuffer());
      console.log(
        JSON.stringify({
          level: "info",
          message: "AI33 ElevenLabs TTS returned audio directly",
          size_bytes: audioBuffer.length,
        }),
      );
      return audioBuffer;
    }

    // Async task response — poll for completion
    const submitData = (await submitResponse.json()) as {
      success?: boolean;
      task_id?: string;
      ec_remain_credits?: number;
    };

    if (!submitData.task_id) {
      throw new Error(
        `AI33 ElevenLabs TTS submission missing task_id: ${JSON.stringify(submitData)}`,
      );
    }

    const taskId = submitData.task_id;
    console.log(
      JSON.stringify({
        level: "info",
        message: "AI33 ElevenLabs TTS job submitted, polling",
        task_id: taskId,
        credits_remaining: submitData.ec_remain_credits,
      }),
    );

    const taskResult = await pollTaskCompletion(apiKey, taskId);

    if (!taskResult.metadata?.audio_url) {
      throw new Error(
        "AI33 ElevenLabs TTS task completed but no audio_url in metadata",
      );
    }

    const audioResponse = await fetch(taskResult.metadata.audio_url);
    if (!audioResponse.ok) {
      throw new Error(
        `Failed to download AI33 ElevenLabs TTS audio: ${audioResponse.status}`,
      );
    }

    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    console.log(
      JSON.stringify({
        level: "info",
        message: "AI33 ElevenLabs TTS audio downloaded",
        size_bytes: audioBuffer.length,
        credit_cost: taskResult.credit_cost,
      }),
    );

    return audioBuffer;
  } catch (err) {
    if (
      !(err instanceof Error) ||
      !err.message.startsWith("AI33 TTS circuit open")
    ) {
      await ai33TTSCircuitBreaker.onError(apiKey);
    }
    throw err;
  }
}

/**
 * Generate image via AI33 with dual-key failover.
 *
 * Key priority: AI33 key1 → AI33 key2 (backup account). No external fallback.
 *
 * @param referenceImages - Optional reference image buffers. Must correspond 1:1 with
 *                          @img1, @img2... references in the prompt. Use
 *                          buildReferenceInjectedPrompt() from @repo/domain to assemble.
 */
export async function generateImage(
  apiKey: string,
  prompt: string,
  aspectRatio: string = "16:9",
  modelOverride?: { id: string; resolution?: string },
  referenceImages?: Uint8Array[],
  seed?: number,
): Promise<Buffer> {
  const { generateImageAI33 } = await import("@repo/media-core");

  const apiKey2 = process.env["AI33_API_KEY_2"];
  const keys: Array<{ key: string; label: string }> = [
    { key: apiKey, label: "AI33 key1" },
    ...(apiKey2 ? [{ key: apiKey2, label: "AI33 key2" }] : []),
  ];

  // Skip AI33 entirely when the circuit is open (imagen in maintenance/down)
  let lastAI33Error: string | null = null;
  if (ai33CircuitBreaker.isOpen()) {
    console.log(
      JSON.stringify({
        level: "info",
        message:
          "AI33 circuit open — image generation will fail fast (no fallback)",
        prompt_length: prompt.length,
      }),
    );
    lastAI33Error = "circuit open";
  } else {
    console.log(
      JSON.stringify({
        level: "info",
        message: "Starting image generation via AI33 (primary)",
        prompt_length: prompt.length,
        aspect_ratio: aspectRatio,
        model: modelOverride?.id ?? "nanob2-default",
        // `null` = the caller pinned a model that declares no resolutions, so
        // none is sent. Distinct from "2K", which is only the built-in default.
        resolution: modelOverride
          ? (modelOverride.resolution ?? null)
          : "2K (default)",
        reference_images_count: referenceImages?.length ?? 0,
        available_keys: keys.length,
        seed: seed ?? null,
      }),
    );

    // Try each AI33 key in sequence
    for (const { key, label } of keys) {
      try {
        const buffer = await generateImageAI33(
          key,
          prompt,
          aspectRatio,
          modelOverride,
          referenceImages,
          seed,
        );
        console.log(
          JSON.stringify({
            level: "info",
            message: "AI33 image generation complete",
            provider: label,
            size_bytes: buffer.length,
          }),
        );
        return buffer;
      } catch (err) {
        lastAI33Error = err instanceof Error ? err.message : String(err);
        console.log(
          JSON.stringify({
            level: "warn",
            message: `AI33 image generation failed on ${label}, trying next`,
            error: lastAI33Error.slice(0, 150),
          }),
        );
      }
    }
  }

  // Google Gemini SDK fallback is intentionally disabled.
  // It cannot pass reference images (causing style loss) and ignores aspect ratio
  // (always generates 1:1 instead of 16:9). See docs/google-gemini-image-fallback.md.
  // If AI33 is down, jobs should queue and wait — not silently produce broken images.
  throw new Error(
    `Image generation failed: all AI33 keys exhausted. Last error: ${lastAI33Error?.slice(0, 200)}`,
  );
}

/**
 * Poll AI33 task until completion or failure
 */
async function pollTaskCompletion(
  apiKey: string,
  taskId: string,
): Promise<AI33TaskResponse> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const response = await fetch(`${AI33_BASE_URL}/v1/task/${taskId}`, {
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`AI33 task polling failed: ${response.status}`);
    }

    const task = (await response.json()) as AI33TaskResponse;

    console.log(
      JSON.stringify({
        level: "info",
        message: "AI33 task poll",
        task_id: taskId,
        status: task.status,
        progress: task.progress,
        attempt: attempt + 1,
      }),
    );

    if (task.status === "done") {
      return task;
    }

    if (task.status === "error") {
      try {
        await ai33DeleteTask(apiKey, [taskId]);
        console.log(
          JSON.stringify({
            level: "info",
            message: "AI33 failed task auto-deleted for credit refund",
            task_id: taskId,
          }),
        );
      } catch (delErr) {
        const delMsg =
          delErr instanceof Error ? delErr.message : String(delErr);
        console.log(
          JSON.stringify({
            level: "warn",
            message: "AI33 auto-delete of failed task errored (non-fatal)",
            task_id: taskId,
            error: delMsg,
          }),
        );
      }
      throw new Error(
        `AI33 task failed: ${task.error_message || "Unknown error"}`,
      );
    }

    // Wait before next poll
    await sleep(POLL_INTERVAL_MS);
  }

  try {
    await ai33DeleteTask(apiKey, [taskId]);
    console.log(
      JSON.stringify({
        level: "info",
        message: "AI33 timed-out task auto-deleted for credit refund",
        task_id: taskId,
      }),
    );
  } catch (delErr) {
    const delMsg = delErr instanceof Error ? delErr.message : String(delErr);
    console.log(
      JSON.stringify({
        level: "warn",
        message: "AI33 auto-delete of timed-out task errored (non-fatal)",
        task_id: taskId,
        error: delMsg,
      }),
    );
  }
  throw new Error(
    `AI33 task polling timeout after ${MAX_POLL_ATTEMPTS} attempts`,
  );
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
