import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { MediaAspect } from "./types.js";

/**
 * Raw HTTP client for the VEO Fleet Orchestrator — the operator's VEO wrapper
 * ("VUP") as it exists TODAY, exposed properly.
 *
 * Architecture change that matters: this is no longer a direct HTTP call into
 * the Windows VM's VUP process on :5210. The orchestrator is a durable job
 * queue on the VPS (`/opt/veo-fleet`, FastAPI on 0.0.0.0:8091). Workers on the
 * VMs PULL work from it (`POST /bridge/claim`) and push results back
 * (`POST /bridge/result`); the orchestrator stores the bytes itself and serves
 * them from `GET /files/{file_id}`. VUP still does the generating, but it now
 * sits behind the bridge, which is why `VUP_API_URL=…:5210` has been dead from
 * the VPS while generation capacity was in fact fine.
 *
 * Consequence for health: `/healthz` answers 200 whenever the FastAPI process
 * is up, INCLUDING when zero workers are connected — in that state every
 * submitted job sits `pending` forever. Readiness is therefore read from
 * `GET /status`, not `/healthz`. See veoFleetReadiness().
 *
 * `workers.online > 0` was the first version of that gate and it was still a
 * liveness check, one generation behind the failure mode. On 2026-08-05 the
 * fleet reported one online, heartbeating, `busy` worker — holding a single
 * job it would never finish — while `done_5m` sat at 0 and the oldest pending
 * job had waited three and a half hours. The gate read green, the gateway kept
 * feeding it, and 74 thumbnails died one 480s timeout at a time. Liveness was
 * never the thing that broke, so the gate now asks whether the fleet is
 * PRODUCING, not whether it is present.
 *
 * Auth is `x-api-key` (NOT the Bearer token VeoForge uses — different service,
 * different scheme, do not conflate them).
 *
 * LOW-LEVEL transport. Callers go through media-gateway/index.ts which adds
 * priority queuing, backend routing, and failover.
 */

function veoFleetBaseUrl(): string {
  return process.env["VEO_FLEET_API_URL"] ?? "http://127.0.0.1:8091";
}

function veoFleetHeaders(): Record<string, string> {
  const key = process.env["VEO_FLEET_API_KEY"] ?? "";
  if (!key) {
    throw new Error(
      "VEO_FLEET_API_KEY is not set — required for VEO Fleet Orchestrator generation",
    );
  }
  return { "x-api-key": key };
}

export function veoFleetConfigured(): boolean {
  return Boolean(process.env["VEO_FLEET_API_KEY"]);
}

// ── Health ──────────────────────────────────────────────────────────────────

const HEALTH_TTL_MS = Number(process.env["VEO_FLEET_HEALTH_TTL_MS"] ?? "60000");
/**
 * Same two-strike rule as the old VUP client: one missed probe (orchestrator
 * busy, brief blip) must not blackhole a full TTL window of traffic onto
 * backends that may all be down.
 */
const HEALTH_FAILURE_THRESHOLD = Number(
  process.env["VEO_FLEET_HEALTH_FAILURE_THRESHOLD"] ?? "2",
);
const HEALTH_RETRY_TTL_MS = Number(
  process.env["VEO_FLEET_HEALTH_RETRY_TTL_MS"] ?? "5000",
);

export interface VeoFleetStatus {
  ok: boolean;
  version?: string;
  workers?: { total?: number; online?: number; busy?: number };
  capacity?: { concurrent_max?: number; concurrent_now?: number };
  queue?: {
    pending?: number;
    processing?: number;
    done?: number;
    error?: number;
  };
  /**
   * The orchestrator's own verdict on whether it can serve work right now.
   * Preferred over anything we derive: it can see causes that never reach
   * /status (quarantined accounts, a wedged bridge, a genuinely slow single
   * generation that IS progressing). Optional — absent on older builds, in
   * which case readiness is computed from `metrics` below.
   *
   * Live shape as published 2026-08-05:
   *   ready: false
   *   readiness: { ready: false, reasons: ["queue_stalled"],
   *                checks: { workers_online, pending, done_5m,
   *                          oldest_pending_age_s, stall_age_s } }
   */
  ready?: boolean;
  readiness?: {
    ready?: boolean;
    reasons?: string[];
    checks?: Record<string, number | string | boolean | null>;
  };
  ready_reason?: string;
  not_ready_reason?: string;
  metrics?: {
    ready?: boolean;
    ready_reason?: string;
    not_ready_reason?: string;
    throughput?: {
      done_1m?: number;
      done_5m?: number;
      done_1h?: number;
      jobs_per_min?: number;
    };
    queue?: { oldest_pending_age_s?: number | null };
  };
}

