/**
 * Fire a webhook (POST JSON) when a job hits a terminal state — i.e. one
 * the human cares about: needs review, ready to upload, or definitively
 * failed.
 *
 * Configure via env: TERMINAL_STATE_WEBHOOK_URL. If unset, this no-ops.
 * Optional TERMINAL_STATE_WEBHOOK_AUTH_HEADER lets the receiver verify
 * the source.
 *
 * The webhook is fire-and-forget: it doesn't block the status update,
 * doesn't retry (cheap to fire again next state), and silently swallows
 * delivery failures so a flaky webhook receiver can't wedge the pipeline.
 */

const TERMINAL_STATES = new Set([
  "AWAITING_QC",
  "AWAITING_UPLOADER",
  "PUBLISHED",
  "FAILED_GENERAL",
  "FAILED_RENDER",
  "FAILED_UPLOAD",
  "FAILED_SPACE_PIPELINE",
  "FAILED_DRAMA_PIPELINE",
]);

export function isTerminalState(status: string): boolean {
  return TERMINAL_STATES.has(status);
}

export interface TerminalStatePayload {
  job_id: string;
  from_status: string;
  to_status: string;
  format?: string | null;
  title?: string | null;
  error_message?: string;
  timestamp: string;
}

export async function fireTerminalStateWebhook(
  payload: TerminalStatePayload,
): Promise<void> {
  const url = process.env["TERMINAL_STATE_WEBHOOK_URL"];
  if (!url) return;

  const authHeader = process.env["TERMINAL_STATE_WEBHOOK_AUTH_HEADER"];
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authHeader) headers["Authorization"] = authHeader;

  try {
    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    // Webhook receiver is best-effort. Log and move on.
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "Terminal-state webhook delivery failed",
        url,
        error: String(err).slice(0, 200),
      }),
    );
  }
}
