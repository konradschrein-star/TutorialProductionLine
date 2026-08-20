/**
 * AI33 Image Generation Client
 *
 * Generates images via AI33 API (Nano Banana 2 / gemini-3.1-flash-image-preview).
 * Uses a task-based polling pattern — submit → poll → download.
 *
 * NOTE: Gemini/Nano Banana 2 returns PNGs with Display P3 ICC profiles that
 * Chromium (Remotion) cannot decode. We normalize to sRGB via ffmpeg before
 * returning the buffer.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const AI33_BASE_URL = "https://api.ai33.pro";
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 720; // 60 minutes max — reference-image tasks can take 30+ min at high load
/** Consecutive transient poll errors tolerated before a task is abandoned
 *  (5s apart, so this rides out ~1 minute of gateway trouble). */
const MAX_CONSECUTIVE_POLL_FAILURES = 12;
const MAX_SUBMIT_RETRIES = 3; // retry full submission on temporary_model_error
const RETRY_DELAY_MS = 8000;
const QUEUE_FULL_DELAY_MS = 90_000; // 90s between retries when AI33 queue is at capacity
const MAX_QUEUE_FULL_ATTEMPTS = 20; // up to 30 min total wait (20 × 90s)

// Primary model: Nano Banana 2 (gemini-3.1-flash-image-preview) at 2K
const PRIMARY_MODEL = {
  id: "gemini-3.1-flash-image-preview",
  resolution: "2K",
};

interface AI33TaskResponse {
  id: string;
  status: "doing" | "done" | "error";
  progress: number;
  credit_cost?: number;
  error_message?: string;
  metadata?: {
    result_images?: Array<{
      id: string;
      imageUrl: string;
      previewUrl: string;
      mimeType: string;
      width: number;
      height: number;
    }>;
  };
}

/**
 * Generate an image via AI33 (Nano Banana 2, or model override).
 *
 * @param apiKey          - AI33 API key (xi-api-key)
 * @param prompt          - Text prompt. May contain @img1, @img2 etc. if referenceImages provided.
 * @param aspectRatio     - e.g. "16:9", "9:16", "1:1"
 * @param modelOverride   - Override the primary model (nanob2, etc.). `resolution`
 *                          is OPTIONAL because several AI33 models declare no
 *                          resolutions at all (krea-2-*, gemini-2.5-flash-image,
 *                          flux-1-kontext, wan-2.5-preview-image, both gpt-image-1*),
 *                          and sending one they do not offer is a rejected task.
 *                          When it is omitted the parameter is left out entirely
 *                          rather than defaulted.
 * @param referenceImages - Up to 10 reference image buffers (max 5MB each).
 *                          Must correspond 1:1 with @img1, @img2... references in the prompt.
 *                          Use buildReferenceInjectedPrompt() from @repo/domain to assemble
 *                          both the prompt and this array in canonical injection order.
 * @returns PNG/JPEG buffer of the generated image
 */
export async function generateImageAI33(
  apiKey: string,
  prompt: string,
  aspectRatio = "16:9",
  modelOverride?: { id: string; resolution?: string },
  referenceImages?: Uint8Array[],
  seed?: number,
): Promise<Buffer> {
  const chain = modelOverride ? [modelOverride] : [PRIMARY_MODEL];

  for (const model of chain) {
    let lastError: Error | null = null;

    // Outer loop: retry on queue-full (429) with long backoff
    for (let qfAttempt = 0; qfAttempt < MAX_QUEUE_FULL_ATTEMPTS; qfAttempt++) {
      if (qfAttempt > 0) {
        console.log(
          JSON.stringify({
            level: "info",
            message: "AI33 queue full — waiting before retry",
            model_id: model.id,
            queue_full_attempt: qfAttempt,
            delay_ms: QUEUE_FULL_DELAY_MS,
          }),
        );
        await new Promise((r) => setTimeout(r, QUEUE_FULL_DELAY_MS));
      }

      let wasQueueFull = false;

      // Inner loop: retry on transient model errors
      for (let attempt = 1; attempt <= MAX_SUBMIT_RETRIES; attempt++) {
        if (attempt > 1) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }

        try {
          return await submitAndPoll(
            apiKey,
            prompt,
            aspectRatio,
            model.id,
            model.resolution,
            attempt,
            referenceImages,
            seed,
          );
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          wasQueueFull = lastError.message.includes("too many tasks in queue");
          if (wasQueueFull) break; // break inner, outer will wait and retry
          const isTransient =
            lastError.message.includes("temporary_model_error") ||
            lastError.message.includes("temporary") ||
            lastError.message.includes("timeout");
          if (!isTransient || attempt === MAX_SUBMIT_RETRIES) break;
        }
      }

      if (!wasQueueFull) break; // not a queue-full issue, don't do outer retry
    }

    console.log(
      `[ai33] Model ${model.id} failed: ${lastError?.message?.slice(0, 120) ?? "unknown error"}`,
    );
  }

  throw new Error(`AI33 image generation failed: all attempts exhausted`);
}

