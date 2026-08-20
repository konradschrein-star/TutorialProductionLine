import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { MediaAspect } from "./types.js";

/**
 * ⚠ LEGACY PATH (verified dead 2026-08-02). This client speaks to a Python
 * wrapper that used to front VEO Unlimited Pro on :5210. That wrapper no
 * longer runs: nothing listens on 192.168.122.93:5210, and the only listener
 * on the VM is VUP's own app on 127.0.0.1:5100 (reached from the VPS through
 * `vf-vup-tunnel.service` → 127.0.0.1:15100). The live route to VUP is
 * veo-fleet-client.ts → the veo_fleet orchestrator (:8091) → the VM worker →
 * VUP :5100. `vupHealthyCached()` therefore stays false and the gateway skips
 * this hop; keep it only until the `vup:` MediaRef prefix is retired.
 *
 * The single-reference limit below is a limit of THIS client, not of VUP.
 * VUP's nano-banana mode accepts up to 10 references (`nbiImages` +
 * `nbiImageMode: "multi-ref"`, ≤1 MB each) — see the capability table in
 * index.ts. Do not cite this file as evidence that "VUP takes one reference".
 *
 * Raw HTTP client for VUP (VEO Unlimited Pro) — Konrad's actual VEO backend,
 * a Python wrapper running on the Windows VM. Submit returns a job id, poll
 * /v1/jobs/:id until done|partial|failed, download outputs from the relative
 * url each job returns.
 *
 * From the VPS the wrapper is only reachable at the VM's internal address
 * (192.168.122.93:5210) — the public host:port is DNAT'd PREROUTING-only, so
 * traffic originating on the VPS itself never traverses it. Set
 * VUP_API_URL=http://192.168.122.93:5210 in the VPS env.
 *
 * There is NO delete endpoint (501) — anything submitted here WILL render,
 * so callers must validate inputs before calling submit*, not after.
 *
 * LOW-LEVEL transport. Callers go through media-gateway/index.ts which adds
 * priority queuing, backend routing, and failover.
 */

function vupBaseUrl(): string {
  return process.env["VUP_API_URL"] ?? "http://65.108.6.149:5210";
}

function vupHeaders(): Record<string, string> {
  const key = process.env["VUP_API_KEY"] ?? "";
  if (!key) {
    throw new Error("VUP_API_KEY is not set — required for VUP generation");
  }
  return { "x-api-key": key };
}

export function vupConfigured(): boolean {
  return Boolean(process.env["VUP_API_KEY"]);
}

const HEALTH_TTL_MS = Number(process.env["VUP_HEALTH_TTL_MS"] ?? "60000");
// A single missed /health probe (VUP genuinely busy serving concurrent
// generation requests on the same VM, or a brief network blip) previously
// flipped the cache straight to unhealthy for a full HEALTH_TTL_MS window,
// silently rerouting that whole window's traffic to forge/fastgen — which
// may both be unavailable (forge-api's worker can be down for days; fastgen's
// plan has expired). Require two consecutive failed probes before treating
// VUP as actually down, but re-probe soon (not the full TTL) after a single
// failure so a genuine outage is still caught quickly.
const HEALTH_FAILURE_THRESHOLD = Number(
  process.env["VUP_HEALTH_FAILURE_THRESHOLD"] ?? "2",
);
const HEALTH_RETRY_TTL_MS = Number(
  process.env["VUP_HEALTH_RETRY_TTL_MS"] ?? "5000",
);

let healthState = {
  healthy: false,
  checkedAt: 0,
  refreshing: false,
  consecutiveFailures: 0,
};

