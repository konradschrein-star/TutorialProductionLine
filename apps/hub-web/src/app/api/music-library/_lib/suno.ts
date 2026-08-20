/**
 * Suno music generation via AI33 — the on-demand path for the music library.
 *
 * Verified live against AI33 on 2026-07-28:
 *   POST https://api.ai33.pro/v1s/task/music-generation
 *     -> { success: true, task_id, ec_remain_credits }   (3600 credits/task)
 *   GET  https://api.ai33.pro/v1/task/{task_id}
 *     -> { status: "done", credit_cost, metadata: { suno_result: { clips: [...] } } }
 *
 * Two things the previous implementation got wrong, fixed here:
 *
 *  1. Suno returns TWO clips per task. Taking only `clips[0]` threw away half
 *     of a 3600-credit generation. Both are ingested.
 *  2. Failures were invisible. AI33 has a documented history of queue
 *     saturation (a past incident had 12/10 tasks queued and every endpoint
 *     429ing). Every failure mode here is classified and persisted.
 *
 * Hard rule: there is NO fallback to another music provider, and no fabricated
 * track on failure. A failed generation stays failed and says why.
 */

export type SunoErrorCode =
  | "rate_limited"
  | "server_busy"
  | "no_credits"
  | "auth"
  | "timeout"
  | "no_audio"
  | "download_failed"
  | "probe_failed"
  | "unknown";

export class SunoGenerationError extends Error {
  readonly code: SunoErrorCode;
  /** Whether retrying later is plausibly useful. */
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    code: SunoErrorCode,
    message: string,
    opts: { retryable?: boolean; status?: number } = {},
  ) {
    super(message);
    this.name = "SunoGenerationError";
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.status = opts.status;
  }
}

/**
 * Map an HTTP status + body from AI33 onto a failure class.
 *
 * Exported for testing — this classification is what the operator actually
 * sees in the UI, so it must be right.
 */
export function classifyAi33Failure(
  status: number,
  body: string,
): SunoGenerationError {
  const lower = body.toLowerCase();
  const snippet = body.slice(0, 300);

  if (status === 429) {
    return new SunoGenerationError(
      "rate_limited",
      `AI33 rate limited the request (429). Its task queue is full — wait and retry. ${snippet}`,
      { retryable: true, status },
    );
  }
  if (status === 503 || lower.includes("server_busy")) {
    return new SunoGenerationError(
      "server_busy",
      `AI33 is busy (${status}). ${snippet}`,
      { retryable: true, status },
    );
  }
  if (status === 401 || status === 403) {
    // AI33 documents 401 as "Invalid API key OR insufficient credits" — the
    // two need different operator action, so distinguish on the body.
    if (lower.includes("credit")) {
      return new SunoGenerationError(
        "no_credits",
        `AI33 reports insufficient credits. ${snippet}`,
        { retryable: false, status },
      );
    }
    return new SunoGenerationError(
      "auth",
      `AI33 rejected the API key (${status}). ${snippet}`,
      { retryable: false, status },
    );
  }
  if (lower.includes("credit")) {
    return new SunoGenerationError(
      "no_credits",
      `AI33 reports a credit problem (${status}). ${snippet}`,
      { retryable: false, status },
    );
  }
  return new SunoGenerationError(
    "unknown",
    `AI33 request failed (${status}): ${snippet}`,
    { retryable: status >= 500, status },
  );
}

export const AI33_BASE_URL = "https://api.ai33.pro";
const SUNO_PATH = "/v1s/task/music-generation";
const POLL_INTERVAL_MS = 8000;
const MAX_POLL_ATTEMPTS = 75; // 10 minutes

export interface SunoClip {
  id?: string;
  title?: string;
  tags?: string;
  duration?: number;
  audio_url?: string;
  status?: string;
}

export interface SunoTaskResult {
  status: string;
  creditCost: number | null;
  clips: SunoClip[];
}

/** Clips that actually have downloadable audio, in stable order. */
export function usableClips(clips: SunoClip[]): SunoClip[] {
  return clips.filter(
    (c) => typeof c.audio_url === "string" && c.audio_url.length > 0,
  );
}

/**
 * Turn Suno's free-text `tags` string into discrete tags for the library.
 * Suno emits a long prose description plus a short `display_tags` list; we
 * keep only short, comma-separated fragments that look like real tags.
 */