async function submitAndPoll(
  apiKey: string,
  prompt: string,
  aspectRatio: string,
  modelId: string,
  resolution: string | undefined,
  attempt: number,
  referenceImages?: Uint8Array[],
  seed?: number,
): Promise<Buffer> {
  const formData = new FormData();
  formData.append("prompt", prompt);
  formData.append("model_id", modelId);
  formData.append("generations_count", "1");
  const modelParams: Record<string, unknown> = {
    aspect_ratio: aspectRatio,
  };
  // Omitted, never defaulted: a model that declares no resolutions rejects the
  // task when one is sent, and a substituted value would be a size nobody chose.
  if (resolution !== undefined) modelParams["resolution"] = resolution;
  if (seed !== undefined) modelParams["seed"] = seed;
  formData.append("model_parameters", JSON.stringify(modelParams));

  // Attach reference images in the exact order they appear as @img1, @img2... in the prompt.
  // The caller (via buildReferenceInjectedPrompt) is responsible for ensuring the arrays match.
  if (referenceImages?.length) {
    for (const imgBuf of referenceImages) {
      formData.append("assets", new Blob([imgBuf as unknown as ArrayBuffer]));
    }
  }

  console.log(
    JSON.stringify({
      level: "info",
      message: "AI33 image generation request",
      model_id: modelId,
      resolution: resolution ?? null,
      reference_image_count: referenceImages?.length ?? 0,
      prompt_length: prompt.length,
      prompt_has_placeholders: /@img\d+/.test(prompt),
    }),
  );

  const submitRes = await fetch(`${AI33_BASE_URL}/v1i/task/generate-image`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: formData,
  });

  if (!submitRes.ok) {
    const body = await submitRes.text();
    throw new Error(`AI33 submit failed (${submitRes.status}): ${body}`);
  }

  const submit = (await submitRes.json()) as {
    success?: boolean;
    task_id?: string;
  };
  if (!submit.success || !submit.task_id) {
    throw new Error(`AI33 submit rejected: ${JSON.stringify(submit)}`);
  }

  if (attempt > 1) {
    // logged by caller — just note the retry internally
    console.log(`[ai33] Retry attempt ${attempt}, task_id=${submit.task_id}`);
  }

  const taskId = submit.task_id;

  // Poll for completion
  let consecutivePollFailures = 0;
  for (let poll = 0; poll < MAX_POLL_ATTEMPTS; poll++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await fetch(`${AI33_BASE_URL}/v1/task/${taskId}`, {
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    });

    if (!pollRes.ok) {
      // A failed POLL is not a failed TASK. The task was accepted and its
      // credits are already spent; the generator is very likely still working.
      // Treating a gateway blip as fatal threw away paid, in-flight work and
      // then failed the whole request over to the second API key — which is
      // exactly how a healthy account produced "no image" (observed
      // 2026-08-16: one 503 on /v1/task/{id} aborted a running gpt-image-2
      // task). Transient statuses are retried against the SAME task id; only a
      // definitive rejection, or a sustained outage, gives up.
      const transient =
        pollRes.status === 408 ||
        pollRes.status === 429 ||
        pollRes.status >= 500;
      consecutivePollFailures += 1;
      if (transient && consecutivePollFailures <= MAX_CONSECUTIVE_POLL_FAILURES) {
        console.log(
          JSON.stringify({
            level: "warn",
            message: "AI33 poll transient failure — task still running, retrying",
            task_id: taskId,
            status: pollRes.status,
            consecutive_failures: consecutivePollFailures,
            max_consecutive_failures: MAX_CONSECUTIVE_POLL_FAILURES,
          }),
        );
        continue;
      }
      throw new Error(
        `AI33 poll failed (${pollRes.status}) after ` +
          `${consecutivePollFailures} consecutive failure(s) on task ${taskId}`,
      );
    }
    consecutivePollFailures = 0;

    const task = (await pollRes.json()) as AI33TaskResponse;

    // Log progress every 10th poll attempt (every 50 seconds)
    if ((poll + 1) % 10 === 0) {
      console.log(
        JSON.stringify({
          level: "info",
          message: "AI33 image polling in progress",
          task_id: taskId,
          poll_attempt: poll + 1,
          max_attempts: MAX_POLL_ATTEMPTS,
          elapsed_seconds: (poll + 1) * (POLL_INTERVAL_MS / 1000),
          status: task.status,
          progress: task.progress,
        }),
      );
    }

    if (task.status === "done") {
      const imageUrl = task.metadata?.result_images?.[0]?.imageUrl;
      if (!imageUrl) throw new Error("AI33 task done but no result_images");

      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok)
        throw new Error(`AI33 image download failed (${imgRes.status})`);

      const raw = Buffer.from(await imgRes.arrayBuffer());
      return await normalizeTosRGB(raw);
    }

    if (task.status === "error") {
      throw new Error(`AI33 task error: ${task.error_message ?? "unknown"}`);
    }
  }

  throw new Error(`AI33 polling timeout after ${MAX_POLL_ATTEMPTS} attempts`);
}

/**
 * Normalize image to sRGB PNG via ffmpeg.
 * Strips wide-gamut ICC profiles (Display P3, etc.) that Chromium/Remotion
 * cannot decode in headless mode.
 */
async function normalizeTosRGB(input: Buffer): Promise<Buffer> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inPath = join(tmpdir(), `ai33-in-${id}.png`);
  const outPath = join(tmpdir(), `ai33-out-${id}.png`);

  try {
    await writeFile(inPath, input);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inPath,
      "-vf",
      "colorspace=iall=bt709:all=bt709",
      "-pix_fmt",
      "rgb24",
      outPath,
    ]);
    return await readFile(outPath);
  } catch {
    // ffmpeg not available or conversion failed — return raw buffer as-is
    return input;
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}