/**
 * How long a NON-EMPTY queue may sit with zero completions before the fleet is
 * called stalled. Must stay well above one generation (measured: image ~26-35s,
 * video ~60s, but a coalesced batch runs strictly serially). Same default and
 * same env var as /api/health/veo-fleet, so the badge and the router cannot
 * disagree about what "stalled" means.
 */
function stallThresholdSeconds(): number {
  return Number(process.env["VEO_FLEET_STALL_S"] ?? "600");
}

export interface VeoFleetReadiness {
  ready: boolean;
  reason: string;
  /** Whether the orchestrator told us, or we worked it out from metrics. */
  source: "explicit" | "throughput";
}

/**
 * Can this fleet be expected to produce output?
 *
 * Pure, so the rule can be tested against the real payloads it has to judge.
 *
 * The stall clause is deliberately conservative: it fires only on positive
 * evidence (a queue that exists, zero completions in the last 5 minutes, AND a
 * measured wait past the threshold). A false "stalled" is not free — for a
 * 2-reference branded thumbnail veo_fleet is the ONLY backend in the chain, so
 * wrongly declaring it down fails work that would have succeeded. Unknown
 * therefore keeps the benefit of the doubt; only measured failure loses it.
 */
export function veoFleetReadiness(body: VeoFleetStatus): VeoFleetReadiness {
  const explicit =
    typeof body.readiness?.ready === "boolean"
      ? body.readiness.ready
      : typeof body.ready === "boolean"
        ? body.ready
        : typeof body.metrics?.ready === "boolean"
          ? body.metrics.ready
          : null;
  if (explicit !== null) {
    // Its codes ("queue_stalled") plus its evidence — the numbers are what
    // make the rejection actionable without a second trip to the box.
    const codes = body.readiness?.reasons?.join(", ");
    const checks = body.readiness?.checks;
    const evidence = checks
      ? Object.entries(checks)
          .map(([k, v]) =>
            typeof v === "number" ? `${k}=${Math.round(v)}` : `${k}=${v}`,
          )
          .join(", ")
      : null;
    const prose = explicit
      ? (body.ready_reason ?? body.metrics?.ready_reason)
      : (body.not_ready_reason ??
        body.ready_reason ??
        body.metrics?.not_ready_reason ??
        body.metrics?.ready_reason);
    const why = codes || prose || (explicit ? null : "no reason given");
    const reason =
      `orchestrator reports ${explicit ? "ready" : "NOT ready"}` +
      (why ? `: ${why}` : "") +
      (evidence ? ` (${evidence})` : "");
    return { ready: explicit, reason, source: "explicit" };
  }

  if (body.ok !== true) {
    return {
      ready: false,
      reason: "/status did not report ok:true",
      source: "throughput",
    };
  }

  const online = body.workers?.online ?? 0;
  if (online < 1) {
    return {
      ready: false,
      reason:
        "no online workers — submitted jobs would never be claimed at all",
      source: "throughput",
    };
  }

  const pending = body.queue?.pending ?? 0;
  const done1m = body.metrics?.throughput?.done_1m ?? 0;
  const done5m = body.metrics?.throughput?.done_5m ?? 0;
  const oldest = body.metrics?.queue?.oldest_pending_age_s ?? null;
  const stallS = stallThresholdSeconds();

  if (
    pending > 0 &&
    done1m === 0 &&
    done5m === 0 &&
    oldest !== null &&
    oldest >= stallS
  ) {
    const busy = body.capacity?.concurrent_now ?? 0;
    return {
      ready: false,
      reason:
        `${pending} job(s) queued and nothing completed in the last 5 min ` +
        `(oldest has waited ${Math.round(oldest)}s, threshold ${stallS}s). ` +
        (busy > 0
          ? `A worker is holding ${busy} job(s) — busy is not progress.`
          : "No worker has claimed them."),
      source: "throughput",
    };
  }

  return {
    ready: true,
    reason:
      pending === 0
        ? "idle — queue empty"
        : `draining: ${pending} pending, ${done5m} done in the last 5 min`,
    source: "throughput",
  };
}

