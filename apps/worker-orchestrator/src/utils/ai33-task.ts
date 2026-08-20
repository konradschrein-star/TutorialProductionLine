/**
 * Shared AI33 task transport — submit → poll `GET /v1/task/{id}` → download.
 *
 * AI33's create endpoints (v1/v1m/v1e/v3) all return `{ success, task_id }`
 * and every task type is observable at `GET /v1/task/{task_id}` (root-level
 * object, verified working by elevenlabs-client.ts / ai33-suno.ts). This
 * module factors that common shape out so the per-capability clients
 * (dialogue, STT, dubbing, minimax-music, edge-tts) stay thin.
 *
 * AI33 is the LAST-RESORT backend; these are on-demand utilities, not
 * hot-path calls. Auth header: `xi-api-key` (v3 also accepts
 * `Authorization: <raw key>`, but `xi-api-key` works for all surfaces).
 *
 * See docs/providers/ai33-v3-api.md and docs/api/AI 33 Elevanlabs API.md.
 */

export const AI33_BASE_URL = "https://api.ai33.pro";
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_MAX_POLL_ATTEMPTS = 240; // 20 min cap

export interface Ai33TaskMetadata {
  audio_url?: string | null;
  srt_url?: string | null;
  json_url?: string | null;
  output_uri?: string | null;
  duration?: number | null;
  duration_seconds?: number | null;
  [key: string]: unknown;
}

export interface Ai33Task {
  id?: string;
  status?: "doing" | "done" | "error" | string;
  progress?: number | null;
  credit_cost?: number;
  error_message?: string | null;
  error_code?: string;
  error?: { code?: string; message?: string; retryable?: boolean };
  // voice-isolate style responses put the result at the root.
  output_uri?: string | null;
  metadata?: Ai33TaskMetadata | null;
  type?: string;
}

interface Ai33SubmitResponse {
  success?: boolean;
  task_id?: string;
  ec_remain_credits?: number | string;
  message?: string;
  error?: { code?: string; message?: string };
}

/** Submit a JSON-body AI33 create request and return its task_id. */
export async function submitAi33Json(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
): Promise<string> {
  return submit(apiKey, path, JSON.stringify(body), {
    "Content-Type": "application/json",
  });
}

/**
 * Submit a multipart/FormData AI33 create request and return its task_id.
 * Do NOT set Content-Type — fetch adds the multipart boundary for FormData.
 */
export async function submitAi33Form(
  apiKey: string,
  path: string,
  form: FormData,
): Promise<string> {
  return submit(apiKey, path, form, {});
}

async function submit(
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
    throw new Error(
      `AI33 ${path} submit failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as Ai33SubmitResponse;
  if (!data.success || !data.task_id) {
    throw new Error(
      `AI33 ${path} returned no task_id: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return data.task_id;
}

export interface PollOptions {
  intervalMs?: number;
  maxAttempts?: number;
  /** Label used in error/timeout messages. */
  label?: string;
}

/**
 * Poll `GET /v1/task/{taskId}` until the task is `done` (returns the task)
 * or `error`/timeout (throws). Returns the raw task so callers can pull the
 * result field they need (audio_url, srt_url, json_url, output_uri, …).
 */
export async function pollAi33Task(
  apiKey: string,
  taskId: string,
  opts: PollOptions = {},
): Promise<Ai33Task> {
  const intervalMs = opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  const label = opts.label ?? "task";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, intervalMs));

    const res = await fetch(`${AI33_BASE_URL}/v1/task/${taskId}`, {
      headers: { "xi-api-key": apiKey },
    });
    if (!res.ok) continue;

    const task = (await res.json()) as Ai33Task;
    if (!task?.status) continue;

    if (task.status === "done") return task;

    if (task.status === "error") {
      const err =
        task.error_message ??
        task.error_code ??
        task.error?.code ??
        "unknown error";
      throw new Error(`AI33 ${label} task ${taskId} failed: ${err}`);
    }
  }

  throw new Error(
    `AI33 ${label} task ${taskId} did not complete within ${(intervalMs * maxAttempts) / 1000}s`,
  );
}

/** Pull the finished-audio URL out of a done task across differing shapes. */
export function resolveAudioUrl(task: Ai33Task): string | undefined {
  return (
    task.metadata?.audio_url ??
    task.metadata?.output_uri ??
    task.output_uri ??
    undefined
  );
}

/** Download a result URL to a Buffer. */
export async function downloadAi33Result(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download AI33 result from ${url}: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Coerce a Buffer/Uint8Array/Blob into a Blob for FormData upload. */
export function toBlob(input: Buffer | Uint8Array | Blob): Blob {
  if (input instanceof Blob) return input;
  return new Blob([new Uint8Array(input)]);
}
