/**
 * Video ERP binding — mirror tutorial-job status changes to the Keyword Tool.
 *
 * Fired from updateTutorialJob() whenever a tutorial job that carries a
 * keyword_ref changes status. Fire-and-forget: it never blocks or throws into
 * the DB write, and no-ops when KT_STATUS_WEBHOOK_URL is unset (standalone /
 * non-ERP deployments). The receiver (Keyword Tool) is idempotent on dedup_key,
 * so a re-delivered transition is a safe no-op there.
 */

export interface TutorialStatusWebhookInput {
  keyword_ref: string;
  forge_job_id: string;
  status: string;
  title?: string | null;
  updated_at: Date | string | null;
}

export function fireTutorialStatusWebhook(
  input: TutorialStatusWebhookInput,
): void {
  const url = process.env["KT_STATUS_WEBHOOK_URL"];
  if (!url) return;

  const updatedIso =
    input.updated_at instanceof Date
      ? input.updated_at.toISOString()
      : (input.updated_at ?? "");

  const body = {
    keyword_ref: input.keyword_ref,
    forge_job_id: input.forge_job_id,
    status: input.status,
    title: input.title ?? null,
    updated_at: updatedIso,
    // Same transition delivered twice → identical key → KT no-ops. A genuine
    // re-entry into a status (e.g. FAILED → retry → GENERATING_SCRIPT) carries a
    // fresh updated_at, so its key is distinct and KT applies it.
    dedup_key: `${input.forge_job_id}:${input.status}:${updatedIso}`,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const secret = process.env["KT_WEBHOOK_SECRET"];
  if (secret) headers["Authorization"] = `Bearer ${secret}`;

  void fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  }).catch((err) => {
    // Receiver is best-effort. Log and move on — never wedge the pipeline.
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "KT status webhook delivery failed",
        url,
        error: String(err).slice(0, 200),
      }),
    );
  });
}
