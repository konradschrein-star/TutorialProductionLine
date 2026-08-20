/**
 * Push CF job state changes to the AI-OS (forge-control) so it can react to
 * CF pipeline transitions.
 *
 * HISTORY / B3-B4: this module used to POST to Hermes (`hermes-control-plane`
 * :8650, `recipientKind: "hermes"`). Hermes is being ABOLISHED. It no longer
 * targets Hermes. It now targets forge-control (:7700) and is a NO-OP unless
 * explicitly enabled — the real AI-OS bridge (plan P1-8b) is HTTP-only and
 * design-only this session, so nothing depends on an unbuilt endpoint here.
 *
 * Fire-and-forget. A flaky / down target must never wedge a CF job —
 * everything is wrapped in catch-and-log, and the HTTP call has a short
 * timeout.
 *
 * Wired into apps/worker-orchestrator/src/utils/update-job-status.ts
 * which is the single chokepoint for every CF state transition, so
 * one hook gives us full coverage.
 */

// Read env LAZILY (inside functions, not at module load). In ESM,
// import statements are hoisted — worker-orchestrator's dotenv.config()
// runs AFTER all imports finish, so any module-top `process.env[...]`
// reads see empty values and `notifyAios` silently disables itself.
const TIMEOUT_MS = 2000;

/**
 * OFF by default. Set AIOS_NOTIFY_ENABLED=1 (and a token) to turn it on once
 * the forge-control ingest endpoint exists. Until then this is a no-op — it is
 * NOT wired to Hermes.
 */
function notifyEnabled(): boolean {
  const v = process.env["AIOS_NOTIFY_ENABLED"] ?? "";
  return v === "1" || v.toLowerCase() === "true";
}
function aiosControlUrl(): string {
  // forge-control (the AI-OS worker infra on the box), NOT Hermes :8650.
  return process.env["AIOS_CONTROL_URL"] ?? "http://127.0.0.1:7700";
}
function aiosIngestPath(): string {
  return process.env["AIOS_INGEST_PATH"] ?? "/cf/ingest/event";
}
function cfAiosToken(): string {
  return process.env["CF_AIOS_TOKEN"] ?? "";
}

/** Notification intent vocabulary. */
type HcpIntent = "RESULT" | "APPROVAL_REQUEST" | "ESCALATE";

export interface AiosNotifyInput {
  jobId: string;
  fromStatus: string;
  toStatus: string;
  format: string;
  title: string | null;
  errorMessage: string | null;
}

function intentForStatus(status: string): HcpIntent {
  if (
    status === "AWAITING_QC" ||
    status === "AWAITING_IMAGE_QC" ||
    status === "AWAITING_UPLOADER" ||
    status === "AWAITING_PRODUCTION_VA"
  ) {
    return "APPROVAL_REQUEST";
  }
  if (status === "FAILED_IRRECOVERABLE") {
    return "ESCALATE";
  }
  return "RESULT";
}

export function notifyAios(input: AiosNotifyInput): void {
  // No-op unless explicitly enabled AND a token is configured. Default OFF so
  // CF never depends on the (abolished) Hermes or an unbuilt AI-OS endpoint.
  if (!notifyEnabled() || !cfAiosToken()) return;

  // Detach: do not await, never throw.
  void postEvent(input).catch((err) => {
    console.error(
      JSON.stringify({
        level: "warn",
        message: "aios-notify failed (non-fatal)",
        job_id: input.jobId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  });
}

async function postEvent(input: AiosNotifyInput): Promise<void> {
  const intent = intentForStatus(input.toStatus);
  const body = {
    senderKind: "system",
    senderId: "cf-worker",
    recipientKind: "ai_os",
    recipientId: "forge-control",
    intent,
    body: {
      kind: "cf.job.state_changed",
      cfJobId: input.jobId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      format: input.format,
      title: input.title,
      errorMessage: input.errorMessage,
      ts: new Date().toISOString(),
    },
  };

  await fetch(`${aiosControlUrl()}${aiosIngestPath()}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfAiosToken()}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}