async function refreshHealth(): Promise<void> {
  try {
    const res = await fetch(`${vupBaseUrl()}/health`, {
      // Widened from 10s: VUP is a Python wrapper that self-heals upstream
      // 429/403s by IP-rotating and retrying (see module docstring), which
      // can make it briefly slow to answer /health while under real load.
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new Error(`VUP health endpoint returned HTTP ${res.status}`);
    }
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
    } | null;
    if (body?.ok !== true) {
      throw new Error("VUP health endpoint did not report ok:true");
    }
    healthState = {
      healthy: true,
      checkedAt: Date.now(),
      refreshing: false,
      consecutiveFailures: 0,
    };
  } catch (err) {
    const consecutiveFailures = healthState.consecutiveFailures + 1;
    const stillHealthy =
      healthState.healthy && consecutiveFailures < HEALTH_FAILURE_THRESHOLD;
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "VUP health probe failed",
        error: err instanceof Error ? err.message : String(err),
        consecutive_failures: consecutiveFailures,
        still_treated_as_healthy: stillHealthy,
      }),
    );
    healthState = {
      healthy: stillHealthy,
      // Force the next vupHealthyCached() staleness check to trigger a
      // fresh probe after HEALTH_RETRY_TTL_MS rather than the full TTL,
      // whenever we're optimistically still treating VUP as healthy.
      checkedAt: stillHealthy
        ? Date.now() - HEALTH_TTL_MS + HEALTH_RETRY_TTL_MS
        : Date.now(),
      refreshing: false,
      consecutiveFailures,
    };
  }
}

/**
 * Cached health check — sync read so the gateway's drain loop stays
 * synchronous. A stale value kicks off a background refresh; until the
 * first probe completes the answer is "unhealthy", which just means the
 * first requests take the forge/fastgen route instead.
 */
export function vupHealthyCached(): boolean {
  if (
    Date.now() - healthState.checkedAt > HEALTH_TTL_MS &&
    !healthState.refreshing
  ) {
    healthState.refreshing = true;
    void refreshHealth();
  }
  return healthState.healthy;
}

// Eagerly prime the health cache at process boot (module load), instead of
// waiting for the first lazy vupHealthyCached() call to kick it off. Every
// worker-orchestrator restart (deploy, crash-recovery, another agent's
// unrelated deploy also bouncing this process) otherwise reopens a ~1-20s
// cold-start window where healthState starts at {healthy:false, checkedAt:0}
// and any image-gen request landing in that window is misrouted to
// forge/fastgen — both of which can be fully dead — even though VUP itself
// is up. Observed in production: a burst of requests seconds after a
// restart all routed to the expired fastgen backend and failed outright.
if (vupConfigured()) {
  healthState.refreshing = true;
  void refreshHealth();
}

const MAX_PROMPT_CHARS = 2000;
const MAX_REF_IMAGE_BYTES = 1_000_000;

function assertPromptLength(prompt: string): void {
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(
      `VUP: prompt exceeds ${MAX_PROMPT_CHARS} char limit (${prompt.length})`,
    );
  }
}

/** Only data: URIs can be size-checked client-side; http(s) URLs pass through. */
function assertRefImageSize(image: string): void {
  if (!image.startsWith("data:")) return;
  const commaIdx = image.indexOf(",");
  if (commaIdx < 0) return;
  const approxBytes = Math.floor((image.length - commaIdx - 1) * 0.75);
  if (approxBytes > MAX_REF_IMAGE_BYTES) {
    throw new Error(
      `VUP: reference image exceeds 1MB limit (~${Math.round(approxBytes / 1024)}KB)`,
    );
  }
}

interface VupSubmitResponse {
  job_id?: string;
  id?: string;
  error?: string;
}

