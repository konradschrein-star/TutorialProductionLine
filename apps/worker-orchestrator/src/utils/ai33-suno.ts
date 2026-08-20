/**
 * Suno music generation client via AI33 API.
 *
 * Uses the native AI33 Suno endpoint (/v1s/task/music-generation).
 * If AI33 disables it again, set SUNO_MUSIC_API_URL to fall back to
 * a self-hosted browser-automation service that exposes the same shape.
 *
 * Endpoint: POST /v1s/task/music-generation
 * Poll:     GET  /v1/task/{task_id}  (common task endpoint)
 * Done:     status === "done" → metadata.audio_url
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

function getBaseUrl() {
  return process.env["SUNO_MUSIC_API_URL"] ?? "https://api.ai33.pro";
}
const FFPROBE_BIN = process.env["FFPROBE_PATH"] ?? "ffprobe";
const POLL_INTERVAL_MS = 8000;
const MAX_POLL_ATTEMPTS = 60; // 8 minutes max

interface SunoCreateResponse {
  success?: boolean;
  task_id?: string;
  ec_remain_credits?: string;
}

interface SunoTaskResult {
  id?: string;
  status?: string;
  progress?: number;
  error_message?: string | null;
  metadata?: {
    audio_url?: string;
    all_audio_urls?: string[];
    stream_url?: string;
    suno_result?: {
      clips?: Array<{ audio_url?: string }>;
    };
    suno_stream_result?: {
      clips?: Array<{ stream_url?: string }>;
    };
  };
}

async function pollSunoTask(apiKey: string, taskId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${getBaseUrl()}/v1/task/${taskId}`, {
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    });

    if (!res.ok) continue;

    const data = (await res.json()) as SunoTaskResult;

    if (data.error_message) {
      throw new Error(`Suno task ${taskId} failed: ${data.error_message}`);
    }

    if (data.status === "done") {
      const audioUrl =
        data.metadata?.audio_url ??
        data.metadata?.suno_result?.clips?.[0]?.audio_url;
      if (audioUrl) return audioUrl;
      throw new Error(
        `Suno task ${taskId} done but no audio_url in metadata: ${JSON.stringify(data.metadata).slice(0, 300)}`,
      );
    }
  }

  throw new Error(
    `Suno task ${taskId} did not complete within ${(POLL_INTERVAL_MS * MAX_POLL_ATTEMPTS) / 60000} minutes`,
  );
}

export interface SunoMusicOptions {
  /** Prompt for Suno (simple mode). */
  prompt?: string;
}

export async function generateSunoMusic(
  apiKey: string,
  outputPath: string,
  opts: SunoMusicOptions = {},
): Promise<number> {
  const prompt = opts.prompt ?? "Ambient instrumental background music";

  const res = await fetch(`${getBaseUrl()}/v1s/task/music-generation`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      create_mode: "simple",
      gpt_description_prompt: prompt,
      make_instrumental: true,
      major_model_version: "v4.5-all",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `AI33 Suno submit failed (${res.status}): ${body.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as SunoCreateResponse;

  if (!data.task_id) {
    throw new Error(
      `AI33 Suno response missing task_id: ${JSON.stringify(data).slice(0, 300)}`,
    );
  }

  const audioUrl = await pollSunoTask(apiKey, data.task_id);

  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) {
    throw new Error(
      `Failed to download Suno audio from ${audioUrl}: ${audioRes.status}`,
    );
  }

  const buf = Buffer.from(await audioRes.arrayBuffer());
  await writeFile(outputPath, buf);

  const { stdout } = await execFileAsync(FFPROBE_BIN, [
    "-v",
    "quiet",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    outputPath,
  ]);

  const duration = parseFloat(stdout.trim());
  if (isNaN(duration) || duration <= 0) {
    throw new Error(
      `ffprobe returned invalid duration for Suno audio: "${stdout.trim()}"`,
    );
  }

  return Math.round(duration);
}