export function parseSunoTags(tags: string | undefined): string[] {
  if (!tags) return [];
  return Array.from(
    new Set(
      tags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0 && t.length <= 24 && !t.includes(" ")),
    ),
  ).slice(0, 12);
}

interface SubmitResponse {
  success?: boolean;
  task_id?: string;
  ec_remain_credits?: string;
  message?: string;
}

export interface SunoSubmitOptions {
  prompt: string;
  instrumental?: boolean;
  modelVersion?: string;
  fetchImpl?: typeof fetch;
}

/** Submit a generation. Returns the AI33 task id. */
export async function submitSunoTask(
  apiKey: string,
  opts: SunoSubmitOptions,
): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${AI33_BASE_URL}${SUNO_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    body: JSON.stringify({
      create_mode: "simple",
      gpt_description_prompt: opts.prompt,
      make_instrumental: opts.instrumental ?? true,
      major_model_version: opts.modelVersion ?? "v4.5-all",
    }),
  });

  if (!res.ok) {
    throw classifyAi33Failure(res.status, await res.text());
  }

  const data = (await res.json()) as SubmitResponse;
  if (!data.success || !data.task_id) {
    throw new SunoGenerationError(
      "unknown",
      `AI33 accepted the request but returned no task_id: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return data.task_id;
}

interface TaskResponse {
  id?: string;
  status?: string;
  credit_cost?: number;
  error_message?: string | null;
  metadata?: {
    suno_result?: { clips?: SunoClip[] };
    audio_url?: string;
    [k: string]: unknown;
  } | null;
}

/**
 * Poll a task to completion.
 *
 * A transient 429/503 while polling is NOT fatal — the task is already
 * submitted and paid for, so we keep waiting. Only a terminal `error` status,
 * an auth failure, or the overall timeout ends the wait.
 */
export async function pollSunoTask(
  apiKey: string,
  taskId: string,
  opts: {
    intervalMs?: number;
    maxAttempts?: number;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<SunoTaskResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  const maxAttempts = opts.maxAttempts ?? MAX_POLL_ATTEMPTS;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(intervalMs);

    const res = await doFetch(`${AI33_BASE_URL}/v1/task/${taskId}`, {
      headers: { "xi-api-key": apiKey },
    });

    if (!res.ok) {
      // Auth breaking mid-poll is terminal; anything else is transient.
      if (res.status === 401 || res.status === 403) {
        throw classifyAi33Failure(res.status, await res.text());
      }
      continue;
    }

    const task = (await res.json()) as TaskResponse;

    if (task.status === "error") {
      throw new SunoGenerationError(
        "unknown",
        `AI33 Suno task ${taskId} failed: ${task.error_message ?? "no reason given"}`,
      );
    }

    if (task.status === "done") {
      const clips = usableClips(task.metadata?.suno_result?.clips ?? []);
      if (clips.length === 0) {
        throw new SunoGenerationError(
          "no_audio",
          `AI33 Suno task ${taskId} completed but returned no downloadable audio`,
        );
      }
      return {
        status: "done",
        creditCost: task.credit_cost ?? null,
        clips,
      };
    }
  }

  throw new SunoGenerationError(
    "timeout",
    `AI33 Suno task ${taskId} did not finish within ${Math.round((intervalMs * maxAttempts) / 60000)} minutes. It may still complete on AI33's side — check /v1/task/${taskId}.`,
    { retryable: true },
  );
}

export async function downloadClip(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new SunoGenerationError(
      "download_failed",
      `Failed to download generated audio from ${url}: HTTP ${res.status}`,
      { retryable: true, status: res.status },
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Concurrency cap
// ---------------------------------------------------------------------------

/**
 * Cap on simultaneous in-flight Suno generations from hub-web.
 *
 * Suno tasks occupy an AI33 queue slot for minutes each. The AI33 account is
 * shared with TTS (which runs its own limiter in worker-orchestrator at up to
 * 15 concurrent), so operator-triggered music generation stays deliberately
 * small to avoid being the thing that saturates the queue.
 */
export const MAX_CONCURRENT_SUNO_GENERATIONS = 2;

let inFlight = 0;

export function currentSunoInFlight(): number {
  return inFlight;
}

/** Reserve a slot, or return false when the cap is already reached. */
export function trySunoSlot(): boolean {
  if (inFlight >= MAX_CONCURRENT_SUNO_GENERATIONS) return false;
  inFlight++;
  return true;
}

export function releaseSunoSlot(): void {
  if (inFlight > 0) inFlight--;
}
