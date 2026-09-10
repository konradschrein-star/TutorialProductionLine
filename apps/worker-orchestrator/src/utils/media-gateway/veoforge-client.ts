import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { MediaAspect } from "./types.js";

/**
 * Raw HTTP client for VeoForge — the operator's own VEO tool.
 * `/opt/veoforge`, systemd unit `veoforge`, uvicorn on 127.0.0.1:5300,
 * public at https://veoforge.schreinercontentsystems.com.
 *
 * Auth is `Authorization: Bearer <token>` — NOT the `x-api-key` scheme the
 * VEO Fleet Orchestrator uses. Two different services, two different schemes.
 *
 * Shape: submit → poll → fetch result URL.
 *   POST /generate           video (and the legacy single-shot path)
 *   POST /v1/jobs            {mode:"image"|"video", …}
 *   GET  /status/{jid}       full record incl. logs and error
 *   GET  /result/{jid}       {status,url} or {status,urls:[{i,url}]}
 *   GET  /files/{name}       bytes
 *
 * TWO behaviours this client has to defend against, both observed live on
 * 2026-07-30:
 *
 *  1. A FAILED job does not become `status:"error"`. It stays `"queued"` with
 *     the failure text in `error` and a frozen `updated` timestamp. A naive
 *     poller burns its entire timeout on a job that is already dead. See
 *     STALL detection in waitForVeoForgeJob().
 *
 *  2. Generation depends on a pool of harvested Google/Labs accounts, and that
 *     pool goes dry (expired session cookies → 401 / CHALLENGE / quarantine).
 *     `/health` still answers `ok:true` in that state — `ok` means only "the
 *     process replied" — so health MUST be read from `GET /ready`, which
 *     answers 200 when it can generate and **503 when it cannot**. See
 *     refreshVeoForgeHealth().
 *
 * Model tiers: `lite` is what harvested VUP-pool accounts are entitled to —
 * they 403 on anything else. Own accounts use `quality`. A per-account
 * `Account.model` OVERRIDES whatever tier we request, so the default here is
 * deliberately `lite`.
 *
 * LOW-LEVEL transport. Callers go through media-gateway/index.ts.
 */

function veoforgeBaseUrl(): string {
  return process.env["VEOFORGE_API_URL"] ?? "http://127.0.0.1:5300";
}

function veoforgeHeaders(): Record<string, string> {
  const key = process.env["VEOFORGE_API_KEY"] ?? "";
  if (!key) {
    throw new Error(
      "VEOFORGE_API_KEY is not set — required for VeoForge generation",
    );
  }
  return { Authorization: `Bearer ${key}` };
}

export function veoforgeConfigured(): boolean {
  return Boolean(process.env["VEOFORGE_API_KEY"]);
}

/**
 * VeoForge's image path is inert pending an image-entitled pooled lease
 * (`re-lab/FLOW-API-WHISK.md`). Until that lease exists every image job comes
 * back `whisk:generateImage (auth/bot wall): HTTP 401 … UNAUTHENTICATED`.
 * Off by default so the gateway never routes images here and never wastes a
 * request; flip VEOFORGE_IMAGES_ENABLED=1 the day entitlement lands.
 *
 * VERIFIED ON THE SERVICE 2026-08-02: VeoForge's own job table has 44 completed
 * VIDEO jobs and ZERO completed image jobs — every image job in its history
 * ended 403 "caller does not have permission" (no image entitlement on the
 * harvested VUP pool) or 401 (expired bearer). The image path is not "slow" or
 * "flaky"; it has never once produced. Do not enable this flag on the strength
 * of the video path working.
 */
export function veoforgeImagesEnabled(): boolean {
  return process.env["VEOFORGE_IMAGES_ENABLED"] === "1";
}

// ── Health ──────────────────────────────────────────────────────────────────

const HEALTH_TTL_MS = Number(process.env["VEOFORGE_HEALTH_TTL_MS"] ?? "60000");
const HEALTH_FAILURE_THRESHOLD = Number(
  process.env["VEOFORGE_HEALTH_FAILURE_THRESHOLD"] ?? "2",
);
const HEALTH_RETRY_TTL_MS = Number(
  process.env["VEOFORGE_HEALTH_RETRY_TTL_MS"] ?? "5000",
);