/** One entry of `GET /bridge/clients` — the pull-side worker registry. */
interface VeoFleetBridgeWorker {
  worker_id?: string;
  status?: string;
  capacity_max?: number;
  concurrent_now?: number;
  /**
   * How many upstream VUP API slots (accounts) this worker currently holds.
   * THIS, not `capacity_max`, is the real ceiling on parallel work: a worker
   * advertising `capacity_max: 12` while holding 3 assigned APIs will only
   * ever run 3 jobs at once and queue the rest.
   */
  assigned_apis?: number;
}

let healthState: {
  healthy: boolean;
  /**
   * We PROBED it and it told us it cannot produce — as opposed to `!healthy`,
   * which also covers "we could not reach it" and "we have not asked yet".
   * Routing treats the two differently: see backendMeasuredUnable() in
   * index.ts. A measured verdict is evidence; an unproven one is not.
   */
  stalled: boolean;
  checkedAt: number;
  refreshing: boolean;
  consecutiveFailures: number;
  lastStatus: VeoFleetStatus | null;
  /** null = not probed / probe failed. Never invented. */
  effectiveConcurrency: number | null;
  lastError: string | null;
} = {
  healthy: false,
  stalled: false,
  checkedAt: 0,
  refreshing: false,
  consecutiveFailures: 0,
  lastStatus: null,
  effectiveConcurrency: null,
  lastError: null,
};

/**
 * Sum the per-worker account slots across ONLINE workers only.
 *
 * MEASURED 2026-07-31: worker-1 reported `capacity_max: 12` but
 * `assigned_apis: 3`, and a 4-image + 4-video burst peaked at exactly 3
 * concurrent with 6 sitting `pending`. Admitting 12 in-flight against a
 * 3-slot backend does not make it faster — it just parks work in the fleet's
 * queue where the gateway can no longer see it, and (worse) keeps the
 * gateway's admission gate open so it never fails a request over to a
 * provider that does have spare capacity.
 *
 * Returns null when the probe cannot be trusted, so callers fall back to the
 * configured cap rather than to a guess.
 */
async function probeEffectiveConcurrency(): Promise<number | null> {
  try {
    const res = await fetch(`${veoFleetBaseUrl()}/bridge/clients`, {
      headers: veoFleetHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { workers?: VeoFleetBridgeWorker[] };
    const workers = body.workers;
    if (!Array.isArray(workers) || workers.length === 0) return null;

    let total = 0;
    let sawUsable = false;
    for (const w of workers) {
      if (w.status !== "online" && w.status !== "busy") continue;
      const assigned = w.assigned_apis;
      const ceiling = w.capacity_max;
      if (typeof assigned !== "number" || assigned < 0) continue;
      sawUsable = true;
      total +=
        typeof ceiling === "number" && ceiling > 0
          ? Math.min(assigned, ceiling)
          : assigned;
    }
    if (!sawUsable) return null;
    return total;
  } catch {
    return null;
  }
}

/**
 * Probe /status and turn it into a routing verdict. Exported so callers (and
 * tests) can force a probe instead of waiting out the TTL.
 */
export async function refreshVeoFleetHealth(): Promise<void> {
  try {
    // /status is unauthenticated and is the only endpoint that reveals both
    // worker liveness and throughput — the two things that decide whether a
    // submitted job will ever come back.
    const res = await fetch(`${veoFleetBaseUrl()}/status`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`VEO Fleet /status returned HTTP ${res.status}`);
    }
    const body = (await res.json()) as VeoFleetStatus;

    const verdict = veoFleetReadiness(body);
    if (!verdict.ready) {
      // A DEFINITE negative from a probe that completed. It does not go
      // through the catch below on purpose: the two-strike rule exists to
      // absorb a transport blip, not to argue with an answer we were given.
      // Softening this is what let a wedged fleet stay green for another full
      // TTL and keep taking work.
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "VEO Fleet is not ready — routing away from it",
          reason: verdict.reason,
          source: verdict.source,
        }),
      );
      healthState = {
        healthy: false,
        stalled: true,
        checkedAt: Date.now(),
        refreshing: false,
        consecutiveFailures: 0,
        lastStatus: body,
        effectiveConcurrency: healthState.effectiveConcurrency,
        lastError: verdict.reason,
      };
      return;
    }

    // Only meaningful once we know the orchestrator is up; a failure here is
    // non-fatal (null → callers use the configured cap).
    const effectiveConcurrency = await probeEffectiveConcurrency();
    healthState = {
      healthy: true,
      stalled: false,
      checkedAt: Date.now(),
      refreshing: false,
      consecutiveFailures: 0,
      lastStatus: body,
      effectiveConcurrency,
      lastError: null,
    };
  } catch (err) {
    const consecutiveFailures = healthState.consecutiveFailures + 1;
    const stillHealthy =
      healthState.healthy && consecutiveFailures < HEALTH_FAILURE_THRESHOLD;
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "VEO Fleet health probe failed",
        error: message,
        consecutive_failures: consecutiveFailures,
        still_treated_as_healthy: stillHealthy,
      }),
    );
    healthState = {
      healthy: stillHealthy,
      // Unreachable is not stalled. We have no evidence about throughput, and
      // routing must not treat a missed probe as a measured verdict.
      stalled: false,
      checkedAt: stillHealthy
        ? Date.now() - HEALTH_TTL_MS + HEALTH_RETRY_TTL_MS
        : Date.now(),
      refreshing: false,
      consecutiveFailures,
      lastStatus: healthState.lastStatus,
      effectiveConcurrency: healthState.effectiveConcurrency,
      lastError: message,
    };
  }
}