async function submitJob(body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${vupBaseUrl()}/v1/generate`, {
    method: "POST",
    headers: { ...vupHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    // 429/503 here is wrapper-side backpressure (queue full / too many in
    // flight) — the caller's alternate-backend retry handles it.
    throw new Error(`VUP submit failed (${res.status}): ${text.slice(0, 300)}`);
  }
  let json: VupSubmitResponse;
  try {
    json = JSON.parse(text) as VupSubmitResponse;
  } catch {
    throw new Error(`VUP submit: non-JSON response: ${text.slice(0, 200)}`);
  }
  const jobId = json.job_id ?? json.id;
  if (!jobId) {
    throw new Error(
      `VUP submit: response missing job_id: ${text.slice(0, 200)}`,
    );
  }
  return jobId;
}

export async function submitVupImage(
  prompt: string,
  opts: {
    aspectRatio?: MediaAspect;
    /** Single reference image for nano-banana i2i — data: URI or http(s) URL, ≤1MB. */
    referenceImage?: string;
  },
): Promise<string> {
  assertPromptLength(prompt);
  const body: Record<string, unknown> = {
    prompt,
    mode: "nano-banana",
    resolution: "1K",
    aspectRatio: opts.aspectRatio ?? "16:9",
  };
  if (opts.referenceImage) {
    assertRefImageSize(opts.referenceImage);
    body["image"] = opts.referenceImage;
  }
  return submitJob(body);
}

export async function submitVupVideo(
  prompt: string,
  opts: { aspectRatio?: MediaAspect; resolution?: string },
): Promise<string> {
  assertPromptLength(prompt);
  return submitJob({
    prompt,
    resolution: opts.resolution ?? "720p", // pool entitlement is 720p; 1080p auto-downgrades
    aspectRatio: opts.aspectRatio ?? "16:9",
  });
}

export async function submitVupImageToVideo(
  prompt: string,
  image: string,
  opts: { aspectRatio?: MediaAspect; resolution?: string },
): Promise<string> {
  assertPromptLength(prompt);
  assertRefImageSize(image);
  return submitJob({
    prompt,
    mode: "image-to-video",
    image,
    resolution: opts.resolution ?? "720p",
    aspectRatio: opts.aspectRatio ?? "16:9",
  });
}

interface VupJob {
  job_id: string;
  status: "queued" | "running" | "done" | "partial" | "failed";
  outputs?: Array<{ name: string; url: string }>;
  error?: string | null;
}

const POLL_INTERVAL_MS = Number(process.env["VUP_POLL_INTERVAL_MS"] ?? "5000");

/**
 * Poll a job until done/partial/failed. Pool-level 429 quota and 403
 * unusual-activity errors are held and retried by the wrapper itself
 * (including automatic egress IP rotation) — a slow-moving queued/running
 * job is normal self-healing, not a bug, so we just keep polling.
 */
export async function waitForVupJob(
  jobId: string,
  opts: { timeoutMs: number },
): Promise<string[]> {
  const start = Date.now();
  while (Date.now() - start < opts.timeoutMs) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`${vupBaseUrl()}/v1/jobs/${jobId}`, {
      headers: vupHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      if (res.status >= 500) continue; // transient — keep polling
      throw new Error(`VUP poll failed (${res.status}) for job ${jobId}`);
    }
    const job = (await res.json()) as VupJob;
    if (job.status === "done" || job.status === "partial") {
      const urls = (job.outputs ?? []).map((o) => o.url);
      if (urls.length === 0) {
        throw new Error(
          `VUP job ${jobId} ${job.status} with no outputs: ${job.error ?? "unknown"}`,
        );
      }
      return urls;
    }
    if (job.status === "failed") {
      throw new Error(
        `VUP job ${jobId} failed: ${job.error ?? "unknown error"}`,
      );
    }
  }
  throw new Error(
    `VUP job ${jobId} did not complete within ${Math.round(opts.timeoutMs / 1000)}s`,
  );
}

/** relativeUrl is the job's outputs[].url, e.g. "/v1/files/{job_id}/{name}". */
export async function downloadVupFile(
  relativeUrl: string,
  destPath: string,
): Promise<void> {
  const res = await fetch(`${vupBaseUrl()}${relativeUrl}`, {
    headers: vupHeaders(),
  });
  if (!res.ok) {
    throw new Error(`VUP file download failed (${res.status}): ${relativeUrl}`);
  }
  if (!res.body) throw new Error("VUP file response has no body");
  const dest = createWriteStream(destPath);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, dest);
}

export async function downloadVupFileBuffer(
  relativeUrl: string,
): Promise<Buffer> {
  const res = await fetch(`${vupBaseUrl()}${relativeUrl}`, {
    headers: vupHeaders(),
  });
  if (!res.ok) {
    throw new Error(`VUP file download failed (${res.status}): ${relativeUrl}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