/**
 * The body of `GET /ready` — served with HTTP **200 when ready, 503 when not**,
 * same JSON either way. `GET /health` serves the same shape but always 200 and
 * is liveness ONLY; never gate on it.
 */
export interface VeoForgeReadyBody {
  /** Liveness: the process answered. Says NOTHING about generation. */
  ok?: boolean;
  /** The service's own verdict on whether it can generate right now. */
  ready?: boolean;
  ready_reason?: string | null;
  accounts_total?: number;
  /**
   * Healthy AND holding an unexpired session jar. **0 means cannot generate.**
   * This is the only account field worth routing on.
   */
  accounts_capacity?: number;
  accounts_assignable?: number;
  /**
   * MISLEADING: means "no active penalty window", NOT "can generate". Observed
   * drifting 0..7 through an outage in which `accounts_capacity` never left 0
   * and the service produced nothing. Never gate on it.
   */
  accounts_healthy?: number;
  /**
   * Known to UNDER-report (5 against 23 actually expired) because pre-fix
   * optimistic values are still persisted. Diagnostic only.
   */
  accounts_sessions_expired?: number;
  accounts_sessions_unknown?: number;
  queue_depth?: number;
  stalled?: boolean;
  stall_threshold_s?: number;
  last_progress_age_s?: number | null;
  completed_last_hour?: number;
}

export interface VeoForgeReadiness {
  ready: boolean;
  reason: string;
  /** Whether the service told us, or we worked it out from capacity. */
  source: "explicit" | "capacity";
}

/** Evidence appended to every verdict so a rejection is actionable at 3am. */
function readinessEvidence(body: VeoForgeReadyBody): string {
  const parts: string[] = [];
  if (typeof body.accounts_capacity === "number") {
    parts.push(`capacity=${body.accounts_capacity}`);
  }
  if (typeof body.accounts_total === "number") {
    parts.push(`total=${body.accounts_total}`);
  }
  if (typeof body.queue_depth === "number") {
    parts.push(`queue_depth=${body.queue_depth}`);
  }
  if (typeof body.completed_last_hour === "number") {
    parts.push(`done_1h=${body.completed_last_hour}`);
  }
  return parts.join(", ");
}

/**
 * Can VeoForge be expected to produce output?
 *
 * Pure, so the rule can be tested against the real payloads it has to judge.
 *
 * The service's own `ready` wins: it can see causes no single field expresses
 * (a wedged worker pool, a stall, an entitlement change). Only when that field
 * is missing — an older build — does this fall back, and it falls back to
 * `accounts_capacity > 0`, never to `accounts_healthy`, which was the whole
 * bug: "not penalised" is not "can generate".
 *
 * Neither field present means we cannot tell, and unknown is never green.
 */
export function veoforgeReadiness(body: VeoForgeReadyBody): VeoForgeReadiness {
  const evidence = readinessEvidence(body);
  const suffix = evidence ? ` (${evidence})` : "";

  if (typeof body.ready === "boolean") {
    const why = body.ready_reason ?? (body.ready ? null : "no reason given");
    return {
      ready: body.ready,
      reason:
        `VeoForge reports ${body.ready ? "ready" : "NOT ready"}` +
        (why ? `: ${why}` : "") +
        suffix,
      source: "explicit",
    };
  }

  if (typeof body.accounts_capacity !== "number") {
    return {
      ready: false,
      reason:
        "/ready published neither `ready` nor `accounts_capacity` — cannot tell " +
        `whether VeoForge can generate, so it is not routed to${suffix}`,
      source: "capacity",
    };
  }

  if (body.accounts_capacity < 1) {
    return {
      ready: false,
      reason:
        "VeoForge account pool is dry — 0 accounts hold an unexpired session jar. " +
        `Re-export a fresh labs.google session and run add_account.py${suffix}`,
      source: "capacity",
    };
  }

  return {
    ready: true,
    reason: `VeoForge has ${body.accounts_capacity} account(s) able to generate${suffix}`,
    source: "capacity",
  };
}