/**
 * Live parallelism the fleet can actually sustain right now, or null when it
 * has not been successfully probed. See probeEffectiveConcurrency() for why
 * this differs from the advertised `capacity_max`.
 */
export function veoFleetEffectiveConcurrency(): number | null {
  return healthState.effectiveConcurrency;
}

/**
 * Cached health check — sync read so the gateway's drain loop stays
 * synchronous. A stale value kicks off a background refresh.
 */
export function veoFleetHealthyCached(): boolean {
  if (
    Date.now() - healthState.checkedAt > HEALTH_TTL_MS &&
    !healthState.refreshing
  ) {
    healthState.refreshing = true;
    void refreshVeoFleetHealth();
  }
  return healthState.healthy;
}

/**
 * True only when a COMPLETED probe said the fleet cannot produce. Unreachable,
 * unprobed and merely-unhealthy are all false — see the `stalled` field above
 * for why routing needs the distinction.
 */
export function veoFleetStalled(): boolean {
  return healthState.stalled;
}

/**
 * Last observed orchestrator state, for the provider registry / System Health
 * surface. Never invented — nulls mean "not probed yet".
 */
export function veoFleetHealthSnapshot(): {
  healthy: boolean;
  /** Measured-incapable, as opposed to merely not-green. */
  stalled: boolean;
  checkedAt: number | null;
  workersOnline: number | null;
  concurrentMax: number | null;
  /** Real sustainable parallelism (sum of online workers' account slots). */
  effectiveConcurrency: number | null;
  concurrentNow: number | null;
  queuePending: number | null;
  /** Why the last probe landed where it did — green or not. */
  readyReason: string | null;
  lastError: string | null;
} {
  const s = healthState.lastStatus;
  return {
    healthy: healthState.healthy,
    stalled: healthState.stalled,
    checkedAt: healthState.checkedAt || null,
    workersOnline: s?.workers?.online ?? null,
    concurrentMax: s?.capacity?.concurrent_max ?? null,
    effectiveConcurrency: healthState.effectiveConcurrency,
    concurrentNow: s?.capacity?.concurrent_now ?? null,
    queuePending: s?.queue?.pending ?? null,
    readyReason: healthState.lastError,
    lastError: healthState.lastError,
  };
}

// Prime the cache at boot so the first request is already correctly routed,
// instead of spending a cold-start window falling through to dead backends.
if (veoFleetConfigured()) {
  healthState.refreshing = true;
  void refreshVeoFleetHealth();
}

// ── Request shaping ─────────────────────────────────────────────────────────

const MAX_PROMPT_CHARS = 2000;

function assertPromptLength(prompt: string): void {
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(
      `VEO Fleet: prompt exceeds ${MAX_PROMPT_CHARS} char limit (${prompt.length})`,
    );
  }
}

/**
 * The orchestrator uses TWO different aspect vocabularies: image jobs take
 * Landscape/Portrait/Square, video jobs take 16:9/9:16/1:1. Confirmed against
 * 270 historical job rows in orch.db and the fleet web UI's own options.
 */
