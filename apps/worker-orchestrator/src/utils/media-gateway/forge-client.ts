import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { MediaAspect } from "./types.js";

/**
 * Raw HTTP client for forge-api — the self-hosted VEO Studio wrapper at
 * forge-api.schreinercontentsystems.com. Jobs-based async: submit returns a
 * job record, poll /v1/jobs/:id until done|failed, download result files
 * from /v1/media/:id.
 *
 * LOW-LEVEL transport. Callers go through media-gateway/index.ts which adds
 * priority queuing, backend routing, and failover.
 */

function forgeBaseUrl(): string {
  return (
    process.env["FORGE_API_URL"] ??
    "https://forge-api.schreinercontentsystems.com"
  );
}

function forgeHeaders(): Record<string, string> {
  const key = process.env["FORGE_API_KEY"] ?? "";
  if (!key) {
    throw new Error(
      "FORGE_API_KEY is not set — required for forge-api (VEO Studio) generation",
    );
  }
  return { "x-api-key": key };
}

export function forgeConfigured(): boolean {
  return Boolean(process.env["FORGE_API_KEY"]);
}

const FORGE_BROWSERS = Math.min(
  4,
  Math.max(1, Number(process.env["FORGE_BROWSERS"] ?? "4")),
);
const HEALTH_TTL_MS = Number(process.env["FORGE_HEALTH_TTL_MS"] ?? "60000");

let healthState = { healthy: false, checkedAt: 0, refreshing: false };

async function refreshHealth(): Promise<void> {
  try {
    const res = await fetch(`${forgeBaseUrl()}/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    // forge-api returns 503 with {status:"down", disabled:true, ...} when
    // the VEO Studio worker has no heartbeat; only a 200 means jobs will
    // actually be picked up.
    healthState = { healthy: res.ok, checkedAt: Date.now(), refreshing: false };
  } catch {
    healthState = { healthy: false, checkedAt: Date.now(), refreshing: false };
  }
}

/**
 * Cached health check — sync read so the gateway's drain loop stays
 * synchronous. A stale value kicks off a background refresh; until the
 * first probe completes the answer is "unhealthy", which just means the
 * first requests take the fastgen route (or the error-fallback path).
 */
export function forgeHealthyCached(): boolean {
  if (
    Date.now() - healthState.checkedAt > HEALTH_TTL_MS &&
    !healthState.refreshing
  ) {
    healthState.refreshing = true;
    void refreshHealth();
  }
  return healthState.healthy;
}

/** Aspect strings forge-api expects. 1:1 is not supported by VEO Studio. */
export function mapForgeAspect(
  aspect: MediaAspect | undefined,
): string | undefined {
  if (aspect === undefined || aspect === "16:9") return "16:9 (Landscape)";
  if (aspect === "9:16") return "9:16 (Portrait)";
  throw new Error(`forge-api does not support aspect ratio ${aspect}`);
}

export interface ForgeJob {
  id: string;
  kind: string;
  status: "queued" | "claimed" | "running" | "done" | "failed";
  result?: { files?: Array<{ id: string; filename: string; size: number }> };
  error?: string;
  progress?: string;
}

async function submitJob(
  path: string,
  body: Record<string, unknown>,
): Promise<ForgeJob> {
  const res = await fetch(`${forgeBaseUrl()}${path}`, {
    method: "POST",
    headers: { ...forgeHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, browsers: FORGE_BROWSERS }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `forge-api submit ${path} failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  const job = (await res.json()) as ForgeJob;
  if (!job.id) {
    throw new Error(`forge-api submit ${path}: response missing job id`);
  }
  return job;
}

export async function submitForgeImage(
  prompt: string,
  opts: { aspectRatio?: MediaAspect },
): Promise<string> {
  const job = await submitJob("/v1/generate/image", {
    prompt,
    aspectRatio: mapForgeAspect(opts.aspectRatio),
  });
  return job.id;
}

export async function submitForgeVideo(
  prompt: string,
  opts: { aspectRatio?: MediaAspect; resolution?: string },
): Promise<string> {
  const job = await submitJob("/v1/generate/video", {
    prompt,
    aspectRatio: mapForgeAspect(opts.aspectRatio),
    ...(opts.resolution ? { resolution: opts.resolution } : {}),
  });
  return job.id;
}

export async function submitForgeImageToVideo(
  prompt: string,
  inputIds: string[],
  opts: { aspectRatio?: MediaAspect; resolution?: string },
): Promise<string> {
  const job = await submitJob("/v1/generate/image-to-video", {
    prompt,
    inputIds,
    aspectRatio: mapForgeAspect(opts.aspectRatio),
    ...(opts.resolution ? { resolution: opts.resolution } : {}),
  });
  return job.id;
}

/** Upload an input image (for image-to-video); returns the input id. */
export async function uploadForgeInput(
  data: Buffer,
  filename: string,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(data)]), filename);
  const res = await fetch(`${forgeBaseUrl()}/v1/uploads`, {
    method: "POST",
    headers: forgeHeaders(),
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `forge-api upload failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("forge-api upload: response missing id");
  return json.id;
}

const POLL_INTERVAL_MS = Number(
  process.env["FORGE_POLL_INTERVAL_MS"] ?? "5000",
);

/**
 * Poll a job until done; returns the result file ids. Throws on failed
 * jobs and on timeout — the job record stays on forge-api for operator
 * inspection either way.
 */
export async function waitForForgeJob(
  jobId: string,
  opts: { timeoutMs: number },
): Promise<string[]> {
  const start = Date.now();
  while (Date.now() - start < opts.timeoutMs) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`${forgeBaseUrl()}/v1/jobs/${jobId}`, {
      headers: forgeHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      if (res.status >= 500) continue; // transient — keep polling
      throw new Error(`forge-api poll failed (${res.status}) for job ${jobId}`);
    }
    const job = (await res.json()) as ForgeJob;
    if (job.status === "done") {
      const ids = job.result?.files?.map((f) => f.id) ?? [];
      if (ids.length === 0) {
        throw new Error(`forge-api job ${jobId} done but result has no files`);
      }
      return ids;
    }
    if (job.status === "failed") {
      throw new Error(
        `forge-api job ${jobId} failed: ${job.error ?? "unknown error"}`,
      );
    }
  }
  throw new Error(
    `forge-api job ${jobId} did not complete within ${Math.round(opts.timeoutMs / 1000)}s`,
  );
}

export async function downloadForgeMedia(
  mediaId: string,
  destPath: string,
): Promise<void> {
  const res = await fetch(`${forgeBaseUrl()}/v1/media/${mediaId}`, {
    headers: forgeHeaders(),
  });
  if (!res.ok) {
    throw new Error(
      `forge-api media download failed (${res.status}): ${mediaId}`,
    );
  }
  if (!res.body) throw new Error("forge-api media response has no body");
  const dest = createWriteStream(destPath);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, dest);
}

export async function downloadForgeMediaBuffer(
  mediaId: string,
): Promise<Buffer> {
  const res = await fetch(`${forgeBaseUrl()}/v1/media/${mediaId}`, {
    headers: forgeHeaders(),
  });
  if (!res.ok) {
    throw new Error(
      `forge-api media download failed (${res.status}): ${mediaId}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}