let healthState: {
  healthy: boolean;
  checkedAt: number;
  refreshing: boolean;
  consecutiveFailures: number;
  /**
   * `accounts_capacity` from /ready — accounts that are unpenalised AND hold an
   * unexpired session jar. NOT `accounts_healthy`. null = not probed / probe
   * failed; never invented.
   */
  usableAccounts: number | null;
  totalAccounts: number | null;
  queueDepth: number | null;
  lastError: string | null;
} = {
  healthy: false,
  checkedAt: 0,
  refreshing: false,
  consecutiveFailures: 0,
  usableAccounts: null,
  totalAccounts: null,
  queueDepth: null,
  lastError: null,
};

/**
 * Probe /ready and turn it into a routing verdict. Exported so callers (and
 * tests) can force a probe instead of waiting out the TTL.
 *
 * 200 and 503 are both ANSWERS — 503 is how /ready says "not ready" and carries
 * the same diagnostic body. Only a status outside that pair, an unparseable
 * body, or a transport failure counts as a failed probe.
 */
export async function refreshVeoForgeHealth(): Promise<void> {
  try {
    const res = await fetch(`${veoforgeBaseUrl()}/ready`, {
      headers: veoforgeHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status !== 200 && res.status !== 503) {
      throw new Error(`VeoForge /ready returned HTTP ${res.status}`);
    }
    let body: VeoForgeReadyBody;
    try {
      body = (await res.json()) as VeoForgeReadyBody;
    } catch {
      throw new Error(
        `VeoForge /ready returned a non-JSON body (HTTP ${res.status})`,
      );
    }

    const verdict = veoforgeReadiness(body);
    if (!verdict.ready) {
      // A DEFINITE negative from a probe that COMPLETED. It deliberately does
      // not go through the catch below: the two-strike rule exists to absorb a
      // transport blip, not to argue with an answer we were given. Softening
      // this is what keeps a service with a dead credential pool green for
      // another full TTL while it takes work it cannot do.
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "VeoForge is not ready — routing away from it",
          reason: verdict.reason,
          source: verdict.source,
        }),
      );
      healthState = {
        healthy: false,
        checkedAt: Date.now(),
        refreshing: false,
        consecutiveFailures: 0,
        usableAccounts: body.accounts_capacity ?? 0,
        totalAccounts: body.accounts_total ?? healthState.totalAccounts,
        queueDepth: body.queue_depth ?? healthState.queueDepth,
        lastError: verdict.reason,
      };
      return;
    }

    healthState = {
      healthy: true,
      checkedAt: Date.now(),
      refreshing: false,
      consecutiveFailures: 0,
      usableAccounts: body.accounts_capacity ?? null,
      totalAccounts: body.accounts_total ?? null,
      queueDepth: body.queue_depth ?? healthState.queueDepth,
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
        message: "VeoForge health probe failed",
        error: message,
        consecutive_failures: consecutiveFailures,
        still_treated_as_healthy: stillHealthy,
      }),
    );
    healthState = {
      ...healthState,
      healthy: stillHealthy,
      checkedAt: stillHealthy
        ? Date.now() - HEALTH_TTL_MS + HEALTH_RETRY_TTL_MS
        : Date.now(),
      refreshing: false,
      consecutiveFailures,
      // A probe we could not complete tells us nothing about the pool. Do not
      // report 0 usable — that is a measurement we did not make.
      usableAccounts: stillHealthy ? healthState.usableAccounts : null,
      lastError: message,
    };
  }
}

export function veoforgeHealthyCached(): boolean {
  if (
    Date.now() - healthState.checkedAt > HEALTH_TTL_MS &&
    !healthState.refreshing
  ) {
    healthState.refreshing = true;
    void refreshVeoForgeHealth();
  }
  return healthState.healthy;
}

/**
 * Last observed pool state, for the provider registry / System Health.
 * `usableAccounts` is /ready's `accounts_capacity` — the count that can
 * actually generate. Nulls mean "not probed", never "zero".
 */
export function veoforgeHealthSnapshot(): {
  healthy: boolean;
  checkedAt: number | null;
  usableAccounts: number | null;
  totalAccounts: number | null;
  imagesEnabled: boolean;
  lastError: string | null;
} {
  return {
    healthy: healthState.healthy,
    checkedAt: healthState.checkedAt || null,
    usableAccounts: healthState.usableAccounts,
    totalAccounts: healthState.totalAccounts,
    imagesEnabled: veoforgeImagesEnabled(),
    lastError: healthState.lastError,
  };
}