export function mapFleetImageAspect(aspect: MediaAspect | undefined): string {
  if (aspect === "9:16") return "Portrait";
  if (aspect === "1:1") return "Square";
  return "Landscape";
}

export function mapFleetVideoAspect(aspect: MediaAspect | undefined): string {
  return aspect ?? "16:9";
}

/**
 * Models proven on this fleet (orch.db, 2026-07-30):
 *   image "2" (Nano Banana 2, the orchestrator default) and "nano-banana" → done
 *   image "imagen" → error
 *   video "veo-3.1-lite" → 254 done
 *   video "veo-omni"  → error, "model 'omni' not entitled on this account"
 * Overridable so an entitlement change does not need a deploy.
 */
const IMAGE_MODEL = process.env["VEO_FLEET_IMAGE_MODEL"] ?? "2";
const VIDEO_MODEL = process.env["VEO_FLEET_VIDEO_MODEL"] ?? "veo-3.1-lite";

interface JobIdsResponse {
  job_ids?: string[];
}

/**
 * Submit with an idempotency key. The orchestrator stores the key→job_ids
 * mapping (`_submit` in orchestrator/main.py), so a submit whose response we
 * lost to a socket timeout can be safely re-issued instead of double-charging
 * the account pool. The key is per-CALL (fresh uuid), never content-derived —
 * two legitimately identical prompts must still produce two jobs.
 */
const SUBMIT_ATTEMPTS = Number(process.env["VEO_FLEET_SUBMIT_ATTEMPTS"] ?? "2");
const SUBMIT_TIMEOUT_MS = Number(
  process.env["VEO_FLEET_SUBMIT_TIMEOUT_MS"] ?? "30000",
);

