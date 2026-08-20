/**
 * Hub-web AI33 task helpers — submit → poll `GET /v1/task/{id}` → download.
 *
 * Mirrors the worker's ai33-task.ts transport, but scoped to hub-web so the
 * on-demand API routes (music generation, sound effects) can reach AI33
 * without importing across the worker app boundary.
 *
 * AI33 is the LAST-RESORT backend; these routes are operator-triggered,
 * on-demand utilities. Auth header: `xi-api-key`.
 */

export const AI33_BASE_URL = "https://api.ai33.pro";
const DEFAULT_POLL_INTERVAL_MS = 6000;
const DEFAULT_MAX_POLL_ATTEMPTS = 90; // 9 min

export interface Ai33TaskMetadata {
  audio_url?: string | null;
  srt_url?: string | null;
  json_url?: string | null;
  output_uri?: string | null;
  suno_result?: { clips?: Array<{ audio_url?: string }> };
  music_result?: { data?: Array<{ audio_url?: string; duration?: number }> };
  [key: string]: unknown;
}

export interface Ai33Task {
  id?: string;
  status?: string;
  progress?: number | null;
  credit_cost?: number;
  error_message?: string | null;
  output_uri?: string | null;
  metadata?: Ai33TaskMetadata | null;
  type?: string;
}

interface Ai33SubmitResponse {
  success?: boolean;
  task_id?: string;
  message?: string;
}

export async function submitAi33Json(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(`${AI33_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    body: JSON.stringify(body),
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

export async function pollAi33Task(
  apiKey: string,
  taskId: string,
  opts: { intervalMs?: number; maxAttempts?: number; label?: string } = {},
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
      throw new Error(
        `AI33 ${label} task ${taskId} failed: ${task.error_message ?? "unknown"}`,
      );
    }
  }
  throw new Error(
    `AI33 ${label} task ${taskId} did not complete within ${(intervalMs * maxAttempts) / 1000}s`,
  );
}

export function resolveAudioUrl(task: Ai33Task): string | undefined {
  return (
    task.metadata?.audio_url ??
    task.metadata?.output_uri ??
    task.output_uri ??
    task.metadata?.suno_result?.clips?.[0]?.audio_url ??
    task.metadata?.music_result?.data?.[0]?.audio_url ??
    undefined
  );
}

export async function downloadAi33Buffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download AI33 result from ${url}: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