if (veoforgeConfigured()) {
  healthState.refreshing = true;
  void refreshVeoForgeHealth();
}

// ── Request shaping ─────────────────────────────────────────────────────────

const MAX_PROMPT_CHARS = 2000;
/** Harvested pool accounts are `lite`-only and 403 on anything else. */
const DEFAULT_MODEL = process.env["VEOFORGE_MODEL"] ?? "lite";

function assertPromptLength(prompt: string): void {
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(
      `VeoForge: prompt exceeds ${MAX_PROMPT_CHARS} char limit (${prompt.length})`,
    );
  }
}

/** VeoForge takes uppercase orientation words, not ratio strings. */
export function mapVeoForgeAspect(aspect: MediaAspect | undefined): string {
  if (aspect === "9:16") return "PORTRAIT";
  if (aspect === "1:1") return "SQUARE";
  return "LANDSCAPE";
}

interface SubmitResponse {
  job_id?: string;
  id?: string;
  status?: string;
  created?: boolean;
}

const SUBMIT_TIMEOUT_MS = Number(
  process.env["VEOFORGE_SUBMIT_TIMEOUT_MS"] ?? "30000",
);
const SUBMIT_ATTEMPTS = Number(process.env["VEOFORGE_SUBMIT_ATTEMPTS"] ?? "2");

/**
 * `idempotency_key` is a first-class field on VeoForge's GenerateIn/BatchIn.
 * Fresh uuid per CALL (never content-derived — two identical prompts must
 * still produce two jobs), reused across in-call retries so a lost response
 * cannot double-spend the account pool.
 */