async function submitJob(
  path: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<string[]> {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= Math.max(1, SUBMIT_ATTEMPTS); attempt++) {
    try {
      const res = await fetch(`${veoFleetBaseUrl()}${path}`, {
        method: "POST",
        headers: {
          ...veoFleetHeaders(),
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) {
        // 4xx is our fault and will not get better on retry; 5xx might.
        const err = new Error(
          `VEO Fleet submit ${path} failed (${res.status}): ${text.slice(0, 300)}`,
        );
        if (res.status < 500) throw err;
        lastErr = err;
        continue;
      }
      let json: JobIdsResponse;
      try {
        json = JSON.parse(text) as JobIdsResponse;
      } catch {
        throw new Error(
          `VEO Fleet submit ${path}: non-JSON response: ${text.slice(0, 200)}`,
        );
      }
      const ids = json.job_ids ?? [];
      if (ids.length === 0) {
        throw new Error(
          `VEO Fleet submit ${path}: response contained no job_ids: ${text.slice(0, 200)}`,
        );
      }
      return ids;
    } catch (err) {
      // A network/abort error is exactly the case the idempotency key exists
      // for — retry with the SAME key.
      if (err instanceof Error && /failed \(4\d\d\)/.test(err.message))
        throw err;
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error(`VEO Fleet submit ${path} failed`);
}

export interface FleetImageOptions {
  aspectRatio?: MediaAspect;
  /** file_ids from uploadVeoFleetImage(). Multi-reference IS supported. */
  referenceImageIds?: string[];
  quality?: string;
  count?: number;
  idempotencyKey?: string;
}

/**
 * VERIFIED 2026-07-30: the fleet worker ACCEPTS `aspect: "Portrait"` (it is
 * stored on the job row) but returns a 1376x768 LANDSCAPE image anyway. Every
 * one of the 17 image jobs in orch.db came back landscape. Returning a
 * landscape frame to a caller that asked for 9:16 is precisely the silent
 * substitution this codebase forbids, so make it loud: the request still goes
 * through (there is no other working image backend to fall back to), but the
 * mismatch is logged where a vertical-format render will be traceable to it.
 */
function warnUnhonouredAspect(aspect: MediaAspect | undefined): void {
  if (aspect === undefined || aspect === "16:9") return;
  console.warn(
    JSON.stringify({
      level: "warn",
      message:
        "VEO Fleet image aspect is not honoured upstream — expect a landscape (1376x768) result",
      requested_aspect: aspect,
      sent_as: mapFleetImageAspect(aspect),
      action:
        "crop/pad downstream, or do not use veo_fleet images for vertical formats until the worker honours aspect",
    }),
  );
}

export async function submitVeoFleetImage(
  prompt: string,
  opts: FleetImageOptions = {},
): Promise<string[]> {
  assertPromptLength(prompt);
  warnUnhonouredAspect(opts.aspectRatio);
  return submitJob(
    "/jobs/image",
    {
      prompt,
      model: IMAGE_MODEL,
      aspect: mapFleetImageAspect(opts.aspectRatio),
      quality: opts.quality ?? "1K",
      count: opts.count ?? 1,
      reference_images: opts.referenceImageIds ?? [],
    },
    opts.idempotencyKey ?? randomUUID(),
  );
}

export interface FleetVideoOptions {
  aspectRatio?: MediaAspect;
  resolution?: string;
  durationSeconds?: number;
  count?: number;
  /** i2v source, a file_id from uploadVeoFleetImage(). */
  imageId?: string;
  /** first/end-frame pair, file_ids from uploadVeoFleetImage(). */
  startImageId?: string;
  endImageId?: string;
  idempotencyKey?: string;
}

export async function submitVeoFleetVideo(
  prompt: string,
  opts: FleetVideoOptions = {},
): Promise<string[]> {
  assertPromptLength(prompt);
  const body: Record<string, unknown> = {
    prompt,
    model: VIDEO_MODEL,
    aspect: mapFleetVideoAspect(opts.aspectRatio),
    duration: opts.durationSeconds ?? 8,
    resolution: opts.resolution ?? "720p",
    count: opts.count ?? 1,
  };
  if (opts.imageId) body["image"] = opts.imageId;
  if (opts.startImageId) body["start_image"] = opts.startImageId;
  if (opts.endImageId) body["end_image"] = opts.endImageId;
  if (opts.startImageId || opts.endImageId) {
    body["fef_mode"] = "first-end-frame";
  }
  return submitJob("/jobs/video", body, opts.idempotencyKey ?? randomUUID());
}

/** Upload an input image; returns the file_id used by reference_images/image. */
export async function uploadVeoFleetImage(
  data: Buffer,
  filename: string,
): Promise<string> {
  const res = await fetch(`${veoFleetBaseUrl()}/files/image`, {
    method: "POST",
    headers: { ...veoFleetHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      image_b64: data.toString("base64"),
      name: filename,
    }),
    signal: AbortSignal.timeout(
      Number(process.env["VEO_FLEET_UPLOAD_TIMEOUT_MS"] ?? "60000"),
    ),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `VEO Fleet upload failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as { file_id?: string };
  if (!json.file_id) {
    throw new Error("VEO Fleet upload: response missing file_id");
  }
  return json.file_id;
}

// ── Polling ─────────────────────────────────────────────────────────────────

interface FleetJob {
  job_id: string;
  type: "image" | "video";
  status: "pending" | "processing" | "done" | "error";
  outputs?: Array<{ file_id: string; name: string }>;
  error?: string | null;
  attempts?: number;
}

const POLL_INTERVAL_MS = Number(
  process.env["VEO_FLEET_POLL_INTERVAL_MS"] ?? "5000",
);
/**
 * How long a job may sit `pending` **while the fleet as a whole is achieving
 * nothing** before we call it stalled.
 *
 * This is NOT "how long may a job wait its turn". Waiting behind real work is
 * normal and must not be punished: the fleet coalesces jobs by reference image,
 * so thumbnails (each with a unique archetype + character pair) cannot batch and
 * run strictly one at a time. A 30-image batch therefore has a legitimate queue
 * of hours, and failing job #20 because it waited is failing it for the crime of
 * being twentieth.
 *
 * The owner's rule, verbatim: "If they are just queued, the time doesn't count,
 * only if they're actively being generated."
 *
 * So this budget is consumed only while the fleet is *not progressing* — see
 * `fleetIsProgressing` below. A moving queue can be waited on indefinitely; a
 * frozen one fails fast with a diagnosis.
 */
const PENDING_STALL_MS = Number(
  process.env["VEO_FLEET_PENDING_STALL_MS"] ?? String(8 * 60_000),
);

/**
 * Absolute wall-clock ceiling, as a backstop against a job that somehow neither
 * generates nor is detectably stalled. Deliberately generous — it exists so the
 * poll loop cannot run forever, not to bound normal work. Default 6h.
 */
const ABSOLUTE_CEILING_MS = Number(
  process.env["VEO_FLEET_ABSOLUTE_CEILING_MS"] ?? String(6 * 60 * 60_000),
);

export interface WaitOptions {
  /**
   * The GENERATION budget — time the job is allowed to spend actually being
   * worked on. Time spent queued does not consume it.
   */
  timeoutMs: number;
  /** Caller-owned cancellation (e.g. job cancelled upstream). */
  signal?: AbortSignal;
}

interface QueueProbe {
  pending: number | null;
  concurrentNow: number | null;
  concurrentMax: number | null;
  done: number | null;
}

/**
 * Read live queue state straight from the fleet.
 *
 * Deliberately NOT `veoFleetHealthSnapshot()`, which serves a cache refreshed
 * on a background timer. In the poll loop that cache is frequently unprimed,
 * and an unprimed cache reports every field as null — which an earlier version
 * of this function read as "the fleet is achieving nothing" and used to kill a
 * perfectly healthy queued job after zero seconds. Absent telemetry is not
 * evidence of failure.
 */
async function probeFleetQueue(): Promise<QueueProbe | null> {
  try {
    const res = await fetch(`${veoFleetBaseUrl()}/status`, {
      headers: veoFleetHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as VeoFleetStatus & {
      queue?: { pending?: number; done?: number };
    };
    return {
      pending: body.queue?.pending ?? null,
      concurrentNow: body.capacity?.concurrent_now ?? null,
      concurrentMax: body.capacity?.concurrent_max ?? null,
      done: body.queue?.done ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Is the fleet getting anything done, or is it frozen?
 *
 * `concurrentNow > 0` deliberately does NOT count as progress — that is the
 * exact trap the fleet monitor fell into: a wedged worker holds a job forever,
 * so "busy" reads as healthy while throughput is zero.
 *
 * Returns TRUE ("keep waiting") whenever we cannot prove otherwise. The cost of
 * a false "frozen" is killing real work; the cost of a false "progressing" is
 * bounded by ABSOLUTE_CEILING_MS. Those are not symmetric, so the tie goes to
 * waiting.
 */
function fleetIsProgressing(
  prev: QueueProbe | null,
  now: QueueProbe | null,
): boolean {
  if (!now) return true; // could not read the fleet — do not conclude failure
  // Completed count moved: something finished. Unambiguous progress.
  if (prev?.done != null && now.done != null && now.done > prev.done) {
    return true;
  }
  // Spare capacity means nothing is blocking us — we are simply next in line.
  if (
    now.concurrentNow !== null &&
    now.concurrentMax !== null &&
    now.concurrentNow < now.concurrentMax
  ) {
    return true;
  }
  // Otherwise: is the queue ahead of us shrinking?
  if (prev?.pending != null && now.pending != null) {
    return now.pending < prev.pending;
  }
  return false;
}

/**
 * Poll until done/error. Returns the output file_ids.
 *
 * This client owns its own deadline: BullMQ's `timeout:` keys are dead code in
 * this repo, so nothing above us will ever cut a runaway poll loop off.
 *
 * TWO SEPARATE CLOCKS, and the distinction is the whole point:
 *
 *   - `opts.timeoutMs` is the GENERATION budget and ticks only while the job is
 *     `processing`. It used to be wall-clock from submission, which meant a job
 *     that queued for nine minutes and then began generating had already spent
 *     its ten-minute budget and was failed mid-render with "did not complete
 *     within 600s (last status: processing)". On a backend that runs unique
 *     reference-image jobs strictly serially, that punished every job for the
 *     length of the queue ahead of it.
 *
 *   - `PENDING_STALL_MS` bounds waiting, but only accumulates while the FLEET
 *     is not progressing. Waiting your turn is free; waiting on a frozen fleet
 *     is not.
 */
export async function waitForVeoFleetJob(
  jobId: string,
  opts: WaitOptions,
): Promise<string[]> {
  const start = Date.now();
  let lastStatus = "pending";
  /** Time observed in `processing` — the only time that spends the budget. */
  let generatingMs = 0;
  /** Time observed pending *while the fleet was frozen*. */
  let stalledMs = 0;
  let queueProbe: QueueProbe | null = null;
  while (
    generatingMs < opts.timeoutMs &&
    Date.now() - start < ABSOLUTE_CEILING_MS
  ) {
    if (opts.signal?.aborted) {
      throw new Error(`VEO Fleet job ${jobId} polling cancelled by caller`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    let job: FleetJob;
    try {
      const res = await fetch(`${veoFleetBaseUrl()}/jobs/${jobId}`, {
        headers: veoFleetHeaders(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        if (res.status >= 500) continue; // transient — keep polling
        throw new Error(
          `VEO Fleet poll failed (${res.status}) for job ${jobId}`,
        );
      }
      job = (await res.json()) as FleetJob;
    } catch (err) {
      // A transient fetch/abort while polling is not a job failure.
      if (err instanceof Error && err.message.includes("poll failed"))
        throw err;
      continue;
    }

    // Account for the interval we just slept, against whichever clock the job
    // was actually on. A requeue (processing -> pending) simply stops spending
    // the generation budget and resumes spending it when work restarts; the
    // time already generated is kept, not refunded, so a job cannot loop
    // between states to win an unbounded budget.
    if (job.status === "processing") {
      generatingMs += POLL_INTERVAL_MS;
      stalledMs = 0; // real work is happening on our job
    } else if (job.status === "pending") {
      const probe = await probeFleetQueue();
      if (fleetIsProgressing(queueProbe, probe)) {
        stalledMs = 0; // the queue is moving — waiting our turn is legitimate
      } else {
        stalledMs += POLL_INTERVAL_MS;
      }
      queueProbe = probe;
    }
    lastStatus = job.status;

    if (job.status === "done") {
      const ids = (job.outputs ?? []).map((o) => o.file_id);
      if (ids.length === 0) {
        throw new Error(
          `VEO Fleet job ${jobId} done but produced no outputs: ${job.error ?? "no error reported"}`,
        );
      }
      return ids;
    }
    if (job.status === "error") {
      throw new Error(
        `VEO Fleet job ${jobId} failed after ${job.attempts ?? 0} attempts: ${job.error ?? "unknown error"}`,
      );
    }
    if (job.status === "pending" && stalledMs > PENDING_STALL_MS) {
      const snap = veoFleetHealthSnapshot();
      throw new Error(
        `VEO Fleet job ${jobId} waited ${Math.round(stalledMs / 1000)}s while the fleet made no ` +
          `progress — the queue is frozen, not merely long (workers_online=${snap.workersOnline ?? "unknown"}, ` +
          `queue_pending=${snap.queuePending ?? "unknown"}, ` +
          `concurrent=${snap.concurrentNow ?? "?"}/${snap.concurrentMax ?? "?"}). ` +
          `Total wait ${Math.round((Date.now() - start) / 1000)}s.`,
      );
    }
  }
  if (generatingMs >= opts.timeoutMs) {
    throw new Error(
      `VEO Fleet job ${jobId} spent ${Math.round(generatingMs / 1000)}s actively generating ` +
        `without finishing (budget ${Math.round(opts.timeoutMs / 1000)}s, last status: ${lastStatus}). ` +
        `Queue time is excluded from this figure.`,
    );
  }
  throw new Error(
    `VEO Fleet job ${jobId} hit the ${Math.round(ABSOLUTE_CEILING_MS / 3600_000)}h absolute ceiling ` +
      `(last status: ${lastStatus}, ${Math.round(generatingMs / 1000)}s of it generating). ` +
      `This means it neither generated nor looked stalled — investigate the fleet.`,
  );
}

// ── Download ────────────────────────────────────────────────────────────────

export async function downloadVeoFleetFile(
  fileId: string,
  destPath: string,
): Promise<void> {
  const res = await fetch(`${veoFleetBaseUrl()}/files/${fileId}`, {
    headers: veoFleetHeaders(),
  });
  if (!res.ok) {
    throw new Error(
      `VEO Fleet file download failed (${res.status}): ${fileId}`,
    );
  }
  if (!res.body) throw new Error("VEO Fleet file response has no body");
  const dest = createWriteStream(destPath);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, dest);
}

export async function downloadVeoFleetFileBuffer(
  fileId: string,
): Promise<Buffer> {
  const res = await fetch(`${veoFleetBaseUrl()}/files/${fileId}`, {
    headers: veoFleetHeaders(),
  });
  if (!res.ok) {
    throw new Error(
      `VEO Fleet file download failed (${res.status}): ${fileId}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}