async function submitJob(
  path: string,
  body: Record<string, unknown>,
): Promise<string> {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= Math.max(1, SUBMIT_ATTEMPTS); attempt++) {
    try {
      const res = await fetch(`${veoforgeBaseUrl()}${path}`, {
        method: "POST",
        headers: { ...veoforgeHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(
          `VeoForge submit ${path} failed (${res.status}): ${text.slice(0, 300)}`,
        );
        if (res.status < 500) throw err;
        lastErr = err;
        continue;
      }
      let json: SubmitResponse;
      try {
        json = JSON.parse(text) as SubmitResponse;
      } catch {
        throw new Error(
          `VeoForge submit ${path}: non-JSON response: ${text.slice(0, 200)}`,
        );
      }
      const jobId = json.job_id ?? json.id;
      if (!jobId) {
        throw new Error(
          `VeoForge submit ${path}: response missing job id: ${text.slice(0, 200)}`,
        );
      }
      return jobId;
    } catch (err) {
      if (err instanceof Error && /failed \(4\d\d\)/.test(err.message))
        throw err;
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error(`VeoForge submit ${path} failed`);
}

export interface VeoForgeVideoOptions {
  aspectRatio?: MediaAspect;
  resolution?: string;
  durationSeconds?: number;
  /**
   * 1–20. count > 1 coalesces into a single upstream submit — a real
   * throughput lever when you genuinely want N variants of one prompt. Left
   * at 1 by default: every extra render spends finite account quota, and the
   * gateway's per-request contract only consumes one result.
   */
  count?: number;
  /** i2v source as a base64 payload (no data: prefix) or a VeoForge media id. */
  imageB64?: string;
  imageMediaId?: string;
  model?: string;
  idempotencyKey?: string;
}

export async function submitVeoForgeVideo(
  prompt: string,
  opts: VeoForgeVideoOptions = {},
): Promise<string> {
  assertPromptLength(prompt);
  const count = Math.min(20, Math.max(1, opts.count ?? 1));
  const body: Record<string, unknown> = {
    prompt,
    model: opts.model ?? DEFAULT_MODEL,
    aspect: mapVeoForgeAspect(opts.aspectRatio),
    resolution: opts.resolution ?? "720p",
    count,
    idempotency_key: opts.idempotencyKey ?? randomUUID(),
  };
  if (opts.durationSeconds) body["duration"] = opts.durationSeconds;
  if (opts.imageB64) body["image_b64"] = opts.imageB64;
  if (opts.imageMediaId) body["image_media_id"] = opts.imageMediaId;
  return submitJob("/generate", body);
}

/**
 * Whisk exposes exactly three i2i "ingredient" slots, so VeoForge carries at
 * most three references and 400s on a fourth rather than dropping it.
 */
export const VEOFORGE_MAX_IMAGE_REFERENCES = 3;

/**
 * The gateway's `referenceImages` is a positional `string[]` with a fixed
 * meaning set by the thumbnail builder (utils/thumbnail/index.ts): [0] is the
 * archetype/style reference, [1] is the channel persona (the host's face), and
 * anything after that is an extra. Whisk's slots are named, not positional, so
 * the position has to be translated or the persona lands in the STYLE slot and
 * the host's face is treated as a colour palette.
 */
const VEOFORGE_REFERENCE_SLOTS = ["style", "subject", "scene"] as const;

export interface VeoForgeImageOptions {
  aspectRatio?: MediaAspect;
  idempotencyKey?: string;
  model?: string;
  /** Reference image bytes in gateway order: [style, persona, extra]. */
  referenceImages?: Buffer[];
}

export async function submitVeoForgeImage(
  prompt: string,
  opts: VeoForgeImageOptions = {},
): Promise<string> {
  if (!veoforgeImagesEnabled()) {
    throw new Error(
      "VeoForge image generation is disabled on this installation. " +
        "An Admin must verify current image capability and readiness before " +
        "setting VEOFORGE_IMAGES_ENABLED=1. Video readiness alone does not prove image capability.",
    );
  }
  assertPromptLength(prompt);
  const refs = opts.referenceImages ?? [];
  if (opts.idempotencyKey && !/^[a-zA-Z0-9:_-]{1,200}$/.test(opts.idempotencyKey)) throw new Error("Invalid VeoForge operation identity");
  if (refs.length > VEOFORGE_MAX_IMAGE_REFERENCES) {
    throw new Error(
      `VeoForge carries at most ${VEOFORGE_MAX_IMAGE_REFERENCES} reference images ` +
        `(got ${refs.length}). Refusing rather than silently dropping one — a ` +
        "dropped persona reference yields a plausible thumbnail with the wrong host.",
    );
  }
  const body: Record<string, unknown> = {
    mode: "image",
    prompt,
    model: opts.model ?? "nano-banana",
    aspect: mapVeoForgeAspect(opts.aspectRatio),
    idempotency_key: opts.idempotencyKey ?? randomUUID(),
  };
  if (refs.length > 0) {
    body["reference_images"] = refs.map((buf, i) => ({
      category: VEOFORGE_REFERENCE_SLOTS[i] ?? "style",
      image_b64: buf.toString("base64"),
    }));
  }
  return submitJob("/v1/jobs", body);
}

// ── Polling ─────────────────────────────────────────────────────────────────

interface VeoForgeStatus {
  id?: string;
  status?: string;
  error?: string | null;
  updated?: number;
  result_path?: string | null;
  worker?: string | null;
  logs?: Array<{ t: number; msg: string }>;
}

interface VeoForgeResult {
  status?: string;
  url?: string;
  urls?: Array<{ i: number; url: string }>;
  error?: string | null;
}

const POLL_INTERVAL_MS = Number(
  process.env["VEOFORGE_POLL_INTERVAL_MS"] ?? "6000",
);
/**
 * A VeoForge job that has failed keeps `status:"queued"` and only reports the
 * failure through `error` + a frozen `updated`. Treat "error present and the
 * record has not advanced for this long" as terminal. Generous enough that a
 * transient upstream error the service is actively retrying (it does its own
 * circuit-breaker backoff) is not mistaken for a dead job.
 */
const ERROR_STALL_MS = Number(
  process.env["VEOFORGE_ERROR_STALL_MS"] ?? "90000",
);

export interface VeoForgeWaitOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

/**
 * Poll until the job produces media or is provably dead. Returns result URLs.
 *
 * This client owns its own deadline — BullMQ `timeout:` keys are dead code in
 * this repo, so nothing upstream will cut off a runaway poll.
 */
export async function waitForVeoForgeJob(
  jobId: string,
  opts: VeoForgeWaitOptions,
): Promise<string[]> {
  const start = Date.now();
  let lastStatus = "unknown";
  let lastUpdated = 0;
  let errorFirstSeenAt = 0;
  let lastErrorText: string | null = null;

  while (Date.now() - start < opts.timeoutMs) {
    if (opts.signal?.aborted) {
      throw new Error(`VeoForge job ${jobId} polling cancelled by caller`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    let snap: VeoForgeStatus;
    try {
      const res = await fetch(`${veoforgeBaseUrl()}/status/${jobId}`, {
        headers: veoforgeHeaders(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        if (res.status >= 500) continue;
        throw new Error(
          `VeoForge poll failed (${res.status}) for job ${jobId}`,
        );
      }
      snap = (await res.json()) as VeoForgeStatus;
    } catch (err) {
      if (err instanceof Error && err.message.includes("poll failed"))
        throw err;
      continue;
    }

    lastStatus = snap.status ?? lastStatus;

    if (lastStatus === "done") {
      return fetchVeoForgeResult(jobId);
    }
    if (lastStatus === "error" || lastStatus === "failed") {
      throw new Error(
        `VeoForge job ${jobId} failed: ${snap.error ?? "unknown error"}`,
      );
    }

    // ── stall detection: failed-but-still-"queued" ──
    if (snap.error) {
      const advanced = (snap.updated ?? 0) > lastUpdated;
      if (advanced || snap.error !== lastErrorText) {
        // The service is still working (retrying / backing off) — reset.
        errorFirstSeenAt = Date.now();
        lastErrorText = snap.error;
      } else if (
        errorFirstSeenAt > 0 &&
        Date.now() - errorFirstSeenAt > ERROR_STALL_MS
      ) {
        throw new Error(
          `VeoForge job ${jobId} is stalled in status "${lastStatus}" with an unrecovered error ` +
            `(no progress for ${Math.round((Date.now() - errorFirstSeenAt) / 1000)}s): ${snap.error}`,
        );
      }
    } else {
      errorFirstSeenAt = 0;
      lastErrorText = null;
    }
    lastUpdated = snap.updated ?? lastUpdated;
  }

  const pool = veoforgeHealthSnapshot();
  throw new Error(
    `VeoForge job ${jobId} did not complete within ${Math.round(opts.timeoutMs / 1000)}s ` +
      `(last status: ${lastStatus}, usable accounts: ${pool.usableAccounts ?? "unknown"}` +
      `${lastErrorText ? `, last error: ${lastErrorText}` : ""})`,
  );
}

async function fetchVeoForgeResult(jobId: string): Promise<string[]> {
  const res = await fetch(`${veoforgeBaseUrl()}/result/${jobId}`, {
    headers: veoforgeHeaders(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(
      `VeoForge result fetch failed (${res.status}) for job ${jobId}`,
    );
  }
  const body = (await res.json()) as VeoForgeResult;
  const urls = body.urls?.length
    ? body.urls.map((u) => u.url)
    : body.url
      ? [body.url]
      : [];
  if (urls.length === 0) {
    throw new Error(
      `VeoForge job ${jobId} reported done but returned no result url: ${body.error ?? "no error reported"}`,
    );
  }
  return urls;
}

// ── Download ────────────────────────────────────────────────────────────────

/**
 * `url` is whatever /result returned — normally a relative "/files/<name>".
 * Absolute URLs are passed through unchanged.
 */
function resolveVeoForgeUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${veoforgeBaseUrl()}${url.startsWith("/") ? "" : "/"}${url}`;
}

export async function downloadVeoForgeFile(
  url: string,
  destPath: string,
): Promise<void> {
  const res = await fetch(resolveVeoForgeUrl(url), {
    headers: veoforgeHeaders(),
  });
  if (!res.ok) {
    throw new Error(`VeoForge file download failed (${res.status}): ${url}`);
  }
  if (!res.body) throw new Error("VeoForge file response has no body");
  const dest = createWriteStream(destPath);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, dest);
}

export async function downloadVeoForgeFileBuffer(url: string): Promise<Buffer> {
  const res = await fetch(resolveVeoForgeUrl(url), {
    headers: veoforgeHeaders(),
  });
  if (!res.ok) {
    throw new Error(`VeoForge file download failed (${res.status}): ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
